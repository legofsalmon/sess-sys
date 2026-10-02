import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  MemoryStorage,
  newId,
  SyncClient,
  type CommandInput,
  type CommandName,
  type Mutation,
  type MutationResult,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type Transport,
} from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.ts'
import { migrateAuth } from '../src/auth/schema.ts'
import { createSession, upsertUser } from '../src/auth/sessions.ts'
import { backupKeyFromEnv, isEncrypted } from '../src/backup/crypto.ts'
import { newGeneration, readGeneration, restoreBackup, writeBackup } from '../src/backup/format.ts'
import { backupKey, Backups, checkRestores, keyDate, latestKey, restoreFrom, toThin } from '../src/backup/service.ts'
import { dirStore, s3Store, s3Url, storeFromEnv, type BackupStore } from '../src/backup/store.ts'
import { CREW, migrateCrew } from '../src/crew/schema.ts'
import { pgliteDb, type Db } from '../src/db.ts'
import { moduleVersion } from '../src/migrations.ts'
import { PROJECTS } from '../src/projects/schema.ts'
import { CORE, migrate } from '../src/schema.ts'

/**
 * Backups (ADR 0004): the file, the restore, the nightly run, what phones
 * do when the server's data has been put back from a backup, and the files
 * encrypted under BACKUP_KEY (audit finding 20).
 */

let cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

const DAY = 86_400_000

async function database() {
  const db = await pgliteDb()
  cleanup.push(() => db.close())
  return db
}

async function server(db: Db, options: { backupStore?: BackupStore; backupKey?: Buffer } = {}) {
  const app = await buildApp({ db, ...options })
  cleanup.push(() => app.close())
  return app
}

function folder() {
  const dir = mkdtempSync(join(tmpdir(), 'sh-backups-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function m<N extends CommandName>(name: N, args: CommandInput<N>): Mutation {
  return { id: newId(), name, args, createdAt: new Date().toISOString() } as Mutation
}

async function push(app: FastifyInstance, clientId: string, ...mutations: Mutation[]): Promise<MutationResult[]> {
  const res = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId, mutations } })
  return res.json().results
}

const pull = async (app: FastifyInstance, after = 0): Promise<PullResponse> =>
  (await app.inject({ method: 'GET', url: `/api/sync/pull?after=${after}` })).json()

/**
 * A bit of everything, including the awkward parts: accents and emoji,
 * tabs, new lines and quotes, JSON columns, dates, times to the
 * microsecond, a signed-in member of staff and a freelancer's link.
 */
async function seed(app: FastifyInstance, db: Db) {
  const first = m('product.upsert', { id: 'y10p', name: 'd&b Y10P "line array"', quantity: 4 })
  await push(app, 'office', first, m('product.upsert', { id: 'sm58', name: 'Shure SM58\tvocal mic', quantity: 20 }))
  await push(app, 'office', m('booking.create', { id: 'b1', productId: 'y10p', project: 'Féile na nDéise 🎶', qty: 2, start: '2026-10-05', end: '2026-10-06' }))
  await push(
    app,
    'warehouse',
    m('scan.record', { id: 's1', productId: 'y10p', bookingId: 'b1', direction: 'out', at: '2026-10-05T08:15:00.000Z' }),
    // Scanned with no booking, which raises an issue.
    m('scan.record', { id: 's2', productId: 'sm58', bookingId: null, direction: 'out', at: '2026-10-05T08:16:00.000Z' })
  )
  await push(
    app,
    'office',
    m('person.upsert', {
      id: 'p1',
      name: 'Seán Ó Briain',
      kind: 'freelancer',
      email: 'sean@example.ie',
      phone: '+353 87 123 4567',
      skills: ['audio', 'rigging'],
      dayRateCents: 25000,
      notes: 'Line one\nLine two, with a "quote" and a back\\slash',
    }),
    m('call.create', {
      id: 'c1',
      project: 'Electric Picnic',
      phase: 'Build',
      venue: 'Stradbally Hall',
      role: 'Audio tech',
      start: '2026-10-02',
      end: '2026-10-04',
      callTime: '08:00',
      needed: 1,
      dayRateCents: 25000,
      details: 'Food on site.',
      replyBy: null,
    }),
    m('offer.send', { id: 'o1', callId: 'c1', personId: 'p1', override: false })
  )
  // A job with a phase, and crew for it: rows that refer to rows in other modules.
  await push(
    app,
    'office',
    m('client.upsert', { id: 'cl1', name: 'Fáilte Ireland', contacts: [{ name: 'Orla Kavanagh', role: 'Producer', email: 'orla@example.ie', phone: null }], notes: '' }),
    m('venue.upsert', { id: 'v1', name: 'Dublin Castle', address: 'Dame St, Dublin 2\nD02 R590', notes: 'Load in via the Ship St gate.' }),
    m('project.create', { id: 'j1', name: 'Culture Night', clientId: 'cl1', venueId: 'v1', status: 'confirmed', notes: '' }),
    m('phase.add', { id: 'ph1', projectId: 'j1', name: 'Build', start: '2026-09-18', end: '2026-09-18', venueId: null, notes: '' }),
    m('call.create', {
      id: 'c2',
      phaseId: 'ph1',
      project: 'Culture Night',
      phase: 'Build',
      venue: '',
      role: 'Rigger',
      start: '2026-09-18',
      end: '2026-09-18',
      callTime: '07:00',
      needed: 2,
      dayRateCents: 26000,
      details: '',
      replyBy: null,
    })
  )
  const user = await upsertUser(db, { subject: 'g-1', email: 'aoife@sessionhire.com', emailVerified: true, name: 'Aoife Byrne', hostedDomain: 'sessionhire.com' })
  await createSession(db, user.id, 'test')
  // A time to the microsecond, which JavaScript dates would round off.
  await db.query(`UPDATE mutations SET received_at = '2026-09-29 19:36:08.123456+00' WHERE id = $1`, [first.id])
  return { first }
}

async function tableNames(db: Db) {
  const { rows } = await db.query<{ name: string }>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema() ORDER BY 1`)
  return rows.map((r) => r.name)
}

/** A table's rows as Postgres writes them, for comparing two databases. */
function contents(db: Db, table: string) {
  return db.transaction(async (tx) => {
    await tx.query(`SET LOCAL TIME ZONE 'UTC'`)
    const { rows } = await tx.query<{ j: string }>(`SELECT row_to_json(r)::text AS j FROM ${table} r ORDER BY 1`)
    return rows.map((r) => r.j).sort()
  })
}

describe('the backup file', () => {
  it('copies every table and puts it back exactly, in a new database', async () => {
    const db = await database()
    const app = await server(db)
    const { first } = await seed(app, db)
    const before = await pull(app)

    const backup = await writeBackup(db)
    const { tables } = backup.header
    expect(tables).toEqual(expect.arrayContaining(['products', 'bookings', 'scans', 'issues', 'people', 'crew_calls', 'offers', 'users', 'mutations', 'changes']))
    for (const left of ['sessions', 'server_meta', 'backup_runs', 'schema_version']) expect(tables).not.toContain(left)
    // Every table after the ones it refers to.
    expect(tables.indexOf('mutations')).toBeLessThan(tables.indexOf('changes'))
    expect(tables.indexOf('products')).toBeLessThan(tables.indexOf('bookings'))
    expect(tables.indexOf('people')).toBeLessThan(tables.indexOf('offers'))
    expect(tables.indexOf('crew_calls')).toBeLessThan(tables.indexOf('offers'))
    expect(tables.indexOf('projects')).toBeLessThan(tables.indexOf('phases'))
    expect(tables.indexOf('phases')).toBeLessThan(tables.indexOf('crew_calls'))
    // Plain text inside: readable without this app.
    expect(gunzipSync(backup.data).toString()).toContain('"name":"Seán Ó Briain"')

    const copy = await database()
    const report = await restoreBackup(copy, backup.data)
    expect(report.rows).toBe(backup.rows)
    for (const table of tables) expect(await contents(copy, table)).toEqual(await contents(db, table))
    const { rows: exact } = await copy.query(`SELECT 1 FROM mutations WHERE received_at = '2026-09-29 19:36:08.123456+00'`)
    expect(exact).toHaveLength(1)
    // Everyone signs in again after a restore.
    expect(await contents(db, 'sessions')).toHaveLength(1)
    expect(await contents(copy, 'sessions')).toEqual([])
    expect(await readGeneration(copy)).not.toBe(await readGeneration(db))

    // The restored copy works: the same changes, and the feed carries on where it was.
    const restored = await server(copy)
    const after = await pull(restored)
    expect(after.changes).toEqual(before.changes)
    expect(after.generation).not.toBe(before.generation)
    const [next] = await push(restored, 'office', m('product.upsert', { id: 'ls9', name: 'Yamaha LS9', quantity: 1 }))
    expect(next).toMatchObject({ status: 'applied', seq: before.head! + 1 })
    // A command it already had is still recognised, so a phone sending it again changes nothing.
    const [again] = await push(restored, 'office', first)
    expect(again).toMatchObject({ status: 'applied', duplicate: true })
    // The freelancer's private link still works.
    const token = (await copy.query<{ link_token: string }>(`SELECT link_token FROM people WHERE id = 'p1'`)).rows[0]!.link_token
    expect((await restored.inject({ method: 'GET', url: `/f/${token}` })).statusCode).toBe(200)
  })

  it('only restores into an empty database', async () => {
    const db = await database()
    await seed(await server(db), db)
    const backup = await writeBackup(db)
    const inUse = await database()
    await server(inUse)
    await expect(restoreBackup(inUse, backup.data)).rejects.toThrow('already has tables')
  })

  it('refuses a file that is damaged, cut short or not a backup, and leaves the database untouched', async () => {
    const db = await database()
    await seed(await server(db), db)
    const text = gunzipSync((await writeBackup(db)).data).toString()

    const cut = gzipSync(text.slice(0, text.lastIndexOf('E\t')))
    await expect(restoreBackup(await database(), cut)).rejects.toThrow('incomplete')

    const target = await database()
    const tampered = gzipSync(text.replace('Seán Ó Briain', 'Sean O Brien'))
    await expect(restoreBackup(target, tampered)).rejects.toThrow("didn't come back exactly")
    expect(await tableNames(target)).toEqual([])

    await expect(restoreBackup(await database(), Buffer.from('not a backup'))).rejects.toThrow("won't unzip")
    await expect(restoreBackup(await database(), gzipSync('hello\n'))).rejects.toThrow('no backup header')
    const newer = gzipSync(text.replace('"schema_version":', '"schema_version":9'))
    await expect(restoreBackup(await database(), newer)).rejects.toThrow('newer version of the app')
  })

  it('restores a backup made before the latest table changes, then brings it up to date', async () => {
    // As the database was before backups existed, and before jobs.
    const old = await database()
    await migrate(old, 2)
    await migrateCrew(old, 1)
    await migrateAuth(old)
    await old.query(`INSERT INTO products (id, name, quantity) VALUES ('y10p', 'd&b Y10P', 4)`)
    const backup = await writeBackup(old)
    expect(backup.header.schemas.schema_version).toBe(2)
    expect(backup.header.schemas.projects_schema_version).toBe(0)

    const copy = await database()
    await restoreBackup(copy, backup.data)
    for (const mod of [CORE, PROJECTS, CREW]) expect(await moduleVersion(copy, mod)).toBe(mod.migrations.length)
    expect(await readGeneration(copy)).toMatch(/^[0-9a-f-]{36}$/)
    expect((await copy.query(`SELECT name FROM products`)).rows).toEqual([{ name: 'd&b Y10P' }])
    await server(copy)
  })
})

describe('the nightly backup', () => {
  it('puts each backup in storage, proves it with a test restore, and reports it', async () => {
    const dir = folder()
    const db = await database()
    const app = await server(db, { backupStore: dirStore(dir) })
    await seed(app, db)
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json().backups).toEqual({ last: null, fresh: false })

    const run = await app.backups.run('nightly')
    expect(run).toMatchObject({ status: 'ok', trigger: 'nightly' })
    expect(run.key).toMatch(/^backups\/\d{4}\/\d{2}\/session-hire-\d{4}-\d{2}-\d{2}T\d{6}Z\.backup\.gz$/)
    const file = join(dir, ...run.key!.split('/'))
    expect(existsSync(file)).toBe(true)
    expect((await checkRestores(readFileSync(file))).rows).toBe(run.rows)

    expect((await app.inject({ method: 'GET', url: '/api/health' })).json().backups).toEqual({ last: run.finishedAt, fresh: true })
    const status = (await app.inject({ method: 'GET', url: '/api/backups' })).json()
    expect(status).toMatchObject({ configured: true, fresh: true, where: `folder ${dir}`, lastOk: { id: run.id }, last: { id: run.id } })
  })

  it('has "Back up now", but not twice in a row', async () => {
    const app = await server(await database(), { backupStore: dirStore(folder()) })
    const first = await app.inject({ method: 'POST', url: '/api/backups/run' })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ status: 'ok', trigger: 'manual' })
    const again = await app.inject({ method: 'POST', url: '/api/backups/run' })
    expect(again.statusCode).toBe(429)
  })

  it('says plainly when backups are off', async () => {
    const app = await server(await database())
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json().backups).toBe('off')
    expect((await app.inject({ method: 'GET', url: '/api/backups' })).json()).toEqual({ configured: false, fresh: false })
    expect((await app.inject({ method: 'POST', url: '/api/backups/run' })).statusCode).toBe(409)
  })

  it('records a failed backup, and one that stopped part way', async () => {
    const db = await database()
    const broken: BackupStore = {
      ...dirStore(folder()),
      put: async () => {
        throw new Error('The backup storage answered 404: The specified bucket does not exist')
      },
    }
    const app = await server(db, { backupStore: broken })
    await db.query(`INSERT INTO backup_runs (id, started_at, status, trigger) VALUES ('crashed', now() - interval '1 hour', 'running', 'nightly')`)

    const run = await app.backups.run('nightly')
    expect(run).toMatchObject({ status: 'failed', error: 'The backup storage answered 404: The specified bucket does not exist' })
    expect(app.backups.status()).toMatchObject({ fresh: false, last: { status: 'failed' } })
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json().backups).toEqual({ last: null, fresh: false })
    const { rows } = await db.query(`SELECT status, error FROM backup_runs WHERE id = 'crashed'`)
    expect(rows[0]).toEqual({ status: 'failed', error: 'Stopped partway (the server restarted).' })
  })

  it('runs at 2am UTC, and soon after start-up when the last good one is over a day old', async () => {
    const db = await database()
    await server(db)
    let now = new Date('2026-09-30T01:30:00Z')
    const backups = await new Backups(db, dirStore(folder()), { now: () => now }).load()
    cleanup.push(() => backups.stop())
    expect(backups.nextNightly().toISOString()).toBe('2026-09-30T02:00:00.000Z')
    now = new Date('2026-09-30T02:00:00Z')
    expect(backups.nextNightly().toISOString()).toBe('2026-10-01T02:00:00.000Z')

    backups.start()
    expect(backups.status().next).toBe('2026-09-30T02:01:00.000Z')
    backups.stop()

    await backups.run('nightly')
    now = new Date(Date.now() + 60_000)
    backups.start()
    expect(backups.status().next).toBe(backups.nextNightly().toISOString())
  })

  it('skips a run that "Back up now" has just done', async () => {
    const db = await database()
    await server(db)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    cleanup.push(() => {
      vi.useRealTimers()
    })
    const backups = await new Backups(db, dirStore(folder())).load()
    cleanup.push(() => backups.stop())

    // Nothing is backed up yet, so a catch-up run is due in a minute, but someone presses "Back up now" first.
    backups.start()
    await backups.run('manual')
    await vi.advanceTimersByTimeAsync(61_000)
    expect(backups.status().next).toBe(backups.nextNightly().toISOString())
    const { rows } = await db.query('SELECT trigger FROM backup_runs')
    expect(rows).toEqual([{ trigger: 'manual' }])
  })

  it('keeps every night for 35 days, then the first of each month for a year', () => {
    const now = new Date('2026-09-30T12:00:00Z')
    const nightly = Array.from({ length: 500 }, (_, d) => ({ key: backupKey(new Date(Date.UTC(2026, 8, 30, 2, 0, 5) - d * DAY)), bytes: 1 }))
    const strangers = [{ key: 'backups/notes.txt', bytes: 1 }, { key: 'photos/stage.jpg', bytes: 1 }]
    const gone = new Set(toThin([...nightly, ...strangers], now))
    const kept = nightly.filter((f) => !gone.has(f.key)).map((f) => f.key)

    expect(kept).toHaveLength(35 + 12)
    expect(kept).toContain(backupKey(new Date('2026-08-27T02:00:05Z')))
    expect(kept).not.toContain(backupKey(new Date('2026-08-26T02:00:05Z')))
    expect(kept).toContain(backupKey(new Date('2026-08-01T02:00:05Z')))
    expect(kept).toContain(backupKey(new Date('2025-09-01T02:00:05Z')))
    expect(kept).not.toContain(backupKey(new Date('2025-08-01T02:00:05Z')))
    for (const f of strangers) expect(gone.has(f.key)).toBe(false)

    // Even if the server was off for a year, the newest few stay.
    const old = nightly.slice(450)
    expect(old.length - toThin(old, now).length).toBe(7)
  })

  it('names each file by when it was made', () => {
    const at = new Date('2026-09-30T02:00:14.512Z')
    expect(backupKey(at)).toBe('backups/2026/09/session-hire-2026-09-30T020014Z.backup.gz')
    expect(keyDate(backupKey(at))?.toISOString()).toBe('2026-09-30T02:00:14.000Z')
    expect(backupKey(at, true)).toBe('backups/2026/09/session-hire-2026-09-30T020014Z.backup.gz.enc')
    expect(keyDate(backupKey(at, true))?.toISOString()).toBe('2026-09-30T02:00:14.000Z')
    expect(keyDate('backups/notes.txt')).toBeUndefined()
  })
})

describe('putting the data back', () => {
  it('restores the newest backup into an empty database on start-up, and never over data', async () => {
    const dir = folder()
    const store = dirStore(dir)
    const db = await database()
    const app = await server(db, { backupStore: store })
    await seed(app, db)
    const older = await new Backups(db, store, { now: () => new Date('2026-09-28T02:00:00Z') }).run('nightly')
    await push(app, 'office', m('product.upsert', { id: 'ls9', name: 'Yamaha LS9', quantity: 1 }))
    const newer = await new Backups(db, store, { now: () => new Date('2026-09-29T02:00:00Z') }).run('nightly')
    expect(await latestKey(store)).toBe(newer.key)
    expect(older.key).not.toBe(newer.key)

    const fresh = await database()
    const restored = await restoreFrom(fresh, store, 'latest')
    expect(restored?.key).toBe(newer.key)
    expect((await fresh.query(`SELECT id FROM products ORDER BY id`)).rows.map((r) => r.id)).toEqual(['ls9', 'sm58', 'y10p'])
    // Left set by mistake on the next deploy: nothing happens.
    expect(await restoreFrom(fresh, store, 'latest')).toBeUndefined()
    await expect(restoreFrom(await database(), undefined, 'latest')).rejects.toThrow('no backup storage')
    await expect(latestKey(dirStore(folder()))).rejects.toThrow('no backups')
  })
})

/** A transport over the in-process app, with a signal switch and a server that can be swapped. */
class TestLink implements Transport {
  online = true
  constructor(public app: FastifyInstance) {}
  async push(req: PushRequest): Promise<PushResponse> {
    if (!this.online) throw new Error('offline')
    return (await this.app.inject({ method: 'POST', url: '/api/sync/push', payload: req })).json()
  }
  async pull(after: number): Promise<PullResponse> {
    if (!this.online) throw new Error('offline')
    return pull(this.app, after)
  }
}

async function phone(app: FastifyInstance, now?: () => Date) {
  const link = new TestLink(app)
  const storage = new MemoryStorage()
  const client = await new SyncClient({ storage, transport: link, now }).open()
  return { link, client, storage }
}

const Y10P = { id: 'y10p', name: 'd&b Y10P', quantity: 4 }
const day = { start: '2026-10-05', end: '2026-10-05' }

describe('phones, after the server is restored from a backup', () => {
  it('start their copy afresh and send again what the backup missed', async () => {
    const db = await database()
    const app = await server(db)
    const office = await phone(app)
    await office.client.mutate('product.upsert', Y10P)
    await office.client.sync()
    const aoife = await phone(app)
    const dara = await phone(app)
    await aoife.client.mutate('booking.create', { id: 'b1', productId: 'y10p', project: 'Before the backup', qty: 1, ...day })
    await aoife.client.sync()
    await dara.client.sync()

    const backup = await writeBackup(db)

    // Work after the backup, which losing the database loses...
    await aoife.client.mutate('booking.create', { id: 'b2', productId: 'y10p', project: 'After the backup', qty: 2, ...day })
    await aoife.client.sync()
    await dara.client.sync()
    expect(dara.client.view().bookings.map((b) => b.id)).toEqual(['b1', 'b2'])
    // ...and a booking still waiting on a phone with no signal.
    dara.link.online = false
    await dara.client.mutate('booking.create', { id: 'b3', productId: 'y10p', project: 'Made offline', qty: 1, ...day })
    await dara.client.sync().catch(() => {})

    // The database is lost, and a new one is restored from last night's backup.
    const fresh = await database()
    await restoreBackup(fresh, backup.data)
    const restored = await server(fresh)
    for (const p of [office, aoife, dara]) {
      p.link.app = restored
      p.link.online = true
    }
    for (let round = 0; round < 2; round++) for (const p of [aoife, dara, office]) await p.client.sync()

    const onServer = (await pull(restored)).changes.filter((c) => c.entity === 'booking').map((c) => c.id)
    expect(new Set(onServer)).toEqual(new Set(['b1', 'b2', 'b3']))
    for (const p of [office, aoife, dara]) {
      const view = p.client.view()
      expect(view.bookings.map((b) => b.id)).toEqual(['b1', 'b2', 'b3'])
      expect(view.pendingCount).toBe(0)
      expect(view.problems).toEqual([])
    }
  })

  it('also notice when the server has gone back in time without saying so', async () => {
    // For example, the database put back to an earlier time with the hosting company's own tools.
    const db = await database()
    const app = await server(db)
    const office = await phone(app)
    await office.client.mutate('product.upsert', Y10P)
    await office.client.sync()
    const backup = await writeBackup(db)
    await office.client.mutate('product.upsert', { id: 'sm58', name: 'Shure SM58', quantity: 20 })
    await office.client.sync()

    const fresh = await database()
    await restoreBackup(fresh, backup.data)
    await fresh.query(`UPDATE server_meta SET value = $1 WHERE key = 'generation'`, [await readGeneration(db)])
    office.link.app = await server(fresh)
    await office.client.sync()

    expect(new Set((await pull(office.link.app)).changes.map((c) => c.id))).toEqual(new Set(['y10p', 'sm58']))
    expect(office.client.view().products.map((p) => p.id)).toEqual(['y10p', 'sm58'])
  })

  it('start afresh when the running server is given a new generation', async () => {
    // A wind-back with the hosting company's own tools, after which new work
    // carried the server past where a device had got to. Only a new
    // generation (the backup command's new-generation) can tell the device.
    const db = await database()
    const app = await server(db)
    const office = await phone(app)
    await office.client.mutate('product.upsert', Y10P)
    await office.client.sync()
    await db.exec(`TRUNCATE changes, products, mutations CASCADE; SELECT setval(pg_get_serial_sequence('changes', 'seq'), 1, false);`)
    const warehouse = await phone(app)
    await warehouse.client.mutate('product.upsert', { id: 'sm58', name: 'Shure SM58', quantity: 20 })
    await warehouse.client.sync()
    await office.client.sync()
    expect(office.client.view().products.map((p) => p.id)).toEqual(['y10p'])

    await newGeneration(db)
    for (let round = 0; round < 2; round++) for (const p of [office, warehouse]) await p.client.sync()
    const ids = (await pull(app)).changes.map((c) => c.id)
    expect(new Set(ids)).toEqual(new Set(['y10p', 'sm58']))
    for (const p of [office, warehouse]) expect(p.client.view().products.map((p) => p.id).sort()).toEqual(['sm58', 'y10p'])
  })

  it('remember what they sent for two weeks, no longer', async () => {
    const app = await server(await database())
    let now = new Date('2026-09-01T09:00:00Z')
    const p = await phone(app, () => now)
    await p.client.mutate('product.upsert', Y10P)
    await p.client.sync()
    now = new Date('2026-09-16T09:00:00Z')
    await p.client.mutate('product.upsert', { id: 'sm58', name: 'Shure SM58', quantity: 20 })
    await p.client.sync()
    const kept = (await p.storage.load())!.sent!.map((s) => (s.args as { id: string }).id)
    expect(kept).toEqual(['sm58'])
  })
})

describe('backup storage', () => {
  it('speaks the S3 language: signed requests to put, list, fetch and delete files', async () => {
    const s3 = await fakeS3()
    const store = s3Store({ endpoint: s3.endpoint, bucket: 'sh-backups', region: 'auto', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', pathStyle: true })
    const files = ['backups/2026/09/a.backup.gz', 'backups/2026/09/b.backup.gz', 'backups/2026/10/c.backup.gz']
    for (const key of files) await store.put(key, Buffer.from(key))
    await store.put('photos/stage.jpg', Buffer.from('x'))

    expect((await store.list('backups/')).map((f) => f.key)).toEqual(files)
    expect((await store.get(files[1]!)).toString()).toBe(files[1])
    await store.delete(files[0]!)
    expect((await store.list('backups/')).map((f) => f.key)).toEqual(files.slice(1))

    const put = s3.seen.find((r) => r.method === 'PUT')!
    expect(put.url).toBe('/sh-backups/backups/2026/09/a.backup.gz')
    expect(put.sha).toBe(createHash('sha256').update(files[0]!).digest('hex'))
    for (const r of s3.seen) expect(r.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*, Signature=[0-9a-f]{64}$/)

    const wrong = s3Store({ endpoint: s3.endpoint, bucket: 'nope', region: 'auto', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', pathStyle: true })
    await expect(wrong.put('backups/x.backup.gz', Buffer.from('x'))).rejects.toThrow('The backup storage answered 404: The specified bucket does not exist')
  })

  it('addresses a Railway bucket by its own name, and older services by path', () => {
    const railway = { endpoint: 'https://t3.storageapi.dev', bucket: 'backups-x1y2z3', region: 'auto', accessKeyId: 'k', secretAccessKey: 's' }
    expect(s3Url(railway, 'backups/2026/09/a.backup.gz')).toBe('https://backups-x1y2z3.t3.storageapi.dev/backups/2026/09/a.backup.gz')
    expect(s3Url({ ...railway, pathStyle: true }, '', { 'list-type': '2', prefix: 'backups/' })).toBe(
      'https://t3.storageapi.dev/backups-x1y2z3/?list-type=2&prefix=backups%2F'
    )
    expect(() => s3Url(railway, '../secrets')).toThrow('Not a backup file name')
  })

  it('is set up from four settings, and all four are needed', () => {
    expect(storeFromEnv({})).toBeUndefined()
    const all = {
      BACKUP_S3_ENDPOINT: 'https://t3.storageapi.dev',
      BACKUP_S3_BUCKET: 'backups-x1y2z3',
      BACKUP_S3_ACCESS_KEY_ID: 'tid_abc',
      BACKUP_S3_SECRET_ACCESS_KEY: 'tsec_abc',
    }
    expect(storeFromEnv(all)?.where).toBe('bucket backups-x1y2z3 at t3.storageapi.dev')
    expect(() => storeFromEnv({ ...all, BACKUP_S3_SECRET_ACCESS_KEY: '' })).toThrow('Backups need all four')
    expect(() => storeFromEnv({ ...all, BACKUP_S3_ENDPOINT: 't3.storageapi.dev' })).toThrow('should be a web address')
    expect(storeFromEnv({ BACKUP_DIR: '/tmp/backups' })?.where).toBe('folder /tmp/backups')
  })
})

/** Just enough of an S3 bucket service, addressed by path, to check the requests the store makes. */
async function fakeS3() {
  const objects = new Map<string, Buffer>()
  const seen: { method: string; url: string; auth: string; sha: string }[] = []
  const srv = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    seen.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization ?? ''), sha: String(req.headers['x-amz-content-sha256'] ?? '') })
    const url = new URL(req.url!, 'http://x')
    const [, bucket, ...rest] = url.pathname.split('/')
    const key = decodeURIComponent(rest.join('/'))
    if (bucket !== 'sh-backups') {
      res.statusCode = 404
      return res.end('<?xml version="1.0"?><Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message></Error>')
    }
    if (req.method === 'PUT') {
      objects.set(key, Buffer.concat(chunks))
      return res.end()
    }
    if (req.method === 'DELETE') {
      objects.delete(key)
      res.statusCode = 204
      return res.end()
    }
    if (url.searchParams.get('list-type') === '2') {
      const all = [...objects.keys()].filter((k) => k.startsWith(url.searchParams.get('prefix') ?? '')).sort()
      const from = Number(url.searchParams.get('continuation-token') ?? 0)
      const page = all.slice(from, from + 2)
      const more = from + 2 < all.length
      return res.end(
        `<?xml version="1.0"?><ListBucketResult>${page
          .map((k) => `<Contents><Key>${k}</Key><LastModified>2026-09-30T02:00:00.000Z</LastModified><Size>${objects.get(k)!.length}</Size></Contents>`)
          .join('')}<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${from + 2}</NextContinuationToken>` : ''}</ListBucketResult>`
      )
    }
    const found = objects.get(key)
    if (!found) {
      res.statusCode = 404
      return res.end('<Error><Message>The specified key does not exist.</Message></Error>')
    }
    res.end(found)
  })
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>((resolve) => srv.close(() => resolve())))
  return { objects, seen, endpoint: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` }
}

describe('backups encrypted under BACKUP_KEY', () => {
  it('go to the store unreadable, prove themselves by a test restore, and come back only with the key', async () => {
    // Proves: with BACKUP_KEY each file is encrypted in storage, checked by a test restore, and readable only with the same key.
    const key = backupKeyFromEnv({ BACKUP_KEY: 'ab'.repeat(32) })!
    const dir = folder()
    const store = dirStore(dir)
    const db = await database()
    const app = await server(db, { backupStore: store, backupKey: key })
    await seed(app, db)
    const run = await app.backups.run('nightly')
    expect(run.status).toBe('ok')
    expect(run.key).toMatch(/\.backup\.gz\.enc$/)
    const file = readFileSync(join(dir, ...run.key!.split('/')))
    expect(isEncrypted(file)).toBe(true)
    expect(() => gunzipSync(file)).toThrow()
    expect(file.toString('latin1')).not.toContain('Briain')
    expect(run.bytes).toBe(file.length)

    await expect(checkRestores(file)).rejects.toThrow('This backup is encrypted. Set BACKUP_KEY to the key it was made with')
    await expect(checkRestores(file, backupKeyFromEnv({ BACKUP_KEY: 'cd'.repeat(32) }))).rejects.toThrow("can't be unlocked with BACKUP_KEY")
    expect((await checkRestores(file, key)).rows).toBe(run.rows)

    // Put back on start-up with the key; the newest file is still found by its name.
    const fresh = await database()
    expect((await restoreFrom(fresh, store, 'latest', key))?.key).toBe(run.key)
    expect((await fresh.query(`SELECT id FROM products ORDER BY id`)).rows.map((r) => r.id)).toEqual(['sm58', 'y10p'])
    await expect(restoreFrom(await database(), store, 'latest')).rejects.toThrow('This backup is encrypted')

    // The Account tab says so; and a plain backup from before the key still restores on a server that has one.
    expect((await app.inject({ method: 'GET', url: '/api/backups' })).json()).toMatchObject({ configured: true, encrypted: true })
    const plain = await writeBackup(db)
    expect((await checkRestores(plain.data, key)).rows).toBe(plain.rows)
  })

  it('take a key that is one, and nothing else', () => {
    // Proves: BACKUP_KEY must be 64 hex characters, and a wrong one is never repeated back.
    expect(backupKeyFromEnv({})).toBeUndefined()
    expect(backupKeyFromEnv({ BACKUP_KEY: '  ' })).toBeUndefined()
    expect(backupKeyFromEnv({ BACKUP_KEY: 'AB'.repeat(32) })).toHaveLength(32)
    expect(() => backupKeyFromEnv({ BACKUP_KEY: 'hunter2' })).toThrow('64 hex characters')
    // Never repeated back: it could be a secret pasted in by mistake.
    expect(() => backupKeyFromEnv({ BACKUP_KEY: 'hunter2' })).not.toThrow('hunter2')
  })
})
