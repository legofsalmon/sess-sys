import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStorage, SyncClient, type PullResponse, type PushRequest, type PushResponse, type Transport } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb, type Db } from '../src/db.ts'

/**
 * The Phase 0 promise, as tests: two devices, a switch for their signal, and
 * the real server and SQL in between.
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

async function server(db?: Db) {
  const database = db ?? (await pgliteDb())
  const app = await buildApp({ db: database })
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

const Y10P = { id: 'y10p', name: 'd&b Y10P', quantity: 4 }

async function seed(app: FastifyInstance) {
  const office = await device(app)
  await office.client.mutate('product.upsert', Y10P)
  await office.client.sync()
  return office
}

describe('two people, four speakers, no signal', () => {
  it('lets the first booking through and turns the second down with a reason', async () => {
    const app = await server()
    await seed(app)
    const aoife = await device(app)
    const dara = await device(app)
    await aoife.client.sync()
    await dara.client.sync()

    aoife.link.online = false
    dara.link.online = false
    await aoife.client.mutate('booking.create', { id: 'nissan', productId: 'y10p', project: 'Nissan', qty: 4, start: '2026-10-04', end: '2026-10-07' })
    await dara.client.mutate('booking.create', { id: 'fuel', productId: 'y10p', project: 'Fuel', qty: 4, start: '2026-10-05', end: '2026-10-05' })

    // Offline, each sees their own booking as pending.
    await expect(aoife.client.sync()).rejects.toThrow('offline')
    expect(aoife.client.view().connection).toBe('offline')
    expect(aoife.client.view().bookings).toMatchObject([{ id: 'nissan', pending: true }])
    expect(dara.client.view().bookings).toMatchObject([{ id: 'fuel', pending: true }])

    aoife.link.online = true
    dara.link.online = true
    await aoife.client.sync()
    await dara.client.sync()
    await aoife.client.sync()

    // Aoife's went first and is confirmed; Dara's is a problem to resolve,
    // not a silent undo, and both devices agree on what is booked.
    for (const d of [aoife, dara]) {
      expect(d.client.view().bookings).toEqual([expect.objectContaining({ id: 'nissan', status: 'confirmed', pending: false })])
      expect(d.client.view().pendingCount).toBe(0)
    }
    const problems = dara.client.view().problems
    expect(problems).toHaveLength(1)
    expect(problems[0]!.reason).toMatchObject({ code: 'short', short: 4 })
    expect(problems[0]!.reason.message).toContain('Only 0 × d&b Y10P free')
    expect(aoife.client.view().problems).toHaveLength(0)
  })

  it('does not count bookings on different days against each other', async () => {
    const app = await server()
    const office = await seed(app)
    await office.client.mutate('booking.create', { id: 'mon', productId: 'y10p', project: 'A', qty: 4, start: '2026-10-05', end: '2026-10-05' })
    await office.client.mutate('booking.create', { id: 'fri', productId: 'y10p', project: 'B', qty: 4, start: '2026-10-09', end: '2026-10-09' })
    await office.client.mutate('booking.create', { id: 'week', productId: 'y10p', project: 'C', qty: 1, start: '2026-10-05', end: '2026-10-09' })
    await office.client.sync()
    const v = office.client.view()
    expect(v.bookings.map((b) => b.id)).toEqual(['mon', 'fri'])
    expect(v.problems.map((p) => p.mutation.args)).toEqual([expect.objectContaining({ id: 'week' })])
  })

  it('frees stock when a booking is cancelled', async () => {
    const app = await server()
    const office = await seed(app)
    await office.client.mutate('booking.create', { id: 'a', productId: 'y10p', project: 'A', qty: 4, start: '2026-10-05', end: '2026-10-06' })
    await office.client.mutate('booking.cancel', { id: 'a' })
    await office.client.mutate('booking.create', { id: 'b', productId: 'y10p', project: 'B', qty: 4, start: '2026-10-06', end: '2026-10-06' })
    await office.client.sync()
    expect(office.client.view().problems).toHaveLength(0)
    expect(office.client.view().bookings.map((b) => [b.id, b.status])).toEqual([
      ['a', 'cancelled'],
      ['b', 'confirmed'],
    ])
  })
})

describe('nothing is lost, nothing is doubled', () => {
  it('applies a mutation once when the answer is lost and the device resends', async () => {
    const app = await server()
    const office = await seed(app)
    office.link.dropNextResponse = true
    await office.client.mutate('booking.create', { id: 'a', productId: 'y10p', project: 'A', qty: 3, start: '2026-10-05', end: '2026-10-05' })
    await expect(office.client.sync()).rejects.toThrow('connection reset')
    expect(office.client.view().pendingCount).toBe(1)

    // The resend would be "short by 2" if it were applied a second time.
    await office.client.sync()
    expect(office.client.view().problems).toHaveLength(0)
    expect(office.client.view().bookings).toEqual([expect.objectContaining({ id: 'a', qty: 3, pending: false })])
    const exported = (await app.inject('/api/export')).json()
    expect(exported.bookings).toHaveLength(1)
  })

  it('keeps the outbox across a reload of the app', async () => {
    const app = await server()
    await seed(app)
    const storage = new MemoryStorage()
    const phone = await device(app, storage)
    phone.link.online = false
    await phone.client.mutate('booking.create', { id: 'a', productId: 'y10p', project: 'A', qty: 1, start: '2026-10-05', end: '2026-10-05' })

    // The phone dies and the app is opened again from storage.
    const reopened = await device(app, storage)
    expect(reopened.client.view().pendingCount).toBe(1)
    await reopened.client.sync()
    expect(reopened.client.view().bookings).toEqual([expect.objectContaining({ id: 'a', pending: false })])
  })

  it('survives the server restarting between two syncs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sh-sync-'))
    cleanup.push(async () => rmSync(dir, { recursive: true, force: true }))

    let db = await pgliteDb(dir)
    let app = await buildApp({ db })
    const office = await device(app)
    await office.client.mutate('product.upsert', Y10P)
    await office.client.mutate('booking.create', { id: 'a', productId: 'y10p', project: 'A', qty: 2, start: '2026-10-05', end: '2026-10-05' })
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
    expect(v.bookings).toEqual([expect.objectContaining({ id: 'a', qty: 2 })])
    expect(v.products).toEqual([Y10P])
  })
})

describe('scans are facts', () => {
  it('accepts a scan made offline that does not match the plan, and raises an issue', async () => {
    const app = await server()
    const office = await seed(app)
    await office.client.mutate('booking.create', { id: 'job', productId: 'y10p', project: 'Nissan', qty: 1, start: '2026-10-05', end: '2026-10-05' })
    await office.client.sync()

    const warehouse = await device(app)
    await warehouse.client.sync()
    warehouse.link.online = false
    for (const n of [1, 2]) {
      await warehouse.client.mutate('scan.record', { id: `s${n}`, productId: 'y10p', bookingId: 'job', direction: 'out', at: `2026-10-04T08:0${n}:00Z` })
    }
    expect(warehouse.client.view().scans.every((s) => s.pending)).toBe(true)

    warehouse.link.online = true
    await warehouse.client.sync()
    const v = warehouse.client.view()
    expect(v.scans).toHaveLength(2)
    expect(v.problems).toHaveLength(0)
    expect(v.issues).toEqual([expect.objectContaining({ kind: 'scan-over-booking', message: '2 scanned out for Nissan, but only 1 booked.' })])
  })
})

describe('audit and export', () => {
  it('records who asked, when they did it and when it arrived', async () => {
    const app = await server()
    const office = await seed(app)
    const { mutations } = (await app.inject('/api/export')).json()
    expect(mutations).toEqual([
      expect.objectContaining({ client_id: office.client.clientId, name: 'product.upsert', status: 'applied' }),
    ])
    expect(mutations[0].created_at).toBeTruthy()
    expect(mutations[0].received_at).toBeTruthy()
  })

  it('rejects malformed pushes without touching data', async () => {
    const app = await server()
    const res = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'x', mutations: [{ id: 'm', name: 'nope', args: {}, createdAt: '' }] } })
    expect(res.statusCode).toBe(400)
  })
})

describe('one bad change in a batch', () => {
  it("turns down a date that isn't real with a plain reason, and still applies the change after it", async () => {
    const app = await server()
    await seed(app)
    const createdAt = new Date().toISOString()
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      payload: {
        clientId: 'phone',
        mutations: [
          { id: 'bad', name: 'booking.create', args: { id: 'bad', productId: 'y10p', project: 'A', qty: 1, start: '2026-02-31', end: '2026-02-31' }, createdAt },
          { id: 'good', name: 'booking.create', args: { id: 'good', productId: 'y10p', project: 'B', qty: 1, start: '2026-10-05', end: '2026-10-05' }, createdAt },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().results).toEqual([
      { id: 'bad', status: 'rejected', reason: { code: 'invalid', message: "That isn't a real date." } },
      expect.objectContaining({ id: 'good', status: 'applied' }),
    ])
    const exported = (await app.inject('/api/export')).json()
    expect(exported.bookings.map((b: { id: string }) => b.id)).toEqual(['good'])
  })
})
