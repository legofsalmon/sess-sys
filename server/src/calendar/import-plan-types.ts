import type { GuestResponse, ImportChanged, ImportLeftOut, ProjectKind, ProjectStatus } from '@sh/shared'

/**
 * What the calendar import (ADR 0011) reads and works out: the events and
 * the app's records it starts from, and the plan of jobs, phases and people
 * it gives back.
 */

/** An event as the import reads it. */
export interface SourceEvent {
  id: string
  /** Google's iCalUID: the same on every calendar the event is on. */
  uid: string
  cancelled: boolean
  title: string
  /** First and last day of an all-day event; null for one with a start time. */
  days: { start: string; end: string } | null
  location: string
  /** As Google has it: plain text, or simple HTML. */
  description: string
  guests: SourceGuest[]
  repeating: boolean
  /** Out of office, focus time, working location, a birthday: not an ordinary event. */
  special: boolean
  /** Written by the app itself (ADR 0008). */
  ours: boolean
}

export interface SourceGuest {
  email: string
  name: string | null
  answer: GuestResponse
  /** The organiser, the calendar's own account, or a room: never crew. */
  notCrew: boolean
}

/** What the app already holds, to match against. */
export interface AppData {
  /** With the addresses each had as someone they were combined with (ADR 0055), which match them too. */
  people: { id: string; name: string; email: string | null; otherEmails?: readonly string[] }[]
  venues: { id: string; name: string; address: string }[]
  jobs: {
    id: string
    name: string
    status: ProjectStatus
    kind: ProjectKind
    venueId: string | null
    sourceCalendar: string | null
    phases: { id: string; name: string; start: string; end: string }[]
  }[]
  /** Event-days brought in before, from any calendar. */
  imported: { uid: string; day: string; title: string; projectId: string; calendarId: string }[]
}

export type VenueRef = { id: string; name: string } | { key: string; name: string; address: string }
export type PersonRef = { id: string } | { email: string }

/** One event on one day, as brought in, to be remembered. */
export interface EventDay {
  uid: string
  eventId: string
  day: string
  title: string
}

/** Someone on an invite on days gone who isn't a booking: noted on the phase, not offered (ADR 0037). */
export interface Noted {
  name: string
  days: string[]
  answer: 'none' | 'declined'
}

/** A phase's days in a row, and who is on them. */
export interface PlanRun {
  name: string
  days: string[]
  guessed: boolean
  /** Its own venue; null for the job's. */
  venue: VenueRef | null
  /** What the titles said after the phase word, who was on the invites but isn't crew, and the job sheet. */
  notes: string
  /** A phase of the job, just before or after these days, that they extend. */
  extend: { id: string; start: string; end: string } | null
  /** Answers on days to come, and a Yes on days gone; the rest of days gone is in `noted`. Empty for anything but a gig. */
  crew: { person: PersonRef; answers: Record<string, GuestResponse> }[]
  noted: Noted[]
  events: EventDay[]
}

export interface PlanJob {
  key: string
  name: string
  status: 'confirmed' | 'enquiry'
  kind: ProjectKind
  /** A job brought in before that these days are added to. */
  existing: { id: string; name: string; venueId: string | null } | null
  venue: VenueRef | null
  notes: string
  runs: PlanRun[]
  /** The events it is made of. */
  events: number
  /** Every day of those events, the ones it already has included, to remember as brought in. */
  seen: EventDay[]
}

export interface NewPerson {
  email: string
  name: string
  kind: 'freelancer' | 'staff'
  suggested: boolean
  /** Google had no name for them, so the name is made from their address. */
  needsName: boolean
  /** How many of the jobs they are on. */
  jobs: number
}

export interface Plan {
  /** Events read, cancelled ones aside. */
  events: number
  jobs: PlanJob[]
  people: NewPerson[]
  leftOut: ImportLeftOut[]
  changed: ImportChanged[]
  /**
   * The key of every job the calendar holds that isn't in the app yet, ticked
   * or not: what the import screen showed, read from the same plan rather
   * than planned again without the choices (audit, 20 October 2026, finding 18);
   * and of every job chosen that is one of them still, by its events
   * (audit, 20 October 2026, finding 52).
   */
  found: string[]
}

/** What the office chose on the import screen: names and kinds by job key, the jobs to bring in, and people's names by email. */
export interface Chosen {
  names: ReadonlyMap<string, string>
  kinds?: ReadonlyMap<string, ProjectKind>
  include: ReadonlySet<string>
  people?: ReadonlyMap<string, string>
}
