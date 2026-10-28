import { APP_VERSION, compareVersions, versionInChangelog, type SystemStatus } from '@sh/shared'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp, type AppOptions } from '../src/app.ts'
import { dirStore } from '../src/backup/store.ts'
import { pgliteDb } from '../src/db.ts'
import { outsideLooks } from '../src/status.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Admin › Status (ADR 0093): every check in words, what to do when one needs someone, the looks outside stood in
 * for, and a newer version on main than the server runs said plainly, since Railway has skipped merges before.
 */

const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c()
})

const fuel = async () => ({ centsPerLitre: 214.8, month: 'October 2026', source: 'aa' })

async function server(options: Omit<AppOptions, 'db'> = {}) {
  const db = await pgliteDb()
  const app = await buildApp({ db, fuel, ...options })
  cleanup.push(() => db.close())
  cleanup.push(() => app.close())
  return app
}

const read = async (app: Awaited<ReturnType<typeof server>>, again = false) => {
  const res = await app.inject({ url: `/api/status${again ? '?again=1' : ''}` })
  expect(res.statusCode).toBe(200)
  return res.json() as SystemStatus
}
const check = (s: SystemStatus, id: string) => s.checks.find((c) => c.id === id)!

const bump = (v: string) => v.replace(/\d+$/, (n) => String(Number(n) + 1))

describe('the status of everything the app relies on (ADR 0093)', () => {
  it('says how each stands in words, and what to do about what is off', async () => {
    const app = await server({ outside: { maps: async () => {}, latest: async () => APP_VERSION } })
    const s = await read(app)
    expect(s.version).toBe(APP_VERSION)
    expect(s.checks.map((c) => c.id)).toEqual(['server', 'updates', 'database', 'sign-in', 'errors', 'live', 'backups', 'storage', 'calendar', 'own-calendars', 'current-rms', 'fuel', 'maps'])
    expect(check(s, 'updates')).toMatchObject({ state: 'ok' })
    // Tests keep the database in memory, which the live app never should.
    expect(check(s, 'database')).toMatchObject({ state: 'bad', says: expect.stringMatching(/memory/), todo: expect.stringMatching(/DATABASE_URL/) })
    expect(check(s, 'sign-in')).toMatchObject({ state: 'bad', todo: expect.stringMatching(/GOOGLE_CLIENT_ID/) })
    expect(check(s, 'errors')).toMatchObject({ state: 'warn', todo: expect.stringMatching(/SENTRY_DSN/) })
    expect(check(s, 'backups')).toMatchObject({ state: 'bad', todo: expect.stringMatching(/BACKUP_S3_/) })
    expect(check(s, 'storage').state).toBe('bad')
    expect(check(s, 'calendar')).toMatchObject({ state: 'off' })
    expect(check(s, 'own-calendars')).toMatchObject({ state: 'off' })
    expect(check(s, 'current-rms')).toMatchObject({ state: 'off', todo: expect.stringMatching(/CURRENT_RMS_API_KEY/) })
    expect(check(s, 'fuel')).toMatchObject({ state: 'ok' })
    expect(check(s, 'maps')).toMatchObject({ state: 'ok' })
    for (const c of s.checks) if (c.state === 'bad' || c.state === 'warn') expect(c.todo, c.id).toBeTruthy()
  })

  it('says when main has a newer version than the server runs, and what to do', async () => {
    const app = await server({ outside: { latest: async () => bump(APP_VERSION) } })
    const updates = check(await read(app), 'updates')
    expect(updates).toMatchObject({ state: 'warn', says: expect.stringContaining(`still runs ${APP_VERSION}`), todo: expect.stringMatching(/Deploy Latest Commit/) })
  })

  it("doesn't count GitHub or the map search not answering against the app itself", async () => {
    const down = async () => Promise.reject(new Error('down'))
    const app = await server({ outside: { latest: down, maps: down }, fuel: down })
    const s = await read(app)
    expect(check(s, 'updates').state).toBe('off')
    expect(check(s, 'maps')).toMatchObject({ state: 'warn', says: expect.stringMatching(/Venues already pinned still show/) })
    expect(check(s, 'fuel')).toMatchObject({ state: 'warn', says: expect.stringMatching(/quotes still use it/) })
  })

  it('looks once a minute, unless asked to look again', async () => {
    let asked = 0
    const app = await server({ outside: { latest: async () => (asked++, APP_VERSION) } })
    const first = await read(app)
    expect((await read(app)).checkedAt).toBe(first.checkedAt)
    expect(asked).toBe(1)
    await read(app, true)
    expect(asked).toBe(2)
  })

  it('finds the bucket and the backups in it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sh-status-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    const app = await server({ backupStore: dirStore(dir), backupKey: Buffer.alloc(32, 7) })
    expect(check(await read(app), 'backups')).toMatchObject({ state: 'warn', todo: expect.stringMatching(/Back up now/) })
    expect((await app.inject({ method: 'POST', url: '/api/backups/run' })).statusCode).toBe(200)
    const s = await read(app, true)
    expect(check(s, 'backups')).toMatchObject({ state: 'ok', at: expect.any(String) })
    expect(check(s, 'storage')).toMatchObject({ state: 'ok', says: expect.stringMatching(/1 backup/) })
  }, 30_000)

  it('the health check says which version is live', async () => {
    const app = await server({ commit: 'abc123def456' })
    expect((await app.inject({ url: '/api/health' })).json()).toMatchObject({ version: APP_VERSION, commit: 'abc123def456' })
  })

  it('reads the newest version from the changelog as GitHub has it', async () => {
    const source = readFileSync(new URL('../../shared/src/changelog.ts', import.meta.url), 'utf8')
    expect(versionInChangelog(source)).toBe(APP_VERSION)
    const looks = outsideLooks({ fetch: (async () => new Response(source)) as typeof fetch })
    expect(await looks.latest!()).toBe(APP_VERSION)
    expect(compareVersions('1.10.0', '1.9.3')).toBe(1)
    expect(compareVersions('1.9.3', '1.9.3')).toBe(0)
  })
})
