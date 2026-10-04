import { z } from 'zod'
import { dayLabel } from './crew.ts'
import { day, irishToday } from './day.ts'
import { text } from './plain.ts'

/**
 * Running late (ADR 0028): on a day they're booked, a freelancer says from
 * their private link roughly how late they'll be, or when they'll be
 * there, with a short note; they can change it, or say they're there. The
 * office sees it at once, and so does the contact on the day on their call
 * sheet. Every screen shows it only until its day is over. Someone who
 * rings instead is noted by the office in the same record, and the record
 * goes 30 days after its day.
 */

const id = z.string().min(1).max(64)

/** Roughly how late: about 15 minutes, 30, an hour, or more than that. */
export const LATE_BY = ['15', '30', '60', 'more'] as const
export type LateBy = (typeof LATE_BY)[number]
export const LATE_BY_LABELS: Record<LateBy, string> = { '15': 'About 15 minutes', '30': 'About 30 minutes', '60': 'About an hour', more: 'More than an hour' }

export const LATE_NOTE_LENGTH = 200

/** From this time the evening before a booked day, a late start can be said for it: the day's plans are known by then, and it's well before a 7am call. */
export const LATE_OPENS = '18:00'

/**
 * How many days after its day a running late is kept (ADR 0028, amended).
 * No law asks for it and it holds the person's own words, so it goes; a
 * month covers looking back on the day while their timesheet for it comes
 * in and is approved.
 */
export const LATE_KEPT_DAYS = 30

/** The latest day whose running late has gone by `today` in Ireland: today is its day and 30 more, or later. */
export const lateGoneUpTo = (today: string) => daysAfter(today, -LATE_KEPT_DAYS)

export interface RunningLate {
  id: string
  personId: string
  /** The booking it's about. One record for a booking and a day. */
  offerId: string
  /** The booking's call, so the job can be named without the offer to hand. */
  callId: string
  day: string
  by: LateBy | null
  /** The time they'll be there, if they said one, such as 09:30. */
  arriveAt: string | null
  note: string
  saidAt: string
  /** When they said they're there; null until then. */
  arrivedAt: string | null
  /** When the office noted it, so it left "Answers to check"; null while it waits there. */
  seenAt: string | null
}

export interface LateEntities {
  runningLate: RunningLate
}
export const LATE_ENTITY_NAMES = ['runningLate'] as const

// Typed on a public page, so only a real time: "there at about 99:99" would reach the office.
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "The time you'll be there is a time of day, such as 09:30.")

export const lateCommandSchemas = {
  /** Say, or change, how late they'll be on a day they hold. Saying it again replaces it, and it's new to the office again. */
  'late.say': z
    .object({ id, offerId: id, day, by: z.enum(LATE_BY).nullable(), arriveAt: time.nullable(), note: text(LATE_NOTE_LENGTH, 'The note') })
    .refine((l) => l.by !== null || l.arriveAt !== null, { message: "Say roughly how late you'll be, or the time you'll be there." }),
  /**
   * They're there. The app sends the record's booking and day too: a phone that hadn't yet heard what was said on
   * the link noted it under an id of its own, which the server wrote into the record already there, so the record is
   * found by those when its id isn't. Left out by the link, which knows the record, and by versions from before.
   */
  'late.arrived': z.object({ id, offerId: id.optional(), day: day.optional() }),
  /** The office has seen it, so it leaves "Answers to check". Found as "They're there" is. */
  'late.seen': z.object({ id, offerId: id.optional(), day: day.optional() }),
} as const

const BY_WORDS: Record<LateBy, string> = { '15': 'about 15 minutes late', '30': 'about 30 minutes late', '60': 'about an hour late', more: 'more than an hour late' }

/** "about 30 minutes late", "there at about 10:30", or both. */
export function lateWords(l: Pick<RunningLate, 'by' | 'arriveAt'>): string {
  return [l.by && BY_WORDS[l.by], l.arriveAt && `there at about ${l.arriveAt}`].filter(Boolean).join(', ') || 'running late'
}

/** What the office and the contact on the day read: "about 30 minutes late, “Traffic on the M50”", or "there now". */
export function lateLine(l: Pick<RunningLate, 'by' | 'arriveAt' | 'note' | 'arrivedAt'>): string {
  if (l.arrivedAt) return 'there now'
  const note = l.note.trim()
  return `${lateWords(l)}${note ? `, “${note}”` : ''}`
}

/** Whether a record still shows anywhere: until its day is over. */
export const lateShown = (l: Pick<RunningLate, 'day'>, today: string) => l.day >= today

/** "today", "tomorrow", or the day. */
export function lateDayWord(d: string, today: string): string {
  if (d === today) return 'today'
  return d === nextDay(today) ? 'tomorrow' : dayLabel(d)
}

const daysAfter = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const nextDay = (d: string) => daysAfter(d, 1)

/** The time in Ireland as 18:05. */
export const irishClock = (now = new Date()) => now.toLocaleTimeString('en-GB', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/**
 * Of the days someone holds, the ones they can say they're running late
 * for at this moment: today, and from 6pm tomorrow as well. The link page
 * and the server ask the same, so the form is there exactly when the
 * server would take it.
 */
export function lateDays(held: readonly string[], now = new Date()): string[] {
  const today = irishToday(now)
  const out = held.includes(today) ? [today] : []
  const tomorrow = nextDay(today)
  if (irishClock(now) >= LATE_OPENS && held.includes(tomorrow)) out.push(tomorrow)
  return out
}

/**
 * Why a late start can't be said for this day, or null when it can. On
 * their link it's said to them; the office, noting it for someone who
 * rang, is told the same rules about the person by name (`who`).
 */
export function noLateReason(held: readonly string[], d: string, now = new Date(), who?: string): string | null {
  if (lateDays(held, now).includes(d)) return null
  if (!held.includes(d)) return who ? `${who} isn't booked on ${dayLabel(d)}.` : `You're not booked on ${dayLabel(d)}.`
  if (d < irishToday(now)) return `${dayLabel(d)} is over.`
  if (who) return "Running late can be noted from 6pm the evening before a day they're booked."
  return "You can say you're running late from 6pm the evening before a day you're booked."
}

/** Why there's nothing to be late for: the booking was let go, or its call cancelled. Named for the office, as above. */
export const lateGoneReason = (who?: string) =>
  who ? `${who} isn't booked on this one any more, so there's nothing to be late for.` : "You're not booked on this one any more, so there's nothing to be late for."
