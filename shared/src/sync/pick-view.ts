import type { CommandArgs, Mutation } from '../commands.ts'
import { STOPPED } from '../jobs.ts'
import type { MoveEntities, Movement } from '../moves.ts'
import { DEPARTMENTS } from '../stock.ts'
import type { FaultsView } from './faults-view.ts'
import type { JobsView, JobView } from './jobs-view.ts'
import { holdOf, type KitLineView, type KitView } from './kit-view.ts'
import { addDays } from './plan.ts'
import type { AssetView, ModelView, WarehouseView } from './stock-view.ts'

/**
 * Pick lists, and kit out and back (ADR 0017), worked out on a device from
 * the movements it has: what's out with which job, what each job's pick
 * list still needs and where to find it, and what came back. Movements go
 * in the order they happened on the phones, not the order they synced, so
 * every device ends up agreeing. A case takes what's in it along: the
 * latest scan of an item, or of any case it's in, says where it is.
 * Reporting an item missing (ADR 0018) ends its time out with a job, as a
 * scan back would, but it counts as missing, not back, until it's found.
 */

/** How far ahead the Stock tab looks for kit going out. */
export const PICK_AHEAD_DAYS = 14

export interface MovementView extends Movement {
  pending: boolean
}

/** A numbered item out with a job. */
export interface OutState {
  projectId: string
  /** When it went out, by the phone's clock. */
  since: string
  /** The case it went out in, when the case was scanned rather than the item. */
  inCase: AssetView | undefined
}

/** Where to find more of a product that aren't out: a place, or a case, and what's there. */
export interface PickFrom {
  where: string
  items: AssetView[]
  /** How many are counted there. */
  counted: number
}

export interface PickRow {
  modelId: string
  model: ModelView | undefined
  /** The job's kit lines for it; none when it went out without being on the kit. */
  lines: KitLineView[]
  /** How many the job needs from Session Hire's own: its lines added up, less those subhired. */
  need: number
  /** Numbered items out with the job now, by number. */
  items: AssetView[]
  /** Counted out with the job and not back yet. */
  counted: number
  /** Items and counted, out now. */
  out: number
  /** Items that went out with the job and aren't out with it any more. */
  backItems: AssetView[]
  countedBack: number
  back: number
  /** Items that went out with the job and were reported missing, and not found since (ADR 0018). */
  missingItems: AssetView[]
  countedMissing: number
  missing: number
  /** How many of the product can't go out, anywhere: missing, not fit to use, or not passed an inspection. */
  unusable: number
  /** Where to find the ones that aren't out, by place: items that can't go out left out. */
  from: PickFrom[]
}

export interface PickList {
  job: JobView
  /** The kit's products in the job page's order, then anything out that isn't on the kit. */
  rows: PickRow[]
  /** Over the kit's products: how many the job needs, and how many of those are out. */
  need: number
  out: number
  /** Everything out with the job now, whether on the kit or not. */
  stillOut: number
  /** Everything that went out and came back. */
  back: number
  /** Everything that went out and was reported missing, and not found since. */
  missing: number
}

export interface MovesView {
  /** Which job a numbered item is out with, if any. */
  outOf(assetId: string): OutState | undefined
  pickList(jobId: string): PickList | undefined
  /** Confirmed jobs on now or starting in the next 14 days, with kit to go out; soonest first. */
  soon: PickList[]
  /** Jobs over, or not going ahead, with kit still out; the longest over first. */
  stillOut: PickList[]
}

type Tables = { [E in keyof MoveEntities]: Record<string, MoveEntities[E]> }

const later = (a: Movement, b: Movement) => a.at > b.at || (a.at === b.at && a.id > b.id)
/** Places in order, "Bay 2" before "Bay 10": one collator, not one made for every comparison. */
const byWhere = new Intl.Collator('en-IE', { numeric: true })

/** "Bay A3", "Bay A3, in SH-000009", or "in SH-000009" when the case isn't anywhere yet. */
function whereKept(a: { at: { name: string } | undefined; inCase: AssetView | undefined; place?: { name: string } | undefined }): string {
  const parts = [a.at?.name ?? a.place?.name, a.inCase && `in ${a.inCase.number || 'a case'}`].filter(Boolean)
  return parts.length ? parts.join(', ') : 'Not said where'
}

export function movesView(
  entities: Partial<Tables>,
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number,
  jobs: JobsView,
  warehouse: WarehouseView,
  kit: KitView,
  today: string,
  faults?: FaultsView
): MovesView {
  const moves = new Map<string, MovementView>()
  for (const m of Object.values(entities.movement ?? {})) moves.set(m.id, { ...m, pending: false })
  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    if (m.name !== 'move.record') continue
    const a = m.args as CommandArgs<'move.record'>
    if (moves.has(a.id)) continue
    // An item's product is the one it has now, as the server will record it.
    const modelId = (a.assetId && warehouse.assets.get(a.assetId)?.modelId) || a.modelId
    moves.set(a.id, { ...a, modelId, at: new Date(a.at).toISOString(), pending: true })
  }
  // A report of an item missing ends its time out, as a scan back would. Found, it counts as back.
  type Event = MovementView & { missing?: boolean }
  const events: Event[] = [...moves.values()]
  for (const f of faults?.all ?? []) {
    if (f.kind !== 'missing' || !f.assetId || !f.projectId) continue
    events.push({ id: f.id, projectId: f.projectId, direction: 'in', assetId: f.assetId, modelId: f.modelId, qty: 1, at: f.at, pending: f.pending, missing: f.outcome !== 'found' })
  }
  const sorted = events.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))

  /** Everything in a case, however deep. */
  const contents = (a: AssetView | undefined, into: Set<string>) => {
    for (const x of a?.items ?? []) {
      if (into.has(x.id)) continue
      into.add(x.id)
      contents(x, into)
    }
  }

  const last = new Map<string, Event>()
  /** Each job's items that have been out with it: scanned, or in a case scanned. */
  const sent = new Map<string, Set<string>>()
  /** Each job's counted kit, by product. */
  const counted = new Map<string, Map<string, { out: number; back: number; missing: number }>>()
  const tally = (projectId: string, modelId: string) => {
    let byModel = counted.get(projectId)
    if (!byModel) counted.set(projectId, (byModel = new Map()))
    let c = byModel.get(modelId)
    if (!c) byModel.set(modelId, (c = { out: 0, back: 0, missing: 0 }))
    return c
  }
  for (const m of sorted) {
    if (m.assetId) {
      last.set(m.assetId, m)
      if (m.direction === 'out') {
        let ids = sent.get(m.projectId)
        if (!ids) sent.set(m.projectId, (ids = new Set()))
        ids.add(m.assetId)
        contents(warehouse.assets.get(m.assetId), ids)
      }
    } else {
      const c = tally(m.projectId, m.modelId)
      if (m.direction === 'out') c.out += m.qty
      else c.back += m.qty
    }
  }
  // Counted kit reported missing from a job: missing until found, then back.
  for (const f of faults?.all ?? []) {
    if (f.kind !== 'missing' || f.assetId || !f.projectId) continue
    const c = tally(f.projectId, f.modelId)
    if (f.outcome === 'found') c.back += f.qty
    else c.missing += f.qty
  }

  // Each item's latest scan, or its case's, or that case's case's.
  const outState = new Map<string, OutState>()
  /** Items whose latest scan, or their case's, is a report of them missing. */
  const missingNow = new Set<string>()
  const outByJob = new Map<string, AssetView[]>()
  for (const a of warehouse.assets.values()) {
    let best = last.get(a.id)
    let via: AssetView | undefined
    const seen = new Set([a.id])
    for (let c = a.inCase; c && !seen.has(c.id); c = c.inCase) {
      seen.add(c.id)
      const m = last.get(c.id)
      if (m && (!best || later(m, best))) [best, via] = [m, c]
    }
    if (best?.missing) missingNow.add(a.id)
    if (best?.direction !== 'out') continue
    outState.set(a.id, { projectId: best.projectId, since: best.at, inCase: via })
    const list = outByJob.get(best.projectId) ?? []
    list.push(a)
    outByJob.set(best.projectId, list)
  }

  const jobById = new Map(jobs.jobs.map((j) => [j.id, j]))
  const modelById = new Map(warehouse.models.map((m) => [m.id, m]))
  const department = (r: PickRow) => {
    const i = r.model ? DEPARTMENTS.indexOf(r.model.department) : -1
    return i < 0 ? DEPARTMENTS.length : i
  }
  const byNumber = (a: AssetView, b: AssetView) => a.number.localeCompare(b.number) || a.id.localeCompare(b.id)

  const lists = new Map<string, PickList | undefined>()
  const pickList = (jobId: string): PickList | undefined => {
    if (lists.has(jobId)) return lists.get(jobId)
    const job = jobById.get(jobId)
    if (!job) {
      lists.set(jobId, undefined)
      return undefined
    }
    const rows = new Map<string, PickRow>()
    const row = (modelId: string) => {
      let r = rows.get(modelId)
      if (!r) {
        r = {
          modelId,
          model: modelById.get(modelId),
          lines: [],
          need: 0,
          items: [],
          counted: 0,
          out: 0,
          backItems: [],
          countedBack: 0,
          back: 0,
          missingItems: [],
          countedMissing: 0,
          missing: 0,
          unusable: faults?.unusable(modelId) ?? 0,
          from: [],
        }
        rows.set(modelId, r)
      }
      return r
    }
    for (const l of kit.byJob.get(jobId) ?? []) {
      const r = row(l.modelId)
      r.lines.push(l)
      r.need += l.own
    }
    for (const a of outByJob.get(jobId) ?? []) row(a.modelId).items.push(a)
    for (const [modelId, c] of counted.get(jobId) ?? []) {
      const r = row(modelId)
      r.countedBack = Math.min(c.out, c.back)
      r.countedMissing = Math.min(c.out - r.countedBack, c.missing)
      r.counted = c.out - r.countedBack - r.countedMissing
    }
    for (const id of sent.get(jobId) ?? []) {
      const a = warehouse.assets.get(id)
      if (!a || outState.get(id)?.projectId === jobId) continue
      if (missingNow.has(id)) row(a.modelId).missingItems.push(a)
      else row(a.modelId).backItems.push(a)
    }
    for (const r of rows.values()) {
      r.items.sort(byNumber)
      r.backItems.sort(byNumber)
      r.missingItems.sort(byNumber)
      r.out = r.items.length + r.counted
      r.back = r.backItems.length + r.countedBack
      r.missing = r.missingItems.length + r.countedMissing
      // Where to find the rest: items not out with any job, and what's counted, place by place.
      const from = new Map<string, PickFrom>()
      const at = (where: string) => from.get(where) ?? (from.set(where, { where, items: [], counted: 0 }), from.get(where)!)
      for (const a of r.model?.items ?? []) if (!outState.has(a.id) && !faults?.cantGoOut(a.id)) at(whereKept(a)).items.push(a)
      for (const s of r.model?.counted ?? []) at(whereKept(s)).counted += s.qty
      r.from = [...from.values()].sort((a, b) => byWhere.compare(a.where, b.where))
    }
    // The kit's own order (by department, then product), then what isn't on it.
    const onKit = [...rows.values()].filter((r) => r.lines.length > 0)
    const extra = [...rows.values()]
      .filter((r) => r.lines.length === 0)
      .sort((a, b) => department(a) - department(b) || (a.model?.name ?? '').localeCompare(b.model?.name ?? ''))
    const list: PickList = {
      job,
      rows: [...onKit, ...extra],
      need: onKit.reduce((n, r) => n + r.need, 0),
      out: onKit.reduce((n, r) => n + Math.min(r.out, r.need), 0),
      stillOut: [...rows.values()].reduce((n, r) => n + r.out, 0),
      back: [...rows.values()].reduce((n, r) => n + r.back, 0),
      missing: [...rows.values()].reduce((n, r) => n + r.missing, 0),
    }
    lists.set(jobId, list)
    return list
  }

  const until = addDays(today, PICK_AHEAD_DAYS - 1)
  const soon = jobs.jobs
    .filter((j) => holdOf(j.status) === 'held' && j.span && j.span.end >= today && j.span.start <= until && kit.byJob.has(j.id))
    .map((j) => pickList(j.id)!)
    .filter((p) => p.need > 0)
    .sort((a, b) => a.job.span!.start.localeCompare(b.job.span!.start) || a.job.name.localeCompare(b.job.name))

  const withKitOut = new Set([...outByJob.keys(), ...[...counted].filter(([, byModel]) => [...byModel.values()].some((c) => c.out > c.back + c.missing)).map(([id]) => id)])
  const over = (j: JobView) => STOPPED.includes(j.status) || !j.span || j.span.end < today
  const stillOut = [...withKitOut]
    .map((id) => pickList(id))
    .filter((p): p is PickList => !!p && over(p.job) && p.stillOut > 0)
    .sort((a, b) => (a.job.span?.end ?? '').localeCompare(b.job.span?.end ?? '') || a.job.name.localeCompare(b.job.name))

  return { outOf: (id) => outState.get(id), pickList, soon, stillOut }
}
