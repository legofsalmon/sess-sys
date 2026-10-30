import { dayAnswer, type DayAnswer, type GuestResponse } from '@sh/shared'
import type { Wanted } from './events.ts'
import type { Attendee, EventBody, GoogleEvent, SendUpdates } from './google.ts'
import type { DayRow, GuestRow } from './store.ts'

/**
 * The calendar sync's guests (ADR 0009): who should be on each day's event,
 * and how the event and its answers compare with what the app last wrote.
 */

/** The app's guests on one event, as last written or taken in: what answers in Google are compared with. */
export interface Known {
  dayId: string
  day: string
  guests: GuestRow[]
}

/** A guest whose answer in Google differs from the one the app last took in. */
export interface Answer {
  dayId: string
  personId: string
  email: string
  response: GuestResponse
  /** What they wrote with it in Google, if anything. */
  comment: string
}

/** Email addresses as Google compares them. */
export const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The events whose guests' answers matter: the app's days on the calendar being written to that have guests. */
export function knownFrom(rows: DayRow[], calendarId: string | null): Map<string, Known> {
  const out = new Map<string, Known>()
  for (const r of rows) if (r.state === 'on' && r.calendarId === calendarId && r.guests.length) out.set(r.eventId, { dayId: r.id, day: r.day, guests: r.guests })
  return out
}

/** Each day's answer from the answers on its events. */
export function byDay(entries: [string, GuestResponse][]): Record<string, DayAnswer> {
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
export function sameGuests(a: GuestRow[], b: GuestRow[]): boolean {
  return a.length === b.length && a.every((g, i) => g.personId === b[i]!.personId && g.offerId === b[i]!.offerId && sameEmail(g.email, b[i]!.email))
}

/** The event still says what the app wrote: its title, day, place, description and marks. */
export function sameContent(ev: GoogleEvent, body: EventBody): boolean {
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
