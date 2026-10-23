import type { CommandArgs, RackSlot } from '@sh/shared'
import type { Queryable } from '../db.ts'
import { emit, emitRemoved, Refused, type Ctx } from '../kernel.ts'
import { getModel } from './store.ts'

/**
 * Racks' layouts (ADR 0074). A slot is refused only when it can't be
 * meant: the rack isn't a rack, the product is gone or was added by
 * mistake, or it's the rack itself, or another rack. Whether it fits is
 * the app's to say, not the server's to refuse: a layout is a plan.
 */

const SLOT = `id, rack_id, model_id, top, side, qty, notes, across, label, grp, colour, in_slot_id`

type Row = Record<string, any>

export const toSlot = (r: Row): RackSlot => ({
  id: r.id,
  rackId: r.rack_id,
  modelId: r.model_id,
  top: r.top,
  side: r.side,
  qty: r.qty,
  notes: r.notes,
  across: r.across,
  label: r.label,
  group: r.grp,
  colour: r.colour,
  inSlotId: r.in_slot_id,
})

export async function getSlot(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${SLOT} FROM rack_slots WHERE id = $1`, [id])
  return rows[0] ? toSlot(rows[0]) : undefined
}

/** The racks whose layouts have this product in them, by name, as a refusal says them. */
export async function racksUsing(q: Queryable, modelId: string): Promise<string[]> {
  const { rows } = await q.query<{ name: string }>(
    `SELECT DISTINCT m.name FROM rack_slots s JOIN models m ON m.id = s.rack_id WHERE s.model_id = $1 ORDER BY m.name`,
    [modelId]
  )
  return rows.map((r) => r.name)
}

/** "is in the layout of Monitor rack. Take it out of that first." */
export function inLayoutsReason(racks: readonly string[]): string {
  const which = racks.length === 1 ? racks[0] : `${racks.length} racks (${racks.slice(0, 3).join(', ')}${racks.length > 3 ? '…' : ''})`
  return `is in the layout of ${which}. Take it out of ${racks.length === 1 ? 'that' : 'those'} first.`
}

/** How many slots a rack's layout has. */
export async function slotsIn(q: Queryable, rackId: string): Promise<number> {
  const { rows } = await q.query<{ n: number }>('SELECT count(*)::int AS n FROM rack_slots WHERE rack_id = $1', [rackId])
  return rows[0]!.n
}

/** A rack's layout goes with it when it's marked as added by mistake. */
export async function clearLayout(ctx: Ctx, rackId: string) {
  const { rows } = await ctx.tx.query<{ id: string }>('DELETE FROM rack_slots WHERE rack_id = $1 RETURNING id', [rackId])
  for (const r of rows) await emitRemoved(ctx, 'rackSlot', r.id)
}

/** What was in a shelf or drawer (ADR 0078) stays in the rack, loose. */
async function emptyHolder(ctx: Ctx, slotId: string) {
  const { rows } = await ctx.tx.query<{ id: string }>('UPDATE rack_slots SET in_slot_id = NULL WHERE in_slot_id = $1 RETURNING id', [slotId])
  for (const r of rows) await emit(ctx, 'rackSlot', r.id, await getSlot(ctx.tx, r.id))
}

type Handler<N extends 'rackSlot.set' | 'rackSlot.remove'> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

export const rackHandlers: { 'rackSlot.set': Handler<'rackSlot.set'>; 'rackSlot.remove': Handler<'rackSlot.remove'> } = {
  async 'rackSlot.set'(ctx, a) {
    const was = await getSlot(ctx.tx, a.id)
    if (was && was.rackId !== a.rackId) throw new Refused({ code: 'conflict', message: 'That slot is in another rack.' })
    const rack = await getModel(ctx.tx, a.rackId)
    if (!rack || rack.mistake) throw new Refused({ code: 'not-found', message: 'That rack is no longer in the stock list.' })
    if (!rack.isRack) throw new Refused({ code: 'conflict', message: `${rack.name} isn't a rack, so it has no layout.` })
    const m = await getModel(ctx.tx, a.modelId)
    if (!m) throw new Refused({ code: 'not-found', message: 'That product is no longer in the stock list.' })
    if (m.mistake) throw new Refused({ code: 'conflict', message: `${m.name} was added by mistake, so it can't go in a rack.` })
    if (m.id === rack.id) throw new Refused({ code: 'conflict', message: "A rack can't go inside itself." })
    if (m.isRack) throw new Refused({ code: 'conflict', message: `${m.name} is a rack itself. Put what's in it in this rack's layout instead.` })
    if (a.top !== null && a.qty > 1) throw new Refused({ code: 'invalid', message: 'Something on the rails is one at a time: add another for the next.' })
    // Only loose kit is in a shelf or drawer (ADR 0078), and only one of this rack's, on its rails.
    const inSlotId = a.top === null ? a.inSlotId : null
    if (inSlotId) {
      const holder = await getSlot(ctx.tx, inSlotId)
      const part = holder && holder.rackId === a.rackId && holder.top !== null ? (await getModel(ctx.tx, holder.modelId))?.rackPart : undefined
      if (part !== 'shelf' && part !== 'drawer') throw new Refused({ code: 'conflict', message: "That shelf or drawer isn't on this rack's rails any more." })
    }
    await ctx.tx.query(
      `INSERT INTO rack_slots (id, rack_id, model_id, top, side, qty, notes, across, label, grp, colour, in_slot_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET model_id = EXCLUDED.model_id, top = EXCLUDED.top, side = EXCLUDED.side, qty = EXCLUDED.qty, notes = EXCLUDED.notes,
         across = EXCLUDED.across, label = EXCLUDED.label, grp = EXCLUDED.grp, colour = EXCLUDED.colour, in_slot_id = EXCLUDED.in_slot_id`,
      [a.id, a.rackId, a.modelId, a.top, a.side, a.qty, a.notes.trim(), a.across, a.label.trim(), a.group.trim(), a.colour, inSlotId]
    )
    await emit(ctx, 'rackSlot', a.id, await getSlot(ctx.tx, a.id))
    // Off the rails, a shelf or drawer has nothing in it any more.
    if (a.top === null) await emptyHolder(ctx, a.id)
  },

  async 'rackSlot.remove'(ctx, a) {
    // Taken out twice, by two phones: it's out already.
    if (!(await getSlot(ctx.tx, a.id))) return
    await emptyHolder(ctx, a.id)
    await ctx.tx.query('DELETE FROM rack_slots WHERE id = $1', [a.id])
    await emitRemoved(ctx, 'rackSlot', a.id)
  },
}
