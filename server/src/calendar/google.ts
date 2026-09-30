import type { CalendarChoice } from '@sh/shared'
import { identityFromIdToken, type Identity } from '../auth/google.ts'

/**
 * Google, for the calendar sync (ADR 0008): the OAuth steps that connect an
 * account and keep the app's access fresh, and the few Calendar API calls
 * the sync makes. Everything goes through `fetch`, so tests can stand in a
 * pretend Google.
 */

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const API = 'https://www.googleapis.com/calendar/v3'

/**
 * All the app asks for: to change events on the account's calendars, and to
 * see the list of its calendars so one can be picked. Not the calendars
 * themselves, their sharing, or anything else in the account.
 */
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const

/**
 * What went wrong, sorted by what the sync should do about it:
 *
 * - `expired`: the app's short-lived access has run out; get a new one;
 * - `revoked`: Google no longer accepts the app's key; someone must connect again;
 * - `exists`: an event with that id is already there;
 * - `gone`: no such event (or it was deleted and forgotten);
 * - `busy`: Google is busy, limiting the app, or couldn't be reached; wait and try again;
 * - `access`: the account can't change that calendar, or the Calendar API is off;
 * - `refused`: Google turned down what was sent.
 */
export type GoogleProblem = 'expired' | 'revoked' | 'exists' | 'gone' | 'busy' | 'access' | 'refused'

export class GoogleError extends Error {
  constructor(
    readonly problem: GoogleProblem,
    readonly status: number,
    /** Google's own short code for it, such as `rateLimitExceeded`. */
    readonly reason: string,
    message: string
  ) {
    super(message)
  }
}

const LIMITS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded'])

function problemFor(status: number, reason: string): GoogleProblem {
  if (status === 401) return 'expired'
  if (status === 409) return 'exists'
  if (status === 404 || status === 410) return 'gone'
  if (status === 429 || status >= 500 || (status === 403 && LIMITS.has(reason))) return 'busy'
  if (status === 403) return 'access'
  return 'refused'
}

async function failure(res: Response): Promise<GoogleError> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[]; status?: string } | string }
  const error = typeof body.error === 'object' ? body.error : undefined
  const reason = error?.errors?.[0]?.reason ?? error?.status ?? (typeof body.error === 'string' ? body.error : '')
  return new GoogleError(problemFor(res.status, reason), res.status, reason, `Google answered ${res.status}${reason ? ` (${reason})` : ''}`)
}

export interface GoogleEvent {
  id: string
  etag: string
  status: 'confirmed' | 'tentative' | 'cancelled'
  htmlLink?: string
  summary?: string
  extendedProperties?: { private?: Record<string, string> }
}

/** What the app writes for one phase-day. */
export interface EventBody {
  summary: string
  location: string
  description: string
  start: { date: string }
  end: { date: string }
  status: 'confirmed'
  extendedProperties: { private: Record<string, string> }
}

export interface Connected {
  identity: Identity
  refreshToken: string | undefined
  accessToken: string
  expiresIn: number
  scopes: string[]
}

export interface GoogleOptions {
  clientId: string
  clientSecret: string
  fetch?: typeof fetch
}

export class Google {
  private readonly fetch: typeof fetch

  constructor(readonly options: GoogleOptions) {
    this.fetch = options.fetch ?? fetch
  }

  /**
   * Where to send the person to connect an account. `offline` and `consent`
   * make Google hand over a lasting key every time, not just the first.
   */
  authorizeUrl({ state, codeChallenge, redirectUri, loginHint }: { state: string; codeChallenge: string; redirectUri: string; loginHint?: string }): string {
    const q = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: ['openid', 'email', ...CALENDAR_SCOPES].join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    })
    if (loginHint) q.set('login_hint', loginHint)
    return `${AUTHORIZE_URL}?${q}`
  }

  async exchange({ code, codeVerifier, redirectUri }: { code: string; codeVerifier: string; redirectUri: string }): Promise<Connected> {
    const t = await this.token({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: redirectUri })
    if (!t.id_token) throw new GoogleError('refused', 200, '', 'Google sent no ID token')
    return {
      identity: identityFromIdToken(t.id_token, this.options.clientId),
      refreshToken: t.refresh_token,
      accessToken: t.access_token,
      expiresIn: t.expires_in ?? 3600,
      scopes: (t.scope ?? '').split(' ').filter(Boolean),
    }
  }

  /** A fresh short-lived access from the lasting key. */
  async refresh(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
    const t = await this.token({ grant_type: 'refresh_token', refresh_token: refreshToken })
    return { accessToken: t.access_token, expiresIn: t.expires_in ?? 3600 }
  }

  /** Hand the key back, so it stops working. A key that already doesn't work is fine. */
  async revoke(token: string): Promise<void> {
    await this.fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined)
  }

  /** The calendars the account can change, the account's own first. */
  async calendars(accessToken: string): Promise<CalendarChoice[]> {
    const out: CalendarChoice[] = []
    let pageToken: string | undefined
    do {
      const q = new URLSearchParams({ minAccessRole: 'writer', maxResults: '250' })
      if (pageToken) q.set('pageToken', pageToken)
      const page = await this.api<{ items?: CalendarListEntry[]; nextPageToken?: string }>(accessToken, 'GET', `/users/me/calendarList?${q}`)
      for (const c of page.items ?? []) if (c.accessRole === 'owner' || c.accessRole === 'writer') out.push(choice(c))
      pageToken = page.nextPageToken
    } while (pageToken)
    return out.sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name))
  }

  /** One calendar, if the account can still change it. */
  async calendar(accessToken: string, calendarId: string): Promise<CalendarChoice | undefined> {
    try {
      const c = await this.api<CalendarListEntry>(accessToken, 'GET', `/users/me/calendarList/${encodeURIComponent(calendarId)}`)
      return c.accessRole === 'owner' || c.accessRole === 'writer' ? choice(c) : undefined
    } catch (err) {
      if (err instanceof GoogleError && err.problem === 'gone') return undefined
      throw err
    }
  }

  insertEvent(accessToken: string, calendarId: string, id: string, body: EventBody) {
    return this.api<GoogleEvent>(accessToken, 'POST', `${events(calendarId)}?sendUpdates=none`, { id, ...body })
  }

  /** Replace the event with what the app says it should be; this also brings back one deleted in Google. */
  updateEvent(accessToken: string, calendarId: string, eventId: string, body: EventBody) {
    return this.api<GoogleEvent>(accessToken, 'PUT', `${events(calendarId)}/${encodeURIComponent(eventId)}?sendUpdates=none`, body)
  }

  async deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
    await this.api(accessToken, 'DELETE', `${events(calendarId)}/${encodeURIComponent(eventId)}?sendUpdates=none`)
  }

  /** The app's own events ending after `timeMin`, deleted ones included, found by the app's hidden mark. */
  async listEvents(accessToken: string, calendarId: string, { mark, timeMin }: { mark: string; timeMin: string }): Promise<GoogleEvent[]> {
    const out: GoogleEvent[] = []
    let pageToken: string | undefined
    do {
      const q = new URLSearchParams({ privateExtendedProperty: mark, timeMin, showDeleted: 'true', singleEvents: 'true', maxResults: '2500' })
      if (pageToken) q.set('pageToken', pageToken)
      const page = await this.api<{ items?: GoogleEvent[]; nextPageToken?: string }>(accessToken, 'GET', `${events(calendarId)}?${q}`)
      out.push(...(page.items ?? []))
      pageToken = page.nextPageToken
    } while (pageToken)
    return out
  }

  private async token(params: Record<string, string>) {
    let res: Response
    try {
      res = await this.fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...params, client_id: this.options.clientId, client_secret: this.options.clientSecret }),
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new GoogleError('busy', 0, 'unreachable', "Couldn't reach Google")
    }
    if (!res.ok) {
      const err = await failure(res)
      // The key was revoked, expired, or belongs to another app: only connecting again helps.
      if (err.reason === 'invalid_grant') throw new GoogleError('revoked', res.status, err.reason, err.message)
      // The app's own client id or secret is wrong: only fixing the server's settings helps.
      if (err.reason === 'invalid_client' || err.reason === 'unauthorized_client') throw new GoogleError('access', res.status, err.reason, err.message)
      throw err
    }
    return (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string }
  }

  private async api<T>(accessToken: string, method: string, path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await this.fetch(`${API}${path}`, {
        method,
        headers: { authorization: `Bearer ${accessToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      })
    } catch {
      throw new GoogleError('busy', 0, 'unreachable', "Couldn't reach Google")
    }
    if (!res.ok) throw await failure(res)
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }
}

interface CalendarListEntry {
  id: string
  summary?: string
  summaryOverride?: string
  accessRole: string
  primary?: boolean
}

const choice = (c: CalendarListEntry): CalendarChoice => ({
  id: c.id,
  name: c.summaryOverride || c.summary || c.id,
  primary: c.primary === true,
  access: c.accessRole === 'owner' ? 'owner' : 'writer',
})

const events = (calendarId: string) => `/calendars/${encodeURIComponent(calendarId)}/events`
