import type { CommandArgs, Mutation } from '../commands.ts'
import { eachDay, firstName } from '../crew.ts'
import { spanLabel } from '../jobs.ts'
import {
  checkReminders,
  driverRefusal,
  driverUnknowns,
  offRoadLine,
  offRoadOn,
  serviceDue,
  vehicleRefusal,
  vehicleUnknowns,
  type CheckReminder,
  type Vehicle,
  type VehicleBooking,
  type VehicleEntities,
} from '../vehicles.ts'
import type { CrewView, PersonView } from './crew-view.ts'
import type { JobsView, JobView, PhaseView } from './jobs-view.ts'
import { holdOf, type KitHold } from './kit-view.ts'

/**
 * Vans and drivers (ADR 0047) as a device sees them: the vehicles and
 * their bookings the server has sent, with this device's own waiting
 * changes laid over them, and what's wrong with each booking from today
 * on, in words. Worked out on the device, so it works with no signal.
 *
 * A booking on a confirmed job holds its vehicle; one on an enquiry or a
 * quote is pencilled in, as kit is (ADR 0014); one on a job cancelled or
 * lost holds nothing.
 */

export interface VehicleView extends Vehicle {
  pending: boolean
  /** Its bookings on jobs going ahead or pencilled in, soonest first. */
  bookings: BookingView[]
}

export type BookingTone = 'bad' | 'warn' | 'quiet'

export interface BookingView extends VehicleBooking {
  pending: boolean
  vehicle: VehicleView | undefined
  job: JobView | undefined
  /** The phase it's for; undefined for the whole job, or a phase since removed. */
  phase: PhaseView | undefined
  driver: PersonView | undefined
  days: string[]
  hold: KitHold
  /** Other bookings of the same vehicle on jobs going ahead or pencilled in, and the days they share with this one. */
  clashes: { booking: BookingView; days: string[] }[]
  /** What needs sorting out from today on, worst first. Nothing for a booking that's over or holds nothing. */
  problems: { tone: BookingTone; text: string }[]
}

export interface VehiclesView {
  /** Not retired, by name. */
  vehicles: VehicleView[]
  /** Retired ones too. */
  all: VehicleView[]
  get(id: string): VehicleView | undefined
  /** Every booking, soonest first. */
  bookings: BookingView[]
  /** A job's, soonest first. */
  ofJob(jobId: string): BookingView[]
  /** Bookings of a vehicle on jobs going ahead or pencilled in that share days with these, but one, and the days they share. */
  clashesWith(vehicleId: string, start: string, end: string, except?: string): { booking: BookingView; days: string[] }[]
  /** Checks run out, or running out in the next 30 days, for every vehicle not retired, soonest first. */
  reminders: CheckReminder<VehicleView>[]
}

type Tables = { [E in keyof VehicleEntities]: Record<string, VehicleEntities[E]> }

const soonest = (a: Pick<BookingView, 'start' | 'end' | 'id'>, b: Pick<BookingView, 'start' | 'end' | 'id'>) =>
  a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.id.localeCompare(b.id)

/** The days two spans share. */
function shared(a: { start: string; end: string }, b: { start: string; end: string }): string[] {
  const start = a.start > b.start ? a.start : b.start
  const end = a.end < b.end ? a.end : b.end
  return start <= end ? eachDay(start, end) : []
}

export function vehiclesView(
  entities: Partial<Tables>,
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number,
  jobs: JobsView,
  crew: CrewView,
  today: string
): VehiclesView {
  const vehicles = new Map<string, Vehicle & { pending: boolean }>()
  // Snapshots saved before vehicles existed have no tables for them.
  for (const v of Object.values(entities.vehicle ?? {})) vehicles.set(v.id, { ...v, pending: false })
  const bookings = new Map<string, VehicleBooking & { pending: boolean }>()
  for (const b of Object.values(entities.vehicleBooking ?? {})) bookings.set(b.id, { ...b, pending: false })

  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    switch (m.name) {
      case 'vehicle.save': {
        const a = m.args as CommandArgs<'vehicle.save'>
        const was = vehicles.get(a.id)
        vehicles.set(a.id, { ...a, outOfService: was?.outOfService ?? null, archived: was?.archived ?? false, pending: true })
        break
      }
      case 'vehicle.offRoad': {
        const a = m.args as CommandArgs<'vehicle.offRoad'>
        const v = vehicles.get(a.id)
        if (v) vehicles.set(a.id, { ...v, outOfService: a.out, pending: true })
        break
      }
      case 'vehicle.archive': {
        const a = m.args as CommandArgs<'vehicle.archive'>
        const v = vehicles.get(a.id)
        if (v) vehicles.set(a.id, { ...v, archived: a.archived, pending: true })
        break
      }
      case 'vehicleBooking.add': {
        const a = m.args as CommandArgs<'vehicleBooking.add'>
        // The server refuses what it can't book: shown as asked until it says so.
        if (!bookings.has(a.id)) bookings.set(a.id, { ...a, pending: true })
        break
      }
      case 'vehicleBooking.update': {
        const a = m.args as CommandArgs<'vehicleBooking.update'>
        const b = bookings.get(a.id)
        if (!b) break
        const next = { ...b, pending: true }
        for (const [k, v] of Object.entries(a)) if (k !== 'id' && v !== undefined) (next as Record<string, unknown>)[k] = v
        bookings.set(a.id, next)
        break
      }
      case 'vehicleBooking.remove':
        bookings.delete((m.args as CommandArgs<'vehicleBooking.remove'>).id)
        break
    }
  }

  const jobById = new Map(jobs.jobs.map((j) => [j.id, j]))
  const people = new Map(crew.people.map((p) => [p.id, p]))
  const views = new Map<string, VehicleView>()
  for (const v of vehicles.values()) views.set(v.id, { ...v, bookings: [] })

  const all: BookingView[] = [...bookings.values()]
    .map((b) => {
      const job = jobById.get(b.projectId)
      return {
        ...b,
        vehicle: views.get(b.vehicleId),
        job,
        phase: b.phaseId ? job?.phases.find((p) => p.id === b.phaseId) : undefined,
        driver: b.driverId ? people.get(b.driverId) : undefined,
        days: eachDay(b.start, b.end),
        hold: job ? holdOf(job.status) : 'none',
        clashes: [],
        problems: [],
      } satisfies BookingView
    })
    .sort(soonest)

  const live = all.filter((b) => b.hold !== 'none')
  for (const b of live) b.vehicle?.bookings.push(b)
  for (const b of live)
    for (const o of b.vehicle?.bookings ?? []) {
      if (o === b) continue
      const days = shared(b, o)
      if (days.length) b.clashes.push({ booking: o, days })
    }
  // Who drives what on each day, for a driver asked to drive two at once.
  const driving = new Map<string, BookingView[]>()
  for (const b of live) if (b.driverId) driving.set(b.driverId, [...(driving.get(b.driverId) ?? []), b])

  for (const b of live) {
    if (b.end < today || !b.vehicle) continue
    const v = b.vehicle
    const bad: string[] = []
    const warn: string[] = []
    const refused = vehicleRefusal(v, b.start, b.end, today)
    if (refused) bad.push(refused)
    // Two jobs on one van, or a van off the road, is a clash once the job is going ahead; pencilled in, it's one to watch.
    const clashTone = b.hold === 'held' ? bad : warn
    for (const c of b.clashes) {
      const days = c.days.filter((d) => d >= today)
      if (!days.length) continue
      const where = c.booking.job?.name ?? 'another job'
      const words = `Also on ${where} on ${spanLabel({ start: days[0]!, end: days.at(-1)! })}${c.booking.hold === 'pencilled' ? ', if it goes ahead' : ''}.`
      ;(c.booking.hold === 'held' ? clashTone : warn).push(words)
    }
    if (offRoadOn(v, b.start, b.end, today)) clashTone.push(offRoadLine(v))
    if (b.driver) {
      const no = driverRefusal(b.driver, b.start, b.end, today)
      if (no) bad.push(no)
      else warn.push(...driverUnknowns(b.driver, b.start, b.end, today))
      for (const o of driving.get(b.driver.id) ?? []) {
        if (o === b || o.vehicleId === b.vehicleId) continue
        const days = shared(b, o).filter((d) => d >= today)
        if (days.length) warn.push(`${firstName(b.driver)} is also driving ${o.vehicle?.name ?? 'another vehicle'} on ${spanLabel({ start: days[0]!, end: days.at(-1)! })}.`)
      }
    } else if (b.driverId) warn.push('Its driver is no longer on the crew list: choose another.')
    warn.push(...vehicleUnknowns(v, b.start, b.end, today), ...serviceDue(v, b.start, b.end, today))
    // A van run the day before can be right; one that shares no day with its phase was left behind when the phase moved.
    if (b.phase && !shared(b, b.phase).length) warn.push(`Not on its phase's days, which are now ${spanLabel(b.phase)}.`)
    b.problems = [...bad.map((text) => ({ tone: 'bad' as const, text })), ...warn.map((text) => ({ tone: 'warn' as const, text }))]
    if (!b.driverId) b.problems.push({ tone: 'quiet', text: 'No driver chosen yet.' })
  }

  const byJob = new Map<string, BookingView[]>()
  for (const b of all) byJob.set(b.projectId, [...(byJob.get(b.projectId) ?? []), b])
  const allVehicles = [...views.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  const kept = allVehicles.filter((v) => !v.archived)

  return {
    vehicles: kept,
    all: allVehicles,
    get: (id) => views.get(id),
    bookings: all,
    ofJob: (id) => byJob.get(id) ?? [],
    clashesWith: (vehicleId, start, end, except) =>
      (views.get(vehicleId)?.bookings ?? [])
        .filter((o) => o.id !== except)
        .map((o) => ({ booking: o, days: shared({ start, end }, o) }))
        .filter((c) => c.days.length > 0),
    reminders: checkReminders(kept, today),
  }
}
