import { eachDay } from '../crew.ts'
import type { JobView } from './jobs-view.ts'
import { heldAround, type KitView } from './kit-view.ts'
import type { ModelView } from './stock-view.ts'

/**
 * Whether there's enough kit for a quote (ADR 0089), by the same rules as a
 * job's kit (ADR 0031): the job's days, with its days to get kit ready and
 * check it back, from today on, against what other jobs hold. Its own job's
 * kit is left out, since the quote is what the job's kit will be: what's
 * asked is how many of each product the quote's lines want from our own
 * stock, all its lines of that product and the packages that hold it
 * together.
 */

export interface QuoteKitCheck {
  modelId: string
  /** How many the quote's lines want from our own stock. */
  wanted: number
  /** How many we have that can go out (kit-view.ts's `owned`). */
  owned: number
  /** The most it's short on any of the days; 0 when there's enough. */
  short: number
  shortDay: string | undefined
  /** Short by this many if the enquiries and quotes on those days go ahead too; 0 unless more than `short`. */
  ifPencilled: number
  pencilledDay: string | undefined
  /** The jobs that have it out on the day that matters, most first. */
  others: { jobId: string; name: string; qty: number; held: boolean }[]
}

export interface QuoteKitInputs {
  kit: KitView
  models: (modelId: string) => ModelView | undefined
  /** How many of a product are missing or not fit to use (ADR 0018). */
  unusable: (modelId: string) => number
  /** How many are still out with jobs that should have brought them back (ADR 0031). */
  lateOut: (modelId: string) => number
}

/** Each product a quote wants, checked over its job's days; empty for a job with no dates, or whose days are past. */
export function quoteKit(job: Pick<JobView, 'id' | 'span' | 'prepDays' | 'returnDays'>, wanted: ReadonlyMap<string, number>, today: string, x: QuoteKitInputs): Map<string, QuoteKitCheck> {
  const out = new Map<string, QuoteKitCheck>()
  if (!job.span) return out
  const held = heldAround(job, job.span)
  if (held.end < today) return out
  const days = eachDay(held.start < today ? today : held.start, held.end)
  for (const [modelId, want] of wanted) {
    const model = x.models(modelId)
    // Dry hire stock (ADR 0075) is all hired in, so there's none of our own to run short of.
    if (want <= 0 || !model || model.dryHire) continue
    const owned = Math.max(0, model.total - model.racked - x.unusable(modelId) - x.lateOut(modelId))
    const lines = (x.kit.byModel.get(modelId) ?? []).filter((l) => l.projectId !== job.id && l.hold !== 'none' && l.own > 0 && l.held)
    const r: QuoteKitCheck = { modelId, wanted: want, owned, short: 0, shortDay: undefined, ifPencilled: 0, pencilledDay: undefined, others: [] }
    let tightest: string | undefined
    let least = Infinity
    for (const d of days) {
      let heldBy = 0
      let pencilledBy = 0
      for (const l of lines) {
        if (l.held!.start > d || l.held!.end < d) continue
        if (l.hold === 'held') heldBy += l.own
        else pencilledBy += l.own
      }
      const short = Math.max(0, want - Math.max(0, owned - heldBy))
      if (short > r.short) [r.short, r.shortDay] = [short, d]
      const ifPencilled = Math.max(0, want - Math.max(0, owned - heldBy - pencilledBy))
      if (ifPencilled > short && ifPencilled > r.ifPencilled) [r.ifPencilled, r.pencilledDay] = [ifPencilled, d]
      if (owned - heldBy - want < least) [least, tightest] = [owned - heldBy - want, d]
    }
    const on = r.shortDay ?? r.pencilledDay ?? tightest
    if (on) {
      const byJob = new Map<string, QuoteKitCheck['others'][number]>()
      for (const l of lines) {
        if (l.held!.start > on || l.held!.end < on) continue
        const found = byJob.get(l.projectId)
        if (found) found.qty += l.own
        else byJob.set(l.projectId, { jobId: l.projectId, name: l.job?.name ?? 'Another job', qty: l.own, held: l.hold === 'held' })
      }
      r.others = [...byJob.values()].sort((a, b) => Number(b.held) - Number(a.held) || b.qty - a.qty || a.name.localeCompare(b.name))
    }
    out.set(modelId, r)
  }
  return out
}

/** How many of each product a quote's lines want from our own stock: a kit line's, less those hired in, and each package's pieces. */
export function quoteWants(
  lines: readonly { kind: string; modelId?: string | null; qty: number; subhireQty?: number; packageId?: string }[],
  packageItems: (packageId: string) => readonly { modelId: string; qty: number }[] | undefined
): Map<string, number> {
  const wanted = new Map<string, number>()
  const add = (modelId: string, n: number) => n > 0 && wanted.set(modelId, (wanted.get(modelId) ?? 0) + n)
  for (const l of lines) {
    if (l.kind !== 'kit') continue
    const own = Math.max(0, l.qty - (l.subhireQty ?? 0))
    if (l.modelId) add(l.modelId, own)
    else if (l.packageId) for (const i of packageItems(l.packageId) ?? []) add(i.modelId, i.qty * own)
  }
  return wanted
}
