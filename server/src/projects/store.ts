import { venueLabel, type Client, type Phase, type Project, type Venue } from '@sh/shared'
import type { Queryable } from '../db.ts'

/** Reading job rows back as the records devices see. */

const CLIENT = `id, name, contacts, notes`
const VENUE = `id, name, address, notes`
const PROJECT = `id, name, client_id, venue_id, status, notes, source_calendar, prep_days, return_days`
const PHASE = `id, project_id, name, start_day::text, end_day::text, venue_id, notes, contact_id`

type Row = Record<string, any>

export const toClient = (r: Row): Client => ({ id: r.id, name: r.name, contacts: r.contacts, notes: r.notes })
export const toVenue = (r: Row): Venue => ({ id: r.id, name: r.name, address: r.address, notes: r.notes })
export const toProject = (r: Row): Project => ({
  id: r.id,
  name: r.name,
  clientId: r.client_id,
  venueId: r.venue_id,
  status: r.status,
  notes: r.notes,
  prepDays: r.prep_days,
  returnDays: r.return_days,
  ...(r.source_calendar ? { sourceCalendar: r.source_calendar } : {}),
})
export const toPhase = (r: Row): Phase => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  start: r.start_day,
  end: r.end_day,
  venueId: r.venue_id,
  notes: r.notes,
  contactId: r.contact_id ?? null,
})

export async function getClient(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${CLIENT} FROM clients WHERE id = $1`, [id])
  return rows[0] ? toClient(rows[0]) : undefined
}
export async function getVenue(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${VENUE} FROM venues WHERE id = $1`, [id])
  return rows[0] ? toVenue(rows[0]) : undefined
}
export async function getProject(q: Queryable, id: string, lock = false) {
  const { rows } = await q.query(`SELECT ${PROJECT} FROM projects WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])
  return rows[0] ? toProject(rows[0]) : undefined
}
export async function getPhase(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${PHASE} FROM phases WHERE id = $1`, [id])
  return rows[0] ? toPhase(rows[0]) : undefined
}

/**
 * The names a crew call carries for its job (ADR 0007): the job's name, the
 * phase's when it is for one, and the venue's (the phase's own, or else the
 * job's) when there is one. Undefined fields are left as the call has them.
 */
export async function namesForCall(q: Queryable, projectId: string, phaseId: string | null) {
  const { rows } = await q.query<Row>(
    `SELECT p.name AS project, ph.name AS phase, v.name AS venue_name, v.address AS venue_address
       FROM projects p
       LEFT JOIN phases ph ON ph.id = $2 AND ph.project_id = p.id
       LEFT JOIN venues v ON v.id = coalesce(ph.venue_id, p.venue_id)
      WHERE p.id = $1`,
    [projectId, phaseId]
  )
  const r = rows[0]
  if (!r) return undefined
  return {
    project: r.project as string,
    phase: phaseId && r.phase !== null ? (r.phase as string) : undefined,
    venue: r.venue_name !== null ? venueLabel({ name: r.venue_name, address: r.venue_address }) : undefined,
  }
}
