import type { Vehicle, VehicleBooking } from '@sh/shared'
import type { Queryable } from '../db.ts'

/** Reading vehicles and their bookings back as devices see them (ADR 0047). */

const VEHICLE = `id, name, registration, kind, seats, payload_kg, notes, checks, off_since::text, off_until::text, off_note, archived`
const BOOKING = `id, vehicle_id, project_id, phase_id, start_day::text, end_day::text, driver_id, notes, override`

type Row = Record<string, any>

export const toVehicle = (r: Row): Vehicle => ({
  id: r.id,
  name: r.name,
  registration: r.registration,
  kind: r.kind,
  seats: r.seats ?? null,
  payloadKg: r.payload_kg ?? null,
  notes: r.notes,
  checks: r.checks ?? {},
  outOfService: r.off_since ? { since: r.off_since, until: r.off_until ?? null, note: r.off_note } : null,
  archived: r.archived,
})

export const toBooking = (r: Row): VehicleBooking => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  projectId: r.project_id,
  phaseId: r.phase_id ?? null,
  start: r.start_day,
  end: r.end_day,
  driverId: r.driver_id ?? null,
  notes: r.notes,
  override: r.override,
})

export async function getVehicle(q: Queryable, id: string, lock = false) {
  const { rows } = await q.query(`SELECT ${VEHICLE} FROM vehicles WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])
  return rows[0] ? toVehicle(rows[0]) : undefined
}

export async function getBooking(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${BOOKING} FROM vehicle_bookings WHERE id = $1`, [id])
  return rows[0] ? toBooking(rows[0]) : undefined
}

/**
 * A vehicle's other bookings that share a day with these, on jobs going
 * ahead or pencilled in, with each job's name and whether it's confirmed:
 * a cancelled or lost job's booking holds nothing.
 */
export async function bookingsOverlapping(q: Queryable, vehicleId: string, start: string, end: string, except: string) {
  const { rows } = await q.query<{ id: string; name: string; status: string; start_day: string; end_day: string }>(
    `SELECT b.id, p.name, p.status, b.start_day::text, b.end_day::text FROM vehicle_bookings b JOIN projects p ON p.id = b.project_id
      WHERE b.vehicle_id = $1 AND b.id <> $4 AND b.start_day <= $3::date AND b.end_day >= $2::date AND p.status NOT IN ('cancelled', 'lost')
      ORDER BY b.start_day, b.id`,
    [vehicleId, start, end, except]
  )
  return rows
}

/** "Big Van, the Luton": the vehicles booked on a phase, for refusing to remove it. */
export async function vehiclesOnPhase(q: Queryable, phaseId: string): Promise<string[]> {
  const { rows } = await q.query<{ name: string }>(
    `SELECT v.name FROM vehicle_bookings b JOIN vehicles v ON v.id = b.vehicle_id WHERE b.phase_id = $1 ORDER BY v.name, b.id`,
    [phaseId]
  )
  return rows.map((r) => r.name)
}

/** A phase's own vehicles and the whole job's, for its call sheet, with who drives. */
export async function vehiclesFor(q: Queryable, projectId: string, phaseId: string | null) {
  const { rows } = await q.query<{ name: string; registration: string; start_day: string; end_day: string; driver: string | null; notes: string }>(
    `SELECT v.name, v.registration, b.start_day::text, b.end_day::text, d.name AS driver, b.notes
       FROM vehicle_bookings b JOIN vehicles v ON v.id = b.vehicle_id LEFT JOIN people d ON d.id = b.driver_id
      WHERE b.project_id = $1 AND (b.phase_id IS NULL OR b.phase_id = $2)
      ORDER BY b.start_day, v.name, b.id`,
    [projectId, phaseId]
  )
  return rows
}
