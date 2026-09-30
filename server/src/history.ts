import {
  daysLabel,
  eachDay,
  euro,
  invitesLabel,
  newId,
  OFFLINE_AFTER_SECONDS,
  STATUS_LABELS,
  type HistoryEntry,
  type HistoryPage,
  type ProjectStatus,
} from '@sh/shared'
import type { Queryable } from './db.ts'

/**
 * The history (ADR 0006): the server's record of every change anyone asked
 * for (the `mutations` table), read back as entries a person can follow.
 * Each entry says in words what was done, with the names things have today,
 * taken from the change feed so that something since removed (days off, say)
 * still has its name.
 */

/** What the server records a download of everything as. Not a command, so no device can send it. */
export const EXPORT_COMMAND = 'data.export'

const PAGE = 50
const MAX_PAGE = 200

export interface HistoryQuery {
  /** From `HistoryPage.next`: only entries older than that page's last. */
  before?: string
  limit?: number
  /** Only this person's entries: a key from `HistoryPage.people`. */
  who?: string
  /** Only entries about this record: the ones that changed it, or were aimed at it and turned down. */
  id?: string
  entity?: string
}

/** A `before` that this server didn't hand out. */
export class BadCursor extends Error {}

interface Row {
  id: string
  client_id: string
  user_id: string | null
  name: string
  args: Record<string, unknown> | null
  status: 'applied' | 'rejected'
  result: { reason?: { message?: string } } | null
  device: string | null
  received: string
  made: string
  waited: number | null
  staff_name: string | null
  link_name: string | null
  records: { entity: string; id: string }[] | null
}

// How long a change waited on its device is the gap between two readings of
// the device's own clock (created and sent), so a device whose clock is wrong
// still gives the right wait. When it was made is placed on the server's
// clock: when it arrived, less the wait. Times come back as UTC text to the
// microsecond, which is also what the paging cursor needs to be exact.
const SELECT = `
  SELECT m.id, m.client_id, m.user_id, m.name, m.args, m.status, m.result, m.device,
         to_char(m.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received,
         to_char((m.received_at - coalesce(w.waited, interval '0')) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS made,
         extract(epoch FROM w.waited)::float8 AS waited,
         u.name AS staff_name,
         p.name AS link_name,
         (SELECT json_agg(json_build_object('entity', c.entity, 'id', c.entity_id) ORDER BY c.seq)
            FROM changes c WHERE c.mutation_id = m.id) AS records
    FROM mutations m
    CROSS JOIN LATERAL (
      SELECT CASE WHEN m.sent_at IS NULL THEN NULL ELSE greatest(m.sent_at - m.created_at, interval '0') END AS waited
    ) w
    LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN people p ON (m.client_id LIKE 'link:%' AND p.id = substr(m.client_id, 6))
                       OR (m.client_id LIKE 'calendar:%' AND p.id = substr(m.client_id, 10))`

/** One page of the history, newest first. */
export async function readHistory(q: Queryable, query: HistoryQuery = {}): Promise<HistoryPage> {
  const limit = Math.min(Math.max(1, Math.floor(Number(query.limit) || PAGE)), MAX_PAGE)
  const where: string[] = []
  const params: unknown[] = []
  const param = (value: unknown) => `$${params.push(value)}`

  if (query.before) {
    const cursor = readCursor(query.before)
    where.push(`(m.received_at, m.id) < (${param(cursor.at)}::timestamptz, ${param(cursor.id)}::text)`)
  }
  if (query.who?.startsWith('user:')) where.push(`m.user_id = ${param(query.who.slice(5))}`)
  // A freelancer answers on their link or in Google Calendar (ADR 0009): both are theirs.
  else if (query.who?.startsWith('link:')) where.push(`m.client_id IN (${param(query.who)}, ${param(`calendar:${query.who.slice(5)}`)})`)
  else if (query.who) where.push('false')
  if (query.id) {
    const id = param(query.id)
    const entity = query.entity ? ` AND c.entity = ${param(query.entity)}` : ''
    where.push(`(EXISTS (SELECT 1 FROM changes c WHERE c.mutation_id = m.id AND c.entity_id = ${id}${entity}) OR m.args->>'id' = ${id})`)
  }

  const { rows } = await q.query<Row>(
    `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY m.received_at DESC, m.id DESC LIMIT ${limit + 1}`,
    params
  )
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    entries: await toEntries(q, page),
    ...(rows.length > limit && last ? { next: writeCursor(last.received, last.id) } : {}),
    ...(query.before ? {} : { people: await historyPeople(q) }),
  }
}

/** The whole history, oldest first, for the export. */
export async function readAllHistory(q: Queryable): Promise<HistoryEntry[]> {
  const { rows } = await q.query<Row>(`${SELECT} ORDER BY m.received_at, m.id`)
  return toEntries(q, rows)
}

/**
 * Staff who have signed in, and freelancers who have answered on their
 * private link or in Google Calendar: everyone the History tab can be
 * narrowed to.
 */
async function historyPeople(q: Queryable): Promise<{ key: string; name: string }[]> {
  const { rows } = await q.query<{ key: string; name: string }>(
    `SELECT 'user:' || id AS key, name FROM users
     UNION ALL
     SELECT 'link:' || p.id AS key, p.name FROM people p
      WHERE EXISTS (SELECT 1 FROM mutations m WHERE m.client_id IN ('link:' || p.id, 'calendar:' || p.id))
     ORDER BY name, key`
  )
  return rows
}

/** Record a download of everything, which holds everyone's details, in the history. */
export async function recordExport(
  q: Queryable,
  entry: { clientId: string; userId?: string; device?: string; format: 'zip' | 'json'; rows: number }
) {
  await q.query(
    `INSERT INTO mutations (id, client_id, user_id, name, args, created_at, device, received_at, status, result)
     VALUES ($1, $2, $3, $4, $5, now(), $6, clock_timestamp(), 'applied', '{}')`,
    [newId(), entry.clientId, entry.userId ?? null, EXPORT_COMMAND, JSON.stringify({ format: entry.format, rows: entry.rows }), entry.device ?? null]
  )
}

function writeCursor(at: string, id: string) {
  return Buffer.from(JSON.stringify([at, id])).toString('base64url')
}

function readCursor(text: string): { at: string; id: string } {
  try {
    const [at, id] = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as unknown[]
    if (typeof at === 'string' && typeof id === 'string' && !Number.isNaN(Date.parse(at))) return { at, id }
  } catch {
    // Falls through.
  }
  throw new BadCursor('That page of the history no longer exists; start again from the newest.')
}

async function toEntries(q: Queryable, rows: Row[]): Promise<HistoryEntry[]> {
  const look = await lookup(q, rows)
  return rows.map((r) => {
    const args = r.args ?? {}
    const link = r.client_id.startsWith('link:')
    const calendar = r.client_id.startsWith('calendar:')
    const waited = r.waited === null ? undefined : Math.round(r.waited)
    return {
      id: r.id,
      what: describe(r.name, args, look),
      command: r.name,
      outcome: r.status === 'applied' ? 'done' : 'turned-down',
      ...(r.status === 'rejected' ? { reason: r.result?.reason?.message ?? 'No reason given.' } : {}),
      who: link
        ? { kind: 'link', name: r.link_name ?? 'A freelancer', key: r.client_id }
        : calendar
          ? { kind: 'calendar', name: r.link_name ?? 'A freelancer', key: `link:${r.client_id.slice(9)}` }
          : r.user_id
            ? { kind: 'staff', name: r.staff_name ?? 'A member of staff', key: `user:${r.user_id}` }
            : { kind: 'unknown', name: 'Someone' },
      ...(r.device ? { device: r.device } : {}),
      ...(link || calendar || r.client_id === 'server' ? {} : { deviceCode: r.client_id.slice(-6) }),
      madeAt: r.made,
      arrivedAt: r.received,
      ...(waited === undefined ? {} : { waitedSeconds: waited }),
      madeOffline: waited !== undefined && waited >= OFFLINE_AFTER_SECONDS,
      records: r.records ?? [],
    }
  })
}

type Data = Record<string, unknown>
type Look = (entity: string, id: unknown) => Data | undefined

const REFERENCES = ['id', 'productId', 'bookingId', 'personId', 'callId', 'projectId', 'phaseId', 'clientId', 'venueId'] as const

/**
 * The latest known state of every record the entries mention, and of the
 * records those refer to (an offer's person and call, a phase's job), from
 * the change feed.
 */
async function lookup(q: Queryable, rows: Row[]): Promise<Look> {
  const known = new Map<string, Data>()
  const ids = (sources: Data[]) =>
    [...new Set(sources.flatMap((s) => REFERENCES.map((k) => s[k]).filter((v): v is string => typeof v === 'string')))]

  let wanted = ids(rows.map((r) => r.args ?? {}))
  for (let round = 0; round < 2 && wanted.length > 0; round++) {
    // For the whole history at once (the export), reading every record's latest state is simpler than a long list.
    const everything = wanted.length > 1000
    const { rows: found } = await q.query<{ entity: string; id: string; data: Data }>(
      `SELECT DISTINCT ON (entity_id, entity) entity, entity_id AS id, data
         FROM changes
        WHERE op = 'put'${everything ? '' : ' AND entity_id = ANY($1::text[])'}
        ORDER BY entity_id, entity, seq DESC`,
      everything ? [] : [wanted]
    )
    for (const f of found) known.set(`${f.entity}:${f.id}`, f.data)
    wanted = everything ? [] : ids(found.map((f) => f.data)).filter((id) => !found.some((f) => f.id === id))
  }
  return (entity, id) => (typeof id === 'string' ? known.get(`${entity}:${id}`) : undefined)
}

const text = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback)
const dates = (start: unknown, end: unknown) =>
  typeof start === 'string' && typeof end === 'string' ? daysLabel(eachDay(start, end)) : 'on dates since removed'
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
/** "a", "a and b", "a, b and c". */
const inWords = (parts: string[]) => (parts.length < 2 ? (parts[0] ?? 'nothing') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`)

/** What an entry did, in words, as the History tab and the exported history show it. */
export function describe(command: string, a: Data, look: Look): string {
  const product = (id: unknown) => text(look('product', id)?.name, 'an item')
  const person = (id: unknown) => text(look('person', id)?.name, 'someone')
  const call = (id: unknown) => {
    const c = look('crewCall', id)
    return `${text(c?.role, 'a role')} on ${text(c?.project, 'a job')}`
  }
  const offer = (id: unknown) => {
    const o = look('offer', id)
    return { who: person(o?.personId), what: call(o?.callId) }
  }
  const job = (id: unknown) => text(look('project', id)?.name, 'a job')
  const client = (id: unknown) => text(look('client', id)?.name, 'a client')
  const venue = (id: unknown) => text(look('venue', id)?.name, 'a venue')
  const status = (s: unknown) => (typeof s === 'string' && s in STATUS_LABELS ? STATUS_LABELS[s as ProjectStatus].toLowerCase() : 'another status')

  switch (command) {
    case 'product.upsert':
      return `Set ${text(a.name, 'an item')} to ${a.quantity} in stock`
    case 'booking.create':
      return `Booked ${a.qty} × ${product(a.productId)} for ${text(a.project, 'a job')}, ${dates(a.start, a.end)}`
    case 'booking.cancel': {
      const b = look('booking', a.id)
      return b ? `Cancelled the booking of ${b.qty} × ${product(b.productId)} for ${text(b.project, 'a job')}, ${dates(b.start, b.end)}` : 'Cancelled a booking'
    }
    case 'scan.record': {
      const b = look('booking', a.bookingId)
      return `Scanned ${product(a.productId)} ${a.direction === 'in' ? 'back in' : 'out'}${b ? ` for ${text(b.project, 'a job')}` : ''}`
    }
    case 'person.upsert':
      return `Saved ${text(a.name, 'someone')}'s details`
    case 'person.newLink':
      return `Gave ${person(a.id)} a new private link; the old one stopped working`
    case 'unavailability.add':
      return `Marked ${person(a.personId)} away ${dates(a.start, a.end)}${typeof a.note === 'string' && a.note ? ` (${clip(a.note)})` : ''}`
    case 'unavailability.remove': {
      const u = look('unavailability', a.id)
      return u ? `Removed ${person(u.personId)}'s days off, ${dates(u.start, u.end)}` : 'Removed some days off'
    }
    case 'call.create':
      return `Asked for ${a.needed} × ${text(a.role, 'crew')} for ${text(a.project, 'a job')}${typeof a.phase === 'string' && a.phase ? ` (${a.phase})` : ''}, ${dates(a.start, a.end)}`
    case 'call.cancel':
      return `Cancelled the call for ${call(a.id)}`
    case 'offer.send':
      return `Offered ${call(a.callId)} to ${person(a.personId)}${a.override ? ', despite a clash or a day off' : ''}`
    case 'offer.respond': {
      const o = offer(a.id)
      if (a.answer === 'decline') return `${o.who} declined ${o.what}`
      if (a.answer === 'counter') return `${o.who} asked for ${euro(a.counterRateCents as number)} a day for ${o.what}`
      return `${o.who} accepted ${o.what}${Array.isArray(a.days) && a.days.length ? `, ${daysLabel(a.days as string[])}` : ''}`
    }
    case 'offer.confirm': {
      const o = offer(a.id)
      return `Confirmed ${o.who} for ${o.what}`
    }
    case 'offer.cancel': {
      const o = offer(a.id)
      return `Withdrew the offer of ${o.what} to ${o.who}`
    }
    case 'client.upsert':
      return `Saved the client ${text(a.name, 'a client')}`
    case 'venue.upsert':
      return `Saved the venue ${text(a.name, 'a venue')}`
    case 'project.create':
      return `Added the job ${text(a.name, 'a job')}${a.clientId ? ` for ${client(a.clientId)}` : ''}, ${status(a.status)}`
    case 'project.update': {
      const parts: string[] = []
      if (a.name !== undefined) parts.push(`name to ${text(a.name, 'a job')}`)
      if (a.status !== undefined) parts.push(`status to ${status(a.status)}`)
      if (a.clientId !== undefined) parts.push(a.clientId ? `client to ${client(a.clientId)}` : 'no client')
      if (a.venueId !== undefined) parts.push(a.venueId ? `venue to ${venue(a.venueId)}` : 'no venue')
      if (a.notes !== undefined) parts.push('the notes')
      return `Changed the job ${job(a.id)}: ${inWords(parts)}`
    }
    case 'phase.add':
      return `Added ${text(a.name, 'a phase')} to ${job(a.projectId)}, ${dates(a.start, a.end)}`
    case 'phase.update': {
      const p = look('phase', a.id)
      const parts: string[] = []
      if (a.name !== undefined) parts.push(`name to ${text(a.name, 'a phase')}`)
      if (a.start !== undefined || a.end !== undefined) parts.push(`dates to ${dates(a.start ?? p?.start, a.end ?? p?.end)}`)
      if (a.venueId !== undefined) parts.push(a.venueId ? `venue to ${venue(a.venueId)}` : "venue to the job's")
      if (a.notes !== undefined) parts.push('the notes')
      return `Changed ${text(p?.name, 'a phase')} on ${job(p?.projectId)}: ${inWords(parts)}`
    }
    case 'phase.remove': {
      const p = look('phase', a.id)
      return p ? `Removed ${text(p.name, 'a phase')} from ${job(p.projectId)}` : 'Removed a phase'
    }
    case 'calendar.connect':
      return `Connected Google Calendar as ${text(a.account, 'a Google account')}`
    case 'calendar.use':
      return `Chose ${text(a.calendar, 'a calendar')} as the calendar for jobs`
    case 'calendar.invites':
      if (a.on !== true) return 'Turned off crew invites on Google Calendar'
      return `Turned on crew invites on Google Calendar${typeof a.invites === 'number' && typeof a.people === 'number' ? ` (${invitesLabel(a.invites, a.people)})` : ''}`
    case 'calendar.disconnect':
      return `Disconnected Google Calendar${typeof a.account === 'string' ? ` (${a.account})` : ''}${typeof a.calendar === 'string' ? `, taking the app's days off ${a.calendar}` : ''}`
    case 'calendar.import': {
      const count = (v: unknown, one: string, many: string) => (typeof v === 'number' && v > 0 ? `${v.toLocaleString('en-IE')} ${v === 1 ? one : many}` : undefined)
      const some = (parts: (string | undefined)[]) => parts.filter((p): p is string => p !== undefined)
      const added = count(a.added, 'job', 'jobs')
      const what = some([count(a.jobs, 'job', 'jobs'), added && `more days for ${added}`])
      const details = some([
        count(a.days, 'day', 'days'),
        count(a.crew, 'crew booking or offer', 'crew bookings and offers'),
        count(a.people, 'new person', 'new people'),
        count(a.venues, 'new venue', 'new venues'),
      ])
      return `Brought in ${what.length ? inWords(what) : 'jobs'} from ${text(a.calendar, 'a calendar')} on Google Calendar${details.length ? `: ${inWords(details)}` : ''}`
    }
    case EXPORT_COMMAND:
      return `Downloaded everything${a.format === 'json' ? ' as JSON' : ''}${typeof a.rows === 'number' ? ` (${a.rows.toLocaleString('en-IE')} rows)` : ''}`
    default:
      return command
  }
}
