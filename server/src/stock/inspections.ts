import { INSPECTION_SHORT, RETIRED_LABELS, type CommandArgs, type Inspection } from '@sh/shared'
import type { Queryable } from '../db.ts'
import { emit, Refused, type Ctx } from '../kernel.ts'
import { getAsset } from './store.ts'

/**
 * Inspections (ADR 0020): each electrical test and thorough examination
 * of a numbered item, kept for good as the register the law asks for. A
 * record says something that already happened, so it's kept whoever sends
 * it; only one for an item never saved, or retired, is turned down. When
 * each is next due, and whether an item can go out, each device works out
 * (shared/src/sync/inspections-view.ts).
 */

type Row = Record<string, any>

const toInspection = (r: Row): Inspection => ({ id: r.id, assetId: r.asset_id, kind: r.kind, passed: r.passed, at: r.at, by: r.by, note: r.note })

async function getInspection(q: Queryable, id: string) {
  const { rows } = await q.query(
    `SELECT id, asset_id, kind, passed, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at, by, note
       FROM inspections WHERE id = $1`,
    [id]
  )
  return rows[0] ? toInspection(rows[0]) : undefined
}

type InspectionCommand = 'inspection.record'
type Handler<N extends InspectionCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

export const inspectionHandlers: { [N in InspectionCommand]: Handler<N> } = {
  async 'inspection.record'(ctx, a) {
    // Sent twice by the same phone: it's kept already.
    if (await getInspection(ctx.tx, a.id)) return
    const asset = await getAsset(ctx.tx, a.assetId)
    const what = INSPECTION_SHORT[a.kind]
    if (!asset)
      throw new Refused({
        code: 'not-found',
        message: `An item's ${what} was for an item never added to the stock list, so it wasn't kept. Add the item, then record it again.`,
      })
    if (asset.status !== 'active') {
      const why = asset.retiredReason ? RETIRED_LABELS[asset.retiredReason].toLowerCase() : 'retired'
      throw new Refused({
        code: 'conflict',
        message: `${asset.number || 'That item'} is marked as ${why}, so its ${what} wasn't kept. Bring it back first if it's still here.`,
      })
    }
    await ctx.tx.query(`INSERT INTO inspections (id, asset_id, kind, passed, at, by, note) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
      a.id,
      a.assetId,
      a.kind,
      a.passed,
      a.at,
      a.by.trim(),
      a.note.trim(),
    ])
    await emit(ctx, 'inspection', a.id, await getInspection(ctx.tx, a.id))
  },
}
