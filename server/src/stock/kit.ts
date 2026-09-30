import type { CommandArgs, KitLine } from '@sh/shared'
import type { Queryable } from '../db.ts'
import { emit, emitRemoved, Refused, type Ctx } from '../kernel.ts'
import { getPhase, getProject } from '../projects/store.ts'
import { getModel } from './store.ts'

/**
 * Kit on jobs (ADR 0014): the rules the server keeps, whichever device a
 * change comes from. Being short isn't one of them: each device works out
 * what's short and shows it (shared/src/sync/kit-view.ts), since the stock
 * list may not be counted yet and the shortfall may be about to be
 * subhired.
 *
 * - the job, the phase (of that job) and the product must exist;
 * - no more subhired than the line needs, checked as the line will be;
 * - a phase with kit on it can't be removed, and a product on a job's kit
 *   can't be taken out of the stock list (in their own handlers).
 */

const KIT = `id, project_id, phase_id, model_id, qty, subhire_qty, supplier, notes`

type Row = Record<string, any>

export const toKitLine = (r: Row): KitLine => ({
  id: r.id,
  projectId: r.project_id,
  phaseId: r.phase_id,
  modelId: r.model_id,
  qty: r.qty,
  subhireQty: r.subhire_qty,
  supplier: r.supplier,
  notes: r.notes,
})

export async function getKitLine(q: Queryable, id: string, lock = false) {
  const { rows } = await q.query(`SELECT ${KIT} FROM kit_lines WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])
  return rows[0] ? toKitLine(rows[0]) : undefined
}

/** The kit on a phase, as "4 × d&b Y10P", by product. */
export async function kitOnPhase(q: Queryable, phaseId: string): Promise<string[]> {
  const { rows } = await q.query<{ qty: number; name: string }>(
    `SELECT k.qty, m.name FROM kit_lines k JOIN models m ON m.id = k.model_id WHERE k.phase_id = $1 ORDER BY m.name, k.id`,
    [phaseId]
  )
  return rows.map((r) => `${r.qty} × ${r.name}`)
}

/** The jobs with a product on their kit, by name. */
export async function jobsWithKit(q: Queryable, modelId: string): Promise<string[]> {
  const { rows } = await q.query<{ name: string }>(
    `SELECT DISTINCT p.name FROM kit_lines k JOIN projects p ON p.id = k.project_id WHERE k.model_id = $1 ORDER BY p.name`,
    [modelId]
  )
  return rows.map((r) => r.name)
}

type KitCommand = 'kit.add' | 'kit.update' | 'kit.remove'
type Handler<N extends KitCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

/** The columns each field of a line is kept in. */
const COLUMNS = { phaseId: 'phase_id', modelId: 'model_id', qty: 'qty', subhireQty: 'subhire_qty', supplier: 'supplier', notes: 'notes' } as const

async function checkPhase(ctx: Ctx, projectId: string, phaseId: string | null) {
  if (!phaseId) return
  const phase = await getPhase(ctx.tx, phaseId)
  if (!phase) throw new Refused({ code: 'not-found', message: 'That phase no longer exists. Put the kit on the whole job or another phase.' })
  if (phase.projectId !== projectId) throw new Refused({ code: 'invalid', message: `${phase.name} is part of another job.` })
}

async function mustModel(ctx: Ctx, modelId: string) {
  const m = await getModel(ctx.tx, modelId)
  if (!m) throw new Refused({ code: 'not-found', message: 'That product is no longer in the stock list.' })
  return m
}

export const kitHandlers: { [N in KitCommand]: Handler<N> } = {
  async 'kit.add'(ctx, a) {
    if (await getKitLine(ctx.tx, a.id)) throw new Refused({ code: 'conflict', message: 'This kit is already on the job.' })
    if (!(await getProject(ctx.tx, a.projectId))) throw new Refused({ code: 'not-found', message: 'That job no longer exists.' })
    await checkPhase(ctx, a.projectId, a.phaseId)
    await mustModel(ctx, a.modelId)
    await ctx.tx.query(
      `INSERT INTO kit_lines (id, project_id, phase_id, model_id, qty, subhire_qty, supplier, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [a.id, a.projectId, a.phaseId, a.modelId, a.qty, a.subhireQty, a.supplier.trim(), a.notes.trim()]
    )
    await emit(ctx, 'kitLine', a.id, await getKitLine(ctx.tx, a.id))
  },

  async 'kit.update'(ctx, a) {
    const before = await getKitLine(ctx.tx, a.id, true)
    if (!before) throw new Refused({ code: 'not-found', message: 'That kit is no longer on the job.' })
    if (a.phaseId !== undefined) await checkPhase(ctx, before.projectId, a.phaseId)
    const m = await mustModel(ctx, a.modelId ?? before.modelId)
    // Someone else may have changed how many while this person changed how many are subhired, so check the line as it will be.
    const qty = a.qty ?? before.qty
    const subhired = a.subhireQty ?? before.subhireQty
    if (subhired > qty) throw new Refused({ code: 'invalid', message: `The job needs ${qty} × ${m.name} now, so no more than ${qty} can be subhired.` })
    const changes: Record<string, unknown> = { ...a, supplier: a.supplier?.trim(), notes: a.notes?.trim() }
    const fields = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).filter((k) => changes[k] !== undefined)
    await ctx.tx.query(`UPDATE kit_lines SET ${fields.map((k, i) => `${COLUMNS[k]} = $${i + 2}`).join(', ')} WHERE id = $1`, [
      a.id,
      ...fields.map((k) => changes[k]),
    ])
    await emit(ctx, 'kitLine', a.id, await getKitLine(ctx.tx, a.id))
  },

  async 'kit.remove'(ctx, a) {
    if (!(await getKitLine(ctx.tx, a.id))) return
    await ctx.tx.query('DELETE FROM kit_lines WHERE id = $1', [a.id])
    await emitRemoved(ctx, 'kitLine', a.id)
  },
}
