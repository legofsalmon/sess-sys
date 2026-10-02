import { daysLabel, eachDay, type Offer } from './crew.ts'
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
  /**
   * Crew are guests on the events of the jobs they are offered, and their
   * answers count (ADR 0009). Starts off; missing on connections synced
   * before invites existed, which means off.
   */
  invites?: boolean
}

/** A guest's answer in Google Calendar. `needsAction` is no answer yet; `tentative` is Maybe. */
export type GuestResponse = 'needsAction' | 'accepted' | 'declined' | 'tentative'

/** Someone the app has put on an event because of an offer (ADR 0009), and their answer there. */
export interface CalendarGuest {
  personId: string
  offerId: string
  response: GuestResponse
  /** An answer the app couldn't take, in words, such as the place having just been filled. */
  problem: string | null
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
  /** Crew invited to it, with their answers. Missing on days synced before invites existed. */
  guests?: CalendarGuest[]
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

/** GET /api/calendar/invites: what turning crew invites on would send straight away. */
export interface CalendarInvites {
  on: boolean
  /** Guest places on events from today on: one person on one day's event is one invite. */
  invites: number
  people: number
  /** Offered or booked, but with no email address in the app, so not invited. */
  noEmail: string[]
}

/** "12 invites to 5 people", "1 invite to 1 person". */
export const invitesLabel = (invites: number, people: number) =>
  `${invites} ${invites === 1 ? 'invite' : 'invites'} to ${people} ${people === 1 ? 'person' : 'people'}`

// Today in Ireland lives with the day itself; days before it are never changed on the calendar.
export { irishToday } from './day.ts'

/**
 * Where a phase stands with the calendar, for the job page:
 *
 * - `theirs`: the job was brought in from a calendar that keeps its events (ADR 0011);
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
  | { state: 'theirs'; calendar: string }
  | { state: 'on' | 'going'; calendar: string; days: number; link: string | null }
  | { state: 'failed'; calendar: string; problem: string; failed: number; days: number }

export function phaseOnCalendar(
  job: Pick<Project, 'name' | 'status' | 'sourceCalendar'>,
  phase: Pick<Phase, 'id' | 'name' | 'start' | 'end'>,
  link: CalendarLink | undefined,
  days: Readonly<Record<string, CalendarDay>>,
  today: string
): PhaseOnCalendar {
  if (job.sourceCalendar) return { state: 'theirs', calendar: job.sourceCalendar }
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

/** A person's answer for one day, from the events that day they are a guest on. */
export type DayAnswer = 'yes' | 'no' | 'maybe' | 'none'

/** Several events on one day (a call across phases): a No to any is a No, and a Yes needs all of them. */
export function dayAnswer(responses: readonly GuestResponse[]): DayAnswer {
  if (responses.includes('declined')) return 'no'
  if (responses.length > 0 && responses.every((r) => r === 'accepted')) return 'yes'
  if (responses.includes('tentative')) return 'maybe'
  return 'none'
}

/**
 * What a person's answers in Google Calendar do to their offer (ADR 0009),
 * as the answer to give for them, if any. `answers` holds each day they are
 * a guest on; `changed`, the days whose answer has just changed.
 *
 * A Yes to any day is a yes to the offer, for all its days but those they
 * said No to; a No to every day declines. Before the office confirms, a
 * later No drops that day and a later Yes adds it back. Confirmed bookings
 * and counter-offers are the office's to change, so nothing is done.
 */
export function answerFromCalendar(
  offer: Pick<Offer, 'status' | 'days'>,
  callDays: readonly string[],
  answers: Readonly<Record<string, DayAnswer>>,
  changed: readonly string[]
): { answer: 'accept'; days: string[] } | { answer: 'decline' } | undefined {
  const asked = Object.keys(answers)
  const no = asked.filter((d) => answers[d] === 'no')
  const sorted = (days: string[]) => [...new Set(days)].sort()
  if (offer.status === 'offered' || offer.status === 'declined') {
    // Once declined, only a new Yes opens it again, as answering again on the link would.
    const yes = offer.status === 'declined' ? changed.filter((d) => answers[d] === 'yes') : asked.filter((d) => answers[d] === 'yes')
    if (yes.length) return { answer: 'accept', days: sorted(callDays.filter((d) => !no.includes(d))) }
    if (offer.status === 'offered' && asked.length > 0 && no.length === asked.length) return { answer: 'decline' }
    return undefined
  }
  if (offer.status === 'accepted') {
    const dropped = changed.filter((d) => answers[d] === 'no' && offer.days.includes(d))
    const added = changed.filter((d) => answers[d] === 'yes' && !offer.days.includes(d))
    if (!dropped.length && !added.length) return undefined
    const days = sorted([...offer.days.filter((d) => !dropped.includes(d)), ...added])
    return days.length ? { answer: 'accept', days } : { answer: 'decline' }
  }
  return undefined
}

/** How one offer stands on Google Calendar, for the job page: the days its person is a guest on, and their answers. */
export interface OfferOnCalendar {
  answers: Record<string, DayAnswer>
  /** "Said yes on Google Calendar.", "On Google Calendar: yes to Mon 2 Mar; no answer yet for Tue 3 Mar." */
  line: string
  /** Something for the office to act on, in words. */
  warning: string | null
}

export function offerOnCalendar(
  offer: Pick<Offer, 'id' | 'status' | 'days'>,
  days: Readonly<Record<string, CalendarDay>>,
  today: string
): OfferOnCalendar | undefined {
  const byDay: Record<string, GuestResponse[]> = {}
  let problem: string | null = null
  for (const d of Object.values(days)) {
    if (d.day < today) continue
    for (const g of d.guests ?? []) {
      if (g.offerId !== offer.id) continue
      byDay[d.day] = [...(byDay[d.day] ?? []), g.response]
      problem ??= g.problem
    }
  }
  const invited = Object.keys(byDay).sort()
  if (invited.length === 0) return undefined
  const answers: Record<string, DayAnswer> = Object.fromEntries(invited.map((d) => [d, dayAnswer(byDay[d]!)]))
  const said = (a: DayAnswer) => invited.filter((d) => answers[d] === a)
  const [yes, no, maybe, none] = [said('yes'), said('no'), said('maybe'), said('none')]
  let line: string
  if (yes.length === invited.length) line = 'Said yes on Google Calendar.'
  else if (no.length === invited.length) line = 'Said no on Google Calendar.'
  else if (none.length === invited.length) line = 'Invited on Google Calendar; no answer yet.'
  else {
    const parts = [
      yes.length && `yes to ${daysLabel(yes)}`,
      no.length && `no to ${daysLabel(no)}`,
      maybe.length && `maybe to ${daysLabel(maybe)}`,
      none.length && `no answer yet for ${daysLabel(none)}`,
    ].filter(Boolean)
    line = `On Google Calendar: ${parts.join('; ')}.`
  }
  const bookedNo = offer.status === 'confirmed' ? no.filter((d) => offer.days.includes(d)) : []
  // A Yes the offer doesn't show, because the app couldn't take it: the reason stands until it does.
  const unmet = offer.status === 'accepted' || offer.status === 'confirmed' ? yes.filter((d) => !offer.days.includes(d)) : yes
  const warning = bookedNo.length
    ? `Said no to ${daysLabel(bookedNo)} on Google Calendar, but is booked for ${bookedNo.length === 1 ? 'it' : 'them'}. Call them to sort it out.`
    : unmet.length
      ? problem
      : null
  return { answers, line, warning }
}
