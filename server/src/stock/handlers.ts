import { MAX_CASE_DEPTH, MAX_NUMBER, MAX_QTY, newId, normaliseNumber, plural, stockId, type CommandArgs, type Where } from '@sh/shared'
import { emit, emitRemoved, Refused, type Ctx } from '../kernel.ts'
import { jobsWithKit } from './kit.ts'
import { movementsOf } from './moves.ts'
import {
  atPlace,
  caseChain,
  casesInUse,
  contentsOf,
  getAsset,
  getModel,
  getPlace,
  getStock,
  levelsIn,
  nameTaken,
  nextNumber,
  numberUse,
  usesOf,
} from './store.ts'

/**
 * The warehouse rules the server keeps, whichever device a change comes
 * from (ADR 0013):
 *
 * - a number is used once, ever: a new label retires the old number;
 * - no two products, or two places, have the same name;
 * - a case can't go inside itself or anything it holds, or more than five deep;
 * - no moving more of a count than is there;
 * - a product with items or counts, a place with anything at it, and a
 *   case with anything in it can't be removed or retired, nor a product
 *   on a job's kit (ADR 0014).
 */

type StockCommand =
  | 'model.create'
  | 'model.update'
  | 'model.remove'
  | 'place.upsert'
  | 'place.remove'
  | 'asset.add'
  | 'asset.update'
  | 'asset.move'
  | 'asset.relabel'
  | 'asset.retire'
  | 'asset.reinstate'
  | 'stock.set'
  | 'stock.move'
type Handler<N extends StockCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

const MODEL_COLUMNS = {
  name: 'name',
  department: 'department',
  category: 'category',
  tracking: 'tracking',
  isCase: 'is_case',
  valueCents: 'value_cents',
  notes: 'notes',
} as const

const described = async (ctx: Ctx, assetId: string) => {
  const a = await getAsset(ctx.tx, assetId)
  const m = a && (await getModel(ctx.tx, a.modelId))
  return a ? `${a.number || 'That item'}${m ? ` (${m.name})` : ''}` : 'That item'
}

async function mustModel(ctx: Ctx, id: string, lock = false) {
  const m = await getModel(ctx.tx, id, lock)
  if (!m) throw new Refused({ code: 'not-found', message: 'That product no longer exists.' })
  return m
}

async function mustAsset(ctx: Ctx, id: string) {
  const a = await getAsset(ctx.tx, id)
  if (!a) throw new Refused({ code: 'not-found', message: 'That item no longer exists.' })
  return a
}

async function mustActive(ctx: Ctx, id: string) {
  const a = await mustAsset(ctx, id)
  if (a.status !== 'active') throw new Refused({ code: 'conflict', message: `${await described(ctx, id)} is retired. Bring it back first.` })
  return a
}

/** A number as a person typed or scanned it, checked, or the next free one, which is never one set aside for printing (ADR 0015). */
async function numberFor(ctx: Ctx, typed: string | null): Promise<string> {
  if (typed === null) {
    const n = await nextNumber(ctx.tx)
    if (n > MAX_NUMBER)
      throw new Refused({ code: 'conflict', message: 'Every six-digit number has been used or set aside for printing. Use the number on a printed label.' })
    return `SH-${String(n).padStart(6, '0')}`
  }
  const number = normaliseNumber(typed)
  if (!number) throw new Refused({ code: 'invalid', message: `“${typed.trim()}” isn't a Session Hire number: they're SH- and six digits, such as SH-000123.` })
  const used = await numberUse(ctx.tx, number)
  if (used) {
    const other = await getAsset(ctx.tx, used.assetId)
    const what = (other && (await getModel(ctx.tx, other.modelId))?.name) ?? 'another item'
    throw new Refused({
      code: 'conflict',
      message: used.current
        ? `${number} is already in use (${what}).`
        : `${number} was used before (${what}${other?.number ? `, now ${other.number}` : ''}), and a number is never used twice. Use another label.`,
    })
  }
  return number
}

async function attachNumber(ctx: Ctx, assetId: string, number: string) {
  await ctx.tx.query(`INSERT INTO identifiers (id, asset_id, kind, value) VALUES ($1, $2, 'sh', $3)`, [newId(), assetId, number])
}

/**
 * Check a place or case can take something: the place exists, or the case
 * is a case in stock, the thing isn't going inside itself, and it won't
 * end up more than five cases deep.
 */
async function checkWhere(ctx: Ctx, w: Where, moving?: { id: string; levels: number }) {
  if (w.placeId && !(await getPlace(ctx.tx, w.placeId))) throw new Refused({ code: 'not-found', message: 'That place no longer exists.' })
  if (!w.caseId) return
  const c = await getAsset(ctx.tx, w.caseId)
  const m = c && (await getModel(ctx.tx, c.modelId))
  if (!c || !m) throw new Refused({ code: 'not-found', message: 'That case no longer exists.' })
  if (!m.isCase) throw new Refused({ code: 'conflict', message: `${c.number} (${m.name}) doesn't hold other kit.` })
  if (c.status !== 'active') throw new Refused({ code: 'conflict', message: `${c.number} is retired, so nothing can go in it.` })
  const chain = await caseChain(ctx.tx, w.caseId)
  if (moving && chain.includes(moving.id)) {
    throw new Refused({
      code: 'conflict',
      message: `${c.number} is ${c.id === moving.id ? 'that case itself' : 'inside it'}, and nothing can go inside itself.`,
    })
  }
  if (chain.length + (moving?.levels ?? 1) > MAX_CASE_DEPTH) {
    throw new Refused({ code: 'conflict', message: `That would put kit more than ${MAX_CASE_DEPTH} cases deep. Take something out of a case first.` })
  }
}

/** The name of a place, or a case's number, for reasons. */
async function whereName(ctx: Ctx, w: Where) {
  if (w.placeId) return (await getPlace(ctx.tx, w.placeId))?.name ?? 'there'
  return (await getAsset(ctx.tx, w.caseId!))?.number || 'that case'
}

/** Change a count by `by`, or to `to`. None left takes the count away. */
async function adjust(ctx: Ctx, modelId: string, w: Where, change: { by: number } | { to: number }) {
  const id = stockId(modelId, w)
  const now = (await getStock(ctx.tx, id))?.qty ?? 0
  const qty = 'to' in change ? change.to : now + change.by
  if (qty > MAX_QTY) throw new Refused({ code: 'invalid', message: `That's more than ${MAX_QTY.toLocaleString('en-IE')} in one place.` })
  if (qty === now) return
  if (qty <= 0) {
    await ctx.tx.query('DELETE FROM stock WHERE id = $1', [id])
    await emitRemoved(ctx, 'stock', id)
    return
  }
  await ctx.tx.query(
    `INSERT INTO stock (id, model_id, place_id, case_id, qty) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET qty = EXCLUDED.qty`,
    [id, modelId, w.placeId, w.caseId, qty]
  )
  await emit(ctx, 'stock', id, await getStock(ctx.tx, id))
}

async function emitAsset(ctx: Ctx, id: string) {
  await emit(ctx, 'asset', id, await getAsset(ctx.tx, id))
}

export const stockHandlers: { [N in StockCommand]: Handler<N> } = {
  async 'model.create'(ctx, a) {
    if (await getModel(ctx.tx, a.id)) throw new Refused({ code: 'conflict', message: 'This product already exists.' })
    const taken = await nameTaken(ctx.tx, 'models', a.name.trim(), a.id)
    if (taken) throw new Refused({ code: 'conflict', message: `There's already a product called ${taken}.` })
    await ctx.tx.query(`INSERT INTO models (id, name, department, category, tracking, is_case, value_cents, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
      a.id,
      a.name.trim(),
      a.department,
      a.category.trim(),
      a.tracking,
      a.isCase,
      a.valueCents,
      a.notes,
    ])
    await emit(ctx, 'model', a.id, await getModel(ctx.tx, a.id))
  },

  async 'model.update'(ctx, a) {
    const m = await mustModel(ctx, a.id, true)
    const next = { ...m, ...Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)) }
    if (a.name !== undefined) {
      next.name = a.name.trim()
      const taken = await nameTaken(ctx.tx, 'models', next.name, a.id)
      if (taken) throw new Refused({ code: 'conflict', message: `There's already a product called ${taken}.` })
    }
    if (next.isCase && next.tracking === 'bulk') throw new Refused({ code: 'invalid', message: 'A case has its own number, so it is numbered, not counted.' })
    if (next.tracking === 'bulk' && m.tracking !== 'bulk') {
      const { active } = await usesOf(ctx.tx, a.id)
      if (active > 0)
        throw new Refused({ code: 'conflict', message: `${m.name} has ${plural(active, 'numbered item')}, so it can't be counted only. Retire them first.` })
    }
    if (!next.isCase && m.isCase) {
      const holding = await casesInUse(ctx.tx, a.id)
      if (holding > 0)
        throw new Refused({
          code: 'conflict',
          message: `${plural(holding, 'case')} of ${m.name} ${holding === 1 ? 'has' : 'have'} kit in ${holding === 1 ? 'it' : 'them'}. Empty them first.`,
        })
    }
    const fields = (Object.keys(MODEL_COLUMNS) as (keyof typeof MODEL_COLUMNS)[]).filter((k) => a[k] !== undefined)
    await ctx.tx.query(`UPDATE models SET ${fields.map((k, i) => `${MODEL_COLUMNS[k]} = $${i + 2}`).join(', ')} WHERE id = $1`, [
      a.id,
      ...fields.map((k) => (k === 'name' || k === 'category' ? String(a[k]).trim() : a[k])),
    ])
    await emit(ctx, 'model', a.id, await getModel(ctx.tx, a.id))
  },

  async 'model.remove'(ctx, a) {
    const m = await mustModel(ctx, a.id, true)
    const uses = await usesOf(ctx.tx, a.id)
    if (uses.items > 0)
      throw new Refused({ code: 'conflict', message: `${m.name} has numbered items, which are kept for their history, so it can't be removed.` })
    if (uses.counted > 0) throw new Refused({ code: 'conflict', message: `${m.name} still has ${uses.counted} counted. Count them as none first.` })
    const jobs = await jobsWithKit(ctx.tx, a.id)
    if (jobs.length)
      throw new Refused({
        code: 'conflict',
        message: `${m.name} is on the kit for ${jobs.length === 1 ? jobs[0] : `${jobs.length} jobs (${jobs.slice(0, 3).join(', ')}${jobs.length > 3 ? '…' : ''})`}. Take it off ${jobs.length === 1 ? 'that job' : 'those'} first.`,
      })
    if ((await movementsOf(ctx.tx, a.id)) > 0)
      throw new Refused({ code: 'conflict', message: `${m.name} has been out on jobs, which is kept for the record, so it can't be removed.` })
    await ctx.tx.query('DELETE FROM models WHERE id = $1', [a.id])
    await emitRemoved(ctx, 'model', a.id)
  },

  async 'place.upsert'(ctx, a) {
    const taken = await nameTaken(ctx.tx, 'places', a.name.trim(), a.id)
    if (taken) throw new Refused({ code: 'conflict', message: `There's already a place called ${taken}.` })
    await ctx.tx.query(
      `INSERT INTO places (id, name, notes) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, notes = EXCLUDED.notes`,
      [a.id, a.name.trim(), a.notes]
    )
    await emit(ctx, 'place', a.id, await getPlace(ctx.tx, a.id))
  },

  async 'place.remove'(ctx, a) {
    const p = await getPlace(ctx.tx, a.id)
    if (!p) throw new Refused({ code: 'not-found', message: 'That place no longer exists.' })
    const here = await atPlace(ctx.tx, a.id)
    if (here.items > 0 || here.counted > 0) {
      const what = [here.items > 0 && plural(here.items, 'item'), here.counted > 0 && `${here.counted} counted`].filter(Boolean).join(' and ')
      throw new Refused({ code: 'conflict', message: `${p.name} still has ${what}. Move them first.` })
    }
    await ctx.tx.query('DELETE FROM places WHERE id = $1', [a.id])
    await emitRemoved(ctx, 'place', a.id)
  },

  async 'asset.add'(ctx, a) {
    if (await getAsset(ctx.tx, a.id)) throw new Refused({ code: 'conflict', message: 'This item already exists.' })
    const m = await mustModel(ctx, a.modelId)
    if (m.tracking !== 'serialised')
      throw new Refused({ code: 'conflict', message: `${m.name} is counted, not numbered. Change it to numbered to label them one by one.` })
    await checkWhere(ctx, a)
    const number = await numberFor(ctx, a.number)
    await ctx.tx.query(`INSERT INTO assets (id, model_id, serial, place_id, case_id, status, notes) VALUES ($1, $2, $3, $4, $5, 'active', $6)`, [
      a.id,
      a.modelId,
      a.serial.trim(),
      a.placeId,
      a.caseId,
      a.notes,
    ])
    await attachNumber(ctx, a.id, number)
    // Labelling one that was counted: the count goes down as the items go up.
    if (a.fromCount && (a.placeId || a.caseId) && (await getStock(ctx.tx, stockId(a.modelId, a)))) await adjust(ctx, a.modelId, a, { by: -1 })
    await emitAsset(ctx, a.id)
  },

  async 'asset.update'(ctx, a) {
    const asset = await mustAsset(ctx, a.id)
    if (a.modelId !== undefined && a.modelId !== asset.modelId) {
      const m = await mustModel(ctx, a.modelId)
      if (m.tracking !== 'serialised') throw new Refused({ code: 'conflict', message: `${m.name} is counted, not numbered, so an item can't be one.` })
      const inside = await contentsOf(ctx.tx, a.id)
      if (!m.isCase && (inside.items > 0 || inside.counted > 0)) {
        throw new Refused({ code: 'conflict', message: `${asset.number} has kit in it, and ${m.name} doesn't hold other kit. Empty it first.` })
      }
    }
    const sets: string[] = []
    const values: unknown[] = [a.id]
    const set = (column: string, value: unknown) => sets.push(`${column} = $${values.push(value)}`)
    if (a.modelId !== undefined) set('model_id', a.modelId)
    if (a.serial !== undefined) set('serial', a.serial.trim())
    if (a.notes !== undefined) set('notes', a.notes)
    await ctx.tx.query(`UPDATE assets SET ${sets.join(', ')} WHERE id = $1`, values)
    await emitAsset(ctx, a.id)
  },

  async 'asset.move'(ctx, a) {
    const asset = await mustActive(ctx, a.id)
    if (asset.placeId === a.placeId && asset.caseId === a.caseId) return
    await checkWhere(ctx, a, { id: a.id, levels: await levelsIn(ctx.tx, a.id) })
    await ctx.tx.query('UPDATE assets SET place_id = $2, case_id = $3 WHERE id = $1', [a.id, a.placeId, a.caseId])
    await emitAsset(ctx, a.id)
  },

  async 'asset.relabel'(ctx, a) {
    await mustActive(ctx, a.id)
    const number = await numberFor(ctx, a.number)
    await ctx.tx.query(`UPDATE identifiers SET retired_at = clock_timestamp() WHERE asset_id = $1 AND kind = 'sh' AND retired_at IS NULL`, [a.id])
    await attachNumber(ctx, a.id, number)
    await emitAsset(ctx, a.id)
  },

  async 'asset.retire'(ctx, a) {
    const asset = await mustActive(ctx, a.id)
    const inside = await contentsOf(ctx.tx, a.id)
    if (inside.items > 0 || inside.counted > 0) {
      const what = [inside.items > 0 && plural(inside.items, 'item'), inside.counted > 0 && `${inside.counted} counted`].filter(Boolean).join(' and ')
      throw new Refused({ code: 'conflict', message: `${asset.number} still holds ${what}. Empty it first.` })
    }
    await ctx.tx.query(`UPDATE assets SET status = 'retired', retired_reason = $2, retired_note = $3, place_id = NULL, case_id = NULL WHERE id = $1`, [
      a.id,
      a.reason,
      a.note.trim() || null,
    ])
    await emitAsset(ctx, a.id)
  },

  async 'asset.reinstate'(ctx, a) {
    const asset = await mustAsset(ctx, a.id)
    if (asset.status === 'active') return
    await ctx.tx.query(`UPDATE assets SET status = 'active', retired_reason = NULL, retired_note = NULL WHERE id = $1`, [a.id])
    await emitAsset(ctx, a.id)
  },

  async 'stock.set'(ctx, a) {
    await mustModel(ctx, a.modelId)
    if (a.qty > 0) await checkWhere(ctx, a)
    await adjust(ctx, a.modelId, a, { to: a.qty })
  },

  async 'stock.move'(ctx, a) {
    const m = await mustModel(ctx, a.modelId)
    const from = { placeId: a.fromPlaceId, caseId: a.fromCaseId }
    const to = { placeId: a.toPlaceId, caseId: a.toCaseId }
    const there = (await getStock(ctx.tx, stockId(a.modelId, from)))?.qty ?? 0
    if (there < a.qty) {
      throw new Refused({
        code: 'short',
        short: a.qty - there,
        message: `Only ${there} × ${m.name} counted at ${await whereName(ctx, from)}, not ${a.qty}. Count them again first.`,
      })
    }
    await checkWhere(ctx, to)
    await adjust(ctx, a.modelId, from, { by: -a.qty })
    await adjust(ctx, a.modelId, to, { by: a.qty })
  },
}
