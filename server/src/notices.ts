import { LIVE, NOTICE_WHY, readsEveryRate, type Notice, type NoticesPage } from '@sh/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { HAS_EMAIL } from './crew/store.ts'
import type { Db, Queryable } from './db.ts'
import { SELECT, toEntries, type Row } from './history.ts'
import { readingOf } from './reading.ts'

/**
 * Notifications (ADR 0058): the changes other people made, lately, to what
 * is someone's own. Read from the history (ADR 0006), so each says what was
 * done in the same words the History tab uses, by whom and when, and
 * nothing new is kept but how far each person has read. In the app only:
 * nothing here sends an email, a text or a push to anyone.
 *
 * What's someone's own, nearest them first (`NOTICE_WHY`):
 *
 * - **you**: their record on the Crew tab, their offers and bookings, the
 *   timesheets for them, their leave, days in lieu and allowance, days
 *   marked off, their documents, the vans they're down to drive, and the
 *   job steps given to them (ADR 0073);
 * - **sent**: the offers they sent, so an answer comes back to them;
 * - **on**: the jobs they're on, as crew on a live offer, the contact on
 *   the day for a phase, a driver, or with a step of it given to them: the
 *   job, its phases and its calls;
 * - **made**: the jobs they made in the app, with the offers on them.
 *
 * With nobody signed in (a demo copy, or sign-in off), the device is the
 * person: the jobs made and offers sent on it are its own.
 *
 * Their own changes are never news to them, on any device, nor on their
 * private link or in Google Calendar. Noting an answer (`offer.seen`) is
 * the office's housekeeping, so it's left out.
 */

/** How far back the list goes. */
export const NOTICE_DAYS = 30
/** The most the list holds. */
export const NOTICE_LIMIT = 100
/** Changes that are housekeeping, never news. */
const QUIET = ['offer.seen']

export interface NoticeReader {
  /** The signed-in account; none on a demo copy or while sign-in is off. */
  userId?: string
  /** Who they are on the Crew tab, when found. */
  personId?: string
  /** This device, whose changes are theirs too while nobody is signed in. */
  clientId?: string
}

/** A change they made: by their account, or, with nobody signed in, on this device. */
const BY_THEM = `($1::text IS NOT NULL AND m.user_id = $1::text OR $1::text IS NULL AND $7::text IS NOT NULL AND m.client_id = $7::text)`

interface Hit {
  id: string
  rank: number
  about: string
}

/** The changes, newest first, that others made to what's this reader's own. */
export async function readNotices(q: Queryable, reader: NoticeReader, rates = true, notes = true): Promise<Notice[]> {
  const user = reader.userId ?? null
  const person = reader.personId ?? null
  // What they did themselves, wherever they did it.
  const own = [...(person ? [`link:${person}`, `calendar:${person}`] : []), ...(reader.clientId ? [reader.clientId] : [])]
  const { rows: hits } = await q.query<Hit>(
    `WITH made AS (
       SELECT m.args->>'id' AS id FROM mutations m
        WHERE ${BY_THEM} AND m.name = 'project.create' AND m.status = 'applied'
     ),
     onjob AS (
       SELECT c.project_id AS id FROM offers o JOIN crew_calls c ON c.id = o.call_id
        WHERE o.person_id = $2::text AND o.status = ANY($3::text[]) AND c.project_id IS NOT NULL
       UNION SELECT project_id FROM phases WHERE contact_id = $2::text
       UNION SELECT project_id FROM vehicle_bookings WHERE driver_id = $2::text
       UNION SELECT project_id FROM job_steps WHERE owner_id = $2::text
     ),
     mine (entity, id, rank) AS (
       SELECT 'person', $2::text, 0 WHERE $2::text IS NOT NULL
       UNION ALL SELECT 'offer', id, 0 FROM offers WHERE person_id = $2::text
       UNION ALL SELECT 'timesheet', t.id, 0 FROM timesheets t JOIN offers o ON o.id = t.id WHERE o.person_id = $2::text
       UNION ALL SELECT 'leaveRequest', id, 0 FROM leave_requests WHERE person_id = $2::text
       UNION ALL SELECT 'lieuEntry', id, 0 FROM lieu_entries WHERE person_id = $2::text
       UNION ALL SELECT 'leaveAllowance', id, 0 FROM leave_allowances WHERE person_id = $2::text
       UNION ALL SELECT 'unavailability', id, 0 FROM unavailability WHERE person_id = $2::text
       UNION ALL SELECT 'document', id, 0 FROM documents WHERE person_id = $2::text
       UNION ALL SELECT 'vehicleBooking', id, 0 FROM vehicle_bookings WHERE driver_id = $2::text
       UNION ALL SELECT 'jobStep', id, 0 FROM job_steps WHERE owner_id = $2::text
       UNION ALL SELECT 'offer', c.entity_id, 1 FROM mutations m JOIN changes c ON c.mutation_id = m.id
                  WHERE ${BY_THEM} AND m.name = 'offer.send' AND c.entity = 'offer'
       UNION ALL SELECT 'project', id, 2 FROM onjob
       UNION ALL SELECT 'phase', p.id, 2 FROM phases p JOIN onjob j ON j.id = p.project_id
       UNION ALL SELECT 'crewCall', c.id, 2 FROM crew_calls c JOIN onjob j ON j.id = c.project_id
       UNION ALL SELECT 'project', id, 3 FROM made
       UNION ALL SELECT 'phase', p.id, 3 FROM phases p JOIN made j ON j.id = p.project_id
       UNION ALL SELECT 'crewCall', c.id, 3 FROM crew_calls c JOIN made j ON j.id = c.project_id
       UNION ALL SELECT 'offer', o.id, 3 FROM offers o JOIN crew_calls c ON c.id = o.call_id JOIN made j ON j.id = c.project_id
     ),
     hits AS (
       SELECT c.mutation_id AS id, min(mine.rank) AS rank, (array_agg(mine.entity || ':' || mine.id ORDER BY mine.rank, c.seq))[1] AS about
         FROM mine JOIN changes c ON c.entity_id = mine.id AND c.entity = mine.entity
        WHERE c.mutation_id IS NOT NULL AND c.at > now() - make_interval(days => $5::int)
        GROUP BY c.mutation_id
     )
     SELECT h.id, h.rank, h.about FROM hits h JOIN mutations m ON m.id = h.id
      WHERE m.status = 'applied'
        AND NOT ($1::text IS NOT NULL AND m.user_id IS NOT DISTINCT FROM $1::text)
        AND m.client_id <> ALL($4::text[])
        AND m.name <> ALL($6::text[])
      ORDER BY m.received_at DESC, m.id DESC
      LIMIT ${NOTICE_LIMIT}`,
    [user, person, LIVE, own, NOTICE_DAYS, QUIET, reader.clientId ?? null],
  )
  if (hits.length === 0) return []
  const { rows } = await q.query<Row>(`${SELECT} WHERE m.id = ANY($1::text[]) ORDER BY m.received_at DESC, m.id DESC`, [hits.map((h) => h.id)])
  const byId = new Map(hits.map((h) => [h.id, h]))
  const entries = await toEntries(q, rows, rates, notes)
  return entries.map((e) => {
    const hit = byId.get(e.id)!
    const [entity, ...rest] = hit.about.split(':')
    return { ...e, why: NOTICE_WHY[Math.min(Number(hit.rank), NOTICE_WHY.length - 1)]!, about: { entity: entity!, id: rest.join(':') } }
  })
}

/** Who reads the list: the account, or, with nobody signed in, this device. */
const readerKey = (reader: NoticeReader) => (reader.userId ? `user:${reader.userId}` : reader.clientId ? `client:${reader.clientId}` : undefined)

export async function readUpTo(q: Queryable, reader: NoticeReader): Promise<string | null> {
  const key = readerKey(reader)
  if (!key) return null
  const { rows } = await q.query<{ up_to: string }>(
    `SELECT to_char(up_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS up_to FROM notices_read WHERE reader = $1`,
    [key],
  )
  return rows[0]?.up_to ?? null
}

/** They've opened the list up to this change: never back, so a slow device can't undo a quicker one. */
export async function markRead(q: Queryable, reader: NoticeReader, upTo: string) {
  const key = readerKey(reader)
  if (!key) return
  await q.query(
    `INSERT INTO notices_read (reader, up_to) VALUES ($1, $2::timestamptz)
     ON CONFLICT (reader) DO UPDATE SET up_to = greatest(notices_read.up_to, excluded.up_to)`,
    [key, upTo],
  )
}

/** Who this request is: the signed-in account and who they are on the Crew tab, or a demo persona, and the device. */
async function readerOf(db: Db, req: FastifyRequest, clientId: unknown): Promise<NoticeReader> {
  const client = typeof clientId === 'string' && clientId && !clientId.includes(':') ? clientId : undefined
  if (req.user) {
    const wanted = req.user.email.trim().toLowerCase()
    const { rows } = await db.reads.query<{ id: string }>(`SELECT id FROM people WHERE ${HAS_EMAIL('$1')} AND NOT archived ORDER BY id LIMIT 1`, [
      wanted,
    ])
    return { userId: req.user.id, ...(rows[0] ? { personId: rows[0].id } : {}), ...(client ? { clientId: client } : {}) }
  }
  // A demo copy's persona stands in for a member of staff (ADR 0033).
  return { ...(req.reader?.personId ? { personId: req.reader.personId } : {}), ...(client ? { clientId: client } : {}) }
}

export function registerNoticeRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.get<{ Querystring: { client?: string } }>('/api/notices', async (req, reply): Promise<NoticesPage> => {
    reply.header('cache-control', 'no-store')
    const reader = await readerOf(db, req, req.query.client)
    // In the history's words, without crew pay for a role that doesn't see every rate (ADR 0046, ADR 0062).
    const reading = await readingOf(db.reads, req.role, req.reader ?? {})
    const [notices, upTo] = await Promise.all([readNotices(db.reads, reader, readsEveryRate(reading), (reading.details ?? 'all') === 'all'), readUpTo(db.reads, reader)])
    return { notices, readUpTo: upTo, found: reader.personId !== undefined }
  })

  app.post<{ Body: { upTo?: unknown; client?: unknown } }>('/api/notices/read', async (req, reply) => {
    const upTo = req.body?.upTo
    if (typeof upTo !== 'string' || Number.isNaN(Date.parse(upTo)))
      return reply.code(400).send({ error: 'Say which change the list was read up to.' })
    await markRead(db, await readerOf(db, req, req.body?.client), upTo)
    return { ok: true }
  })
}
