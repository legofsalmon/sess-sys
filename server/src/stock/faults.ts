import { OUTCOME_LABELS, OUTCOMES_FOR, RETIRED_LABELS, type CommandArgs, type Fault } from '@sh/shared'
import type { Queryable } from '../db.ts'
import { emit, Refused, type Ctx } from '../kernel.ts'
import { getProject } from '../projects/store.ts'
import { adjust, retireItem } from './handlers.ts'
import { getAsset, getModel, whereOf } from './store.ts'

/**
 * Faults and missing kit (ADR 0018). A report records something that
 * already happened, so it's kept whatever the plan says, as a scan is;
 * only one naming an item, product or job that was never saved, an item
 * already retired, or a product added by mistake, is turned down, and the
 * answer says why. Closing one decides how it ended: writing off retires
 * an item (scrapped, or lost) or takes counted kit off the count, in the
 * same change.
 */

type Row = Record<string, any>

const toFault = (r: Row): Fault => ({
  id: r.id,
  kind: r.kind,
  assetId: r.asset_id,
  modelId: r.model_id,
  qty: r.qty,
  projectId: r.project_id,
  usable: r.usable,
  note: r.note,
  repair: r.repair,
  at: r.at,
  outcome: r.outcome,
  closedAt: r.closed_at,
})

const iso = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

async function getFault(q: Queryable, id: string, lock = false) {
  const { rows } = await q.query(
    `SELECT id, kind, asset_id, model_id, qty, project_id, usable, note, repair, ${iso('at')} AS at, outcome, ${iso('closed_at')} AS closed_at
       FROM faults WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [id]
  )
  return rows[0] ? toFault(rows[0]) : undefined
}

/** How many faults a product has had, which keeps it in the stock list. */
export async function faultsOf(q: Queryable, modelId: string): Promise<number> {
  const { rows } = await q.query<{ n: string }>('SELECT count(*) AS n FROM faults WHERE model_id = $1', [modelId])
  return Number(rows[0]!.n)
}

async function mustFault(ctx: Ctx, id: string, lock = false) {
  const f = await getFault(ctx.tx, id, lock)
  if (!f) throw new Refused({ code: 'not-found', message: 'That fault was never saved.' })
  return f
}

/** "SH-000123", or "3 × XLR 10m". */
async function whatOf(ctx: Ctx, f: Pick<Fault, 'assetId' | 'modelId' | 'qty'>) {
  if (f.assetId) return (await getAsset(ctx.tx, f.assetId))?.number || 'That item'
  return `${f.qty} × ${(await getModel(ctx.tx, f.modelId))?.name ?? 'that product'}`
}

/** Take counted kit off the count, from the biggest counts first, as far as there are any. */
async function writeOffCounted(ctx: Ctx, modelId: string, qty: number) {
  const { rows } = await ctx.tx.query<{ place_id: string | null; case_id: string | null; qty: number }>(
    'SELECT place_id, case_id, qty FROM stock WHERE model_id = $1 ORDER BY qty DESC, id FOR UPDATE',
    [modelId]
  )
  let left = qty
  for (const r of rows) {
    if (left <= 0) break
    const take = Math.min(left, r.qty)
    await adjust(ctx, modelId, whereOf({ placeId: r.place_id, caseId: r.case_id }), { by: -take })
    left -= take
  }
}

type FaultCommand = 'fault.report' | 'fault.update' | 'fault.close'
type Handler<N extends FaultCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

export const faultHandlers: { [N in FaultCommand]: Handler<N> } = {
  async 'fault.report'(ctx, a) {
    // Sent twice by the same phone: it's kept already.
    if (await getFault(ctx.tx, a.id)) return
    const asset = a.assetId ? await getAsset(ctx.tx, a.assetId) : undefined
    if (a.assetId && !asset)
      throw new Refused({ code: 'not-found', message: 'An item reported was never added to the stock list, so the report wasn\'t kept. Add the item, then report it again.' })
    if (asset && asset.status !== 'active') {
      const why = asset.retiredReason ? RETIRED_LABELS[asset.retiredReason].toLowerCase() : 'retired'
      throw new Refused({
        code: 'conflict',
        message: `${asset.number || 'That item'} is marked as ${why}, so the report wasn't kept. Bring it back first if it's still here.`,
      })
    }
    // An item's product is the one it has now, whatever the phone thought.
    const modelId = asset?.modelId ?? a.modelId
    const m = await getModel(ctx.tx, modelId)
    if (!m) throw new Refused({ code: 'not-found', message: 'The product reported is no longer in the stock list, so the report wasn\'t kept.' })
    // Kept for the history only (audit finding 19): nothing more happens to it.
    if (m.mistake) throw new Refused({ code: 'conflict', message: `${m.name} was added by mistake, so the report wasn't kept.` })
    if (a.projectId && !(await getProject(ctx.tx, a.projectId)))
      throw new Refused({
        code: 'not-found',
        message: `${await whatOf(ctx, { ...a, modelId })} was reported for a job that was never saved, so the report wasn't kept. Report it again on the job.`,
      })
    await ctx.tx.query(
      `INSERT INTO faults (id, kind, asset_id, model_id, qty, project_id, usable, note, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [a.id, a.kind, a.assetId, modelId, a.qty, a.projectId, a.kind === 'damaged' && a.usable, a.note.trim(), a.at]
    )
    await emit(ctx, 'fault', a.id, await getFault(ctx.tx, a.id))
  },

  async 'fault.update'(ctx, a) {
    const f = await mustFault(ctx, a.id, true)
    if (a.usable && f.kind === 'missing') throw new Refused({ code: 'invalid', message: "Missing kit can't go out until it's found." })
    const sets: string[] = []
    const values: unknown[] = [a.id]
    const set = (col: string, v: unknown) => {
      values.push(v)
      sets.push(`${col} = $${values.length}`)
    }
    if (a.usable !== undefined) set('usable', a.usable)
    if (a.note !== undefined) set('note', a.note.trim())
    if (a.repair !== undefined) set('repair', a.repair.trim())
    await ctx.tx.query(`UPDATE faults SET ${sets.join(', ')} WHERE id = $1`, values)
    await emit(ctx, 'fault', a.id, await getFault(ctx.tx, a.id))
  },

  async 'fault.close'(ctx, a) {
    const f = await mustFault(ctx, a.id, true)
    if (f.outcome === a.outcome) return
    if (f.outcome)
      throw new Refused({
        code: 'conflict',
        message: `${await whatOf(ctx, f)}: that fault was already closed as ${OUTCOME_LABELS[f.outcome].toLowerCase()}.`,
      })
    if (!OUTCOMES_FOR[f.kind].includes(a.outcome))
      throw new Refused({
        code: 'invalid',
        message: `${f.kind === 'missing' ? 'Missing kit is found or written off' : 'Damaged kit is fixed, not faulty, or written off'}, not ${OUTCOME_LABELS[a.outcome].toLowerCase()}.`,
      })
    if (a.outcome === 'written-off') {
      if (f.assetId) {
        const asset = await getAsset(ctx.tx, f.assetId)
        if (asset?.status === 'active') await retireItem(ctx, f.assetId, f.kind === 'missing' ? 'lost' : 'scrapped', f.note)
      } else {
        await writeOffCounted(ctx, f.modelId, f.qty)
      }
    }
    await ctx.tx.query('UPDATE faults SET outcome = $2, closed_at = $3 WHERE id = $1', [a.id, a.outcome, a.at])
    await emit(ctx, 'fault', a.id, await getFault(ctx.tx, a.id))
  },
}
