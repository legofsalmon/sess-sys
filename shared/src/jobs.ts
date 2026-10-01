import { z } from 'zod'
import { dayLabel, eachDay } from './crew.ts'
import { day } from './day.ts'

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
  name: z.string().min(1).max(200),
  /** Such as "Producer" or "Accounts". */
  role: z.string().max(100),
  email: z.string().email().max(200).nullable(),
  phone: phone.nullable(),
})
export type Contact = z.infer<typeof contact>

export const client = z.object({
  id,
  name: z.string().min(1).max(200),
  contacts: z.array(contact).max(20),
  notes: z.string().max(2000),
})
export type Client = z.infer<typeof client>

export const venue = z.object({
  id,
  name: z.string().min(1).max(200),
  /** As typed; an Eircode in it makes the map link exact. */
  address: z.string().max(500),
  /** Access, load-in, power, parking. */
  notes: z.string().max(4000),
})
export type Venue = z.infer<typeof venue>

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

export const project = z.object({
  id,
  name: z.string().min(1).max(200),
  clientId: id.nullable(),
  /** Where most of it happens; a phase can have its own. */
  venueId: id.nullable(),
  status: z.enum(PROJECT_STATUSES),
  notes: z.string().max(4000),
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

export const phase = z.object({
  id,
  projectId: id,
  name: z.string().min(1).max(100),
  start: day,
  end: day,
  /** Null: the job's venue. */
  venueId: id.nullable(),
  notes: z.string().max(2000),
  /**
   * Who crew ring on the day (ADR 0021): a person, whose name and number go
   * on the phase's call sheet for everyone on it. Missing on phases saved
   * before call sheets, and from older versions of the app.
   */
  contactId: id.nullable().optional(),
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
const somethingToChange = [(u: Record<string, unknown>) => Object.keys(u).some((k) => k !== 'id' && u[k] !== undefined), { message: 'Nothing to change.' }] as const

export const jobCommandSchemas = {
  /** Saved whole, like a person: clients are edited rarely. */
  'client.upsert': client,
  'venue.upsert': venue,
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
      notes: project.shape.notes.optional(),
    })
    .refine(...somethingToChange),
  'phase.add': phase.refine(...phaseFits).refine(...phaseNotTooLong),
  /** Field by field, as for jobs. Its crew keep their own dates. */
  'phase.update': z
    .object({
      id,
      name: phase.shape.name.optional(),
      start: day.optional(),
      end: day.optional(),
      venueId: phase.shape.venueId.optional(),
      notes: phase.shape.notes.optional(),
      contactId: phase.shape.contactId,
    })
    .refine(...somethingToChange)
    .refine(...phaseFits)
    .refine(...phaseNotTooLong),
  /** Refused while the phase has crew; cancel them first. */
  'phase.remove': z.object({ id }),
} as const

/** "The Heritage, Killenard": the name and the first line of the address, for crew calls and the calendar. */
export function venueLabel(v: Pick<Venue, 'name' | 'address'>): string {
  const first = v.address.split(/\r?\n/)[0]!.trim()
  const label = first && !first.toLowerCase().startsWith(v.name.toLowerCase()) ? `${v.name}, ${first}` : first || v.name
  // As long as a crew call's venue can be.
  return label.length > 300 ? `${label.slice(0, 299)}…` : label
}

/** A map search for the venue; an Eircode in the address makes it exact. */
export function mapLink(v: Pick<Venue, 'name' | 'address'>): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([v.name, v.address.replace(/\s*\r?\n\s*/g, ', ')].filter(Boolean).join(', '))}`
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

/** Phases in the order they happen; phases starting the same day keep the order they were added in. */
export function byWhen(a: Pick<Phase, 'id' | 'start' | 'end'>, b: Pick<Phase, 'id' | 'start' | 'end'>): number {
  return a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.id.localeCompare(b.id)
}
