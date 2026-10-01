import { z } from 'zod'
import { day } from './day.ts'

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
const time = z.string().regex(/^\d{2}:\d{2}$/)
/** Money in euro cents, so sums never drift. */
const cents = z.number().int().min(0).max(100_000_00)

export const person = z.object({
  id,
  name: z.string().min(1).max(200),
  kind: z.enum(['staff', 'freelancer']),
  email: z.string().max(200).nullable(),
  /** International format, e.g. +353871234567, so WhatsApp links work. */
  phone: z.string().max(40).nullable(),
  skills: z.array(z.string().min(1).max(60)).max(30),
  dayRateCents: cents.nullable(),
  notes: z.string().max(2000),
  /**
   * The secret in the person's private link. Set by the server, never by a
   * device. Anyone holding the link acts as this person, so it can be
   * replaced (person.newLink) if it leaks.
   */
  linkToken: z.string(),
})
export type Person = z.infer<typeof person>

/** Days a person can't work. Offers for those days need an explicit override. */
export const unavailability = z.object({
  id,
  personId: id,
  start: day,
  end: day,
  note: z.string().max(500),
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
  project: z.string().min(1).max(200),
  phase: z.string().max(100),
  venue: z.string().max(300),
  role: z.string().min(1).max(100),
  start: day,
  end: day,
  callTime: time.nullable(),
  needed: z.number().int().min(1).max(100),
  dayRateCents: cents.nullable(),
  /** Everything a freelancer wants up front: travel, food, parking, dress. */
  details: z.string().max(4000),
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
  note: z.string().max(1000),
  respondedAt: z.string().nullable(),
  respondedVia: z.enum(['link', 'app', 'calendar', 'ops']).nullable(),
  /** Sent despite a clash or marked day off; kept for the audit trail. */
  override: z.boolean(),
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

export const crewCommandSchemas = {
  'person.upsert': z.object({
    id,
    name: z.string().min(1).max(200),
    kind: z.enum(['staff', 'freelancer']),
    email: z.string().email().max(200).nullable(),
    phone: z.string().regex(/^\+?[0-9 ()-]{6,40}$/, 'Phone numbers need digits only, ideally starting with +353.').nullable(),
    skills: z.array(z.string().min(1).max(60)).max(30),
    dayRateCents: cents.nullable(),
    notes: z.string().max(2000),
  }),
  /** Replace a person's private link, so the old one stops working. */
  'person.newLink': z.object({ id }),
  'unavailability.add': z
    .object({ id, personId: id, start: day, end: day, note: z.string().max(500) })
    .refine((u) => u.start <= u.end, { message: 'The days off end before they start.' }),
  'unavailability.remove': z.object({ id }),
  'call.create': z
    .object({
      id,
      /** Optional so versions of the app from before jobs can still send it. */
      projectId: id.nullable().default(null),
      phaseId: id.nullable().default(null),
      project: z.string().min(1).max(200),
      phase: z.string().max(100),
      venue: z.string().max(300),
      role: z.string().min(1).max(100),
      start: day,
      end: day,
      callTime: time.nullable(),
      needed: z.number().int().min(1).max(100),
      dayRateCents: cents.nullable(),
      details: z.string().max(4000),
      replyBy: day.nullable(),
    })
    .refine((c) => c.start <= c.end, { message: 'The call ends before it starts.' }),
  'call.cancel': z.object({ id }),
  /**
   * Offer a call to one person. Send several for a shortlist: whoever
   * accepts first gets the place, and the rest are told it has been filled.
   */
  'offer.send': z.object({ id, callId: id, personId: id, override: z.boolean() }),
  /** The freelancer's answer, from their link or the app. */
  'offer.respond': z.discriminatedUnion('answer', [
    z.object({ id, answer: z.literal('accept'), days: z.array(day).min(1).nullable(), note: z.string().max(1000) }),
    z.object({ id, answer: z.literal('decline'), note: z.string().max(1000) }),
    z.object({
      id,
      answer: z.literal('counter'),
      counterRateCents: cents,
      days: z.array(day).min(1).nullable(),
      note: z.string().max(1000),
    }),
  ]),
  /** Ops confirm an acceptance, or agree a counter-offer at the asked rate. */
  'offer.confirm': z.object({ id }),
  'offer.cancel': z.object({ id }),
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
