import { MAX_CASE_DEPTH, type CommandArgs, type Movement } from '@sh/shared'
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

/**
 * What of a product is out with a job now, by the same rules a device's
 * pick lists use (sync/pick-view.ts), so the server never turns down what
 * the phone shows as back: an item is out when the latest scan of it, or
 * of a case it's in, was out, and a report of it missing from a job ends
 * its time out as a scan back would; counted kit is out while more went
 * out with a job than came back or was reported missing. Nothing when
 * it's all in.
 */
export async function outWithJobs(q: Queryable, modelId: string): Promise<{ what: string; job: string }[]> {
  const { rows: items } = await q.query<{ number: string | null; job: string }>(
    `WITH RECURSIVE holders AS (
       SELECT a.id AS item, a.id AS holder, 0 AS depth FROM assets a WHERE a.model_id = $1 AND a.status = 'active'
       UNION ALL
       SELECT h.item, c.case_id, h.depth + 1 FROM holders h JOIN assets c ON c.id = h.holder
        WHERE c.case_id IS NOT NULL AND h.depth < ${MAX_CASE_DEPTH}
     ),
     events AS (
       SELECT asset_id, project_id, direction, at, id FROM movements WHERE asset_id IN (SELECT holder FROM holders)
       UNION ALL
       SELECT asset_id, project_id, 'in', at, id FROM faults
        WHERE kind = 'missing' AND project_id IS NOT NULL AND asset_id IN (SELECT holder FROM holders)
     ),
     latest AS (
       SELECT DISTINCT ON (h.item) h.item, e.direction, e.project_id
         FROM holders h JOIN events e ON e.asset_id = h.holder
        ORDER BY h.item, e.at DESC, e.id DESC
     )
     SELECT (SELECT i.value FROM identifiers i WHERE i.asset_id = l.item AND i.kind = 'sh' AND i.retired_at IS NULL) AS number, p.name AS job
       FROM latest l JOIN projects p ON p.id = l.project_id
      WHERE l.direction = 'out'
      ORDER BY number`,
    [modelId]
  )
  const { rows: counted } = await q.query<{ job: string; out: number }>(
    `SELECT p.name AS job, sum(t.n)::int AS out
       FROM (SELECT project_id, CASE WHEN direction = 'out' THEN qty ELSE -qty END AS n FROM movements WHERE model_id = $1 AND asset_id IS NULL
             UNION ALL
             SELECT project_id, -qty FROM faults WHERE model_id = $1 AND asset_id IS NULL AND kind = 'missing' AND project_id IS NOT NULL) t
       JOIN projects p ON p.id = t.project_id
      GROUP BY p.id, p.name HAVING sum(t.n) > 0
      ORDER BY p.name`,
    [modelId]
  )
  return [...items.map((r) => ({ what: r.number ?? 'an item', job: r.job })), ...counted.map((r) => ({ what: `${r.out.toLocaleString('en-IE')} counted`, job: r.job }))]
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
