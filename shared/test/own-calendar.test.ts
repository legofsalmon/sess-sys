import { describe, expect, it } from 'vitest'
import type { Mutation } from '../src/commands.ts'
import type { Person } from '../src/crew.ts'
import { ADDRESS_WORDS, busyByDay, busyDaysOf, busyWarning, busyWords, MAX_ADDRESS_LENGTH, tidyCalendarAddress, type OwnCalendar } from '../src/own-calendar.ts'
import { crewView } from '../src/sync/crew-view.ts'
import { jobsView } from '../src/sync/jobs-view.ts'
import { ownCalendarsView } from '../src/sync/own-calendar-view.ts'
import { plan, weekOf } from '../src/sync/plan.ts'

/**
 * Freelancers' own calendars on a device (ADR 0044): an address pasted
 * tidied or refused in words, busy times said by Irish day and clock
 * (across midnight and the clocks going back), the warning before an
 * offer, "stop reading it" shown at once, and the planner showing busy
 * days as busy, never as a clash.
 */

const at = (iso: string) => new Date(iso).toISOString()

describe('an address someone pasted', () => {
  it('is tidied, with webcal read as https, or refused in words', () => {
    expect(tidyCalendarAddress('  webcal://p52-caldav.icloud.com/published/2/abc  ')).toEqual({ address: 'https://p52-caldav.icloud.com/published/2/abc' })
    expect(tidyCalendarAddress('https://calendar.google.com/calendar/ical/a%40gmail.com/private-x/basic.ics')).toEqual({
      address: 'https://calendar.google.com/calendar/ical/a%40gmail.com/private-x/basic.ics',
    })
    expect(tidyCalendarAddress('')).toEqual({ reason: ADDRESS_WORDS.empty })
    expect(tidyCalendarAddress('my calendar')).toEqual({ reason: ADDRESS_WORDS.notAnAddress })
    expect(tidyCalendarAddress('http://outlook.office365.com/owa/calendar/x/reachcalendar.ics')).toEqual({ reason: ADDRESS_WORDS.notSecure })
    expect(tidyCalendarAddress('javascript:alert(1)')).toEqual({ reason: ADDRESS_WORDS.notAnAddress })
    expect(tidyCalendarAddress('https://me:pw@cal.example.com/a.ics')).toEqual({ reason: ADDRESS_WORDS.notAnAddress })
    expect(tidyCalendarAddress(`https://cal.example.com/${'x'.repeat(MAX_ADDRESS_LENGTH)}`)).toEqual({ reason: ADDRESS_WORDS.tooLong })
  })
})

describe('busy times in words', () => {
  it('says each Irish day a time touches, across midnight and in summer and winter time', () => {
    // 22:00 Friday to 02:00 Saturday, Irish summer time.
    const late = { start: at('2026-10-02T21:00:00Z'), end: at('2026-10-03T01:00:00Z'), allDay: false }
    expect(busyDaysOf(late)).toEqual(['2026-10-02', '2026-10-03'])
    expect(busyWords(late, '2026-10-02')).toBe('from 22:00')
    expect(busyWords(late, '2026-10-03')).toBe('until 02:00')
    // Ending at midnight belongs to the day before.
    const evening = { start: at('2026-11-06T19:00:00Z'), end: at('2026-11-07T00:00:00Z'), allDay: false }
    expect(busyDaysOf(evening)).toEqual(['2026-11-06'])
    expect(busyWords(evening, '2026-11-06')).toBe('19:00 to 00:00')
    // The clocks go back on 25 October: 09:00 is 08:00 UTC before and 09:00 after.
    expect(busyWords({ start: at('2026-10-24T08:00:00Z'), end: at('2026-10-24T16:00:00Z'), allDay: false }, '2026-10-24')).toBe('09:00 to 17:00')
    expect(busyWords({ start: at('2026-10-26T09:00:00Z'), end: at('2026-10-26T17:00:00Z'), allDay: false }, '2026-10-26')).toBe('09:00 to 17:00')
    // All day across three days, and a middle day of a long timed stretch.
    expect(busyDaysOf({ start: '2026-10-09', end: '2026-10-11', allDay: true })).toEqual(['2026-10-09', '2026-10-10', '2026-10-11'])
    expect(busyWords({ start: at('2026-10-09T08:00:00Z'), end: at('2026-10-11T08:00:00Z'), allDay: false }, '2026-10-10')).toBe('all day')
  })

  it('puts a day together, all day winning, and warns before an offer without listing every day', () => {
    const cal: Pick<OwnCalendar, 'busy'> = {
      busy: [
        { start: at('2026-10-05T08:00:00Z'), end: at('2026-10-05T12:00:00Z'), allDay: false },
        { start: at('2026-10-05T18:00:00Z'), end: at('2026-10-05T22:00:00Z'), allDay: false },
        { start: '2026-10-06', end: '2026-10-06', allDay: true },
        { start: at('2026-10-06T08:00:00Z'), end: at('2026-10-06T09:00:00Z'), allDay: false },
      ],
    }
    expect([...busyByDay(cal)]).toEqual([
      ['2026-10-05', '09:00 to 13:00; 19:00 to 23:00'],
      ['2026-10-06', 'all day'],
    ])
    expect(busyWarning(cal, ['2026-10-06'])).toBe('Busy in their own calendar on Tue 6 Oct (all day)')
    expect(busyWarning(cal, ['2026-10-05', '2026-10-06'])).toBe('Busy in their own calendar on Mon 5 Oct (09:00 to 13:00; 19:00 to 23:00) and Tue 6 Oct (all day)')
    expect(busyWarning(cal, ['2026-10-07'])).toBeNull()
    expect(busyWarning(undefined, ['2026-10-07'])).toBeNull()
    const long = { busy: [{ start: '2026-10-01', end: '2026-10-11', allDay: true }] }
    expect(busyWarning(long, weekOf('2026-10-05'))).toBe('Busy in their own calendar on Mon 5 Oct (all day), Tue 6 Oct (all day), Wed 7 Oct (all day), Thu 8 Oct (all day) and 3 more days')
  })
})

const person = (id: string, name: string): Person => ({
  id,
  name,
  kind: 'freelancer',
  email: null,
  phone: null,
  skills: [],
  dayRateCents: null,
  notes: '',
  linkToken: '',
  archived: false,
  approvesLeave: false,
  role: null,
  department: null,
  level: 1,
  knownAs: null,
  certificates: {},
  company: null,
})

const aoifes: OwnCalendar = {
  id: 'aoife',
  personId: 'aoife',
  addedBy: 'self',
  addedAt: '2026-10-01T09:00:00.000Z',
  readAt: '2026-10-01T09:00:00.000Z',
  problem: null,
  busy: [{ start: '2026-10-07', end: '2026-10-08', allDay: true }],
  until: '2027-01-29',
}
const stop: Mutation = { id: 'm1', name: 'ownCalendar.stop', args: { personId: 'aoife' }, createdAt: '2026-10-01T10:00:00Z' } as Mutation

describe('own calendars on a device', () => {
  it('stops counting at once when stopped here, before the server hears', () => {
    const view = ownCalendarsView({ ownCalendar: { aoife: aoifes } }, [], 0)
    expect(view.of('aoife')).toMatchObject({ stopping: false })
    expect(view.warning('aoife', ['2026-10-08'])).toBe('Busy in their own calendar on Thu 8 Oct (all day)')
    const stopping = ownCalendarsView({ ownCalendar: { aoife: aoifes } }, [stop], 0)
    expect(stopping.of('aoife')).toMatchObject({ stopping: true, busy: [] })
    expect(stopping.warning('aoife', ['2026-10-08'])).toBeNull()
    // Already applied by the server: what the server says stands.
    expect(ownCalendarsView({ ownCalendar: { aoife: aoifes } }, [{ ...stop, appliedSeq: 3 } as Mutation & { appliedSeq: number }], 5).of('aoife')).toMatchObject({ stopping: false })
    // A snapshot from before own calendars has no table.
    expect(ownCalendarsView({}, [], 0).of('aoife')).toBeUndefined()
  })

  it('shows busy days in the planner as busy, never as a clash or a check', () => {
    const entities = { person: { aoife: person('aoife', 'Aoife Byrne'), brian: person('brian', 'Brian Walsh') } }
    const crew = crewView(entities, [], 0, '2026-10-05')
    const jobs = jobsView({}, [], 0, crew.calls)
    const p = plan({ jobs, crew, ownCalendars: ownCalendarsView({ ownCalendar: { aoife: aoifes } }, [], 0) }, weekOf('2026-10-05'))
    const aoife = p.people.find((l) => l.person.id === 'aoife')!
    expect(aoife.days['2026-10-07']?.busy).toBe('all day')
    expect(aoife.days['2026-10-08']?.busy).toBe('all day')
    expect(aoife.days['2026-10-06']?.busy ?? null).toBeNull()
    expect(p.people.find((l) => l.person.id === 'brian')!.days['2026-10-07']?.busy ?? null).toBeNull()
    expect(p.problems).toEqual([])
  })
})
