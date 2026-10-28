import { describe, expect, it } from 'vitest'
import { matchOpportunities, rmsClients, rmsOutcome, sameClient } from '../src/rms-history.ts'

/**
 * Current RMS's history put to use (ADR 0092): what went ahead, a client
 * spelt two ways, each opportunity's likeliest job, and how a client's
 * quotes went.
 */

const opp = (o: Partial<{ state: string; status: string; startsAt: string | null; endsAt: string | null }>) => ({ state: 'Quotation', status: 'Provisional', startsAt: '2026-03-01T09:00:00Z', endsAt: '2026-03-02T18:00:00Z', ...o })

describe('what went ahead in Current RMS', () => {
  it('is an order not cancelled; a quote past its days, lost, dead or cancelled is not; one still to come is open', () => {
    expect(rmsOutcome(opp({ state: 'Order', status: 'Completed' }), '2026-10-28')).toBe('ahead')
    expect(rmsOutcome(opp({ state: 'Order', status: 'Cancelled' }), '2026-10-28')).toBe('not')
    expect(rmsOutcome(opp({ status: 'Lost' }), '2026-01-01')).toBe('not')
    expect(rmsOutcome(opp({}), '2026-10-28')).toBe('not')
    expect(rmsOutcome(opp({}), '2026-02-01')).toBe('open')
    expect(rmsOutcome(opp({ startsAt: null, endsAt: null }), '2026-10-28')).toBe('open')
  })

  it("takes a client spelt two ways as one, but not two that only share a word", () => {
    expect(sameClient('Verve', 'Verve Live Ltd')).toBe(true)
    expect(sameClient('The Archetype Agency', 'archetype agency')).toBe(true)
    expect(sameClient('Fuel', 'Fuel Events & Co')).toBe(true)
    expect(sameClient('Pod', 'Podium')).toBe(false)
    expect(sameClient('', 'Pod')).toBe(false)
  })
})

describe("each opportunity's job", () => {
  const jobs = [
    { id: 'gala', name: 'Brightwater Autumn Gala', client: 'Brightwater Events', start: '2026-03-01', end: '2026-03-02' },
    { id: 'expo', name: 'Trade Expo', client: 'Expo Co', start: '2026-03-02', end: '2026-03-04' },
    { id: 'later', name: 'Autumn Gala', client: 'Brightwater Events', start: '2026-09-01', end: '2026-09-01' },
  ]
  it('is sure when the client and the days agree and nothing else comes close, offering the others to choose', () => {
    const [m] = matchOpportunities([{ id: 1, subject: 'Autumn Gala 2026', client: 'Brightwater Events Ltd', startsAt: '2026-03-01T08:00:00Z', endsAt: '2026-03-02T23:00:00Z' }], jobs)
    expect(m).toMatchObject({ opportunityId: 1, projectId: 'gala', sure: true })
    expect(m!.candidates.map((c) => c.projectId)).toEqual(['gala', 'expo'].filter((id) => m!.candidates.some((c) => c.projectId === id)))
  })

  it("suggests but isn't sure on the days alone, and has nothing for days no job has or no days at all", () => {
    const [weak, none, undated] = matchOpportunities(
      [
        { id: 2, subject: 'Dry hire', client: 'Someone New', startsAt: '2026-03-03T08:00:00Z', endsAt: '2026-03-03T18:00:00Z' },
        { id: 3, subject: 'Autumn Gala', client: 'Brightwater Events', startsAt: '2025-01-01T08:00:00Z', endsAt: '2025-01-01T18:00:00Z' },
        { id: 4, subject: 'Autumn Gala', client: 'Brightwater Events', startsAt: null, endsAt: null },
      ],
      jobs
    )
    expect(weak).toMatchObject({ projectId: null, sure: false, candidates: [{ projectId: 'expo', score: 0 }, { projectId: 'gala', score: 0 }] })
    expect(none).toMatchObject({ projectId: null, sure: false })
    expect(undated).toMatchObject({ projectId: null, sure: false, candidates: [] })
  })
})

describe("how a client's quotes went", () => {
  it('counts what went ahead of what was decided, and the usual discount on those that went ahead', () => {
    const o = (state: string, status: string, net: number, before: number, client = 'Verve') => ({ client, state, status, startsAt: '2026-03-01', endsAt: '2026-03-01', netCents: net, undiscountedCents: before })
    const [verve, fuel] = rmsClients([o('Order', 'Completed', 9000, 10000), o('Order', 'Active', 10000, 10000), o('Quotation', 'Lost', 5000, 5000), o('Quotation', 'Provisional', 1000, 1000), o('Order', 'Open', 100, 100, 'Fuel')], '2026-10-28')
    expect(verve).toMatchObject({ client: 'Verve', quotes: 4, ahead: 2, decided: 4, winPct: 50, discountPct: 5, aheadCents: 19000, lastOn: '2026-03-01' })
    expect(fuel).toMatchObject({ client: 'Fuel', quotes: 1, winPct: 100, discountPct: 0 })
  })
})
