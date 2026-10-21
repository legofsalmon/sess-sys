import { z } from 'zod'
import { dayLabel, eachDay, somethingToChange } from './crew.ts'
import { day } from './day.ts'
import { needed, text } from './plain.ts'

/**
 * Jobs (ADR 0007): who a job is for, where it is, and its phases. The code
 * calls a job a project, as the architecture does; the app says "job".
 *
 * A job is made of phases (Prep, Build, Show, Load out…), each one or more
 * whole days in Irish time. A phase-day is what is a calendar event today,
 * titled "<Job> - <Phase> n/m", so this is the shape the calendar sync writes.
 */

const id = z.string().min(1).max(64)
const phone = z.string().regex(/^\+?[0-9 ()-]{6,40}$/, 'Phone numbers need digits only, ideally starting with +353.')

export const contact = z.object({
  name: needed(200, "The contact's name", "A contact's name"),
  /** Such as "Producer" or "Accounts". */
  role: text(100, "The contact's role"),
  email: z.string().email("That email address doesn't look right.").max(200, 'The email address can be up to 200 characters.').nullable(),
  phone: phone.nullable(),
})
export type Contact = z.infer<typeof contact>

export const client = z.object({
  id,
  name: needed(200, "The client's name", "The client's name"),
  contacts: z.array(contact).max(20, 'Up to 20 contacts, please.'),
  notes: text(2000, 'The notes'),
})
export type Client = z.infer<typeof client>

export const venue = z.object({
  id,
  name: needed(200, "The venue's name", "The venue's name"),
  /** As typed; an Eircode in it makes the map link exact. */
  address: text(500, 'The address'),
  /** Access, load-in, power, parking. */
  notes: text(4000, 'The notes'),
})
/** Where a venue is on the map (ADR 0057), in degrees as GPS gives them. */
export const pin = z.object({
  lat: z.number().min(-90, "That isn't a place on the map.").max(90, "That isn't a place on the map."),
  lng: z.number().min(-180, "That isn't a place on the map.").max(180, "That isn't a place on the map."),
})
export type Pin = z.infer<typeof pin>

/**
 * A venue as the server holds it. Its pin is set on its own (`venue.pin`),
 * never by saving the venue's details, so an older device saving a venue
 * leaves it where it is. Null until someone puts it on the map; missing
 * from copies made before maps.
 */
export type Venue = z.infer<typeof venue> & { pin?: Pin | null }

/**
 * What people decide about a job. What the system can see for itself (on
 * now, kit out, invoiced) comes from dates, scans and invoices instead.
 */
export const PROJECT_STATUSES = ['enquiry', 'quoted', 'confirmed', 'cancelled', 'lost'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  enquiry: 'Enquiry',
  quoted: 'Quoted',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  lost: 'Lost',
}

/** A job that isn't going ahead. Its crew calls are cancelled with it. */
export const STOPPED: readonly ProjectStatus[] = ['cancelled', 'lost']

/**
 * What kind of job it is (ADR 0037): a gig needs crew and kit on days; a
 * dry hire is kit going out with no crew; an errand is a van run or a
 * collection; a meeting is people and no kit. A job with no kind is a gig,
 * so jobs saved before kinds existed read as they were.
 */
export const PROJECT_KINDS = ['gig', 'hire', 'errand', 'meeting'] as const
export type ProjectKind = (typeof PROJECT_KINDS)[number]

export const KIND_LABELS: Record<ProjectKind, string> = {
  gig: 'Gig',
  hire: 'Dry hire',
  errand: 'Errand',
  meeting: 'Meeting',
}

/** The phase a day of each kind of job is when nothing says which (ADR 0037): a gig's is a Show. */
export const KIND_PHASE: Record<ProjectKind, string> = { gig: 'Show', hire: 'Hire', errand: 'Errand', meeting: 'Meeting' }

/** A job's kind, a gig when it doesn't say. */
export const kindOf = (p: { kind?: ProjectKind }): ProjectKind => p.kind ?? 'gig'

/**
 * Getting a job's kit ready and checking it back in (ADR 0031): the whole
 * days before its kit is needed that it's held for the job too, and after.
 */
export const DEFAULT_PREP_DAYS = 1
export const DEFAULT_RETURN_DAYS = 1
export const MAX_KIT_DAYS = 14
const kitDays = z
  .number()
  .int('Whole days, please.')
  .min(0, "Days can't be fewer than none.")
  .max(MAX_KIT_DAYS, `Up to ${MAX_KIT_DAYS} days, please.`)

export const project = z.object({
  id,
  name: needed(200, "The job's name", "The job's name"),
  clientId: id.nullable(),
  /** Where most of it happens; a phase can have its own. */
  venueId: id.nullable(),
  status: z.enum(PROJECT_STATUSES),
  /** Missing means a gig (ADR 0037). */
  kind: z.enum(PROJECT_KINDS).optional(),
  notes: text(4000, 'The notes'),
  /** Days its kit is held before it's needed, to get it ready; missing means the usual one (ADR 0031). */
  prepDays: kitDays.optional(),
  /** Days its kit is held after, to come back and be checked in; missing means the usual one. */
  returnDays: kitDays.optional(),
})

/** A job's days for getting kit ready and checking it back, the usual ones when it doesn't say. */
export const kitDaysOf = (p: { prepDays?: number; returnDays?: number }) => ({
  prep: p.prepDays ?? DEFAULT_PREP_DAYS,
  back: p.returnDays ?? DEFAULT_RETURN_DAYS,
})
export type Project = z.infer<typeof project> & {
  /**
   * Brought in from this Google calendar (ADR 0011), which keeps its events,
   * so the app doesn't write it to the jobs calendar. Only the server sets it.
   */
  sourceCalendar?: string
}

/** The usual phases, in the order they happen. Any other name can be typed. */
export const PHASE_NAMES = ['Prep', 'Load in', 'Build', 'Rehearsal', 'Show', 'Babysit', 'Load out'] as const

/** Longer than this is more likely a typing slip than a phase. */
export const MAX_PHASE_DAYS = 366

/** More local crew than this on one phase is more likely a typing slip. */
export const MAX_LOCAL_CREW = 999

/** How many crew the venue or client brings on a phase: a count, nobody booked through the app. */
const localCrew = z.number().int('Local crew is a whole number.').min(0, "Local crew can't be less than none.").max(MAX_LOCAL_CREW, `Local crew can be at most ${MAX_LOCAL_CREW}.`)

export const phase = z.object({
  id,
  projectId: id,
  name: needed(100, "The phase's name", "The phase's name"),
  start: day,
  end: day,
  /** Null: the job's venue. */
  venueId: id.nullable(),
  notes: text(2000, 'The notes'),
  /**
   * Who crew ring on the day (ADR 0021): a person, whose name and number go
   * on the phase's call sheet for everyone on it. Missing on phases saved
   * before call sheets, and from older versions of the app.
   */
  contactId: id.nullable().optional(),
  /** Crew found locally, by the venue or the client: just how many. Missing from older versions of the app means none. */
  localCrew: localCrew.optional(),
})
export type Phase = z.infer<typeof phase>

export interface JobEntities {
  client: Client
  venue: Venue
  project: Project
  phase: Phase
}
export const JOB_ENTITY_NAMES = ['client', 'venue', 'project', 'phase'] as const

const phaseDays = (p: { start: string; end: string }) => (Date.parse(p.end) - Date.parse(p.start)) / 86_400_000 + 1
const phaseFits = [
  (p: { start?: string; end?: string }) => !p.start || !p.end || p.start <= p.end,
  { message: 'The phase ends before it starts.' },
] as const
const phaseNotTooLong = [
  (p: { start?: string; end?: string }) => !p.start || !p.end || phaseDays({ start: p.start, end: p.end }) <= MAX_PHASE_DAYS,
  { message: `A phase can be at most ${MAX_PHASE_DAYS} days.` },
] as const

export const jobCommandSchemas = {
  /** Saved whole, like a person: clients are edited rarely. */
  'client.upsert': client,
  'venue.upsert': venue,
  /** Put a venue on the map, move its pin, or (null) take it off (ADR 0057). */
  'venue.pin': z.object({ id, pin: pin.nullable() }),
  'project.create': project,
  /**
   * Only the fields the person changed, so two people changing different
   * things about a job both keep theirs. Stopping a job (cancelled, lost)
   * cancels its crew calls too.
   */
  'project.update': z
    .object({
      id,
      name: project.shape.name.optional(),
      clientId: project.shape.clientId.optional(),
      venueId: project.shape.venueId.optional(),
      status: project.shape.status.optional(),
      kind: z.enum(PROJECT_KINDS).optional(),
      notes: project.shape.notes.optional(),
      prepDays: kitDays.optional(),
      returnDays: kitDays.optional(),
    })
    .refine(...somethingToChange),
  'phase.add': phase.refine(...phaseFits).refine(...phaseNotTooLong),
  /**
   * Field by field, as for jobs. Its crew keep their own dates unless the
   * dates change with `moveCrew`: then its open calls, and the days their
   * offers hold, move by the same shift as the phase's start.
   */
  'phase.update': z
    .object({
      id,
      name: phase.shape.name.optional(),
      start: day.optional(),
      end: day.optional(),
      venueId: phase.shape.venueId.optional(),
      notes: phase.shape.notes.optional(),
      contactId: phase.shape.contactId,
      localCrew: localCrew.optional(),
      moveCrew: z.boolean().optional(),
    })
    .refine(...somethingToChange)
    // Saying whether to move the crew isn't a change on its own.
    .refine((u: Record<string, unknown>) => Object.keys(u).some((k) => k !== 'id' && k !== 'moveCrew' && u[k] !== undefined), { message: 'Nothing to change.' })
    .refine(...phaseFits)
    .refine(...phaseNotTooLong),
  /** Refused while the phase has crew; cancel them first. */
  'phase.remove': z.object({ id }),
  /**
   * Several jobs made one (ADR 0050), for a job a calendar brought in as
   * several ("EP - LX", "EP - Audio"): the others' phases, crew, kit, vans,
   * faults and movements become this job's, each phase named for what its
   * job's name said ("LX", "Audio"), and the others are gone. Refused when
   * jobs made in the app and jobs brought in are mixed, or more than one
   * has a quote.
   */
  'project.merge': z
    .object({ id, from: z.array(id).min(1, 'Pick at least one job to join it.').max(100, 'Up to 100 jobs at a time, please.'), name: project.shape.name })
    .refine((m) => !m.from.includes(m.id) && new Set(m.from).size === m.from.length, { message: 'Each job can be joined once.' }),
} as const

/** "The Heritage, Killenard": the name and the first line of the address, for crew calls and the calendar. */
export function venueLabel(v: Pick<Venue, 'name' | 'address'>): string {
  const first = v.address.split(/\r?\n/)[0]!.trim()
  const label = first && !first.toLowerCase().startsWith(v.name.toLowerCase()) ? `${v.name}, ${first}` : first || v.name
  // As long as a crew call's venue can be.
  return label.length > 300 ? `${label.slice(0, 299)}…` : label
}

/** A map search for the venue; an Eircode in the address makes it exact, and its pin more so. */
export function mapLink(v: Pick<Venue, 'name' | 'address' | 'pin'>): string {
  if (v.pin) return `https://www.google.com/maps/search/?api=1&query=${v.pin.lat},${v.pin.lng}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([v.name, v.address.replace(/\s*\r?\n\s*/g, ', ')].filter(Boolean).join(', '))}`
}

/** Directions to a pin, in whatever maps app the phone opens Google's links with. */
export const directionsLink = (p: Pin) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`

/** An Eircode ("R32 PW10"), which the open map data mostly doesn't know: searches drop it and try again. */
const EIRCODE = /\b(?:[AC-FHKNPRTV-Y]\d{2}|D6W)\s?[0-9AC-FHKNPRTV-Y]{4}\b/gi

/**
 * What to search the map for to find a venue (ADR 0057), best first: its
 * name and address together, the address alone, then the address without
 * its Eircode, then the name alone. Many venues came in from calendar
 * titles with a name and no address, so the name on its own is the last
 * try. Each is said once.
 */
export function pinSearches(v: Pick<Venue, 'name' | 'address'>): string[] {
  const lines = v.address
    .split(/\r?\n|,/)
    .map((l) => l.trim())
    .filter(Boolean)
  const name = v.name.trim()
  // An address that starts with the venue's name says it once.
  const rest = lines.length && lines[0]!.toLowerCase() === name.toLowerCase() ? lines.slice(1) : lines
  const address = rest.join(', ')
  const bare = rest
    .map((l) => l.replace(EIRCODE, '').trim())
    .filter(Boolean)
    .join(', ')
  const all = [[name, address].filter(Boolean).join(', '), address, bare, name].filter((q) => q.length >= 3)
  return [...new Set(all)]
}

/**
 * A pin typed or pasted rather than searched for: "53.1336, -7.1512", or a
 * Google Maps or OpenStreetMap link to a place ("…/@53.1336,-7.1512,17z",
 * "…?q=53.1336,-7.1512", "#map=17/53.1336/-7.1512"). Undefined for
 * anything else, which is then searched for as words.
 */
export function pinFromText(text: string): Pin | undefined {
  const t = text.trim()
  const pairs = [
    /^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/,
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query|destination|ll|mlat)=(-?\d{1,2}\.\d+)(?:,|%2C|&mlon=)(-?\d{1,3}\.\d+)/i,
    /#map=\d+\/(-?\d{1,2}\.\d+)\/(-?\d{1,3}\.\d+)/,
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
  ]
  for (const re of pairs) {
    const m = t.match(re)
    if (!m) continue
    const found = pin.safeParse({ lat: Number(m[1]), lng: Number(m[2]) })
    if (found.success) return found.data
  }
  return undefined
}

/** One place a search found, for someone to pick: what the map calls it, and where. */
export interface FoundPlace extends Pin {
  label: string
}

/** What looking for a venue on the map found (GET /api/places). */
export interface PlacesFound {
  /** Up to five places, best first. */
  found: FoundPlace[]
  /** What was searched for to find them; undefined when nothing was. */
  searched?: string
}

/** The title each day of a phase has on the calendar, as crew know it: "Nissan - Build 1/2". */
export function calendarTitles(job: string, p: Pick<Phase, 'name' | 'start' | 'end'>): string[] {
  const days = eachDay(p.start, p.end)
  return days.map((_, i) => `${job} - ${p.name}${days.length > 1 ? ` ${i + 1}/${days.length}` : ''}`)
}

/** A job's first and last day, from its phases; undefined while it has none. */
export function jobSpan(phases: readonly Pick<Phase, 'start' | 'end'>[]): { start: string; end: string } | undefined {
  if (phases.length === 0) return undefined
  let start = phases[0]!.start
  let end = phases[0]!.end
  for (const p of phases) {
    if (p.start < start) start = p.start
    if (p.end > end) end = p.end
  }
  return { start, end }
}

/** "Fri 3 Oct", or "Fri 3 Oct to Sun 5 Oct". */
export function spanLabel(s: { start: string; end: string }): string {
  return s.start === s.end ? dayLabel(s.start) : `${dayLabel(s.start)} to ${dayLabel(s.end)}`
}

/**
 * A job's phases by name, a name used more than once said once with how
 * often (audit of 16 October, finding 9): "Build, Show 3 times, Load out"
 * for a residency rather than "Show, Show, Show".
 */
export function phaseNames(phases: readonly Pick<Phase, 'name'>[]): string {
  const counts = new Map<string, number>()
  for (const p of phases) counts.set(p.name, (counts.get(p.name) ?? 0) + 1)
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ${n} times` : name)).join(', ')
}

/** Phases in the order they happen; phases starting the same day keep the order they were added in. */
export function byWhen(a: Pick<Phase, 'id' | 'start' | 'end'>, b: Pick<Phase, 'id' | 'start' | 'end'>): number {
  return a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.id.localeCompare(b.id)
}
