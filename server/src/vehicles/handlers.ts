import {
  dayLabel,
  driverRefusal,
  ERASED_REFUSAL,
  irishToday,
  offRoadLine,
  offRoadOn,
  spanLabel,
  STATUS_LABELS,
  STOPPED,
  vehicleName,
  vehicleRefusal,
  type CommandArgs,
  type VehicleBooking,
} from '@sh/shared'
import { getPerson } from '../crew/store.ts'
import { readErasure } from '../erasure/places.ts'
import { emit, emitRemoved, Refused, type Ctx } from '../kernel.ts'
import { getPhase, getProject } from '../projects/store.ts'
import { bookingsOverlapping, getBooking, getVehicle } from './store.ts'

/**
 * Vans and drivers (ADR 0047). A road check run out on a day it's booked,
 * and a driver with no licence or one run out, are refused by name with
 * the fix, whatever is sent: they're the law, and the way past is to
 * correct the record. Another job on the same vehicle that day, or a day
 * off the road, is the office's judgement: refused until the booking says
 * to book it anyway, as an offer to someone already booked is (ADR 0010).
 * Nothing is undone later: a check or a licence that lapses after a
 * booking is warned about on the booking and in the planner.
 */

async function emitVehicle(ctx: Ctx, id: string) {
  await emit(ctx, 'vehicle', id, await getVehicle(ctx.tx, id))
}
async function emitBooking(ctx: Ctx, id: string) {
  await emit(ctx, 'vehicleBooking', id, await getBooking(ctx.tx, id))
}

async function mustVehicle(ctx: Ctx, id: string, lock = false) {
  const v = await getVehicle(ctx.tx, id, lock)
  if (!v) throw new Refused({ code: 'not-found', message: 'That vehicle is no longer in the app.' })
  return v
}

/**
 * A booking as it will be, checked: what changed since `was` (all of it
 * for a new one). The job, its phase, the vehicle's road checks and the
 * driver's licence are refused outright; a clash only without `override`.
 */
async function checkBooking(ctx: Ctx, b: VehicleBooking, was?: VehicleBooking) {
  const today = irishToday()
  const job = await getProject(ctx.tx, b.projectId)
  if (!job) throw new Refused({ code: 'not-found', message: 'That job is no longer in the app.' })
  if (!was && STOPPED.includes(job.status))
    throw new Refused({ code: 'conflict', message: `${job.name} is ${STATUS_LABELS[job.status].toLowerCase()}, so it needs no vehicle.` })
  if (b.phaseId && b.phaseId !== was?.phaseId) {
    const phase = await getPhase(ctx.tx, b.phaseId)
    if (!phase || phase.projectId !== b.projectId) throw new Refused({ code: 'not-found', message: `That phase is no longer part of ${job.name}.` })
  }
  const v = await mustVehicle(ctx, b.vehicleId)
  const moved = !was || was.vehicleId !== b.vehicleId || was.start !== b.start || was.end !== b.end
  if (moved) {
    const refused = vehicleRefusal(v, b.start, b.end, today)
    if (refused) throw new Refused({ code: 'conflict', message: refused })
  }
  if (b.driverId && (moved || was?.driverId !== b.driverId)) {
    const driver = await getPerson(ctx.tx, b.driverId)
    if (!driver) throw new Refused({ code: 'not-found', message: "That driver isn't in the app any more." })
    if (await readErasure(ctx.tx, b.driverId)) throw new Refused({ code: 'conflict', message: ERASED_REFUSAL })
    const no = driverRefusal(driver, b.start, b.end, today)
    if (no) throw new Refused({ code: 'conflict', message: no })
  }
  if (moved && !b.override && !STOPPED.includes(job.status)) {
    const other = (await bookingsOverlapping(ctx.tx, b.vehicleId, b.start, b.end, b.id))[0]
    if (other) {
      const start = other.start_day > b.start ? other.start_day : b.start
      const end = other.end_day < b.end ? other.end_day : b.end
      throw new Refused({
        code: 'clash',
        message: `${vehicleName(v)} is already on ${other.name} on ${spanLabel({ start, end })}. Book it anyway to have it on both.`,
      })
    }
    if (offRoadOn(v, b.start, b.end, today)) throw new Refused({ code: 'clash', message: `${offRoadLine(v)} Book it anyway if it will be back in time.` })
  }
}

type VehicleCommand = 'vehicle.save' | 'vehicle.offRoad' | 'vehicle.archive' | 'vehicleBooking.add' | 'vehicleBooking.update' | 'vehicleBooking.remove'
type Handler<N extends VehicleCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

export const vehicleHandlers: { [N in VehicleCommand]: Handler<N> } = {
  async 'vehicle.save'(ctx, a) {
    await ctx.tx.query(
      `INSERT INTO vehicles (id, name, registration, kind, seats, payload_kg, notes, checks) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, registration = EXCLUDED.registration, kind = EXCLUDED.kind, seats = EXCLUDED.seats,
         payload_kg = EXCLUDED.payload_kg, notes = EXCLUDED.notes, checks = EXCLUDED.checks`,
      [a.id, a.name.trim(), a.registration.trim().toUpperCase(), a.kind, a.seats, a.payloadKg, a.notes.trim(), JSON.stringify(a.checks)]
    )
    await emitVehicle(ctx, a.id)
  },

  async 'vehicle.offRoad'(ctx, a) {
    await mustVehicle(ctx, a.id, true)
    await ctx.tx.query('UPDATE vehicles SET off_since = $2, off_until = $3, off_note = $4 WHERE id = $1', [
      a.id,
      a.out?.since ?? null,
      a.out?.until ?? null,
      a.out?.note.trim() ?? '',
    ])
    await emitVehicle(ctx, a.id)
  },

  async 'vehicle.archive'(ctx, a) {
    const v = await mustVehicle(ctx, a.id, true)
    if (v.archived === a.archived) return
    if (a.archived) {
      const { rows } = await ctx.tx.query<{ name: string; start_day: string }>(
        `SELECT p.name, b.start_day::text FROM vehicle_bookings b JOIN projects p ON p.id = b.project_id
          WHERE b.vehicle_id = $1 AND b.end_day >= $2::date AND p.status NOT IN ('cancelled', 'lost') ORDER BY b.start_day, b.id LIMIT 1`,
        [a.id, irishToday()]
      )
      if (rows[0]) throw new Refused({ code: 'conflict', message: `${v.name} is booked on ${rows[0].name} from ${dayLabel(rows[0].start_day)}. Take it off that job first.` })
    }
    await ctx.tx.query('UPDATE vehicles SET archived = $2 WHERE id = $1', [a.id, a.archived])
    await emitVehicle(ctx, a.id)
  },

  async 'vehicleBooking.add'(ctx, a) {
    // Sent twice by the same phone: it's booked already.
    if (await getBooking(ctx.tx, a.id)) return
    await checkBooking(ctx, a)
    await ctx.tx.query(
      `INSERT INTO vehicle_bookings (id, vehicle_id, project_id, phase_id, start_day, end_day, driver_id, notes, override) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [a.id, a.vehicleId, a.projectId, a.phaseId, a.start, a.end, a.driverId, a.notes.trim(), a.override]
    )
    await emitBooking(ctx, a.id)
  },

  async 'vehicleBooking.update'(ctx, a) {
    const was = await getBooking(ctx.tx, a.id)
    if (!was) throw new Refused({ code: 'not-found', message: 'That booking is no longer there.' })
    const next: VehicleBooking = {
      ...was,
      ...Object.fromEntries(Object.entries(a).filter(([k, v]) => k !== 'id' && v !== undefined)),
      notes: (a.notes ?? was.notes).trim(),
      override: a.override ?? false,
    }
    // Checked as it will be: dates changed on their own can leave it ending before it starts.
    if (next.start > next.end) throw new Refused({ code: 'invalid', message: 'The booking ends before it starts.' })
    await checkBooking(ctx, next, was)
    await ctx.tx.query(
      `UPDATE vehicle_bookings SET vehicle_id = $2, phase_id = $3, start_day = $4, end_day = $5, driver_id = $6, notes = $7, override = override OR $8 WHERE id = $1`,
      [a.id, next.vehicleId, next.phaseId, next.start, next.end, next.driverId, next.notes, next.override]
    )
    await emitBooking(ctx, a.id)
  },

  async 'vehicleBooking.remove'(ctx, a) {
    // Taken off once is taken off: a second device's Remove finds nothing to do.
    const { rows } = await ctx.tx.query('DELETE FROM vehicle_bookings WHERE id = $1 RETURNING id', [a.id])
    if (rows.length) await emitRemoved(ctx, 'vehicleBooking', a.id)
  },
}
