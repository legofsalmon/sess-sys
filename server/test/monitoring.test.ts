import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import * as Sentry from '@sentry/node'
import { newId, redact } from '@sh/shared'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { Backups } from '../src/backup/service.ts'
import { dirStore, type BackupStore } from '../src/backup/store.ts'
import { pgliteDb, type Db } from '../src/db.ts'
import { BACKUP_MONITOR, backupWatch, errorReportingFromEnv, startErrorReporting } from '../src/monitoring.ts'

/**
 * Error alerts and uptime checks (ADR 0005). Sentry is stood in for by a
 * little server here that keeps whatever is sent to it, so the tests can
 * check what a report holds and, as much, what it doesn't.
 */

let cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

async function database() {
  const db = await pgliteDb()
  cleanup.push(() => db.close().catch(() => {}))
  return db
}

async function server(db: Db, options: Omit<Parameters<typeof buildApp>[0], 'db'> = {}) {
  const app = await buildApp({ db, ...options })
  cleanup.push(() => app.close())
  return app
}

function folder() {
  const dir = mkdtempSync(join(tmpdir(), 'sh-monitoring-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Every item sent to the stand-in Sentry, as parsed JSON with its item header's type. */
const received: { type: string; body: Record<string, unknown>; raw: string }[] = []
let ingest: ReturnType<typeof createServer>
let dsn = ''

beforeAll(async () => {
  ingest = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      let data = Buffer.concat(chunks)
      if (req.headers['content-encoding'] === 'gzip') data = gunzipSync(data)
      const lines = data.toString('utf8').split('\n').filter(Boolean)
      for (let i = 1; i + 1 < lines.length; i += 2) {
        received.push({ type: JSON.parse(lines[i]!).type, body: JSON.parse(lines[i + 1]!), raw: lines[i + 1]! })
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
  })
  await new Promise<void>((resolve) => ingest.listen(0, '127.0.0.1', resolve))
  dsn = `http://publickey@127.0.0.1:${(ingest.address() as AddressInfo).port}/1`
})

afterAll(async () => {
  await Sentry.close(2000)
  await new Promise((resolve) => ingest.close(resolve))
})

type CheckIn = {
  check_in_id: string
  monitor_slug: string
  status: string
  monitor_config?: { schedule: unknown; timezone: string }
}

async function sent() {
  await Sentry.flush(2000)
  const all = [...received]
  received.length = 0
  return all
}

// Each test builds a database or two, which takes seconds when the other test files are busy too.
describe('uptime checks', { timeout: 30_000 }, () => {
  it('get an answer without the database being asked anything', async () => {
    const db = await database()
    const app = await server(db)
    // With the database gone, the full health check fails, but the uptime check still answers.
    await db.close()
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(500)
    const up = await app.inject({ method: 'GET', url: '/api/up' })
    expect(up.statusCode).toBe(200)
    expect(up.json()).toEqual({ ok: true })
    expect(up.headers['cache-control']).toBe('no-store')
  })
})

describe('error reporting settings', { timeout: 30_000 }, () => {
  it('is off without SENTRY_DSN, and refuses a DSN that is not one', () => {
    expect(errorReportingFromEnv({})).toBeUndefined()
    expect(() => errorReportingFromEnv({ SENTRY_DSN: 'my-project' })).toThrow('should be the DSN Sentry shows')
    expect(errorReportingFromEnv({ SENTRY_DSN: ' https://abc123@o1.ingest.de.sentry.io/456 ', RAILWAY_GIT_COMMIT_SHA: '0123456789abcdef' })).toEqual({
      dsn: 'https://abc123@o1.ingest.de.sentry.io/456',
      environment: 'production',
      release: '0123456789ab',
    })
  })

  it('tells the app on each device where to report, and the health check says whether it is on', async () => {
    const off = await server(await database())
    expect((await off.inject({ method: 'GET', url: '/api/config' })).json()).toEqual({ errors: null })
    expect((await off.inject({ method: 'GET', url: '/api/health' })).json().errors).toBe('off')

    const on = await server(await database(), { errorReporting: { dsn: 'https://abc@o1.ingest.de.sentry.io/2', environment: 'trial' } })
    expect((await on.inject({ method: 'GET', url: '/api/config' })).json()).toEqual({ errors: { dsn: 'https://abc@o1.ingest.de.sentry.io/2', environment: 'trial' } })
    expect((await on.inject({ method: 'GET', url: '/api/health' })).json().errors).toBe('sentry')
  })

  it('sends nothing while it is off', async () => {
    const db = await database()
    const app = await server(db)
    await db.close()
    expect((await app.inject({ method: 'GET', url: '/f/x1Yz_ab-CD34efGH56ijKL78' })).statusCode).toBe(500)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(received).toEqual([])
  })

  it('takes email addresses and private links out of any text it sends', () => {
    const token = 'x1Yz_ab-CD34efGH56ijKL78' // 24 characters, like a freelancer's link
    expect(redact(`No offer for aoife.byrne+test@sessionhire.com on /f/${token}/offers`)).toBe('No offer for [email] on /f/[secret]/offers')
    expect(redact(`token=${token}`)).toBe('token=[secret]')
    // The app's own ids are shorter, and stay, so a report can still say which booking.
    const id = newId()
    expect(redact(`No booking ${id}`)).toBe(`No booking ${id}`)
  })
})

describe('with reporting on', { timeout: 30_000 }, () => {
  beforeAll(() => startErrorReporting({ dsn, environment: 'test', release: 'abc123' }))

  it('reports a request that failed on the server by its route, never its address or who sent it', async () => {
    const db = await database()
    const app = await server(db)
    await sent()
    const token = 'x1Yz_ab-CD34efGH56ijKL78'
    await db.close()
    const res = await app.inject({
      method: 'POST',
      url: `/f/${token}/away?from=aoife@example.ie`,
      headers: { cookie: 'sh_session=secret-session-value', 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'start=2026-10-01&end=2026-10-02&note=Seán+Ó+Briain+087+123+4567',
    })
    expect(res.statusCode).toBe(500)

    const events = (await sent()).filter((i) => i.type === 'event')
    expect(events).toHaveLength(1)
    const event = events[0]!.body as { tags: Record<string, string>; exception: { values: { type: string }[] }; environment: string; release: string }
    expect(event.tags).toMatchObject({ route: '/f/:token/away', method: 'POST' })
    expect(event.exception.values.at(-1)?.type).toBeTruthy()
    expect(event).toMatchObject({ environment: 'test', release: 'abc123' })
    expect(event).not.toHaveProperty('request')
    expect(event).not.toHaveProperty('user')
    // Long enough not to turn up by chance in the report's own numbers, such as its memory figures.
    const secrets = [token, 'aoife@example.ie', 'secret-session-value', 'Seán', 'Briain', '087+123+4567', '087 123 4567']
    for (const secret of secrets) expect(events[0]!.raw).not.toContain(secret)
  })

  it('does not report a request that was simply turned away', async () => {
    const app = await server(await database())
    await sent()
    expect((await app.inject({ method: 'POST', url: '/api/sync/push', payload: { nonsense: true } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/f/no-such-link' })).statusCode).toBe(404)
    expect(await sent()).toEqual([])
  })

  it('checks each scheduled backup in with Sentry, and reports a failed one with its reason', async () => {
    const db = await database()
    await server(db)
    const good = await new Backups(db, dirStore(folder()), { watch: backupWatch() }).load()
    await sent()

    expect((await good.run('nightly')).status).toBe('ok')
    // Each is sent as it happens, and two sends can arrive either way round.
    const checkIns = (await sent()).filter((i) => i.type === 'check_in').map((i) => i.body as CheckIn)
    expect(checkIns.map((c) => c.status).sort()).toEqual(['in_progress', 'ok'])
    expect(new Set(checkIns.map((c) => c.check_in_id)).size).toBe(1)
    expect(checkIns.find((c) => c.status === 'in_progress')).toMatchObject({
      monitor_slug: BACKUP_MONITOR,
      monitor_config: { schedule: { type: 'crontab', value: '0 2 * * *' }, timezone: 'Etc/UTC' },
    })

    const broken: BackupStore = {
      ...dirStore(folder()),
      put: async () => {
        throw new Error('The backup storage answered 403: Access Denied')
      },
    }
    const bad = await new Backups(db, broken, { watch: backupWatch() }).load()
    await db.query(`DELETE FROM backup_runs`)
    expect((await bad.run('retry')).status).toBe('failed')
    const items = await sent()
    expect(items.filter((i) => i.type === 'check_in').map((i) => (i.body as CheckIn).status).sort()).toEqual(['error', 'in_progress'])
    const failure = items.find((i) => i.type === 'event')?.body as { tags: Record<string, string>; exception: { values: { type: string; value: string }[] } }
    expect(failure.tags).toMatchObject({ area: 'backups', trigger: 'retry' })
    expect(failure.exception.values.at(-1)).toMatchObject({ type: 'BackupFailed', value: 'The backup storage answered 403: Access Denied' })
  })

  it('leaves "Back up now" out of the schedule', async () => {
    const db = await database()
    await server(db)
    const backups = await new Backups(db, dirStore(folder()), { watch: backupWatch() }).load()
    await sent()
    expect((await backups.run('manual')).status).toBe('ok')
    expect((await sent()).filter((i) => i.type === 'check_in')).toEqual([])
  })
})
