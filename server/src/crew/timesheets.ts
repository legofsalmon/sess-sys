import { daysLabel, eachDay, irishToday, noTimesheetReason, type CommandArgs, type CrewCall, type Timesheet } from '@sh/shared'
import type { Queryable } from '../db.ts'
import { emit, Refused, type Ctx } from '../kernel.ts'
import { getCall, getOffer, getPerson } from './store.ts'

/**
 * Timesheets (ADR 0022): the days a freelancer worked on a booking, at the
 * booking's day rate, and their extras. The rules hold wherever a timesheet
 * comes from, the freelancer's link or the app:
 *
 * - only a freelancer's confirmed booking, on a job going ahead, has one,
 *   and only from its first day;
 * - on their link, a freelancer ticks their own booked days; the office
 *   can put in any of the job's days, for work done beyond the booking;
 * - once approved it's settled: the office reopens it to change it.
 */

type Row = Record<string, any>

const TIMESHEET = `id, status, days, day_rate_cents, extras, sent, note, office_note, sent_at, sent_via, approved_at`

const toTimesheet = (r: Row): Timesheet => ({
  id: r.id,
  status: r.status,
  days: r.days,
  dayRateCents: r.day_rate_cents,
  extras: r.extras,
  sent: r.sent,
  note: r.note,
  officeNote: r.office_note,
  sentAt: new Date(r.sent_at).toISOString(),
  sentVia: r.sent_via,
  approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
})

export async function getTimesheet(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${TIMESHEET} FROM timesheets WHERE id = $1`, [id])
  return rows[0] ? toTimesheet(rows[0]) : undefined
}

/** A person's timesheets, by their booking's offer. */
export async function timesheetsFor(q: Queryable, personId: string): Promise<Map<string, Timesheet>> {
  const { rows } = await q.query(
    `SELECT ${TIMESHEET.split(', ').map((c) => `t.${c}`).join(', ')}
       FROM timesheets t JOIN offers o ON o.id = t.id WHERE o.person_id = $1`,
    [personId]
  )
  return new Map(rows.map((r) => [r.id as string, toTimesheet(r)]))
}

/**
 * The booking a timesheet is for, and the days it can have: any of the
 * job's, from its first phase to its last, as someone booked for the show
 * may have come in for the build too; or the call's, for one not in Jobs.
 */
async function bookingFor(ctx: Ctx, offerId: string) {
  const offer = await getOffer(ctx.tx, offerId)
  const call = offer && (await getCall(ctx.tx, offer.callId))
  if (!offer || !call) throw new Refused({ code: 'not-found', message: 'That booking no longer exists.' })
  let [start, end] = [call.start, call.end]
  if (call.projectId) {
    const { rows } = await ctx.tx.query<{ s: string | null; e: string | null }>(
      'SELECT min(start_day)::text AS s, max(end_day)::text AS e FROM phases WHERE project_id = $1',
      [call.projectId]
    )
    if (rows[0]?.s && rows[0].s < start) start = rows[0].s
    if (rows[0]?.e && rows[0].e > end) end = rows[0].e
  }
  return { offer, call, jobDays: eachDay(start, end) }
}

const notTheJobs = (call: CrewCall) => (d: string[]) => `${daysLabel(d)} ${d.length === 1 ? "isn't" : "aren't"} part of ${call.project}.`

function checkDays(days: string[], allowed: string[], notAllowed: (d: string[]) => string) {
  const outside = days.filter((d) => !allowed.includes(d))
  if (outside.length) throw new Refused({ code: 'invalid', message: notAllowed(outside) })
}

/** Approving again with the same figures, as a phone sending twice does. */
const figures = (t: Pick<Timesheet, 'days' | 'dayRateCents' | 'extras' | 'officeNote'>) =>
  JSON.stringify([[...new Set(t.days)].sort(), t.dayRateCents, t.extras.map((e) => [e.what, e.cents]), t.officeNote.trim()])

async function emitTimesheet(ctx: Ctx, id: string) {
  await emit(ctx, 'timesheet', id, await getTimesheet(ctx.tx, id))
}

type TimesheetCommand = 'timesheet.send' | 'timesheet.approve' | 'timesheet.reopen'
type Handler<N extends TimesheetCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

export const timesheetHandlers: { [N in TimesheetCommand]: Handler<N> } = {
  async 'timesheet.send'(ctx, a) {
    const { offer, call, jobDays } = await bookingFor(ctx, a.id)
    const was = await getTimesheet(ctx.tx, a.id)
    if (was?.status === 'approved')
      throw new Refused({ code: 'conflict', message: 'The office has already approved this timesheet. Ask them to reopen it if something needs to change.' })
    if (!was) {
      const why = noTimesheetReason(offer, call, await getPerson(ctx.tx, offer.personId), irishToday())
      if (why) throw new Refused({ code: 'conflict', message: why })
    }
    const days = [...new Set(a.days)].sort()
    if (ctx.via === 'link')
      checkDays(days, offer.days, (d) => `${daysLabel(d)} ${d.length === 1 ? "wasn't one of your booked days" : "weren't among your booked days"}. Ask the office to add ${d.length === 1 ? 'it' : 'them'}.`)
    else checkDays(days, jobDays, notTheJobs(call))
    const rate = was ? was.dayRateCents : offer.dayRateCents
    const sent = { days, dayRateCents: rate, extras: a.extras }
    await ctx.tx.query(
      `INSERT INTO timesheets (id, status, days, day_rate_cents, extras, sent, note, sent_at, sent_via)
       VALUES ($1, 'sent', $2, $3, $4, $5, $6, now(), $7)
       ON CONFLICT (id) DO UPDATE SET days = EXCLUDED.days, extras = EXCLUDED.extras, sent = EXCLUDED.sent,
         note = EXCLUDED.note, sent_at = EXCLUDED.sent_at, sent_via = EXCLUDED.sent_via`,
      [a.id, JSON.stringify(days), rate, JSON.stringify(a.extras), JSON.stringify(sent), a.note.trim(), ctx.via === 'link' ? 'link' : 'app']
    )
    await emitTimesheet(ctx, a.id)
  },

  async 'timesheet.approve'(ctx, a) {
    const { call, jobDays } = await bookingFor(ctx, a.id)
    const was = await getTimesheet(ctx.tx, a.id)
    if (!was) throw new Refused({ code: 'not-found', message: "There's no timesheet for this booking yet: put one in first." })
    if (was.status === 'approved') {
      if (figures(was) === figures(a)) return
      throw new Refused({ code: 'conflict', message: 'This timesheet has already been approved, with other figures. Reopen it to change it.' })
    }
    const days = [...new Set(a.days)].sort()
    checkDays(days, jobDays, notTheJobs(call))
    await ctx.tx.query(
      `UPDATE timesheets SET status = 'approved', days = $2, day_rate_cents = $3, extras = $4, office_note = $5, approved_at = now() WHERE id = $1`,
      [a.id, JSON.stringify(days), a.dayRateCents, JSON.stringify(a.extras), a.officeNote.trim()]
    )
    await emitTimesheet(ctx, a.id)
  },

  async 'timesheet.reopen'(ctx, a) {
    const was = await getTimesheet(ctx.tx, a.id)
    if (!was) throw new Refused({ code: 'not-found', message: "There's no timesheet for this booking." })
    if (was.status !== 'approved') return
    await ctx.tx.query(`UPDATE timesheets SET status = 'sent', approved_at = NULL WHERE id = $1`, [a.id])
    await emitTimesheet(ctx, a.id)
  },
}
