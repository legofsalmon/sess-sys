import type { CommandArgs, Movement } from '@sh/shared'
import type { Queryable } from '../db.ts'
import { emit, Refused, type Ctx } from '../kernel.ts'
import { getProject } from '../projects/store.ts'
import { getAsset, getModel } from './store.ts'

/**
 * Kit out and back (ADR 0017): every scan out to a job and back in is kept,
 * whoever sends it and whatever the plan says, since it records something
 * that already happened. Only a scan naming a job or an item the server
 * never saved (because it turned that down) can't be kept, and the answer
 * says which, so it can be scanned again. What's out where, and what
 * doesn't match the plan, each device works out (shared/src/sync/pick-view.ts).
 */

type Row = Record<string, any>

const toMovement = (r: Row): Movement => ({
  id: r.id,
  projectId: r.project_id,
  direction: r.direction,
  assetId: r.asset_id,
  modelId: r.model_id,
  qty: r.qty,
  at: r.at,
})

async function getMovement(q: Queryable, id: string) {
  const { rows } = await q.query(
    `SELECT id, project_id, direction, asset_id, model_id, qty,
            to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
       FROM movements WHERE id = $1`,
    [id]
  )
  return rows[0] ? toMovement(rows[0]) : undefined
}

/** How many times a product has been scanned or counted out or back, which keeps it in the stock list. */
export async function movementsOf(q: Queryable, modelId: string): Promise<number> {
  const { rows } = await q.query<{ n: string }>('SELECT count(*) AS n FROM movements WHERE model_id = $1', [modelId])
  return Number(rows[0]!.n)
}

type MoveCommand = 'move.record'
type Handler<N extends MoveCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

export const moveHandlers: { [N in MoveCommand]: Handler<N> } = {
  async 'move.record'(ctx, a) {
    // Sent twice by the same phone: it's kept already.
    if (await getMovement(ctx.tx, a.id)) return
    const way = a.direction === 'out' ? 'out' : 'back in'
    const asset = a.assetId ? await getAsset(ctx.tx, a.assetId) : undefined
    if (a.assetId && !asset)
      throw new Refused({
        code: 'not-found',
        message: `An item scanned ${way} was never added to the stock list, so the scan wasn't kept. Add the item, then scan it again.`,
      })
    const what = asset ? asset.number || 'An item' : `${a.qty} counted`
    if (!(await getProject(ctx.tx, a.projectId)))
      throw new Refused({ code: 'not-found', message: `${what} was scanned ${way} for a job that was never saved, so the scan wasn't kept. Scan it again on the job.` })
    // An item's product is the one it has now, whatever the phone thought.
    const modelId = asset?.modelId ?? a.modelId
    if (!(await getModel(ctx.tx, modelId)))
      throw new Refused({ code: 'not-found', message: `${what} was counted ${way} as a product no longer in the stock list, so it wasn't kept.` })
    await ctx.tx.query(
      `INSERT INTO movements (id, project_id, direction, asset_id, model_id, qty, at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [a.id, a.projectId, a.direction, a.assetId, modelId, a.qty, a.at]
    )
    await emit(ctx, 'movement', a.id, await getMovement(ctx.tx, a.id))
  },
}
