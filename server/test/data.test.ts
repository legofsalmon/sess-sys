import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MemoryStorage,
  START_FRESH_WORDS,
  SyncClient,
  type DataStatus,
  type HistoryPage,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type Transport,
} from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { checkRestores } from '../src/backup/service.ts'
import { dirStore, type BackupStore } from '../src/backup/store.ts'
import { madeUpData } from '../src/data/madeup.ts'
import { pgliteDb, type Db } from '../src/db.ts'
import { tablesInOrder } from '../src/tables.ts'
import { IPHONE, server as signedInServer, staff } from './people.ts'

/**
 * Made-up data and starting fresh (ADR 0018): trying the app before the real
 * jobs, crew and stock go in, then clearing it all, on the server and on
 * every phone, without anything coming back.
 */

let cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

async function server(options: { backupStore?: BackupStore } = {}) {
  const db = await pgliteDb()
  const app = await buildApp({ db, ...options })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  return { app, db }
}

function folder() {
  const dir = mkdtempSync(join(tmpdir(), 'sh-fresh-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

interface As {
  cookies?: Record<string, string>
  userAgent?: string
}

const CODE = 'k3v9q2w7x1m4'

async function status(app: FastifyInstance, as: As = {}): Promise<DataStatus> {
  const res = await app.inject({ url: '/api/data', cookies: as.cookies })
  expect(res.statusCode).toBe(200)
  return res.json()
}

const putInMadeUpData = (app: FastifyInstance, as: As = {}) =>
  app.inject({ method: 'POST', url: `/api/data/made-up?client=${CODE}`, cookies: as.cookies, headers: { 'user-agent': as.userAgent ?? IPHONE } })

const startFresh = (app: FastifyInstance, confirm: unknown = START_FRESH_WORDS, as: As = {}) =>
  app.inject({
    method: 'POST',
    url: `/api/data/start-fresh?client=${CODE}`,
    cookies: as.cookies,
    headers: { 'user-agent': as.userAgent ?? IPHONE },
    payload: { confirm },
  })

const pull = async (app: FastifyInstance, after = 0, as: As = {}): Promise<PullResponse> =>
  (await app.inject({ url: `/api/sync/pull?after=${after}`, cookies: as.cookies })).json()

/** Rows in each table that starting fresh empties. */
async function rowsLeft(db: Db) {
  const kept = new Set(['users', 'sessions', 'server_meta', 'backup_runs'])
  const out: Record<string, number> = {}
  for (const t of await tablesInOrder(db)) {
    if (kept.has(t) || t.endsWith('schema_version')) continue
    const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM "${t}"`)
    if (Number(rows[0]!.n) > 0) out[t] = Number(rows[0]!.n)
  }
  return out
}

/** A phone: a transport over the in-process app, with a signal switch. */
class TestLink implements Transport {
  online = true
  constructor(
    public app: FastifyInstance,
    private as: As = {}
  ) {}
  async push(req: PushRequest): Promise<PushResponse> {
    if (!this.online) throw new Error('offline')
    return (await this.app.inject({ method: 'POST', url: '/api/sync/push', payload: req, cookies: this.as.cookies })).json()
  }
  async pull(after: number): Promise<PullResponse> {
    if (!this.online) throw new Error('offline')
    return pull(this.app, after, this.as)
  }
}

async function phone(app: FastifyInstance, as: As = {}) {
  const link = new TestLink(app, as)
  const client = await new SyncClient({ storage: new MemoryStorage(), transport: link }).open()
  return { link, client }
}

describe('made-up data', () => {
  it('goes in through the same rules as a phone, and shows every part of the app', async () => {
    const { app, db } = await signedInServer()
    const aoife = await staff(app, db, 'Aoife Brennan', IPHONE, CODE)
    expect(await status(app, aoife)).toEqual({ empty: true, madeUp: null, fresh: null, calendarConnected: false, backups: false })

    const res = await putInMadeUpData(app, aoife)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ empty: false, madeUp: { by: 'Aoife Brennan' }, fresh: null })

    const office = await phone(app, aoife)
    await office.client.sync()
    const view = office.client.view()

    // Jobs, from enquiry to cancelled, with their clients and venues.
    expect(view.jobs.jobs.map((j) => [j.name, j.status])).toEqual(
      expect.arrayContaining([
        ['Harbour Lights Festival', 'confirmed'],
        ['Corrib Arts Week', 'quoted'],
        ['Clonmore Wedding', 'enquiry'],
        ['Winter Showcase', 'cancelled'],
        ['Autumn Gala', 'confirmed'],
      ])
    )
    expect(view.jobs.clients).toHaveLength(5)
    expect(view.jobs.venues).toHaveLength(5)

    // Crew booked, offered, countered and declined, and a check where Dara is on two jobs at once.
    const offers = view.crew.calls.flatMap((c) => c.offers)
    const statuses = new Set(offers.map((o) => o.status))
    for (const s of ['confirmed', 'offered', 'countered', 'declined']) expect(statuses).toContain(s)
    expect(offers.find((o) => o.status === 'countered')).toMatchObject({ person: { name: 'Fionn Gallagher' }, counterRateCents: 32000 })
    expect(offers.filter((o) => o.person?.name === 'Dara Quinn' && o.override)).toHaveLength(1)
    expect(view.crew.unavailability).toHaveLength(1)

    // Kit: speakers short between two jobs, and the quote short of moving heads, which the launch would be too if it goes ahead.
    const short = view.kit.short.map((l) => [l.job?.name, l.model?.name, l.short])
    expect(short).toHaveLength(3)
    expect(short).toEqual(
      expect.arrayContaining([
        ['Harbour Lights Festival', 'd&b Y10P', 4],
        ['Brightwater Tech Summit', 'd&b Y10P', 4],
        ['Corrib Arts Week', 'Robe Spiider', 12],
      ])
    )
    const launch = view.kit.lines.find((l) => l.job?.name === 'Liffey Brands Launch')!
    expect([launch.short, launch.ifPencilled]).toEqual([0, 12])
    expect(view.kit.lines.find((l) => l.model?.name === 'ROE BP2 LED panel')).toMatchObject({ own: 0, supplier: 'Lumen Video Hire' })

    // The warehouse: labelled items from SH-000001 on, amps in their racks, what's still only counted, and a roll of numbers set aside.
    const items = [...view.warehouse.assets.values()]
    expect(items).toHaveLength(26)
    expect(items.map((a) => a.number).sort()[0]).toBe('SH-000001')
    expect(items.filter((a) => a.caseId)).toHaveLength(4)
    const y10p = view.warehouse.models.find((m) => m.name === 'd&b Y10P')!
    expect([y10p.items.length, y10p.countedTotal, y10p.total]).toEqual([12, 4, 16])
    expect(view.labels.runs).toHaveLength(1)
    expect(view.labels.runs[0]).toMatchObject({ name: 'Made-up roll', firstNumber: 'SH-000027', lastNumber: 'SH-000046' })
    expect(view.labels.next).toBe('SH-000047')

    // Pick lists: the jobs going out soon, and the gala over with two speakers not back.
    expect(view.moves.soon.map((p) => p.job.name)).toEqual(['Harbour Lights Festival', 'Brightwater Tech Summit', 'Liffey Brands Launch'])
    expect(view.moves.stillOut.map((p) => [p.job.name, p.stillOut, p.back])).toEqual([['Autumn Gala', 2, 6]])
    expect(view.problems).toEqual([])

    // In the history as Aoife's, from "Made-up data", and one entry saying she put it in.
    const history: HistoryPage = await aoife.history('?limit=500')
    expect(history.entries).toHaveLength(madeUpData('2026-10-01').length + 1)
    expect(history.entries.every((e) => e.outcome === 'done' && e.who.name === 'Aoife Brennan')).toBe(true)
    const [latest, ...rest] = history.entries
    expect(latest).toMatchObject({ command: 'data.made-up', device: 'Safari on iPhone', deviceCode: CODE.slice(-6) })
    expect(latest!.what).toMatch(/^Put in made-up data/)
    expect(rest.every((e) => e.device === 'Made-up data' && e.deviceCode === undefined)).toBe(true)
  })

  it('only goes into an empty app', async () => {
    const { app } = await server()
    const office = await phone(app)
    await office.client.mutate('product.upsert', { id: 'y10p', name: 'd&b Y10P', quantity: 4 })
    await office.client.sync()
    const res = await putInMadeUpData(app)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('Made-up data only goes into an empty app. Start fresh first, then put it in.')
    expect((await pull(app)).changes).toHaveLength(1)

    // Nor twice.
    const { app: other } = await server()
    expect((await putInMadeUpData(other)).statusCode).toBe(200)
    expect((await putInMadeUpData(other)).statusCode).toBe(409)
  })

  it('has its jobs in the coming weeks, whenever it goes in', () => {
    const jobs = madeUpData('2027-02-27').filter((m) => m.name === 'phase.add')
    const starts = jobs.map((m) => (m.args as { start: string }).start).sort()
    expect(starts[0]).toBe('2027-02-17')
    expect(starts[1]).toBe('2027-03-02')
    // Fresh ids each time, so it can go in again after starting fresh.
    expect(madeUpData('2027-02-27')[0]!.id).not.toBe(madeUpData('2027-02-27')[0]!.id)
  })
})

describe('starting fresh', () => {
  it('needs the words typed', async () => {
    const { app } = await server()
    await putInMadeUpData(app)
    for (const confirm of [null, '', 'delete', 'yes', 42]) {
      const res = await startFresh(app, confirm)
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe('Type “delete everything” to start fresh.')
    }
    expect((await status(app)).madeUp).not.toBeNull()
    expect((await startFresh(app, '  Delete everything ')).statusCode).toBe(200)
  })

  it('deletes everything but the staff accounts, and says so in the history', async () => {
    const { app, db } = await signedInServer()
    const aoife = await staff(app, db, 'Aoife Brennan', IPHONE, CODE)
    await putInMadeUpData(app, aoife)
    await aoife.send('product.upsert', { id: 'ls9', name: 'Yamaha LS9', quantity: 1 })
    const before = await rowsLeft(db)
    expect(before.projects).toBe(7)
    const total = Object.values(before).reduce((a, b) => a + b, 0)

    const res = await startFresh(app, START_FRESH_WORDS, aoife)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ empty: true, madeUp: null, fresh: { by: 'Aoife Brennan' } })

    // Only its own entry in the history is left.
    expect(await rowsLeft(db)).toEqual({ mutations: 1 })
    const history = await aoife.history()
    expect(history.entries).toHaveLength(1)
    expect(history.entries[0]).toMatchObject({
      command: 'data.fresh',
      what: `Started fresh: deleted everything (${total.toLocaleString('en-IE')} rows) except the staff accounts`,
      who: { kind: 'staff', name: 'Aoife Brennan' },
      device: 'Safari on iPhone',
      deviceCode: CODE.slice(-6),
    })

    // Still signed in, with an empty app to fill.
    expect((await app.inject({ url: '/api/me', cookies: aoife.cookies })).statusCode).toBe(200)
    expect((await pull(app, 0, aoife)).changes).toEqual([])

    // Numbers start again from SH-000001, and made-up data can go in again.
    expect((await putInMadeUpData(app, aoife)).statusCode).toBe(200)
    const office = await phone(app, aoife)
    await office.client.sync()
    expect([...office.client.view().warehouse.assets.values()].map((a) => a.number).sort()[0]).toBe('SH-000001')
  })

  it('empties every phone, and drops what one had waiting with no signal', async () => {
    const { app } = await server()
    await putInMadeUpData(app)
    const office = await phone(app)
    const dara = await phone(app)
    await office.client.sync()
    await dara.client.sync()
    const job = dara.client.view().jobs.jobs.find((j) => j.name === 'Clonmore Wedding')!

    // Dara, with no signal, moves a job on and adds a product; then the office starts fresh.
    dara.link.online = false
    await dara.client.mutate('project.update', { id: job.id, status: 'confirmed' })
    await dara.client.mutate('product.upsert', { id: 'ls9', name: 'Yamaha LS9', quantity: 1 })
    await dara.client.sync().catch(() => {})
    expect(dara.client.view().pendingCount).toBe(2)
    expect((await startFresh(app)).statusCode).toBe(200)

    await office.client.sync()
    expect(office.client.view().jobs.jobs).toEqual([])
    expect(office.client.view().cursor).toBe(0)

    // Dara's phone finds signal. It sends first, but nothing it had is applied.
    dara.link.online = true
    await dara.client.sync()
    expect((await pull(app)).changes).toEqual([])
    const view = dara.client.view()
    expect(view.jobs.jobs).toEqual([])
    expect(view.products).toEqual([])
    expect(view.pendingCount).toBe(0)
    expect(view.problems).toEqual([])

    // What's done after goes in as normal, from either phone.
    await dara.client.mutate('product.upsert', { id: 'sm58', name: 'Shure SM58', quantity: 20 })
    await dara.client.sync()
    await office.client.sync()
    expect(office.client.view().products.map((p) => p.id)).toEqual(['sm58'])
    expect(dara.client.view().pendingCount).toBe(0)
  })

  it('turns down a push from before, even from a phone that has not pulled since', async () => {
    const { app } = await server()
    await putInMadeUpData(app)
    const { generation } = await pull(app)
    await startFresh(app)
    const stale = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      payload: {
        clientId: 'phone1',
        generation,
        mutations: [{ id: 'm1', name: 'product.upsert', args: { id: 'ls9', name: 'Yamaha LS9', quantity: 1 }, createdAt: new Date().toISOString() }],
      },
    })
    expect(stale.json()).toEqual({ results: [], stale: true })
    expect((await pull(app)).changes).toEqual([])
    expect((await pull(app)).cleared).toBe(true)

    // A push on the new copy is fine.
    const { generation: now } = await pull(app)
    const ok = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      payload: {
        clientId: 'phone1',
        generation: now,
        mutations: [{ id: 'm2', name: 'product.upsert', args: { id: 'ls9', name: 'Yamaha LS9', quantity: 1 }, createdAt: new Date().toISOString() }],
      },
    })
    expect(ok.json().results[0]).toMatchObject({ status: 'applied' })
  })

  it('makes a backup first where backups are set up, so it can be undone', async () => {
    const dir = folder()
    const { app, db } = await server({ backupStore: dirStore(dir) })
    await putInMadeUpData(app)
    expect((await status(app)).backups).toBe(true)
    // Straight after "Back up now" too.
    expect((await app.inject({ method: 'POST', url: '/api/backups/run' })).statusCode).toBe(200)

    expect((await startFresh(app)).statusCode).toBe(200)
    const { rows } = await db.query<{ key: string; status: string }>(`SELECT key, status FROM backup_runs WHERE trigger = 'fresh'`)
    expect(rows).toEqual([{ key: expect.any(String), status: 'ok' }])
    const backup = readFileSync(join(dir, ...rows[0]!.key.split('/')))
    expect((await checkRestores(backup)).rows).toBeGreaterThan(300)
  })

  it("deletes nothing if that backup doesn't work", async () => {
    const broken: BackupStore = {
      ...dirStore(folder()),
      put: async () => {
        throw new Error('The backup storage answered 403: Access denied')
      },
    }
    const { app, db } = await server({ backupStore: broken })
    await putInMadeUpData(app)
    const res = await startFresh(app)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe("The backup before starting fresh didn't work (The backup storage answered 403: Access denied), so nothing was deleted.")
    expect((await rowsLeft(db)).projects).toBe(7)
    expect(await status(app)).toMatchObject({ empty: false, fresh: null })
  })
})

describe('with Google Calendar connected', () => {
  it('neither puts in made-up data nor starts fresh until it is disconnected', async () => {
    const { app, db } = await server()
    await db.query(`INSERT INTO calendar_link (id, state, app_key) VALUES ('main', 'on', 'test')`)
    expect((await status(app)).calendarConnected).toBe(true)

    const madeUp = await putInMadeUpData(app)
    expect(madeUp.statusCode).toBe(409)
    expect(madeUp.json().error).toBe('Disconnect Google Calendar first, above: the made-up jobs would go on it.')
    const fresh = await startFresh(app)
    expect(fresh.statusCode).toBe(409)
    expect(fresh.json().error).toBe("Disconnect Google Calendar first, above: that takes the app's days off the calendar. Then start fresh.")

    await db.query(`UPDATE calendar_link SET state = 'off'`)
    expect((await status(app)).calendarConnected).toBe(false)
    expect((await putInMadeUpData(app)).statusCode).toBe(200)
    expect((await startFresh(app)).statusCode).toBe(200)
  })
})
