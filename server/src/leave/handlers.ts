import {
  allowanceId,
  canApproveLeave,
  dayLabel,
  daysLeft,
  HOLDS_DAYS,
  irishToday,
  leaveDays,
  leaveLabel,
  leaveSpanLabel,
  noAllowanceReason,
  noCancelReason,
  noOpenReason,
  notEnoughLeft,
  notOpenReason,
  requestsOverlap,
  yearOf,
  type CommandArgs,
  type Person,
} from '@sh/shared'
import { getAway, getPerson, personByEmail } from '../crew/store.ts'
import { emit, emitRemoved, Refused, type Ctx } from '../kernel.ts'
import { balanceFor, entriesFor, getAllowance, getEntry, getRequest, getYear, requestsFor } from './store.ts'

/**
 * Staff leave and time in lieu (ADR 0024). The rules the server keeps,
 * whatever device a change comes from:
 *
 * - only staff have leave, and a request is the person's own: with
 *   sign-in on, the signed-in account's email has to be theirs;
 * - leave is asked for only in a year an approver has opened, and only
 *   this year or next can be opened, or have allowances set;
 * - a request can't overlap the person's own waiting or approved ones,
 *   nor ask for more days than are left this year, and a day in lieu is
 *   logged once, for a day that has happened;
 * - deciding takes "Can approve time off", nobody decides their own,
 *   nothing is approved for someone archived since they asked, and only
 *   an approver sets an allowance;
 * - approved leave is days off under the request's own id, so the planner
 *   and offers see it; declining or cancelling takes them off again.
 *
 * Until sign-in is on there is no signed-in person, so the device says who
 * is deciding (`by`), as the rest of the app trusts a device today.
 */

type LeaveCommand = 'leave.request' | 'leave.cancel' | 'leave.decide' | 'lieu.log' | 'lieu.cancel' | 'lieu.decide' | 'leave.allowance' | 'leave.open'
type Handler<N extends LeaveCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

/**
 * The signed-in person, by the account's email matched to the Crew tab; undefined while sign-in is off. Someone
 * archived isn't matched, so where it says more than "put your email on" (deciding), `archived` is what they're told.
 */
async function signedInPerson(ctx: Ctx, archived?: string): Promise<Person | undefined> {
  if (!ctx.user) return undefined
  const me = await personByEmail(ctx.tx, ctx.user.email)
  if (me) return me
  if (archived && (await archivedByEmail(ctx, ctx.user.email))) throw new Refused({ code: 'forbidden', message: archived })
  throw new Refused({
    code: 'forbidden',
    message: `Your account, ${ctx.user.email}, isn't matched to anyone on the Crew tab. Put that email on your own person there first.`,
  })
}

/** Whether someone archived on the Crew tab has this email, as the account's email is matched to a person. */
async function archivedByEmail(ctx: Ctx, email: string) {
  const { rows } = await ctx.tx.query('SELECT 1 FROM people WHERE lower(trim(email)) = $1 AND archived LIMIT 1', [email.trim().toLowerCase()])
  return rows.length > 0
}

/** The person a request or an entry is for, who has to be staff and, with sign-in on, the signed-in person. */
async function ownPerson(ctx: Ctx, personId: string, what: 'leave' | 'a day in lieu'): Promise<Person> {
  const person = await getPerson(ctx.tx, personId)
  if (!person) throw new Refused({ code: 'not-found', message: 'That person no longer exists.' })
  if (person.archived) throw new Refused({ code: 'conflict', message: `${person.name} has been archived.` })
  if (person.kind !== 'staff')
    throw new Refused({ code: 'conflict', message: `Only staff have ${what === 'leave' ? 'leave' : 'days in lieu'}; freelancers mark days off on their link.` })
  const me = await signedInPerson(ctx)
  if (me && me.id !== person.id) throw new Refused({ code: 'forbidden', message: `You're signed in as ${me.name}, so you can only ask for your own ${what}.` })
  return person
}

/** Whoever is taking a request back: with sign-in on the signed-in person, otherwise whoever the device says, if it says. */
async function requester(ctx: Ctx, by: string | undefined, personId: string) {
  const me = await signedInPerson(ctx)
  if (me && by && by !== me.id) throw new Refused({ code: 'forbidden', message: `You're signed in as ${me.name}, so you can't act as someone else.` })
  const who = me?.id ?? by
  if (who && who !== personId) {
    const owner = await getPerson(ctx.tx, personId)
    throw new Refused({ code: 'forbidden', message: `Only ${owner?.name ?? "the person it's for"} can cancel their own request.` })
  }
}

/**
 * Who is deciding, or setting an allowance, or opening a year: the signed-in person, or `by` while sign-in is off,
 * with the flag either way. Someone archived can't approve, ticked or not, and is told so plainly: being told to
 * tick the box would send someone to tick one that's ticked already.
 */
async function approver(ctx: Ctx, by: string | undefined): Promise<Person> {
  const me = await signedInPerson(ctx, "You've been archived on the Crew tab, so you can't approve time off.")
  if (me) {
    if (by && by !== me.id) throw new Refused({ code: 'forbidden', message: `You're signed in as ${me.name}, so you can't act as someone else.` })
    if (!canApproveLeave(me))
      throw new Refused({ code: 'forbidden', message: 'Only someone who can approve time off can do this. Ask for "Can approve time off" to be ticked on your person on the Crew tab.' })
    return me
  }
  if (!by) throw new Refused({ code: 'forbidden', message: 'Say who you are first: pick your name on the Leave screen.' })
  const who = await getPerson(ctx.tx, by)
  if (!who) throw new Refused({ code: 'not-found', message: 'That person no longer exists.' })
  if (who.archived) throw new Refused({ code: 'forbidden', message: `${who.name} has been archived, so they can't approve time off.` })
  if (!canApproveLeave(who)) throw new Refused({ code: 'forbidden', message: `${who.name} can't approve time off. Tick "Can approve time off" on their person on the Crew tab.` })
  return who
}

const lieuWords = (days: number) => (days === 1 ? 'a day in lieu' : `${days} days in lieu`)

/** Nothing is approved for someone who has left since they asked, so no days off are written for them. */
async function stillHere(ctx: Ctx, personId: string, what: string) {
  const person = await getPerson(ctx.tx, personId)
  if (person?.archived) throw new Refused({ code: 'conflict', message: `${person.name} has been archived, so their ${what} can't be approved.` })
}

export const leaveHandlers: { [N in LeaveCommand]: Handler<N> } = {
  async 'leave.request'(ctx, a) {
    const person = await ownPerson(ctx, a.personId, 'leave')
    if (await getRequest(ctx.tx, a.id)) throw new Refused({ code: 'conflict', message: 'This request was already sent.' })
    // Each request belongs to one leave year, so the balances stay simple.
    if (yearOf(a.start) !== yearOf(a.end))
      throw new Refused({ code: 'invalid', message: "A request can't cross the year end: ask for December and January separately." })
    const year = yearOf(a.start)
    const open = !!(await getYear(ctx.tx, year))
    const shut = notOpenReason(year, () => open, irishToday())
    if (shut) throw new Refused({ code: 'conflict', message: shut })
    const days = leaveDays(a.start, a.end)
    if (days === 0) throw new Refused({ code: 'invalid', message: "There are no working days in that span: it's all weekend or public holidays." })
    const clash = (await requestsFor(ctx.tx, person.id, year)).find((r) => HOLDS_DAYS.includes(r.status) && requestsOverlap(r, a))
    if (clash)
      throw new Refused({
        code: 'conflict',
        message: `That overlaps the ${leaveLabel(clash.type, clash.days).toLowerCase()} ${clash.status === 'approved' ? 'approved' : 'asked'} for ${leaveSpanLabel(clash)}.`,
      })
    const balance = await balanceFor(ctx.tx, person.id, year, irishToday())
    if (days > daysLeft(balance, a.type)) throw new Refused({ code: 'conflict', message: notEnoughLeft(a.type, daysLeft(balance, a.type)) })
    await ctx.tx.query(
      `INSERT INTO leave_requests (id, person_id, type, start_day, end_day, days, note, status, requested_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'waiting', now())`,
      [a.id, person.id, a.type, a.start, a.end, days, a.note.trim()]
    )
    await emit(ctx, 'leaveRequest', a.id, await getRequest(ctx.tx, a.id))
  },

  async 'leave.cancel'(ctx, a) {
    const r = await getRequest(ctx.tx, a.id, true)
    if (!r) throw new Refused({ code: 'not-found', message: 'That request no longer exists.' })
    await requester(ctx, a.by, r.personId)
    // Cancelled once is cancelled: a second device's Cancel changes nothing.
    if (r.status === 'cancelled') return
    const why = noCancelReason(r, irishToday())
    if (why) throw new Refused({ code: 'conflict', message: why })
    await ctx.tx.query(`UPDATE leave_requests SET status = 'cancelled' WHERE id = $1`, [r.id])
    await emit(ctx, 'leaveRequest', r.id, await getRequest(ctx.tx, r.id))
    await takeDaysOff(ctx, r.id)
  },

  async 'leave.decide'(ctx, a) {
    const r = await getRequest(ctx.tx, a.id, true)
    if (!r) throw new Refused({ code: 'not-found', message: 'That request no longer exists.' })
    const who = await approver(ctx, a.by)
    if (who.id === r.personId) throw new Refused({ code: 'forbidden', message: "You can't decide your own request; another approver has to." })
    if (r.status !== 'waiting') {
      // The same decision again, as a phone sending twice does, changes nothing: the first decider's name stays, even when another approver sent it.
      if (r.status === (a.approved ? 'approved' : 'declined')) return
      throw new Refused({ code: 'conflict', message: `This request was already ${r.status}.` })
    }
    if (a.approved) {
      await stillHere(ctx, r.personId, 'leave')
      // Another request may have been approved since this one was asked for.
      const balance = await balanceFor(ctx.tx, r.personId, yearOf(r.start), irishToday())
      if (r.days > daysLeft(balance, r.type)) throw new Refused({ code: 'conflict', message: notEnoughLeft(r.type, daysLeft(balance, r.type)) })
    }
    await ctx.tx.query(`UPDATE leave_requests SET status = $2, decided_by = $3, decided_at = now(), reason = $4 WHERE id = $1`, [
      r.id,
      a.approved ? 'approved' : 'declined',
      who.id,
      a.reason.trim(),
    ])
    await emit(ctx, 'leaveRequest', r.id, await getRequest(ctx.tx, r.id))
    if (!a.approved) return
    // Approved leave is days off, under the request's own id, so the planner shows it and offers warn.
    await ctx.tx.query(
      `INSERT INTO unavailability (id, person_id, start_day, end_day, note, source) VALUES ($1, $2, $3, $4, $5, 'leave') ON CONFLICT (id) DO NOTHING`,
      [r.id, r.personId, r.start, r.end, leaveLabel(r.type, r.days)]
    )
    await emit(ctx, 'unavailability', r.id, await getAway(ctx.tx, r.id))
  },

  async 'lieu.log'(ctx, a) {
    const person = await ownPerson(ctx, a.personId, 'a day in lieu')
    if (await getEntry(ctx.tx, a.id)) throw new Refused({ code: 'conflict', message: 'This day in lieu was already logged.' })
    if (a.day > irishToday()) throw new Refused({ code: 'invalid', message: `${dayLabel(a.day)} hasn't come yet: log a day in lieu once it's worked.` })
    const twice = (await entriesFor(ctx.tx, person.id, yearOf(a.day))).find((e) => e.day === a.day && HOLDS_DAYS.includes(e.status))
    if (twice) throw new Refused({ code: 'conflict', message: `${dayLabel(a.day)} is already logged${twice.status === 'approved' ? ' and approved' : ''}.` })
    await ctx.tx.query(`INSERT INTO lieu_entries (id, person_id, day, days, note, status, logged_at) VALUES ($1, $2, $3, $4, $5, 'waiting', now())`, [
      a.id,
      person.id,
      a.day,
      a.days,
      a.note.trim(),
    ])
    await emit(ctx, 'lieuEntry', a.id, await getEntry(ctx.tx, a.id))
  },

  async 'lieu.cancel'(ctx, a) {
    const e = await getEntry(ctx.tx, a.id, true)
    if (!e) throw new Refused({ code: 'not-found', message: 'That day in lieu no longer exists.' })
    await requester(ctx, a.by, e.personId)
    if (e.status === 'cancelled') return
    if (e.status === 'declined') throw new Refused({ code: 'conflict', message: "This day in lieu was declined, so there's nothing to cancel." })
    if (e.status === 'approved') {
      // Days already taken as leave can't be un-earned.
      const balance = await balanceFor(ctx.tx, e.personId, yearOf(e.day), irishToday())
      if (balance.lieu.left < e.days)
        throw new Refused({ code: 'conflict', message: `${e.days === 1 ? 'That day has' : 'Those days have'} already been taken as leave, so this can't be cancelled.` })
    }
    await ctx.tx.query(`UPDATE lieu_entries SET status = 'cancelled' WHERE id = $1`, [e.id])
    await emit(ctx, 'lieuEntry', e.id, await getEntry(ctx.tx, e.id))
  },

  async 'lieu.decide'(ctx, a) {
    const e = await getEntry(ctx.tx, a.id, true)
    if (!e) throw new Refused({ code: 'not-found', message: 'That day in lieu no longer exists.' })
    const who = await approver(ctx, a.by)
    if (who.id === e.personId) throw new Refused({ code: 'forbidden', message: `You can't approve your own ${lieuWords(e.days)}; another approver has to.` })
    if (e.status !== 'waiting') {
      if (e.status === (a.approved ? 'approved' : 'declined')) return
      throw new Refused({ code: 'conflict', message: `This day in lieu was already ${e.status}.` })
    }
    if (a.approved) await stillHere(ctx, e.personId, 'day in lieu')
    await ctx.tx.query(`UPDATE lieu_entries SET status = $2, decided_by = $3, decided_at = now(), reason = $4 WHERE id = $1`, [
      e.id,
      a.approved ? 'approved' : 'declined',
      who.id,
      a.reason.trim(),
    ])
    await emit(ctx, 'lieuEntry', e.id, await getEntry(ctx.tx, e.id))
  },

  async 'leave.allowance'(ctx, a) {
    await approver(ctx, a.by)
    const person = await getPerson(ctx.tx, a.personId)
    if (!person) throw new Refused({ code: 'not-found', message: 'That person no longer exists.' })
    if (person.kind !== 'staff') throw new Refused({ code: 'conflict', message: `Only staff have an allowance; ${person.name} is a freelancer.` })
    // Next year's can be set before it opens, so it's ready on the day.
    const far = noAllowanceReason(a.year, irishToday())
    if (far) throw new Refused({ code: 'invalid', message: far })
    const id = allowanceId(person.id, a.year)
    await ctx.tx.query(
      `INSERT INTO leave_allowances (id, person_id, year, days, carried_over, note) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET days = EXCLUDED.days, carried_over = EXCLUDED.carried_over, note = EXCLUDED.note`,
      [id, person.id, a.year, a.days, a.carriedOver, a.note.trim()]
    )
    await emit(ctx, 'leaveAllowance', id, await getAllowance(ctx.tx, person.id, a.year))
  },

  async 'leave.open'(ctx, a) {
    await approver(ctx, a.by)
    // Open is open: a second approver, or a phone sending twice, changes nothing, even once the year has gone by.
    if (await getYear(ctx.tx, a.year)) return
    const far = noOpenReason(a.year, irishToday())
    if (far) throw new Refused({ code: 'invalid', message: far })
    await ctx.tx.query(`INSERT INTO leave_years (year, opened_at) VALUES ($1, now())`, [a.year])
    await emit(ctx, 'leaveYear', String(a.year), await getYear(ctx.tx, a.year))
  },
}

/** The days off an approved request wrote, if any, taken off again. */
async function takeDaysOff(ctx: Ctx, requestId: string) {
  const { rows } = await ctx.tx.query(`DELETE FROM unavailability WHERE id = $1 AND source = 'leave' RETURNING id`, [requestId])
  if (rows.length) await emitRemoved(ctx, 'unavailability', requestId)
}
