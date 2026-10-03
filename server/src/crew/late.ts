import { HOLDING, irishToday, lateGoneReason, lateGoneUpTo, noLateReason, type CommandArgs, type RunningLate } from '@sh/shared'
import type { Db, Queryable } from '../db.ts'
import { LATE_CLEARED_ACTION } from '../history.ts'
import { emit, emitRemoved, Refused, serverChange, type Ctx } from '../kernel.ts'
import { getCall, getOffer, getPerson } from './store.ts'

/**
 * Running late (ADR 0028): said on a person's private link on a day they
 * hold, from 6pm the evening before to the end of the day, changed as
 * often as they like, and closed when they say they're there. The office
 * notes it from the Crew tab, and says it for someone who rang, under the
 * same rules. One record for a booking and a day, kept 30 days after it.
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
    // From the app it's the office noting it for someone who rang, so the same rules are said about them by name.
    const who = ctx.via === 'link' ? undefined : ((await getPerson(ctx.tx, offer.personId))?.name ?? 'Someone')
    // Only a place they hold, on a job going ahead: someone offered, or let go, has no day to be late for.
    if (!call || call.status !== 'open' || !HOLDING.includes(offer.status)) throw new Refused({ code: 'conflict', message: lateGoneReason(who) })
    const why = noLateReason(offer.days, a.day, new Date(), who)
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
    if (!late) throw new Refused({ code: 'not-found', message: ctx.via === 'link' ? "There's nothing to say you're there for." : 'That running late is no longer there.' })
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

/** Found under the lock with nothing left to clear: the change, and its entry in the history, are rolled back. */
class NothingToClear extends Error {}

/**
 * The day a stored "running late" was about: the day it names, but no
 * later than the day after it came in. None can be said further ahead
 * than that, so one turned down for a day years off, or for no real day,
 * still loses its note a month on.
 */
const SAID_FOR = `LEAST(CASE WHEN args->>'day' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN args->>'day' END,
  to_char((received_at AT TIME ZONE 'Europe/Dublin')::date + 1, 'YYYY-MM-DD'))`

/**
 * Running late 30 days after its day (ADR 0028, amended): no law asks for
 * it and it holds the person's own words, so the record goes, every
 * earlier copy of it in the change feed becomes a deletion, devices are
 * told, and the note goes from each stored "running late" for that day,
 * so the history reads without it, as after an erasure. "They're there"
 * and "Noted" carry only the record's id, so each is given the booking's
 * id as the record goes, and the history still says whose it was and for
 * which job. One server change, in the history with no name. It looks
 * again under the lock every change takes, so a second run, or another
 * copy of the server at the same moment, finds nothing and changes
 * nothing. Answers how many records went.
 */
export async function clearOldLate(db: Db, today = irishToday()): Promise<number> {
  const last = lateGoneUpTo(today)
  const due = async (q: Queryable) =>
    (
      await q.query(
        `SELECT EXISTS (SELECT 1 FROM running_late WHERE day <= $1::date)
             OR EXISTS (SELECT 1 FROM mutations WHERE name = 'late.say' AND coalesce(args->>'note', '') <> '' AND ${SAID_FOR} <= $1::text) AS due`,
        [last]
      )
    ).rows[0]?.due === true
  // Most days there's nothing, and that costs one read, without the lock or a history entry.
  if (!(await due(db))) return 0
  try {
    return await serverChange(db, { name: LATE_CLEARED_ACTION, args: {} }, async (ctx) => {
      if (!(await due(ctx.tx))) throw new NothingToClear()
      const { rows } = await ctx.tx.query<{ id: string; offer_id: string }>(`DELETE FROM running_late WHERE day <= $1::date RETURNING id, offer_id`, [last])
      const ids = rows.map((r) => r.id)
      if (ids.length) {
        await ctx.tx.query(`UPDATE changes SET op = 'delete', data = NULL WHERE entity = 'runningLate' AND entity_id = ANY($1::text[])`, [ids])
        await ctx.tx.query(
          `UPDATE mutations m SET args = m.args || jsonb_build_object('offerId', g.offer_id)
             FROM unnest($1::text[], $2::text[]) AS g(id, offer_id)
            WHERE m.name IN ('late.arrived', 'late.seen') AND m.args->>'id' = g.id AND m.args->>'offerId' IS NULL`,
          [ids, rows.map((r) => r.offer_id)]
        )
      }
      await ctx.tx.query(`UPDATE mutations SET args = args || '{"note": ""}'::jsonb WHERE name = 'late.say' AND coalesce(args->>'note', '') <> '' AND ${SAID_FOR} <= $1::text`, [last])
      for (const id of ids) await emitRemoved(ctx, 'runningLate', id)
      return ids.length
    })
  } catch (err) {
    if (err instanceof NothingToClear) return 0
    throw err
  }
}
