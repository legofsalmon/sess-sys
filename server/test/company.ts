import {
  addDays,
  irishToday,
  MemoryStorage,
  newId,
  SyncClient,
  type CommandInput,
  type CommandName,
  type Mutation,
  type MutationResult,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type Transport,
  workingDays,
} from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, expect } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb } from '../src/db.ts'

/**
 * A company with a bit of everything on a server of its own, and a phone
 * signed in to it whose signal can be switched off: for the tests of what a
 * device shows (device-views.test.ts) and of the device and the server
 * agreeing (parity.test.ts).
 */

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

export const today = irishToday()
export const day = (n: number) => addDays(today, n)
/** A two-day leave span of working days on or after day n, so it holds weekdays whatever today is (audit 20 Oct, finding 57). */
export const leaveSpanFrom = (n: number): { start: string; end: string } => {
  const [start, end] = workingDays(day(n), day(n + 14))
  return { start: start!, end: end! }
}
export const year = Number(today.slice(0, 4))

export function m<N extends CommandName>(name: N, args: CommandInput<N>): Mutation {
  return { id: newId(), name, args, createdAt: new Date().toISOString() } as Mutation
}

export async function ok(app: FastifyInstance, ...mutations: Mutation[]) {
  const res = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'office', mutations } })
  const results: MutationResult[] = res.json().results
  const refused = results.flatMap((r, i) => (r.status === 'applied' ? [] : [`${mutations[i]!.name} ${JSON.stringify(mutations[i]!.args)}: ${JSON.stringify(r)}`]))
  expect(refused).toEqual([])
}

export const person = (id: string, name: string, kind: 'staff' | 'freelancer', more: Partial<CommandInput<'person.upsert'>> = {}) =>
  m('person.upsert', { id, name, kind, email: `${id}@example.com`, phone: '+353871234567', skills: ['Audio'], dayRateCents: 30000, notes: '', ...more })

export const call = (id: string, projectId: string, phaseId: string, from: number, to: number, more: Partial<CommandInput<'call.create'>> = {}) =>
  m('call.create', {
    id,
    projectId,
    phaseId,
    project: 'Autumn Gala',
    phase: 'Show',
    venue: 'Northbank',
    role: 'Sound No.1',
    start: day(from),
    end: day(to),
    callTime: '08:00',
    needed: 2,
    dayRateCents: 32000,
    details: '',
    replyBy: null,
    ...more,
  })

export const booked = (offerId: string, callId: string, personId: string) => [
  m('offer.send', { id: offerId, callId, personId, override: false }),
  m('offer.respond', { id: offerId, answer: 'accept', days: null, note: '' }),
  m('offer.confirm', { id: offerId }),
]

export const checks = { test: { needed: true, expires: day(200) }, tax: { needed: true, expires: day(90) }, insurance: { needed: true, expires: day(150) }, service: { needed: true, expires: day(60) }, tacho: { needed: false, expires: null } }

export const NOTES = 'Kit list:\n4 x d&b Y10P\n10 x XLR 10 m\n2 x Mystery haze machine'

/**
 * A company with a bit of everything: a warehouse with numbered and counted
 * kit, a gala coming up with crew booked and offered, kit, a van and a
 * quote; a job that's over with a freelancer's timesheet to approve; an
 * enquiry whose notes list kit; staff with leave open; a fault, a label
 * run, a document and a venue's floor plan.
 */
export async function company() {
  const db = await pgliteDb()
  const app = await buildApp({ db })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  await ok(
    app,
    m('place.upsert', { id: 'wh', name: 'Warehouse', notes: '' }),
    m('place.upsert', { id: 'bay', name: 'Bay A1', notes: '' }),
    m('model.create', { id: 'y10p', name: 'd&b Y10P', department: 'audio', category: 'Speakers', tracking: 'serialised', isCase: false, valueCents: 250000, notes: '', patMonths: 12, liftingMonths: null }),
    m('model.create', { id: 'xlr', name: 'XLR 10 m', department: 'audio', category: 'Cables', tracking: 'bulk', isCase: false, valueCents: null, notes: '' }),
    m('model.create', { id: 'rack', name: 'Amp rack', department: 'audio', category: 'Cases', tracking: 'serialised', isCase: true, valueCents: null, notes: '' }),
    m('asset.add', { id: 'a1', modelId: 'y10p', number: 'SH-000001', serial: 'Y1', placeId: 'wh', caseId: null, notes: '', fromCount: false }),
    m('asset.add', { id: 'a2', modelId: 'y10p', number: 'SH-000002', serial: 'Y2', placeId: 'wh', caseId: null, notes: '', fromCount: false }),
    m('asset.add', { id: 'r1', modelId: 'rack', number: 'SH-000003', serial: '', placeId: 'wh', caseId: null, notes: '', fromCount: false }),
    m('stock.set', { modelId: 'xlr', placeId: 'wh', caseId: null, qty: 20 }),
    m('client.upsert', { id: 'bw', name: 'Brightwater Events', contacts: [{ name: 'Orla Byrne', role: 'Producer', email: 'orla@example.com', phone: null }], notes: '' }),
    m('venue.upsert', { id: 'nb', name: 'Northbank', address: 'North Wall Quay, Dublin', notes: '' }),
    m('project.create', { id: 'gala', name: 'Autumn Gala', clientId: 'bw', venueId: 'nb', status: 'confirmed', notes: '' }),
    m('phase.add', { id: 'build', projectId: 'gala', name: 'Build', start: day(3), end: day(4), venueId: 'nb', notes: '' }),
    m('phase.add', { id: 'show', projectId: 'gala', name: 'Show', start: day(5), end: day(5), venueId: 'nb', notes: '' }),
    m('phase.add', { id: 'prep', projectId: 'gala', name: 'Prep', start: today, end: today, venueId: null, notes: '' }),
    m('project.create', { id: 'past', name: 'Harbour Lights', clientId: null, venueId: null, status: 'confirmed', notes: '' }),
    m('phase.add', { id: 'was', projectId: 'past', name: 'Show', start: day(-3), end: day(-2), venueId: null, notes: '' }),
    m('project.create', { id: 'enq', name: 'Spring Launch', clientId: 'bw', venueId: null, status: 'enquiry', notes: NOTES }),
    m('phase.add', { id: 'launch', projectId: 'enq', name: 'Show', start: day(20), end: day(20), venueId: null, notes: '' }),
    person('dara', 'Dara Quinn', 'freelancer', { company: { name: 'Quinn Audio Ltd', vatNumber: 'IE1234567T', croNumber: null } }),
    person('eimear', 'Eimear Nolan', 'freelancer'),
    person('aoife', 'Aoife Brennan', 'staff', { approvesLeave: true }),
    person('cian', 'Cian Murphy', 'staff', { approvesLeave: true, certificates: { 'driving-licence': { held: true, expires: day(400), note: '' } } }),
    call('sound', 'gala', 'show', 5, 5),
    call('chief', 'gala', 'build', 3, 4, { role: 'Crew chief', dayRateCents: null, needed: 1 }),
    call('now', 'gala', 'prep', 0, 0, { role: 'Warehouse', phase: 'Prep', needed: 1 }),
    call('then', 'past', 'was', -3, -2, { project: 'Harbour Lights' }),
    m('offer.send', { id: 'eimear-sound', callId: 'sound', personId: 'eimear', override: false }),
    ...booked('dara-sound', 'sound', 'dara'),
    ...booked('aoife-chief', 'chief', 'aoife'),
    ...booked('dara-then', 'then', 'dara'),
    ...booked('dara-now', 'now', 'dara'),
    m('timesheet.send', { id: 'dara-then', days: [day(-3), day(-2)], extras: [{ what: 'Parking', cents: 1500 }], note: '' }),
    m('kit.add', { id: 'pa', projectId: 'gala', phaseId: null, modelId: 'y10p', qty: 2, subhireQty: 0, supplier: '', notes: '' }),
    m('kit.add', { id: 'cables', projectId: 'gala', phaseId: 'show', modelId: 'xlr', qty: 8, subhireQty: 0, supplier: '', notes: '' }),
    m('vehicle.save', { id: 'van', name: 'Big Van', registration: '241-D-101', kind: 'van', seats: 3, payloadKg: 1200, notes: '', checks }),
    m('vehicleBooking.add', { id: 'run', vehicleId: 'van', projectId: 'gala', phaseId: 'build', start: day(3), end: day(3), driverId: 'cian', notes: '', override: false }),
    m('quote.save', { id: 'q1', projectId: 'gala', lines: [{ id: 'l1', kind: 'kit', what: 'd&b Y10P', ref: 'y10p', group: 'Audio', qty: 2, days: 3, unitCents: 4500, vat: '23' }], discountPct: 0, notes: '' }),
    m('quote.sent', { id: 'q1', on: day(-1) }),
    m('price.product', { modelId: 'y10p', dayCents: 4500 }),
    m('leave.open', { year, by: 'aoife' }),
    m('leave.allowance', { personId: 'aoife', year, days: 21, carriedOver: 0, note: '', by: 'cian' }),
    m('leave.request', { id: 'hol', personId: 'aoife', type: 'annual', ...leaveSpanFrom(30), note: '' }),
    m('unavailability.add', { id: 'away', personId: 'eimear', start: day(10), end: day(11), note: '' }),
    m('fault.report', { id: 'f1', kind: 'damaged', assetId: 'a2', modelId: 'y10p', qty: 1, projectId: null, usable: true, note: 'Grille dented', at: new Date().toISOString() }),
    m('labels.reserve', { id: 'run1', count: 10, name: 'Speakers', notes: '' }),
    m('attachment.save', { id: 'plan', owner: 'venue', ownerId: 'nb', kind: 'floor-plan', title: 'Floor plan', link: 'https://example.com/plan' })
  )
  return { app, db }
}

/** A phone in the office whose signal can be switched off. */
export async function phone(app: FastifyInstance) {
  const signal = { on: true }
  const transport: Transport = {
    async push(req: PushRequest): Promise<PushResponse> {
      if (!signal.on) throw new Error('offline')
      return (await app.inject({ method: 'POST', url: '/api/sync/push', payload: req })).json()
    },
    async pull(after: number): Promise<PullResponse> {
      if (!signal.on) throw new Error('offline')
      return (await app.inject({ method: 'GET', url: `/api/sync/pull?after=${after}` })).json()
    },
  }
  const client = await new SyncClient({ storage: new MemoryStorage(), transport, clientId: 'phone' }).open()
  await client.sync()
  return { client, signal }
}

