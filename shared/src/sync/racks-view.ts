import type { CommandArgs, Mutation } from '../commands.ts'
import { checkBuilt, layoutOf, type RackCheck, type RackEntities, type RackLayout, type RackSlot } from '../racks.ts'
import type { AssetView, ModelView, WarehouseView } from './stock-view.ts'

/**
 * Racks as a device sees them (ADR 0074): each rack product with its
 * layout, what the layout comes to and what won't fit, and each rack built
 * of it against its layout. The layouts the server has sent, with this
 * device's own waiting changes laid over them, as for everything else.
 */

export interface SlotView extends RackSlot {
  pending: boolean
  model: ModelView | undefined
}

export interface BuiltRack {
  item: AssetView
  /** What's in it directly, by product: its items and what's counted in it. */
  holds: ReadonlyMap<string, number>
  check: RackCheck
}

export interface RackView {
  model: ModelView
  /** On the rails top to bottom, the front before the back at the same height; then what's loose in it, by name. */
  slots: SlotView[]
  layout: RackLayout
  /** The racks built of it, by number. */
  built: BuiltRack[]
}

export interface RacksView {
  /** Every rack product, by name. */
  racks: RackView[]
  of(modelId: string): RackView | undefined
  /** The racks whose layout has this product in it. */
  using(modelId: string): RackView[]
  /** A built rack, by its item. */
  built(assetId: string): BuiltRack | undefined
}

type Tables = { rackSlot: Record<string, RackEntities['rackSlot']> }

export function racksView(entities: Partial<Tables>, outbox: readonly (Mutation & { appliedSeq?: number })[], cursor: number, warehouse: WarehouseView): RacksView {
  // Slots kept from before placing across the rails, labels and groups (ADR 0078) have none.
  const withDefaults = (s: Partial<RackSlot>) => ({ across: 'left' as const, label: '', group: '', colour: null, inSlotId: null, ...s }) as RackSlot
  const slots = new Map<string, RackSlot & { pending: boolean }>()
  for (const s of Object.values(entities.rackSlot ?? {})) slots.set(s.id, { ...withDefaults(s), pending: false })
  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    switch (m.name) {
      case 'rackSlot.set': {
        const a = m.args as CommandArgs<'rackSlot.set'>
        slots.set(a.id, { ...withDefaults(a), notes: a.notes.trim(), label: (a.label ?? '').trim(), group: (a.group ?? '').trim(), pending: true })
        break
      }
      case 'rackSlot.remove':
        slots.delete((m.args as CommandArgs<'rackSlot.remove'>).id)
        break
    }
  }

  const models = new Map<string, ModelView>()
  for (const m of warehouse.models) models.set(m.id, m)
  for (const m of warehouse.mistakes.values()) models.set(m.id, m)

  const byRack = new Map<string, SlotView[]>()
  for (const s of slots.values()) {
    const list = byRack.get(s.rackId) ?? []
    list.push({ ...s, model: models.get(s.modelId) })
    byRack.set(s.rackId, list)
  }

  const racks: RackView[] = []
  const builtByItem = new Map<string, BuiltRack>()
  const usedBy = new Map<string, RackView[]>()
  for (const model of warehouse.models) {
    if (!model.isRack) continue
    const list = (byRack.get(model.id) ?? []).sort(
      (a, b) =>
        (a.top === null ? 1 : 0) - (b.top === null ? 1 : 0) ||
        (a.top ?? 0) - (b.top ?? 0) ||
        (a.side === b.side ? 0 : a.side === 'front' ? -1 : 1) ||
        (a.model?.name ?? '').localeCompare(b.model?.name ?? '') ||
        a.id.localeCompare(b.id)
    )
    const built = model.items.map((item): BuiltRack => {
      const holds = new Map<string, number>()
      for (const a of item.items) holds.set(a.modelId, (holds.get(a.modelId) ?? 0) + 1)
      for (const s of item.counted) holds.set(s.modelId, (holds.get(s.modelId) ?? 0) + s.qty)
      return { item, holds, check: checkBuilt(list, holds, (id) => !!models.get(id)?.dryHire) }
    })
    const view: RackView = { model, slots: list, layout: layoutOf(model, list, models), built }
    racks.push(view)
    for (const b of built) builtByItem.set(b.item.id, b)
    for (const id of new Set(list.map((s) => s.modelId))) usedBy.set(id, [...(usedBy.get(id) ?? []), view])
  }
  const byId = new Map(racks.map((r) => [r.model.id, r]))

  return {
    racks,
    of: (id) => byId.get(id),
    using: (id) => usedBy.get(id) ?? [],
    built: (id) => builtByItem.get(id),
  }
}
