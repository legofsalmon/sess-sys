import { eachDay } from './crew.ts'
import { calendarTitles, type Phase, type Project } from './jobs.ts'

/**
 * Confirmed jobs on Google Calendar (ADR 0008). One Google account, connected
 * by a member of staff, writes every day of every phase of a confirmed job,
 * from today on, to one calendar. Devices see where the connection and each
 * day stand through the normal sync; the key Google gave the app never
 * leaves the server.
 */

export const CALENDAR_STATES = [
  /** Nothing connected. */
  'off',
  /** Connected, but no calendar picked yet: nothing is written. */
  'choosing',
  /** Writing confirmed jobs to the calendar. */
  'on',
  /** Disconnecting: taking the app's days off the calendar first. */
  'stopping',
  /** Google no longer accepts the app's key; someone has to connect again. */
  'reconnect',
] as const
export type CalendarState = (typeof CALENDAR_STATES)[number]

/** The connection, as devices see it. There is only ever one, with the id `main`. */
export interface CalendarLink {
  id: string
  state: CalendarState
  /** The Google account that writes the events. */
  account: string | null
  calendarId: string | null
  calendarName: string | null
  /** What is wrong, in words, while something is. */
  problem: string | null
  /** Who connected it, by name, and when. */
  connectedBy: string | null
  connectedAt: string | null
}

/** One day of a phase that the app has put on the calendar, or tried to. */
export interface CalendarDay {
  /** `<phase id>/<day>`, from `calendarDayId`. */
  id: string
  phaseId: string
  projectId: string
  day: string
  calendarId: string
  /** The event's title as last written, such as "Nissan - Build 1/2". */
  title: string
  /** On the calendar as last written, or the last write failed. */
  state: 'on' | 'failed'
  problem: string | null
  /** Opens the event in Google Calendar. */
  link: string | null
}

export interface CalendarEntities {
  calendarLink: CalendarLink
  calendarDay: CalendarDay
}
export const CALENDAR_ENTITY_NAMES = ['calendarLink', 'calendarDay'] as const

export const CALENDAR_LINK_ID = 'main'

export const calendarDayId = (phaseId: string, day: string) => `${phaseId}/${day}`

/** One calendar the connected account can change, for picking where jobs go. */
export interface CalendarChoice {
  id: string
  name: string
  primary: boolean
  access: 'owner' | 'writer'
}

/** POST /api/calendar/check: what one run of the sync did. */
export interface CalendarCheck {
  written: number
  removed: number
  failed: number
  /** What is wrong, in words, when something is. */
  problem?: string
}

/** Today in Ireland, YYYY-MM-DD: days before it are never changed on the calendar. */
export function irishToday(now = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' })
}

/**
 * Where a phase stands with the calendar, for the job page:
 *
 * - `waiting`: not going on yet, because the job isn't confirmed;
 * - `stopped`: the job is cancelled or lost, so it is off the calendar;
 * - `past`: every day has gone, and the calendar is left as it was;
 * - `unconnected`: it would go on, but no calendar is connected;
 * - `paused`: the calendar needs connecting again, so nothing is updated;
 * - `on`: every day from today is on the calendar, with its title as now;
 * - `going`: some are still on their way, or being updated;
 * - `failed`: some couldn't be written, with why.
 */
export type PhaseOnCalendar =
  | { state: 'waiting' | 'stopped' | 'past' | 'unconnected' | 'paused' }
  | { state: 'on' | 'going'; calendar: string; days: number; link: string | null }
  | { state: 'failed'; calendar: string; problem: string; failed: number; days: number }

export function phaseOnCalendar(
  job: Pick<Project, 'name' | 'status'>,
  phase: Pick<Phase, 'id' | 'name' | 'start' | 'end'>,
  link: CalendarLink | undefined,
  days: Readonly<Record<string, CalendarDay>>,
  today: string
): PhaseOnCalendar {
  if (job.status === 'cancelled' || job.status === 'lost') return { state: 'stopped' }
  if (job.status !== 'confirmed') return { state: 'waiting' }
  const all = eachDay(phase.start, phase.end)
  const titles = calendarTitles(job.name, phase)
  const ahead = all.map((day, i) => ({ day, title: titles[i]! })).filter((d) => d.day >= today)
  if (ahead.length === 0) return { state: 'past' }
  if (link?.state === 'reconnect') return { state: 'paused' }
  if (link?.state !== 'on' || !link.calendarId) return { state: 'unconnected' }
  const calendar = link.calendarName ?? 'the calendar'
  const written = ahead.map((d) => ({ want: d.title, got: days[calendarDayId(phase.id, d.day)] })).filter((d) => d.got?.calendarId === link.calendarId)
  const failed = written.filter((d) => d.got!.state === 'failed')
  if (failed.length)
    return { state: 'failed', calendar, problem: failed[0]!.got!.problem ?? 'Google turned it down.', failed: failed.length, days: ahead.length }
  const current = written.filter((d) => d.got!.title === d.want)
  if (current.length === ahead.length) return { state: 'on', calendar, days: ahead.length, link: current[0]!.got!.link }
  return { state: 'going', calendar, days: ahead.length, link: null }
}
