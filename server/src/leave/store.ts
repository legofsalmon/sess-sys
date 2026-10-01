import { allowanceId, leaveBalance, type LeaveAllowance, type LeaveBalance, type LeaveRequest, type LieuEntry } from '@sh/shared'
import type { Queryable } from '../db.ts'

/** Reading leave rows back as the entities devices see (ADR 0024). */

const ALLOWANCE = 'id, person_id, year, days, carried_over, note'
const REQUEST = 'id, person_id, type, start_day::text, end_day::text, days, note, status, requested_at, decided_by, decided_at, reason'
const ENTRY = 'id, person_id, day::text, days, note, status, logged_at, decided_by, decided_at, reason'

type Row = Record<string, any>

const at = (v: unknown) => (v ? new Date(v as string).toISOString() : null)

export const toAllowance = (r: Row): LeaveAllowance => ({ id: r.id, personId: r.person_id, year: r.year, days: r.days, carriedOver: r.carried_over, note: r.note })
export const toRequest = (r: Row): LeaveRequest => ({
  id: r.id,
  personId: r.person_id,
  type: r.type,
  start: r.start_day,
  end: r.end_day,
  days: r.days,
  note: r.note,
  status: r.status,
  requestedAt: at(r.requested_at)!,
  decidedBy: r.decided_by ?? null,
  decidedAt: at(r.decided_at),
  reason: r.reason,
})
export const toEntry = (r: Row): LieuEntry => ({
  id: r.id,
  personId: r.person_id,
  day: r.day,
  days: r.days,
  note: r.note,
  status: r.status,
  loggedAt: at(r.logged_at)!,
  decidedBy: r.decided_by ?? null,
  decidedAt: at(r.decided_at),
  reason: r.reason,
})

export async function getAllowance(q: Queryable, personId: string, year: number) {
  const { rows } = await q.query(`SELECT ${ALLOWANCE} FROM leave_allowances WHERE id = $1`, [allowanceId(personId, year)])
  return rows[0] ? toAllowance(rows[0]) : undefined
}

export async function getRequest(q: Queryable, id: string, lock = false) {
  const { rows } = await q.query(`SELECT ${REQUEST} FROM leave_requests WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])
  return rows[0] ? toRequest(rows[0]) : undefined
}

export async function getEntry(q: Queryable, id: string, lock = false) {
  const { rows } = await q.query(`SELECT ${ENTRY} FROM lieu_entries WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])
  return rows[0] ? toEntry(rows[0]) : undefined
}

/** A person's requests in a leave year, whatever happened to them, by start day. */
export async function requestsFor(q: Queryable, personId: string, year: number) {
  const { rows } = await q.query(`SELECT ${REQUEST} FROM leave_requests WHERE person_id = $1 AND extract(year FROM start_day) = $2 ORDER BY start_day, requested_at`, [personId, year])
  return rows.map(toRequest)
}

/** A person's lieu entries in a leave year, by the day worked. */
export async function entriesFor(q: Queryable, personId: string, year: number) {
  const { rows } = await q.query(`SELECT ${ENTRY} FROM lieu_entries WHERE person_id = $1 AND extract(year FROM day) = $2 ORDER BY day, logged_at`, [personId, year])
  return rows.map(toEntry)
}

/** The balance the rules check against, worked out the same way as on each device. */
export async function balanceFor(q: Queryable, personId: string, year: number, today: string): Promise<LeaveBalance> {
  return leaveBalance(personId, year, await getAllowance(q, personId, year), await requestsFor(q, personId, year), await entriesFor(q, personId, year), today)
}

/** Everyone's approved leave, for the calendar feeds, by start day. */
export async function approvedLeave(q: Queryable) {
  const { rows } = await q.query(`SELECT ${REQUEST} FROM leave_requests WHERE status = 'approved' ORDER BY start_day, id`)
  return rows.map(toRequest)
}
