import { createHash, randomBytes } from 'node:crypto'
import type { CalendarChoice, CalendarCheck, CalendarLink } from '@sh/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from '../db.ts'
import { describeDevice } from '../devices.ts'
import { clearCookie, publicOrigin, readCookie, setCookie } from '../http.ts'
import { serverChange, type ServerAction } from '../kernel.ts'
import { open, seal } from './crypto.ts'
import { CALENDAR_SCOPES, type Google } from './google.ts'
import { linkEntity, readLink, saveLink } from './store.ts'
import { Halt, type CalendarSync } from './sync.ts'

/**
 * Connecting Google Calendar from the Account tab (ADR 0008): off to Google
 * to connect an account, back again, pick a calendar, check now, and
 * disconnect. All of it needs a signed-in member of staff, like the rest of
 * the API; the app only has the Google key when sign-in is on.
 */

/** What the server records these as in the history. Not commands, so no device can send them. */
export const CALENDAR_ACTIONS = { connect: 'calendar.connect', use: 'calendar.use', disconnect: 'calendar.disconnect' } as const

/** Holds the attempt (state, PKCE verifier, the device's code) between leaving for Google and coming back. */
const ATTEMPT_COOKIE = 'sh_calendar'
const ATTEMPT_PATH = '/api/calendar'

export interface CalendarRoutes {
  db: Db
  google: Google | undefined
  sync: CalendarSync | undefined
  secret: string | undefined
  /** Devices have something new to pull. */
  onChange: () => void
}

type Outcome = 'connected' | 'cancelled' | 'failed' | 'missing' | 'off'

const deviceCode = (client: unknown) => (typeof client === 'string' && /^[a-z0-9]{1,64}$/.test(client) ? client : undefined)

export function registerCalendarRoutes(app: FastifyInstance, { db, google, sync, secret, onChange }: CalendarRoutes) {
  const callbackUrl = (req: FastifyRequest) => `${publicOrigin(req)}/api/calendar/callback`
  const back = (reply: FastifyReply, outcome: Outcome) => reply.redirect(`/?calendar=${outcome}#account`, 303)
  const action = (req: FastifyRequest, name: string, args: Record<string, unknown>, client?: string): ServerAction => ({
    name,
    args,
    clientId: client,
    userId: req.user?.id,
    device: describeDevice(req.headers['user-agent']),
  })

  app.get<{ Querystring: { client?: string } }>('/api/calendar/connect', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    if (!google) return back(reply, 'off')
    const state = randomBytes(16).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    setCookie(req, reply, ATTEMPT_COOKIE, [state, verifier, deviceCode(req.query.client) ?? ''].join('.'), { maxAge: 600, path: ATTEMPT_PATH })
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url')
    return reply.redirect(google.authorizeUrl({ state, codeChallenge, redirectUri: callbackUrl(req), loginHint: req.user?.email }), 302)
  })

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/api/calendar/callback', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    if (!google || !sync || !secret) return back(reply, 'off')
    const [state, verifier, client] = (readCookie(req, ATTEMPT_COOKIE) ?? '').split('.')
    clearCookie(req, reply, ATTEMPT_COOKIE, ATTEMPT_PATH)
    if (req.query.error) return back(reply, req.query.error === 'access_denied' ? 'cancelled' : 'failed')
    // The state must match the one this browser left with, or someone is trying to connect their own account here.
    if (!state || !verifier || !req.query.code || req.query.state !== state) return back(reply, 'failed')

    let connected
    try {
      connected = await google.exchange({ code: req.query.code, codeVerifier: verifier, redirectUri: callbackUrl(req) })
    } catch (err) {
      req.log.warn({ err }, 'Connecting Google Calendar failed')
      return back(reply, 'failed')
    }
    // Google lets people untick permissions on its consent page; without these the sync can't work.
    if (!CALENDAR_SCOPES.every((s) => connected.scopes.includes(s))) {
      await google.revoke(connected.refreshToken ?? connected.accessToken)
      return back(reply, 'missing')
    }
    if (!connected.refreshToken) return back(reply, 'failed')
    const { identity } = connected

    // Connecting again keeps the calendar, if the account connected now can still change it.
    const before = await readLink(db)
    let calendar = before?.calendarId ? { id: before.calendarId, name: before.calendarName } : undefined
    if (calendar && before?.accountSub !== identity.subject) {
      const still = await google.calendar(connected.accessToken, calendar.id).catch(() => undefined)
      calendar = still ? { id: still.id, name: still.name } : undefined
    }
    // Another account's key is handed back, so it stops working. (The same account's would take the new one with it.)
    if (before?.refreshToken && before.accountSub && before.accountSub !== identity.subject) {
      const old = open(secret, before.refreshToken, before.accountSub)
      if (old) await google.revoke(old)
    }
    const link = await serverChange(db, action(req, CALENDAR_ACTIONS.connect, { account: identity.email }, client || undefined), (ctx) =>
      saveLink(ctx, {
        state: calendar ? 'on' : 'choosing',
        accountEmail: identity.email,
        accountSub: identity.subject,
        refreshToken: seal(secret, connected.refreshToken!, identity.subject),
        calendarId: calendar?.id ?? null,
        calendarName: calendar?.name ?? null,
        problem: null,
        appUrl: publicOrigin(req),
        connectedBy: req.user?.id ?? null,
        connectedAt: new Date().toISOString(),
      })
    )
    sync.connectionChanged(link.state)
    onChange()
    return back(reply, 'connected')
  })

  /** Why the calendar can't be reached just now, for the Account tab. */
  const refuse = async (reply: FastifyReply, err: unknown) => {
    if (!(err instanceof Halt)) throw err
    return reply.code(err.why === 'busy' ? 503 : 409).send({ error: err.problem ?? "Google isn't answering just now. Try again in a minute." })
  }

  app.get('/api/calendar/calendars', async (_req, reply): Promise<CalendarChoice[] | void> => {
    reply.header('cache-control', 'no-store')
    if (!sync) return reply.code(409).send({ error: 'Google Calendar needs the Google key on the server first.' })
    try {
      return await sync.calendars()
    } catch (err) {
      return refuse(reply, err)
    }
  })

  app.post<{ Querystring: { client?: string }; Body: { calendarId?: unknown } }>('/api/calendar/use', async (req, reply): Promise<CalendarLink | void> => {
    if (!sync) return reply.code(409).send({ error: 'Google Calendar needs the Google key on the server first.' })
    const calendarId = typeof req.body?.calendarId === 'string' ? req.body.calendarId : ''
    const link = await readLink(db)
    if (!link || link.state === 'off' || link.state === 'stopping') return reply.code(409).send({ error: 'Connect a Google account first.' })
    let choice: CalendarChoice | undefined
    try {
      choice = calendarId ? await sync.writable(calendarId) : undefined
    } catch (err) {
      return refuse(reply, err)
    }
    if (!choice) return reply.code(400).send({ error: `${link.accountEmail ?? 'The connected account'} can't change that calendar. Pick one from the list.` })
    const after = await serverChange(db, action(req, CALENDAR_ACTIONS.use, { calendar: choice.name }, deviceCode(req.query.client)), (ctx) =>
      saveLink(ctx, { state: 'on', calendarId: choice.id, calendarName: choice.name, problem: null })
    )
    sync.connectionChanged(after.state)
    onChange()
    return linkEntity(after)
  })

  app.post('/api/calendar/check', async (_req, reply): Promise<CalendarCheck | void> => {
    if (!sync) return reply.code(409).send({ error: 'Google Calendar needs the Google key on the server first.' })
    const link = await readLink(db)
    if (link?.state !== 'on') return reply.code(409).send({ error: 'No calendar is being written to yet.' })
    return sync.run(true)
  })

  app.post<{ Querystring: { client?: string } }>('/api/calendar/disconnect', async (req, reply): Promise<CalendarLink | void> => {
    const link = await readLink(db)
    if (!sync || !link || link.state === 'off') return reply.code(409).send({ error: 'Google Calendar is not connected.' })
    if (link.state === 'stopping') return linkEntity(link)
    const after = await serverChange(
      db,
      action(req, CALENDAR_ACTIONS.disconnect, { account: link.accountEmail, calendar: link.calendarName }, deviceCode(req.query.client)),
      (ctx) => saveLink(ctx, { state: 'stopping', problem: null })
    )
    sync.connectionChanged(after.state)
    onChange()
    return linkEntity(after)
  })
}
