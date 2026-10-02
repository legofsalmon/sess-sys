import { HOLDING, noLateReason, type CommandArgs, type RunningLate } from '@sh/shared'
import type { Queryable } from '../db.ts'
import { emit, Refused, type Ctx } from '../kernel.ts'
import { getCall, getOffer } from './store.ts'

/**
 * Running late (ADR 0028): said on a person's private link on a day they
 * hold, from 6pm the evening before to the end of the day, changed as
 * often as they like, and closed when they say they're there. The office
 * notes it from the Crew tab. One record for a booking and a day.
 */

const LATE = `id, person_id, offer_id, call_id, day::text, late_by, arrive_at, note, said_at, arrived_at, seen_at`

type Row = Record<string, any>

const at = (v: unknown) => (v ? new Date(v as string).toISOString() : null)

export const toLate = (r: Row): RunningLate => ({
  id: r.id,
  personId: r.person_id,
  offerId: r.offer_id,
  callId: r.call_id,
  day: r.day,
  by: r.late_by ?? null,
  arriveAt: r.arrive_at ?? null,
  note: r.note,
  saidAt: at(r.said_at)!,
  arrivedAt: at(r.arrived_at),
  seenAt: at(r.seen_at),
})

export async function getLate(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${LATE} FROM running_late WHERE id = $1`, [id])
  return rows[0] ? toLate(rows[0]) : undefined
}

/** A booking's record for a day, if they've said anything. */
export async function lateFor(q: Queryable, offerId: string, day: string) {
  const { rows } = await q.query(`SELECT ${LATE} FROM running_late WHERE offer_id = $1 AND day = $2::date`, [offerId, day])
  return rows[0] ? toLate(rows[0]) : undefined
}

/** Everything a person has said about running late, by day: for their link page, and their own download. */
export async function lateOf(q: Queryable, personId: string) {
  const { rows } = await q.query(`SELECT ${LATE} FROM running_late WHERE person_id = $1 ORDER BY day, said_at`, [personId])
  return rows.map(toLate)
}

/** The records still showing on these bookings: their day not over yet. */
export async function lateOnOffers(q: Queryable, offerIds: readonly string[], today: string) {
  if (offerIds.length === 0) return []
  const { rows } = await q.query(`SELECT ${LATE} FROM running_late WHERE offer_id = ANY($1::text[]) AND day >= $2::date ORDER BY day, said_at`, [[...offerIds], today])
  return rows.map(toLate)
}

async function emitLate(ctx: Ctx, id: string) {
  await emit(ctx, 'runningLate', id, await getLate(ctx.tx, id))
}

type LateCommand = 'late.say' | 'late.arrived' | 'late.seen'
type Handler<N extends LateCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

export const lateHandlers: { [N in LateCommand]: Handler<N> } = {
  async 'late.say'(ctx, a) {
    const offer = await getOffer(ctx.tx, a.offerId)
    if (!offer) throw new Refused({ code: 'not-found', message: 'That booking no longer exists.' })
    const call = await getCall(ctx.tx, offer.callId)
    // Only a place they hold, on a job going ahead: someone offered, or let go, has no day to be late for.
    if (!call || call.status !== 'open' || !HOLDING.includes(offer.status)) throw new Refused({ code: 'conflict', message: "You're not booked on this one any more, so there's nothing to be late for." })
    const why = noLateReason(offer.days, a.day)
    if (why) throw new Refused({ code: 'conflict', message: why })
    // Said again, it replaces what was said, and it's new to the office again; saying it after "I'm here" means they're late after all.
    const was = await lateFor(ctx.tx, offer.id, a.day)
    // The id is the device's to choose, so one already used for another booking or day would write over that one.
    if (!was && (await getLate(ctx.tx, a.id))) throw new Refused({ code: 'conflict', message: 'That running late is for another booking or day.' })
    const id = was?.id ?? a.id
    await ctx.tx.query(
      `INSERT INTO running_late (id, person_id, offer_id, call_id, day, late_by, arrive_at, note, said_at, arrived_at, seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), NULL, NULL)
       ON CONFLICT (id) DO UPDATE SET late_by = EXCLUDED.late_by, arrive_at = EXCLUDED.arrive_at, note = EXCLUDED.note,
         said_at = EXCLUDED.said_at, arrived_at = NULL, seen_at = NULL`,
      [id, offer.personId, offer.id, call.id, a.day, a.by, a.arriveAt, a.note.trim()]
    )
    await emitLate(ctx, id)
  },

  async 'late.arrived'(ctx, a) {
    const late = await getLate(ctx.tx, a.id)
    if (!late) throw new Refused({ code: 'not-found', message: "There's nothing to say you're there for." })
    // There once is there: a second tap changes nothing.
    if (late.arrivedAt) return
    await ctx.tx.query('UPDATE running_late SET arrived_at = now() WHERE id = $1', [late.id])
    await emitLate(ctx, late.id)
  },

  async 'late.seen'(ctx, a) {
    const late = await getLate(ctx.tx, a.id)
    if (!late) throw new Refused({ code: 'not-found', message: 'That running late is no longer there.' })
    // Noted once is noted, as for answers: a second device's Noted changes nothing.
    if (late.seenAt) return
    await ctx.tx.query('UPDATE running_late SET seen_at = now() WHERE id = $1', [late.id])
    await emitLate(ctx, late.id)
  },
}
