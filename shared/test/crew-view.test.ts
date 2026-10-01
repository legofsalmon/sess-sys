import { describe, expect, it } from 'vitest'
import type { Mutation } from '../src/commands.ts'
import type { CrewCall, Offer, Person } from '../src/crew.ts'
import { crewView } from '../src/sync/crew-view.ts'

/**
 * The crew screen's view of people (audit finding 7): a device's own edit,
 * archive or contact change is laid over what the server said, the way a
 * new person is, keeping what the device doesn't own; and what each person
 * has worked (ADR 0025), built from their bookings.
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

describe('what a person has worked', () => {
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
