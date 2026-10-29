import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptySnapshot, FEED, MemoryStorage, newId, type LatestOnly, PUSH_LIMIT, PUSH_SLICE, SyncClient, type PullResponse, type PushRequest, type PushResponse, type Snapshot, type Transport } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp, type AppOptions } from '../src/app.ts'
import { OLDER_APP } from '../src/commands.ts'
import { pgliteDb, type Db, type Queryable } from '../src/db.ts'

/**
 * The sync engine's promises (ADR 0001), as tests: devices with a switch for
 * their signal, and the real server and SQL in between. The Phase 0 sync
 * test's bookings carried them until it went on 2 October 2026; now they run
 * on the warehouse's counted stock, two devices moving the same four
 * speakers out of one bay. A phone still on the old version, holding the
 * sync test's records and commands, carries on.
 */

/** A transport over the in-process app, with a signal switch per device. */
class TestLink implements Transport {
  online = true
  /** Apply the push on the server, then lose the answer on the way back. */
  dropNextResponse = false
  constructor(public app: FastifyInstance) {}

  async push(req: PushRequest): Promise<PushResponse> {
    if (!this.online) throw new Error('offline')
    const res = await this.app.inject({ method: 'POST', url: '/api/sync/push', payload: req })
    if (res.statusCode !== 200) throw new Error(res.body)
    if (this.dropNextResponse) {
      this.dropNextResponse = false
      throw new Error('connection reset')
    }
    return res.json()
  }

  async pull(after: number): Promise<PullResponse> {
    if (!this.online) throw new Error('offline')
    const res = await this.app.inject({ method: 'GET', url: `/api/sync/pull?after=${after}` })
    return res.json()
  }
}

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

async function server(db?: Db, options: Omit<AppOptions, 'db'> = {}) {
  const database = db ?? (await pgliteDb())
  const app = await buildApp({ db: database, ...options })
  cleanup.push(async () => {
    await app.close()
    if (!db) await database.close()
  })
  return app
}

async function device(app: FastifyInstance, storage = new MemoryStorage()) {
  const link = new TestLink(app)
  const client = await new SyncClient({ storage, transport: link }).open()
  return { link, client, storage }
}

/** Counted, not numbered, so how many are where is all there is to them. */
const Y10P = { id: 'y10p', name: 'd&b Y10P', department: 'audio', category: 'Speakers', tracking: 'bulk', isCase: false, valueCents: null, notes: '' } as const
const PLACES = [
  { id: 'a3', name: 'Bay A3', notes: '' },
  { id: 'van1', name: 'Van 1', notes: '' },
  { id: 'van2', name: 'Van 2', notes: '' },
]
const move = (qty: number, from: string, to: string) => ({ modelId: 'y10p', fromPlaceId: from, fromCaseId: null, toPlaceId: to, toCaseId: null, qty })

/** The office counts four speakers in Bay A3, with two vans to move them to. */
async function seed(app: FastifyInstance) {
  const office = await device(app)
  await office.client.mutate('model.create', Y10P)
  for (const p of PLACES) await office.client.mutate('place.upsert', p)
  await office.client.mutate('stock.set', { modelId: 'y10p', placeId: 'a3', caseId: null, qty: 4 })
  await office.client.sync()
  return office
}

/** Where this device sees the speakers, and whether that's still waiting to sync: "van1 4 waiting". */
const counts = (d: { client: SyncClient }) =>
  d.client
    .view()
    .warehouse.models.find((m) => m.id === 'y10p')!
    .counted.map((c) => `${c.placeId} ${c.qty}${c.pending ? ' waiting' : ''}`)
    .sort()

describe('two people, four speakers, no signal', () => {
  it('makes the first move and turns the second down with a reason', async () => {
    // Proves: two devices offline move the same four speakers; on reconnect the first is made, the second is a problem with the reason, and both devices agree.
    const app = await server()
    await seed(app)
    const aoife = await device(app)
    const dara = await device(app)
    await aoife.client.sync()
    await dara.client.sync()

    aoife.link.online = false
    dara.link.online = false
    await aoife.client.mutate('stock.move', move(4, 'a3', 'van1'))
    await dara.client.mutate('stock.move', move(4, 'a3', 'van2'))

    // Offline, each sees their own move, waiting.
    await expect(aoife.client.sync()).rejects.toThrow('offline')
    expect(aoife.client.view().connection).toBe('offline')
    expect(counts(aoife)).toEqual(['van1 4 waiting'])
    expect(counts(dara)).toEqual(['van2 4 waiting'])

    aoife.link.online = true
    dara.link.online = true
    await aoife.client.sync()
    await dara.client.sync()
    await aoife.client.sync()

    // Aoife's went first and stands; Dara's is a problem to resolve, not a
    // silent undo, and both devices agree on where the speakers are.
    for (const d of [aoife, dara]) {
      expect(counts(d)).toEqual(['van1 4'])
      expect(d.client.view().pendingCount).toBe(0)
    }
    const problems = dara.client.view().problems
    expect(problems).toHaveLength(1)
    expect(problems[0]!.reason).toMatchObject({ code: 'short', short: 4 })
    expect(problems[0]!.reason.message).toBe('Only 0 × d&b Y10P counted at Bay A3, not 4. Count them again first.')
    expect(aoife.client.view().problems).toHaveLength(0)
  })

  it("judges each change in a batch on what the ones before it left, and turns down only the one that doesn't fit", async () => {
    // Proves: one push of three moves applies in order; the second, which the first left short, is the only problem, with its own
    // arguments, and the third, which fits, still goes through after it.
    const app = await server()
    const office = await seed(app)
    await office.client.mutate('stock.move', move(2, 'a3', 'van1'))
    await office.client.mutate('stock.move', move(3, 'a3', 'van2'))
    await office.client.mutate('stock.move', move(2, 'a3', 'van2'))
    await office.client.sync()
    expect(counts(office)).toEqual(['van1 2', 'van2 2'])
    expect(office.client.view().problems.map((p) => p.mutation.args)).toEqual([expect.objectContaining({ qty: 3, toPlaceId: 'van2' })])
  })

  it('applies a batch in order, so a change can rely on the one before it', async () => {
    // Proves: a move out of Van 1 straight after a move into it, sent together, goes through: the server takes a device's changes in the order it made them.
    const app = await server()
    const office = await seed(app)
    await office.client.mutate('stock.move', move(4, 'a3', 'van1'))
    await office.client.mutate('stock.move', move(4, 'van1', 'van2'))
    await office.client.sync()
    expect(office.client.view().problems).toHaveLength(0)
    expect(counts(office)).toEqual(['van2 4'])
  })
})

describe('nothing is lost, nothing is doubled', () => {
  it('applies a mutation once when the answer is lost and the device resends', async () => {
    // Proves: a push applied on the server whose answer never arrived is sent again and answered as a duplicate, not made twice.
    const app = await server()
    const office = await seed(app)
    office.link.dropNextResponse = true
    await office.client.mutate('stock.move', move(3, 'a3', 'van1'))
    await expect(office.client.sync()).rejects.toThrow('connection reset')
    expect(office.client.view().pendingCount).toBe(1)

    // The resend would be "only 1 counted" if it were applied a second time.
    await office.client.sync()
    expect(office.client.view().problems).toHaveLength(0)
    expect(counts(office)).toEqual(['a3 1', 'van1 3'])
    const exported = (await app.inject('/api/export')).json()
    expect(exported.stock.map((s: { place_id: string; qty: number }) => `${s.place_id} ${s.qty}`).sort()).toEqual(['a3 1', 'van1 3'])
  })

  it('keeps the outbox across a reload of the app', async () => {
    // Proves: a change made with no signal is saved before anything else, so the app opened again from storage still has it to send.
    const app = await server()
    await seed(app)
    const storage = new MemoryStorage()
    const phone = await device(app, storage)
    phone.link.online = false
    await phone.client.mutate('stock.move', move(1, 'a3', 'van1'))

    // The phone dies and the app is opened again from storage.
    const reopened = await device(app, storage)
    expect(reopened.client.view().pendingCount).toBe(1)
    await reopened.client.sync()
    expect(counts(reopened)).toEqual(['a3 3', 'van1 1'])
  })

  it('survives the server restarting between two syncs', async () => {
    // Proves: a push applied just before the server stopped, its answer lost, is recognised by the next server on the same database and not made twice.
    const dir = mkdtempSync(join(tmpdir(), 'sh-sync-'))
    cleanup.push(async () => rmSync(dir, { recursive: true, force: true }))

    let db = await pgliteDb(dir)
    let app = await buildApp({ db })
    const office = await device(app)
    await office.client.mutate('model.create', Y10P)
    for (const p of PLACES) await office.client.mutate('place.upsert', p)
    await office.client.mutate('stock.set', { modelId: 'y10p', placeId: 'a3', caseId: null, qty: 4 })
    await office.client.mutate('stock.move', move(2, 'a3', 'van1'))
    office.link.dropNextResponse = true
    await expect(office.client.sync()).rejects.toThrow()
    await app.close()
    await db.close()

    // New process, same database.
    db = await pgliteDb(dir)
    app = await buildApp({ db })
    cleanup.push(async () => {
      await app.close()
      await db.close()
    })
    office.link.app = app
    await office.client.sync()
    const v = office.client.view()
    expect(v.pendingCount).toBe(0)
    expect(v.problems).toEqual([])
    expect(counts(office)).toEqual(['a3 2', 'van1 2'])
    expect(v.warehouse.places.map((p) => p.name)).toEqual(['Bay A3', 'Van 1', 'Van 2'])
  })
})

describe('scans are facts', () => {
  it('keeps scans made offline that go beyond the plan, and turns none of them down', async () => {
    // Proves: kit counted out with no signal, more than the job's kit asks for, is kept on sync, and the pick list shows it out.
    const app = await server()
    const office = await seed(app)
    await office.client.mutate('project.create', { id: 'nissan', name: 'Nissan launch', clientId: null, venueId: null, status: 'confirmed', notes: '' })
    await office.client.mutate('kit.add', { id: 'k1', projectId: 'nissan', phaseId: null, modelId: 'y10p', qty: 1, subhireQty: 0, supplier: '', notes: '' })
    await office.client.sync()

    const warehouse = await device(app)
    await warehouse.client.sync()
    warehouse.link.online = false
    for (const n of [1, 2]) {
      await warehouse.client.mutate('move.record', { id: `s${n}`, projectId: 'nissan', direction: 'out', assetId: null, modelId: 'y10p', qty: 1, at: `2026-10-04T08:0${n}:00Z` })
    }
    expect(warehouse.client.view().pendingCount).toBe(2)

    warehouse.link.online = true
    await warehouse.client.sync()
    const v = warehouse.client.view()
    expect(v.pendingCount).toBe(0)
    expect(v.problems).toHaveLength(0)
    expect(v.moves.pickList('nissan')!.rows).toEqual([expect.objectContaining({ modelId: 'y10p', need: 1, counted: 2, out: 2 })])
  })
})

describe('audit and export', () => {
  it('records who asked, when they did it and when it arrived', async () => {
    // Proves: every change a device sends is kept with its device, when it was made and when it arrived, and is in the export.
    const app = await server()
    const office = await seed(app)
    const { mutations } = (await app.inject('/api/export')).json()
    expect(mutations.map((m: { name: string }) => m.name)).toEqual(['model.create', 'place.upsert', 'place.upsert', 'place.upsert', 'stock.set'])
    for (const m of mutations) {
      expect(m).toMatchObject({ client_id: office.client.clientId, status: 'applied' })
      expect(m.created_at).toBeTruthy()
      expect(m.received_at).toBeTruthy()
    }
  })

  it('turns a malformed push away whole, without touching data', async () => {
    // Proves: a push that isn't one (a change with no id) is refused with a 400 and nothing is kept.
    const app = await server()
    const res = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'x', mutations: [{ name: 'place.upsert', args: {}, createdAt: '' }] } })
    expect(res.statusCode).toBe(400)
    expect((await app.inject('/api/export')).json().mutations).toEqual([])
  })
})

describe('a command the app no longer has', () => {
  it('is turned down on its own, in plain words, keeping nothing, and the rest of the push goes through', async () => {
    // Proves: the old sync test's booking.create, or any name this version doesn't know, answers 200 with that change refused,
    // writes nothing (not even to the history), gets the same answer when sent again, and the change after it applies.
    const app = await server()
    const createdAt = new Date().toISOString()
    const old = { id: 'old', name: 'booking.create', args: { id: 'b1', productId: 'y10p', project: 'Nissan', qty: 4, start: '2026-10-05', end: '2026-10-05' }, createdAt }
    const odd = { id: 'odd', name: 'constructor', args: {}, createdAt }
    const good = { id: 'good', name: 'place.upsert', args: PLACES[0], createdAt }
    const push = () => app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'old-phone', mutations: [old, odd, good] } })
    const res = await push()
    expect(res.statusCode).toBe(200)
    const refused = { status: 'rejected', reason: { code: 'invalid', message: "The app doesn't do this any more, so it wasn't made." } }
    expect(res.json().results).toEqual([{ id: 'old', ...refused }, { id: 'odd', ...refused }, expect.objectContaining({ id: 'good', status: 'applied' })])
    const exported = (await app.inject('/api/export')).json()
    expect(exported.mutations.map((m: { id: string }) => m.id)).toEqual(['good'])
    expect(exported).not.toHaveProperty('bookings')

    // Sent again, as a phone does until it hears back: the same answer, and still nothing kept.
    expect((await push()).json().results.slice(0, 2)).toEqual([{ id: 'old', ...refused }, { id: 'odd', ...refused }])
    expect((await app.inject('/api/export')).json().mutations).toHaveLength(1)
  })

  it('says plainly the app needs updating when a change leaves out something this version needs', async () => {
    // Proves: a field an older version of the app didn't send is answered in words that say what to do, not "Required"
    // (audit, P3: words); a value that's wrong keeps its own reason.
    const app = await server()
    const createdAt = new Date().toISOString()
    const older = { id: 'older', name: 'place.upsert', args: { id: 'a9', name: 'Bay A9' }, createdAt }
    const wrong = { id: 'wrong', name: 'place.upsert', args: { id: 'a9', name: 42, notes: '' }, createdAt }
    const res = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'old-phone', mutations: [older, wrong] } })
    const [first, second] = res.json().results
    expect(first.reason).toEqual({ code: 'invalid', message: OLDER_APP })
    expect(OLDER_APP).toContain('older version of the app')
    expect(second.reason.message).not.toBe(OLDER_APP)
  })

  it('leaves a phone still on the old version working: its sync test records sit unused and its waiting booking becomes a problem', async () => {
    // Proves: a saved copy from before, holding the sync test's products, bookings, scans and issues and a booking in its outbox,
    // opens and builds every screen's view, sends the rest of its outbox, and lists the booking as not done with the server's reason.
    const app = await server()
    await seed(app)
    const storage = new MemoryStorage()
    const before = emptySnapshot('oldphone')
    const tables = before.entities as unknown as Record<string, Record<string, unknown>>
    tables.product = { y10p: { id: 'y10p', name: 'd&b Y10P', quantity: 4 } }
    tables.booking = { b0: { id: 'b0', productId: 'y10p', project: 'Fuel', qty: 4, start: '2026-10-05', end: '2026-10-05', status: 'confirmed' } }
    tables.scan = {}
    tables.issue = { i0: { id: 'i0', kind: 'scan-over-booking', message: '2 scanned out for Fuel, but only 1 booked.', scanId: 's0', resolved: false } }
    before.outbox = [
      { id: 'b1', name: 'booking.create', args: { id: 'b1', productId: 'y10p', project: 'Nissan', qty: 4, start: '2026-10-05', end: '2026-10-05' }, createdAt: '2026-10-01T09:00:00Z' } as never,
      { id: 'p1', name: 'place.upsert', args: { id: 'van3', name: 'Van 3', notes: '' }, createdAt: '2026-10-01T09:01:00Z' },
    ]
    await storage.save(before satisfies Snapshot)

    const phone = await device(app, storage)
    expect(phone.client.view().pendingCount).toBe(2)
    await phone.client.sync()
    const v = phone.client.view()
    expect(v.pendingCount).toBe(0)
    expect(v.problems).toMatchObject([{ mutation: { id: 'b1', name: 'booking.create' }, reason: { message: "The app doesn't do this any more, so it wasn't made." } }])
    expect(v.warehouse.places.map((p) => p.name)).toEqual(['Bay A3', 'Van 1', 'Van 2', 'Van 3'])
    expect(counts(phone)).toEqual(['a3 4'])
    await phone.client.dismissProblem('b1')
    expect(phone.client.view().problems).toEqual([])
  })
})

describe('one bad change in a batch', () => {
  it("turns down a date that isn't real with a plain reason, and still applies the change after it", async () => {
    // Proves: a change Postgres would choke on is refused on its own in plain words; the change after it in the same push applies.
    const app = await server()
    const createdAt = new Date().toISOString()
    const phase = (id: string, day: string) => ({ id, projectId: 'j', name: id, start: day, end: day, venueId: null, notes: '' })
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      payload: {
        clientId: 'phone',
        mutations: [
          { id: 'job', name: 'project.create', args: { id: 'j', name: 'Nissan launch', clientId: null, venueId: null, status: 'confirmed', notes: '' }, createdAt },
          { id: 'bad', name: 'phase.add', args: phase('bad', '2026-02-31'), createdAt },
          { id: 'good', name: 'phase.add', args: phase('good', '2026-10-05'), createdAt },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().results).toEqual([
      expect.objectContaining({ id: 'job', status: 'applied' }),
      { id: 'bad', status: 'rejected', reason: { code: 'invalid', message: "That isn't a real date." } },
      expect.objectContaining({ id: 'good', status: 'applied' }),
    ])
    const exported = (await app.inject('/api/export')).json()
    expect(exported.phases.map((p: { id: string }) => p.id)).toEqual(['good'])
  })
})

/**
 * A database standing in for one at a distance, or one a test can step in on: `before` runs ahead of every query, in a
 * transaction too, and may wait, count or slip something in.
 */
function steppedDb(db: Db, before: (sql: string) => Promise<void>): Db {
  const stepped = (q: Queryable): Queryable => ({
    query: async (sql, params) => {
      await before(sql)
      return q.query(sql, params)
    },
    exec: (sql) => q.exec(sql),
  })
  return { ...db, ...stepped(db), reads: stepped(db.reads), transaction: (fn, o) => db.transaction((tx) => fn(stepped(tx)), o) }
}

describe('a pull answered while another change lands (audit, 18 October 2026)', () => {
  it('keeps the device where it was when it finds nothing new, so the change that landed comes with the next pull', async () => {
    // Proves: a change committed after the pull read its page and before it read the head of the feed is not jumped over:
    // the empty page leaves the device's cursor as it was, and its next pull brings the change.
    const plain = await pgliteDb()
    cleanup.push(() => plain.close())
    let slipIn: (() => Promise<unknown>) | undefined
    const db = steppedDb(plain, async (sql) => {
      if (!slipIn || !sql.includes('AS head')) return
      const go = slipIn
      slipIn = undefined
      await go()
    })
    // And it's reported, as what usually means writes are slow to commit (audit finding 19).
    const reported: Error[] = []
    const app = await server(db, { report: (err) => void reported.push(err as Error) })
    const office = await seed(app)
    const laptop = await device(app)
    await laptop.client.sync()
    const before = laptop.client.cursor

    // Between the laptop's two reads, the office moves two speakers.
    slipIn = async () => {
      await office.client.mutate('stock.move', move(2, 'a3', 'van1'))
      await office.client.sync()
    }
    await laptop.client.sync()
    expect(slipIn).toBeUndefined()
    expect(laptop.client.cursor).toBe(before)
    expect(reported.map((e) => e.message)).toEqual([`A pull found nothing after ${before}, with the head of the feed at ${office.client.cursor}`])

    await laptop.client.sync()
    expect(counts(laptop)).toEqual(['a3 2', 'van1 2'])
    expect(reported).toHaveLength(1)
    expect(laptop.client.cursor).toBe(office.client.cursor)
  })

  it('reads every copy pulled before the fix again from the start, once, keeping what it has waiting', async () => {
    // Proves: a copy saved before the fix, moved past a change it never got, is told FEED and reads the feed again from the
    // start, so the change it missed lands; the change it had waiting is kept and goes through; it reads from 0 only once.
    const app = await server()
    const office = await seed(app)
    await office.client.mutate('stock.move', move(1, 'a3', 'van1'))
    await office.client.mutate('stock.move', move(1, 'a3', 'van2'))
    await office.client.sync()
    const head = office.client.cursor

    // The phone's copy holds everything but the move to Van 2, as if a pull had stepped over it, and it isn't marked as read.
    const storage = new MemoryStorage()
    const full = (await (office as { storage: MemoryStorage }).storage.load())!
    const missed: Snapshot = { ...emptySnapshot('phone'), cursor: head, entities: structuredClone(full.entities) }
    delete (missed.entities as Record<string, Record<string, unknown>>).stock![Object.keys(full.entities.stock).find((k) => k.includes('van2'))!]
    missed.outbox = [{ id: 'waiting', name: 'stock.move', args: move(1, 'a3', 'van1'), createdAt: new Date().toISOString() }] as Snapshot['outbox']
    await storage.save(missed)
    const pulls: number[] = []
    const phone = await device(app, storage)
    const pull = phone.link.pull.bind(phone.link)
    phone.link.pull = (after) => (pulls.push(after), pull(after))

    expect(counts(phone)).toEqual(['a3 1 waiting', 'van1 2 waiting'])
    await phone.client.sync()
    expect(pulls).toEqual([head, 0])
    expect(counts(phone)).toEqual(['a3 1', 'van1 2', 'van2 1'])
    expect(phone.client.view().pendingCount).toBe(0)
    expect(await storage.load()).toMatchObject({ feed: FEED, outbox: [] })

    pulls.length = 0
    await phone.client.sync()
    expect(pulls).toEqual([phone.client.cursor])
  })
})

describe('a phone with a long backlog, far from its database (audit, 18 October 2026)', { timeout: 120_000 }, () => {
  it(`gets ${PUSH_LIMIT} changes through in pushes that are each answered in time, and a resend of them all is answered from one query`, async () => {
    // Proves: with every trip to the database slowed, as from Railway to Neon, a phone sends its backlog PUSH_SLICE at a time;
    // the server answers each push with what it got done inside its time, so no push outlasts the phone's wait; the backlog
    // drains over several pushes in one sync, every change applied once and in order; and the same changes sent again at once,
    // as an older phone sends them, are all answered as already made, from a single query.
    const wait = 1500
    let queries = 0
    const plain = await pgliteDb()
    cleanup.push(() => plain.close())
    const db = steppedDb(plain, async () => {
      queries++
      await new Promise((r) => setTimeout(r, 1))
    })
    const app = await buildApp({ db, pushBudgetMs: 400 })
    cleanup.push(() => app.close())
    await seed(app)

    const phone = await device(app)
    await phone.client.sync()
    const took: number[] = []
    const push = phone.link.push.bind(phone.link)
    phone.link.push = async (req) => {
      const started = Date.now()
      const timer = new Promise<never>((_, fail) => setTimeout(() => fail(new Error('The phone gave up waiting')), wait))
      try {
        return await Promise.race([push(req), timer])
      } finally {
        took.push(Date.now() - started)
      }
    }
    phone.link.online = false
    for (let i = 0; i < PUSH_LIMIT; i++) await phone.client.mutate('place.upsert', { id: `shelf${i}`, name: `Shelf ${i}`, notes: '' })
    phone.link.online = true

    await phone.client.sync()
    expect(phone.client.view()).toMatchObject({ connection: 'idle', pendingCount: 0, problems: [] })
    expect(took.length).toBeGreaterThan(PUSH_LIMIT / PUSH_SLICE)
    expect(Math.max(...took)).toBeLessThan(wait)
    const { rows } = await plain.query<{ id: string }>(`SELECT entity_id AS id FROM changes WHERE entity = 'place' AND entity_id LIKE 'shelf%' ORDER BY seq`)
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: PUSH_LIMIT }, (_, i) => `shelf${i}`))

    // An older phone, its answer lost, sends all of them again in one push.
    const { rows: sent } = await plain.query<{ id: string; name: string; args: unknown; created_at: Date }>(
      `SELECT id, name, args, created_at FROM mutations WHERE name = 'place.upsert' AND args->>'id' LIKE 'shelf%' ORDER BY received_at`
    )
    queries = 0
    const started = Date.now()
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      payload: { clientId: phone.client.clientId, mutations: sent.map((m) => ({ id: m.id, name: m.name, args: m.args, createdAt: m.created_at.toISOString() })) },
    })
    expect(Date.now() - started).toBeLessThan(wait)
    expect(queries).toBe(1)
    const results = res.json().results as { status: string; duplicate?: boolean }[]
    expect(results).toHaveLength(PUSH_LIMIT)
    expect(results.every((r) => r.status === 'applied' && r.duplicate)).toBe(true)
  })
})

/** A transport that asks for only the latest of each record when the device does (unless told to read every change, as before), counting what it's sent. */
class LatestLink extends TestLink {
  sent = 0
  asked: (LatestOnly | undefined)[] = []
  constructor(app: FastifyInstance, private readonly everyChange = false) {
    super(app)
  }
  override async pull(after: number, latest?: LatestOnly): Promise<PullResponse> {
    if (!this.online) throw new Error('offline')
    this.asked.push(latest)
    const asking = latest !== undefined && !this.everyChange
    const res = (await this.app.inject({ method: 'GET', url: `/api/sync/pull?after=${after}${asking ? `&latest=${latest}` : ''}` })).json() as PullResponse
    this.sent += res.changes.length
    return res
  }
}

/** A device beginning empty: one that asks for the latest only, or one that reads every change, as before. */
async function newDevice(app: FastifyInstance, latest: boolean) {
  const link = new LatestLink(app, !latest)
  const storage = new MemoryStorage()
  const client = await new SyncClient({ storage, transport: link }).open()
  return { link, client, storage }
}

/** What a copy holds, without the tables it holds nothing in, to compare one copy with another. */
async function held(d: { storage: MemoryStorage; client: SyncClient }) {
  const saved = (await d.storage.load())!
  const entities = Object.fromEntries(Object.entries(saved.entities).filter(([, t]) => Object.keys(t).length > 0))
  return { entities, cursor: saved.cursor, latest: saved.latest }
}

describe('a new device reads the records as they are, not every change ever made (audit finding 17)', () => {
  /** Speakers moved back and forth, and shelves made and taken away again: far more changes than records. */
  async function busy(app: FastifyInstance) {
    const office = await seed(app)
    for (let i = 0; i < 6; i++) {
      await office.client.mutate('stock.move', move(2, 'a3', 'van1'))
      await office.client.mutate('stock.move', move(2, 'van1', 'a3'))
    }
    for (let i = 0; i < 5; i++) await office.client.mutate('place.upsert', { id: `shelf${i}`, name: `Shelf ${i}`, notes: '' })
    for (let i = 0; i < 3; i++) await office.client.mutate('place.remove', { id: `shelf${i}` })
    await office.client.mutate('place.upsert', { id: 'shelf4', name: 'Shelf 4, top', notes: '' })
    await office.client.sync()
    return office
  }

  it('ends with the same copy as a device that read every change, sent far fewer, in pages, and reads on from there', async () => {
    // Proves: a device that begins empty asks for the latest of each record, a few at a time, and ends holding exactly what a
    // device that read the whole feed holds, at the same cursor; it was sent fewer changes, none of them deletes from before
    // it began; and once it's read to the end it asks for the feed as it is, for what's new.
    const app = await server(undefined, { pullLimit: 4 })
    const office = await busy(app)
    const replayed = await newDevice(app, false)
    const fresh = await newDevice(app, true)
    await replayed.client.sync()
    await fresh.client.sync()

    expect(await held(fresh)).toEqual(await held(replayed))
    expect(fresh.client.cursor).toBe(office.client.cursor)
    expect(counts(fresh)).toEqual(['a3 4'])
    expect(fresh.link.sent).toBeLessThan(replayed.link.sent / 2)
    expect(fresh.link.asked[0]).toBe('new')
    expect(fresh.link.asked.length).toBeGreaterThanOrEqual(2)
    expect(fresh.link.asked.slice(1).every((a) => typeof a === 'number' && a > 0)).toBe(true)
    expect((await held(fresh)).latest).toBeUndefined()

    // What's new after comes as the feed has it, deletes and all.
    await office.client.mutate('place.remove', { id: 'shelf3' })
    await office.client.mutate('stock.move', move(1, 'a3', 'van2'))
    await office.client.sync()
    fresh.link.asked.length = 0
    await fresh.client.sync()
    await replayed.client.sync()
    expect(fresh.link.asked).toEqual([undefined])
    expect(await held(fresh)).toEqual(await held(replayed))
    expect(counts(fresh)).toEqual(['a3 3', 'van2 1'])
  })

  it('loses nothing changed or deleted while it reads', async () => {
    // Proves: a record sent on the first page and changed again before the read ends comes again as it is then; one deleted
    // after the read began is deleted, its delete sent, though deletes from before it began are not.
    const app = await server(undefined, { pullLimit: 3 })
    const office = await busy(app)
    const fresh = await newDevice(app, true)
    const replayed = await newDevice(app, false)

    // After the first page: Bay A3 and Shelf 4 change, and Shelf 3 goes.
    let pages = 0
    const pull = fresh.link.pull.bind(fresh.link)
    fresh.link.pull = async (after, latest) => {
      const res = await pull(after, latest)
      if (++pages === 1) {
        expect(res.more).toBe(true)
        expect(res.changes.map((c) => c.id)).toContain('a3')
        await office.client.mutate('place.upsert', { id: 'a3', name: 'Bay A3 (back wall)', notes: '' })
        await office.client.mutate('place.upsert', { id: 'shelf4', name: 'Shelf 4, bottom', notes: '' })
        await office.client.mutate('place.remove', { id: 'shelf3' })
        await office.client.mutate('stock.move', move(1, 'a3', 'van1'))
        await office.client.sync()
      }
      return res
    }
    await fresh.client.sync()
    await replayed.client.sync()

    expect(await held(fresh)).toEqual(await held(replayed))
    expect(fresh.client.cursor).toBe(office.client.cursor)
    expect(counts(fresh)).toEqual(['a3 3', 'van1 1'])
    const places = Object.values((await held(fresh)).entities.place as Record<string, { name: string }>).map((p) => p.name).sort()
    expect(places).toEqual(['Bay A3 (back wall)', 'Shelf 4, bottom', 'Van 1', 'Van 2'])
  })

  it('jumps over no change that lands as its last page is answered (P0 finding 1)', async () => {
    // Proves: a page of the latest that isn't full moves the cursor only as far as the feed went as that page was read, in
    // the same statement, so a change committed after it and before the rest of the answer comes with the next pull.
    const plain = await pgliteDb()
    cleanup.push(() => plain.close())
    let slipIn: (() => Promise<unknown>) | undefined
    const db = steppedDb(plain, async (sql) => {
      if (!slipIn || !sql.includes('AS head')) return
      const go = slipIn
      slipIn = undefined
      await go()
    })
    const app = await server(db)
    const office = await busy(app)
    const fresh = await newDevice(app, true)
    slipIn = async () => {
      await office.client.mutate('stock.move', move(1, 'a3', 'van2'))
      await office.client.sync()
    }
    await fresh.client.sync()
    expect(slipIn).toBeUndefined()
    expect(fresh.link.asked).toEqual(['new'])
    expect(fresh.client.cursor).toBeLessThan(office.client.cursor)
    await fresh.client.sync()
    expect(counts(fresh)).toEqual(['a3 3', 'van2 1'])
    expect(fresh.client.cursor).toBe(office.client.cursor)
    const replayed = await newDevice(app, false)
    await replayed.client.sync()
    expect(await held(fresh)).toEqual(await held(replayed))
  })

  it("reads the feed as it is while a change of its own is on its way back, and from a server that doesn't know latest", async () => {
    // Proves: a device with a change of its own applied but not yet read back never asks for the latest only, so the change
    // can't vanish from its screen while the record waits on a later page; and an answer without `latest`, from a server
    // older than it, leaves the device reading every change, as before. Either way it ends where the feed does.
    const app = await server(undefined, { pullLimit: 3 })
    const office = await busy(app)
    const phone = await newDevice(app, true)
    phone.link.online = false
    await phone.client.mutate('place.upsert', { id: 'van3', name: 'Van 3', notes: '' }).catch(() => {})
    phone.link.online = true
    await phone.client.sync()
    expect(phone.link.asked.every((a) => a === undefined)).toBe(true)
    expect(phone.client.cursor).toBe(office.client.cursor + 1)

    // An older server: nothing says latest, so the phone reads every change.
    const older = await newDevice(app, true)
    const pull = older.link.pull.bind(older.link)
    older.link.pull = async (after, latest) => {
      const { latest: _, ...res } = await pull(after, latest)
      return res
    }
    await older.client.sync()
    expect(older.link.asked[0]).toBe('new')
    expect(older.link.asked.slice(1).every((a) => a === undefined)).toBe(true)
    const replayed = await newDevice(app, false)
    await replayed.client.sync()
    expect(await held(older)).toEqual(await held(replayed))
  })

  it('reads again from the start with only the latest, deletes and all, when the copy already holds records', async () => {
    // Proves: a copy read again from the start (FEED, money, what its role reads) holds records already, so it asks with 0,
    // which sends the deletes too: a record it holds that has gone since is taken away, as reading every change would.
    const app = await server(undefined, { pullLimit: 4 })
    const office = await busy(app)
    const head = office.client.cursor
    const storage = new MemoryStorage()
    const full = (await (office as { storage: MemoryStorage }).storage.load())!
    // A copy saved before FEED 2, holding Shelf 0 still, which has gone, and missing the latest name of Shelf 4.
    const old: Snapshot = { ...emptySnapshot('phone'), cursor: head, entities: structuredClone(full.entities) }
    ;(old.entities.place as Record<string, unknown>).shelf0 = { id: 'shelf0', name: 'Shelf 0', notes: '' }
    ;(old.entities.place as Record<string, { name: string }>).shelf4!.name = 'Shelf 4'
    await storage.save(old)
    const link = new LatestLink(app)
    const phone = { link, storage, client: await new SyncClient({ storage, transport: link }).open() }
    await phone.client.sync()
    expect(link.asked[0]).toBeUndefined()
    expect(link.asked[1]).toBe(0)
    const replayed = await newDevice(app, false)
    await replayed.client.sync()
    expect((await held(phone)).entities).toEqual((await held(replayed)).entities)
    expect(phone.client.cursor).toBe(head)
  })
})

describe('a copy read again while a change of its own is on its way back (audit, 20 October 2026, finding 22)', () => {
  it('reads only the latest of each record, keeps its own change on screen throughout, and ends as reading every change would', async () => {
    // Proves: a re-read noticed by the pull of the same round whose push applied the phone's change (here, the server
    // reading the feed differently) asks for the latest only, rather than walking every change from the first; the change
    // stays on the phone's screen at every page, and the copy ends holding exactly what a device that read every change does.
    const app = await server(undefined, { pullLimit: 3 })
    const office = await seed(app)
    for (let i = 0; i < 6; i++) {
      await office.client.mutate('stock.move', move(2, 'a3', 'van1'))
      await office.client.mutate('stock.move', move(2, 'van1', 'a3'))
    }
    for (let i = 0; i < 5; i++) await office.client.mutate('place.upsert', { id: `shelf${i}`, name: `Shelf ${i}`, notes: '' })
    await office.client.sync()
    // A copy saved before FEED 2, read to where the office is.
    const full = (await (office as { storage: MemoryStorage }).storage.load())!
    const storage = new MemoryStorage()
    await storage.save({ ...emptySnapshot('phone'), cursor: office.client.cursor, entities: structuredClone(full.entities) })
    const link = new LatestLink(app)
    const phone = await new SyncClient({ storage, transport: link }).open()
    link.online = false
    await phone.mutate('place.upsert', { id: 'van3', name: 'Van 3', notes: '' }).catch(() => {})
    link.online = true
    const shown: boolean[] = []
    const pull = link.pull.bind(link)
    link.pull = async (after, latest) => {
      shown.push(phone.view().warehouse.places.some((p) => p.id === 'van3'))
      return pull(after, latest)
    }
    await phone.sync()
    // The first pull hears of the new reading; the read from the start after it asks for the latest only.
    expect(link.asked[0]).toBeUndefined()
    expect(link.asked[1]).toBe(0)
    expect(link.asked.length).toBeGreaterThan(2)
    expect(shown.every(Boolean)).toBe(true)
    expect(phone.view().warehouse.places.some((p) => p.id === 'van3')).toBe(true)
    expect(phone.view().pendingCount).toBe(0)
    const replayed = await newDevice(app, false)
    await replayed.client.sync()
    expect((await held({ storage, client: phone })).entities).toEqual((await held(replayed)).entities)
    expect(phone.cursor).toBe(replayed.client.cursor)
  })
})

describe('a pull with a cursor the server never gave (audit, 20 October 2026, finding 67)', () => {
  it('is turned away in words as a bad request, not answered as a fault of the server', async () => {
    // Proves: a cursor past the database's biggest number, a decimal, a negative or a word is a 400 that says why, before the
    // query that would refuse it and be reported; a missing or empty one still reads from the start.
    const app = await server()
    for (const after of ['99999999999999999999', '1.5', '-1', 'abc', '1e3']) {
      const res = await app.inject({ method: 'GET', url: `/api/sync/pull?after=${after}` })
      expect(res.statusCode, after).toBe(400)
      expect(res.json()).toEqual({ error: "That isn't a change number this server gave." })
    }
    expect((await app.inject({ method: 'GET', url: '/api/sync/pull?after=0&latest=99999999999999999999' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/api/sync/pull' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/sync/pull?after=' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/sync/pull?after=0&latest=new' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/sync/pull?after=0&latest=0' })).statusCode).toBe(200)
  })
})

describe('a push, in trips to the database (audit, 20 October 2026, finding 15)', () => {
  it('takes the lock once, with the transaction, and writes the change down in one statement that also finds a resend', async () => {
    // Proves: a change in a push takes the write lock once, as its transaction begins; there is no separate look for it
    // having been applied (the history's insert finds that), and no statement to let go of its savepoint.
    const plain = await pgliteDb()
    cleanup.push(() => plain.close())
    const sql: string[] = []
    const counted = (q: Queryable): Queryable => ({
      query: (text, params) => (sql.push(text), q.query(text, params)),
      exec: (text) => (sql.push(text), q.exec(text)),
    })
    const db: Db = { ...plain, transaction: (fn, o) => plain.transaction((tx) => fn(counted(tx)), o) }
    const app = await server(db)
    const place = { id: newId(), name: 'place.upsert', args: { id: 'a3', name: 'Bay A3', notes: '' }, createdAt: new Date().toISOString() }
    // The lock goes with the transaction's beginning, outside what the change itself sends.
    sql.length = 0
    const res = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'phone', mutations: [place] } })
    expect(res.json().results).toMatchObject([{ status: 'applied' }])
    expect(sql.filter((s) => s.includes('pg_advisory_xact_lock'))).toEqual([])
    expect(sql.filter((s) => s.startsWith('SELECT result FROM mutations'))).toEqual([])
    expect(sql.filter((s) => s.startsWith('RELEASE'))).toEqual([])
    expect(sql.filter((s) => s.includes('INSERT INTO mutations'))).toHaveLength(1)
    // A resend that got past the push's own look (one sent twice at once, say) is still answered as the first time.
    sql.length = 0
    const again = await db.transaction(async (tx) => (await import('../src/commands.ts')).applyMutationIn(tx, 'phone', place as never, {}, undefined, { own: true }))
    expect(again).toMatchObject({ status: 'applied', duplicate: true })
  })
})

describe('a push the device has given up on (audit, 20 October 2026, finding 16)', () => {
  it('stops at the next change once the request is gone, keeping what was applied, and says so in the log', async () => {
    // Proves: a push sent without the partial mark, cut off by the device part way, isn't worked through to its end for
    // nobody: the server stops, what it applied stays applied, and the log says it stopped.
    const plain = await pgliteDb()
    cleanup.push(() => plain.close())
    // Each change slowed, as at a distance.
    const slow = (q: Queryable): Queryable => ({ query: async (text, params) => (await new Promise((r) => setTimeout(r, 5)), q.query(text, params)), exec: (t) => q.exec(t) })
    const db: Db = { ...plain, transaction: (fn, o) => plain.transaction((tx) => fn(slow(tx)), o) }
    const lines: string[] = []
    const app = await server(db, { logger: true, logTo: { write: (line) => void lines.push(line) } })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = app.server.address() as AddressInfo
    const mutations = Array.from({ length: 300 }, (_, i) => ({ id: newId(), name: 'place.upsert', args: { id: `p${i}`, name: `Bay ${i}`, notes: '' }, createdAt: new Date().toISOString() }))
    const body = JSON.stringify({ clientId: 'old-phone', mutations })
    const req = request({ host: '127.0.0.1', port, path: '/api/sync/push', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } })
    req.on('error', () => {})
    req.end(body)
    const applied = async () => Number((await plain.query<{ n: number }>(`SELECT count(*)::int AS n FROM mutations WHERE client_id = 'old-phone'`)).rows[0]!.n)
    while ((await applied()) < 5) await new Promise((r) => setTimeout(r, 20))
    req.destroy()
    // The change under way finishes; then nothing more is worked through.
    await new Promise((r) => setTimeout(r, 500))
    const stopped = await applied()
    await new Promise((r) => setTimeout(r, 500))
    expect(await applied()).toBe(stopped)
    expect(stopped).toBeLessThan(mutations.length)
    expect(lines.map((l) => JSON.parse(l)).find((l) => l.msg?.startsWith('Push stopped part way'))).toMatchObject({ answered: stopped, waiting: mutations.length - stopped })
  })
})
