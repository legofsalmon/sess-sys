import {
  caseNamed,
  editWords,
  type CommandArgs,
  type FaultKind,
  type ItemEvent,
  type ItemLogEntry,
  type ItemLogPage,
  type LogWhere,
} from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import type { Db, Queryable } from '../db.ts'
import { caseChain, getAsset } from './store.ts'

/**
 * An item's log, the server's part (ADR 0026): what the history holds about
 * one item, as the typed events the phone makes too, with who did each and
 * on what. That's every change that touched the item, and the scans (its
 * own, and those of the cases it's in now), fault reports, fault changes and
 * tests aimed at it, which touched other records. The phone joins these to
 * what it holds by what each entry is about (shared/src/item-log.ts).
 */

const PAGE = 100

interface Row {
  id: string
  name: string
  args: Record<string, unknown>
  device: string | null
  received: string
  made: string
  staff_name: string | null
  /** The item as this change left it, for the number the server gave it. */
  left: { number?: string; formerNumbers?: string[] } | null
}

// As the history places a change on the server's clock: when it arrived, less how long it waited on the device.
const SELECT = `
  SELECT m.id, m.name, m.args, m.device, u.name AS staff_name,
         to_char(m.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received,
         to_char((m.received_at - coalesce(CASE WHEN m.sent_at IS NULL THEN NULL ELSE greatest(m.sent_at - m.created_at, interval '0') END, interval '0'))
                 AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS made,
         (SELECT c.data FROM changes c WHERE c.mutation_id = m.id AND c.entity = 'asset' AND c.entity_id = $1 AND c.op = 'put' ORDER BY c.seq DESC LIMIT 1) AS left
    FROM mutations m
    LEFT JOIN users u ON u.id = m.user_id`

/** A page of an item's history, newest first; empty for an item the server doesn't have (one still on its way). */
export async function readItemLog(q: Queryable, assetId: string, before?: string): Promise<ItemLogPage> {
  const asset = await getAsset(q, assetId)
  if (!asset) return { entries: [] }
  // Its cases, as the phone has them: a case's scan took what's in it now along.
  const holders = [assetId, ...(asset.caseId ? await caseChain(q, asset.caseId) : [])]
  const { rows: faults } = await q.query<{ id: string; kind: FaultKind }>('SELECT id, kind FROM faults WHERE asset_id = $1', [assetId])
  const params: unknown[] = [assetId, holders, faults.map((f) => f.id)]
  let page = ''
  if (before) {
    const cursor = readCursor(before)
    if (cursor) {
      params.push(cursor.at, cursor.id)
      page = ` AND (m.received_at, m.id) < ($4::timestamptz, $5::text)`
    }
  }
  const { rows } = await q.query<Row>(
    `${SELECT}
      WHERE m.status = 'applied'
        AND (m.id IN (SELECT mutation_id FROM changes WHERE entity = 'asset' AND entity_id = $1 AND mutation_id IS NOT NULL)
             OR (m.name IN ('fault.report', 'inspection.record') AND m.args->>'assetId' = $1)
             OR (m.name = 'move.record' AND m.args->>'assetId' = ANY($2::text[]))
             OR (m.name IN ('fault.update', 'fault.close') AND m.args->>'id' = ANY($3::text[])))${page}
      ORDER BY m.received_at DESC, m.id DESC
      LIMIT ${PAGE + 1}`,
    params
  )
  const shown = rows.slice(0, PAGE)
  const names = await namesFor(q, shown)
  const kinds = new Map(faults.map((f) => [f.id, f.kind]))
  const entries: ItemLogEntry[] = []
  for (const r of shown) {
    const said = eventOf(r, assetId, names, kinds)
    if (!said) continue
    entries.push({
      ...said,
      ...(r.staff_name ? { who: r.staff_name } : {}),
      ...(r.device ? { device: r.device } : {}),
      from: 'server',
    })
  }
  const last = shown.at(-1)
  return { entries, ...(rows.length > PAGE && last ? { next: writeCursor(last.received, last.id) } : {}) }
}

interface Names {
  job: (id: unknown) => string
  place: (id: unknown) => string
  item: (id: unknown) => string
  product: (id: unknown) => string
}

/** The names of what the changes name, as they are today. */
async function namesFor(q: Queryable, rows: Row[]): Promise<Names> {
  const ids = (key: string) => [...new Set(rows.map((r) => r.args[key]).filter((v): v is string => typeof v === 'string'))]
  const [jobs, places, items, products] = await Promise.all([
    q.query<{ id: string; name: string }>('SELECT id, name FROM projects WHERE id = ANY($1::text[])', [ids('projectId')]),
    q.query<{ id: string; name: string }>('SELECT id, name FROM places WHERE id = ANY($1::text[])', [ids('placeId')]),
    q.query<{ id: string; number: string | null; name: string }>(
      `SELECT a.id, m.name, (SELECT i.value FROM identifiers i WHERE i.asset_id = a.id AND i.kind = 'sh' AND i.retired_at IS NULL) AS number
         FROM assets a JOIN models m ON m.id = a.model_id WHERE a.id = ANY($1::text[])`,
      [[...ids('caseId'), ...ids('assetId')]]
    ),
    q.query<{ id: string; name: string }>('SELECT id, name FROM models WHERE id = ANY($1::text[])', [ids('modelId')]),
  ])
  const map = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]))
  const [j, p, i, m] = [map(jobs.rows), map(places.rows), map(items.rows), map(products.rows)]
  return {
    job: (id) => (typeof id === 'string' && j.get(id)?.name) || 'a job',
    place: (id) => (typeof id === 'string' && p.get(id)?.name) || 'a place since removed',
    item: (id) => {
      const found = typeof id === 'string' ? i.get(id) : undefined
      return caseNamed(found ? { number: found.number ?? '', model: { name: found.name } } : undefined)
    },
    product: (id) => (typeof id === 'string' && m.get(id)?.name) || 'another product',
  }
}

/** A change as the log's event about the item, keyed as the phone keys it; nothing for one that says nothing about it. */
function eventOf(r: Row, assetId: string, n: Names, kinds: Map<string, FaultKind>): Pick<ItemLogEntry, 'key' | 'at' | 'event'> | undefined {
  const a = r.args
  const own = (event: ItemEvent) => ({ key: `mutation:${r.id}`, at: r.made, event })
  const where = (x: { placeId?: unknown; caseId?: unknown }): LogWhere => (x.placeId ? { place: n.place(x.placeId) } : x.caseId ? { case: n.item(x.caseId) } : null)
  const when = (at: unknown) => (typeof at === 'string' ? new Date(at).toISOString() : r.made)
  switch (r.name) {
    case 'asset.add':
      return own({ kind: 'added', number: r.left?.number ?? '', where: where(a) })
    case 'asset.move':
      return a.id === assetId ? own({ kind: 'moved', where: where(a) }) : undefined
    case 'asset.relabel':
      return own({ kind: 'relabelled', number: r.left?.number ?? '', before: r.left?.formerNumbers?.at(-1) ?? null })
    case 'asset.update':
      return own({ kind: 'edited', changes: editWords(a as Partial<CommandArgs<'asset.update'>>, n.product) })
    case 'asset.retire':
      return own({ kind: 'retired', reason: (a as CommandArgs<'asset.retire'>).reason, note: typeof a.note === 'string' ? a.note : '' })
    case 'asset.reinstate':
      return own({ kind: 'reinstated' })
    case 'model.mistake':
      return own({ kind: 'retired', reason: 'mistake', note: '' })
    case 'move.record':
      return {
        key: `movement:${a.id}`,
        at: when(a.at),
        event: { kind: a.direction === 'in' ? 'back' : 'out', job: n.job(a.projectId), inCase: a.assetId === assetId ? null : n.item(a.assetId) },
      }
    case 'fault.report': {
      const f = a as CommandArgs<'fault.report'>
      return { key: `fault:${f.id}`, at: when(f.at), event: { kind: 'fault', fault: f.kind, usable: f.kind === 'damaged' && f.usable, note: f.note, job: f.projectId ? n.job(f.projectId) : null } }
    }
    case 'fault.update': {
      const f = a as CommandArgs<'fault.update'>
      return own({ kind: 'repair', ...(f.repair !== undefined ? { repair: f.repair } : {}), ...(f.usable !== undefined ? { usable: f.usable } : {}), note: f.note !== undefined })
    }
    case 'fault.close': {
      const f = a as CommandArgs<'fault.close'>
      return { key: `closed:${f.id}`, at: when(f.at), event: { kind: 'closed', fault: kinds.get(f.id) ?? null, outcome: f.outcome } }
    }
    case 'inspection.record': {
      const i = a as CommandArgs<'inspection.record'>
      return { key: `inspection:${i.id}`, at: when(i.at), event: { kind: 'test', test: i.kind, passed: i.passed, by: i.by.trim(), note: i.note.trim() } }
    }
    default:
      return undefined
  }
}

const writeCursor = (at: string, id: string) => Buffer.from(JSON.stringify([at, id])).toString('base64url')
function readCursor(text: string): { at: string; id: string } | undefined {
  try {
    const [at, id] = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as unknown[]
    if (typeof at === 'string' && typeof id === 'string' && !Number.isNaN(Date.parse(at))) return { at, id }
  } catch {
    // Falls through: the first page again.
  }
  return undefined
}

export function registerItemLogRoutes(app: FastifyInstance, { db }: { db: Db }) {
  /** One item's log, newest first, a page at a time, for anyone the rest of the app is open to. */
  app.get<{ Params: { id: string }; Querystring: { before?: string } }>('/api/stock/items/:id/log', async (req, reply): Promise<ItemLogPage> => {
    reply.header('cache-control', 'no-store')
    return readItemLog(db, req.params.id, req.query.before)
  })
}
