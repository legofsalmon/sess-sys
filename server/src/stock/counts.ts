import type { CommandArgs, Count } from '@sh/shared'
import { getPerson, personByEmail } from '../crew/store.ts'
import type { Queryable } from '../db.ts'
import { emit, Refused, type Ctx } from '../kernel.ts'
import { getAsset, getModel } from './store.ts'

/**
 * Counts (ADR 0030). A count says what was on the shelf at a moment, so
 * it's kept whatever has changed since, as a scan is: only one of a place
 * or case that never existed (an item whose product never was a case among
 * them) is turned down, and the answer says which.
 * What it found is put right by the commands that already exist, sent
 * from the count's page, each with its own rules.
 */

type Row = Record<string, any>

const iso = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

const toCount = (r: Row): Count => ({
  id: r.id,
  placeId: r.place_id,
  caseId: r.case_id,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  by: r.counted_by,
  items: r.items,
  unknown: r.unknown,
  products: r.products,
  summary: r.summary,
})

export async function getCount(q: Queryable, id: string) {
  const { rows } = await q.query(
    `SELECT id, place_id, case_id, ${iso('started_at')} AS started_at, ${iso('finished_at')} AS finished_at, counted_by, items, unknown, products, summary
       FROM counts WHERE id = $1`,
    [id]
  )
  return rows[0] ? toCount(rows[0]) : undefined
}

/** A place that is, or ever was, in the stock list: one removed since keeps its counts. */
async function placeEverSaved(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT 1 FROM places WHERE id = $1 UNION ALL SELECT 1 FROM changes WHERE entity = 'place' AND entity_id = $1 LIMIT 1`, [id])
  return rows.length > 0
}

/** An item whose product is, or ever was, a case: one emptied and made plain since keeps its counts. */
async function caseEverSaved(q: Queryable, id: string) {
  const { rows } = await q.query(
    `SELECT 1 FROM assets a JOIN models m ON m.id = a.model_id
      WHERE a.id = $1 AND (m.is_case OR EXISTS (SELECT 1 FROM changes c WHERE c.entity = 'model' AND c.entity_id = m.id AND c.data->>'isCase' = 'true'))`,
    [id]
  )
  return rows.length > 0
}

/**
 * Who counted: the signed-in person, matched by email as leave is
 * (ADR 0024), or whoever the phone says while sign-in is off. Someone not
 * on the Crew tab, or erased on request since (ADR 0027), is left out:
 * the count is kept all the same, and nothing new is put on record about them.
 */
async function counter(ctx: Ctx, by: string | null): Promise<string | null> {
  const person = ctx.user ? await personByEmail(ctx.tx, ctx.user.email) : by ? await getPerson(ctx.tx, by) : undefined
  if (!person) return null
  const { rows } = await ctx.tx.query(`SELECT 1 FROM erasures WHERE person_id = $1`, [person.id])
  return rows.length ? null : person.id
}

type CountCommand = 'count.record'
type Handler<N extends CountCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

export const countHandlers: { [N in CountCommand]: Handler<N> } = {
  async 'count.record'(ctx, a) {
    // Sent twice by the same phone: it's kept already.
    if (await getCount(ctx.tx, a.id)) return
    if (a.placeId && !(await placeEverSaved(ctx.tx, a.placeId)))
      throw new Refused({ code: 'not-found', message: "The place counted was never saved, so the count wasn't kept. Count it again from the place's page." })
    if (a.caseId) {
      const c = await getAsset(ctx.tx, a.caseId)
      if (!c) throw new Refused({ code: 'not-found', message: "The case counted was never added to the stock list, so the count wasn't kept. Add it, then count it again." })
      // A product made a case on a phone and turned down by the server: the case never existed.
      if (!(await caseEverSaved(ctx.tx, c.id))) {
        const m = await getModel(ctx.tx, c.modelId)
        throw new Refused({ code: 'conflict', message: `${c.number || 'That item'}${m ? ` (${m.name})` : ''} doesn't hold other kit, so the count wasn't kept.` })
      }
    }
    // A phone whose clock runs ahead would leave its place counted "this week" for good, so no count is kept as later than
    // it reached the server. One sent late, after a day without signal, keeps its own time.
    await ctx.tx.query(
      `INSERT INTO counts (id, place_id, case_id, started_at, finished_at, counted_by, items, unknown, products, summary)
       VALUES ($1, $2, $3, LEAST($4::timestamptz, $5::timestamptz, now()), LEAST($5::timestamptz, now()), $6, $7, $8, $9, $10)`,
      [
        a.id,
        a.placeId,
        a.caseId,
        a.startedAt,
        a.finishedAt,
        await counter(ctx, a.by),
        JSON.stringify(a.items),
        JSON.stringify(a.unknown),
        JSON.stringify(a.products),
        JSON.stringify(a.summary),
      ]
    )
    await emit(ctx, 'count', a.id, await getCount(ctx.tx, a.id))
  },
}
