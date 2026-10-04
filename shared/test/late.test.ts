import { describe, expect, it } from 'vitest'
import type { Mutation } from '../src/commands.ts'
import type { CrewCall, Offer, Person } from '../src/crew.ts'
import { LATE_KEPT_DAYS, lateDays, lateGoneReason, lateGoneUpTo, lateLine, lateShown, lateWords, noLateReason, type RunningLate } from '../src/late.ts'
import { crewView } from '../src/sync/crew-view.ts'
import { lateView } from '../src/sync/late-view.ts'
import { plan } from '../src/sync/plan.ts'
import { jobsView } from '../src/sync/jobs-view.ts'

/**
 * Running late (ADR 0028): said for a day someone holds, from 6pm the
 * evening before to the end of the day; said in words the office and the
 * contact on the day read; laid over the office's view as it's said,
 * noted or closed; and gone from every screen once its day is over.
 */

/** A moment in Ireland, from its local time: October is summer time, an hour ahead of UTC. */
const irish = (day: string, time: string) => new Date(`${day}T${time}:00+01:00`)

const gráinne: Person = {
  id: 'p1',
  name: 'Gráinne Power',
  kind: 'freelancer',
  email: null,
  phone: '+447700900111',
  skills: [],
  dayRateCents: 30000,
  notes: '',
  linkToken: 'abcdefghijklmnopqrstuvwx',
  archived: false,
  approvesLeave: false,
  department: 'Video',
  level: 2,
  knownAs: null,
  certificates: {},
  company: null,
}
const shoot: CrewCall = {
  id: 'c1',
  projectId: null,
  phaseId: null,
  project: 'Liffey Brands Shoot',
  phase: 'Shoot',
  venue: 'Pier 3 Studio',
  role: 'Camera',
  start: '2026-10-02',
  end: '2026-10-03',
  callTime: '08:00',
  needed: 1,
  dayRateCents: 30000,
  details: '',
  replyBy: null,
  status: 'open',
}
const booked: Offer = {
  id: 'o1',
  callId: 'c1',
  personId: 'p1',
  status: 'confirmed',
  days: ['2026-10-02', '2026-10-03'],
  dayRateCents: 30000,
  counterRateCents: null,
  note: '',
  respondedAt: null,
  respondedVia: null,
  override: false,
  seenAt: null,
}
const said: RunningLate = {
  id: 'l1',
  personId: 'p1',
  offerId: 'o1',
  callId: 'c1',
  day: '2026-10-02',
  by: '30',
  arriveAt: null,
  note: 'Traffic on the M50',
  saidAt: '2026-10-02T07:40:00.000Z',
  arrivedAt: null,
  seenAt: null,
}
const pending = <N extends Mutation['name']>(name: N, args: Mutation<N>['args']): Mutation => ({ id: `m-${name}`, name, args, createdAt: '2026-10-02T07:50:00.000Z' }) as Mutation

describe('when it can be said', () => {
  it('is a day they hold, from 6pm the evening before to the end of that day', () => {
    // Proves: the window opens at 18:00 Irish time the evening before, holds all the booked day, and never covers a day they don't hold.
    const held = ['2026-10-02', '2026-10-03']
    expect(lateDays(held, irish('2026-10-01', '17:59'))).toEqual([])
    expect(lateDays(held, irish('2026-10-01', '18:00'))).toEqual(['2026-10-02'])
    expect(lateDays(held, irish('2026-10-02', '07:45'))).toEqual(['2026-10-02'])
    // The evening of one booked day, before another: both.
    expect(lateDays(held, irish('2026-10-02', '19:30'))).toEqual(['2026-10-02', '2026-10-03'])
    expect(lateDays(held, irish('2026-10-03', '23:59'))).toEqual(['2026-10-03'])
    expect(lateDays(held, irish('2026-10-04', '00:01'))).toEqual([])
    expect(noLateReason(held, '2026-10-05', irish('2026-10-04', '19:00'))).toBe("You're not booked on Mon 5 Oct.")
    expect(noLateReason(held, '2026-10-03', irish('2026-10-01', '20:00'))).toBe("You can say you're running late from 6pm the evening before a day you're booked.")
    expect(noLateReason(held, '2026-10-02', irish('2026-10-03', '09:00'))).toBe('Fri 2 Oct is over.')
  })

  it('is the same for the office noting it for someone who rang, said about them by name', () => {
    // Proves: the office gets the link's rules in its own voice: the same window, a day they don't hold, too early, and a booking let go.
    const held = ['2026-10-02', '2026-10-03']
    expect(noLateReason(held, '2026-10-02', irish('2026-10-02', '07:45'), 'Gráinne Power')).toBeNull()
    expect(noLateReason(held, '2026-10-05', irish('2026-10-04', '19:00'), 'Gráinne Power')).toBe("Gráinne Power isn't booked on Mon 5 Oct.")
    expect(noLateReason(held, '2026-10-03', irish('2026-10-01', '20:00'), 'Gráinne Power')).toBe("Running late can be noted from 6pm the evening before a day they're booked.")
    expect(noLateReason(held, '2026-10-02', irish('2026-10-03', '09:00'), 'Gráinne Power')).toBe('Fri 2 Oct is over.')
    expect(lateGoneReason('Gráinne Power')).toBe("Gráinne Power isn't booked on this one any more, so there's nothing to be late for.")
    expect(lateGoneReason()).toBe("You're not booked on this one any more, so there's nothing to be late for.")
  })

  it('is kept until 30 days after its day', () => {
    // Proves: a record goes on its day and 30 more, and not the day before, counted in whole days across a month's end, the clocks going back on 25 October, and a short February.
    expect(LATE_KEPT_DAYS).toBe(30)
    expect(lateGoneUpTo('2026-10-31')).toBe('2026-10-01')
    expect(lateGoneUpTo('2026-11-01')).toBe('2026-10-02')
    expect(lateGoneUpTo('2027-03-17')).toBe('2027-02-15')
  })
})

describe('what it says', () => {
  it('reads as the office and the contact on the day read it', () => {
    // Proves: how late, a time, both, the note in quotes, and "there now" once they've said so.
    expect(lateWords({ by: '15', arriveAt: null })).toBe('about 15 minutes late')
    expect(lateWords({ by: '60', arriveAt: null })).toBe('about an hour late')
    expect(lateWords({ by: 'more', arriveAt: '10:30' })).toBe('more than an hour late, there at about 10:30')
    expect(lateLine(said)).toBe('about 30 minutes late, “Traffic on the M50”')
    expect(lateLine({ ...said, arrivedAt: '2026-10-02T08:25:00.000Z' })).toBe('there now')
  })
})

describe("the office's view", () => {
  const crew = crewView({ person: { p1: gráinne }, crewCall: { c1: shoot }, offer: { o1: booked } }, [], 0, '2026-10-02')

  it('waits in the queue until noted or they are there, and is on the call and the planner until the day is over', () => {
    // Proves: a running late is to check, Noted and "I'm here" each take it out of the queue, and the planner says it on the job's day and the person's.
    const view = lateView({ runningLate: { l1: said } }, [], 0, crew, '2026-10-02')
    expect(view.toCheck.map((l) => [l.person?.name, l.call?.project])).toEqual([['Gráinne Power', 'Liffey Brands Shoot']])
    expect(lateView({ runningLate: { l1: said } }, [pending('late.seen', { id: 'l1' })], 0, crew, '2026-10-02')).toMatchObject({ toCheck: [], current: [{ pending: true }] })
    expect(lateView({ runningLate: { l1: said } }, [pending('late.arrived', { id: 'l1' })], 0, crew, '2026-10-02').toCheck).toEqual([])

    const p = plan({ jobs: jobsView({}, [], 0, crew.calls), crew, late: view }, ['2026-10-02', '2026-10-03'])
    expect(p.jobs[0]!.days['2026-10-02']!.late).toEqual(['Gráinne: about 30 minutes late, “Traffic on the M50”'])
    expect(p.jobs[0]!.days['2026-10-03']).not.toHaveProperty('late')
    expect(p.people[0]!.days['2026-10-02']!.work[0]!.late).toBe('about 30 minutes late, “Traffic on the M50”')
  })

  it('clears itself after the day', () => {
    // Proves: the day after, nothing shows anywhere: not in the queue, on the call or in the planner.
    const after = lateView({ runningLate: { l1: said } }, [], 0, crew, '2026-10-03')
    expect(after.current).toEqual([])
    expect(after.toCheck).toEqual([])
    expect(after.forOffer('o1')).toEqual([])
    expect(lateShown(said, '2026-10-02')).toBe(true)
    expect(lateShown(said, '2026-10-03')).toBe(false)
  })

  it("lays the office's own note for someone who rang over its copy, as the link's would be, and its 'there now'", () => {
    // Proves: a late.say waiting on the office's device, for a booking with nothing said yet, shows at once in the queue, on the call and the planner, marked as waiting; "Mark as there" laid over it takes it from the queue and says they're there.
    const noted = pending('late.say', { id: 'l2', offerId: 'o1', day: '2026-10-02', by: '60', arriveAt: null, note: 'Rang: van broke down' })
    const view = lateView({}, [noted], 0, crew, '2026-10-02')
    expect(view.current.map((l) => [l.id, l.person?.name, l.call?.role, lateLine(l), l.pending, l.seenAt])).toEqual([
      ['l2', 'Gráinne Power', 'Camera', 'about an hour late, “Rang: van broke down”', true, null],
    ])
    expect(view.toCheck.map((l) => l.id)).toEqual(['l2'])
    expect(view.forOffer('o1').map((l) => l.id)).toEqual(['l2'])
    const p = plan({ jobs: jobsView({}, [], 0, crew.calls), crew, late: view }, ['2026-10-02'])
    expect(p.jobs[0]!.days['2026-10-02']!.late).toEqual(['Gráinne: about an hour late, “Rang: van broke down”'])

    const there = lateView({}, [noted, { ...pending('late.arrived', { id: 'l2' }), createdAt: '2026-10-02T08:40:00.000Z' }], 0, crew, '2026-10-02')
    expect(there.toCheck).toEqual([])
    expect(there.current.map((l) => [lateLine(l), l.arrivedAt, l.pending])).toEqual([['there now', '2026-10-02T08:40:00.000Z', true]])
  })

  it('lays a change said again over the same record, new to the office again', () => {
    // Proves: one record for a booking and a day, whatever id a second saying carries, and it comes back to the queue.
    const again = pending('late.say', { id: 'other', offerId: 'o1', day: '2026-10-02', by: null, arriveAt: '09:15', note: '' })
    const view = lateView({ runningLate: { l1: { ...said, seenAt: '2026-10-02T07:45:00.000Z' } } }, [again], 0, crew, '2026-10-02')
    expect(view.current.map((l) => [l.id, lateLine(l), l.pending])).toEqual([['l1', 'there at about 09:15', true]])
    expect(view.toCheck).toHaveLength(1)
  })
})
