import { describe, expect, it } from 'vitest'
import type { Mutation } from '../src/commands.ts'
import type { CrewCall, Offer, Person, Unavailability } from '../src/crew.ts'
import { crewView, type CrewView } from '../src/sync/crew-view.ts'
import { jobsView } from '../src/sync/jobs-view.ts'
import { plan } from '../src/sync/plan.ts'
import { timesheetsView } from '../src/sync/timesheets-view.ts'

/**
 * The crew screen's view of people (audit finding 7): a device's own edit,
 * archive or contact change is laid over what the server said, the way a
 * new person is, keeping what the device doesn't own; what each person has
 * worked (ADR 0025), built from their bookings; and the overlays that used
 * to drift from the server (audit finding 23): a call cancelled on the
 * device withdraws its offers, a counter confirmed carries its rate into
 * the offer and the timesheet, a Withdraw never rewrites an answer that is
 * over, and every order ends on the id so two devices agree.
 */

const aoife: Person = {
  id: 'p1',
  name: 'Aoife Byrne',
  kind: 'freelancer',
  email: 'aoife@example.com',
  phone: '+353871234567',
  skills: ['audio'],
  dayRateCents: 25000,
  notes: '',
  linkToken: 'abcdefghijklmnopqrstuvwx',
  archived: false,
  approvesLeave: false,
  department: null,
  level: 1,
  knownAs: null,
  certificates: {},
  company: null,
}

const pending = <N extends Mutation['name']>(name: N, args: Mutation<N>['args']): Mutation => ({ id: `m-${name}`, name, args, createdAt: '2026-10-01T09:00:00Z' }) as Mutation

describe('a pending change to a person', () => {
  it('lays an edit over them like a new person, keeping their link and whether they are archived', () => {
    const edit = pending('person.upsert', { id: 'p1', name: 'Aoife Byrne-Walsh', kind: 'freelancer', email: null, phone: '+353871234568', skills: ['audio', 'rf'], dayRateCents: 27500, notes: 'Has a van' })
    const view = crewView({ person: { p1: { ...aoife, archived: true } } }, [edit], 0)
    expect(view.people).toEqual([{ ...aoife, name: 'Aoife Byrne-Walsh', email: null, phone: '+353871234568', skills: ['audio', 'rf'], dayRateCents: 27500, notes: 'Has a van', archived: true, pending: true, worked: [] }])
    // Once the server has applied it and the device has pulled past it, the server's record stands.
    expect(crewView({ person: { p1: aoife } }, [{ ...edit, appliedSeq: 5 }], 5).people[0]).toMatchObject({ name: 'Aoife Byrne', pending: false })
  })

  it('archives and brings back, and changes only the contact details sent', () => {
    const away = crewView({ person: { p1: aoife } }, [pending('person.archive', { id: 'p1', archived: true })], 0)
    expect(away.people[0]).toMatchObject({ archived: true, pending: true })
    const back = crewView({ person: { p1: { ...aoife, archived: true } } }, [pending('person.archive', { id: 'p1', archived: false })], 0)
    expect(back.people[0]).toMatchObject({ archived: false, pending: true })

    const phone = crewView({ person: { p1: aoife } }, [pending('person.contact', { id: 'p1', phone: null })], 0)
    expect(phone.people[0]).toMatchObject({ phone: null, email: 'aoife@example.com', pending: true })
    // A change for someone this device hasn't heard of yet is nothing to show.
    expect(crewView({}, [pending('person.contact', { id: 'p9', phone: null })], 0).people).toEqual([])
  })

  it('reads people synced before archiving existed as not archived', () => {
    const { archived: _, ...before } = aoife
    const view = crewView({ person: { p1: before as Person } }, [], 0)
    expect(view.people[0]).toMatchObject({ archived: false, pending: false })
  })
})

const call = (id: string, start: string, end: string, status: CrewCall['status'] = 'open'): CrewCall => ({
  id,
  projectId: null,
  phaseId: null,
  project: `Job ${id}`,
  phase: '',
  venue: '',
  role: 'Stagehand',
  start,
  end,
  callTime: null,
  needed: 1,
  dayRateCents: null,
  details: '',
  replyBy: null,
  status,
})
const offer = (id: string, callId: string, status: Offer['status'], days: string[]): Offer => ({
  id,
  callId,
  personId: 'p1',
  status,
  days,
  dayRateCents: null,
  counterRateCents: null,
  note: '',
  respondedAt: null,
  respondedVia: null,
  override: false,
  seenAt: null,
})
const today = '2026-10-01'

describe('what a person has worked', () => {
  it('lists the places held from their own first day on calls that stand, newest first', () => {
    const view = crewView(
      {
        person: { p1: aoife },
        crewCall: {
          past: call('past', '2026-09-10', '2026-09-11'),
          now: call('now', '2026-10-01', '2026-10-02'),
          long: call('long', '2026-09-28', '2026-10-10'),
          gone: call('gone', '2026-09-20', '2026-09-20', 'cancelled'),
          soon: call('soon', '2026-10-05', '2026-10-05'),
        },
        offer: {
          o1: offer('o1', 'past', 'confirmed', ['2026-09-10', '2026-09-11']),
          o2: offer('o2', 'now', 'accepted', ['2026-10-01', '2026-10-02']),
          // The call has started, but their own days on it haven't come.
          o3: offer('o3', 'long', 'confirmed', ['2026-10-08', '2026-10-09']),
          o4: offer('o4', 'gone', 'confirmed', ['2026-09-20']),
          o5: offer('o5', 'soon', 'accepted', ['2026-10-05']),
          o6: offer('o6', 'past', 'declined', ['2026-09-10']),
        },
      },
      [],
      0,
      today
    )
    expect(view.people[0]!.worked).toEqual([
      { callId: 'now', projectId: null, name: 'Job now', phase: '', start: '2026-10-01', end: '2026-10-02' },
      { callId: 'past', projectId: null, name: 'Job past', phase: '', start: '2026-09-10', end: '2026-09-11' },
    ])
  })

  it('leaves out a call cancelled on this device before the server has it', () => {
    const entities = { person: { p1: aoife }, crewCall: { past: call('past', '2026-09-10', '2026-09-11') }, offer: { o1: offer('o1', 'past', 'confirmed', ['2026-09-10']) } }
    expect(crewView(entities, [], 0, today).people[0]!.worked).toHaveLength(1)
    expect(crewView(entities, [pending('call.cancel', { id: 'past' })], 0, today).people[0]!.worked).toEqual([])
  })
})

describe('a call cancelled on this device', () => {
  const brian = { ...aoife, id: 'p2', name: 'Brian Walsh' }
  const cian = { ...aoife, id: 'p3', name: 'Cian Murphy' }
  const entities = {
    person: { p1: aoife, p2: brian, p3: cian },
    crewCall: { c1: { ...call('c1', '2026-10-05', '2026-10-06'), projectId: 'j1', needed: 2 } },
    offer: {
      o1: offer('o1', 'c1', 'confirmed', ['2026-10-05', '2026-10-06']),
      o2: { ...offer('o2', 'c1', 'offered', ['2026-10-05', '2026-10-06']), personId: 'p2' },
      o3: { ...offer('o3', 'c1', 'declined', ['2026-10-05']), personId: 'p3' },
    },
    project: { j1: { id: 'j1', name: 'Nissan', clientId: null, venueId: null, status: 'confirmed' as const, notes: '' } },
  }
  const week = ['2026-10-05', '2026-10-06']

  it('withdraws every offer still live on it, as the server will, so nobody holds its days and the planner and Worked follow', () => {
    // Proves: the device does what the server's cancel does, at once, and the views built on it follow (audit finding 23).
    const before = crewView(entities, [], 0, '2026-10-06')
    expect(before.calls[0]!.offers.map((o) => o.status)).toEqual(['confirmed', 'offered', 'declined'])
    expect(before.people[0]!.worked).toHaveLength(1)

    const view = crewView(entities, [pending('call.cancel', { id: 'c1' })], 0, '2026-10-06')
    const c = view.calls[0]!
    expect(c.status).toBe('cancelled')
    // An answer that was over stays as it ended, as on the server.
    expect(c.offers.map((o) => [o.id, o.status, o.pending])).toEqual([
      ['o3', 'declined', false],
      ['o1', 'cancelled', true],
      ['o2', 'cancelled', true],
    ])
    expect(c.heldByDay).toEqual({ '2026-10-05': 0, '2026-10-06': 0 })
    expect(view.people[0]!.worked).toEqual([])
    const jobs = jobsView({ project: entities.project }, [], 0, view.calls)
    const laid = plan({ jobs, crew: view }, week)
    expect(laid.jobs).toEqual([])
    expect(laid.people.map((l) => Object.keys(l.days))).toEqual([[], [], []])
  })

  it('happens to every open call of a job stopped on this device', () => {
    // Proves: stopping a job with no signal withdraws its calls' offers too, as the server will.
    const view = crewView(entities, [pending('project.update', { id: 'j1', status: 'cancelled' })], 0, '2026-10-06')
    expect(view.calls[0]).toMatchObject({ status: 'cancelled', pending: true })
    expect(view.calls[0]!.offers.map((o) => o.status)).toEqual(['declined', 'cancelled', 'cancelled'])
  })
})

describe('a counter confirmed on this device', () => {
  const c1 = { ...call('c1', '2026-09-28', '2026-09-29'), dayRateCents: 25000 }
  const o1 = { ...offer('o1', 'c1', 'countered', ['2026-09-28', '2026-09-29']), dayRateCents: 25000, counterRateCents: 30000 }
  const entities = { person: { p1: aoife }, crewCall: { c1 }, offer: { o1 } }

  it('carries the agreed rate into the offer and the timesheet total, as the server will', () => {
    // Proves: a counter confirmed with no signal shows the agreed rate, in the offer and in the timesheet's total, before the sync.
    const view = crewView(entities, [pending('offer.confirm', { id: 'o1' })], 0, today)
    expect(view.calls[0]!.offers[0]).toMatchObject({ status: 'confirmed', dayRateCents: 30000, counterRateCents: 30000, pending: true })
    const sheets = timesheetsView({}, [], 0, view, today)
    expect(sheets.row('o1')!.total).toEqual({ fees: 60000, extras: 0, total: 60000 })
    // A plain yes confirmed keeps the call's rate.
    const yes = crewView({ ...entities, offer: { o1: { ...o1, status: 'accepted', counterRateCents: null } } }, [pending('offer.confirm', { id: 'o1' })], 0, today)
    expect(yes.calls[0]!.offers[0]).toMatchObject({ status: 'confirmed', dayRateCents: 25000 })
  })

  it('and a Withdraw queued offline never rewrites an answer that is over', () => {
    // Proves: a Withdraw for an offer already declined leaves it declined, as the server does.
    const view = crewView({ ...entities, offer: { o1: { ...o1, status: 'declined' } } }, [pending('offer.cancel', { id: 'o1' })], 0, today)
    expect(view.calls[0]!.offers[0]).toMatchObject({ status: 'declined', pending: false })
  })
})

describe('the order on two devices', () => {
  it('is the same whatever order the rows arrived in: a tie falls to the id', () => {
    // Proves: two devices holding the same rows, arrived in a different order, list people, calls, offers and days off alike.
    const twin = { ...aoife, id: 'p2' }
    const nissan = (id: string): CrewCall => ({ ...call(id, '2026-10-05', '2026-10-05'), project: 'Nissan' })
    const on = (id: string, personId: string): Offer => ({ ...offer(id, 'c1', 'offered', ['2026-10-05']), personId })
    const off = (id: string): Unavailability => ({ id, personId: 'p1', start: '2026-10-05', end: '2026-10-05', note: '', source: 'ops' })
    const first = crewView(
      { person: { p2: twin, p1: aoife }, crewCall: { c2: nissan('c2'), c1: nissan('c1') }, offer: { o2: on('o2', 'p2'), o1: on('o1', 'p1') }, unavailability: { u2: off('u2'), u1: off('u1') } },
      [],
      0,
      today
    )
    const second = crewView(
      { person: { p1: aoife, p2: twin }, crewCall: { c1: nissan('c1'), c2: nissan('c2') }, offer: { o1: on('o1', 'p1'), o2: on('o2', 'p2') }, unavailability: { u1: off('u1'), u2: off('u2') } },
      [],
      0,
      today
    )
    const order = (v: CrewView) => ({ people: v.people.map((p) => p.id), calls: v.calls.map((c) => c.id), offers: v.calls[0]!.offers.map((o) => o.id), away: v.unavailability.map((u) => u.id) })
    expect(order(first)).toEqual({ people: ['p1', 'p2'], calls: ['c1', 'c2'], offers: ['o1', 'o2'], away: ['u1', 'u2'] })
    expect(order(second)).toEqual(order(first))
  })
})
