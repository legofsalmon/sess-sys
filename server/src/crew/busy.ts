import { addDays, BUSY_AHEAD_DAYS, MAX_BUSY_TIMES, type BusyTime } from '@sh/shared'
import ICAL from 'ical.js'
import { Worker } from 'node:worker_threads'
import { FEED_PRODID, FEED_UID_DOMAIN } from './ical.ts'

/**
 * When someone is busy, from their own calendar's iCal text (ADR 0044),
 * and nothing else: no title, place, guest or description is read out of
 * it, let alone kept. ical.js (Mozilla's, used by Thunderbird) does the
 * reading, since repeating events, their exceptions and time zones are
 * most of what a real calendar holds and easy to get wrong by hand.
 *
 * - Cancelled events, and timed ones marked "free", don't count. All-day
 *   events do, even marked free: Google marks every all-day event free
 *   unless told otherwise, and a freelancer puts a whole gig in as one.
 * - Our own bookings, from the person's Session Hire calendar feed (ADR
 *   0012), don't count either, if they've subscribed to it in the
 *   calendar they share or copied its events in: they're known by their
 *   UID, and a whole calendar by its PRODID.
 * - Repeating events are worked out from yesterday to BUSY_AHEAD_DAYS on.
 *   A daily or weekly one is started near yesterday rather than where it
 *   began, so one from 2010 costs what one from last week does.
 * - Published availability (a VFREEBUSY, as some calendars give) counts
 *   as busy where it says so.
 * - The work a file may take is capped, in repeats worked through and in
 *   time: past either, it's TooMuch, said as a read that failed rather
 *   than busy times quietly missing. The server reads in a worker thread
 *   besides (busy-worker.ts), so even a file that gets past these can't
 *   hold anyone else up.
 */

export type BusyRead = { ours: true } | { ours: false; busy: BusyTime[]; until: string }

export interface ReadLimits {
  /** Repeats (and events) worked through in the whole file, at most. */
  maxSteps?: number
  /** How long the reading may take, in milliseconds. */
  maxMs?: number
}

/** Far more than a real calendar takes once repeats start near today: three hundred daily events over the four months are about forty thousand. */
const MAX_STEPS = 200_000
const MAX_MS = 5_000

export class NotACalendar extends Error {}
/** The file needs more work than a calendar should: repeats past the cap, or past the time. */
export class TooMuch extends Error {}

/** The longest a worker may take, from starting to answering, before it's stopped. */
const WORKER_MS = 15_000

/**
 * readBusy in a worker thread of its own, as the server reads: however
 * long a file takes, the server goes on answering everyone else, and one
 * that takes too long is stopped and said as TooMuch. Throws NotACalendar
 * and TooMuch as readBusy does.
 */
export async function readBusyApart(text: string, today: string, options: ReadLimits & { timeoutMs?: number } = {}): Promise<BusyRead> {
  // Two at once at most, so a run of shares can't fill the server's memory with workers.
  while (running >= AT_ONCE) await new Promise<void>((go) => waiting.push(go))
  running++
  try {
    return await inWorker(text, today, options)
  } finally {
    running--
    waiting.shift()?.()
  }
}

const AT_ONCE = 2
let running = 0
const waiting: (() => void)[] = []

function inWorker(text: string, today: string, options: ReadLimits & { timeoutMs?: number }): Promise<BusyRead> {
  const { timeoutMs = WORKER_MS, ...limits } = options
  return new Promise<BusyRead>((resolve, reject) => {
    const worker = new Worker(new URL('./busy-worker.mjs', import.meta.url), {
      workerData: { text, today, limits },
      // An 8 MB file reads in less than 64 MB; past this it's too much.
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    })
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
      void worker.terminate()
    }
    const timer = setTimeout(() => settle(() => reject(new TooMuch())), timeoutMs)
    worker.once('message', (m: { read?: BusyRead; failed?: 'not-a-calendar' | 'too-much' | 'fault' }) =>
      settle(() => {
        if (m.read) resolve(m.read)
        else reject(m.failed === 'not-a-calendar' ? new NotACalendar() : m.failed === 'too-much' ? new TooMuch() : new Error('Reading a calendar failed in its worker.'))
      })
    )
    // Out of memory comes here too: a file that needs that much is too much.
    worker.once('error', (err) => settle(() => reject(err instanceof Error && 'code' in err && err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new TooMuch() : err)))
    worker.once('exit', () => settle(() => reject(new Error('A calendar worker stopped without answering.'))))
  })
}

export function readBusy(text: string, today: string, limits: ReadLimits = {}): BusyRead {
  const maxSteps = limits.maxSteps ?? MAX_STEPS
  const stopAt = Date.now() + (limits.maxMs ?? MAX_MS)
  let steps = 0
  const step = () => {
    if (++steps > maxSteps || (steps % 64 === 0 && Date.now() > stopAt)) throw new TooMuch()
  }
  let root: ICAL.Component
  try {
    const parsed = ICAL.parse(text)
    // A file of several calendars is read as its first.
    root = new ICAL.Component((Array.isArray(parsed[0]) ? parsed[0] : parsed) as unknown[])
  } catch {
    throw new NotACalendar()
  }
  if (root.name !== 'vcalendar') throw new NotACalendar()
  if (String(root.getFirstPropertyValue('prodid') ?? '') === FEED_PRODID) return { ours: true }

  const from = addDays(today, -1)
  const until = addDays(today, BUSY_AHEAD_DAYS)
  // Instants either side of the days kept, a day wider, so a time zone can't push one out.
  const lo = Date.parse(`${addDays(from, -1)}T00:00:00Z`)
  const hi = Date.parse(`${addDays(until, 2)}T00:00:00Z`)

  // Time zones are kept by ical.js for the whole thread: only this file's count.
  ICAL.TimezoneService.reset()
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(tz)
    } catch {
      // A time zone that can't be read leaves its times as Irish ones.
    }
  }

  const busy: BusyTime[] = []
  const add = (start: ICAL.Time, end: ICAL.Time) => {
    if (start.isDate) {
      const first = start.toString().slice(0, 10)
      // An all-day event's end is the day after its last.
      const last = end.isDate && end.compare(start) > 0 ? addDays(end.toString().slice(0, 10), -1) : first
      if (last < from || first > until) return
      busy.push({ start: first < from ? from : first, end: last > until ? until : last, allDay: true })
      return
    }
    const s = instant(start)
    const e = Math.max(instant(end), s)
    if (e < lo || s > hi) return
    busy.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString(), allDay: false })
  }

  // Exceptions are related by hand, below, by UID: left to itself, ical.js looks through every event in the file for each one, which takes minutes for a big file.
  const events = root.getAllSubcomponents('vevent').map((v) => new ICAL.Event(v, { exceptions: [] }))
  const masters = new Map<string, ICAL.Event>()
  for (const e of events) if (!e.isRecurrenceException() && e.uid) masters.set(e.uid, e)
  for (const e of events) {
    if (!e.isRecurrenceException()) continue
    const master = e.uid ? masters.get(e.uid) : undefined
    // A moved or changed repeat goes with its event; one whose event isn't here stands on its own.
    if (master) master.relateException(e)
    else if (counts(e)) add(e.startDate, e.endDate)
  }
  for (const e of events) {
    step()
    if (e.isRecurrenceException() || !e.startDate) continue
    if (ours(e)) continue
    if (!e.isRecurring()) {
      if (counts(e)) add(e.startDate, e.endDate ?? e.startDate)
      continue
    }
    const begin = startNear(e, addDays(from, -2))
    const it = e.iterator(begin)
    for (let next = it.next(); next; next = it.next()) {
      step()
      if (instant(next) > hi) break
      const o = e.getOccurrenceDetails(next)
      if (counts(o.item, e.startDate.isDate)) add(o.startDate, o.endDate)
    }
    // A repeat from before where that started, moved to another time: said where it now is, if that's in the days kept.
    if (begin !== e.startDate) {
      for (const x of Object.values(e.exceptions)) {
        if (x.recurrenceId && x.recurrenceId.compare(begin) < 0 && counts(x, e.startDate.isDate)) add(x.startDate, x.endDate ?? x.startDate)
      }
    }
  }

  // Published availability: each busy stretch it gives.
  for (const fb of root.getAllSubcomponents('vfreebusy')) {
    for (const p of fb.getAllProperties('freebusy')) {
      const type = String(p.getParameter('fbtype') ?? 'BUSY').toUpperCase()
      if (type === 'FREE') continue
      for (const v of p.getValues()) {
        step()
        if (!(v instanceof ICAL.Period)) continue
        add(v.start, v.getEnd())
      }
    }
  }

  return { ours: false, busy: tidy(busy).slice(0, MAX_BUSY_TIMES), until }
}

/**
 * Where to start working through a repeating event so nothing from the
 * day given on is missed: its own start, or for one that repeats every so
 * many days or weeks, with no count of times, a whole number of those
 * later, so it comes round on exactly the same days and times from there
 * on. Anything else (monthly, yearly, a count) is started where it began:
 * those are few enough a year for the cap to cover.
 */
function startNear(e: ICAL.Event, day: string): ICAL.Time {
  const start = e.startDate
  let every = 0
  for (const p of e.component.getAllProperties('rrule')) {
    const rule = p.getFirstValue() as ICAL.Recur
    if (rule.count || (rule.freq !== 'DAILY' && rule.freq !== 'WEEKLY')) return start
    const days = (rule.interval || 1) * (rule.freq === 'WEEKLY' ? 7 : 1)
    every = every ? lcm(every, days) : days
  }
  if (!every) return start
  // Back by however long one lasts, so one that began before the day and runs into it is still there.
  const lasts = Math.ceil(Math.max(0, e.duration?.toSeconds() ?? 0) / 86_400)
  const gap = (Date.parse(`${addDays(day, -lasts)}T00:00:00Z`) - Date.UTC(start.year, start.month - 1, start.day)) / 86_400_000
  const periods = Math.floor(gap / every)
  if (periods <= 0) return start
  const begin = start.clone()
  begin.adjust(periods * every, 0, 0, 0)
  return begin
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
const lcm = (a: number, b: number) => (a / gcd(a, b)) * b

/** One of our own bookings, copied or subscribed into the calendar they share (ADR 0012's feed). */
function ours(e: ICAL.Event): boolean {
  return (e.uid ?? '').toLowerCase().endsWith(`@${FEED_UID_DOMAIN}`)
}

/** Whether an event, or one time a repeating one comes round, makes them busy: not cancelled, and not marked free unless it's all day. */
function counts(e: ICAL.Event, allDay = e.startDate?.isDate ?? false): boolean {
  if (ours(e)) return false
  const status = String(e.component.getFirstPropertyValue('status') ?? '').toUpperCase()
  if (status === 'CANCELLED') return false
  const transp = String(e.component.getFirstPropertyValue('transp') ?? '').toUpperCase()
  return allDay || e.startDate?.isDate || transp !== 'TRANSPARENT'
}

/** A time as an instant. One with no time zone, or a zone the file doesn't describe, is taken as Irish time. */
function instant(t: ICAL.Time): number {
  if (t.zone && t.zone !== ICAL.Timezone.localTimezone && t.zone.tzid !== 'floating') return t.toUnixTime() * 1000
  return dublinWallTime(t.year, t.month, t.day, t.isDate ? 0 : t.hour, t.isDate ? 0 : t.minute, t.isDate ? 0 : t.second)
}

const DUBLIN = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** The instant a wall-clock time in Ireland is: worked out from the offset Ireland has then (GMT, or IST in summer). */
export function dublinWallTime(year: number, month: number, day: number, hour: number, minute: number, second: number): number {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const offsetAt = (ms: number) => {
    const p = Object.fromEntries(DUBLIN.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - ms
  }
  const guess = asUtc - offsetAt(asUtc)
  return asUtc - offsetAt(guess)
}

/** In order, with overlapping times run together: what someone sees is when they're busy, not how many things they have on. */
function tidy(list: BusyTime[]): BusyTime[] {
  const out: BusyTime[] = []
  const days = list.filter((b) => b.allDay).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
  for (const b of days) {
    const last = out.at(-1)
    if (last && addDays(last.end, 1) >= b.start) last.end = last.end > b.end ? last.end : b.end
    else out.push({ ...b })
  }
  const timed: BusyTime[] = []
  for (const b of list.filter((x) => !x.allDay).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))) {
    const last = timed.at(-1)
    if (last && Date.parse(b.start) <= Date.parse(last.end)) last.end = Date.parse(last.end) > Date.parse(b.end) ? last.end : b.end
    else timed.push({ ...b })
  }
  // All-day first by day, then timed, all in one order by when they start.
  return [...out, ...timed].sort((a, b) => startOf(a) - startOf(b) || Number(b.allDay) - Number(a.allDay))
}

const startOf = (b: BusyTime) => (b.allDay ? Date.parse(`${b.start}T00:00:00Z`) : Date.parse(b.start))
