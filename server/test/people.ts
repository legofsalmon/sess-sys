import { newId, type CommandInput, type CommandName, type HistoryPage, type MutationResult } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, expect } from 'vitest'
import { buildApp } from '../src/app.ts'
import type { IdentityProvider } from '../src/auth/google.ts'
import { createSession, upsertUser } from '../src/auth/sessions.ts'
import { pgliteDb, type Db } from '../src/db.ts'

/** Staff signed in on their own devices, and freelancers on their private links, for the history and export tests. */

export const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
export const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'
export const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

/** The app with sign-in on. Nobody signs in through Google here; staff are given sessions directly. */
export async function server() {
  const db = await pgliteDb()
  const app = await buildApp({ db, auth: { provider: {} as IdentityProvider, domains: ['sessionhire.com'], emails: [] } })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  return { app, db }
}

interface SendOptions {
  /** Made this long before it was sent, as when there's no signal. */
  hoursWaiting?: number
  /** How far the device's clock is out. */
  clockOffHours?: number
  /** Leave out when it was sent, as versions of the app from before the history did. */
  oldApp?: boolean
}

/** A member of staff, signed in on one device. */
export async function staff(app: FastifyInstance, db: Db, name: string, userAgent: string, clientId: string) {
  const email = `${name.split(' ')[0]!.toLowerCase()}@sessionhire.com`
  const user = await upsertUser(db, { subject: newId(), email, emailVerified: true, name, hostedDomain: 'sessionhire.com' })
  const session = await createSession(db, user.id, userAgent)
  const cookies = { sh_session: session }
  return {
    id: user.id,
    email,
    session,
    cookies,
    async send<N extends CommandName>(command: N, args: CommandInput<N>, opts: SendOptions = {}): Promise<MutationResult> {
      const clock = Date.now() + (opts.clockOffHours ?? 0) * 3_600_000
      const createdAt = new Date(clock - (opts.hoursWaiting ?? 0) * 3_600_000).toISOString()
      const res = await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: { 'user-agent': userAgent },
        cookies,
        payload: { clientId, mutations: [{ id: newId(), name: command, args, createdAt }], ...(opts.oldApp ? {} : { sentAt: new Date(clock).toISOString() }) },
      })
      expect(res.statusCode).toBe(200)
      return res.json().results[0]
    },
    async history(query = ''): Promise<HistoryPage> {
      const res = await app.inject({ url: `/api/history${query}`, cookies })
      expect(res.statusCode).toBe(200)
      return res.json()
    },
    /** The latest state of a record, as this device would see it. */
    async record<T>(entity: string, id: string): Promise<T> {
      const res = await app.inject({ url: '/api/sync/pull?after=0', cookies })
      const changes = res.json().changes.filter((c: { entity: string; id: string }) => c.entity === entity && c.id === id)
      return changes[changes.length - 1].data
    },
  }
}

/**
 * The message a page shows after a post, in words, and whether it's a
 * thank-you: read from the page, since the address carries only a code
 * (audit finding 21).
 */
export function flashOf(html: string): { ok: boolean; message: string } {
  const found = /<p class="flash (\w+)"[^>]*>(.*?)<\/p>/.exec(html)
  const message = found ? found[2]!.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : ''
  return { ok: found?.[1] === 'ok', message }
}

/** Post a form from a freelancer's private link page, from their phone. */
export async function onLink(app: FastifyInstance, path: string, fields: Record<string, string>) {
  const res = await app.inject({
    method: 'POST',
    url: path,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': ANDROID },
    payload: new URLSearchParams(fields).toString(),
  })
  expect(res.statusCode).toBe(303)
  const to = new URL(res.headers.location as string, 'http://x')
  expect(flashOf((await app.inject({ url: to.pathname + to.search })).body).ok).toBe(true)
}
