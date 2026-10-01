import { describe, expect, it } from 'vitest'
import type { Mutation } from '../src/commands.ts'
import type { CrewCall, Offer, Person, Unavailability } from '../src/crew.ts'
import { leaveBalance, leaveDays, leaveLabel, noCancelReason, notEnoughLeft, requestsOverlap, type LeaveRequest, type LieuEntry } from '../src/leave.ts'
import { crewView } from '../src/sync/crew-view.ts'
import { leaveView } from '../src/sync/leave-view.ts'
import { plan } from '../src/sync/plan.ts'
import { jobsView } from '../src/sync/jobs-view.ts'

/**
 * Staff leave (ADR 0024): a request counted in working days, the balances
 * with and without an allowance set, overlaps, and the device's view with
 * its own changes laid over, including approved leave as days off that the
 * planner shows.
 */

const person = (id: string, name: string, extra: Partial<Person> = {}): Person => ({
  id,
  name,
  kind: 'staff',
  email: `${id}@example.com`,
  phone: null,
  skills: [],
  dayRateCents: null,
  notes: '',
  linkToken: `${id}-link-token-000000000000`,
  archived: false,
  approvesLeave: false,
  ...extra,
})
const request = (id: string, personId: string, start: string, end: string, extra: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id,
  personId,
  type: 'annual',
  start,
  end,
  days: leaveDays(start, end),
  note: '',
  status: 'approved',
  requestedAt: '2026-09-01T09:00:00.000Z',
  decidedBy: 'colly',
  decidedAt: '2026-09-02T09:00:00.000Z',
  reason: '',
  ...extra,
})
const entry = (id: string, personId: string, day: string, days = 1, status: LieuEntry['status'] = 'approved'): LieuEntry => ({
  id,
  personId,
  day,
  days,
  note: '',
  status,
  loggedAt: '2026-09-01T09:00:00.000Z',
  decidedBy: null,
  decidedAt: null,
  reason: '',
})

describe('a request', () => {
  it('counts the weekdays that are not public holidays', () => {
    // Monday 5 to Friday 9 October 2026 is a week; Friday 23 to Tuesday 27 loses the weekend and the bank holiday.
    expect(leaveDays('2026-10-05', '2026-10-09')).toBe(5)
    expect(leaveDays('2026-10-23', '2026-10-27')).toBe(2)
    expect(leaveDays('2026-10-24', '2026-10-26')).toBe(0)
    expect(leaveLabel('annual')).toBe('Annual leave')
    expect([leaveLabel('lieu', 1), leaveLabel('lieu', 2)]).toEqual(['Day in lieu', 'Days in lieu'])
  })

  it('overlaps another when they share a day, and can be cancelled only before it starts', () => {
    const a = { start: '2026-10-05', end: '2026-10-09' }
    expect(requestsOverlap(a, { start: '2026-10-09', end: '2026-10-12' })).toBe(true)
    expect(requestsOverlap(a, { start: '2026-10-12', end: '2026-10-12' })).toBe(false)
    expect(noCancelReason({ status: 'waiting', start: '2026-10-05' }, '2026-10-07')).toBeNull()
    expect(noCancelReason({ status: 'approved', start: '2026-10-05' }, '2026-10-04')).toBeNull()
    expect(noCancelReason({ status: 'approved', start: '2026-10-05' }, '2026-10-05')).toMatch(/has started/)
    expect(noCancelReason({ status: 'declined', start: '2026-10-05' }, '2026-10-01')).toMatch(/declined/)
  })
})

describe('the balances', () => {
  const requests = [
    request('r1', 'aoife', '2026-03-02', '2026-03-06'),
    request('r2', 'aoife', '2026-11-02', '2026-11-04'),
    request('r3', 'aoife', '2026-12-01', '2026-12-02', { status: 'waiting' }),
    request('r4', 'aoife', '2026-06-01', '2026-06-05', { status: 'declined' }),
    request('r5', 'aoife', '2026-10-12', '2026-10-12', { type: 'lieu' }),
    request('r6', 'aoife', '2025-12-29', '2025-12-31'),
    request('r7', 'cian', '2026-10-05', '2026-10-09'),
  ]
  const entries = [entry('e1', 'aoife', '2026-09-19'), entry('e2', 'aoife', '2026-09-26', 2), entry('e3', 'aoife', '2026-10-03', 1, 'waiting'), entry('e4', 'cian', '2026-09-19')]

  it('read as the default 20 days when no allowance is set, split by today, with what is left', () => {
    const b = leaveBalance('aoife', 2026, undefined, requests, entries, '2026-10-01')
    expect(b).toMatchObject({ allowance: 20, carriedOver: 0, allowanceSet: false })
    // March taken; November booked; December waiting; June declined counts for nothing; the lieu day and last year's are not annual leave this year.
    expect(b.annual).toEqual({ taken: 5, booked: 3, waiting: 2, left: 12 })
    expect(b.lieu).toEqual({ earned: 3, waitingToApprove: 1, taken: 0, booked: 1, waiting: 0, left: 2 })
  })

  it('use the allowance and carry-over an approver set, and a request over today splits', () => {
    const b = leaveBalance('aoife', 2026, { days: 22, carriedOver: 2 }, requests, entries, '2026-11-03')
    expect(b.annual).toEqual({ taken: 7, booked: 1, waiting: 2, left: 16 })
    expect(leaveBalance('cian', 2026, undefined, requests, entries, '2026-10-01').annual.left).toBe(15)
    expect(notEnoughLeft('annual', 2)).toBe('Only 2 days of annual leave left this year.')
    expect(notEnoughLeft('annual', 0)).toBe('No annual leave left this year.')
    expect(notEnoughLeft('lieu', 1)).toBe('Only 1 day in lieu to take.')
  })
})

describe("the device's view of leave", () => {
  const colly = person('colly', 'Colly Hewson', { approvesLeave: true })
  const aoife = person('aoife', 'Aoife Byrne')
  const cian = person('cian', 'Cian Murphy')
  const dara = person('dara', 'Dara Quinn', { kind: 'freelancer' })
  const call: CrewCall = {
    id: 'c1',
    projectId: null,
    phaseId: null,
    project: 'Harbour Lights',
    phase: 'Show',
    venue: '',
    role: 'Crew chief',
    start: '2026-10-06',
    end: '2026-10-07',
    callTime: null,
    needed: 1,
    dayRateCents: null,
    details: '',
    replyBy: null,
    status: 'open',
  }
  const offer: Offer = {
    id: 'o1',
    callId: 'c1',
    personId: 'aoife',
    status: 'confirmed',
    days: ['2026-10-06', '2026-10-07'],
    dayRateCents: null,
    counterRateCents: null,
    note: '',
    respondedAt: null,
    respondedVia: null,
    override: false,
    seenAt: null,
  }
  const away: Unavailability = { id: 'u1', personId: 'cian', start: '2026-10-08', end: '2026-10-09', note: 'Dentist', source: 'ops' }
  const entities = {
    person: { colly, aoife, cian, dara },
    crewCall: { c1: call },
    offer: { o1: offer },
    unavailability: { u1: away },
    leaveRequest: {
      r1: request('r1', 'aoife', '2026-10-05', '2026-10-09', { status: 'waiting', decidedBy: null, decidedAt: null }),
      r2: request('r2', 'cian', '2026-10-07', '2026-10-07', { status: 'waiting', decidedBy: null, decidedAt: null, requestedAt: '2026-09-02T09:00:00.000Z' }),
    },
    lieuEntry: { e1: entry('e1', 'aoife', '2026-10-03', 1, 'waiting') },
    leaveAllowance: {},
  }
  const m = (name: Mutation['name'], args: unknown): Mutation => ({ id: `${name}-${Math.random()}`, name, args, createdAt: '2026-10-01T10:00:00.000Z' }) as Mutation

  it('queues what is waiting, oldest first, with what an approver should know', () => {
    const crew = crewView(entities, [], 0)
    const view = leaveView(entities, [], 0, crew, '2026-10-01')
    expect(view.staff.map((p) => p.name)).toEqual(['Aoife Byrne', 'Cian Murphy', 'Colly Hewson'])
    expect(view.approvers.map((p) => p.name)).toEqual(['Colly Hewson'])
    expect(view.queue.map((q) => [q.kind, q.person?.name, q.warnings])).toEqual([
      ['request', 'Aoife Byrne', ['Booked on Harbour Lights (Show), Tue 6 Oct to Wed 7 Oct', 'Cian Murphy is off Thu 8 Oct to Fri 9 Oct (Dentist)', 'Cian Murphy has asked for Wed 7 Oct too']],
      ['entry', 'Aoife Byrne', ['Not booked on any job that day']],
      ['request', 'Cian Murphy', ['Aoife Byrne has asked for Mon 5 Oct to Fri 9 Oct too']],
    ])
    expect(view.balance('aoife', 2026).annual).toEqual({ taken: 0, booked: 0, waiting: 5, left: 20 })
  })

  it('lays its own changes over: a request, a decision whose days off the planner shows, an allowance and a cancel', () => {
    const outbox = [
      m('leave.request', { id: 'r3', personId: 'cian', type: 'annual', start: '2026-10-26', end: '2026-10-30', note: 'Half term' }),
      m('leave.decide', { id: 'r1', approved: true, reason: '', by: 'colly' }),
      m('leave.decide', { id: 'r2', approved: false, reason: 'Short-staffed that day', by: 'colly' }),
      m('lieu.decide', { id: 'e1', approved: true, reason: '', by: 'colly' }),
      m('leave.allowance', { personId: 'aoife', year: 2026, days: 22, carriedOver: 2, note: '', by: 'colly' }),
      m('leave.cancel', { id: 'r3', by: 'cian' }),
    ]
    const crew = crewView(entities, outbox, 0)
    const view = leaveView(entities, outbox, 0, crew, '2026-10-01')
    // The October bank holiday is left out of the new request.
    expect(view.requests.find((r) => r.id === 'r3')).toMatchObject({ days: 4, status: 'cancelled', pending: true })
    expect(view.requests.find((r) => r.id === 'r1')).toMatchObject({ status: 'approved', decidedBy: 'colly', pending: true })
    expect(view.requests.find((r) => r.id === 'r2')).toMatchObject({ status: 'declined', reason: 'Short-staffed that day' })
    expect(view.queue).toEqual([])
    expect(view.balance('aoife', 2026)).toMatchObject({ allowance: 22, carriedOver: 2, allowanceSet: true, annual: { taken: 0, booked: 5, waiting: 0, left: 19 }, lieu: { earned: 1, left: 1 } })
    // Approved leave is days off, so the planner flags the booking that clashes with it.
    expect(crew.unavailability.find((u) => u.id === 'r1')).toMatchObject({ personId: 'aoife', start: '2026-10-05', end: '2026-10-09', note: 'Annual leave', source: 'leave', pending: true })
    const jobs = jobsView({}, outbox, 0, crew.calls)
    const p = plan({ jobs, crew }, ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'])
    expect(p.problems.map((x) => [x.person.name, x.day, x.text])).toEqual([
      ['Aoife Byrne', '2026-10-06', 'Booked on Harbour Lights but marked unavailable (Annual leave)'],
      ['Aoife Byrne', '2026-10-07', 'Booked on Harbour Lights but marked unavailable (Annual leave)'],
    ])
    // The planner names the public holidays among its days.
    expect(plan({ jobs, crew }, ['2026-10-26', '2026-10-27']).holidays).toEqual({ '2026-10-26': 'October bank holiday' })
  })
})
