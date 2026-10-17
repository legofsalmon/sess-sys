import { z } from 'zod'
import { dayLabel, eachDay } from './crew.ts'

/**
 * Freelancers' own calendars, read only (ADR 0044). A freelancer shares
 * when they're busy by giving the private address of their own calendar
 * (Google's "secret address in iCal format", a published Outlook or
 * iCloud calendar, any iCal feed): on their link, or the office pastes the
 * address they sent it. The server reads it on a schedule and keeps only
 * the times they're busy, so the office sees real availability without
 * the freelancer filling in a second calendar ("their calendar, not ours",
 * docs/architecture.md). Nothing is written to their calendar, and no
 * title, place, guest or description is kept.
 *
 * Busy is a warning, never a refusal: a hold in someone's own calendar may
 * be something they can move, so an offer can still go, and they can
 * still say yes.
 */

const id = z.string().min(1).max(64)

/**
 * One stretch of busy time. All day: `start` and `end` are days, the last
 * one included, as days off are. Timed: instants, the end not included, so
 * something ending at midnight isn't busy the next day.
 */
export interface BusyTime {
  start: string
  end: string
  allDay: boolean
}

/** Who gave the address: the person on their link, or the office on their page with the address they sent. */
export type CalendarAddedBy = 'self' | 'office'

/**
 * A person's own calendar as devices know it: never its address, which
 * only the server holds, as a secret. Its id is the person's: one each.
 */
export interface OwnCalendar {
  id: string
  personId: string
  addedBy: CalendarAddedBy
  addedAt: string
  /** When it was last read and its busy times taken in; null until the first read works. */
  readAt: string | null
  /** Why the last look didn't work, in words; null when it did. The busy times from the last good read stay. */
  problem: string | null
  /** The busy times from yesterday to `until`, in order. */
  busy: BusyTime[]
  /** The last day read ahead to. */
  until: string
}

export interface OwnCalendarEntities {
  ownCalendar: OwnCalendar
}
export const OWN_CALENDAR_ENTITY_NAMES = ['ownCalendar'] as const

/** How far ahead busy times are kept: about four months, as far ahead as crew are usually asked. */
export const BUSY_AHEAD_DAYS = 120
/** The most busy times kept for one person: a calendar with more is read up to there. */
export const MAX_BUSY_TIMES = 1000

/** What the server records sharing one as in the history. Not a command: the address needs the server to read it there and then, and never goes in the history. */
export const OWN_CALENDAR_ACTIONS = { share: 'ownCalendar.share' } as const
export type OwnCalendarAction = (typeof OWN_CALENDAR_ACTIONS)[keyof typeof OWN_CALENDAR_ACTIONS]

export const ownCalendarCommandSchemas = {
  /**
   * Stop reading someone's own calendar: the address and the busy times
   * are deleted. From their link (one tap) or from the app; works offline,
   * as it carries no address. Reading it again needs the address again.
   */
  'ownCalendar.stop': z.object({ personId: id }),
} as const

/** The longest address taken; real ones are well under. */
export const MAX_ADDRESS_LENGTH = 2000

/** Plain words for an address that won't do, the same on the link, the app and the server. */
export const ADDRESS_WORDS = {
  empty: "Paste your calendar's private address, the one ending in .ics, or starting webcal://.",
  notAnAddress: "That doesn't look like a calendar address. It starts https:// or webcal://, and usually ends in .ics.",
  notSecure: 'That address starts http://, which anyone on the way could read. Use the https:// or webcal:// one your calendar gives.',
  tooLong: "That's longer than any calendar address, so it wasn't kept. Check what was pasted.",
  ours: "That's your Session Hire bookings calendar. Paste the address of your own calendar instead.",
} as const

/**
 * A calendar address as pasted, tidied: webcal:// (and webcals://) read as
 * https://, which is what they are. Only https is taken, so the address
 * and what it shows can't be read on the way. The server checks where it
 * points as well (server/src/crew/calendar-fetch.ts).
 */
export function tidyCalendarAddress(typed: string): { address: string } | { reason: string } {
  const s = typed.trim()
  if (!s) return { reason: ADDRESS_WORDS.empty }
  if (s.length > MAX_ADDRESS_LENGTH) return { reason: ADDRESS_WORDS.tooLong }
  const swapped = s.replace(/^webcals?:\/\//i, 'https://')
  let url: URL
  try {
    url = new URL(swapped)
  } catch {
    return { reason: ADDRESS_WORDS.notAnAddress }
  }
  if (url.protocol === 'http:') return { reason: ADDRESS_WORDS.notSecure }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return { reason: ADDRESS_WORDS.notAnAddress }
  return { address: url.href }
}

// Made once: a formatter for every busy time would be most of what drawing a month costs.
const IRISH_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Dublin' })
const IRISH_TIME = new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** The day in Ireland an instant falls on. */
const irishDayOf = (iso: string) => IRISH_DAY.format(new Date(iso))
/** "09:30", Irish time. */
const irishTimeOf = (iso: string) => IRISH_TIME.format(new Date(iso))
/** The last instant a timed stretch covers, so one ending at midnight belongs to the day before. */
const lastMoment = (iso: string) => new Date(Date.parse(iso) - 1).toISOString()

/** The days in Ireland a busy time touches. */
export function busyDaysOf(b: BusyTime): string[] {
  if (b.allDay) return eachDay(b.start, b.end)
  if (Date.parse(b.end) <= Date.parse(b.start)) return [irishDayOf(b.start)]
  return eachDay(irishDayOf(b.start), irishDayOf(lastMoment(b.end)))
}

/** What a busy time is on one of its days, in words: "all day", "09:00 to 17:30", "from 22:00", "until 02:00". */
export function busyWords(b: BusyTime, day: string): string {
  if (b.allDay) return 'all day'
  const first = irishDayOf(b.start)
  const last = Date.parse(b.end) <= Date.parse(b.start) ? first : irishDayOf(lastMoment(b.end))
  if (day === first && day === last) return `${irishTimeOf(b.start)} to ${irishTimeOf(b.end)}`
  if (day === first) return `from ${irishTimeOf(b.start)}`
  if (day === last) return `until ${irishTimeOf(b.end)}`
  return 'all day'
}

/** Each day someone is busy, with what in words ("all day", "09:00 to 17:30; 19:00 to 23:00"), for the days asked about or all of them. */
export function busyByDay(cal: Pick<OwnCalendar, 'busy'> | undefined, days?: readonly string[]): Map<string, string> {
  const out = new Map<string, string[]>()
  const wanted = days && new Set(days)
  for (const b of cal?.busy ?? []) {
    for (const d of busyDaysOf(b)) {
      if (wanted && !wanted.has(d)) continue
      out.set(d, [...(out.get(d) ?? []), busyWords(b, d)])
    }
  }
  // A day busy all day is busy all day, whatever else is on it.
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)).map(([d, w]) => [d, w.includes('all day') ? 'all day' : [...new Set(w)].join('; ')]))
}

/** "Busy in their own calendar on Fri 3 Oct (all day) and Sat 4 Oct (09:00 to 13:00)", or nothing when they aren't. */
export function busyWarning(cal: Pick<OwnCalendar, 'busy'> | undefined, days: readonly string[], whose = 'their'): string | null {
  const busy = [...busyByDay(cal, days)]
  if (!busy.length) return null
  const shown = busy.slice(0, 4).map(([d, w]) => `${dayLabel(d)} (${w})`)
  const more = busy.length > 4 ? ` and ${busy.length - 4} more day${busy.length - 4 === 1 ? '' : 's'}` : ''
  const listed = shown.length < 2 || more ? `${shown.join(', ')}${more}` : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`
  return `Busy in ${whose} own calendar on ${listed}`
}
