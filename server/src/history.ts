import { CLAUDE_CLIENT, newId, OFFLINE_AFTER_SECONDS, type HistoryEntry, type HistoryPage } from '@sh/shared'
import type { Queryable } from './db.ts'
import { describe, EXPORT_COMMAND, type Data, type DocumentsRead, type Look } from './history-words.ts'

export {
  describe,
  ERASED_AGAIN_ACTION,
  ERASED_WHEN_DUE_ACTION,
  EXPORT_COMMAND,
  FUEL_FROM_AA_ACTION,
  IMPORT_PEOPLE_ACTION,
  IMPORT_STOCK_ACTION,
  LATE_CLEARED_ACTION,
  type DocumentsRead,
} from './history-words.ts'

/**
 * The history (ADR 0006): the server's record of every change anyone asked
 * for (the `mutations` table), read back as entries a person can follow.
 * Each entry says in words what was done, with the names things have today,
 * taken from the change feed so that something since removed (days off, say)
 * still has its name.
 */

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

export interface Row {
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
export const SELECT = `
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
    -- Someone combined with another (ADR 0055) answered as the one person, whose name it now is.
    LEFT JOIN person_merges pm ON pm.from_id = CASE WHEN m.client_id LIKE 'link:%' THEN substr(m.client_id, 6) WHEN m.client_id LIKE 'calendar:%' THEN substr(m.client_id, 10) END
    LEFT JOIN people p ON (m.client_id LIKE 'link:%' AND p.id = coalesce(pm.into_id, substr(m.client_id, 6)))
                       OR (m.client_id LIKE 'calendar:%' AND p.id = coalesce(pm.into_id, substr(m.client_id, 10)))`

/** One page of the history, newest first. */

export async function readHistory(q: Queryable, query: HistoryQuery = {}, rates = true, notes = true, docs: DocumentsRead = true): Promise<HistoryPage> {
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
  else if (query.who?.startsWith('link:')) {
    // With the answers of anyone combined with them (ADR 0055): they were the same person.
    const id = param(query.who.slice(5))
    where.push(`m.client_id IN (SELECT k || i FROM (SELECT ${id}::text AS i UNION SELECT from_id FROM person_merges WHERE into_id = ${id}) ids, (VALUES ('link:'), ('calendar:')) v(k))`)
  }
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
    entries: await toEntries(q, page, rates, notes, docs),
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

export async function toEntries(q: Queryable, rows: Row[], rates = true, notes = true, docs: DocumentsRead = true): Promise<HistoryEntry[]> {
  const look = await lookup(q, rows)
  const left = await itemsAsLeft(q, rows)
  return rows.map((r) => {
    const args = r.args ?? {}
    const link = r.client_id.startsWith('link:')
    const calendar = r.client_id.startsWith('calendar:')
    const waited = r.waited === null ? undefined : Math.round(r.waited)
    return {
      id: r.id,
      what: describe(r.name, args, look, left.get(r.id), link ? 'link' : calendar ? 'calendar' : 'app', rates, notes, docs),
      command: r.name,
      outcome: r.status === 'applied' ? 'done' : 'turned-down',
      ...(r.status === 'rejected' ? { reason: r.result?.reason?.message ?? 'No reason given.' } : {}),
      who: link
        ? { kind: 'link', name: r.link_name ?? 'A freelancer', key: r.client_id }
        : calendar
          ? { kind: 'calendar', name: r.link_name ?? 'A freelancer', key: `link:${r.client_id.slice(9)}` }
          : r.client_id === CLAUDE_CLIENT
            ? { kind: 'claude', name: 'Claude', key: 'claude' }
            : r.user_id
              ? { kind: 'staff', name: r.staff_name ?? 'A member of staff', key: `user:${r.user_id}` }
              : { kind: 'unknown', name: 'Someone' },
      ...(r.device ? { device: r.device } : {}),
      ...(link || calendar || r.client_id === 'server' || r.client_id === CLAUDE_CLIENT ? {} : { deviceCode: r.client_id.slice(-6) }),
      madeAt: r.made,
      arrivedAt: r.received,
      ...(waited === undefined ? {} : { waitedSeconds: waited }),
      madeOffline: waited !== undefined && waited >= OFFLINE_AFTER_SECONDS,
      records: r.records ?? [],
    }
  })
}

const REFERENCES = [
  'id',
  'inSlotId',
  'personId',
  'callId',
  'projectId',
  'phaseId',
  'clientId',
  'venueId',
  'modelId',
  // Racks' layouts (ADR 0074).
  'rackId',
  'placeId',
  'caseId',
  'assetId',
  // Certificates on items (ADR 0094): the items each covers.
  'assetIds',
  'fromPlaceId',
  'fromCaseId',
  'toPlaceId',
  'toCaseId',
  'contactId',
  'by',
  'offerId',
  // Vans and drivers (ADR 0047).
  'vehicleId',
  'driverId',
  // A job's steps (ADR 0073).
  'ownerId',
  // The purchase list (ADR 0077): a vote's request.
  'requestId',
  // Jobs made one (ADR 0050): a list of them.
  'from',
] as const

/**
 * An item as the command that numbered it left it (ADR 0013): the number
 * the server gave, which a later new label would otherwise hide.
 */
async function itemsAsLeft(q: Queryable, rows: Row[]): Promise<Map<string, Data>> {
  const ids = rows.filter((r) => r.status === 'applied' && (r.name === 'asset.add' || r.name === 'asset.relabel')).map((r) => r.id)
  if (ids.length === 0) return new Map()
  const { rows: found } = await q.query<{ mutation_id: string; data: Data }>(
    `SELECT DISTINCT ON (mutation_id) mutation_id, data FROM changes
      WHERE entity = 'asset' AND op = 'put' AND mutation_id = ANY($1::text[])
      ORDER BY mutation_id, seq DESC`,
    [ids]
  )
  return new Map(found.map((f) => [f.mutation_id, f.data]))
}

/**
 * The latest known state of every record the entries mention, and of the
 * records those refer to (an offer's person and call, a phase's job), from
 * the change feed.
 */
async function lookup(q: Queryable, rows: Row[]): Promise<Look> {
  const known = new Map<string, Data>()
  const ids = (sources: Data[]) =>
    [...new Set(sources.flatMap((s) => REFERENCES.flatMap((k) => (Array.isArray(s[k]) ? s[k] : [s[k]])).filter((v): v is string => typeof v === 'string')))]

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
