import { irishToday, type CalendarCheck, type CalendarChoice } from '@sh/shared'
import type { Db } from '../db.ts'
import { serverChange } from '../kernel.ts'
import { open } from './crypto.ts'
import { eventId, wantedEvents, type Wanted } from './events.ts'
import { GoogleError, type Google, type GoogleEvent } from './google.ts'
import { readDays, readLink, saveDay, saveLink, type DayRow, type Link } from './store.ts'

/**
 * The calendar sync (ADR 0008): makes the connected calendar hold exactly
 * the confirmed jobs' days from today on, as the jobs are now.
 *
 * Each run works out what should be there, compares it with what the app
 * has written (the `calendar_days` rows), and writes only the difference,
 * soonest days first. It runs a moment after any change in the app, once
 * each night with a look at the calendar itself for events changed or
 * deleted in Google, and again later when Google was busy. Nothing else
 * wakes the database.
 */

interface Log {
  info(obj: object, msg: string): void
  warn(obj: object, msg: string): void
  error(obj: object, msg: string): void
}

export interface CalendarSyncOptions {
  db: Db
  google: Google
  /** The app's Google client secret, which unlocks the stored key. */
  secret: string
  log?: Log
  now?: () => Date
  /** Devices have something new to pull. */
  onChange?: () => void
  /** Anything unexpected, for error reports. */
  report?: (err: unknown) => void
  /** The app's own address, for the link in each event; else the one recorded when the calendar was connected. */
  appUrl?: string
  /** How long a burst of changes has to settle before a run. */
  settleMs?: number
  /** Pause between writes, to stay well inside Google's limits. */
  gapMs?: number
  /** The nightly look at the calendar, UTC: a few minutes after the backup, while the database is awake. */
  nightly?: { hour: number; minute: number }
}

/** After Google was busy: a minute, five, a quarter of an hour, then hourly. */
const RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]

const problems = {
  revoked: (account: string | null) =>
    `Google no longer accepts the app's access to ${account ?? 'the account'}'s calendars, so the calendar isn't being updated. Connect again to carry on.`,
  locked: "The app's Google key has changed since the calendar was connected, so its saved access can't be used. Connect again to carry on.",
  apiOff:
    "The Google Calendar API is switched off in the app's Google Cloud project, so nothing can be written. Switch it on (see the setup steps), then press Check now.",
  noAccess: (calendar: string, account: string | null) =>
    `${account ?? 'The connected account'} can't change ${calendar} any more: it may have been deleted, or its sharing changed. Choose another calendar, or give that account permission to change it again.`,
  busy: (at: Date) =>
    `Google Calendar isn't answering, so some days are still on their way. Trying again at ${at.toLocaleTimeString('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit' })}.`,
  badClient:
    "Google doesn't accept the app's own Google key (its client id and secret), so nothing can be written. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Railway, then press Check now.",
  refused: (reason: string) => `Google turned this day down${reason ? ` (${reason})` : ''}. It is tried again when the job changes, and each night.`,
  leftBehind: (n: number, calendar: string) =>
    `${n === 1 ? '1 day was' : `${n} days were`} left on ${calendar}, because Google no longer accepts the app's access. Delete ${n === 1 ? 'it' : 'them'} in Google Calendar if ${n === 1 ? "it isn't" : "they aren't"} wanted.`,
}

/** Stops a run, or a request from the Account tab: the calendar or the account needs a person, or Google needs time. */
export class Halt extends Error {
  constructor(
    readonly why: 'revoked' | 'blocked' | 'busy',
    readonly problem: string | null
  ) {
    super(why)
  }
}

type Op = { kind: 'write'; wanted: Wanted; row: DayRow | undefined } | { kind: 'remove'; row: DayRow } | { kind: 'orphan'; event: GoogleEvent }

export class CalendarSync {
  private active = false
  /** A person has to act first (reconnect, or choose another calendar): no runs on changes until they do. */
  private blocked = false
  private running: Promise<CalendarCheck> | undefined
  private again: { check: boolean } | undefined
  private settleTimer: NodeJS.Timeout | undefined
  private retryTimer: NodeJS.Timeout | undefined
  private nightlyTimer: NodeJS.Timeout | undefined
  private failures = 0
  private access: { token: string; until: number; key: string } | undefined
  private stopped = false
  private readonly now: () => Date

  constructor(private readonly options: CalendarSyncOptions) {
    this.now = options.now ?? (() => new Date())
  }

  /** At start-up: find out whether a calendar is connected, and catch up on anything missed while the server was down. */
  async start() {
    const link = await readLink(this.options.db)
    this.active = link?.state === 'on' || link?.state === 'stopping'
    this.scheduleNightly()
    if (this.active) this.later(5_000)
  }

  stop() {
    this.stopped = true
    for (const t of [this.settleTimer, this.retryTimer, this.nightlyTimer]) clearTimeout(t)
  }

  /** After something changed in the app: run once things settle, if a calendar is connected. */
  kick() {
    if (!this.active || this.blocked || this.stopped) return
    clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => void this.run().catch(() => {}), this.options.settleMs ?? 2_000)
    this.settleTimer.unref()
  }

  /** After the connection changed (connected, calendar chosen, disconnecting): start afresh. */
  connectionChanged(state: Link['state']) {
    this.active = state === 'on' || state === 'stopping'
    this.blocked = false
    this.failures = 0
    this.access = undefined
    clearTimeout(this.retryTimer)
    if (this.active) this.later(0)
  }

  /**
   * One run now, looking at the calendar itself too when `check` is set.
   * A run asked for while one is going happens straight after it.
   */
  run(check = false): Promise<CalendarCheck> {
    if (this.running) {
      this.again = { check: check || (this.again?.check ?? false) }
      return this.running
    }
    this.running = (async () => {
      let result: CalendarCheck
      try {
        result = await this.pass(check)
        while (this.again) {
          const next = this.again
          this.again = undefined
          result = await this.pass(next.check)
        }
        return result
      } finally {
        this.running = undefined
      }
    })()
    return this.running
  }

  /** The calendars the connected account can change, for picking one. */
  calendars(): Promise<CalendarChoice[]> {
    return this.withLink((link) => this.call(link, (t) => this.options.google.calendars(t)))
  }

  /** That calendar, if the connected account can change it. */
  writable(calendarId: string): Promise<CalendarChoice | undefined> {
    return this.withLink((link) => this.call(link, (t) => this.options.google.calendar(t, calendarId)))
  }

  private async withLink<T>(fn: (link: Link) => Promise<T>): Promise<T> {
    const link = await readLink(this.options.db)
    if (!link || link.state === 'off' || link.state === 'stopping') throw new Halt('blocked', 'Connect a Google account first.')
    try {
      return await fn(link)
    } catch (err) {
      // Found out here rather than in a run: say so in the same way.
      if (err instanceof Halt && err.why === 'revoked' && link.state !== 'reconnect') {
        await serverChange(this.options.db, undefined, (ctx) => saveLink(ctx, { state: 'reconnect', problem: err.problem }))
        this.active = false
        this.options.onChange?.()
      }
      throw err
    }
  }

  private later(ms: number) {
    clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => void this.run().catch(() => {}), ms)
    this.settleTimer.unref()
  }

  private scheduleNightly() {
    if (this.stopped) return
    const { hour, minute } = this.options.nightly ?? { hour: 2, minute: 5 }
    const now = this.now()
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute))
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
    clearTimeout(this.nightlyTimer)
    this.nightlyTimer = setTimeout(() => {
      this.scheduleNightly()
      // Each night gives a calendar someone has to fix another go, in case they have.
      this.blocked = false
      if (this.active) void this.run(true).catch(() => {})
    }, next.getTime() - now.getTime())
    this.nightlyTimer.unref()
  }

  private async pass(check: boolean): Promise<CalendarCheck> {
    // This run covers every change made before it started, so a run waiting to go is no longer needed.
    clearTimeout(this.settleTimer)
    clearTimeout(this.retryTimer)
    const result: CalendarCheck = { written: 0, removed: 0, failed: 0 }
    const { db } = this.options
    const link = await readLink(db)
    this.active = link?.state === 'on' || link?.state === 'stopping'
    if (!link || !this.active) return result
    let changed = false
    try {
      const token = await this.accessToken(link)
      const today = irishToday(this.now())
      const rows = await readDays(db, today)
      const byId = new Map(rows.map((r) => [r.id, r]))
      const writing = link.state === 'on' && link.calendarId !== null
      const wanted = writing ? await wantedEvents(db, { today, appKey: link.appKey, appUrl: this.options.appUrl ?? link.appUrl }) : new Map<string, Wanted>()

      // Events changed or deleted in Google since the app wrote them, and any of the app's events it has lost track of.
      const stale = new Set<string>()
      const ops: Op[] = []
      if (check && writing) {
        const ours = new Map(rows.filter((r) => r.state !== 'removed' && r.calendarId === link.calendarId).map((r) => [r.eventId, r]))
        const yesterday = new Date(`${today}T00:00:00Z`)
        yesterday.setUTCDate(yesterday.getUTCDate() - 1)
        const listed = await this.call(link, (t) => this.options.google.listEvents(t, link.calendarId!, { mark: `sh=${link.appKey}`, timeMin: yesterday.toISOString() }), token)
        const seen = new Set<string>()
        for (const ev of listed) {
          const day = ev.extendedProperties?.private?.shDay
          if (!day || day < today) continue
          const row = ours.get(ev.id)
          if (row) {
            seen.add(ev.id)
            if (ev.status === 'cancelled' || ev.etag !== row.etag) stale.add(row.id)
          } else if (ev.status !== 'cancelled') ops.push({ kind: 'orphan', event: ev })
        }
        for (const [id, row] of ours) if (!seen.has(id)) stale.add(row.id)
      }

      // A day Google turned down is tried again when it changes, and on a check, not on every change to anything.
      for (const w of wanted.values()) {
        const row = byId.get(w.key)
        if (
          !row ||
          row.state === 'removed' ||
          row.calendarId !== link.calendarId ||
          row.contentHash !== w.hash ||
          stale.has(row.id) ||
          (check && row.state === 'failed')
        )
          ops.push({ kind: 'write', wanted: w, row })
      }
      for (const row of rows) if (row.state !== 'removed' && !wanted.has(row.id)) ops.push({ kind: 'remove', row })
      const dayOf = (op: Op) => (op.kind === 'write' ? op.wanted.day : op.kind === 'remove' ? op.row.day : (op.event.extendedProperties?.private?.shDay ?? ''))
      ops.sort((a, b) => dayOf(a).localeCompare(dayOf(b)))

      for (const [i, op] of ops.entries()) {
        if (i > 0 && this.options.gapMs !== 0) await new Promise((r) => setTimeout(r, this.options.gapMs ?? 100))
        if (op.kind === 'write') {
          const done = await this.write(link, op.wanted, op.row)
          if (done === 'failed') result.failed++
          else result.written++
        } else if (op.kind === 'remove') {
          await this.remove(link, op.row)
          result.removed++
        } else {
          await this.call(link, (t) => this.options.google.deleteEvent(t, link.calendarId!, op.event.id)).catch(ignoreGone)
          result.removed++
        }
        changed = true
      }

      this.failures = 0
      this.blocked = false
      if (link.state === 'stopping') {
        await this.finishDisconnect(link)
        changed = true
      } else if (link.problem) {
        await serverChange(db, undefined, (ctx) => saveLink(ctx, { problem: null }))
        changed = true
      }
    } catch (err) {
      if (!(err instanceof Halt)) {
        this.options.report?.(err)
        this.options.log?.error({ err }, 'Calendar sync failed')
        throw err
      }
      result.problem = err.problem ?? undefined
      changed = (await this.halted(link, err)) || changed
    } finally {
      if (changed) this.options.onChange?.()
    }
    if (result.written || result.removed || result.failed) this.options.log?.info({ ...result }, 'Calendar sync')
    return result
  }

  /** Put one day on the calendar as it should be now. */
  private async write(link: Link, w: Wanted, row: DayRow | undefined): Promise<'written' | 'failed'> {
    const calendarId = link.calendarId!
    const google = this.options.google
    // Moving calendars: the old event comes off first, so no day is ever on both.
    if (row && row.state !== 'removed' && row.calendarId !== calendarId) {
      await this.remove(link, row)
      row = { ...row, state: 'removed' }
    }
    const before = row
    let generation = row && row.calendarId === calendarId ? row.generation : 0
    // Update the event the app knows is here; otherwise put it on, reusing the same id.
    let known = row?.state === 'on' && row.calendarId === calendarId
    for (let tries = 0; tries < 5; tries++) {
      const id = eventId(link.appKey, calendarId, w.phaseId, w.day, generation)
      try {
        let ev: GoogleEvent
        if (known) ev = await this.call(link, (t) => google.updateEvent(t, calendarId, id, w.body))
        else {
          try {
            ev = await this.call(link, (t) => google.insertEvent(t, calendarId, id, w.body))
          } catch (err) {
            // No calendar to put it in.
            if (err instanceof GoogleError && err.problem === 'gone') throw this.blockedBy(link, err)
            // Already there, from an earlier try or deleted since: make it what it should be.
            if (!(err instanceof GoogleError) || err.problem !== 'exists') throw err
            ev = await this.call(link, (t) => google.updateEvent(t, calendarId, id, w.body))
          }
        }
        await this.saveDay(
          { ...w, calendarId, eventId: id, generation, state: 'on', contentHash: w.hash, etag: ev.etag, htmlLink: ev.htmlLink ?? null, problem: null, id: w.key },
          before
        )
        return 'written'
      } catch (err) {
        if (err instanceof GoogleError && err.problem === 'gone') {
          // That event has gone for good: make a new one.
          generation++
          known = false
          continue
        }
        if (err instanceof GoogleError && err.problem === 'refused') {
          this.options.report?.(err)
          await this.saveDay(
            { ...w, id: w.key, calendarId, eventId: id, generation, state: 'failed', contentHash: w.hash, etag: null, htmlLink: null, problem: problems.refused(err.reason) },
            before
          )
          return 'failed'
        }
        throw err
      }
    }
    throw new Error('Google kept losing the event while it was being written')
  }

  /** Take one day off the calendar it is on. */
  private async remove(link: Link, row: DayRow) {
    try {
      await this.call(link, (t) => this.options.google.deleteEvent(t, row.calendarId, row.eventId))
    } catch (err) {
      if (!(err instanceof GoogleError)) throw err
      // A calendar the account can no longer reach: nothing more the app can do about that day.
      const unreachable = err.problem === 'access' && row.calendarId !== link.calendarId
      if (err.problem !== 'gone' && !unreachable) throw err
    }
    await this.saveDay({ ...row, state: 'removed', problem: null }, row)
  }

  private saveDay(d: DayRow, before: DayRow | undefined) {
    return serverChange(this.options.db, undefined, (ctx) => saveDay(ctx, d, before))
  }

  /**
   * A call to Google with a fresh access key: one retry with a new one when
   * Google says it has run out, and Google's limits and outages turned into
   * a stop and a later retry.
   */
  private async call<T>(link: Link, fn: (token: string) => Promise<T>, token?: string): Promise<T> {
    for (let tries = 0; ; tries++) {
      try {
        return await fn(token ?? (await this.accessToken(link)))
      } catch (err) {
        if (!(err instanceof GoogleError)) throw err
        if (err.problem === 'expired' && tries === 0) {
          this.access = undefined
          token = undefined
          continue
        }
        if (err.problem === 'expired' || err.problem === 'revoked') throw new Halt('revoked', problems.revoked(link.accountEmail))
        if (err.problem === 'busy') throw new Halt('busy', null)
        if (err.problem === 'access') throw this.blockedBy(link, err)
        throw err
      }
    }
  }

  private blockedBy(link: Link, err: GoogleError): Halt {
    const apiOff = err.reason === 'accessNotConfigured' || err.reason === 'SERVICE_DISABLED'
    return new Halt('blocked', apiOff ? problems.apiOff : problems.noAccess(link.calendarName ?? 'the calendar', link.accountEmail))
  }

  private async accessToken(link: Link): Promise<string> {
    const key = link.refreshToken ?? ''
    if (this.access && this.access.key === key && this.access.until > Date.now() + 60_000) return this.access.token
    if (!link.refreshToken || !link.accountSub) throw new Halt('revoked', problems.revoked(link.accountEmail))
    const refreshToken = open(this.options.secret, link.refreshToken, link.accountSub)
    if (!refreshToken) throw new Halt('revoked', problems.locked)
    try {
      const fresh = await this.options.google.refresh(refreshToken)
      this.access = { token: fresh.accessToken, until: Date.now() + fresh.expiresIn * 1000, key }
      return fresh.accessToken
    } catch (err) {
      if (!(err instanceof GoogleError)) throw err
      if (err.problem === 'revoked') throw new Halt('revoked', problems.revoked(link.accountEmail))
      if (err.problem === 'access') throw new Halt('blocked', problems.badClient)
      if (err.problem === 'busy') throw new Halt('busy', null)
      throw err
    }
  }

  /** A run stopped: say why where people will see it, and try again later if that will help. Returns whether anything changed. */
  private async halted(link: Link, halt: Halt): Promise<boolean> {
    const { db, log } = this.options
    if (halt.why === 'busy') {
      const wait = RETRY_MS[Math.min(this.failures, RETRY_MS.length - 1)]!
      this.failures++
      clearTimeout(this.retryTimer)
      this.retryTimer = setTimeout(() => void this.run().catch(() => {}), wait)
      this.retryTimer.unref()
      log?.warn({ retryInSeconds: wait / 1000 }, 'Calendar sync: Google is busy or unreachable; trying again later')
      // A blip isn't worth a message; a few in a row are.
      if (this.failures < 3) return false
      await serverChange(db, undefined, (ctx) => saveLink(ctx, { problem: problems.busy(new Date(this.now().getTime() + wait)) }))
      return true
    }
    this.blocked = true
    log?.warn({ why: halt.why }, 'Calendar sync stopped until someone acts')
    if (link.state === 'stopping') {
      // Disconnecting, but the app can't reach the calendar to tidy up: disconnect anyway, and say what was left.
      await this.finishDisconnect(link, halt.why === 'revoked')
      return true
    }
    await serverChange(db, undefined, (ctx) => saveLink(ctx, halt.why === 'revoked' ? { state: 'reconnect', problem: halt.problem } : { problem: halt.problem }))
    if (halt.why === 'revoked') this.active = false
    return true
  }

  /** The app's days are off the calendar (or can't be reached): hand the key back and forget the account. */
  private async finishDisconnect(link: Link, unreachable = false) {
    const { db, google, secret } = this.options
    const today = irishToday(this.now())
    const left = (await readDays(db, today)).filter((r) => r.state !== 'removed')
    const refreshToken = link.refreshToken && link.accountSub ? open(secret, link.refreshToken, link.accountSub) : undefined
    if (refreshToken && !unreachable) await google.revoke(refreshToken)
    await serverChange(db, undefined, (ctx) =>
      saveLink(ctx, {
        state: 'off',
        accountEmail: null,
        accountSub: null,
        refreshToken: null,
        calendarId: null,
        calendarName: null,
        connectedBy: null,
        connectedAt: null,
        problem: left.length ? problems.leftBehind(left.length, link.calendarName ?? 'the calendar') : null,
      })
    )
    this.active = false
    this.access = undefined
  }
}

function ignoreGone(err: unknown) {
  if (err instanceof GoogleError && err.problem === 'gone') return
  throw err
}
