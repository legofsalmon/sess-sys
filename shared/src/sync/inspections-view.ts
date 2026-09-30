import { irishToday } from '../calendar.ts'
import type { CommandArgs, Mutation } from '../commands.ts'
import { DUE_SOON_DAYS, INSPECTION_KINDS, monthsLater, type Inspection, type InspectionEntities, type InspectionKind } from '../inspections.ts'
import type { Model } from '../stock.ts'
import { addDays } from './plan.ts'
import type { AssetView, WarehouseView } from './stock-view.ts'

/**
 * Inspections (ADR 0019) as a device sees them: each item's records, with
 * this person's waiting ones laid over them, and for each inspection its
 * product needs, when it's next due. An item whose last one failed, or
 * that's overdue, can't go out; one never recorded here is listed, but not
 * stopped, since its last test may be on paper.
 */

export interface InspectionView extends Inspection {
  pending: boolean
  /** The day it was done, in Ireland. */
  day: string
}

/**
 * Where an item stands on one inspection: `ok`, `soon` (due within 30
 * days), `overdue`, `failed` (the last one), or `unrecorded` (none here yet).
 */
export type DueState = 'ok' | 'soon' | 'overdue' | 'failed' | 'unrecorded'

export interface Due {
  asset: AssetView
  kind: InspectionKind
  /** How many months apart, as its product says. */
  months: number
  last: InspectionView | undefined
  /** The day it's next due; undefined when never recorded, or failed. */
  due: string | undefined
  state: DueState
}

export interface InspectionsView {
  /** An item's records, newest first. */
  ofAsset(assetId: string): InspectionView[]
  /** Each inspection an item's product needs, and where it stands; none for a retired item. */
  dueOf(assetId: string): Due[]
  /** What keeps an item from going out: the last one failed, or overdue. */
  blocks(assetId: string): Due | undefined
  /** Every item in stock failed, overdue, or due within 30 days: failed and overdue first, longest first, then soonest. */
  attention: Due[]
  /** Items in stock needing an inspection with none recorded here yet. */
  unrecorded: Due[]
}

type Tables = { [E in keyof InspectionEntities]: Record<string, InspectionEntities[E]> }

const monthsFor = (m: Model | undefined, kind: InspectionKind) => (kind === 'pat' ? m?.patMonths : m?.liftingMonths) ?? null
const newest = (a: Inspection, b: Inspection) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)
const rank: Record<DueState, number> = { failed: 0, overdue: 1, soon: 2, unrecorded: 3, ok: 4 }

export function inspectionsView(
  entities: Partial<Tables>,
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number,
  warehouse: WarehouseView,
  today: string
): InspectionsView {
  const records = new Map<string, InspectionView>()
  const view = (i: Inspection, pending: boolean): InspectionView => ({ ...i, pending, day: irishToday(new Date(i.at)) })
  for (const i of Object.values(entities.inspection ?? {})) records.set(i.id, view(i, false))
  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    if (m.name !== 'inspection.record') continue
    const a = m.args as CommandArgs<'inspection.record'>
    if (!records.has(a.id)) records.set(a.id, view({ ...a, at: new Date(a.at).toISOString() }, true))
  }

  const byAsset = new Map<string, InspectionView[]>()
  for (const i of records.values()) {
    const list = byAsset.get(i.assetId) ?? []
    list.push(i)
    byAsset.set(i.assetId, list)
  }
  for (const list of byAsset.values()) list.sort(newest)

  const soon = addDays(today, DUE_SOON_DAYS)
  const dues = new Map<string, Due[]>()
  const dueOf = (assetId: string): Due[] => {
    const found = dues.get(assetId)
    if (found) return found
    const asset = warehouse.assets.get(assetId)
    const list: Due[] = []
    if (asset?.status === 'active') {
      for (const kind of INSPECTION_KINDS) {
        const months = monthsFor(asset.model, kind)
        if (!months) continue
        const last = byAsset.get(assetId)?.find((i) => i.kind === kind)
        const due = last?.passed ? monthsLater(last.day, months) : undefined
        const state: DueState = !last ? 'unrecorded' : !last.passed ? 'failed' : due! < today ? 'overdue' : due! <= soon ? 'soon' : 'ok'
        list.push({ asset, kind, months, last, due, state })
      }
    }
    dues.set(assetId, list)
    return list
  }
  const blocks = (assetId: string) => dueOf(assetId).find((d) => d.state === 'failed' || d.state === 'overdue')

  const all = warehouse.models.flatMap((m) => (m.patMonths || m.liftingMonths ? m.items.flatMap((a) => dueOf(a.id)) : []))
  const attention = all
    .filter((d) => d.state === 'failed' || d.state === 'overdue' || d.state === 'soon')
    .sort(
      (a, b) =>
        Math.min(rank[a.state], 1) - Math.min(rank[b.state], 1) ||
        (a.due ?? a.last?.day ?? '').localeCompare(b.due ?? b.last?.day ?? '') ||
        a.asset.number.localeCompare(b.asset.number)
    )
  const unrecorded = all.filter((d) => d.state === 'unrecorded')

  return { ofAsset: (id) => byAsset.get(id) ?? [], dueOf, blocks, attention, unrecorded }
}
