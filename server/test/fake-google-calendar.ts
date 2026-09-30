import { createHash } from 'node:crypto'

/**
 * A pretend Google for the calendar sync tests (ADR 0008, 0009): the OAuth
 * token endpoint and the Calendar API calls the app makes, answering as
 * Google does, down to event ids (base32hex only), deleted events keeping
 * their id, etags changing on every edit (a guest answering included), and
 * refusing a replace when the event has changed since it was read. It
 * keeps a log of the emails Google would send guests. Tests can make it
 * busy, revoke the app's key, switch the API off, or edit events and
 * answer invites as people would. For bringing jobs in (ADR 0011), it can
 * also hold events as people make them: with a start time, repeating,
 * out of office, with guests who have names, or in a meeting room.
 */

export type GuestAnswer = 'needsAction' | 'accepted' | 'declined' | 'tentative'

export interface FakeAttendee {
  email: string
  responseStatus: GuestAnswer
  displayName?: string
  organizer?: boolean
  self?: boolean
  resource?: boolean
  comment?: string
}

export interface FakeEvent {
  id: string
  etag: string
  status: 'confirmed' | 'cancelled'
  summary: string
  location: string
  description: string
  /** `date` for an all-day event, `dateTime` for one with a start time. */
  start: { date?: string; dateTime?: string }
  end: { date?: string; dateTime?: string }
  extendedProperties?: { private?: Record<string, string> }
  htmlLink: string
  iCalUID?: string
  recurringEventId?: string
  eventType?: string
  attendees?: FakeAttendee[]
  guestsCanSeeOtherGuests?: false
  guestsCanInviteOthers?: false
  /** When it last changed. */
  updated: string
}

/** An email Google sent a guest about an event. */
export interface SentEmail {
  to: string
  what: 'invited' | 'updated' | 'cancelled'
  /** The event's title and day, as the email would say. */
  event: string
}

interface Account {
  sub: string
  email: string
  /** Calendars on the account's list, with the account's access to each. */
  calendars: Map<string, { summary: string; accessRole: 'owner' | 'writer' | 'reader'; primary?: boolean }>
}

/** The day an event starts, and the day after it ends, whether all-day or with a start time. */
const firstDay = (e: FakeEvent) => e.start.date ?? e.start.dateTime?.slice(0, 10) ?? ''
const lastDayAfter = (e: FakeEvent) => e.end.date ?? dayAfter(e.end.dateTime?.slice(0, 10) ?? '')
const dayAfter = (day: string) => (day ? new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : '')

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const apiError = (status: number, reason: string) => json(status, { error: { code: status, message: reason, errors: [{ reason, message: reason }] } })

export class FakeGoogle {
  readonly clientId = 'client-123.apps.googleusercontent.com'
  readonly clientSecret = 'client-secret-for-tests'
  /** Every calendar's events, by calendar id then event id. */
  readonly events = new Map<string, Map<string, FakeEvent>>()
  /** Events deleted long enough ago that Google has forgotten them: their ids answer 410. */
  readonly purged = new Set<string>()
  /** Every call the app made, as `METHOD path`. */
  readonly calls: string[] = []
  /** What the next person to connect grants. */
  grant = { account: 'ops@sessionhire.com', scopes: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly', refresh: true }
  apiEnabled = true
  /** Answer this many Calendar API calls with "rate limit exceeded". */
  busyFor = 0
  /** Answer these event writes with 400, by title. */
  refuse = new Set<string>()
  /** Carry out this many Calendar API writes, then lose the answer on the way back, as a dropped connection would. */
  loseReplies = 0
  /** Google's clock, for when events changed. */
  clock: () => Date = () => new Date()
  /** Every email Google sent a guest, in order. */
  readonly sent: SentEmail[] = []
  /** Every Calendar API write, as `METHOD sendUpdates`, in order. */
  readonly writes: string[] = []
  /** What each listing of events asked for, in order. */
  readonly lists: URLSearchParams[] = []
  /** Happens just before the next replace reaches Google, as a guest answering at that moment would. */
  beforeNextReplace: (() => void) | undefined
  private accounts = new Map<string, Account>()
  private codes = new Map<string, { account: string; challenge: string; redirectUri: string }>()
  private refreshTokens = new Map<string, { account: string; revoked: boolean }>()
  private accessTokens = new Map<string, { account: string; expires: number }>()
  private n = 0

  constructor() {
    this.addAccount('ops@sessionhire.com', [
      ['ops@sessionhire.com', { summary: 'ops@sessionhire.com', accessRole: 'owner', primary: true }],
      ['test-cal@group.calendar.google.com', { summary: 'Test calendar', accessRole: 'owner' }],
      ['gigs@group.calendar.google.com', { summary: 'Session Hire Gigs', accessRole: 'writer' }],
      ['holidays@group.v.calendar.google.com', { summary: 'Holidays in Ireland', accessRole: 'reader' }],
    ])
    this.addAccount('colly@sessionhire.com', [
      ['colly@sessionhire.com', { summary: 'colly@sessionhire.com', accessRole: 'owner', primary: true }],
      ['gigs@group.calendar.google.com', { summary: 'Session Hire Gigs', accessRole: 'writer' }],
    ])
  }

  addAccount(email: string, calendars: [string, Account['calendars'] extends Map<string, infer V> ? V : never][]) {
    this.accounts.set(email, { sub: `sub-${email}`, email, calendars: new Map(calendars) })
  }

  /** Take away an account's access to a calendar, as unsharing it would. */
  unshare(email: string, calendarId: string) {
    this.accounts.get(email)!.calendars.delete(calendarId)
  }

  /** The person picks their account and allows access; Google sends the browser back with this. */
  consent(authorizeUrl: string): { code: string; state: string } {
    const url = new URL(authorizeUrl)
    const code = `code-${++this.n}`
    this.codes.set(code, { account: this.grant.account, challenge: url.searchParams.get('code_challenge')!, redirectUri: url.searchParams.get('redirect_uri')! })
    return { code, state: url.searchParams.get('state')! }
  }

  /** Someone removes the app's access in their Google account. */
  revokeAll() {
    for (const t of this.refreshTokens.values()) t.revoked = true
    this.accessTokens.clear()
  }

  /** The events a person looking at the calendar sees. */
  visible(calendarId: string): FakeEvent[] {
    return [...(this.events.get(calendarId)?.values() ?? [])]
      .filter((e) => e.status !== 'cancelled')
      .sort((a, b) => firstDay(a).localeCompare(firstDay(b)) || a.summary.localeCompare(b.summary))
  }

  /** Share a calendar with an account, as its owner would, and the account adds it to its list. */
  share(email: string, calendarId: string, summary: string, accessRole: 'owner' | 'writer' | 'reader' = 'reader') {
    this.accounts.get(email)!.calendars.set(calendarId, { summary, accessRole })
  }

  /**
   * A person adds an event in Google Calendar, as the organiser: all-day
   * over `days` (first and last, or one), or with a start time. Google
   * lists the organiser as a guest too, once there are any.
   */
  add(
    calendarId: string,
    ev: { summary: string; days?: string | [string, string]; at?: string; location?: string; description?: string; guests?: (Partial<FakeAttendee> & { email: string })[] },
    more: Partial<Pick<FakeEvent, 'iCalUID' | 'recurringEventId' | 'eventType' | 'extendedProperties'>> = {}
  ): FakeEvent {
    const id = `ev${++this.n}x`
    const [first, last] = typeof ev.days === 'string' ? [ev.days, ev.days] : (ev.days ?? ['', ''])
    const organiser = [...this.accounts.values()].find((a) => a.calendars.get(calendarId)?.accessRole === 'owner')?.email ?? calendarId
    const guests = (ev.guests ?? []).map((g) => ({ responseStatus: 'needsAction' as const, ...g }))
    const next: FakeEvent = {
      id,
      etag: `"${++this.n}"`,
      status: 'confirmed',
      summary: ev.summary,
      location: ev.location ?? '',
      description: ev.description ?? '',
      start: ev.at ? { dateTime: ev.at } : { date: first },
      end: ev.at ? { dateTime: new Date(Date.parse(ev.at) + 3_600_000).toISOString() } : { date: dayAfter(last) },
      htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
      iCalUID: `${id}@google.com`,
      ...(guests.length ? { attendees: [{ email: organiser, responseStatus: 'accepted' as const, organizer: true }, ...guests] } : {}),
      updated: this.clock().toISOString(),
      ...more,
    }
    const store = this.events.get(calendarId) ?? new Map<string, FakeEvent>()
    this.events.set(calendarId, store)
    store.set(id, next)
    return next
  }

  /** A person moves an all-day event to other days. */
  move(calendarId: string, eventId: string, days: string | [string, string]) {
    const [first, last] = typeof days === 'string' ? [days, days] : days
    const ev = this.events.get(calendarId)!.get(eventId)!
    Object.assign(ev, { start: { date: first }, end: { date: dayAfter(last) }, etag: `"${++this.n}"`, updated: this.clock().toISOString() })
  }

  /** A person edits an event in Google Calendar. */
  edit(calendarId: string, eventId: string, changes: Partial<Pick<FakeEvent, 'summary' | 'status' | 'description'>>) {
    const ev = this.events.get(calendarId)!.get(eventId)!
    Object.assign(ev, changes, { etag: `"${++this.n}"`, updated: this.clock().toISOString() })
  }

  /** A guest answers an invite, in their own calendar or from the email. */
  respond(calendarId: string, eventId: string, email: string, responseStatus: GuestAnswer, comment?: string) {
    const ev = this.events.get(calendarId)!.get(eventId)!
    const guest = ev.attendees?.find((a) => a.email.toLowerCase() === email.toLowerCase())
    if (!guest) throw new Error(`${email} isn't a guest on ${ev.summary}`)
    Object.assign(guest, { responseStatus }, comment === undefined ? {} : { comment })
    Object.assign(ev, { etag: `"${++this.n}"`, updated: this.clock().toISOString() })
  }

  /** Someone adds a guest to an event by hand in Google Calendar, or takes one off. */
  setGuest(calendarId: string, eventId: string, email: string, on: boolean) {
    const ev = this.events.get(calendarId)!.get(eventId)!
    const others = (ev.attendees ?? []).filter((a) => a.email.toLowerCase() !== email.toLowerCase())
    ev.attendees = on ? [...others, { email, responseStatus: 'needsAction' }] : others
    Object.assign(ev, { etag: `"${++this.n}"`, updated: this.clock().toISOString() })
  }

  /** The guests on an event, and their answers, as `email answer`. */
  guests(calendarId: string, eventId: string): string[] {
    const ev = this.events.get(calendarId)!.get(eventId)!
    return (ev.attendees ?? []).filter((a) => !a.organizer).map((a) => `${a.email} ${a.responseStatus}`)
  }

  /** Expire every short-lived access key, as an hour passing would. */
  expireAccess() {
    this.accessTokens.clear()
  }

  /** Whether every key Google gave the app for this account has been handed back or revoked. */
  revokedFor(email: string): boolean {
    const keys = [...this.refreshTokens.values()].filter((t) => t.account === email)
    return keys.length > 0 && keys.every((t) => t.revoked)
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const res = await this.answer(input, init)
    const method = init?.method ?? 'GET'
    if (this.loseReplies > 0 && method !== 'GET' && String(input).startsWith('https://www.googleapis.com/calendar/v3/')) {
      this.loseReplies--
      throw new TypeError('fetch failed')
    }
    return res
  }

  private async answer(input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): Promise<Response> {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    this.calls.push(`${method} ${url.pathname}`)
    const form = () => new URLSearchParams(String(init?.body ?? ''))
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token') return this.token(form())
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke') {
      const t = this.refreshTokens.get(form().get('token') ?? '')
      if (t) t.revoked = true
      return json(200, {})
    }
    if (url.host !== 'www.googleapis.com' || !url.pathname.startsWith('/calendar/v3/')) return json(404, {})

    const bearer = String((init?.headers as Record<string, string>)?.authorization ?? '').replace(/^Bearer /, '')
    const access = this.accessTokens.get(bearer)
    if (!access || access.expires < Date.now()) return apiError(401, 'authError')
    if (!this.apiEnabled) return apiError(403, 'accessNotConfigured')
    if (this.busyFor > 0) {
      this.busyFor--
      return apiError(403, 'rateLimitExceeded')
    }
    const account = this.accounts.get(access.account)!
    const path = url.pathname.slice('/calendar/v3'.length).split('/').map(decodeURIComponent)

    if (path[1] === 'users' && path[3] === 'calendarList') {
      const items = [...account.calendars].map(([id, c]) => ({ id, ...c }))
      if (path[4]) {
        const found = items.find((c) => c.id === path[4])
        return found ? json(200, found) : apiError(404, 'notFound')
      }
      const min = url.searchParams.get('minAccessRole')
      return json(200, { items: items.filter((c) => min !== 'writer' || c.accessRole !== 'reader') })
    }

    if (path[1] === 'calendars' && path[3] === 'events') {
      const calendarId = path[2]!
      const cal = account.calendars.get(calendarId)
      if (!cal) return apiError(404, 'notFound')
      const store = this.events.get(calendarId) ?? new Map<string, FakeEvent>()
      this.events.set(calendarId, store)
      const eventId = path[4]
      if (method === 'GET' && !eventId) {
        this.lists.push(url.searchParams)
        const [key, value] = (url.searchParams.get('privateExtendedProperty') ?? '').split('=')
        const timeMin = url.searchParams.get('timeMin')?.slice(0, 10) ?? ''
        const timeMax = url.searchParams.get('timeMax')?.slice(0, 10) ?? '9999'
        const updatedMin = url.searchParams.get('updatedMin') ?? ''
        // Changes since a time also list deleted events, as Google does.
        const showDeleted = url.searchParams.get('showDeleted') === 'true' || updatedMin !== ''
        const items = [...store.values()].filter(
          (e) =>
            (!key || e.extendedProperties?.private?.[key] === value) &&
            lastDayAfter(e) > timeMin &&
            firstDay(e) < timeMax &&
            e.updated >= updatedMin &&
            (showDeleted || e.status !== 'cancelled')
        )
        return json(200, { items })
      }
      const sendUpdates = url.searchParams.get('sendUpdates') ?? 'false'
      const ev = eventId ? store.get(eventId) : undefined
      if (method === 'GET') {
        if (eventId && this.purged.has(eventId)) return apiError(410, 'deleted')
        return ev ? json(200, ev) : apiError(404, 'notFound')
      }
      if (cal.accessRole === 'reader') return apiError(403, 'requiredAccessLevel')
      const body = init?.body ? (JSON.parse(String(init.body)) as Partial<FakeEvent> & { id?: string }) : {}
      if (body.summary && this.refuse.has(body.summary)) return apiError(400, 'badRequest')
      this.writes.push(`${method} ${sendUpdates}`)
      if (method === 'POST' && !eventId) {
        const id = body.id ?? `auto${++this.n}`
        if (!/^[a-v0-9]{5,1024}$/.test(id)) return apiError(400, 'invalid')
        if (store.has(id) || this.purged.has(id)) return apiError(409, 'duplicate')
        const next = this.stored(account, calendarId, id, body)
        store.set(id, next)
        if (sendUpdates === 'all') this.email(next.attendees, 'invited', next)
        return json(200, next)
      }
      if (eventId && this.purged.has(eventId)) return apiError(410, 'deleted')
      if (!ev) return apiError(404, 'notFound')
      if (method === 'PUT') {
        const meanwhile = this.beforeNextReplace
        this.beforeNextReplace = undefined
        meanwhile?.()
        const ifMatch = (init?.headers as Record<string, string>)?.['if-match']
        if (ifMatch && ifMatch !== ev.etag) return apiError(412, 'conditionNotMet')
        const next = this.stored(account, calendarId, ev.id, body)
        store.set(ev.id, next)
        if (sendUpdates === 'all') {
          const had = (e: string, list?: FakeAttendee[]) => list?.some((a) => a.email.toLowerCase() === e.toLowerCase()) ?? false
          const changed = (['summary', 'location', 'description'] as const).some((k) => ev[k] !== next[k]) || ev.status !== next.status
          this.email(next.attendees?.filter((a) => !had(a.email, ev.attendees)), 'invited', next)
          if (changed) this.email(next.attendees?.filter((a) => had(a.email, ev.attendees)), 'updated', next)
          this.email(ev.attendees?.filter((a) => !had(a.email, next.attendees)), 'cancelled', next)
        }
        return json(200, next)
      }
      if (method === 'DELETE') {
        if (ev.status === 'cancelled') return apiError(410, 'deleted')
        Object.assign(ev, { status: 'cancelled', etag: `"${++this.n}"`, updated: this.clock().toISOString() })
        if (sendUpdates === 'all') this.email(ev.attendees, 'cancelled', ev)
        return new Response(null, { status: 204 })
      }
    }
    return apiError(404, 'notFound')
  }

  private email(to: FakeAttendee[] | undefined, what: SentEmail['what'], ev: FakeEvent) {
    for (const a of to ?? []) if (!a.organizer) this.sent.push({ to: a.email, what, event: `${ev.start.date} ${ev.summary}` })
  }

  /**
   * An event as Google keeps it. Guests who haven't answered are waiting on
   * them; the organizer is listed as a guest too, once there are any.
   */
  private stored(account: Account, calendarId: string, id: string, body: Partial<FakeEvent>): FakeEvent {
    const guests = (body.attendees ?? []).map((a) => ({ ...a, responseStatus: a.responseStatus ?? 'needsAction' }))
    const attendees =
      guests.length && !guests.some((a) => a.organizer) ? [{ email: account.email, responseStatus: 'accepted' as const, organizer: true, self: true }, ...guests] : guests
    return {
      id,
      etag: `"${++this.n}"`,
      status: body.status === 'cancelled' ? 'cancelled' : 'confirmed',
      summary: body.summary ?? '',
      location: body.location ?? '',
      description: body.description ?? '',
      start: body.start ?? { date: '' },
      end: body.end ?? { date: '' },
      ...(body.extendedProperties ? { extendedProperties: body.extendedProperties } : {}),
      htmlLink: `https://www.google.com/calendar/event?eid=${Buffer.from(`${id} ${calendarId}`).toString('base64url')}`,
      ...(attendees.length ? { attendees } : {}),
      ...(body.guestsCanSeeOtherGuests === false ? { guestsCanSeeOtherGuests: false as const } : {}),
      ...(body.guestsCanInviteOthers === false ? { guestsCanInviteOthers: false as const } : {}),
      updated: this.clock().toISOString(),
    }
  }

  private token(form: URLSearchParams): Response {
    if (form.get('client_id') !== this.clientId || form.get('client_secret') !== this.clientSecret) return json(401, { error: 'invalid_client' })
    const grant = form.get('grant_type')
    let account: string
    let refresh: string | undefined
    if (grant === 'authorization_code') {
      const c = this.codes.get(form.get('code') ?? '')
      this.codes.delete(form.get('code') ?? '')
      if (!c || c.redirectUri !== form.get('redirect_uri')) return json(400, { error: 'invalid_grant' })
      if (createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== c.challenge) return json(400, { error: 'invalid_grant' })
      account = c.account
      if (this.grant.refresh) {
        refresh = `refresh-${++this.n}-${account}`
        this.refreshTokens.set(refresh, { account, revoked: false })
      }
    } else if (grant === 'refresh_token') {
      const t = this.refreshTokens.get(form.get('refresh_token') ?? '')
      if (!t || t.revoked) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
      account = t.account
    } else return json(400, { error: 'unsupported_grant_type' })
    const accessToken = `access-${++this.n}`
    this.accessTokens.set(accessToken, { account, expires: Date.now() + 3_600_000 })
    const a = this.accounts.get(account)!
    const claims = { iss: 'https://accounts.google.com', aud: this.clientId, sub: a.sub, email: a.email, email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600, hd: 'sessionhire.com' }
    const idToken = `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`
    return json(200, {
      access_token: accessToken,
      expires_in: 3599,
      token_type: 'Bearer',
      scope: this.grant.scopes,
      ...(refresh ? { refresh_token: refresh } : {}),
      ...(grant === 'authorization_code' ? { id_token: idToken } : {}),
    })
  }
}
