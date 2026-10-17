import { describe, expect, it } from 'vitest'
import type { Mutation } from '../src/commands.ts'
import type { Person } from '../src/crew.ts'
import type { Phase, Project } from '../src/jobs.ts'
import { crewView } from '../src/sync/crew-view.ts'
import { jobsView } from '../src/sync/jobs-view.ts'
import { plan, weekOf } from '../src/sync/plan.ts'
import { vehiclesView } from '../src/sync/vehicles-view.ts'
import {
  checkLabel,
  checkLine,
  checkOf,
  checkReminders,
  checksNeeded,
  checkState,
  driverRefusal,
  driverUnknowns,
  offRoadLine,
  vehicleCommandSchemas,
  vehicleRefusal,
  vehicleUnknowns,
  type Vehicle,
  type VehicleBooking,
} from '../src/vehicles.ts'

/**
 * Vans and drivers (ADR 0047) on their own: which checks a kind of vehicle
 * needs and what each is called, when a road check run out refuses a
 * booking and when it only warns, a driver's licence, the reminders, and
 * the bookings as a device sees them: the clash of one van on two jobs,
 * off the road, a driver asked to drive two at once, and the planner's
 * Vans rows.
 */

const today = '2026-10-05' // a Monday

const van = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: 'van',
  name: 'Big Van',
  registration: '241-D-101',
  kind: 'van',
  seats: 3,
  payloadKg: 1200,
  notes: '',
  checks: {
    test: { needed: true, expires: '2027-03-01' },
    tax: { needed: true, expires: '2026-10-14' },
    insurance: { needed: true, expires: '2027-01-01' },
    service: { needed: true, expires: '2026-10-02' },
    tacho: { needed: false, expires: null },
  },
  outOfService: null,
  archived: false,
  ...over,
})

const person = (id: string, name: string, licence?: Person['certificates']['driving-licence']): Person => ({
  id,
  name,
  kind: 'staff',
  email: null,
  phone: null,
  skills: [],
  dayRateCents: null,
  notes: '',
  linkToken: '',
  archived: false,
  approvesLeave: false,
  role: null,
  department: null,
  level: 1,
  knownAs: null,
  certificates: licence ? { 'driving-licence': licence } : {},
  company: null,
})
const project = (id: string, name: string, status: Project['status'] = 'confirmed'): Project => ({ id, name, clientId: null, venueId: null, status, notes: '' })
const phase = (id: string, projectId: string, name: string, start: string, end: string): Phase => ({ id, projectId, name, start, end, venueId: null, notes: '', contactId: null })
const booking = (id: string, over: Partial<VehicleBooking> = {}): VehicleBooking => ({
  id,
  vehicleId: 'van',
  projectId: 'gig',
  phaseId: 'in',
  start: '2026-10-07',
  end: '2026-10-08',
  driverId: 'cian',
  notes: '',
  override: false,
  ...over,
})

describe('a vehicle and its checks', () => {
  it('needs the checks its kind needs, each by its Irish name', () => {
    expect(checksNeeded('trailer')).toMatchObject({ test: false, tax: false, insurance: false, tacho: false })
    expect(checksNeeded('truck').tacho).toBe(true)
    expect(checksNeeded('van')).toMatchObject({ test: true, tax: true, insurance: true, service: true, tacho: false })
    expect(checkLabel('test', 'car')).toBe('NCT')
    expect(checkLabel('test', 'van')).toBe('CVRT')
    expect(checkLabel('tax', 'van')).toBe('Motor tax')
  })

  it('is refused by name for days after a road check runs out, but not for days before', () => {
    const v = van()
    expect(vehicleRefusal(v, '2026-10-07', '2026-10-08', today)).toBeNull()
    // Good on its own last day.
    expect(vehicleRefusal(v, '2026-10-14', '2026-10-14', today)).toBeNull()
    expect(vehicleRefusal(v, '2026-10-13', '2026-10-15', today)).toMatch(/^Big Van \(241-D-101\)'s motor tax runs out on .+, before the booking ends\. Update its checks on the Vehicles page if that's changed\.$/)
    expect(vehicleRefusal(v, '2026-10-15', '2026-10-16', today)).toMatch(/before the booking starts\./)
    expect(vehicleRefusal(van({ archived: true }), '2026-10-07', '2026-10-08', today)).toMatch(/has been retired/)
  })

  it('only warns of a service overdue, and of a check not recorded', () => {
    const v = van({ checks: { ...van().checks, test: { needed: true, expires: null } } })
    expect(vehicleRefusal(v, '2026-10-07', '2026-10-08', today)).toBeNull()
    expect(vehicleUnknowns(v, '2026-10-07', '2026-10-08', today)).toEqual(['CVRT not recorded for Big Van: check before the job.'])
    // Its page shows a service overdue amber, a road check run out red.
    expect(checkState(checkOf(van(), 'service'), 'service', today).tone).toBe('warn')
    expect(checkState({ needed: true, expires: '2026-10-01' }, 'tax', today).tone).toBe('bad')
  })

  it('lists checks run out or running out in the next 30 days, soonest first, leaving the retired out', () => {
    const reminders = checkReminders([van(), van({ id: 'old', name: 'Old Van', archived: true })], today)
    expect(reminders.map((r) => [r.vehicle.id, r.kind, r.ranOut])).toEqual([
      ['van', 'service', true],
      ['van', 'tax', false],
    ])
    expect(checkLine(reminders[1]!, today)).toMatch(/^Motor tax runs out on /)
  })

  it('says when it is off the road, and until when', () => {
    expect(offRoadLine(van({ outOfService: { since: '2026-10-04', until: '2026-10-07', note: 'In for a new clutch' } }))).toMatch(/^Big Van is off the road until .+: In for a new clutch\.$/)
  })

  it('takes no booking that ends before it starts', () => {
    const r = vehicleCommandSchemas['vehicleBooking.add'].safeParse(booking('b', { start: '2026-10-09', end: '2026-10-08' }))
    expect(r.success).toBe(false)
  })
})

describe('a driver', () => {
  it('is refused with no licence or one run out, and warned about when it is not known', () => {
    expect(driverRefusal(person('a', 'Aoife Brennan', { held: false, expires: null, note: '' }), '2026-10-07', '2026-10-08', today)).toBe(
      "Aoife Brennan has no driving licence, so can't drive. Update their card if that's changed."
    )
    expect(driverRefusal(person('a', 'Aoife Brennan', { held: true, expires: '2026-10-07', note: '' }), '2026-10-07', '2026-10-08', today)).toMatch(/driving licence/)
    expect(driverRefusal(person('c', 'Cian Murphy', { held: true, expires: null, note: '' }), '2026-10-07', '2026-10-08', today)).toBeNull()
    const dara = person('d', 'Dara Quinn')
    expect(driverRefusal(dara, '2026-10-07', '2026-10-08', today)).toBeNull()
    expect(driverUnknowns(dara, '2026-10-07', '2026-10-08', today).join(' ')).toMatch(/Dara Quinn/)
  })
})

const entities = {
  person: {
    cian: person('cian', 'Cian Murphy', { held: true, expires: null, note: '' }),
    dara: person('dara', 'Dara Quinn'),
  },
  project: { gig: project('gig', 'Harbour Lights'), other: project('other', 'Brightwater Summit'), maybe: project('maybe', 'Corrib Arts', 'quoted') },
  phase: {
    in: phase('in', 'gig', 'Load in', '2026-10-07', '2026-10-08'),
    show: phase('show', 'other', 'Show', '2026-10-08', '2026-10-09'),
    arts: phase('arts', 'maybe', 'Show', '2026-10-10', '2026-10-10'),
  },
  vehicle: { van: van(), luton: van({ id: 'luton', name: 'The Luton', registration: '232-D-202', kind: 'luton', outOfService: { since: '2026-10-04', until: '2026-10-10', note: 'Clutch' } }) },
  vehicleBooking: {
    b1: booking('b1'),
    b2: booking('b2', { projectId: 'other', phaseId: 'show', start: '2026-10-08', end: '2026-10-09', driverId: null, override: true }),
    b3: booking('b3', { vehicleId: 'luton', projectId: 'maybe', phaseId: 'arts', start: '2026-10-10', end: '2026-10-10', driverId: 'cian' }),
  },
}

const seen = (outbox: Mutation[] = []) => {
  const crew = crewView(entities, outbox, 0, today)
  const jobs = jobsView(entities, outbox, 0, crew.calls)
  return { crew, jobs, vehicles: vehiclesView(entities, outbox, 0, jobs, crew, today) }
}

describe('the bookings as a device sees them', () => {
  it('says what is wrong with each, worst first', () => {
    const { vehicles } = seen()
    const b1 = vehicles.bookings.find((b) => b.id === 'b1')!
    expect(b1.clashes.map((c) => [c.booking.id, c.days])).toEqual([['b2', ['2026-10-08']]])
    // Two confirmed jobs on one van is bad; its service overdue a warning.
    expect(b1.problems[0]).toEqual({ tone: 'bad', text: expect.stringMatching(/^Also on Brightwater Summit on /) })
    expect(b1.problems.some((p) => p.tone === 'warn' && /[Ss]ervice/.test(p.text))).toBe(true)
    const b2 = vehicles.bookings.find((b) => b.id === 'b2')!
    expect(b2.problems.at(-1)).toEqual({ tone: 'quiet', text: 'No driver chosen yet.' })
    // Pencilled in on a quote while off the road: one to watch, not a clash.
    const b3 = vehicles.bookings.find((b) => b.id === 'b3')!
    expect(b3.hold).toBe('pencilled')
    expect(b3.problems.find((p) => /off the road/.test(p.text))?.tone).toBe('warn')
  })

  it('lays this device’s waiting changes over what the server sent', () => {
    const out = seen([
      { id: 'm1', name: 'vehicleBooking.remove', args: { id: 'b2' }, createdAt: '2026-10-05T09:00:00Z' } as Mutation,
      { id: 'm2', name: 'vehicle.offRoad', args: { id: 'luton', out: null }, createdAt: '2026-10-05T09:00:00Z' } as Mutation,
    ])
    expect(out.vehicles.bookings.map((b) => b.id)).toEqual(['b1', 'b3'])
    expect(out.vehicles.bookings.find((b) => b.id === 'b1')!.problems.some((p) => p.tone === 'bad')).toBe(false)
    expect(out.vehicles.get('luton')).toMatchObject({ outOfService: null, pending: true })
    expect(out.vehicles.bookings.find((b) => b.id === 'b3')!.problems.some((p) => /off the road/.test(p.text))).toBe(false)
  })

  it('frees a van once its job is cancelled', () => {
    const cancelled = { ...entities, project: { ...entities.project, other: project('other', 'Brightwater Summit', 'cancelled') } }
    const crew = crewView(cancelled, [], 0, today)
    const jobs = jobsView(cancelled, [], 0, crew.calls)
    const vehicles = vehiclesView(cancelled, [], 0, jobs, crew, today)
    expect(vehicles.bookings.find((b) => b.id === 'b1')!.clashes).toEqual([])
    expect(vehicles.clashesWith('van', '2026-10-09', '2026-10-09')).toEqual([])
  })
})

describe("the planner's Vans rows", () => {
  it('flags one van on two confirmed jobs as a clash, and a pencilled job while off the road as a check', () => {
    const { crew, jobs, vehicles } = seen()
    const p = plan({ crew, jobs, vehicles }, weekOf(today), today)
    expect(p.vans.map((l) => l.vehicle.name)).toEqual(['Big Van', 'The Luton'])
    expect(p.vanProblems.map((x) => [x.vehicle.name, x.day, x.severity, x.text])).toEqual([
      ['Big Van', '2026-10-08', 'clash', 'On Harbour Lights and Brightwater Summit'],
      ['The Luton', '2026-10-10', 'check', 'Pencilled in for Corrib Arts but off the road (Clutch)'],
    ])
    // The job's day names the van and who drives it.
    const gig = p.jobs.find((l) => l.jobId === 'gig')!
    expect(gig.days['2026-10-07']!.vans).toEqual(['Big Van (Cian)'])
  })

  it('has no Vans rows when the view has no vehicles', () => {
    const { crew, jobs } = seen()
    expect(plan({ crew, jobs }, weekOf(today)).vans).toEqual([])
  })
})
