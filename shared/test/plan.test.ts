import { describe, expect, it } from 'vitest'
import type { Mutation } from '../src/commands.ts'
import type { CrewCall, Offer, Person } from '../src/crew.ts'
import type { Phase, Project } from '../src/jobs.ts'
import { crewView } from '../src/sync/crew-view.ts'
import { jobsView } from '../src/sync/jobs-view.ts'
import { plan, weekOf } from '../src/sync/plan.ts'

/**
 * The planner on its own (audit finding 27): a week laid out by job and by
 * person from the crew and jobs views, with what's short counted, a clash
 * and a check said in words, crew asked for outside Jobs on a row of their
 * own, a call cancelled on this device gone from it before the server has
 * it, and rows and problems in an order two devices agree on.
 */

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
  department: null,
  level: 1,
  knownAs: null,
  certificates: {},
  company: null,
})
const project = (id: string, name: string): Project => ({ id, name, clientId: null, venueId: null, status: 'confirmed', notes: '' })
const phase = (id: string, projectId: string, name: string, start: string, end: string): Phase => ({ id, projectId, name, start, end, venueId: null, notes: '', contactId: null })
const call = (id: string, over: Partial<CrewCall> = {}): CrewCall => ({
  id,
  projectId: 'j1',
  phaseId: 'ph1',
  project: 'Nissan',
  phase: 'Build',
  venue: '',
  role: 'Tech',
  start: '2026-10-05',
  end: '2026-10-06',
  callTime: null,
  needed: 2,
  dayRateCents: null,
  details: '',
  replyBy: null,
  status: 'open',
  ...over,
})
const offer = (id: string, callId: string, personId: string, status: Offer['status'], days: string[]): Offer => ({
  id,
  callId,
  personId,
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
const pending = <N extends Mutation['name']>(name: N, args: Mutation<N>['args']): Mutation => ({ id: `m-${name}`, name, args, createdAt: '2026-10-01T09:00:00Z' }) as Mutation

/** Monday 5 to Sunday 11 October 2026. */
const week = weekOf('2026-10-05')

const entities = {
  person: { aoife: person('aoife', 'Aoife Byrne'), brian: person('brian', 'Brian Walsh'), cian: person('cian', 'Cian Murphy') },
  project: { j1: project('j1', 'Nissan') },
  phase: { ph1: phase('ph1', 'j1', 'Build', '2026-10-05', '2026-10-06') },
  crewCall: {
    c1: call('c1'),
    // Asked for outside Jobs: no job, just the name typed.
    c2: call('c2', { projectId: null, phaseId: null, project: 'Harbour Lights', phase: 'Show', role: 'Stagehand', start: '2026-10-06', end: '2026-10-06', needed: 1 }),
  },
  offer: {
    o1: offer('o1', 'c1', 'aoife', 'confirmed', ['2026-10-05', '2026-10-06']),
    o2: offer('o2', 'c1', 'brian', 'offered', ['2026-10-05', '2026-10-06']),
    o3: offer('o3', 'c1', 'cian', 'offered', ['2026-10-05']),
    o4: offer('o4', 'c2', 'aoife', 'accepted', ['2026-10-06']),
  },
  unavailability: { u1: { id: 'u1', personId: 'cian', start: '2026-10-05', end: '2026-10-05', note: 'Dentist', source: 'ops' as const } },
}

const laidOut = (outbox: Mutation[] = []) => {
  const crew = crewView(entities, outbox, 0, '2026-10-05')
  const jobs = jobsView(entities, outbox, 0, crew.calls)
  return plan({ jobs, crew }, week)
}

describe('a week', () => {
  it('is laid out by job and by person, with what is short, a clash and a check in words', () => {
    // Proves: a week's lanes, counts and problems come straight from the crew and jobs views.
    const p = laidOut()
    expect(p.days).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'])
    expect(p.jobs.map((l) => [l.key, l.name, l.jobId])).toEqual([
      ['j1', 'Nissan', 'j1'],
      ['call:harbour lights', 'Harbour Lights', null],
    ])
    expect(p.jobs[0]!.days).toEqual({
      '2026-10-05': { phases: [{ name: 'Build', label: 'Build 1/2' }], needed: 2, booked: 1, asked: 2, stray: false },
      '2026-10-06': { phases: [{ name: 'Build', label: 'Build 2/2' }], needed: 2, booked: 1, asked: 1, stray: false },
    })
    expect(p.jobs[1]!.days).toEqual({ '2026-10-06': { phases: [{ name: 'Show', label: 'Show' }], needed: 1, booked: 1, asked: 0, stray: false } })
    expect(p.short).toBe(2)

    expect(p.people.map((l) => l.person.name)).toEqual(['Aoife Byrne', 'Brian Walsh', 'Cian Murphy'])
    const aoife = p.people[0]!.days
    expect(aoife['2026-10-06']).toMatchObject({ problem: 'Booked on Nissan and Harbour Lights', severity: 'clash' })
    expect(aoife['2026-10-06']!.work.map((w) => [w.job, w.booked, w.confirmed])).toEqual([
      ['Nissan', true, true],
      ['Harbour Lights', true, false],
    ])
    expect(p.people[2]!.days['2026-10-05']).toMatchObject({ away: 'Dentist', problem: 'Offered Nissan but marked unavailable (Dentist)', severity: 'check' })
    expect(p.problems.map((x) => [x.severity, x.day, x.person.name, x.text, x.jobId])).toEqual([
      ['clash', '2026-10-06', 'Aoife Byrne', 'Booked on Nissan and Harbour Lights', 'j1'],
      ['check', '2026-10-05', 'Cian Murphy', 'Offered Nissan but marked unavailable (Dentist)', 'j1'],
    ])
    expect(p.holidays).toEqual({})
  })

  it('drops a call cancelled on this device, and the clash with it, before the server has it', () => {
    // Proves: a call cancelled with no signal leaves the planner at once, and so does the clash it made.
    const p = laidOut([pending('call.cancel', { id: 'c2' })])
    expect(p.jobs.map((l) => l.key)).toEqual(['j1'])
    expect(p.problems.map((x) => x.text)).toEqual(['Offered Nissan but marked unavailable (Dentist)'])
    expect(p.people[0]!.days['2026-10-06']).toMatchObject({ problem: null, severity: null })
  })

  it('orders rows and problems the same on every device: a tie falls to the id', () => {
    // Proves: ties among lanes and problems fall to the id, so two devices agree.
    // Two jobs with the same name on the same day, and two people with the same name each booked twice that day.
    const twin = person('zara', 'Aoife Byrne')
    const tables = {
      ...entities,
      person: { zara: twin, ...entities.person },
      project: { j2: project('j2', 'Nissan'), j1: project('j1', 'Nissan') },
      phase: { p2: phase('p2', 'j2', 'Show', '2026-10-05', '2026-10-05'), ph1: entities.phase.ph1 },
      offer: { ...entities.offer, o5: offer('o5', 'c1', 'zara', 'confirmed', ['2026-10-06']), o6: offer('o6', 'c2', 'zara', 'accepted', ['2026-10-06']) },
    }
    const arrivedOneWay = { ...tables }
    const arrivedTheOther = {
      ...tables,
      person: Object.fromEntries(Object.entries(tables.person).reverse()),
      project: { j1: tables.project.j1, j2: tables.project.j2 },
      offer: Object.fromEntries(Object.entries(tables.offer).reverse()),
    }
    const lay = (t: typeof tables) => {
      const crew = crewView(t, [], 0, '2026-10-05')
      const p = plan({ jobs: jobsView(t, [], 0, crew.calls), crew }, week)
      return { jobs: p.jobs.map((l) => l.key), people: p.people.map((l) => l.person.id), problems: p.problems.map((x) => [x.day, x.person.id]) }
    }
    const one = lay(arrivedOneWay)
    expect(one.jobs).toEqual(['j1', 'j2', 'call:harbour lights'])
    expect(one.people).toEqual(['aoife', 'zara', 'brian', 'cian'])
    expect(one.problems).toEqual([
      ['2026-10-06', 'aoife'],
      ['2026-10-06', 'zara'],
      ['2026-10-05', 'cian'],
    ])
    expect(lay(arrivedTheOther as typeof tables)).toEqual(one)
  })
})
