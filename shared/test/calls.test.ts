import { describe, expect, it } from 'vitest'
import { commandSchemas, type Mutation } from '../src/commands.ts'
import { movedCallSpan, offerDaysAfter, REPLY_BY_AFTER, suggestedReplyBy, type CrewCall, type Offer } from '../src/crew.ts'
import type { Phase } from '../src/jobs.ts'
import { crewView } from '../src/sync/crew-view.ts'
import { crewFill } from '../src/sync/jobs-view.ts'

/**
 * Changing a call and moving a phase with its crew, as a device shows them
 * before the server answers: the same rules the server applies, laid over
 * what the device holds; and "booked" meaning confirmed when a job's crew
 * are counted.
 */

const call: CrewCall = {
  id: 'c1',
  projectId: 'nissan',
  phaseId: 'build',
  project: 'Nissan launch',
  phase: 'Build',
  venue: 'The Heritage',
  role: 'Audio tech',
  start: '2026-10-07',
  end: '2026-10-08',
  callTime: '08:00',
  needed: 2,
  dayRateCents: 25000,
  details: '',
  replyBy: null,
  status: 'open',
}

const offer = (id: string, personId: string, status: Offer['status'], days: string[]): Offer => ({
  id,
  callId: 'c1',
  personId,
  status,
  days,
  dayRateCents: 25000,
  counterRateCents: null,
  note: '',
  respondedAt: null,
  respondedVia: null,
  override: false,
  seenAt: null,
})

const build: Phase = { id: 'build', projectId: 'nissan', name: 'Build', start: '2026-10-07', end: '2026-10-08', venueId: null, notes: '', contactId: null }

/** Aoife confirmed for both days, Dara accepted for the second only, Niall still deciding. */
const entities = {
  crewCall: { c1: call },
  offer: {
    aoife: offer('aoife', 'p1', 'confirmed', ['2026-10-07', '2026-10-08']),
    dara: offer('dara', 'p2', 'accepted', ['2026-10-08']),
    niall: offer('niall', 'p3', 'offered', ['2026-10-07', '2026-10-08']),
  },
  phase: { build },
}

const m = (name: Mutation['name'], args: object): Mutation => ({ id: `m-${name}`, name, args, createdAt: '2026-10-01T09:00:00Z' }) as Mutation

describe('where a call lands when its phase moves', () => {
  it('shifts with the phase and stays inside it', () => {
    const from = { start: '2026-10-07', end: '2026-10-10' }
    // A week later, whole.
    expect(movedCallSpan({ start: '2026-10-08', end: '2026-10-09' }, from, { start: '2026-10-14', end: '2026-10-17' })).toEqual({ start: '2026-10-15', end: '2026-10-16' })
    // The phase shrinks: the call is cut to it.
    expect(movedCallSpan({ start: '2026-10-07', end: '2026-10-10' }, from, { start: '2026-10-07', end: '2026-10-08' })).toEqual({ start: '2026-10-07', end: '2026-10-08' })
    // None of its days fit any more: it takes the phase's.
    expect(movedCallSpan({ start: '2026-10-09', end: '2026-10-10' }, from, { start: '2026-10-14', end: '2026-10-14' })).toEqual({ start: '2026-10-14', end: '2026-10-14' })
    // Already outside the phase: it just moves along.
    expect(movedCallSpan({ start: '2026-10-05', end: '2026-10-06' }, from, { start: '2026-10-14', end: '2026-10-17' })).toEqual({ start: '2026-10-12', end: '2026-10-13' })
    // Longer at the front, the end or both, but not moved: the call, and the days its crew agreed, stay put.
    expect(movedCallSpan({ start: '2026-10-07', end: '2026-10-08' }, from, { start: '2026-10-05', end: '2026-10-10' })).toEqual({ start: '2026-10-07', end: '2026-10-08' })
    expect(movedCallSpan({ start: '2026-10-07', end: '2026-10-08' }, from, { start: '2026-10-07', end: '2026-10-12' })).toEqual({ start: '2026-10-07', end: '2026-10-08' })
    expect(movedCallSpan({ start: '2026-10-07', end: '2026-10-08' }, from, { start: '2026-10-05', end: '2026-10-12' })).toEqual({ start: '2026-10-07', end: '2026-10-08' })
  })

  it("takes an offer's days along: all of them, or the chosen ones still in range", () => {
    const old = ['2026-10-07', '2026-10-08']
    const next = ['2026-10-08', '2026-10-09']
    expect(offerDaysAfter(old, old, next)).toEqual(next)
    expect(offerDaysAfter(['2026-10-08'], old, next)).toEqual(['2026-10-08'])
    expect(offerDaysAfter(['2026-10-07'], old, next)).toEqual([])
    // With the whole job moved a week, the second day's person is still on the second day.
    expect(offerDaysAfter(['2026-10-08'], old, ['2026-10-14', '2026-10-15'], 7)).toEqual(['2026-10-15'])
  })
})

describe('a change to a call, on the device that made it', () => {
  it('shows the new dates and rate at once, with each offer as the server will leave it', () => {
    const view = crewView(entities, [m('call.update', { id: 'c1', start: '2026-10-08', end: '2026-10-09', dayRateCents: 28000 })], 0)
    const c = view.calls[0]!
    expect(c).toMatchObject({ pending: true, start: '2026-10-08', end: '2026-10-09', dayRateCents: 28000, days: ['2026-10-08', '2026-10-09'] })
    const by = new Map(c.offers.map((o) => [o.id, o]))
    expect(by.get('aoife')).toMatchObject({ days: ['2026-10-08', '2026-10-09'], dayRateCents: 25000, pending: true })
    expect(by.get('dara')).toMatchObject({ days: ['2026-10-08'], dayRateCents: 25000, pending: false })
    expect(by.get('niall')).toMatchObject({ days: ['2026-10-08', '2026-10-09'], dayRateCents: 28000, pending: true })
    expect(c.openDays).toEqual(['2026-10-09'])
  })

  it('leaves an offer as it was when the change would strand it, since the server will refuse', () => {
    const view = crewView(entities, [m('call.update', { id: 'c1', start: '2026-10-09', end: '2026-10-09' })], 0)
    expect(view.calls[0]!.offers.find((o) => o.id === 'dara')).toMatchObject({ days: ['2026-10-08'], pending: false })
  })

  it('offers the new days to someone still deciding whose days would all go, as the server does', () => {
    const niallOnThe7th = { ...entities, offer: { ...entities.offer, niall: offer('niall', 'p3', 'offered', ['2026-10-07']) } }
    const view = crewView(niallOnThe7th, [m('call.update', { id: 'c1', start: '2026-10-08', end: '2026-10-09' })], 0)
    expect(view.calls[0]!.offers.find((o) => o.id === 'niall')).toMatchObject({ days: ['2026-10-08', '2026-10-09'], pending: true })
  })
})

describe('a phase moved with its crew, on the device that moved it', () => {
  it('moves the calls and the days their crew hold when asked, and leaves them when not', () => {
    const moved = crewView(entities, [m('phase.update', { id: 'build', start: '2026-10-14', end: '2026-10-15', moveCrew: true })], 0)
    const c = moved.calls[0]!
    expect(c).toMatchObject({ pending: true, start: '2026-10-14', end: '2026-10-15' })
    expect(c.offers.find((o) => o.id === 'aoife')).toMatchObject({ days: ['2026-10-14', '2026-10-15'], pending: true })
    expect(c.offers.find((o) => o.id === 'dara')).toMatchObject({ days: ['2026-10-15'], pending: true })

    const kept = crewView(entities, [m('phase.update', { id: 'build', start: '2026-10-14', end: '2026-10-15' })], 0)
    expect(kept.calls[0]).toMatchObject({ pending: false, start: '2026-10-07', end: '2026-10-08' })
  })

  it('leaves the crew on their days when the phase only gets longer', () => {
    const grown = crewView(entities, [m('phase.update', { id: 'build', start: '2026-10-05', moveCrew: true })], 0)
    expect(grown.calls[0]).toMatchObject({ pending: false, start: '2026-10-07', end: '2026-10-08' })
    expect(grown.calls[0]!.offers.find((o) => o.id === 'aoife')).toMatchObject({ days: ['2026-10-07', '2026-10-08'], pending: false })
  })

  it('follows the phase through earlier changes still waiting to sync', () => {
    const view = crewView(
      entities,
      [m('phase.update', { id: 'build', start: '2026-10-08', end: '2026-10-09' }), m('phase.update', { id: 'build', start: '2026-10-15', end: '2026-10-16', moveCrew: true })],
      0
    )
    // The second move is a week on from the first, not from what the server holds.
    expect(view.calls[0]).toMatchObject({ start: '2026-10-14', end: '2026-10-15' })
  })
})

describe("a job's crew count", () => {
  it('counts the confirmed as booked and the accepted as to confirm', () => {
    const { calls } = crewView(entities, [], 0)
    expect(crewFill(calls)).toEqual({ needed: 2, booked: 1, toConfirm: 0 })
    const full = crewView({ ...entities, offer: { ...entities.offer, dara: offer('dara', 'p2', 'accepted', ['2026-10-07', '2026-10-08']) } }, [], 0)
    expect(crewFill(full.calls)).toEqual({ needed: 2, booked: 1, toConfirm: 1 })
    const confirmed = crewView({ ...entities, offer: { ...entities.offer, dara: offer('dara', 'p2', 'confirmed', ['2026-10-07', '2026-10-08']) } }, [], 0)
    expect(crewFill(confirmed.calls)).toEqual({ needed: 2, booked: 2, toConfirm: 0 })
  })
})

describe('the reply-by day when asking for crew (audit finding 21)', () => {
  it('is suggested as two days before the first day, or the day before when the job is close, never a day already gone, and not at all once the job is over', () => {
    // Proves: the day both office forms suggest comes before the job, a job tomorrow included, unless it starts today or has started; a job that's over gets none, so the suggestion is never one the rules turn down.
    expect(suggestedReplyBy('2026-10-24', '2026-10-25', '2026-10-01')).toBe('2026-10-22')
    expect(suggestedReplyBy('2026-10-04', '2026-10-04', '2026-10-01')).toBe('2026-10-02')
    expect(suggestedReplyBy('2026-10-03', '2026-10-04', '2026-10-01')).toBe('2026-10-02')
    expect(suggestedReplyBy('2026-10-02', '2026-10-02', '2026-10-01')).toBe('2026-10-01')
    expect(suggestedReplyBy('2026-10-01', '2026-10-01', '2026-10-01')).toBe('2026-10-01')
    expect(suggestedReplyBy('2026-09-28', '2026-10-03', '2026-10-01')).toBe('2026-10-01')
    expect(suggestedReplyBy('2026-09-28', '2026-09-30', '2026-10-01')).toBeNull()
  })

  it("is turned down after the job's last day, in words, before the call is kept", () => {
    // Proves: a reply-by day left behind when the dates were changed is refused on the device, which checks a new call as the server does; up to the last day, or none, is fine.
    const create = (replyBy: string | null) =>
      commandSchemas['call.create'].safeParse({ ...call, id: 'c2', start: '2026-10-10', end: '2026-10-12', replyBy })
    const refused = create('2026-10-13')
    expect(refused.success).toBe(false)
    expect(refused.error?.issues[0]?.message).toBe(REPLY_BY_AFTER)
    expect(create('2026-10-12').success).toBe(true)
    expect(create(null).success).toBe(true)
  })
})
