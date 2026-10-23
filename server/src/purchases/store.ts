import type { PurchaseRequest, PurchaseStatus, PurchaseVote } from '@sh/shared'
import type { Queryable } from '../db.ts'

/** Reading the purchase list back as devices see it (ADR 0077). */

const REQUEST = `id, title, details, link, department, asked_by, asked_by_name, asked_on::text, status, notes`

type Row = Record<string, any>

export const toPurchase = (r: Row): PurchaseRequest => ({
  id: r.id,
  title: r.title,
  details: r.details,
  link: r.link,
  department: r.department ?? null,
  askedBy: r.asked_by ?? null,
  askedByName: r.asked_by_name,
  askedOn: r.asked_on,
  status: r.status as PurchaseStatus,
  notes: r.notes,
})

export async function getPurchase(q: Queryable, id: string, lock = false) {
  const { rows } = await q.query(`SELECT ${REQUEST} FROM purchase_requests WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])
  return rows[0] ? toPurchase(rows[0]) : undefined
}

export async function getVote(q: Queryable, id: string): Promise<PurchaseVote | undefined> {
  const { rows } = await q.query<{ id: string; request_id: string; person_id: string }>('SELECT id, request_id, person_id FROM purchase_votes WHERE id = $1', [id])
  return rows[0] ? { id: rows[0].id, requestId: rows[0].request_id, personId: rows[0].person_id } : undefined
}
