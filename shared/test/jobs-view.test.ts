import { describe, expect, it } from 'vitest'
import type { Mutation } from '../src/commands.ts'
import type { CrewCall, Offer } from '../src/crew.ts'
import type { Phase, Project } from '../src/jobs.ts'
import { crewView } from '../src/sync/crew-view.ts'
import { crewFill, jobsView } from '../src/sync/jobs-view.ts'

/**
 * The Jobs tab's view on its own (audit finding 27): a job's phases in date
 * order with its crew calls gathered by phase, this device's own changes laid
 * over the server's (a phase added offline has the whole shape of a synced
 * one, so its Change form and the Ask-for-crew form's choices treat it as
 * one), what "booked" counts, and an order two devices agree on.
 */

const project = (id: string, name: string, status: Project['status'] = 'confirmed'): Project => ({ id, name, clientId: null, venueId: null, status, notes: '' })
const phase = (id: string, projectId: string, name: string, start: string, end: string): Phase => ({ id, projectId, name, start, end, venueId: null, notes: '', contactId: null })
const call = (id: string, projectId: string, phaseId: string | null, start: string, end: string, needed = 1): CrewCall => ({
  id,
  projectId,
  phaseId,
  project: 'Nissan',
  phase: '',
  venue: '',
  role: 'Tech',
  start,
  end,
  callTime: null,
  needed,
  dayRateCents: null,
  details: '',
  replyBy: null,
  status: 'open',
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
const pending = <N extends Mutation['name']>(name: N, args: Mutation<N>['args'], id = `m-${name}`): Mutation => ({ id, name, args, createdAt: '2026-10-01T09:00:00Z' }) as Mutation

describe('a phase added on this device', () => {
  const nissan = { j1: project('j1', 'Nissan') }
  const added = pending('phase.add', { id: 'ph1', projectId: 'j1', name: 'Build', start: '2026-10-03', end: '2026-10-04', venueId: null, notes: '' })

  it('has the whole shape of a synced phase, falls into date order, and the span and the crew form choices follow', () => {
    // Proves: a phase added with no signal reads like a synced one, and gives way to the server's row once pulled.
    const show = phase('ph2', 'j1', 'Show', '2026-10-05', '2026-10-06')
    const view = jobsView({ project: nissan, phase: { ph2: show } }, [added], 0, [])
    const [job] = view.jobs
    expect(job!.phases.map((p) => p.id)).toEqual(['ph1', 'ph2'])
    expect(job!.phases[0]).toEqual({ id: 'ph1', projectId: 'j1', name: 'Build', start: '2026-10-03', end: '2026-10-04', venueId: null, notes: '', contactId: null, pending: true, venue: undefined, calls: [] })
    // Every field a synced phase has, so a form reading any of them finds it.
    expect(Object.keys(job!.phases[0]!).sort()).toEqual(Object.keys(job!.phases[1]!).sort())
    // The job's dates take it in, and with them the phases the Ask-for-crew form offers.
    expect(job!.span).toEqual({ start: '2026-10-03', end: '2026-10-06' })
    // Once the server has it and the device has pulled past it, the server's row stands.
    const synced = jobsView({ project: nissan, phase: { ph2: show, ph1: phase('ph1', 'j1', 'Build', '2026-10-03', '2026-10-04') } }, [{ ...added, appliedSeq: 3 }], 3, [])
    expect(synced.jobs[0]!.phases[0]).toMatchObject({ id: 'ph1', pending: false })
  })

  it('can be changed or removed on the same device before it syncs', () => {
    // Proves: a change or a removal queued behind the phase being added is laid over it, in order.
    const moved = pending('phase.update', { id: 'ph1', end: '2026-10-05' }, 'm2')
    const view = jobsView({ project: nissan }, [added, moved], 0, [])
    expect(view.jobs[0]!.phases[0]).toMatchObject({ end: '2026-10-05', pending: true })
    const gone = jobsView({ project: nissan }, [added, pending('phase.remove', { id: 'ph1' }, 'm3')], 0, [])
    expect(gone.jobs[0]!.phases).toEqual([])
    expect(gone.jobs[0]!.span).toBeUndefined()
  })
})

describe("a job's crew", () => {
  it('is gathered by phase, with the calls across phases apart, and counts booked as confirmed', () => {
    // Proves: a job's calls sit under their phases, calls across phases are kept apart, and only confirmed places count as booked.
    const phases = { ph1: phase('ph1', 'j1', 'Build', '2026-10-03', '2026-10-04'), ph2: phase('ph2', 'j1', 'Show', '2026-10-05', '2026-10-05') }
    const calls = {
      build: call('c1', 'j1', 'ph1', '2026-10-03', '2026-10-04', 2),
      across: call('c2', 'j1', null, '2026-10-03', '2026-10-05'),
      elsewhere: call('c3', 'j2', null, '2026-10-03', '2026-10-03'),
    }
    const offers = {
      o1: offer('o1', 'c1', 'confirmed', ['2026-10-03', '2026-10-04']),
      o2: { ...offer('o2', 'c1', 'accepted', ['2026-10-03', '2026-10-04']), personId: 'p2' },
      o3: offer('o3', 'c2', 'offered', ['2026-10-03', '2026-10-04', '2026-10-05']),
    }
    const crew = crewView({ crewCall: calls, offer: offers }, [], 0, '2026-10-01')
    const view = jobsView({ project: { j1: project('j1', 'Nissan'), j2: project('j2', 'Harbour') }, phase: phases }, [], 0, crew.calls)
    const nissan = view.jobs.find((j) => j.id === 'j1')!
    expect(nissan.phases.map((p) => [p.id, p.calls.map((c) => c.id)])).toEqual([
      ['ph1', ['c1']],
      ['ph2', []],
    ])
    expect(nissan.calls.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(nissan.otherCalls.map((c) => c.id)).toEqual(['c2'])
    expect(crewFill(nissan.calls)).toEqual({ needed: 3, booked: 1, toConfirm: 1 })
  })
})

describe('the order of jobs', () => {
  it('puts jobs with no dates first, then by first day, name and id, the same on every device', () => {
    // Proves: jobs, clients and venues come out in one order whatever order they arrived in.
    const projects = { b: project('b', 'Nissan'), a: project('a', 'Nissan'), z: project('z', 'Zed'), d: project('d', 'Undated') }
    const phases = { pb: phase('pb', 'b', 'Show', '2026-10-05', '2026-10-05'), pa: phase('pa', 'a', 'Show', '2026-10-05', '2026-10-05'), pz: phase('pz', 'z', 'Show', '2026-10-04', '2026-10-04') }
    const ids = (v: ReturnType<typeof jobsView>) => v.jobs.map((j) => j.id)
    expect(ids(jobsView({ project: projects, phase: phases }, [], 0, []))).toEqual(['d', 'z', 'a', 'b'])
    const reversed = Object.fromEntries(Object.entries(projects).reverse())
    expect(ids(jobsView({ project: reversed, phase: phases }, [], 0, []))).toEqual(['d', 'z', 'a', 'b'])
    // Clients and venues sharing a name likewise.
    const clients = { c2: { id: 'c2', name: 'RTÉ', contacts: [], notes: '' }, c1: { id: 'c1', name: 'RTÉ', contacts: [], notes: '' } }
    expect(jobsView({ client: clients }, [], 0, []).clients.map((c) => c.id)).toEqual(['c1', 'c2'])
  })
})
