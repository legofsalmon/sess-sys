import type { CommandArgs, Mutation } from '../commands.ts'
import type { Fault, FaultEntities } from '../faults.ts'
import type { JobsView, JobView } from './jobs-view.ts'
import type { AssetView, ModelView, WarehouseView } from './stock-view.ts'

/**
 * Faults and missing kit (ADR 0018) as a device sees them: what the server
 * has said, with this person's waiting reports laid over it. Open faults
 * are the repair list; the ones that stop kit going out come off what's
 * free for jobs (kit-view.ts) and out of where to find it (pick-view.ts).
 */

export interface FaultView extends Fault {
  pending: boolean
  open: boolean
  asset: AssetView | undefined
  model: ModelView | undefined
  job: JobView | undefined
  /** Keeps the kit from going out: open, and missing or not fit to use. */
  stops: boolean
}

export interface FaultsView {
  /** Every fault, newest first. */
  all: FaultView[]
  /** Open ones, oldest first: the repair list. */
  open: FaultView[]
  /** An item's, newest first. */
  ofAsset(assetId: string): FaultView[]
  /** A product's counted kit's, newest first. */
  ofModel(modelId: string): FaultView[]
  /** A job's, newest first. */
  ofJob(jobId: string): FaultView[]
  /** The open fault keeping an item from going out, if any: missing before damaged, then its case's, if that's missing. */
  stopping(assetId: string): FaultView | undefined
  /** Whether an item can't go out: a fault stops it, or an inspection it failed or is overdue (ADR 0019). */
  cantGoOut(assetId: string): boolean
  /** How many of a product can't go out: items stopped, and counted kit reported, at most what's counted. */
  unusable(modelId: string): number
}

type Tables = { [E in keyof FaultEntities]: Record<string, FaultEntities[E]> }

const newest = (a: Fault, b: Fault) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)

export function faultsView(
  entities: Partial<Tables>,
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number,
  jobs: JobsView,
  warehouse: WarehouseView,
  /** Items an inspection keeps from going out (ADR 0019). */
  blocked: (assetId: string) => boolean = () => false
): FaultsView {
  const faults = new Map<string, Fault & { pending: boolean }>()
  for (const f of Object.values(entities.fault ?? {})) faults.set(f.id, { ...f, pending: false })
  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    switch (m.name) {
      case 'fault.report': {
        const a = m.args as CommandArgs<'fault.report'>
        if (faults.has(a.id)) break
        // An item's product is the one it has now, as the server will record it.
        const modelId = (a.assetId && warehouse.assets.get(a.assetId)?.modelId) || a.modelId
        faults.set(a.id, { ...a, modelId, repair: '', at: new Date(a.at).toISOString(), outcome: null, closedAt: null, pending: true })
        break
      }
      case 'fault.update': {
        const a = m.args as CommandArgs<'fault.update'>
        const f = faults.get(a.id)
        if (!f) break
        faults.set(a.id, {
          ...f,
          usable: f.kind === 'missing' ? false : (a.usable ?? f.usable),
          note: a.note ?? f.note,
          repair: a.repair ?? f.repair,
          pending: true,
        })
        break
      }
      case 'fault.close': {
        const a = m.args as CommandArgs<'fault.close'>
        const f = faults.get(a.id)
        if (f && f.outcome === null) faults.set(a.id, { ...f, outcome: a.outcome, closedAt: new Date(a.at).toISOString(), pending: true })
        break
      }
    }
  }

  const jobById = new Map(jobs.jobs.map((j) => [j.id, j]))
  const modelById = new Map(warehouse.models.map((m) => [m.id, m]))
  const all: FaultView[] = [...faults.values()]
    .map((f) => {
      const open = f.outcome === null
      return {
        ...f,
        open,
        asset: f.assetId ? warehouse.assets.get(f.assetId) : undefined,
        model: modelById.get(f.modelId),
        job: f.projectId ? jobById.get(f.projectId) : undefined,
        stops: open && (f.kind === 'missing' || !f.usable),
      }
    })
    .sort(newest)

  const group = (key: (f: FaultView) => string | null) => {
    const by = new Map<string, FaultView[]>()
    for (const f of all) {
      const k = key(f)
      if (k === null) continue
      const list = by.get(k) ?? []
      list.push(f)
      by.set(k, list)
    }
    return by
  }
  const byAsset = group((f) => f.assetId)
  const byModel = group((f) => (f.assetId ? null : f.modelId))
  const byJob = group((f) => f.projectId)

  const ownStop = (assetId: string) => {
    const stops = (byAsset.get(assetId) ?? []).filter((f) => f.stops)
    return stops.find((f) => f.kind === 'missing') ?? stops[0]
  }
  // A case that's missing takes what's in it along.
  const stopping = (assetId: string) => {
    const own = ownStop(assetId)
    if (own) return own
    const seen = new Set([assetId])
    for (let c = warehouse.assets.get(assetId)?.inCase; c && !seen.has(c.id); c = c.inCase) {
      seen.add(c.id)
      const f = ownStop(c.id)
      if (f?.kind === 'missing') return f
    }
    return undefined
  }
  const cantGoOut = (assetId: string) => !!stopping(assetId) || blocked(assetId)
  const unusable = (modelId: string) => {
    const m = modelById.get(modelId)
    if (!m) return 0
    const items = m.items.filter((a) => cantGoOut(a.id)).length
    const counted = (byModel.get(modelId) ?? []).filter((f) => f.stops).reduce((n, f) => n + f.qty, 0)
    return items + Math.min(counted, m.countedTotal)
  }

  return {
    all,
    open: all.filter((f) => f.open).reverse(),
    ofAsset: (id) => byAsset.get(id) ?? [],
    ofModel: (id) => byModel.get(id) ?? [],
    ofJob: (id) => byJob.get(id) ?? [],
    stopping,
    cantGoOut,
    unusable,
  }
}
