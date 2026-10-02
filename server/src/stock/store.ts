import { MAX_CASE_DEPTH, type Asset, type LabelRun, type Model, type Place, type Stock, type Where } from '@sh/shared'
import type { Queryable } from '../db.ts'

/** Reading warehouse rows back as the records devices see (ADR 0013). */

const MODEL = `id, name, department, category, tracking, is_case, value_cents, notes, pat_months, lifting_months, mistake`
const PLACE = `id, name, notes`
const STOCK = `id, model_id, place_id, case_id, qty`
// An item with its current number and the ones it had before, oldest first.
const ASSET = `a.id, a.model_id, a.serial, a.place_id, a.case_id, a.status, a.retired_reason, a.retired_note, a.notes, a.old_number, a.pat_due::text AS pat_due,
  (SELECT i.value FROM identifiers i WHERE i.asset_id = a.id AND i.kind = 'sh' AND i.retired_at IS NULL) AS number,
  coalesce((SELECT json_agg(i.value ORDER BY i.retired_at, i.value) FROM identifiers i
             WHERE i.asset_id = a.id AND i.kind = 'sh' AND i.retired_at IS NOT NULL), '[]') AS former`

type Row = Record<string, any>

export const toModel = (r: Row): Model => ({
  id: r.id,
  name: r.name,
  department: r.department,
  category: r.category,
  tracking: r.tracking,
  isCase: r.is_case,
  valueCents: r.value_cents,
  notes: r.notes,
  patMonths: r.pat_months,
  liftingMonths: r.lifting_months,
  mistake: r.mistake,
})
export const toPlace = (r: Row): Place => ({ id: r.id, name: r.name, notes: r.notes })
export const toStock = (r: Row): Stock => ({ id: r.id, modelId: r.model_id, placeId: r.place_id, caseId: r.case_id, qty: r.qty })
export const toAsset = (r: Row): Asset => ({
  id: r.id,
  modelId: r.model_id,
  number: r.number ?? '',
  formerNumbers: r.former,
  serial: r.serial,
  oldNumber: r.old_number,
  patDue: r.pat_due,
  placeId: r.place_id,
  caseId: r.case_id,
  status: r.status,
  retiredReason: r.retired_reason,
  retiredNote: r.retired_note,
  notes: r.notes,
})

export async function getModel(q: Queryable, id: string, lock = false) {
  const { rows } = await q.query(`SELECT ${MODEL} FROM models WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])
  return rows[0] ? toModel(rows[0]) : undefined
}
export async function getPlace(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${PLACE} FROM places WHERE id = $1`, [id])
  return rows[0] ? toPlace(rows[0]) : undefined
}
export async function getAsset(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${ASSET} FROM assets a WHERE a.id = $1`, [id])
  return rows[0] ? toAsset(rows[0]) : undefined
}
export async function getStock(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${STOCK} FROM stock WHERE id = $1`, [id])
  return rows[0] ? toStock(rows[0]) : undefined
}

/** Another product or place already called this, whatever the capitals. A product added by mistake has given its name up. */
export async function nameTaken(q: Queryable, table: 'models' | 'places', name: string, except: string) {
  const { rows } = await q.query<{ name: string }>(
    `SELECT name FROM ${table} WHERE lower(name) = lower($1) AND id <> $2${table === 'models' ? ' AND NOT mistake' : ''}`,
    [name, except]
  )
  return rows[0]?.name
}

/** Every item, retired ones too: what the stock list's rows are matched against (ADR 0026). */
export async function everyAsset(q: Queryable) {
  const { rows } = await q.query(`SELECT ${ASSET} FROM assets a ORDER BY a.id`)
  return rows.map(toAsset)
}

/** Which other item has this old tag, whatever the capitals (ADR 0026). */
export async function oldNumberUse(q: Queryable, old: string, except: string) {
  const { rows } = await q.query<{ id: string }>(`SELECT id FROM assets WHERE lower(old_number) = lower($1) AND old_number <> '' AND id <> $2`, [old, except])
  return rows[0]?.id
}

/** Which item has had this number, now or before. */
export async function numberUse(q: Queryable, number: string) {
  const { rows } = await q.query<{ asset_id: string; current: boolean }>(
    `SELECT asset_id, retired_at IS NULL AS current FROM identifiers WHERE kind = 'sh' AND value = $1`,
    [number]
  )
  return rows[0] ? { assetId: rows[0].asset_id, current: rows[0].current } : undefined
}

/**
 * One more than the highest number ever used or set aside for printing
 * (ADR 0015), so none is given out twice and none lands on a label that
 * isn't stuck on yet: a cancelled run's numbers among them, since its
 * labels may be printed.
 */
export async function nextNumber(q: Queryable): Promise<number> {
  const { rows } = await q.query<{ n: number }>(
    `SELECT greatest((SELECT max(substr(value, 4)::int) FROM identifiers WHERE kind = 'sh'),
                     (SELECT max(first_number + count - 1) FROM label_runs),
                     0)::int + 1 AS n`
  )
  return rows[0]!.n
}

const LABEL_RUN = `id, first_number, count, name, notes, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  cancelled_at IS NOT NULL AS cancelled`

export const toLabelRun = (r: Row): LabelRun => ({
  id: r.id,
  first: r.first_number,
  count: r.count,
  name: r.name,
  notes: r.notes,
  createdAt: r.created_at,
  cancelled: r.cancelled,
})

export async function getLabelRun(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${LABEL_RUN} FROM label_runs WHERE id = $1`, [id])
  return rows[0] ? toLabelRun(rows[0]) : undefined
}

/** How many of a run's numbers are on items, or were before a new label replaced them. */
export async function runNumbersUsed(q: Queryable, run: Pick<LabelRun, 'first' | 'count'>): Promise<number> {
  if (run.first === null) return 0
  const { rows } = await q.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM identifiers WHERE kind = 'sh' AND substr(value, 4)::int BETWEEN $1 AND $2`,
    [run.first, run.first + run.count - 1]
  )
  return rows[0]!.n
}

/** The cases a case is in, starting with itself and working outwards. */
export async function caseChain(q: Queryable, caseId: string): Promise<string[]> {
  const { rows } = await q.query<{ id: string }>(
    `WITH RECURSIVE up(id, case_id, depth) AS (
       SELECT id, case_id, 1 FROM assets WHERE id = $1
       UNION ALL
       SELECT a.id, a.case_id, up.depth + 1 FROM assets a JOIN up ON a.id = up.case_id WHERE up.depth <= $2
     )
     SELECT id FROM up ORDER BY depth`,
    [caseId, MAX_CASE_DEPTH + 1]
  )
  return rows.map((r) => r.id)
}

/** How many cases deep an item goes: 1 for anything that isn't holding a case. */
export async function levelsIn(q: Queryable, assetId: string): Promise<number> {
  const { rows } = await q.query<{ levels: number }>(
    `WITH RECURSIVE down(id, depth) AS (
       SELECT id, 1 FROM assets WHERE id = $1
       UNION ALL
       SELECT a.id, down.depth + 1 FROM assets a JOIN down ON a.case_id = down.id WHERE a.status = 'active' AND down.depth <= $2
     )
     SELECT max(depth)::int AS levels FROM down`,
    [assetId, MAX_CASE_DEPTH + 1]
  )
  return rows[0]?.levels ?? 1
}

/** What's in a case, directly. */
export async function contentsOf(q: Queryable, caseId: string): Promise<{ items: number; counted: number }> {
  const { rows } = await q.query<{ items: number; counted: number }>(
    `SELECT (SELECT count(*)::int FROM assets WHERE case_id = $1 AND status = 'active') AS items,
            (SELECT coalesce(sum(qty), 0)::int FROM stock WHERE case_id = $1) AS counted`,
    [caseId]
  )
  return rows[0]!
}

/** What's at a place, directly. */
export async function atPlace(q: Queryable, placeId: string): Promise<{ items: number; counted: number }> {
  const { rows } = await q.query<{ items: number; counted: number }>(
    `SELECT (SELECT count(*)::int FROM assets WHERE place_id = $1 AND status = 'active') AS items,
            (SELECT coalesce(sum(qty), 0)::int FROM stock WHERE place_id = $1) AS counted`,
    [placeId]
  )
  return rows[0]!
}

/** A product's items (retired ones too) and counted stock. */
export async function usesOf(q: Queryable, modelId: string): Promise<{ items: number; active: number; counted: number }> {
  const { rows } = await q.query<{ items: number; active: number; counted: number }>(
    `SELECT (SELECT count(*)::int FROM assets WHERE model_id = $1) AS items,
            (SELECT count(*)::int FROM assets WHERE model_id = $1 AND status = 'active') AS active,
            (SELECT coalesce(sum(qty), 0)::int FROM stock WHERE model_id = $1) AS counted`,
    [modelId]
  )
  return rows[0]!
}

/** Cases of this product that are holding something. */
export async function casesInUse(q: Queryable, modelId: string): Promise<number> {
  const { rows } = await q.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM assets c
      WHERE c.model_id = $1
        AND (EXISTS (SELECT 1 FROM assets a WHERE a.case_id = c.id AND a.status = 'active') OR EXISTS (SELECT 1 FROM stock s WHERE s.case_id = c.id))`,
    [modelId]
  )
  return rows[0]!.n
}

export const whereOf = (w: Where) => ({ placeId: w.placeId ?? null, caseId: w.caseId ?? null })
