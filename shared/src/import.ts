/**
 * Bringing jobs in from Google Calendar (ADR 0011): what the import screen
 * shows before anything is saved, what the office chooses, and what came
 * in. The server reads the calendar and works it out; devices only show it.
 */

/** A calendar the connected account can see, to bring jobs in from. */
export interface ImportCalendar {
  id: string
  name: string
  primary: boolean
}

/** One phase of a job found on the calendar. */
export interface ImportPhase {
  name: string
  start: string
  end: string
  /** Its titles had no phase word, so Show is a guess. */
  guessed: boolean
  /** Its own venue, when it isn't the job's. */
  venue: string | null
  /** Its events had a job sheet, which goes into its notes. */
  sheet: boolean
  /** Adds days to one of the job's phases rather than being a phase of its own. */
  extends: boolean
}

/** A job found on the calendar, or days found for a job brought in before. */
export interface ImportJob {
  /** The same between looking and bringing in, whatever the job is renamed to. */
  key: string
  name: string
  /** Pencilled in (TBC, hold…), so it comes in as an enquiry; otherwise confirmed. */
  status: 'confirmed' | 'enquiry'
  /** A job brought in before that these days are added to. */
  adds: { id: string; name: string } | null
  phases: ImportPhase[]
  /** Its first and last day. */
  start: string
  end: string
  venue: { name: string; isNew: boolean } | null
  crew: { booked: number; waiting: number; declined: number; notInApp: number }
  /** The events it is made of. */
  events: number
}

/** Someone on the invites who isn't in the app yet. */
export interface ImportPerson {
  email: string
  name: string
  kind: 'freelancer' | 'staff'
  /** Ticked at first: their address looks like a person's own, not a supplier's or a client's. */
  suggested: boolean
  /** How many of the jobs found they are on. */
  jobs: number
}

/** Why events were left out. */
export const LEFT_OUT_REASONS = ['timed', 'repeating', 'special', 'long', 'untitled', 'ours', 'before', 'inApp', 'stopped'] as const
export type LeftOutReason = (typeof LEFT_OUT_REASONS)[number]

export interface ImportLeftOut {
  reason: LeftOutReason
  /** Events, or for `inApp` and `stopped` event-days. */
  count: number
  /** A few of their titles. */
  examples: string[]
}

/** An event brought in before that has since been deleted or moved in Google. */
export interface ImportChanged {
  jobId: string
  job: string
  /** Its title when it was brought in. */
  title: string
  /** The days it was brought in on. */
  was: string[]
  /** Its days now; empty when it was deleted. */
  now: string[]
}

/** POST /api/calendar/import/look */
export interface ImportPreview {
  calendar: ImportCalendar
  from: string
  to: string
  /** All-day events read. */
  events: number
  jobs: ImportJob[]
  people: ImportPerson[]
  leftOut: ImportLeftOut[]
  changed: ImportChanged[]
}

/** What the office chose: which jobs, under which names, and which people to add. */
export interface ImportChoices {
  calendarId: string
  from: string
  jobs: { key: string; name: string; include: boolean }[]
  people: { email: string; include: boolean }[]
}

/** POST /api/calendar/import/bring */
export interface ImportResult {
  /** New jobs. */
  jobs: number
  /** Jobs brought in before that got more days. */
  added: number
  /** Phase-days brought in. */
  days: number
  venues: number
  people: number
  /** Crew booked, offered or declined, one per person per phase. */
  crew: number
  /** Jobs chosen that weren't there when the calendar was read again, by name. */
  missing: string[]
}

/** Lowercase, without accents, punctuation or extra spaces: how job names are compared. */
export function nameKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * How many jobs the ticked ones come in as. A job renamed to another's
 * name comes in with it; two found with the same name stay apart (the
 * same party a year later), unless the office gave that name.
 */
export function jobsAfterNaming(jobs: readonly { name: string; newName: string }[]): number {
  const given = new Set<string>()
  let merged = 0
  for (const j of jobs) {
    if (j.newName === j.name) continue
    const key = nameKey(j.newName)
    if (given.has(key)) merged++
    else given.add(key)
  }
  for (const j of jobs) if (j.newName === j.name && given.has(nameKey(j.name))) merged++
  return jobs.length - merged
}

/** The first day to bring in from, by default: the first of the month three months back. */
export function importFromDefault(today: string): string {
  const [y, m] = today.split('-').map(Number) as [number, number]
  const back = new Date(Date.UTC(y, m - 1 - 3, 1))
  return back.toISOString().slice(0, 10)
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "4 timed events (meetings, calls)", for the list of what was left out. */
export function leftOutLabel({ reason, count }: Pick<ImportLeftOut, 'reason' | 'count'>): string {
  switch (reason) {
    case 'timed':
      return `${plural(count, 'event', 'events')} with a start time (meetings, calls)`
    case 'repeating':
      return `${plural(count, 'repeating event', 'repeating events')} (birthdays, reminders)`
    case 'special':
      return `${plural(count, 'out-of-office or other special event', 'out-of-office or other special events')}`
    case 'long':
      return `${plural(count, 'event', 'events')} longer than a month`
    case 'untitled':
      return `${plural(count, 'event', 'events')} with no title`
    case 'ours':
      return `${plural(count, 'event', 'events')} the app wrote itself`
    case 'before':
      return `${plural(count, 'event', 'events')} brought in before`
    case 'inApp':
      return `${plural(count, 'day', 'days')} already in the app`
    case 'stopped':
      return `${plural(count, 'day', 'days')} of jobs cancelled or lost in the app`
  }
}
