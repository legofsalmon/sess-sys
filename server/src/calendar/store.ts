import { randomBytes } from 'node:crypto'
import { CALENDAR_LINK_ID, type CalendarDay, type CalendarLink, type CalendarState, type GuestResponse } from '@sh/shared'
import type { Queryable } from '../db.ts'
import { emit, emitRemoved, type Ctx } from '../kernel.ts'

/** Reading and writing the calendar connection, the days written and their guests, and telling devices (ADR 0008, 0009). */

export interface Link {
  state: CalendarState
  appKey: string
  accountEmail: string | null
  accountSub: string | null
  /** Locked; see crypto.ts. */
  refreshToken: string | null
  calendarId: string | null
  calendarName: string | null
  problem: string | null
  appUrl: string | null
  connectedBy: string | null
  connectedByName: string | null
  connectedAt: string | null
  /** Crew are invited to their days (ADR 0009). */
  invites: boolean
}

/** Someone the app put on a day's event because of an offer, the address it used, and their last answer. */
export interface GuestRow {
  personId: string
  offerId: string
  email: string
  response: GuestResponse
  problem: string | null
}

export interface DayRow {
  id: string
  phaseId: string
  projectId: string
  day: string
  calendarId: string
  eventId: string
  generation: number
  state: 'on' | 'failed' | 'removed'
  title: string
  contentHash: string | null
  etag: string | null
  htmlLink: string | null
  problem: string | null
  /** The app's guests on the event, as last written or read. */
  guests: GuestRow[]
}

type Row = Record<string, any>

const LINK = `l.state, l.app_key, l.account_email, l.account_sub, l.refresh_token, l.calendar_id, l.calendar_name, l.problem, l.app_url,
  l.connected_by, u.name AS connected_by_name, to_char(l.connected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS connected_at, l.invites`

const toLink = (r: Row): Link => ({
  state: r.state,
  appKey: r.app_key,
  accountEmail: r.account_email,
  accountSub: r.account_sub,
  refreshToken: r.refresh_token,
  calendarId: r.calendar_id,
  calendarName: r.calendar_name,
  problem: r.problem,
  appUrl: r.app_url,
  connectedBy: r.connected_by,
  connectedByName: r.connected_by_name,
  connectedAt: r.connected_at,
  invites: r.invites === true,
})

export async function readLink(q: Queryable): Promise<Link | undefined> {
  const { rows } = await q.query(`SELECT ${LINK} FROM calendar_link l LEFT JOIN users u ON u.id = l.connected_by WHERE l.id = 'main'`)
  return rows[0] ? toLink(rows[0]) : undefined
}

/** The connection as devices see it: never the key. */
export function linkEntity(l: Link): CalendarLink {
  return {
    id: CALENDAR_LINK_ID,
    state: l.state,
    account: l.accountEmail,
    calendarId: l.calendarId,
    calendarName: l.calendarName,
    problem: l.problem,
    connectedBy: l.connectedByName,
    connectedAt: l.connectedAt,
    invites: l.invites,
  }
}

type LinkFields = Partial<Omit<Link, 'appKey' | 'connectedByName'>>

const LINK_COLUMNS: Record<keyof LinkFields, string> = {
  state: 'state',
  accountEmail: 'account_email',
  accountSub: 'account_sub',
  refreshToken: 'refresh_token',
  calendarId: 'calendar_id',
  calendarName: 'calendar_name',
  problem: 'problem',
  appUrl: 'app_url',
  connectedBy: 'connected_by',
  connectedAt: 'connected_at',
  invites: 'invites',
}

/**
 * Change the connection, making it first if there isn't one yet, and tell
 * devices when what they see of it has changed. Needs the change-feed lock
 * (`serverChange`).
 */
export async function saveLink(ctx: Ctx, fields: LinkFields): Promise<Link> {
  const before = await readLink(ctx.tx)
  if (!before) {
    await ctx.tx.query(`INSERT INTO calendar_link (id, state, app_key) VALUES ('main', 'off', $1)`, [randomBytes(8).toString('hex')])
  }
  const keys = (Object.keys(fields) as (keyof LinkFields)[]).filter((k) => fields[k] !== undefined)
  if (keys.length) {
    await ctx.tx.query(
      `UPDATE calendar_link SET ${keys.map((k, i) => `${LINK_COLUMNS[k]} = $${i + 1}`).join(', ')}, updated_at = now() WHERE id = 'main'`,
      keys.map((k) => fields[k])
    )
  }
  const after = (await readLink(ctx.tx))!
  const seen = linkEntity(after)
  if (!before || JSON.stringify(linkEntity(before)) !== JSON.stringify(seen)) await emit(ctx, 'calendarLink', CALENDAR_LINK_ID, seen)
  return after
}

const DAY = `id, phase_id, project_id, day::text, calendar_id, event_id, generation, state, title, content_hash, etag, html_link, problem`

const toDay = (r: Row, guests: GuestRow[] = []): DayRow => ({
  id: r.id,
  phaseId: r.phase_id,
  projectId: r.project_id,
  day: r.day,
  calendarId: r.calendar_id,
  eventId: r.event_id,
  generation: r.generation,
  state: r.state,
  title: r.title,
  contentHash: r.content_hash,
  etag: r.etag,
  htmlLink: r.html_link,
  problem: r.problem,
  guests,
})

/** Every day from `today` on that the app has written or tried to, removed ones included, with their guests. */
export async function readDays(q: Queryable, today: string): Promise<DayRow[]> {
  const { rows } = await q.query<Row>(`SELECT ${DAY} FROM calendar_days WHERE day >= $1::date ORDER BY day, id`, [today])
  const guests = await readGuests(q, 'd.day >= $1::date', [today])
  return rows.map((r) => toDay(r, guests.get(r.id)))
}

/** Some days, by id, with their guests. */
export async function readDaysById(q: Queryable, ids: string[]): Promise<DayRow[]> {
  const { rows } = await q.query<Row>(`SELECT ${DAY} FROM calendar_days WHERE id = ANY($1::text[]) ORDER BY day, id`, [ids])
  const guests = await readGuests(q, 'd.id = ANY($1::text[])', [ids])
  return rows.map((r) => toDay(r, guests.get(r.id)))
}

/** The app's guests on the days matching `where`, by day id, each day's in person order. */
async function readGuests(q: Queryable, where: string, params: unknown[]): Promise<Map<string, GuestRow[]>> {
  const { rows } = await q.query<Row>(
    `SELECT g.day_id, g.person_id, g.offer_id, g.email, g.response, g.problem
       FROM calendar_guests g JOIN calendar_days d ON d.id = g.day_id
      WHERE ${where}
      ORDER BY g.day_id, g.person_id`,
    params
  )
  const out = new Map<string, GuestRow[]>()
  for (const r of rows) {
    const list = out.get(r.day_id) ?? []
    list.push({ personId: r.person_id, offerId: r.offer_id, email: r.email, response: r.response, problem: r.problem })
    out.set(r.day_id, list)
  }
  return out
}

/** Where an offer's person is a guest from `today` on: each day's event they are on, and their answer there. */
export async function guestPlaces(q: Queryable, offerId: string, today: string): Promise<{ dayId: string; day: string; response: GuestResponse }[]> {
  const { rows } = await q.query<{ dayId: string; day: string; response: GuestResponse }>(
    `SELECT g.day_id AS "dayId", d.day::text AS day, g.response
       FROM calendar_guests g JOIN calendar_days d ON d.id = g.day_id
      WHERE g.offer_id = $1 AND d.day >= $2::date AND d.state <> 'removed'
      ORDER BY d.day, g.day_id`,
    [offerId, today]
  )
  return rows
}

/** How many days from `today` on are on a calendar. */
export async function countOn(q: Queryable, today: string): Promise<number> {
  const { rows } = await q.query<{ n: string }>(`SELECT count(*) AS n FROM calendar_days WHERE day >= $1::date AND state <> 'removed'`, [today])
  return Number(rows[0]?.n ?? 0)
}

export function dayEntity(d: DayRow): CalendarDay {
  return {
    id: d.id,
    phaseId: d.phaseId,
    projectId: d.projectId,
    day: d.day,
    calendarId: d.calendarId,
    title: d.title,
    state: d.state === 'failed' ? 'failed' : 'on',
    problem: d.problem,
    link: d.htmlLink,
    // Names come from the people the devices already have; addresses stay on the server.
    guests: d.guests.map((g) => ({ personId: g.personId, offerId: g.offerId, response: g.response, problem: g.problem })),
  }
}

/** Record what happened to one day, telling devices when what they see of it has changed. */
export async function saveDay(ctx: Ctx, d: DayRow, before: DayRow | undefined) {
  await ctx.tx.query(
    `INSERT INTO calendar_days (id, phase_id, project_id, day, calendar_id, event_id, generation, state, title, content_hash, etag, html_link, problem)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (id) DO UPDATE SET phase_id = EXCLUDED.phase_id, project_id = EXCLUDED.project_id, calendar_id = EXCLUDED.calendar_id,
       event_id = EXCLUDED.event_id, generation = EXCLUDED.generation, state = EXCLUDED.state, title = EXCLUDED.title,
       content_hash = EXCLUDED.content_hash, etag = EXCLUDED.etag, html_link = EXCLUDED.html_link, problem = EXCLUDED.problem, updated_at = now()`,
    [d.id, d.phaseId, d.projectId, d.day, d.calendarId, d.eventId, d.generation, d.state, d.title, d.contentHash, d.etag, d.htmlLink, d.problem]
  )
  if (JSON.stringify(before?.guests ?? []) !== JSON.stringify(d.guests)) await saveGuests(ctx.tx, d.id, d.guests)
  const wasSeen = before && before.state !== 'removed'
  if (d.state === 'removed') {
    if (wasSeen) await emitRemoved(ctx, 'calendarDay', d.id)
    return
  }
  if (!wasSeen || JSON.stringify(dayEntity(before)) !== JSON.stringify(dayEntity(d))) await emit(ctx, 'calendarDay', d.id, dayEntity(d))
}

/** Replace a day's guests with these. */
async function saveGuests(q: Queryable, dayId: string, guests: GuestRow[]) {
  await q.query('DELETE FROM calendar_guests WHERE day_id = $1', [dayId])
  for (const g of guests) {
    await q.query(
      `INSERT INTO calendar_guests (day_id, person_id, offer_id, email, response, problem) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (day_id, person_id) DO UPDATE SET offer_id = EXCLUDED.offer_id, email = EXCLUDED.email, response = EXCLUDED.response,
         problem = EXCLUDED.problem, updated_at = now()`,
      [dayId, g.personId, g.offerId, g.email, g.response, g.problem]
    )
  }
}
