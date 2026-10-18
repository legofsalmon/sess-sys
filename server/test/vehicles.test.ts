import { addDays, irishToday, newId, type CommandInput, type CommandName, type MutationResult, type VehicleBooking } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb } from '../src/db.ts'
import { readHistory } from '../src/history.ts'

/**
 * Vans and drivers (ADR 0047): a vehicle whose road check has run out is
 * refused by name for days after it runs out, whatever is sent; so is a
 * driver with no licence or one run out, and a driver whose details have
 * been erased. Another job on the same van that day, or a day off the
 * road, is refused until the booking says to book it anyway. A van can't
 * be retired, a phase removed or a driver erased while bookings still
 * need them, and the history says what was booked, in words.
 */

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

const today = irishToday()
const day = (n: number) => addDays(today, n)

async function server() {
  const db = await pgliteDb()
  const app = await buildApp({ db })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  return { app, db }
}

async function send<N extends CommandName>(app: FastifyInstance, name: N, args: CommandInput<N>): Promise<MutationResult> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    payload: { clientId: 'office-laptop', mutations: [{ id: newId(), name, args, createdAt: new Date().toISOString() }] },
  })
  return res.json().results[0]
}

async function ok<N extends CommandName>(app: FastifyInstance, name: N, args: CommandInput<N>) {
  const r = await send(app, name, args)
  expect(r, `${name} ${JSON.stringify(args)}`).toMatchObject({ status: 'applied' })
  return r
}

async function refused<N extends CommandName>(app: FastifyInstance, name: N, args: CommandInput<N>) {
  const r = await send(app, name, args)
  expect(r.status, `${name} ${JSON.stringify(args)}`).toBe('rejected')
  return r.status === 'rejected' ? r.reason : { code: '', message: '' }
}

async function bookings(app: FastifyInstance) {
  const res = await app.inject({ method: 'GET', url: '/api/sync/pull?after=0' })
  const out = new Map<string, VehicleBooking | null>()
  for (const c of res.json().changes as { entity: string; id: string; data: VehicleBooking | null }[]) if (c.entity === 'vehicleBooking') out.set(c.id, c.data)
  return [...out.values()].filter((b): b is VehicleBooking => !!b)
}

const good = (n: number) => ({ needed: true, expires: day(n) })
const none = { needed: false, expires: null }

/** A van, a job with two phases, and three people: one with a licence, one without, one not known. */
async function setUp(app: FastifyInstance) {
  await ok(app, 'vehicle.save', {
    id: 'van',
    name: 'Big Van',
    registration: '241-d-101',
    kind: 'van',
    seats: 3,
    payloadKg: 1200,
    notes: '',
    checks: { test: good(200), tax: good(9), insurance: good(150), service: good(-3), tacho: none },
  })
  for (const [id, name] of [
    ['gig', 'Harbour Lights'],
    ['other', 'Brightwater Summit'],
  ] as const)
    await ok(app, 'project.create', { id, name, clientId: null, venueId: null, status: 'confirmed', notes: '' })
  await ok(app, 'phase.add', { id: 'in', projectId: 'gig', name: 'Load in', start: day(3), end: day(4), venueId: null, notes: '' })
  await ok(app, 'phase.add', { id: 'late', projectId: 'gig', name: 'Load out', start: day(12), end: day(12), venueId: null, notes: '' })
  await ok(app, 'phase.add', { id: 'show', projectId: 'other', name: 'Show', start: day(4), end: day(5), venueId: null, notes: '' })
  const person = (id: string, name: string, certificates: CommandInput<'person.upsert'>['certificates']) =>
    ok(app, 'person.upsert', { id, name, kind: 'staff', email: null, phone: null, skills: [], dayRateCents: null, notes: '', certificates })
  await person('cian', 'Cian Murphy', { 'driving-licence': { held: true, expires: null, note: '' } })
  await person('aoife', 'Aoife Brennan', { 'driving-licence': { held: false, expires: null, note: '' } })
  await person('dara', 'Dara Quinn', {})
}

const booking = (over: Partial<CommandInput<'vehicleBooking.add'>> = {}): CommandInput<'vehicleBooking.add'> => ({
  id: newId(),
  vehicleId: 'van',
  projectId: 'gig',
  phaseId: 'in',
  start: day(3),
  end: day(4),
  driverId: 'cian',
  notes: '',
  override: false,
  ...over,
})

describe('booking a vehicle', () => {
  it('books it with its driver, and keeps the registration in capitals', async () => {
    const { app } = await server()
    await setUp(app)
    await ok(app, 'vehicleBooking.add', booking({ id: 'b1' }))
    expect(await bookings(app)).toMatchObject([{ id: 'b1', vehicleId: 'van', driverId: 'cian', start: day(3), end: day(4), override: false }])
    const pulled = (await app.inject({ url: '/api/sync/pull?after=0' })).json().changes.findLast((c: { entity: string }) => c.entity === 'vehicle').data
    expect(pulled.registration).toBe('241-D-101')
  })

  it('refuses a van by name for days after its motor tax runs out, override or not', async () => {
    const { app } = await server()
    await setUp(app)
    const r = await refused(app, 'vehicleBooking.add', booking({ phaseId: 'late', start: day(12), end: day(12), override: true }))
    expect(r.code).toBe('conflict')
    expect(r.message).toMatch(/^Big Van \(241-D-101\)'s motor tax runs out on .+, before the booking starts\. Update its checks on the Vehicles page if that's changed\.$/)
    // Its service overdue only warns: the load in, before the tax runs out, is booked.
    await ok(app, 'vehicleBooking.add', booking())
    expect(await bookings(app)).toHaveLength(1)
  })

  it('refuses a driver with no licence, and books one whose licence is not known', async () => {
    const { app } = await server()
    await setUp(app)
    const r = await refused(app, 'vehicleBooking.add', booking({ driverId: 'aoife' }))
    expect(r.message).toBe("Aoife Brennan has no driving licence, so can't drive. Update their card if that's changed.")
    await ok(app, 'vehicleBooking.add', booking({ driverId: 'dara' }))
    // Changing the driver to one who can't is refused too.
    const [b] = await bookings(app)
    expect((await refused(app, 'vehicleBooking.update', { id: b!.id, driverId: 'aoife' })).message).toMatch(/^Aoife Brennan has no driving licence/)
    await ok(app, 'vehicleBooking.update', { id: b!.id, driverId: null })
  })

  it('refuses an archived driver', async () => {
    const { app } = await server()
    await setUp(app)
    await ok(app, 'person.archive', { id: 'cian', archived: true })
    expect((await refused(app, 'vehicleBooking.add', booking())).message).toBe('Cian Murphy has been archived; choose someone else to drive.')
  })

  it('refuses the same van on two jobs the same day until it is booked anyway', async () => {
    const { app } = await server()
    await setUp(app)
    await ok(app, 'vehicleBooking.add', booking())
    const clash = booking({ projectId: 'other', phaseId: 'show', start: day(4), end: day(5), driverId: null })
    const r = await refused(app, 'vehicleBooking.add', clash)
    expect(r.code).toBe('clash')
    expect(r.message).toMatch(/^Big Van \(241-D-101\) is already on Harbour Lights on .+\. Book it anyway to have it on both\.$/)
    await ok(app, 'vehicleBooking.add', { ...clash, override: true })
    expect(await bookings(app)).toHaveLength(2)
  })

  it('a job cancelled holds no van, so its days are free again', async () => {
    const { app } = await server()
    await setUp(app)
    await ok(app, 'vehicleBooking.add', booking())
    await ok(app, 'project.update', { id: 'gig', status: 'cancelled' })
    await ok(app, 'vehicleBooking.add', booking({ projectId: 'other', phaseId: 'show', start: day(4), end: day(5) }))
  })

  it('refuses a van off the road until it is booked anyway, and not once it is back', async () => {
    const { app } = await server()
    await setUp(app)
    await ok(app, 'vehicle.offRoad', { id: 'van', out: { since: day(0), until: day(3), note: 'In for a new clutch' } })
    const r = await refused(app, 'vehicleBooking.add', booking())
    expect(r.code).toBe('clash')
    expect(r.message).toMatch(/^Big Van is off the road until .+: In for a new clutch\. Book it anyway if it will be back in time\.$/)
    await ok(app, 'vehicle.offRoad', { id: 'van', out: null })
    await ok(app, 'vehicleBooking.add', booking())
  })

  it('refuses a phase from another job, and a booking ending before it starts', async () => {
    const { app } = await server()
    await setUp(app)
    expect((await refused(app, 'vehicleBooking.add', booking({ phaseId: 'show' }))).message).toBe('That phase is no longer part of Harbour Lights.')
    await ok(app, 'vehicleBooking.add', booking({ id: 'b1' }))
    expect((await refused(app, 'vehicleBooking.update', { id: 'b1', end: day(2) })).message).toBe('The booking ends before it starts.')
  })

  it('is taken off once, however many phones send it', async () => {
    const { app } = await server()
    await setUp(app)
    await ok(app, 'vehicleBooking.add', booking({ id: 'b1' }))
    await ok(app, 'vehicleBooking.remove', { id: 'b1' })
    await ok(app, 'vehicleBooking.remove', { id: 'b1' })
    expect(await bookings(app)).toHaveLength(0)
  })
})

describe('what a booking keeps', () => {
  it("won't retire a van, remove a phase or erase a driver while they're still needed", async () => {
    const { app } = await server()
    await setUp(app)
    await ok(app, 'vehicleBooking.add', booking({ id: 'b1' }))
    expect((await refused(app, 'vehicle.archive', { id: 'van', archived: true })).message).toMatch(/^Big Van is booked on Harbour Lights from .+\. Take it off that job first\.$/)
    expect((await refused(app, 'phase.remove', { id: 'in' })).message).toMatch(/vehicle/i)
    await ok(app, 'person.archive', { id: 'cian', archived: true })
    expect((await refused(app, 'person.erase', { id: 'cian' })).message).toMatch(/driving Big Van/)
    await ok(app, 'vehicleBooking.remove', { id: 'b1' })
    await ok(app, 'vehicle.archive', { id: 'van', archived: true })
    // Retired, it can't be booked.
    expect((await refused(app, 'vehicleBooking.add', booking())).message).toBe("Big Van (241-D-101) has been retired. Bring it back on its page first if it's still yours.")
  })

  it('the history says what was booked, in words', async () => {
    const { app, db } = await server()
    await setUp(app)
    await ok(app, 'vehicleBooking.add', booking({ id: 'b1' }))
    await ok(app, 'vehicleBooking.add', booking({ projectId: 'other', phaseId: 'show', start: day(4), end: day(5), driverId: null, override: true }))
    const page = await readHistory(db)
    const words = page.entries.map((e) => e.what)
    expect(words.some((w) => w.startsWith('Booked Big Van for Harbour Lights') && w.includes('Cian Murphy driving'))).toBe(true)
    expect(words.some((w) => w.startsWith('Booked Big Van for Brightwater Summit') && w.includes('clash'))).toBe(true)
  })
})
