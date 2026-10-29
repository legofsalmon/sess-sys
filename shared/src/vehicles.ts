import { z } from 'zod'
import { blocks, certificateGaps, certificateUnknowns, gapSentence, longDate } from './certificates.ts'
import { dayLabel, daysBetween, eachDay, somethingToChange, type Person } from './crew.ts'
import { day } from './day.ts'
import { needed, text, whole } from './plain.ts'

/**
 * Vans and drivers (ADR 0047): the company's vehicles, the checks that let
 * each one on the road and when they run out, and a vehicle booked on a
 * job or one of its phases for some days, with a driver from the crew.
 *
 * As with the certificates a call needs (ADR 0028), what is a condition of
 * the work is refused by name and with the fix: a vehicle whose road check
 * has run out on a day it's booked, and a driver with no licence or one
 * run out. What is the office's judgement warns and can be booked anyway:
 * two jobs on one van the same day, and a van off the road that may be
 * back by then. The same shared functions say it on the device, in place,
 * and on the server, so a booking made with no signal is turned down in
 * the same words when it arrives.
 */

const id = z.string().min(1).max(64)

/** What a vehicle is. A Luton is a van with a box body over the cab; a truck is over 3.5 tonnes. */
export const VEHICLE_KINDS = ['van', 'luton', 'truck', 'car', 'trailer'] as const
export type VehicleKind = (typeof VEHICLE_KINDS)[number]
export const VEHICLE_KIND_LABELS: Record<VehicleKind, string> = {
  van: 'Van',
  luton: 'Luton',
  truck: 'Truck',
  car: 'Car',
  trailer: 'Trailer',
}

/**
 * The checks a vehicle carries, each running out on a day: its NCT (a
 * car's) or CVRT (a commercial vehicle's), motor tax, insurance, when its
 * service is due, and a tachograph's calibration, for a vehicle over 3.5
 * tonnes that has one.
 */
export const CHECK_KINDS = ['test', 'tax', 'insurance', 'service', 'tacho'] as const
export type CheckKind = (typeof CHECK_KINDS)[number]

/** Without these in date a vehicle can't legally go on the road. A service overdue only warns. */
export const ROAD_CHECKS: readonly CheckKind[] = ['test', 'tax', 'insurance', 'tacho']

/** "NCT" for a car, "CVRT" for the rest: the test a vehicle of its kind takes. */
export function checkLabel(kind: CheckKind, vehicle: VehicleKind): string {
  switch (kind) {
    case 'test':
      return vehicle === 'car' ? 'NCT' : 'CVRT'
    case 'tax':
      return 'Motor tax'
    case 'insurance':
      return 'Insurance'
    case 'service':
      return 'Service'
    case 'tacho':
      return 'Tachograph calibration'
  }
}

/** The same mid-sentence: "its CVRT", "its motor tax". */
export const checkWords = (kind: CheckKind, vehicle: VehicleKind) => (kind === 'test' ? checkLabel(kind, vehicle) : checkLabel(kind, vehicle).toLowerCase())

/**
 * One check: whether the vehicle needs it at all (a light trailer has no
 * CVRT and pays no tax; most vans have no tachograph), and the day it runs
 * out, or null while nobody has recorded it, which warns and never refuses.
 */
export const vehicleCheck = z.object({ needed: z.boolean(), expires: day.nullable() })
export type VehicleCheck = z.infer<typeof vehicleCheck>
export const vehicleChecks = z.partialRecord(z.enum(CHECK_KINDS), vehicleCheck)
export type VehicleChecks = z.infer<typeof vehicleChecks>

/** What a new vehicle of a kind needs, before anyone says otherwise. A truck has a tachograph; a trailer is checked with what tows it. */
export function checksNeeded(kind: VehicleKind): Record<CheckKind, boolean> {
  return {
    test: kind !== 'trailer',
    tax: kind !== 'trailer',
    insurance: kind !== 'trailer',
    service: true,
    tacho: kind === 'truck',
  }
}

/** A check as it stands: the one recorded, or what a vehicle of its kind needs with nothing recorded. */
export function checkOf(v: Pick<Vehicle, 'kind' | 'checks'>, kind: CheckKind): VehicleCheck {
  return v.checks[kind] ?? { needed: checksNeeded(v.kind)[kind], expires: null }
}

/** Off the road from a day, until a day or until someone says it's back, and why. */
export const offRoad = z
  .object({ since: day, until: day.nullable(), note: text(500, 'Why') })
  .refine((o) => o.until === null || o.since <= o.until, { message: "It can't be back before it goes off the road." })

export const vehicle = z.object({
  id,
  /** What the crew call it: "Big Van", "The Luton". */
  name: needed(100, "The vehicle's name", "The vehicle's name"),
  registration: text(20, 'The registration'),
  kind: z.enum(VEHICLE_KINDS),
  /** Including the driver's. */
  seats: whole(0, 60, 'The seats').nullable(),
  payloadKg: whole(0, 50_000, 'The payload in kg').nullable(),
  notes: text(2000, 'The notes'),
  checks: vehicleChecks,
  /** In for repair, or otherwise off the road: off what's free, as kit in repair is (ADR 0018). Null while it's on the road. */
  outOfService: offRoad.nullable(),
  /** Sold or gone: kept for the record of its bookings, offered for nothing. */
  archived: z.boolean(),
})
export type Vehicle = z.infer<typeof vehicle>

/** "Big Van (221-D-12345)", or the name alone with no registration. */
export const vehicleName = (v: Pick<Vehicle, 'name' | 'registration'>) => (v.registration.trim() ? `${v.name} (${v.registration.trim()})` : v.name)

/** Longer than this is more likely a typing slip than a booking. */
export const MAX_BOOKING_DAYS = 366

/** A vehicle on a job, or one of its phases, for some days, and who drives it. */
export const vehicleBooking = z.object({
  id,
  vehicleId: id,
  projectId: id,
  /** Null: the whole job. */
  phaseId: id.nullable(),
  start: day,
  end: day,
  /** From the crew; null while nobody has been chosen. */
  driverId: id.nullable(),
  /** Such as "Collect the S5000 from Murt's". */
  notes: text(500, 'The note'),
  /** Booked despite a clash or a day off the road; kept for the history. */
  override: z.boolean(),
})
export type VehicleBooking = z.infer<typeof vehicleBooking>

export interface VehicleEntities {
  vehicle: Vehicle
  vehicleBooking: VehicleBooking
}
export const VEHICLE_ENTITY_NAMES = ['vehicle', 'vehicleBooking'] as const

const bookingFits = [(b: { start?: string; end?: string }) => !b.start || !b.end || b.start <= b.end, { message: 'The booking ends before it starts.' }] as const
const bookingNotTooLong = [
  (b: { start?: string; end?: string }) => !b.start || !b.end || daysBetween(b.start, b.end) < MAX_BOOKING_DAYS,
  { message: `A vehicle can be booked for at most ${MAX_BOOKING_DAYS} days at a time.` },
] as const

export const vehicleCommandSchemas = {
  /** Its details and checks, saved whole, as a client is: they're changed now and then. Off the road and retired stay as they are. */
  'vehicle.save': vehicle.omit({ outOfService: true, archived: true }),
  /** Off the road, from a day and until one or until it's back; or back on the road, with null. */
  'vehicle.offRoad': z.object({ id, out: offRoad.nullable() }),
  /** Sold or gone, or brought back. Refused while it's booked from today on. */
  'vehicle.archive': z.object({ id, archived: z.boolean() }),
  /**
   * A vehicle on a job. Refused when a road check runs out before its last
   * day, or the driver has no licence or one run out; a clash with another
   * job, or a day off the road, needs `override`.
   */
  'vehicleBooking.add': vehicleBooking.refine(...bookingFits).refine(...bookingNotTooLong),
  /** Only the fields the person changed, as for kit on a job (ADR 0014); checked again as the booking will be. */
  'vehicleBooking.update': z
    .object({
      id,
      vehicleId: id.optional(),
      phaseId: id.nullable().optional(),
      start: day.optional(),
      end: day.optional(),
      driverId: id.nullable().optional(),
      notes: vehicleBooking.shape.notes.optional(),
      override: z.boolean().optional(),
    })
    .refine(...somethingToChange)
    // Saying to book it anyway isn't a change on its own.
    .refine((u: Record<string, unknown>) => Object.keys(u).some((k) => k !== 'id' && k !== 'override' && u[k] !== undefined), { message: 'Nothing to change.' })
    .refine(...bookingFits)
    .refine(...bookingNotTooLong),
  'vehicleBooking.remove': z.object({ id }),
} as const

// What a booking is checked against.

/** Why one check falls short for some days: run out already, running out before the last day, or not recorded. */
export interface CheckGap {
  kind: CheckKind
  why: 'ran-out' | 'runs-out' | 'not-recorded'
  expires: string | null
}

/**
 * The road checks that stand between a vehicle and these days. A check is
 * good on its own last day, as a certificate is, and days gone by aren't
 * held against it: a booking that's over was good, or is history.
 */
export function checkGaps(v: Pick<Vehicle, 'kind' | 'checks'>, start: string, end: string, today: string): CheckGap[] {
  if (end < today) return []
  const out: CheckGap[] = []
  for (const kind of ROAD_CHECKS) {
    const c = checkOf(v, kind)
    if (!c.needed) continue
    if (c.expires === null) out.push({ kind, why: 'not-recorded', expires: null })
    else if (c.expires < end) out.push({ kind, why: c.expires < today ? 'ran-out' : 'runs-out', expires: c.expires })
  }
  return out
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** "a", "a and b", "a, b and c". */
const inWords = (parts: readonly string[]) => (parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`)

/**
 * Why a vehicle can't be booked for these days, or null when it can: each
 * road check run out, or running out before the last day, by name, with
 * the fix. Booking it anyway doesn't pass it: it's the law, not the
 * office's judgement, and the way past it is to correct the record.
 */
export function vehicleRefusal(v: Pick<Vehicle, 'name' | 'registration' | 'kind' | 'checks' | 'archived'>, start: string, end: string, today: string): string | null {
  if (v.archived) return `${vehicleName(v)} has been retired. Bring it back on its page first if it's still yours.`
  const gaps = checkGaps(v, start, end, today).filter((g) => g.why !== 'not-recorded')
  if (!gaps.length) return null
  const said = gaps.map((g) => {
    const what = `${vehicleName(v)}'s ${checkWords(g.kind, v.kind)}`
    if (g.why === 'ran-out') return `${what} ran out on ${longDate(g.expires!, today)}.`
    return `${what} runs out on ${longDate(g.expires!, today)}, before the booking ${g.expires! < start ? 'starts' : 'ends'}.`
  })
  return `${said.join(' ')} Update its checks on the Vehicles page if that's changed.`
}

/** What isn't recorded, said once: "CVRT and motor tax not recorded for Big Van: check before the job." */
export function vehicleUnknowns(v: Pick<Vehicle, 'name' | 'registration' | 'kind' | 'checks'>, start: string, end: string, today: string): string[] {
  const unknown = checkGaps(v, start, end, today).filter((g) => g.why === 'not-recorded')
  if (!unknown.length) return []
  return [`${capital(inWords(unknown.map((g) => checkWords(g.kind, v.kind))))} not recorded for ${v.name}: check before the job.`]
}

/**
 * Why a person can't drive on these days, or null when they can: no
 * licence, or one run out or running out before the last day, by name,
 * with the fix (their card on the Crew tab). Someone archived drives
 * nothing new.
 */
export function driverRefusal(p: Pick<Person, 'name' | 'certificates' | 'archived'>, start: string, end: string, today: string): string | null {
  if (p.archived) return `${p.name} has been archived; choose someone else to drive.`
  const days = eachDay(start, end)
  const gap = certificateGaps(p, ['driving-licence'], days, today).filter(blocks)[0]
  if (!gap || end < today) return null
  const said = gap.why === 'not-held' ? `${p.name} has no driving licence, so can't drive.` : gapSentence(p.name, gap, days, today)
  return `${said} Update their card if that's changed.`
}

/** "Driving licence not known for Dara Quinn: check before the job." Most of the crew list says nothing about licences. */
export function driverUnknowns(p: Pick<Person, 'name' | 'certificates'>, start: string, end: string, today: string): string[] {
  if (end < today) return []
  return certificateUnknowns(p, ['driving-licence'], eachDay(start, end), today)
}

/** A service due before a booking's last day: worth knowing, never a reason to refuse. */
export function serviceDue(v: Pick<Vehicle, 'name' | 'kind' | 'checks'>, start: string, end: string, today: string): string[] {
  const c = checkOf(v, 'service')
  if (!c.needed || !c.expires || end < today || c.expires >= end) return []
  return [`${v.name}'s service ${c.expires < today ? 'was' : 'is'} due on ${dayLabel(c.expires)}.`]
}

/** Off the road on any of these days, from today on: since its day, until its day or for as long as it says. */
export function offRoadOn(v: Pick<Vehicle, 'outOfService'>, start: string, end: string, today: string): boolean {
  const o = v.outOfService
  if (!o || end < today) return false
  const from = start < today ? today : start
  return o.since <= end && (o.until === null || o.until >= from)
}

/** "Big Van is off the road until Mon 5 Oct: New clutch.", or "for now" with no day it's back. */
export function offRoadLine(v: Pick<Vehicle, 'name' | 'outOfService'>): string {
  const o = v.outOfService
  if (!o) return ''
  return `${v.name} is off the road ${o.until ? `until ${dayLabel(o.until)}` : 'for now'}${o.note.trim() ? `: ${o.note.trim()}` : ''}.`
}

// Running out, as certificates and documents are (ADR 0028, ADR 0029).

/** As certificates and documents: run out, or running out in the next 30 days. */
export const CHECK_SOON_DAYS = 30

export interface CheckReminder<V> {
  vehicle: V
  kind: CheckKind
  expires: string
  ranOut: boolean
}

/** Every needed check run out or running out in the next 30 days, for every vehicle not retired, soonest first. */
export function checkReminders<V extends Pick<Vehicle, 'id' | 'name' | 'kind' | 'checks' | 'archived'>>(vehicles: readonly V[], today: string, within = CHECK_SOON_DAYS): CheckReminder<V>[] {
  const out: CheckReminder<V>[] = []
  for (const v of vehicles) {
    if (v.archived) continue
    for (const kind of CHECK_KINDS) {
      const c = checkOf(v, kind)
      if (!c.needed || !c.expires || daysBetween(today, c.expires) > within) continue
      out.push({ vehicle: v, kind, expires: c.expires, ranOut: c.expires < today })
    }
  }
  return out.sort(
    (a, b) => a.expires.localeCompare(b.expires) || a.vehicle.name.localeCompare(b.vehicle.name) || a.vehicle.id.localeCompare(b.vehicle.id) || CHECK_KINDS.indexOf(a.kind) - CHECK_KINDS.indexOf(b.kind)
  )
}

/** "CVRT runs out on Thu 22 Oct", "Service was due on Wed 2 Sep": a reminder's line. */
export function checkLine(r: { vehicle: Pick<Vehicle, 'kind'>; kind: CheckKind; expires: string; ranOut: boolean }, today: string): string {
  const what = checkLabel(r.kind, r.vehicle.kind)
  const year = r.expires.slice(0, 4) === today.slice(0, 4) ? '' : ` ${r.expires.slice(0, 4)}`
  if (r.kind === 'service') return r.expires === today ? 'Service due today' : `Service ${r.ranOut ? 'was due' : 'due'} on ${dayLabel(r.expires)}${year}`
  if (r.expires === today) return `${what} runs out today`
  return `${what} ${r.ranOut ? 'ran' : 'runs'} out on ${dayLabel(r.expires)}${year}`
}

/** A check as the vehicle's page says it: its tone and its words. */
export function checkState(c: VehicleCheck, kind: CheckKind, today: string): { tone: 'bad' | 'warn' | 'quiet'; text: string } {
  if (!c.needed) return { tone: 'quiet', text: 'Not needed' }
  if (!c.expires) return { tone: 'warn', text: 'Not recorded' }
  const label = `${dayLabel(c.expires)} ${c.expires.slice(0, 4)}`
  if (c.expires < today) return { tone: kind === 'service' ? 'warn' : 'bad', text: kind === 'service' ? `Overdue since ${label}` : `Ran out ${label}` }
  if (daysBetween(today, c.expires) <= CHECK_SOON_DAYS) return { tone: 'warn', text: kind === 'service' ? `Due ${label}` : `Runs out ${label}` }
  return { tone: 'quiet', text: kind === 'service' ? `Due ${label}` : `Good to ${label}` }
}
