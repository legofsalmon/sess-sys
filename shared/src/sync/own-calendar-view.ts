import type { CommandArgs, Mutation } from '../commands.ts'
import { busyByDay, busyWarning, type OwnCalendar, type OwnCalendarEntities } from '../own-calendar.ts'

/**
 * Freelancers' own calendars (ADR 0044) as a device sees them: when each
 * person is busy, by day, with this device's own "stop reading it" laid
 * over what the server has said. Never the address, which the server
 * keeps to itself.
 */

export interface OwnCalendarView extends OwnCalendar {
  /** Stopped on this device, and not yet on the server. */
  stopping: boolean
}

export interface OwnCalendarsView {
  /** A person's own calendar, while it's being read. */
  of(personId: string): OwnCalendarView | undefined
  /** The days a person is busy in their own calendar, with what in words, for the days asked about or all of them. */
  busyOn(personId: string, days?: readonly string[]): Map<string, string>
  /** What to say before offering someone days they're busy in their own calendar, or null. */
  warning(personId: string, days: readonly string[]): string | null
}

type Tables = { [E in keyof OwnCalendarEntities]: Record<string, OwnCalendarEntities[E]> }

export function ownCalendarsView(entities: Partial<Tables>, outbox: readonly (Mutation & { appliedSeq?: number })[], cursor: number): OwnCalendarsView {
  const byPerson = new Map<string, OwnCalendarView>()
  // Snapshots saved before own calendars existed have no table for them.
  for (const c of Object.values(entities.ownCalendar ?? {})) byPerson.set(c.personId, { ...c, stopping: false })
  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    if (m.name !== 'ownCalendar.stop') continue
    const a = m.args as CommandArgs<'ownCalendar.stop'>
    const c = byPerson.get(a.personId)
    // Shown stopped at once: its busy times no longer count, though the server still has to hear.
    if (c) byPerson.set(c.personId, { ...c, busy: [], stopping: true })
  }
  const of = (personId: string) => byPerson.get(personId)
  return {
    of,
    busyOn: (personId, days) => busyByDay(of(personId), days),
    warning: (personId, days) => busyWarning(of(personId), days),
  }
}
