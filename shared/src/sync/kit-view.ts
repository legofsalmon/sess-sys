import type { CommandArgs, Mutation } from '../commands.ts'
import { eachDay } from '../crew.ts'
import { STOPPED, type ProjectStatus } from '../jobs.ts'
import type { KitEntities, KitLine } from '../kit.ts'
import { DEPARTMENTS } from '../stock.ts'
import type { FaultsView } from './faults-view.ts'
import type { JobsView, JobView, PhaseView } from './jobs-view.ts'
import type { ModelView, WarehouseView } from './stock-view.ts'

/**
 * Kit on jobs (ADR 0014), worked out on a device from what it already has:
 * each line's days, how many of its product are free on them, and whether
 * it's short. Confirmed jobs hold their kit; enquiries and quotes are
 * pencilled in, checked as if they went ahead but never counted as taken;
 * cancelled and lost jobs hold nothing. Only days from today on are
 * checked, since what's past can't be short any more.
 */

/** What a job's status means for its kit. */
export type KitHold = 'held' | 'pencilled' | 'none'

export function holdOf(status: ProjectStatus): KitHold {
  if (status === 'confirmed') return 'held'
  return STOPPED.includes(status) ? 'none' : 'pencilled'
}

/** Another job with the same product out on the day that matters to a line. */
export interface KitOther {
  jobId: string
  name: string
  /** How many of Session Hire's own it has out that day. */
  qty: number
  hold: KitHold
  /** The line's own job, on another of its lines. */
  same: boolean
}

export interface KitLineView extends KitLine {
  pending: boolean
  job: JobView | undefined
  /** The phase it's for; undefined for the whole job, or for a phase since removed. */
  phase: PhaseView | undefined
  model: ModelView | undefined
  hold: KitHold
  /** Its days: its phase's, or the whole job's; undefined while there are none. */
  span: { start: string; end: string } | undefined
  /** How many come out of Session Hire's own stock: all but those subhired. */
  own: number
  /** How many Session Hire has that can go out: items in stock and what's counted, less those missing or not fit to use (ADR 0018). */
  owned: number
  /** How many of it are missing or not fit to use. */
  unusable: number
  /** The most it's short on any day from today on; 0 when there are enough. */
  short: number
  /** The first day it's that short. */
  shortDay: string | undefined
  /** How many days from today on it's short at all. */
  shortDays: number
  /** Short by this many if the enquiries and quotes on its days go ahead too; 0 unless more than `short`. */
  ifPencilled: number
  pencilledDay: string | undefined
  /** The fewest to spare on any of its days from today on; undefined when short or when there's nothing to check. */
  spare: number | undefined
  /** Who else has the product out on the day that matters: the day it's short, else the day the pencilled jobs would make it short, else its tightest. */
  others: KitOther[]
}

export interface KitView {
  lines: KitLineView[]
  /** Each job's lines by department, then product, the whole job's before each phase's. */
  byJob: ReadonlyMap<string, KitLineView[]>
  /** Each product's lines on jobs going ahead or pencilled in and not over yet, soonest first; ones with no dates last. */
  byModel: ReadonlyMap<string, KitLineView[]>
  /** Every line short on a day from today on, soonest first. */
  short: KitLineView[]
  /** Suppliers already used, to suggest. */
  suppliers: string[]
}

type Tables = { [E in keyof KitEntities]: Record<string, KitEntities[E]> }

/** Copy only the fields a change names; the rest stay as they are. */
function patch<T extends object>(target: T, changes: object): T {
  const out = { ...target }
  for (const [k, v] of Object.entries(changes)) if (k !== 'id' && v !== undefined) (out as Record<string, unknown>)[k] = v
  return out
}

/** Product names in order, as the Stock tab has them: one collator, not one made for every comparison. */
const byProductName = new Intl.Collator('en-IE', { sensitivity: 'base' })

/** What one product has out on one day. */
interface DayUse {
  held: number
  pencilled: number
  lines: KitLineView[]
}

export function kitView(
  entities: Partial<Tables>,
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number,
  jobs: JobsView,
  warehouse: WarehouseView,
  today: string,
  faults?: FaultsView
): KitView {
  const lines = new Map<string, KitLine & { pending: boolean }>()
  for (const l of Object.values(entities.kitLine ?? {})) lines.set(l.id, { ...l, pending: false })
  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    switch (m.name) {
      case 'kit.add': {
        const a = m.args as CommandArgs<'kit.add'>
        if (!lines.has(a.id)) lines.set(a.id, { ...a, pending: true })
        break
      }
      case 'kit.update': {
        const a = m.args as CommandArgs<'kit.update'>
        const found = lines.get(a.id)
        if (found) lines.set(a.id, { ...patch(found, a), pending: true })
        break
      }
      case 'kit.remove':
        lines.delete((m.args as CommandArgs<'kit.remove'>).id)
        break
    }
  }

  const jobById = new Map(jobs.jobs.map((j) => [j.id, j]))
  const modelById = new Map(warehouse.models.map((m) => [m.id, m]))
  const views: KitLineView[] = [...lines.values()].map((l) => {
    const job = jobById.get(l.projectId)
    const phase = l.phaseId ? job?.phases.find((p) => p.id === l.phaseId) : undefined
    const model = modelById.get(l.modelId)
    const unusable = faults?.unusable(l.modelId) ?? 0
    return {
      ...l,
      job,
      phase,
      model,
      hold: job ? holdOf(job.status) : 'none',
      span: l.phaseId ? phase && { start: phase.start, end: phase.end } : job?.span,
      own: Math.max(0, l.qty - l.subhireQty),
      owned: Math.max(0, (model?.total ?? 0) - unusable),
      unusable,
      short: 0,
      shortDay: undefined,
      shortDays: 0,
      ifPencilled: 0,
      pencilledDay: undefined,
      spare: undefined,
      others: [],
    }
  })

  /** A line's days from today on. */
  const daysOf = (v: KitLineView) => (v.span && v.span.end >= today ? eachDay(v.span.start < today ? today : v.span.start, v.span.end) : [])
  const counts = (v: KitLineView) => v.hold !== 'none' && v.own > 0

  // What each product has out, day by day.
  const use = new Map<string, Map<string, DayUse>>()
  for (const v of views) {
    if (!counts(v)) continue
    let byDay = use.get(v.modelId)
    if (!byDay) use.set(v.modelId, (byDay = new Map()))
    for (const d of daysOf(v)) {
      let x = byDay.get(d)
      if (!x) byDay.set(d, (x = { held: 0, pencilled: 0, lines: [] }))
      if (v.hold === 'held') x.held += v.own
      else x.pencilled += v.own
      x.lines.push(v)
    }
  }

  const othersOn = (x: DayUse | undefined, v: KitLineView): KitOther[] => {
    const byJob = new Map<string, KitOther>()
    for (const o of x?.lines ?? []) {
      if (o === v) continue
      const found = byJob.get(o.projectId)
      if (found) found.qty += o.own
      else byJob.set(o.projectId, { jobId: o.projectId, name: o.job?.name ?? 'Another job', qty: o.own, hold: o.hold, same: o.projectId === v.projectId })
    }
    return [...byJob.values()].sort((a, b) => (a.hold === b.hold ? 0 : a.hold === 'held' ? -1 : 1) || b.qty - a.qty || a.name.localeCompare(b.name))
  }

  for (const v of views) {
    if (!counts(v)) continue
    const byDay = use.get(v.modelId)!
    let tightest: string | undefined
    let least = Infinity
    for (const d of daysOf(v)) {
      const x = byDay.get(d)!
      const heldByOthers = x.held - (v.hold === 'held' ? v.own : 0)
      const pencilledByOthers = x.pencilled - (v.hold === 'pencilled' ? v.own : 0)
      const free = Math.max(0, v.owned - heldByOthers)
      const short = Math.max(0, v.own - free)
      if (short > 0) {
        v.shortDays++
        if (short > v.short) [v.short, v.shortDay] = [short, d]
      }
      const ifPencilled = Math.max(0, v.own - Math.max(0, v.owned - heldByOthers - pencilledByOthers))
      if (ifPencilled > short && ifPencilled > v.ifPencilled) [v.ifPencilled, v.pencilledDay] = [ifPencilled, d]
      if (free - v.own < least) [least, tightest] = [free - v.own, d]
    }
    if (tightest === undefined) continue
    if (v.short === 0) v.spare = least
    v.others = othersOn(byDay.get(v.shortDay ?? v.pencilledDay ?? tightest), v)
  }

  const department = (v: KitLineView) => {
    const i = v.model ? DEPARTMENTS.indexOf(v.model.department) : -1
    return i < 0 ? DEPARTMENTS.length : i
  }
  const productName = (v: KitLineView) => v.model?.name ?? ''
  const phaseStart = (v: KitLineView) => (v.phaseId ? (v.phase?.start ?? '9999') : '')
  const byJob = new Map<string, KitLineView[]>()
  for (const v of views) {
    const list = byJob.get(v.projectId) ?? []
    list.push(v)
    byJob.set(v.projectId, list)
  }
  for (const list of byJob.values())
    list.sort(
      (a, b) =>
        department(a) - department(b) ||
        byProductName.compare(productName(a), productName(b)) ||
        phaseStart(a).localeCompare(phaseStart(b)) ||
        a.id.localeCompare(b.id)
    )

  const coming = (v: KitLineView) => v.hold !== 'none' && (!v.span || v.span.end >= today)
  const soonest = (a: KitLineView, b: KitLineView) =>
    (a.span ? 0 : 1) - (b.span ? 0 : 1) || (a.span?.start ?? '').localeCompare(b.span?.start ?? '') || (a.job?.name ?? '').localeCompare(b.job?.name ?? '')
  const byModel = new Map<string, KitLineView[]>()
  for (const v of views.filter(coming).sort(soonest)) {
    const list = byModel.get(v.modelId) ?? []
    list.push(v)
    byModel.set(v.modelId, list)
  }

  const short = views
    .filter((v) => v.short > 0)
    .sort(
      (a, b) => a.shortDay!.localeCompare(b.shortDay!) || (a.job?.name ?? '').localeCompare(b.job?.name ?? '') || productName(a).localeCompare(productName(b))
    )

  const suppliers = new Map<string, string>()
  for (const v of views) {
    const s = v.supplier.trim()
    if (s && !suppliers.has(s.toLowerCase())) suppliers.set(s.toLowerCase(), s)
  }

  return { lines: views, byJob, byModel, short, suppliers: [...suppliers.values()].sort((a, b) => a.localeCompare(b)) }
}
