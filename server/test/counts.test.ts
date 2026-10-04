import {
  newId,
  type CommandInput,
  type CommandName,
  type Count,
  type CountItem,
  type HistoryPage,
  type ItemLogPage,
  type Mutation,
  type MutationResult,
  type PullResponse,
} from '@sh/shared'
import { unzipSync } from 'fflate'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb, type Db } from '../src/db.ts'
import { GONE, LEAVE, POINTERS, STRIPPED } from '../src/erasure/places.ts'
import { runMigrations } from '../src/migrations.ts'
import { MODULES } from '../src/modules.ts'
import { STOCK } from '../src/stock/schema.ts'
import { IPHONE, server as signedInServer, staff } from './people.ts'

/**
 * Counts (ADR 0030) on the server: a count is kept whatever has changed
 * since, as a scan is, and turned down only when the place or case never
 * existed; it says in the history and the export what it found; who
 * counted stays a pointer when they're erased; and the table arrives on a
 * database already in use without touching what's there.
 */

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

async function server(db?: Db) {
  const data = db ?? (await pgliteDb())
  const app = await buildApp({ db: data })
  cleanup.push(async () => {
    await app.close()
    await data.close()
  })
  return { app, db: data }
}

const m = <N extends CommandName>(name: N, args: CommandInput<N>): Mutation => ({ id: newId(), name, args, createdAt: new Date().toISOString() }) as Mutation

async function send(app: FastifyInstance, ...mutations: Mutation[]): Promise<MutationResult[]> {
  const res = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'office', mutations } })
  return res.json().results
}
async function ok(app: FastifyInstance, ...mutations: Mutation[]) {
  for (const r of await send(app, ...mutations)) expect(r).toMatchObject({ status: 'applied' })
}
async function refused(app: FastifyInstance, mutation: Mutation) {
  const [r] = await send(app, mutation)
  expect(r!.status).toBe('rejected')
  return r!.status === 'rejected' ? r!.reason.message : ''
}
async function counts(app: FastifyInstance): Promise<Map<string, Count>> {
  const pulled = (await app.inject({ url: '/api/sync/pull?after=0' })).json() as PullResponse
  return new Map(pulled.changes.filter((c) => c.entity === 'count').map((c) => [c.id, c.data as Count]))
}

const none = { notFound: 0, elsewhere: 0, unexpected: 0, uncounted: 0, short: 0, over: 0 }
const record = (where: { placeId?: string; caseId?: string }, more: Partial<CommandInput<'count.record'>> = {}): CommandInput<'count.record'> => ({
  id: newId(),
  placeId: where.placeId ?? null,
  caseId: where.caseId ?? null,
  startedAt: '2026-10-03T09:05:00.000Z',
  finishedAt: '2026-10-03T09:40:00.000Z',
  by: null,
  items: [],
  unknown: [],
  products: [],
  summary: { expected: 0, found: 0, ...none },
  ...more,
})

/** Bay A3 with two speakers, one already moved to Bay B1 since the count; an amp rack; XLRs counted; Cian on the Crew tab. */
async function warehouse(app: FastifyInstance) {
  await ok(
    app,
    m('place.upsert', { id: 'a3', name: 'Bay A3', notes: '' }),
    m('place.upsert', { id: 'b1', name: 'Bay B1', notes: '' }),
    m('model.create', { id: 'y10p', name: 'd&b Y10P', department: 'audio', category: '', tracking: 'serialised', isCase: false, valueCents: null, notes: '' }),
    m('model.create', { id: 'rack', name: 'Amp rack', department: 'audio', category: '', tracking: 'serialised', isCase: true, valueCents: null, notes: '' }),
    m('model.create', { id: 'xlr', name: 'XLR 10 m', department: 'audio', category: '', tracking: 'bulk', isCase: false, valueCents: null, notes: '' }),
    m('asset.add', { id: 's1', modelId: 'y10p', number: null, serial: '', placeId: 'a3', caseId: null, notes: '', fromCount: false }),
    m('asset.add', { id: 's2', modelId: 'y10p', number: null, serial: '', placeId: 'a3', caseId: null, notes: '', fromCount: false }),
    m('asset.add', { id: 'r1', modelId: 'rack', number: null, serial: '', placeId: 'a3', caseId: null, notes: '', fromCount: false }),
    m('stock.set', { modelId: 'xlr', placeId: 'a3', caseId: null, qty: 120 }),
    m('person.upsert', { id: 'cian', name: 'Cian Murphy', kind: 'staff', email: 'cian@sessionhire.com', phone: null, skills: [], dayRateCents: null, notes: '' })
  )
}

const bayA3 = (by: string | null = 'cian') =>
  record(
    { placeId: 'a3' },
    {
      by,
      items: [
        { assetId: 's1', said: 'found', scanned: true },
        { assetId: 's2', said: 'not-found', scanned: false },
        { assetId: 'r1', said: 'found', scanned: true },
      ],
      products: [{ modelId: 'xlr', recorded: 120, counted: 95, away: 20 }],
      summary: { expected: 3, found: 2, ...none, notFound: 1, short: 1 },
    }
  )

describe('a count', () => {
  it('is kept whatever has changed since, and turned down only for a place or case that never existed', async () => {
    // Proves: a count of Bay A3 is kept as the phone said it, with who counted, even though one speaker has moved and
    // the place was removed since; sent twice it's kept once. A count of a case is kept, and so is one of a case made
    // plain since. Only a place or a case the server never had (here, ones made on a phone and turned down, and a
    // speaker, which never held anything) refuses it, and the reason says which.
    const { app, db } = await server()
    await warehouse(app)
    const count = bayA3()
    await ok(app, m('asset.move', { id: 's1', placeId: 'b1', caseId: null }), m('count.record', count))
    await ok(app, m('count.record', count))
    const kept = (await counts(app)).get(count.id)!
    expect(kept).toEqual({ ...count, by: 'cian' })

    // A place removed since keeps its counts; one counted after it went is kept too.
    await ok(app, m('place.upsert', { id: 'gone', name: 'Old shelf', notes: '' }), m('place.remove', { id: 'gone' }))
    await ok(app, m('count.record', record({ placeId: 'gone' })), m('count.record', record({ caseId: 'r1' })))
    expect((await db.query(`SELECT count(*)::int AS n FROM counts`)).rows[0]).toEqual({ n: 3 })

    expect(await refused(app, m('count.record', record({ placeId: 'never' })))).toBe("The place counted was never saved, so the count wasn't kept. Count it again from the place's page.")
    expect(await refused(app, m('count.record', record({ caseId: 'never' })))).toBe(
      "The case counted was never added to the stock list, so the count wasn't kept. Add it, then count it again."
    )
    expect(await refused(app, m('count.record', record({ caseId: 's1' })))).toBe("SH-000001 (d&b Y10P) doesn't hold other kit, so the count wasn't kept.")
    await ok(
      app,
      m('model.create', { id: 'flight', name: 'Flight case', department: 'audio', category: '', tracking: 'serialised', isCase: true, valueCents: null, notes: '' }),
      m('asset.add', { id: 'f1', modelId: 'flight', number: null, serial: '', placeId: 'a3', caseId: null, notes: '', fromCount: false }),
      m('model.update', { id: 'flight', isCase: false }),
      m('count.record', record({ caseId: 'f1' }))
    )
    // The phone checks the rest before it sends: a count is of a place or a case.
    expect(await refused(app, m('count.record', { ...record({ placeId: 'a3' }), caseId: 'r1' }))).toBe('Say what was counted: a place or a case.')
  })

  it('says who counted: the signed-in person, or whoever the phone says while sign-in is off, and nobody it can’t name', async () => {
    // Proves: with sign-in off the phone's pick is kept; someone not on the Crew tab is left out, not refused; with
    // sign-in on, the signed-in person matched by email, whatever the phone says; an account matched to nobody, nobody.
    const { app } = await server()
    await warehouse(app)
    const [offPick, nobody] = [bayA3('cian'), bayA3('someone-else')]
    await ok(app, m('count.record', offPick), m('count.record', nobody))
    const kept = await counts(app)
    expect([kept.get(offPick.id)!.by, kept.get(nobody.id)!.by]).toEqual(['cian', null])

    const signed = await signedInServer()
    const colly = await staff(signed.app, signed.db, 'Colly Hewson', IPHONE, 'phonec0ffee')
    expect(await colly.send('place.upsert', { id: 'a3', name: 'Bay A3', notes: '' })).toMatchObject({ status: 'applied' })
    const before = record({ placeId: 'a3' }, { by: null })
    expect(await colly.send('count.record', before)).toMatchObject({ status: 'applied' })
    expect((await colly.record<Count>('count', before.id)).by).toBeNull()
    await colly.send('person.upsert', { id: 'colly', name: 'Colly Hewson', kind: 'staff', email: colly.email, phone: null, skills: [], dayRateCents: null, notes: '' })
    const after = record({ placeId: 'a3' }, { by: 'someone-else' })
    expect(await colly.send('count.record', after)).toMatchObject({ status: 'applied' })
    expect((await colly.record<Count>('count', after.id)).by).toBe('colly')
  })

  it('says in the history what it found, and in the item log what it said of each item', async () => {
    // Proves: the history's words name who counted, as the count was kept, where, and the summary; one naming someone
    // not on the Crew tab says nobody, as the count does; a case is named by its number. The item log says found, not
    // found, and found though kept elsewhere, keyed as the phone keys it, and says nothing of kit away.
    const { app } = await server()
    await warehouse(app)
    const count = bayA3()
    const elsewhere: CountItem = { assetId: 's1', said: 'elsewhere', scanned: true, placeId: 'b1', caseId: null }
    const ofRack = record({ caseId: 'r1' }, { items: [elsewhere, { assetId: 's2', said: 'out', scanned: false, projectId: 'job' }], summary: { expected: 0, found: 0, ...none, elsewhere: 1 } })
    await ok(app, m('count.record', count), m('count.record', ofRack), m('count.record', record({ placeId: 'b1' }, { by: 'someone-else' })))
    const history = (await app.inject({ url: '/api/history' })).json() as HistoryPage
    expect(history.entries.slice(0, 3).map((e) => e.what)).toEqual([
      'Counted Bay B1: All as recorded',
      "Counted what's in SH-000003 (Amp rack): 1 in the wrong place",
      'Cian Murphy counted Bay A3: 2 of 3 found, 1 not found, 1 count short',
    ])
    const log = async (id: string) =>
      ((await app.inject({ url: `/api/stock/items/${id}/log` })).json() as ItemLogPage).entries.filter((e) => e.event.kind === 'counted').map((e) => [e.key, e.event])
    expect(await log('s1')).toEqual([
      [`count:${ofRack.id}`, { kind: 'counted', where: { case: 'SH-000003 (Amp rack)' }, found: true, kept: { place: 'Bay B1' } }],
      [`count:${count.id}`, { kind: 'counted', where: { place: 'Bay A3' }, found: true }],
    ])
    expect(await log('s2')).toEqual([[`count:${count.id}`, { kind: 'counted', where: { place: 'Bay A3' }, found: false }]])
  })

  it('is in the export, described in the README', async () => {
    // Proves: the counts table is in the download as it's kept, and the README says what it holds.
    const signed = await signedInServer()
    const colly = await staff(signed.app, signed.db, 'Colly Hewson', IPHONE, 'phonec0ffee')
    await colly.send('place.upsert', { id: 'a3', name: 'Bay A3', notes: '' })
    const count = record({ placeId: 'a3' })
    await colly.send('count.record', count)
    const res = await signed.app.inject({ url: '/api/export.zip?client=phonec0ffee', cookies: colly.cookies, headers: { 'user-agent': IPHONE } })
    const text = new TextDecoder()
    const files = Object.fromEntries(Object.entries(unzipSync(new Uint8Array(res.rawPayload))).map(([name, data]) => [name, text.decode(data)]))
    expect(JSON.parse(files['everything.json']!).counts).toEqual([expect.objectContaining({ id: count.id, place_id: 'a3', counted_by: null, summary: count.summary })])
    expect(files['tables/counts.csv']).toContain(count.id)
    expect(files['README.txt']).toMatch(/counts\s+1 row\s+Counts of places and cases: where, when they started and finished on the phone, who counted/)
  })

  it('keeps who counted as a pointer when they are erased, reading "Erased person", and every pointer to a person is listed', async () => {
    // Proves: erasing Cian keeps his count and its pointer to him, which the history reads as "Erased person"; a count
    // he made before, arriving afterwards, is kept with nobody named. And every column that points at a person is in
    // one of erasure's lists, so a new one fails here until erasing knows what to do with it.
    const { app, db } = await server()
    await warehouse(app)
    const count = bayA3()
    await ok(app, m('count.record', count), m('person.archive', { id: 'cian', archived: true }), m('person.erase', { id: 'cian' }))
    expect((await db.query(`SELECT counted_by FROM counts WHERE id = $1`, [count.id])).rows).toEqual([{ counted_by: 'cian' }])
    const late = bayA3()
    await ok(app, m('count.record', late))
    expect((await counts(app)).get(late.id)!.by).toBeNull()
    const history = (await app.inject({ url: '/api/history' })).json() as HistoryPage
    expect(history.entries.map((e) => e.what)).toContain('Erased person counted Bay A3: 2 of 3 found, 1 not found, 1 count short')

    const { rows } = await db.query<{ table: string; column: string }>(
      `SELECT c.conrelid::regclass::text AS table, a.attname AS column
         FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND c.confrelid = 'people'::regclass`
    )
    const theirs = new Set([...GONE, ...STRIPPED, ...LEAVE].map((p) => `${p.table}.person_id`))
    const pointers = new Set(POINTERS.map((p) => `${p.table}.${p.column}`))
    for (const r of rows) expect(theirs.has(`${r.table}.${r.column}`) || pointers.has(`${r.table}.${r.column}`), `${r.table}.${r.column}`).toBe(true)
    expect(pointers).toContain('counts.counted_by')
  })

  it('arrives on a database already in use, leaving what is there as it was', async () => {
    // Proves: a database at the stock list's migration, with a place and an item, takes the counts table on the next
    // start, and the place, the item and its number are as they were; a count of the place is then kept.
    const db = await pgliteDb()
    for (const mod of MODULES) await runMigrations(db, mod, mod === STOCK ? STOCK.migrations.length - 1 : undefined)
    expect((await db.query(`SELECT to_regclass('counts')::text AS found`)).rows).toEqual([{ found: null }])
    await db.query(`INSERT INTO places (id, name) VALUES ('a3', 'Bay A3')`)
    await db.query(`INSERT INTO models (id, name, department, tracking) VALUES ('y10p', 'd&b Y10P', 'audio', 'serialised')`)
    await db.query(`INSERT INTO assets (id, model_id, place_id, status) VALUES ('s1', 'y10p', 'a3', 'active')`)
    await db.query(`INSERT INTO identifiers (id, asset_id, kind, value) VALUES ('i1', 's1', 'sh', 'SH-000001')`)
    await db.query(`INSERT INTO changes (entity, entity_id, op, data) VALUES ('place', 'a3', 'put', '{"id": "a3", "name": "Bay A3", "notes": ""}')`)
    const { app } = await server(db)
    expect((await db.query(`SELECT version FROM stock_schema_version`)).rows).toEqual([{ version: STOCK.migrations.length }])
    expect((await db.query(`SELECT a.place_id, i.value FROM assets a JOIN identifiers i ON i.asset_id = a.id`)).rows).toEqual([{ place_id: 'a3', value: 'SH-000001' }])
    const count = record({ placeId: 'a3' }, { items: [{ assetId: 's1', said: 'found', scanned: true }], summary: { expected: 1, found: 1, ...none } })
    await ok(app, m('count.record', count))
    expect((await counts(app)).get(count.id)).toEqual(count)
  })
})
