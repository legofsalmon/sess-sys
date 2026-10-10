import {
  answerFromCalendar,
  dayAnswer,
  eachDay,
  irishToday,
  newId,
  type CalendarCheck,
  type CalendarChoice,
  type CalendarInvites,
  type DayAnswer,
  type GuestResponse,
  type ImportCalendar,
} from '@sh/shared'
import { applyMutationIn } from '../commands.ts'
import { getCall, getOffer } from '../crew/store.ts'
import type { Db, Queryable } from '../db.ts'
import { serverChange, type Ctx } from '../kernel.ts'
import { open } from './crypto.ts'
import { eventId, wantedEvents, type Wanted } from './events.ts'
import { GoogleError, type Attendee, type EventBody, type Google, type GoogleEvent, type SendUpdates } from './google.ts'
import { guestPlaces, readDays, readDaysById, readLink, saveDay, saveLink, type DayRow, type GuestRow, type Link } from './store.ts'

/**
 * The calendar sync (ADR 0008): makes the connected calendar hold exactly
 * the confirmed jobs' days from today on, as the jobs are now; and, with
 * invites on (ADR 0009), their crew as guests, whose answers in Google
 * count as their answers to their offers.
 *
 * Each run works out what should be there, compares it with what the app
 * has written (the `calendar_days` and `calendar_guests` rows), and writes
 * only the difference, soonest days first. It runs a moment after any
 * change in the app, once each night with a look at the calendar itself
 * for events changed or deleted in Google, and again later when Google was
 * busy. With invites on, the server also asks Google every two minutes
 * which events have changed, and takes in any new answers. Only a change
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
  /** How often to ask Google for crew's answers while invites are on; 0 never asks by itself. */
  pollMs?: number
  /** How long to wait before each try again after a run fails on something unexpected; for tests. */
  retryMs?: readonly number[]
}

/** After Google was busy: a minute, five, a quarter of an hour, then hourly. */
const RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]
/** After a run failed on something unexpected (the database, say): a minute, five, then twenty-five; after that, the next change. */
const FAULT_RETRY_MS = [60_000, 5 * 60_000, 25 * 60_000]

const problems = {
  revoked: (account: string | null) =>
    `Google no longer accepts the app's access to ${account ?? 'the account'}'s calendars, so the calendar isn't being updated. Connect again to carry on.`,
  locked: "The app's Google key has changed since the calendar was connected, so its saved access can't be used. Connect again to carry on.",
  apiOff:
    "The Google Calendar API is switched off in the app's Google Cloud project, so nothing can be written. Switch it on (see the setup steps), then press Check the calendar.",
  noAccess: (calendar: string, account: string | null) =>
    `${account ?? 'The connected account'} can't change ${calendar} any more: it may have been deleted, or its sharing changed. Choose another calendar, or give that account permission to change it again.`,
  busy: (at: Date) =>
    `Google Calendar isn't answering, so some days are still on their way. Trying again at ${at.toLocaleTimeString('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit' })}.`,
  badClient:
    "Google doesn't accept the app's own Google key (its client id and secret), so nothing can be written. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Railway, then press Check the calendar.",
  refused: (reason: string) => `Google turned this day down${reason ? ` (${reason})` : ''}. It is tried again when the job changes, and each night.`,
  leftBehind: (n: number, calendar: string) =>
    `${n === 1 ? '1 day was' : `${n} days were`} left on ${calendar}, because Google no longer accepts the app's access. Delete ${n === 1 ? 'it' : 'them'} in Google Calendar if ${n === 1 ? "it isn't" : "they aren't"} wanted.`,
  /** An answer in Google the offer couldn't take, with the reason the link would have given. */
  notTaken: (answer: 'accept' | 'decline', reason: string) =>
    `Said ${answer === 'accept' ? 'yes' : 'no'} on Google Calendar, but the app couldn't take it: ${reason.replace(/^Sorry, (\w)/, (_, c: string) => c.toUpperCase())}`,
}

/** The Calendar API is switched off in the app's Google Cloud project. */
const apiOff = (err: GoogleError) => err.reason === 'accessNotConfigured' || err.reason === 'SERVICE_DISABLED'

/** Stops a run, or a request from the Account tab: the calendar or the account needs a person, or Google needs time. */
export class Halt extends Error {
  constructor(
    readonly why: 'revoked' | 'blocked' | 'busy',
    readonly problem: string | null
  ) {
    super(why)
  }
}

type Op =
  | { kind: 'write'; wanted: Wanted; row: DayRow | undefined; event: GoogleEvent | undefined }
  | { kind: 'remove'; row: DayRow }
  | { kind: 'orphan'; event: GoogleEvent }

/** The app's guests on one event, as last written or taken in: what answers in Google are compared with. */
interface Known {
  dayId: string
  day: string
  guests: GuestRow[]
}

/** A guest whose answer in Google differs from the one the app last took in. */
interface Answer {
  dayId: string
  personId: string
  email: string
  response: GuestResponse
  /** What they wrote with it in Google, if anything. */
  comment: string
}

export class CalendarSync {
  private active = false
  /** A person has to act first (reconnect, or choose another calendar): no runs on changes until they do. */
  private blocked = false
  private running: Promise<CalendarCheck> | undefined
  private again: { check: boolean } | undefined
  private settleTimer: NodeJS.Timeout | undefined
  private retryTimer: NodeJS.Timeout | undefined
  private nightlyTimer: NodeJS.Timeout | undefined
  private pollTimer: NodeJS.Timeout | undefined
  private failures = 0
  /** Runs in a row that failed on something unexpected, for the backoff. */
  private faults = 0
  private access: { token: string; until: number; key: string } | undefined
  private stopped = false
  /** The connection as last read, so looking for answers needn't wake the database. */
  private link: Link | undefined
  /** The app's guests on each event, by event id; unknown until the first look for answers. */
  private known: Map<string, Known> | undefined
  /** When the last look for answers began, less a margin for clocks: the next asks only about events changed since. */
  private since: string | undefined
  /** Runs and looks for answers take turns, so each sees what the other did. */
  private turn: Promise<unknown> = Promise.resolve()
  private readonly now: () => Date

  constructor(private readonly options: CalendarSyncOptions) {
    this.now = options.now ?? (() => new Date())
  }

  /** At start-up: find out whether a calendar is connected, and catch up on anything missed while the server was down. */
  async start() {
    const link = await readLink(this.options.db)
    this.link = link
    this.active = link?.state === 'on' || link?.state === 'stopping'
    this.scheduleNightly()
    this.schedulePoll()
    if (this.active) this.later(5_000)
  }

  stop() {
    this.stopped = true
    for (const t of [this.settleTimer, this.retryTimer, this.nightlyTimer, this.pollTimer]) clearTimeout(t)
  }

  /** After something changed in the app: run once things settle, if a calendar is connected. */
  kick() {
    if (!this.active || this.blocked || this.stopped) return
    clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => void this.run().catch(() => {}), this.options.settleMs ?? 2_000)
    this.settleTimer.unref()
  }

  /** After the connection changed (connected, calendar chosen, invites switched, disconnecting): start afresh. */
  connectionChanged(link: Link) {
    this.link = link
    this.active = link.state === 'on' || link.state === 'stopping'
    this.blocked = false
    this.failures = 0
    this.faults = 0
    this.access = undefined
    this.forget()
    clearTimeout(this.retryTimer)
    this.schedulePoll(true)
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
        result = await this.inTurn(() => this.pass(check))
        while (this.again) {
          const next = this.again
          this.again = undefined
          result = await this.inTurn(() => this.pass(next.check))
        }
        return result
      } finally {
        this.running = undefined
      }
    })()
    return this.running
  }

  /**
   * Ask Google which of the app's events have changed since the last look,
   * and take in any new answers from crew (ADR 0009). The database is only
   * touched when an answer has changed, and at the first look, to learn who
   * was invited. Returns how many answers were taken in.
   */
  poll(): Promise<number> {
    return this.inTurn(async () => {
      const link = this.link
      if (!link || !this.polling()) return 0
      const started = this.now()
      const today = irishToday(started)
      const first = !this.known || !this.since
      try {
        const listed = first
          ? await this.listOurs(link, { timeMin: dayBefore(today) })
          : await this.call(link, (t) => this.options.google.listEvents(t, link.calendarId!, { mark: `sh=${link.appKey}`, updatedMin: this.since }))
        if (first) this.known = knownFrom(await readDays(this.options.db, today), link.calendarId)
        this.since = margin(started)
        const taken = await this.takeAnswers(listed, today)
        if (taken) {
          this.options.onChange?.()
          this.kick()
        }
        return taken
      } catch (err) {
        // Asked about too long ago: look at everything next time.
        if (err instanceof GoogleError && err.problem === 'gone' && !first) this.forget()
        // Something a person has to fix: say so, as a run would. Google being busy just waits for the next look.
        else if (err instanceof Halt) {
          if (err.why !== 'busy' && (await this.halted(link, err))) this.options.onChange?.()
        } else {
          this.options.report?.(err)
          this.options.log?.error({ err }, 'Looking for crew answers on Google Calendar failed')
        }
        return 0
      }
    })
  }

  /** What turning invites on would send straight away (ADR 0009): an invite for each person to each day's event they aren't on yet. */
  async invites(): Promise<CalendarInvites> {
    const { db } = this.options
    const link = await readLink(db)
    const today = irishToday(this.now())
    const writing = link?.state === 'on' && link.calendarId !== null
    const wanted = writing ? await wantedEvents(db, { today, appKey: link.appKey, appUrl: null }) : new Map<string, Wanted>()
    const rows = new Map((await readDays(db, today)).map((r) => [r.id, r]))
    let invites = 0
    const people = new Set<string>()
    const noEmail = new Set<string>()
    for (const w of wanted.values()) {
      const row = rows.get(w.key)
      const on = row && row.state !== 'removed' && row.calendarId === link?.calendarId ? row.guests : []
      for (const g of w.guests) {
        if (on.some((p) => p.personId === g.personId && sameEmail(p.email, g.email))) continue
        invites++
        people.add(g.personId)
      }
      for (const name of w.noEmail) noEmail.add(name)
    }
    return { on: link?.invites ?? false, invites, people: people.size, noEmail: [...noEmail].sort() }
  }

  /** The calendars the connected account can change, for picking one. */
  calendars(): Promise<CalendarChoice[]> {
    return this.withLink((link) => this.call(link, (t) => this.options.google.calendars(t)))
  }

  /** That calendar, if the connected account can change it. */
  writable(calendarId: string): Promise<CalendarChoice | undefined> {
    return this.withLink((link) => this.call(link, (t) => this.options.google.calendar(t, calendarId)))
  }

  /** Today in Ireland, by the sync's clock. */
  today(): string {
    return irishToday(this.now())
  }

  /** The calendars the connected account can see the events of, to bring jobs in from (ADR 0011). */
  readableCalendars(): Promise<ImportCalendar[]> {
    return this.withLink((link) => this.call(link, (t) => this.options.google.readableCalendars(t)))
  }

  /**
   * A calendar's events between two times, to bring jobs in from (ADR
   * 0011), with the account reading them; undefined when that account
   * can't see the calendar.
   */
  readCalendar(calendarId: string, window: { timeMin: string; timeMax: string }) {
    return this.withLink((link) =>
      this.call(link, async (t) => {
        const calendar = await this.options.google.readableCalendar(t, calendarId)
        if (!calendar) return undefined
        try {
          const events = await this.options.google.readEvents(t, calendarId, window)
          return { calendar, events, account: link.accountEmail ?? '' }
        } catch (err) {
          // Its sharing changed in the moment between the two.
          if (err instanceof GoogleError && (err.problem === 'gone' || (err.problem === 'access' && !apiOff(err)))) return undefined
          throw err
        }
      })
    )
  }

  private async withLink<T>(fn: (link: Link) => Promise<T>): Promise<T> {
    const link = await readLink(this.options.db)
    if (!link || link.state === 'off' || link.state === 'stopping') throw new Halt('blocked', 'Connect a Google account first.')
    try {
      return await fn(link)
    } catch (err) {
      // Found out here rather than in a run: say so in the same way.
      if (err instanceof Halt && err.why === 'revoked' && link.state !== 'reconnect') {
        this.link = await serverChange(this.options.db, undefined, (ctx) => saveLink(ctx, { state: 'reconnect', problem: err.problem }))
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

  /** One thing at a time: a run, or a look for answers. */
  private inTurn<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.turn.then(fn, fn)
    this.turn = next.catch(() => {})
    return next
  }

  /** Whether answers are being looked for: invites on, and a calendar being written to. */
  private polling(): boolean {
    const link = this.link
    return this.active && !this.blocked && link?.state === 'on' && link.invites && link.calendarId !== null
  }

  /** Keep looking for answers every couple of minutes while invites are on, and stop when they aren't. */
  private schedulePoll(restart = false) {
    const every = this.options.pollMs ?? 120_000
    if (this.stopped || !every || !this.polling()) {
      clearTimeout(this.pollTimer)
      this.pollTimer = undefined
      return
    }
    if (this.pollTimer && !restart) return
    clearTimeout(this.pollTimer)
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined
      void this.poll().finally(() => this.schedulePoll())
    }, every)
    this.pollTimer.unref()
  }

  /** Start the next look for answers from scratch. */
  private forget() {
    this.known = undefined
    this.since = undefined
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
      this.faults = 0
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
    const started = this.now()
    // The database failing even this early is tried again like any other fault.
    const link = await readLink(db).catch((err: unknown) => this.fault(err, check))
    this.link = link
    this.active = link?.state === 'on' || link?.state === 'stopping'
    if (!link || !this.active) {
      this.schedulePoll()
      return result
    }
    let changed = false
    try {
      const token = await this.accessToken(link)
      const today = irishToday(started)
      let rows = await readDays(db, today)
      const writing = link.state === 'on' && link.calendarId !== null

      // On a check, the calendar itself: the app's events as they are in Google now.
      const listed = check && writing ? await this.listOurs(link, { timeMin: dayBefore(today) }, token) : undefined
      // Any answers missed since the last look go in first, since they can change what the events should say.
      if (listed && link.invites) {
        this.known = knownFrom(rows, link.calendarId)
        this.since = margin(started)
        if (await this.takeAnswers(listed, today)) {
          changed = true
          rows = await readDays(db, today)
        }
      }
      const byId = new Map(rows.map((r) => [r.id, r]))
      const wanted = writing ? await wantedEvents(db, { today, appKey: link.appKey, appUrl: this.options.appUrl ?? link.appUrl }) : new Map<string, Wanted>()

      // Events changed or deleted in Google since the app wrote them, and any of the app's events it has lost track of.
      const stale = new Set<string>()
      // Events changed in Google only in ways the app leaves alone, such as a guest answering: their new version, to note.
      const settled = new Map<string, string>()
      const found = new Map<string, GoogleEvent>()
      const ops: Op[] = []
      if (listed) {
        const ours = new Map(rows.filter((r) => r.state !== 'removed' && r.calendarId === link.calendarId).map((r) => [r.eventId, r]))
        const seen = new Set<string>()
        for (const ev of listed) {
          const day = ev.extendedProperties?.private?.shDay
          if (!day || day < today) continue
          const row = ours.get(ev.id)
          if (row) {
            seen.add(ev.id)
            found.set(row.id, ev)
            if (ev.status === 'cancelled') stale.add(row.id)
            else if (ev.etag !== row.etag) {
              const w = wanted.get(row.id)
              const guestsOn = !link.invites || row.guests.every((g) => ev.attendees?.some((a) => sameEmail(a.email, g.email)))
              if (w && row.state === 'on' && sameContent(ev, w.body) && guestsOn) settled.set(row.id, ev.etag)
              else stale.add(row.id)
            }
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
          (check && row.state === 'failed') ||
          (link.invites && row.state === 'on' && !sameGuests(guestsFor(w, row.guests, true), row.guests))
        )
          ops.push({ kind: 'write', wanted: w, row, event: found.get(w.key) })
      }
      for (const row of rows) if (row.state !== 'removed' && !wanted.has(row.id)) ops.push({ kind: 'remove', row })
      const dayOf = (op: Op) => (op.kind === 'write' ? op.wanted.day : op.kind === 'remove' ? op.row.day : (op.event.extendedProperties?.private?.shDay ?? ''))
      ops.sort((a, b) => dayOf(a).localeCompare(dayOf(b)))

      for (const [i, op] of ops.entries()) {
        if (i > 0 && this.options.gapMs !== 0) await new Promise((r) => setTimeout(r, this.options.gapMs ?? 100))
        if (op.kind === 'write') {
          const done = await this.write(link, op.wanted, op.row, op.event)
          if (done === 'failed') result.failed++
          else result.written++
        } else if (op.kind === 'remove') {
          await this.remove(link, op.row)
          result.removed++
        } else {
          await this.call(link, (t) => this.options.google.deleteEvent(t, link.calendarId!, op.event.id, tell(link))).catch(ignoreGone)
          result.removed++
        }
        changed = true
      }
      for (const [id, etag] of settled) {
        if (ops.some((op) => op.kind === 'write' && op.wanted.key === id)) continue
        const row = byId.get(id)!
        await this.saveDay({ ...row, etag }, row)
      }

      this.failures = 0
      this.faults = 0
      this.blocked = false
      if (link.state === 'stopping') {
        await this.finishDisconnect(link)
        changed = true
      } else if (link.problem) {
        this.link = await serverChange(db, undefined, (ctx) => saveLink(ctx, { problem: null }))
        changed = true
      }
    } catch (err) {
      if (!(err instanceof Halt)) this.fault(err, check)
      result.problem = err.problem ?? undefined
      changed = (await this.halted(link, err)) || changed
    } finally {
      if (changed) this.options.onChange?.()
      this.schedulePoll()
    }
    if (result.written || result.removed || result.failed) this.options.log?.info({ ...result }, 'Calendar sync')
    return result
  }

  /** Answers in Google that differ from the ones the app last took in, taken in offer by offer. Returns how many were taken. */
  private async takeAnswers(listed: GoogleEvent[], today: string): Promise<number> {
    const known = this.known ?? new Map<string, Known>()
    const byOffer = new Map<string, Answer[]>()
    for (const ev of listed) {
      const k = known.get(ev.id)
      if (!k || k.day < today || ev.status === 'cancelled') continue
      for (const g of k.guests) {
        const a = ev.attendees?.find((x) => sameEmail(x.email, g.email))
        const response = a?.responseStatus ?? 'needsAction'
        if (!a || response === g.response) continue
        byOffer.set(g.offerId, [...(byOffer.get(g.offerId) ?? []), { dayId: k.dayId, personId: g.personId, email: g.email, response, comment: a.comment ?? '' }])
      }
    }
    let taken = 0
    for (const [offerId, answers] of byOffer) taken += await this.takeAnswer(offerId, answers, today)
    return taken
  }

  /**
   * One person's new answers about one offer: noted against the days'
   * events and put to the offer as their answer, all or nothing. Returns
   * how many were new here; another server may have taken some in already.
   */
  private async takeAnswer(offerId: string, answers: Answer[], today: string): Promise<number> {
    const { days, taken } = await this.options.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(7331)')
      const link = await readLink(tx)
      // Switched off since, perhaps on another server during a deploy: answers are no longer read.
      if (link?.state !== 'on' || !link.invites) return { days: [] as DayRow[], taken: 0 }
      const before = await readDaysById(tx, [...new Set(answers.map((a) => a.dayId))])
      const after = before.map((d) => ({ ...d, guests: d.guests.map((g) => ({ ...g })) }))
      const fresh: Answer[] = []
      const moved: GuestRow[] = []
      for (const a of answers) {
        const g = after.find((d) => d.id === a.dayId)?.guests.find((x) => x.personId === a.personId && x.offerId === offerId && sameEmail(x.email, a.email))
        if (!g || g.response === a.response) continue
        g.response = a.response
        moved.push(g)
        fresh.push(a)
      }
      if (!fresh.length) return { days: after, taken: 0 }
      const problem = await this.answerOffer(tx, offerId, fresh, today)
      for (const g of moved) g.problem = problem
      const ctx: Ctx = { tx, mutationId: null, seq: 0, via: 'app' }
      for (const [i, d] of after.entries()) if (JSON.stringify(d.guests) !== JSON.stringify(before[i]!.guests)) await saveDay(ctx, d, before[i])
      return { days: after, taken: fresh.length }
    })
    for (const d of days) this.remember(d)
    return taken
  }

  /**
   * Put a person's new answers in Google to their offer, as the same answer
   * on their link would be (ADR 0009), recorded in the history as theirs.
   * Returns why the offer couldn't take it, in words for the job page.
   */
  private async answerOffer(tx: Queryable, offerId: string, fresh: Answer[], today: string): Promise<string | null> {
    const offer = await getOffer(tx, offerId)
    const call = offer ? await getCall(tx, offer.callId) : undefined
    if (!offer || !call) return null
    // Every day's event they are a guest on, with their answers before and after these.
    const places = await guestPlaces(tx, offerId, today)
    const now = new Map(fresh.map((a) => [a.dayId, a.response]))
    const was = byDay(places.map((p) => [p.day, p.response]))
    const is = byDay(places.map((p) => [p.day, now.get(p.dayId) ?? p.response]))
    const changed = Object.keys(is).filter((d) => is[d] !== was[d])
    const answer = answerFromCalendar(offer, eachDay(call.start, call.end), is, changed)
    if (!answer) return null
    // What they wrote in Google goes with the answer; otherwise any note they left on their link stays.
    const note = (fresh.map((a) => a.comment.trim()).find(Boolean) ?? offer.note).slice(0, 1000)
    const result = await applyMutationIn(
      tx,
      `calendar:${offer.personId}`,
      {
        id: newId(),
        name: 'offer.respond',
        args: answer.answer === 'accept' ? { id: offer.id, answer: 'accept', days: answer.days, note } : { id: offer.id, answer: 'decline', note },
        createdAt: new Date().toISOString(),
      },
      { via: 'calendar' }
    )
    return result.status === 'rejected' ? problems.notTaken(answer.answer, result.reason.message) : null
  }

  /** Put one day on the calendar as it should be now, with its guests when invites are on. */
  private async write(link: Link, w: Wanted, row: DayRow | undefined, listed: GoogleEvent | undefined): Promise<'written' | 'failed'> {
    const calendarId = link.calendarId!
    const google = this.options.google
    // Moving calendars: the old event comes off first, so no day is ever on both.
    if (row && row.state !== 'removed' && row.calendarId !== calendarId) {
      await this.remove(link, row)
      row = { ...row, state: 'removed' }
    }
    const before = row
    const here = row !== undefined && row.calendarId === calendarId
    let generation = here ? row!.generation : 0
    // Update the event the app knows is here; otherwise put it on, reusing the same id.
    let known = here && row!.state === 'on'
    const day = { id: w.key, phaseId: w.phaseId, projectId: w.projectId, day: w.day, title: w.title, calendarId, contentHash: w.hash }
    for (let tries = 0; tries < 5; tries++) {
      const id = eventId(link.appKey, calendarId, w.phaseId, w.day, generation)
      // Who the app last put on this very event, if it is the one it knows.
      const previous = here && generation === row!.generation ? row!.guests : []
      const guests = link.invites ? guestsFor(w, previous, known) : undefined
      try {
        let written: { ev: GoogleEvent; guests: GuestRow[] }
        if (known) written = await this.replace(link, id, w.body, previous, guests, listed)
        else {
          try {
            const attendees = (guests ?? []).map((g) => ({ email: g.email }))
            const ev = await this.call(link, (t) =>
              google.insertEvent(t, calendarId, id, attendees.length ? { ...w.body, attendees } : w.body, attendees.length ? 'all' : 'none')
            )
            written = { ev, guests: guests ?? [] }
          } catch (err) {
            // No calendar to put it in.
            if (err instanceof GoogleError && err.problem === 'gone') throw this.blockedBy(link, err)
            // Already there, from an earlier try or deleted since: make it what it should be.
            if (!(err instanceof GoogleError) || err.problem !== 'exists') throw err
            written = await this.replace(link, id, w.body, previous, guests, undefined)
          }
        }
        const { ev } = written
        await this.saveDay({ ...day, eventId: id, generation, state: 'on', etag: ev.etag, htmlLink: ev.htmlLink ?? null, problem: null, guests: written.guests }, before)
        return 'written'
      } catch (err) {
        if (err instanceof GoogleError && err.problem === 'gone') {
          // That event has gone for good: make a new one.
          generation++
          known = false
          listed = undefined
          continue
        }
        if (err instanceof GoogleError && err.problem === 'refused') {
          this.options.report?.(err)
          await this.saveDay(
            { ...day, eventId: id, generation, state: 'failed', etag: null, htmlLink: null, problem: problems.refused(err.reason), guests: row?.guests ?? [] },
            before
          )
          return 'failed'
        }
        throw err
      }
    }
    throw new Error('Google kept losing the event while it was being written')
  }

  /**
   * Read the event, then replace it with what the app wants (Google's
   * advice over patching), keeping the guests added by hand in Google and
   * everyone's answers. Only replaces it if it is still as read, so an
   * answer given in between isn't lost; otherwise reads it again. With
   * invites off (`guests` unset) the guest list stays as it is.
   */
  private async replace(link: Link, id: string, body: EventBody, previous: GuestRow[], guests: GuestRow[] | undefined, listed: GoogleEvent | undefined) {
    const calendarId = link.calendarId!
    const google = this.options.google
    let current = listed?.id === id ? listed : undefined
    for (let tries = 0; tries < 3; tries++) {
      const ev = current ?? (await this.call(link, (t) => google.getEvent(t, calendarId, id)))
      const next = withGuests(ev, body, previous, guests)
      try {
        // A new crew list goes on quietly first, so only the people added or taken off hear about it.
        const quiet = next.quietly ? await this.call(link, (t) => google.updateEvent(t, calendarId, id, next.quietly!, 'none', ev.etag)) : ev
        const written = await this.call(link, (t) => google.updateEvent(t, calendarId, id, next.body, next.send, quiet.etag))
        return { ev: written, guests: guests ?? previous }
      } catch (err) {
        if (!(err instanceof GoogleError) || err.problem !== 'changed') throw err
        current = undefined
      }
    }
    // It keeps changing under the app: leave it a while.
    throw new Halt('busy', null)
  }

  /** The app's own events on the calendar being written to, from `timeMin` on; a calendar that has gone needs a person. */
  private async listOurs(link: Link, { timeMin }: { timeMin: string }, token?: string): Promise<GoogleEvent[]> {
    try {
      return await this.call(link, (t) => this.options.google.listEvents(t, link.calendarId!, { mark: `sh=${link.appKey}`, timeMin }), token)
    } catch (err) {
      if (err instanceof GoogleError && err.problem === 'gone') throw this.blockedBy(link, err)
      throw err
    }
  }

  /**
   * Take one day off the calendar it is on. With invites on its guests are
   * told it's cancelled. The day keeps its guests, so that if it comes back
   * the app still knows who it put on it.
   */
  private async remove(link: Link, row: DayRow) {
    try {
      await this.call(link, (t) => this.options.google.deleteEvent(t, row.calendarId, row.eventId, tell(link)))
    } catch (err) {
      if (!(err instanceof GoogleError)) throw err
      // A calendar the account can no longer reach: nothing more the app can do about that day.
      const unreachable = err.problem === 'access' && row.calendarId !== link.calendarId
      if (err.problem !== 'gone' && !unreachable) throw err
    }
    await this.saveDay({ ...row, state: 'removed', problem: null }, row)
  }

  private async saveDay(d: DayRow, before: DayRow | undefined) {
    await serverChange(this.options.db, undefined, (ctx) => saveDay(ctx, d, before))
    this.remember(d)
  }

  /** Keep the guests answers are compared with in step with what was written or taken in. */
  private remember(d: DayRow) {
    if (!this.known) return
    for (const [id, k] of this.known) if (k.dayId === d.id) this.known.delete(id)
    if (d.state === 'on' && d.calendarId === this.link?.calendarId && d.guests.length) this.known.set(d.eventId, { dayId: d.id, day: d.day, guests: d.guests })
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
    return new Halt('blocked', apiOff(err) ? problems.apiOff : problems.noAccess(link.calendarName ?? 'the calendar', link.accountEmail))
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

  /**
   * A run failed on something unexpected (the database, say): it is reported,
   * and tried again by itself a few times, further apart each time, rather
   * than waiting for the next change in the app, which on a quiet day could
   * be hours off. A check that failed is tried again as a check, so the
   * nightly one isn't lost. The fault still goes up to whoever asked.
   */
  private fault(err: unknown, check: boolean): never {
    this.options.report?.(err)
    const wait = (this.options.retryMs ?? FAULT_RETRY_MS)[this.faults]
    this.faults++
    if (wait === undefined || this.stopped) {
      this.options.log?.error({ err, failures: this.faults }, 'Calendar sync failed again; it waits for the next change now')
      throw err
    }
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => void this.run(check).catch(() => {}), wait)
    this.retryTimer.unref()
    this.options.log?.error({ err, retryInSeconds: wait / 1000 }, 'Calendar sync failed; trying again later')
    throw err
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
      this.link = await serverChange(db, undefined, (ctx) => saveLink(ctx, { problem: problems.busy(new Date(this.now().getTime() + wait)) }))
      return true
    }
    this.blocked = true
    log?.warn({ why: halt.why }, 'Calendar sync stopped until someone acts')
    if (link.state === 'stopping') {
      // Disconnecting, but the app can't reach the calendar to tidy up: disconnect anyway, and say what was left.
      await this.finishDisconnect(link, halt.why === 'revoked')
      return true
    }
    this.link = await serverChange(db, undefined, (ctx) =>
      saveLink(ctx, halt.why === 'revoked' ? { state: 'reconnect', problem: halt.problem } : { problem: halt.problem })
    )
    if (halt.why === 'revoked') this.active = false
    return true
  }

  /**
   * The app's days are off the calendar (or can't be reached): hand the key
   * back and forget the account. Invites go off too, so connecting again
   * starts with them off (ADR 0009).
   */
  private async finishDisconnect(link: Link, unreachable = false) {
    const { db, google, secret } = this.options
    const today = irishToday(this.now())
    const left = (await readDays(db, today)).filter((r) => r.state !== 'removed')
    const refreshToken = link.refreshToken && link.accountSub ? open(secret, link.refreshToken, link.accountSub) : undefined
    if (refreshToken && !unreachable) await google.revoke(refreshToken)
    this.link = await serverChange(db, undefined, (ctx) =>
      saveLink(ctx, {
        state: 'off',
        accountEmail: null,
        accountSub: null,
        refreshToken: null,
        calendarId: null,
        calendarName: null,
        connectedBy: null,
        connectedAt: null,
        invites: false,
        problem: left.length ? problems.leftBehind(left.length, link.calendarName ?? 'the calendar') : null,
      })
    )
    this.active = false
    this.access = undefined
    this.forget()
  }
}

function ignoreGone(err: unknown) {
  if (err instanceof GoogleError && err.problem === 'gone') return
  throw err
}

/** Guests are told about deletions only with invites on (ADR 0009). */
const tell = (link: Link): SendUpdates => (link.invites ? 'all' : 'none')

/** Five minutes before a look for answers began, so a clock a little out still misses nothing next time. */
const margin = (started: Date) => new Date(started.getTime() - 5 * 60_000).toISOString()

/** Midnight UTC the day before, for asking Google about events from yesterday on. */
function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString()
}

/** Email addresses as Google compares them. */
const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The events whose guests' answers matter: the app's days on the calendar being written to that have guests. */
function knownFrom(rows: DayRow[], calendarId: string | null): Map<string, Known> {
  const out = new Map<string, Known>()
  for (const r of rows) if (r.state === 'on' && r.calendarId === calendarId && r.guests.length) out.set(r.eventId, { dayId: r.id, day: r.day, guests: r.guests })
  return out
}

/** Each day's answer from the answers on its events. */
function byDay(entries: [string, GuestResponse][]): Record<string, DayAnswer> {
  const all: Record<string, GuestResponse[]> = {}
  for (const [day, response] of entries) all[day] = [...(all[day] ?? []), response]
  return Object.fromEntries(Object.entries(all).map(([day, responses]) => [day, dayAnswer(responses)]))
}

/**
 * Who should be on a day's event (ADR 0009): everyone offered the day or
 * booked on it, with their answers so far, and, on the same event, anyone
 * who said No to it in Google, who stays on as a No rather than being sent
 * a cancellation for something they turned down.
 */
export function guestsFor(w: Wanted, previous: GuestRow[], sameEvent: boolean): GuestRow[] {
  const out: GuestRow[] = w.guests.map((g) => {
    const had = previous.find((p) => p.personId === g.personId && sameEmail(p.email, g.email))
    return { ...g, response: had?.response ?? 'needsAction', problem: had?.offerId === g.offerId ? had.problem : null }
  })
  if (sameEvent) for (const p of previous) if (p.response === 'declined' && !out.some((g) => g.personId === p.personId)) out.push(p)
  return out.sort((a, b) => a.personId.localeCompare(b.personId))
}

/** The same people on the event, for the same offers. */
function sameGuests(a: GuestRow[], b: GuestRow[]): boolean {
  return a.length === b.length && a.every((g, i) => g.personId === b[i]!.personId && g.offerId === b[i]!.offerId && sameEmail(g.email, b[i]!.email))
}

/** The event still says what the app wrote: its title, day, place, description and marks. */
function sameContent(ev: GoogleEvent, body: EventBody): boolean {
  const theirs = ev.extendedProperties?.private ?? {}
  return (
    ev.status === 'confirmed' &&
    (ev.summary ?? '') === body.summary &&
    (ev.location ?? '') === body.location &&
    (ev.description ?? '') === body.description &&
    ev.start?.date === body.start.date &&
    ev.end?.date === body.end.date &&
    Object.entries(body.extendedProperties.private).every(([k, v]) => theirs[k] === v)
  )
}

/**
 * The event as the app wants it, with its guest list (ADR 0009): everyone
 * on it the app didn't put there stays, and so does everyone's answer.
 * With invites off (`guests` unset) the guest list stays as it is and
 * nobody is told anything. Otherwise guests are told when someone is added
 * or taken off, or the title, day or place changes, or it comes back after
 * being deleted; not when only the description does. When the description
 * changes as people are added or taken off (someone taking the last place
 * changes the crew list too), `quietly` is the event with the new
 * description and the guests as they were, to write first without telling
 * anyone, so that only the people added or taken off hear from Google.
 */
export function withGuests(
  ev: GoogleEvent,
  body: EventBody,
  previous: GuestRow[],
  guests: GuestRow[] | undefined
): { body: EventBody; send: SendUpdates; quietly?: EventBody } {
  const now = ev.attendees ?? []
  if (!guests) return { body: now.length ? { ...body, attendees: now } : body, send: 'none' }
  const ours = [...previous, ...guests].map((g) => g.email)
  const theirs = now.filter((a) => !ours.some((e) => sameEmail(e, a.email)))
  const invited: Attendee[] = guests.map((g) => now.find((a) => sameEmail(a.email, g.email)) ?? { email: g.email })
  const attendees = [...theirs, ...invited]
  const restored = ev.status === 'cancelled'
  const added = invited.some((a) => !now.includes(a))
  const dropped = !restored && now.some((a) => ours.some((e) => sameEmail(e, a.email)) && !guests.some((g) => sameEmail(g.email, a.email)))
  const noticed =
    restored ||
    (ev.summary ?? '') !== body.summary ||
    (ev.location ?? '') !== body.location ||
    ev.start?.date !== body.start.date ||
    ev.end?.date !== body.end.date
  const told = added || dropped || (noticed && attendees.some((a) => !a.organizer))
  const next = { body: attendees.length ? { ...body, attendees } : body, send: told ? ('all' as const) : ('none' as const) }
  if (!told || noticed || (ev.description ?? '') === body.description) return next
  return { ...next, quietly: now.length ? { ...body, attendees: now } : body }
}
