import { eachDay, firstName, HOLDING, OPEN } from '../crew.ts'
import { publicHolidaysAmong } from '../holidays.ts'
import { STOPPED, type ProjectStatus } from '../jobs.ts'
import { lateLine } from '../late.ts'
import type { CallView, CrewView, PersonView } from './crew-view.ts'
import type { JobsView } from './jobs-view.ts'
import type { LateView } from './late-view.ts'

/**
 * The planner (ADR 0010): a week or a month laid out by job and by person,
 * with clashes flagged. Worked out on the device from what it already
 * holds, so it works with no signal like the rest of the app.
 */

// Lives in day.ts now, where the schemas can reach it without a cycle; still offered here, where it began.
export { isDay } from '../day.ts'

/** The day `n` days after `day`, or before it for a negative `n`. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The Monday of the week `day` is in: weeks run Monday to Sunday, as in Ireland. */
export function mondayOf(day: string): string {
  return addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7))
}

/** Monday to Sunday of the week `day` is in. */
export function weekOf(day: string): string[] {
  const monday = mondayOf(day)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/** The first of the month `n` months after the one `day` is in. */
export function addMonths(day: string, n: number): string {
  const d = new Date(`${day.slice(0, 7)}-01T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

/** Every day of the month `day` is in. */
export function monthOf(day: string): string[] {
  return eachDay(addMonths(day, 0), addDays(addMonths(day, 1), -1))
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "October 2026". */
export function monthLabel(day: string): string {
  return `${MONTH_NAMES[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`
}

/** One day of a job's row. */
export interface JobCell {
  /** The phases on this day, as the calendar titles them ("Build 1/2"); usually one. */
  phases: { name: string; label: string }[]
  /** People the day's crew calls need, and how many of them are booked. */
  needed: number
  booked: number
  /** Offers for the day still waiting on an answer. */
  asked: number
  /** Crew asked for on a day their phase no longer covers: the phase moved and the crew didn't. */
  stray: boolean
  /** Who said they're running late that day (ADR 0028): "Gráinne: about 30 minutes late". Only there when someone did. */
  late?: string[]
}

export interface JobLane {
  key: string
  /** Null for crew asked for outside Jobs, which get a row by the name typed. */
  jobId: string | null
  name: string
  status: ProjectStatus | null
  /** An enquiry or a quote: pencilled in. */
  tentative: boolean
  /** Changed on this device and not yet on the server. */
  pending: boolean
  /** Only the days with something on. */
  days: Record<string, JobCell>
}

/** Where a person is on one day, for one crew call. */
export interface PersonWork {
  callId: string
  jobId: string | null
  job: string
  phase: string
  role: string
  /** Accepted or confirmed; otherwise offered and not yet answered. */
  booked: boolean
  /** Confirmed by the office: booked for real, not just accepted. */
  confirmed: boolean
  /** What they said on their link about being late that day (ADR 0028), when they did. */
  late?: string
}

export type Severity = 'clash' | 'check'

/** One day of a person's row. */
export interface PersonCell {
  work: PersonWork[]
  /** Marked unavailable: the note, empty if none; null when not. */
  away: string | null
  /** What needs sorting out, in words; null when nothing does. */
  problem: string | null
  /** A clash is booked twice, or booked while marked unavailable; a check is an offer that would clash if they said yes. */
  severity: Severity | null
}

export interface PersonLane {
  person: PersonView
  /** Only the days with something on. */
  days: Record<string, PersonCell>
}

export interface PlanProblem {
  person: PersonView
  day: string
  text: string
  severity: Severity
  /** The job to open to sort it out, when there is one. */
  jobId: string | null
}

export interface Plan {
  days: string[]
  /** Rows by job, in the order their first day comes. */
  jobs: JobLane[]
  /** A row for every person, busy or not, by name. */
  people: PersonLane[]
  /** Clashes first, then checks, each by day. */
  problems: PlanProblem[]
  /** Job-days with fewer crew booked than needed. */
  short: number
  /** The public holidays among the days, by day (ADR 0024): shown as a band, never counted as leave. */
  holidays: Record<string, string>
}

export function plan(view: { jobs: JobsView; crew: CrewView; late?: LateView }, days: readonly string[]): Plan {
  const range = new Set(days)
  const calls = view.crew.calls.filter((c) => c.status === 'open')
  /** What a booking's person said about being late on a day, in the line the office reads. */
  const lateOn = (offerId: string, day: string) => {
    const l = view.late?.forOffer(offerId).find((x) => x.day === day)
    return l && lateLine(l)
  }

  const lanes = new Map<string, JobLane>()
  const cell = (lane: JobLane, day: string) => (lane.days[day] ??= { phases: [], needed: 0, booked: 0, asked: 0, stray: false })
  const addCrew = (lane: JobLane, c: CallView, phaseDays?: ReadonlySet<string>) => {
    for (const d of c.days) {
      if (!range.has(d)) continue
      const x = cell(lane, d)
      x.needed += c.needed
      x.booked += Math.min(c.needed, c.heldByDay[d] ?? 0)
      x.asked += c.offers.filter((o) => OPEN.includes(o.status) && o.days.includes(d)).length
      if (phaseDays && !phaseDays.has(d)) x.stray = true
      for (const o of c.offers) {
        const late = HOLDING.includes(o.status) && lateOn(o.id, d)
        if (late) (x.late ??= []).push(`${o.person ? firstName(o.person) : 'Someone'}: ${late}`)
      }
    }
  }

  for (const job of view.jobs.jobs) {
    if (STOPPED.includes(job.status)) continue
    const lane: JobLane = {
      key: job.id,
      jobId: job.id,
      name: job.name,
      status: job.status,
      tentative: job.status !== 'confirmed',
      pending: job.pending || job.phases.some((p) => p.pending),
      days: {},
    }
    const phaseDays = new Map<string, Set<string>>()
    for (const ph of job.phases) {
      const all = eachDay(ph.start, ph.end)
      phaseDays.set(ph.id, new Set(all))
      all.forEach((d, i) => {
        if (range.has(d)) cell(lane, d).phases.push({ name: ph.name, label: all.length > 1 ? `${ph.name} ${i + 1}/${all.length}` : ph.name })
      })
    }
    for (const c of job.calls) if (c.status === 'open') addCrew(lane, c, c.phaseId ? phaseDays.get(c.phaseId) : undefined)
    if (Object.keys(lane.days).length) lanes.set(lane.key, lane)
  }

  // Crew asked for outside Jobs: a row per name as typed, the phase (or else the role) on each of its days.
  const jobIds = new Set(view.jobs.jobs.map((j) => j.id))
  for (const c of calls) {
    if (c.projectId && jobIds.has(c.projectId)) continue
    const key = `call:${c.project.trim().toLowerCase()}`
    const lane = lanes.get(key) ?? { key, jobId: null, name: c.project, status: null, tentative: false, pending: false, days: {} }
    const label = c.phase || c.role
    for (const d of c.days) {
      if (!range.has(d)) continue
      const x = cell(lane, d)
      if (!x.phases.some((p) => p.label === label)) x.phases.push({ name: label, label })
    }
    addCrew(lane, c)
    lane.pending ||= c.pending
    if (Object.keys(lane.days).length) lanes.set(key, lane)
  }

  const first = (days: object) => Object.keys(days).sort()[0] ?? ''
  const jobs = [...lanes.values()].sort((a, b) => first(a.days).localeCompare(first(b.days)) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key))

  // Archived people have left: no lane, even with "Show everyone".
  const people = view.crew.people.filter((p) => !p.archived).map((person): PersonLane => ({ person, days: {} }))
  const byId = new Map(people.map((l) => [l.person.id, l]))
  const at = (lane: PersonLane, day: string) => (lane.days[day] ??= { work: [], away: null, problem: null, severity: null })
  for (const c of calls) {
    for (const o of c.offers) {
      const booked = HOLDING.includes(o.status)
      const lane = byId.get(o.personId)
      if (!lane || (!booked && !OPEN.includes(o.status))) continue
      for (const d of o.days) {
        if (!range.has(d)) continue
        const late = booked && lateOn(o.id, d)
        at(lane, d).work.push({ callId: c.id, jobId: c.projectId, job: c.project, phase: c.phase, role: c.role, booked, confirmed: o.status === 'confirmed', ...(late ? { late } : {}) })
      }
    }
  }
  for (const u of view.crew.unavailability) {
    const lane = byId.get(u.personId)
    if (!lane) continue
    for (const d of days) {
      if (d < u.start || d > u.end) continue
      const x = at(lane, d)
      x.away = x.away === null ? u.note : [x.away, u.note].filter(Boolean).join('; ')
    }
  }

  const problems: PlanProblem[] = []
  for (const lane of people) {
    for (const [day, x] of Object.entries(lane.days)) {
      const booked = x.work.filter((w) => w.booked)
      const asked = x.work.filter((w) => !w.booked)
      const why = x.away ? ` (${x.away})` : ''
      if (booked.length > 1) {
        const names = unique(booked.map((w) => w.job))
        x.severity = 'clash'
        x.problem = names.length === 1 ? `Booked twice on ${names[0]}` : `Booked on ${list(names)}`
      } else if (booked.length === 1 && x.away !== null) {
        x.severity = 'clash'
        x.problem = `Booked on ${booked[0]!.job} but marked unavailable${why}`
      } else if (asked.length && (booked.length || x.away !== null)) {
        x.severity = 'check'
        x.problem = `Offered ${list(unique(asked.map((w) => w.job)))} ${booked.length ? `while booked on ${booked[0]!.job}` : `but marked unavailable${why}`}`
      }
      if (x.problem && x.severity)
        problems.push({
          person: lane.person,
          day,
          text: x.problem,
          severity: x.severity,
          jobId: (x.severity === 'check' ? asked[0] : booked[0])?.jobId ?? null,
        })
    }
  }
  problems.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'clash' ? -1 : 1) ||
      a.day.localeCompare(b.day) ||
      a.person.name.localeCompare(b.person.name) ||
      a.person.id.localeCompare(b.person.id)
  )

  let short = 0
  for (const lane of jobs) for (const x of Object.values(lane.days)) if (x.booked < x.needed) short++

  return { days: [...days], jobs, people, problems, short, holidays: publicHolidaysAmong(days) }
}

function unique(names: string[]): string[] {
  return [...new Set(names)]
}

/** "A", "A and B", "A, B and C". */
function list(names: string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** A phase in two or three letters, for a month's narrow columns: "Bu" for Build, "In" and "Out" for the loads. */
export function phaseCode(name: string): string {
  const n = name.trim().toLowerCase()
  if (n.startsWith('load in')) return 'In'
  if (n.startsWith('load out')) return 'Out'
  const word = name.trim().split(/\s+/)[0] ?? ''
  return word.slice(0, 1).toUpperCase() + word.slice(1, 2).toLowerCase()
}

/** A job's initials, for a person's row in a month: "WS" for Web Summit. */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
  return (
    words
      .slice(0, 2)
      .map((w) => [...w.replace(/^[^\p{L}\p{N}]+/u, '')][0] ?? '')
      .join('')
      .toUpperCase() || '•'
  )
}
