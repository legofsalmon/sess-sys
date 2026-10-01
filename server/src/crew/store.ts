import type { CrewCall, Offer, Person, Unavailability } from '@sh/shared'
import type { Queryable } from '../db.ts'

/** Reading crew rows back as the entities devices and pages see. */

const PERSON = `id, name, kind, email, phone, skills, day_rate_cents, notes, link_token, archived`
const CALL = `id, project_id, phase_id, project, phase, venue, role, start_day::text, end_day::text, call_time, needed, day_rate_cents, details, reply_by::text, status`
const OFFER = `id, call_id, person_id, status, days, day_rate_cents, counter_rate_cents, note, responded_at, responded_via, override`
const AWAY = `id, person_id, start_day::text, end_day::text, note, source`

type Row = Record<string, any>

export const toPerson = (r: Row): Person => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  email: r.email,
  phone: r.phone,
  skills: r.skills,
  dayRateCents: r.day_rate_cents,
  notes: r.notes,
  linkToken: r.link_token,
  archived: r.archived ?? false,
})
export const toCall = (r: Row): CrewCall => ({
  id: r.id,
  projectId: r.project_id ?? null,
  phaseId: r.phase_id ?? null,
  project: r.project,
  phase: r.phase,
  venue: r.venue,
  role: r.role,
  start: r.start_day,
  end: r.end_day,
  callTime: r.call_time,
  needed: r.needed,
  dayRateCents: r.day_rate_cents,
  details: r.details,
  replyBy: r.reply_by,
  status: r.status,
})
export const toOffer = (r: Row): Offer => ({
  id: r.id,
  callId: r.call_id,
  personId: r.person_id,
  status: r.status,
  days: r.days,
  dayRateCents: r.day_rate_cents,
  counterRateCents: r.counter_rate_cents,
  note: r.note,
  respondedAt: r.responded_at ? new Date(r.responded_at).toISOString() : null,
  respondedVia: r.responded_via,
  override: r.override,
})
export const toAway = (r: Row): Unavailability => ({
  id: r.id,
  personId: r.person_id,
  start: r.start_day,
  end: r.end_day,
  note: r.note,
  source: r.source,
})

export async function getPerson(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${PERSON} FROM people WHERE id = $1`, [id])
  return rows[0] ? toPerson(rows[0]) : undefined
}
/** The person a private link belongs to. An archived person's link is gone with them. */
export async function personByToken(q: Queryable, token: string) {
  if (!token || token.length < 16) return undefined
  const { rows } = await q.query(`SELECT ${PERSON} FROM people WHERE link_token = $1 AND NOT archived`, [token])
  return rows[0] ? toPerson(rows[0]) : undefined
}
export async function getCall(q: Queryable, id: string, lock = false) {
  const { rows } = await q.query(`SELECT ${CALL} FROM crew_calls WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])
  return rows[0] ? toCall(rows[0]) : undefined
}
export async function getOffer(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${OFFER} FROM offers WHERE id = $1`, [id])
  return rows[0] ? toOffer(rows[0]) : undefined
}
export async function offersForCall(q: Queryable, callId: string) {
  const { rows } = await q.query(`SELECT ${OFFER} FROM offers WHERE call_id = $1`, [callId])
  return rows.map(toOffer)
}
export async function getAway(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${AWAY} FROM unavailability WHERE id = $1`, [id])
  return rows[0] ? toAway(rows[0]) : undefined
}
export async function awayFor(q: Queryable, personId: string) {
  const { rows } = await q.query(`SELECT ${AWAY} FROM unavailability WHERE person_id = $1 ORDER BY start_day`, [personId])
  return rows.map(toAway)
}

const OFFER_WITH_CALL = `o.id, o.call_id, o.person_id, o.status, o.days, o.day_rate_cents, o.counter_rate_cents, o.note,
            o.responded_at, o.responded_via, o.override,
            c.id AS c_id, c.project_id AS c_project_id, c.phase_id AS c_phase_id,
            c.project AS c_project, c.phase AS c_phase, c.venue AS c_venue, c.role AS c_role,
            c.start_day::text AS c_start_day, c.end_day::text AS c_end_day, c.call_time AS c_call_time,
            c.needed AS c_needed, c.day_rate_cents AS c_day_rate_cents, c.details AS c_details,
            c.reply_by::text AS c_reply_by, c.status AS c_status`

const withCalls = (rows: Row[]) =>
  rows.map((r) => {
    const c: Row = {}
    for (const [k, v] of Object.entries(r)) if (k.startsWith('c_')) c[k.slice(2)] = v
    return { offer: toOffer(r), call: toCall(c) }
  })

/** A person's offers with their calls, newest call first. */
export async function offersFor(q: Queryable, personId: string) {
  const { rows } = await q.query(
    `SELECT ${OFFER_WITH_CALL}
       FROM offers o JOIN crew_calls c ON c.id = o.call_id
      WHERE o.person_id = $1
      ORDER BY c.start_day, c.project`,
    [personId]
  )
  return withCalls(rows)
}

/** Everyone, and every job anyone holds, for building all the calendar feeds at once (ADR 0012). */
export async function everyonesBookings(q: Queryable) {
  const people = await q.query(`SELECT ${PERSON} FROM people ORDER BY id`)
  const { rows } = await q.query(
    `SELECT ${OFFER_WITH_CALL}
       FROM offers o JOIN crew_calls c ON c.id = o.call_id
      WHERE o.status IN ('accepted', 'confirmed') AND c.status = 'open'
      ORDER BY c.start_day, c.project, o.id`
  )
  return { people: people.rows.map(toPerson), bookings: withCalls(rows) }
}

/** A job's calls still open, for stopping the job or removing a phase. */
export async function openCallsFor(q: Queryable, by: { projectId: string } | { phaseId: string }) {
  const [column, value] = 'projectId' in by ? ['project_id', by.projectId] : ['phase_id', by.phaseId]
  const { rows } = await q.query(`SELECT ${CALL} FROM crew_calls WHERE ${column} = $1 AND status = 'open' ORDER BY start_day, id`, [value])
  return rows.map(toCall)
}

/** Offers, other than one, that hold any of these days for a person. */
export async function heldElsewhere(q: Queryable, personId: string, days: string[], exceptCallId: string) {
  const { rows } = await q.query<Row>(
    `SELECT o.days, c.project, c.phase FROM offers o JOIN crew_calls c ON c.id = o.call_id
      WHERE o.person_id = $1 AND o.call_id <> $2 AND o.status IN ('accepted', 'confirmed') AND c.status = 'open'`,
    [personId, exceptCallId]
  )
  const out: { project: string; days: string[] }[] = []
  for (const r of rows) {
    const hit = (r.days as string[]).filter((d) => days.includes(d))
    if (hit.length) out.push({ project: r.phase ? `${r.project} (${r.phase})` : r.project, days: hit })
  }
  return out
}

/**
 * What would be left hanging if a person were archived: an offer still
 * waiting on someone, or days they hold, from today on. The first by date.
 */
export async function holdsFrom(q: Queryable, personId: string, today: string) {
  const { rows } = await q.query<Row>(
    `SELECT o.status, o.days, c.project, c.phase, c.end_day::text AS end_day
       FROM offers o JOIN crew_calls c ON c.id = o.call_id
      WHERE o.person_id = $1 AND c.status = 'open' AND c.end_day >= $2::date
        AND o.status IN ('offered', 'countered', 'accepted', 'confirmed')
      ORDER BY c.start_day, c.project`,
    [personId, today]
  )
  for (const r of rows) {
    const holding = r.status === 'accepted' || r.status === 'confirmed'
    if (holding && !(r.days as string[]).some((d) => d >= today)) continue
    return { status: r.status as Offer['status'], project: r.phase ? `${r.project} (${r.phase})` : (r.project as string) }
  }
  return undefined
}

export async function awayOn(q: Queryable, personId: string, days: string[]) {
  const all = await awayFor(q, personId)
  return all
    .map((u) => ({ u, hit: days.filter((d) => d >= u.start && d <= u.end) }))
    .filter((x) => x.hit.length)
}
