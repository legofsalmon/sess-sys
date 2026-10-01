import { describe, expect, it } from 'vitest'
import type { Mutation } from '../src/commands.ts'
import type { CrewCall, Offer, Person } from '../src/crew.ts'
import { crewView } from '../src/sync/crew-view.ts'
import { timesheetsView } from '../src/sync/timesheets-view.ts'
import { noTimesheetReason, timesheetChanges, timesheetSummary, timesheetTotal, type Timesheet } from '../src/timesheets.ts'

/**
 * Timesheets (ADR 0022): the days at the day rate and the extras, what the
 * office changed, which bookings can have one, and what the office's list
 * shows, including changes still waiting to sync.
 */

const person = (id: string, name: string, kind: Person['kind'] = 'freelancer'): Person => ({
  id,
  name,
  kind,
  email: null,
  phone: null,
  skills: [],
  dayRateCents: 30000,
  notes: '',
  linkToken: `${id}-link-token-000000000000`,
  archived: false,
})
const call = (id: string, start: string, end: string, status: CrewCall['status'] = 'open'): CrewCall => ({
  id,
  projectId: 'gala',
  phaseId: 'show',
  project: 'Autumn Gala',
  phase: 'Show',
  venue: '',
  role: 'Sound No.1',
  start,
  end,
  callTime: null,
  needed: 3,
  dayRateCents: 32000,
  details: '',
  replyBy: null,
  status,
})
const offer = (id: string, callId: string, personId: string, days: string[], status: Offer['status'] = 'confirmed'): Offer => ({
  id,
  callId,
  personId,
  status,
  days,
  dayRateCents: 32000,
  counterRateCents: null,
  note: '',
  respondedAt: null,
  respondedVia: null,
  override: false,
})
const sheet = (id: string, t: Partial<Timesheet>): Timesheet => {
  const days = t.days ?? ['2026-09-18', '2026-09-19']
  const extras = t.extras ?? []
  return {
    id,
    status: 'sent',
    days,
    dayRateCents: 32000,
    extras,
    sent: { days, dayRateCents: 32000, extras },
    note: '',
    officeNote: '',
    sentAt: '2026-09-20T09:00:00.000Z',
    sentVia: 'link',
    approvedAt: null,
    ...t,
  }
}

describe('a timesheet', () => {
  it('is the days at the day rate, and the extras', () => {
    const t = { days: ['2026-09-18', '2026-09-19'], dayRateCents: 32000, extras: [{ what: 'Parking', cents: 1800 }, { what: 'Mileage', cents: 2550 }] }
    expect(timesheetTotal(t)).toEqual({ fees: 64000, extras: 4350, total: 68350 })
    expect(timesheetSummary(t)).toBe('2 days at €320, and €43.50 of extras: €683.50')
    expect(timesheetSummary({ days: ['2026-09-18'], dayRateCents: null, extras: [] })).toBe('1 day, rate to agree')
  })

  it('says in words what the office changed from what was sent', () => {
    const sent = { days: ['2026-09-18', '2026-09-19'], dayRateCents: 32000, extras: [{ what: 'Parking', cents: 1800 }, { what: 'Dinner', cents: 2200 }] }
    expect(timesheetChanges({ ...sent, sent })).toEqual([])
    expect(
      timesheetChanges({
        days: ['2026-09-19'],
        dayRateCents: 30000,
        extras: [
          { what: 'parking', cents: 1500 },
          { what: 'Tolls', cents: 310 },
        ],
        sent,
      })
    ).toEqual(['Days: Sat 19 Sep, not Fri 18 Sep to Sat 19 Sep', 'Day rate: €300, not €320', 'parking: €15, not €18', 'Left out: Dinner €22', 'Added: Tolls €3.10'])
  })

  it('is for a freelancer\'s confirmed booking on a job going ahead, from its first day', () => {
    const days = ['2026-09-18', '2026-09-19']
    const open = { status: 'open' } as const
    const dara = { kind: 'freelancer' } as const
    expect(noTimesheetReason({ status: 'confirmed', days }, open, dara, '2026-09-18')).toBeNull()
    expect(noTimesheetReason({ status: 'confirmed', days }, open, dara, '2026-09-17')).toBe('The timesheet opens on Fri 18 Sep, the first day of the booking.')
    expect(noTimesheetReason({ status: 'accepted', days }, open, dara, '2026-09-20')).toBe('Only a confirmed booking has a timesheet.')
    expect(noTimesheetReason({ status: 'confirmed', days }, { status: 'cancelled' }, dara, '2026-09-20')).toMatch(/^This job was cancelled/)
    expect(noTimesheetReason({ status: 'confirmed', days }, open, { kind: 'staff' }, '2026-09-20')).toMatch(/^Staff are paid through payroll/)
  })
})

describe("the office's timesheets", () => {
  const entities = {
    person: Object.fromEntries(
      [person('dara', 'Dara Quinn'), person('tadhg', 'Tadhg Brady'), person('laoise', 'Laoise Keane'), person('eimear', 'Eimear Nolan'), person('aoife', 'Aoife Brennan', 'staff')].map((p) => [p.id, p])
    ),
    crewCall: { gala: call('gala', '2026-09-18', '2026-09-19'), later: call('later', '2026-09-30', '2026-10-02'), gone: call('gone', '2026-09-10', '2026-09-10', 'cancelled') },
    offer: Object.fromEntries(
      [
        offer('dara-gala', 'gala', 'dara', ['2026-09-18', '2026-09-19']),
        offer('tadhg-gala', 'gala', 'tadhg', ['2026-09-18', '2026-09-19']),
        offer('laoise-gala', 'gala', 'laoise', ['2026-09-19']),
        offer('aoife-gala', 'gala', 'aoife', ['2026-09-18', '2026-09-19']),
        offer('eimear-later', 'later', 'eimear', ['2026-09-30', '2026-10-01', '2026-10-02']),
        offer('dara-gone', 'gone', 'dara', ['2026-09-10']),
      ].map((o) => [o.id, o])
    ),
    timesheet: {
      'dara-gala': sheet('dara-gala', { extras: [{ what: 'Parking', cents: 1800 }] }),
      'tadhg-gala': sheet('tadhg-gala', { status: 'approved', approvedAt: '2026-09-22T10:00:00.000Z', sentVia: 'app' }),
      // Sent, then the job was cancelled: still there to settle.
      'dara-gone': sheet('dara-gone', { days: ['2026-09-10'], sentAt: '2026-09-11T09:00:00.000Z' }),
    },
  }

  it('lists what to approve, what is not in yet and what is approved; not staff, nor a booking not over yet', () => {
    const crew = crewView(entities, [], 0)
    const ts = timesheetsView(entities, [], 0, crew, '2026-10-01')
    expect(ts.toApprove.map((r) => [r.offer.id, r.total.total])).toEqual([
      ['dara-gone', 32000],
      ['dara-gala', 65800],
    ])
    expect(ts.notIn.map((r) => [r.person?.name, r.total.total])).toEqual([['Laoise Keane', 32000]])
    expect(ts.approved.map((r) => r.offer.id)).toEqual(['tadhg-gala'])
    expect(ts.row('aoife-gala')?.timesheet).toBeUndefined()
    // Eimear's booking runs to 2 October: not in yet once it's over.
    expect(timesheetsView(entities, [], 0, crew, '2026-10-03').notIn.map((r) => r.person?.name)).toEqual(['Laoise Keane', 'Eimear Nolan'])
  })

  it('shows the office its own changes before they sync', () => {
    const m = (name: Mutation['name'], args: unknown): Mutation => ({ id: `${name}-${Math.random()}`, name, args, createdAt: '2026-10-01T10:00:00.000Z' }) as Mutation
    const outbox = [
      m('timesheet.send', { id: 'laoise-gala', days: ['2026-09-19'], extras: [], note: '' }),
      m('timesheet.approve', { id: 'laoise-gala', days: ['2026-09-19'], dayRateCents: 32000, extras: [{ what: 'Taxi', cents: 2500 }], officeNote: '' }),
      m('timesheet.reopen', { id: 'tadhg-gala' }),
    ]
    const crew = crewView(entities, outbox, 0)
    const ts = timesheetsView(entities, outbox, 0, crew, '2026-10-01')
    expect(ts.notIn).toEqual([])
    expect(ts.approved.map((r) => [r.offer.id, r.total.total, r.timesheet?.pending, r.timesheet?.sentVia])).toEqual([['laoise-gala', 34500, true, 'app']])
    expect(timesheetChanges(ts.of('laoise-gala')!)).toEqual(['Added: Taxi €25'])
    expect(ts.toApprove.map((r) => r.offer.id)).toContain('tadhg-gala')
  })
})
