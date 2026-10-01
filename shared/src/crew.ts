import { z } from 'zod'
import { day } from './day.ts'
import { euroCents, needed, text, whole } from './plain.ts'

/**
 * Crew booking: people, the roles a job needs (calls), the offers that fill
 * them, and the days people can't work.
 *
 * Built to "meet freelancers in the middle" (docs/architecture.md): every
 * freelancer has a private link that works without an app or a login. From
 * it they see their offers with full details, accept all or some days,
 * decline, counter the rate, mark days off and subscribe to their bookings
 * in any calendar app. Ops send that link wherever the freelancer already
 * looks (WhatsApp, SMS, email).
 *
 * The same server-decides rule as the rest of sync applies: a freelancer
 * accepting a role that has just been filled, or a day they are already
 * booked elsewhere, gets a plain reason instead of a silent double booking.
 */

const id = z.string().min(1).max(64)
const time = z.string().regex(/^\d{2}:\d{2}$/, 'The call time is a time of day, such as 08:00.')
/** Money in euro cents, so sums never drift. */
const cents = euroCents(100_000_00, 'A day rate')

export const person = z.object({
  id,
  name: needed(200, 'The name', 'A name'),
  kind: z.enum(['staff', 'freelancer']),
  email: z.string().max(200).nullable(),
  /** International format, e.g. +353871234567, so WhatsApp links work. */
  phone: z.string().max(40).nullable(),
  skills: z.array(needed(60, 'A skill', 'A skill')).max(30, 'Up to 30 skills, please.'),
  dayRateCents: cents.nullable(),
  notes: text(2000, 'The notes'),
  /**
   * The secret in the person's private link. Set by the server, never by a
   * device. Anyone holding the link acts as this person, so it can be
   * replaced (person.newLink) if it leaks.
   */
  linkToken: z.string(),
  /**
   * Archived people have left, or stopped working for us: they're kept for
   * the record (past bookings, timesheets, the history) but offered nothing,
   * and their link and calendar feed stop. Defaults so records synced
   * before it existed read as not archived.
   */
  archived: z.boolean().default(false),
})
export type Person = z.infer<typeof person>

/** Days a person can't work. Offers for those days need an explicit override. */
export const unavailability = z.object({
  id,
  personId: id,
  start: day,
  end: day,
  note: text(500, 'The note'),
  /** Who said so: ops, the person on their link, or their own calendar (later). */
  source: z.enum(['ops', 'self', 'calendar']),
})
export type Unavailability = z.infer<typeof unavailability>

/**
 * A role a job needs: "2 x audio tech, Build and Show, 3 to 5 October".
 * Usually part of a job in Jobs, and of one of its phases (ADR 0007): then
 * the server writes the job's, phase's and venue's names here and keeps them
 * in step, so freelancers' pages and messages read them as text. A call not
 * tied to a job has them as typed.
 */
export const crewCall = z.object({
  id,
  /** The job, when the call is part of one. Missing on calls synced before jobs existed. */
  projectId: id.nullable(),
  /** The phase, when the call is for one; null for a call across several, or not tied to a job. */
  phaseId: id.nullable(),
  project: needed(200, "The job's name", "The job's name"),
  phase: text(100, 'The phase'),
  venue: text(300, 'The venue'),
  role: needed(100, 'The role', 'A role'),
  start: day,
  end: day,
  callTime: time.nullable(),
  needed: whole(1, 100, 'How many'),
  dayRateCents: cents.nullable(),
  /** Everything a freelancer wants up front: travel, food, parking, dress. */
  details: text(4000, 'The details for crew'),
  /** When offers stop being open, if ops set one. */
  replyBy: day.nullable(),
  status: z.enum(['open', 'cancelled']),
})
export type CrewCall = z.infer<typeof crewCall>

export const OFFER_STATUSES = [
  /** Sent, waiting on the freelancer. */
  'offered',
  /** The freelancer said yes (to `days`). Ops still confirm. */
  'accepted',
  /** The freelancer asked for a different rate; ops decide. */
  'countered',
  'declined',
  /** Ops confirmed: this is a booking. */
  'confirmed',
  /** Someone else took the last place before this person answered. */
  'filled',
  /** Ops withdrew it, or the call was cancelled. */
  'cancelled',
  /** Had accepted, or was booked, then said they can't make it any more. The office finds cover. */
  'pulled-out',
] as const
export type OfferStatus = (typeof OFFER_STATUSES)[number]

/** An offer is also the crew assignment once accepted and confirmed. */
export const offer = z.object({
  id,
  callId: id,
  personId: id,
  status: z.enum(OFFER_STATUSES),
  /** The days this person is on for. All the call's days unless they took only some. */
  days: z.array(day),
  /** The agreed rate; starts as the call's rate, changes if a counter is agreed. */
  dayRateCents: cents.nullable(),
  counterRateCents: cents.nullable(),
  /** What the freelancer said when answering, for ops to read. */
  note: text(1000, 'The note'),
  respondedAt: z.string().nullable(),
  respondedVia: z.enum(['link', 'app', 'calendar', 'ops']).nullable(),
  /** Sent despite a clash or marked day off; kept for the audit trail. */
  override: z.boolean(),
  /**
   * When the office noted a decline or a pull-out, so it left "Answers to
   * check"; null while it waits there. A yes or a counter leaves the queue
   * through Confirm and Withdraw instead. Missing on offers synced before.
   */
  seenAt: z.string().nullable(),
})
export type Offer = z.infer<typeof offer>

export interface CrewEntities {
  person: Person
  unavailability: Unavailability
  crewCall: CrewCall
  offer: Offer
}
export const CREW_ENTITY_NAMES = ['person', 'unavailability', 'crewCall', 'offer'] as const

/** Offers that hold a person's days. */
export const HOLDING: readonly OfferStatus[] = ['accepted', 'confirmed']
/** Offers still waiting on someone. */
export const OPEN: readonly OfferStatus[] = ['offered', 'countered']
/** Offers a change to the call still reaches: waiting on someone, or holding days. */
export const LIVE: readonly OfferStatus[] = ['offered', 'countered', 'accepted', 'confirmed']

/** A field-by-field change must name at least one field; shared with the job and phase changes. */
export const somethingToChange = [(u: Record<string, unknown>) => Object.keys(u).some((k) => k !== 'id' && u[k] !== undefined), { message: 'Nothing to change.' }] as const

/** The same checks wherever contact details are typed: the office's form, or the person's own link. */
const contactEmail = z.string().email("That email address doesn't look right.").max(200, 'The email address can be up to 200 characters.').nullable()
const contactPhone = z.string().regex(/^\+?[0-9 ()-]{6,40}$/, 'Phone numbers need digits only, ideally starting with +353.').nullable()

export const crewCommandSchemas = {
  'person.upsert': z.object({
    id,
    name: needed(200, 'The name', 'A name'),
    kind: z.enum(['staff', 'freelancer']),
    email: contactEmail,
    phone: contactPhone,
    skills: z.array(needed(60, 'A skill', 'A skill')).max(30, 'Up to 30 skills, please.'),
    dayRateCents: cents.nullable(),
    notes: text(2000, 'The notes'),
  }),
  /** Replace a person's private link, so the old one stops working. */
  'person.newLink': z.object({ id }),
  /**
   * Archive someone who has left, or bring them back. Refused while they
   * hold an open offer or a booking from today on, so nothing is left hanging.
   */
  'person.archive': z.object({ id, archived: z.boolean() }),
  /**
   * A person's own contact details, from their link or the app. Only the
   * fields sent change, so the history can say which, never what.
   */
  'person.contact': z
    .object({ id, email: contactEmail.optional(), phone: contactPhone.optional() })
    .refine((c) => c.email !== undefined || c.phone !== undefined, { message: 'Nothing to change.' }),
  'unavailability.add': z
    .object({ id, personId: id, start: day, end: day, note: text(500, 'The note') })
    .refine((u) => u.start <= u.end, { message: 'The days off end before they start.' }),
  'unavailability.remove': z.object({ id }),
  'call.create': z
    .object({
      id,
      /** Optional so versions of the app from before jobs can still send it. */
      projectId: id.nullable().default(null),
      phaseId: id.nullable().default(null),
      project: needed(200, "The job's name", "The job's name"),
      phase: text(100, 'The phase'),
      venue: text(300, 'The venue'),
      role: needed(100, 'The role', 'A role'),
      start: day,
      end: day,
      callTime: time.nullable(),
      needed: whole(1, 100, 'How many'),
      dayRateCents: cents.nullable(),
      details: text(4000, 'The details for crew'),
      replyBy: day.nullable(),
    })
    .refine((c) => c.start <= c.end, { message: 'The call ends before it starts.' }),
  /**
   * Only the fields the person changed, like a phase (ADR 0007). A change
   * of dates takes each offer's days along; a change of rate reaches only
   * offers nobody has answered yet; nobody booked is ever left with no
   * days without the office being told. A call that is part of a job takes
   * its job, phase and venue from the job, so those can only be typed for
   * a call that isn't.
   */
  'call.update': z
    .object({
      id,
      role: needed(100, 'The role', 'A role').optional(),
      start: day.optional(),
      end: day.optional(),
      callTime: time.nullable().optional(),
      needed: whole(1, 100, 'How many').optional(),
      dayRateCents: cents.nullable().optional(),
      details: text(4000, 'The details for crew').optional(),
      replyBy: day.nullable().optional(),
      project: needed(200, "The job's name", "The job's name").optional(),
      phase: text(100, 'The phase').optional(),
      venue: text(300, 'The venue').optional(),
    })
    .refine(...somethingToChange)
    .refine((c) => !c.start || !c.end || c.start <= c.end, { message: 'The call ends before it starts.' }),
  'call.cancel': z.object({ id }),
  /**
   * Offer a call to one person. Send several for a shortlist: whoever
   * accepts first gets the place, and the rest are told it has been filled.
   */
  'offer.send': z.object({ id, callId: id, personId: id, override: z.boolean() }),
  /** The freelancer's answer, from their link or the app. */
  'offer.respond': z.discriminatedUnion('answer', [
    z.object({ id, answer: z.literal('accept'), days: z.array(day).min(1).nullable(), note: text(1000, 'The note') }),
    z.object({ id, answer: z.literal('decline'), note: text(1000, 'The note') }),
    z.object({
      id,
      answer: z.literal('counter'),
      counterRateCents: cents,
      days: z.array(day).min(1).nullable(),
      note: text(1000, 'The note'),
    }),
    /** Can't make it any more, having accepted or been booked: the place is free again and the office finds cover. */
    z.object({ id, answer: z.literal('pullOut'), note: text(1000, 'The note') }),
  ]),
  /** Ops confirm an acceptance, or agree a counter-offer at the asked rate. */
  'offer.confirm': z.object({ id }),
  'offer.cancel': z.object({ id }),
  /** The office has seen a decline or a pull-out, so it leaves "Answers to check". */
  'offer.seen': z.object({ id }),
} as const

/** Every day from start to end, inclusive. */
export function eachDay(start: string, end: string): string[] {
  const out: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  for (let i = 0; i < 400; i++) {
    const s = d.toISOString().slice(0, 10)
    if (s > end) break
    out.push(s)
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

const dayMs = 86_400_000
const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * dayMs).toISOString().slice(0, 10)

/** How many days `to` is after `from`; negative when before. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / dayMs)
}

/**
 * Whether a phase's new span holds the whole of its old one: it got longer
 * at one end or both, but didn't move, so nothing on it needs to.
 */
export function phaseOnlyGrew(from: { start: string; end: string }, to: { start: string; end: string }): boolean {
  return to.start <= from.start && to.end >= from.end
}

/**
 * Where a call lands when its phase moves: shifted by the same number of
 * days as the phase's start. A call that was inside the phase stays inside
 * it, cut to the phase's new span, or given the phase's days when none of
 * its own fit; a call that was already outside its phase just moves with
 * it. A phase that only grows hasn't moved, so its calls stay where they
 * are: the crew keep the days they agreed. The server and the device's
 * view work it out the same way.
 */
export function movedCallSpan(
  call: { start: string; end: string },
  from: { start: string; end: string },
  to: { start: string; end: string }
): { start: string; end: string } {
  if (phaseOnlyGrew(from, to)) return { start: call.start, end: call.end }
  const shift = daysBetween(from.start, to.start)
  let start = shiftDay(call.start, shift)
  let end = shiftDay(call.end, shift)
  if (call.start < from.start || call.end > from.end) return { start, end }
  if (start < to.start) start = to.start
  if (end > to.end) end = to.end
  return start > end ? { start: to.start, end: to.end } : { start, end }
}

/**
 * An offer's days once its call's days change: all the new days when it
 * held all the old ones, otherwise the days the person chose that are
 * still in range. When the whole job has moved, `shift` moves the chosen
 * days with it first, so the second day's person is still on the second
 * day. Empty means the person would be left with nothing, which the server
 * refuses for anyone booked rather than quietly un-booking them.
 */
export function offerDaysAfter(held: readonly string[], oldDays: readonly string[], newDays: readonly string[], shift = 0): string[] {
  if (oldDays.every((d) => held.includes(d))) return [...newDays]
  return held.map((d) => (shift ? shiftDay(d, shift) : d)).filter((d) => newDays.includes(d))
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Fri 3 Oct", the way crew write dates. Built by hand so it reads the same on every phone. */
export function dayLabel(d: string): string {
  const date = new Date(`${d}T12:00:00Z`)
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

export function daysLabel(days: string[]): string {
  if (days.length === 0) return ''
  const sorted = [...days].sort()
  const all = eachDay(sorted[0]!, sorted[sorted.length - 1]!)
  if (all.length === sorted.length && sorted.length > 1) return `${dayLabel(sorted[0]!)} to ${dayLabel(sorted[sorted.length - 1]!)}`
  return sorted.map(dayLabel).join(', ')
}

export function euro(c: number | null | undefined): string {
  if (c === null || c === undefined) return 'rate to agree'
  return `€${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`
}

/**
 * The message ops paste into WhatsApp, SMS or email. Everything a freelancer
 * needs to decide is in it; the link is for answering.
 */
export function offerMessage(p: Pick<Person, 'name'>, c: CrewCall, link: string): string {
  const first = p.name.split(' ')[0]
  const lines = [
    `Hi ${first}, are you free for ${c.project}${c.phase ? ` (${c.phase})` : ''}?`,
    `${c.role}, ${daysLabel(eachDay(c.start, c.end))}${c.callTime ? `, call ${c.callTime}` : ''}`,
    c.venue ? `At ${c.venue}` : '',
    `${euro(c.dayRateCents)}${c.dayRateCents !== null ? ' a day' : ''}`,
    c.replyBy ? `Please answer by ${dayLabel(c.replyBy)}.` : '',
    `Accept, decline or pick days here: ${link}`,
  ]
  return lines.filter(Boolean).join('\n')
}

/** wa.me wants digits only, with the country code. Irish mobiles written 08x become +3538x. */
export function whatsappNumber(phone: string): string {
  let digits = phone.replace(/[^0-9+]/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.startsWith('+')) digits = digits.slice(1)
  else if (digits.startsWith('0')) digits = `353${digits.slice(1)}`
  return digits
}

/**
 * The code in a person's calendar feed address, /cal/<code>.ics (ADR 0012).
 * Worked out from their private link, so nothing more is stored: whoever
 * holds the link can find the feed, the feed can't be turned back into the
 * link, and a new link gives a new feed address. The server and the app
 * work it out the same way. 24 characters, like the link itself, so error
 * reports take it out as a secret (privacy.ts).
 */
export async function feedCodeFor(linkToken: string): Promise<string> {
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sh-feed:${linkToken}`)))
  return btoa(String.fromCharCode(...hash))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .slice(0, 24)
}

export const feedPath = (code: string) => `/cal/${code}.ics`

/**
 * What the office tells someone after an offer, in the voice of the offer
 * message: short, the job and days named, and what happens next. The app
 * sends nothing itself: the office opens WhatsApp, a text or an email with
 * the words, or copies them, as it does for the offer (audit finding 9).
 * One message for each thing that changes; the app prompts with it right
 * after the office's own action.
 */
export type TellEvent =
  /** Confirm, or a counter-offer agreed: it's a booking. */
  | 'confirmed'
  /** An offer withdrawn before an answer, or a counter-offer turned down. */
  | 'withdrawn'
  /** Someone who had said yes, or was booked, is let go. */
  | 'released'
  /** The job is cancelled or lost, taking its crew calls with it. */
  | 'job-stopped'
  /** One crew call cancelled. */
  | 'call-cancelled'
  /** The call's days, time, rate or details changed; the message reads them as they are now. */
  | 'call-changed'
  /** The phase moved and its crew with it; the message reads the call's new days. */
  | 'phase-moved'
  | 'timesheet-approved'
  | 'timesheet-reopened'

/** What a message needs besides the person: the call as it stands, and the booking's own figures where they differ. */
export interface TellContext {
  call: Pick<CrewCall, 'id' | 'project' | 'phase' | 'role' | 'start' | 'end' | 'callTime' | 'venue' | 'dayRateCents'>
  /** The person's own days, when they took only some. */
  days?: readonly string[]
  /** The booking, for the timesheet's address. */
  offerId?: string
  /** For a timesheet: the figures approved, in words ("2 days at €320, and €43.50 of extras: €683.50"). */
  summary?: string
  /** For a timesheet: what the office changed from what was sent, in words. */
  changes?: readonly string[]
}

const jobName = (c: TellContext['call']) => `${c.project}${c.phase ? ` (${c.phase})` : ''}`
const whenLine = (c: TellContext['call'], days?: readonly string[]) =>
  `${daysLabel(days?.length ? [...days] : eachDay(c.start, c.end))}${c.callTime ? `, call ${c.callTime}` : ''}`
const rateLine = (c: TellContext['call']) => `${euro(c.dayRateCents)}${c.dayRateCents !== null ? ' a day' : ''}`

/** The message, its subject for an email, and what it is, for the panel's name ("Send confirmation to …"). */
export function tellMessage(event: TellEvent, p: Pick<Person, 'name'>, ctx: TellContext, link: string): { text: string; subject: string; what: string } {
  const first = p.name.split(' ')[0]
  const c = ctx.call
  const job = jobName(c)
  const when = whenLine(c, ctx.days)
  const next = "we'll be in touch about the next one."
  const timesheet = `${link}/timesheet/${ctx.offerId ?? c.id}`
  const lines = (parts: (string | false | undefined | 0)[]) => parts.filter(Boolean).join('\n')
  switch (event) {
    case 'confirmed':
      return {
        text: lines([
          `Hi ${first}, you're confirmed for ${job}.`,
          `${c.role}, ${when}`,
          c.venue && `At ${c.venue}`,
          c.dayRateCents !== null && rateLine(c),
          `Your call sheet, with who's on and who to ring on the day, is here: ${link}/sheet/${c.id}`,
          'If anything changes on your side, let us know.',
        ]),
        subject: `Confirmed: ${job}, ${when}`,
        what: 'confirmation',
      }
    case 'withdrawn':
      return {
        text: lines([`Hi ${first}, we've withdrawn the offer of ${c.role} on ${job}, ${when}, so there's nothing to answer.`, `Sorry for the bother, and ${next}`]),
        subject: `Withdrawn: ${job}, ${when}`,
        what: 'withdrawal',
      }
    case 'released':
      return {
        text: lines([
          `Hi ${first}, sorry, we no longer need you for ${job}: ${c.role}, ${when}.`,
          `It's off your page and your calendar feed, so there's nothing to do. Thanks for holding the days, and ${next}`,
        ]),
        subject: `No longer needed: ${job}, ${when}`,
        what: 'release',
      }
    case 'job-stopped':
      return {
        text: lines([
          `Hi ${first}, ${c.project} isn't going ahead, so ${c.role} on ${when} is off. Sorry about that.`,
          `It's off your page and your calendar feed. Thanks, and ${next}`,
        ]),
        subject: `Not going ahead: ${c.project}, ${when}`,
        what: 'cancellation',
      }
    case 'call-cancelled':
      return {
        text: lines([
          `Hi ${first}, we no longer need ${c.role} on ${job}, ${when}, so that's off. Sorry about that.`,
          `It's off your page and your calendar feed. Thanks, and ${next}`,
        ]),
        subject: `Cancelled: ${job}, ${when}`,
        what: 'cancellation',
      }
    case 'call-changed':
      return {
        text: lines([
          `Hi ${first}, a change to ${job}: ${c.role} is now ${when}${c.venue ? `, at ${c.venue}` : ''}, ${rateLine(c)}.`,
          `The details are on your page: ${link}`,
          'If that no longer suits, say so there or ring the office.',
        ]),
        subject: `Changed: ${job}, ${when}`,
        what: 'change',
      }
    case 'phase-moved':
      return {
        text: lines([
          `Hi ${first}, ${job} has moved: ${c.role} is now ${when}.`,
          `The details are on your page: ${link}`,
          "If the new days don't suit, say so there or ring the office.",
        ]),
        subject: `Moved: ${job}, ${when}`,
        what: 'change',
      }
    case 'timesheet-approved':
      return {
        text: lines([
          `Hi ${first}, your timesheet for ${job} is approved${ctx.summary ? `: ${ctx.summary}` : ''}.`,
          ctx.changes?.length && `We changed what you sent: ${ctx.changes.join('; ')}.`,
          `It's here, with any note from us: ${timesheet}`,
          'Payment follows the usual way.',
        ]),
        subject: `Timesheet approved: ${job}`,
        what: 'timesheet approval',
      }
    case 'timesheet-reopened':
      return {
        text: lines([`Hi ${first}, we've reopened your timesheet for ${job} to sort something out. You can change it again until we approve it: ${timesheet}`]),
        subject: `Timesheet reopened: ${job}`,
        what: 'timesheet reopening',
      }
  }
}
