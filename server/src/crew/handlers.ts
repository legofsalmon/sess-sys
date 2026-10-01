import { randomBytes } from 'node:crypto'
import { daysBetween, daysLabel, eachDay, irishToday, LIVE, movedCallSpan, offerDaysAfter, STOPPED, type CommandArgs, type CrewCall, type Offer } from '@sh/shared'
import { emit, emitRemoved, Refused, type Ctx } from '../kernel.ts'
import { getPhase, getProject, namesForCall } from '../projects/store.ts'
import { awayOn, getAway, getCall, getOffer, getPerson, heldElsewhere, holdsFrom, offersForCall, openCallsFor } from './store.ts'

/**
 * The crew rules the server enforces, whatever device or link a request
 * comes from:
 *
 * - nobody holds two jobs on the same day;
 * - a call never gets more people on a day than it needs, so with a
 *   shortlist the first to accept gets the place and the rest are told;
 * - an offer for a day someone marked off, or already holds elsewhere,
 *   needs an explicit override from ops, which is kept on the offer.
 */

type CrewCommand =
  | 'person.upsert'
  | 'person.newLink'
  | 'person.archive'
  | 'person.contact'
  | 'unavailability.add'
  | 'unavailability.remove'
  | 'call.create'
  | 'call.update'
  | 'call.cancel'
  | 'offer.send'
  | 'offer.respond'
  | 'offer.confirm'
  | 'offer.cancel'
type Handler<N extends CrewCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

/** 24 characters of randomness; the whole secret in a person's link. */
export const newLinkToken = () => randomBytes(18).toString('base64url')

async function emitOffer(ctx: Ctx, id: string) {
  const o = await getOffer(ctx.tx, id)
  if (o) await emit(ctx, 'offer', id, o)
}

async function setOffer(ctx: Ctx, id: string, fields: Partial<Record<string, unknown>>) {
  const keys = Object.keys(fields)
  await ctx.tx.query(
    `UPDATE offers SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
    [id, ...keys.map((k) => (k === 'days' ? JSON.stringify(fields[k]) : fields[k]))]
  )
  await emitOffer(ctx, id)
}

/** People holding each day of a call, not counting one offer. */
function heldByDay(call: CrewCall, offers: Offer[], exceptOfferId?: string) {
  const held: Record<string, number> = {}
  for (const d of eachDay(call.start, call.end)) held[d] = 0
  for (const o of offers) {
    if (o.id === exceptOfferId || (o.status !== 'accepted' && o.status !== 'confirmed')) continue
    for (const d of o.days) if (d in held) held[d]!++
  }
  return held
}

/**
 * Can this offer take these days? Refuses with the days still open when the
 * call has filled, and with the other job when the person is booked.
 */
async function checkCanHold(ctx: Ctx, call: CrewCall, offer: Offer, days: string[]) {
  const held = heldByDay(call, await offersForCall(ctx.tx, call.id), offer.id)
  const full = days.filter((d) => held[d]! >= call.needed)
  if (full.length) {
    const open = Object.keys(held).filter((d) => held[d]! < call.needed)
    throw new Refused({
      code: 'filled',
      message: open.length
        ? `Sorry, ${daysLabel(full)} ${full.length === 1 ? 'has' : 'have'} just been filled. Still open: ${daysLabel(open)}.`
        : 'Sorry, this has just been filled by someone else.',
    })
  }
  const clash = await heldElsewhere(ctx.tx, offer.personId, days, call.id)
  if (clash.length) {
    throw new Refused({
      code: 'clash',
      message: `Already booked on ${clash.map((c) => `${c.project} ${daysLabel(c.days)}`).join(' and ')}.`,
    })
  }
}

/** Once every day of a call is covered, tell everyone still waiting. */
async function closeIfFull(ctx: Ctx, call: CrewCall) {
  const offers = await offersForCall(ctx.tx, call.id)
  const held = heldByDay(call, offers)
  if (Object.values(held).some((n) => n < call.needed)) return
  for (const o of offers) if (o.status === 'offered' || o.status === 'countered') await setOffer(ctx, o.id, { status: 'filled' })
}

/**
 * Cancel a call: everyone still offered is told it's withdrawn, and anyone
 * booked on it is released. Also how a job being stopped takes its crew.
 */
export async function cancelCall(ctx: Ctx, callId: string) {
  await ctx.tx.query(`UPDATE crew_calls SET status = 'cancelled' WHERE id = $1`, [callId])
  await emit(ctx, 'crewCall', callId, await getCall(ctx.tx, callId))
  for (const o of await offersForCall(ctx.tx, callId))
    if (!['declined', 'filled', 'cancelled'].includes(o.status)) await setOffer(ctx, o.id, { status: 'cancelled' })
}

/** "Aoife Byrne", "Aoife Byrne and Dara Walsh", "Aoife Byrne, Dara Walsh and Niall Kerr". */
const names = (list: string[]) => (list.length < 2 ? (list[0] ?? 'someone') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`)

/**
 * Change a call to `next`, taking its offers along. A change of dates
 * moves each live offer's days: all the new days for one holding all the
 * old ones, otherwise the chosen days still in range. A change of rate
 * reaches only offers nobody has answered; accepted, countered and
 * confirmed ones keep what was agreed. Nobody booked is ever left with no
 * days, or put on a day they hold elsewhere, and the call never needs
 * fewer people than are booked: those are refused by name, for the office
 * to release someone or keep the days. Once every day is covered again,
 * anyone still waiting is told it's filled, as after an acceptance. With
 * `shift`, the days people chose move by that many days first: the whole
 * job has moved, so the second day's person stays on the second day.
 */
async function changeCall(ctx: Ctx, call: CrewCall, next: CrewCall, shift = 0) {
  const offers = await offersForCall(ctx.tx, call.id)
  const oldDays = eachDay(call.start, call.end)
  const newDays = eachDay(next.start, next.end)
  const moved = next.start !== call.start || next.end !== call.end
  const changes = new Map<string, { days?: string[]; day_rate_cents?: number | null }>()
  const stranded: { booked: string[]; countered: string[] } = { booked: [], countered: [] }
  const daysOf = new Map<string, string[]>()
  for (const o of offers) {
    if (!LIVE.includes(o.status)) continue
    const fields: { days?: string[]; day_rate_cents?: number | null } = {}
    let days = o.days
    if (moved) {
      days = offerDaysAfter(o.days, oldDays, newDays, shift)
      if (days.length === 0) {
        const who = (await getPerson(ctx.tx, o.personId))?.name ?? 'Someone'
        if (o.status === 'countered') stranded.countered.push(who)
        else if (o.status !== 'offered') stranded.booked.push(who)
        else days = [...newDays]
      }
      if (days.join() !== o.days.join()) fields.days = days
    }
    if (next.dayRateCents !== call.dayRateCents && o.status === 'offered') fields.day_rate_cents = next.dayRateCents
    daysOf.set(o.id, days)
    if (Object.keys(fields).length) changes.set(o.id, fields)
  }
  if (stranded.booked.length || stranded.countered.length) {
    const parts: string[] = []
    if (stranded.booked.length)
      parts.push(`${names(stranded.booked)} ${stranded.booked.length === 1 ? 'is' : 'are'} booked for days that would go. Release them or keep those days.`)
    if (stranded.countered.length)
      parts.push(`${names(stranded.countered)} asked for a rate for days that would go. Say no to it or keep those days.`)
    throw new Refused({ code: 'conflict', message: parts.join(' ') })
  }
  // A day new to someone booked may be one they marked off, or hold on another job: the same clashes an offer needs an override for.
  for (const o of offers) {
    if (o.status !== 'accepted' && o.status !== 'confirmed') continue
    const added = (daysOf.get(o.id) ?? []).filter((d) => !o.days.includes(d))
    if (!added.length) continue
    const reasons: string[] = []
    for (const { u, hit } of await awayOn(ctx.tx, o.personId, added)) reasons.push(`marked unavailable ${daysLabel(hit)}${u.note ? ` (${u.note})` : ''}`)
    for (const c of await heldElsewhere(ctx.tx, o.personId, added, call.id)) reasons.push(`already booked on ${c.project} ${daysLabel(c.days)}`)
    if (reasons.length) {
      const who = (await getPerson(ctx.tx, o.personId))?.name ?? 'Someone'
      throw new Refused({ code: 'clash', message: `${who} is ${reasons.join(' and ')}. Release them or keep those days.` })
    }
  }
  const held: Record<string, number> = {}
  for (const d of newDays) held[d] = 0
  for (const o of offers) if (o.status === 'accepted' || o.status === 'confirmed') for (const d of daysOf.get(o.id) ?? []) if (d in held) held[d]!++
  const most = Math.max(0, ...Object.values(held))
  if (next.needed < most) {
    const spare = most - next.needed
    throw new Refused({ code: 'conflict', message: `${most} people are booked; release ${spare === 1 ? 'one' : spare} first.` })
  }
  await ctx.tx.query(
    `UPDATE crew_calls SET project = $2, phase = $3, venue = $4, role = $5, start_day = $6, end_day = $7, call_time = $8,
            needed = $9, day_rate_cents = $10, details = $11, reply_by = $12 WHERE id = $1`,
    [call.id, next.project, next.phase, next.venue, next.role, next.start, next.end, next.callTime, next.needed, next.dayRateCents, next.details, next.replyBy]
  )
  await emit(ctx, 'crewCall', call.id, await getCall(ctx.tx, call.id))
  for (const [id, fields] of changes) await setOffer(ctx, id, fields)
  await closeIfFull(ctx, next)
}

/**
 * A phase's open calls once it moves: each by the same shift as the
 * phase's start, kept inside the phase, with its offers' days along, under
 * the same refusals as changing a call. How a phase takes its crew with it.
 */
export async function moveCallsWithPhase(ctx: Ctx, phaseId: string, from: { start: string; end: string }, to: { start: string; end: string }) {
  for (const c of await openCallsFor(ctx.tx, { phaseId })) {
    const span = movedCallSpan(c, from, to)
    if (span.start === c.start && span.end === c.end) continue
    const call = await getCall(ctx.tx, c.id, true)
    if (call) await changeCall(ctx, call, { ...call, ...span }, daysBetween(from.start, to.start))
  }
}

/**
 * The job and phase a new call is part of, and the names it takes from
 * them (ADR 0007). A call not tied to a job keeps the names as typed.
 */
async function callJob(ctx: Ctx, a: CommandArgs<'call.create'>) {
  let projectId = a.projectId
  if (a.phaseId) {
    const phase = await getPhase(ctx.tx, a.phaseId)
    if (!phase) throw new Refused({ code: 'not-found', message: 'That phase of the job no longer exists.' })
    if (projectId && projectId !== phase.projectId) throw new Refused({ code: 'invalid', message: 'That phase is part of a different job.' })
    projectId = phase.projectId
  }
  if (!projectId) return { projectId: null, phaseId: null, project: a.project, phase: a.phase, venue: a.venue }
  const job = await getProject(ctx.tx, projectId)
  if (!job) throw new Refused({ code: 'not-found', message: 'That job no longer exists.' })
  if (STOPPED.includes(job.status))
    throw new Refused({ code: 'conflict', message: `${job.name} has been ${job.status === 'lost' ? 'marked as lost' : 'cancelled'}, so it needs no crew.` })
  const names = await namesForCall(ctx.tx, projectId, a.phaseId)
  return { projectId, phaseId: a.phaseId, project: names!.project, phase: names!.phase ?? a.phase, venue: names!.venue ?? a.venue }
}

async function openCall(ctx: Ctx, callId: string) {
  const call = await getCall(ctx.tx, callId, true)
  if (!call) throw new Refused({ code: 'not-found', message: 'That job no longer exists.' })
  if (call.status !== 'open') throw new Refused({ code: 'conflict', message: `${call.project} has been cancelled.` })
  return call
}

export const crewHandlers: { [N in CrewCommand]: Handler<N> } = {
  async 'person.upsert'(ctx, a) {
    await ctx.tx.query(
      `INSERT INTO people (id, name, kind, email, phone, skills, day_rate_cents, notes, link_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, email = EXCLUDED.email,
         phone = EXCLUDED.phone, skills = EXCLUDED.skills, day_rate_cents = EXCLUDED.day_rate_cents, notes = EXCLUDED.notes`,
      [a.id, a.name, a.kind, a.email, a.phone, JSON.stringify(a.skills), a.dayRateCents, a.notes, newLinkToken()]
    )
    await emit(ctx, 'person', a.id, await getPerson(ctx.tx, a.id))
  },

  async 'person.newLink'(ctx, a) {
    const { rows } = await ctx.tx.query('UPDATE people SET link_token = $2 WHERE id = $1 RETURNING id', [a.id, newLinkToken()])
    if (!rows.length) throw new Refused({ code: 'not-found', message: 'That person no longer exists.' })
    await emit(ctx, 'person', a.id, await getPerson(ctx.tx, a.id))
  },

  async 'person.archive'(ctx, a) {
    const person = await getPerson(ctx.tx, a.id)
    if (!person) throw new Refused({ code: 'not-found', message: 'That person no longer exists.' })
    if (person.archived === a.archived) return
    if (a.archived) {
      // Nothing is left hanging: an offer waiting on them, or days they hold from today on, is settled first.
      const hold = await holdsFrom(ctx.tx, person.id, irishToday())
      if (hold) {
        const what =
          hold.status === 'confirmed' ? `is booked on ${hold.project}; release them first` : hold.status === 'accepted' ? `has accepted ${hold.project}; release them first` : `has an open offer for ${hold.project}; withdraw it first`
        throw new Refused({ code: 'conflict', message: `${person.name} ${what}.` })
      }
    }
    await ctx.tx.query('UPDATE people SET archived = $2 WHERE id = $1', [person.id, a.archived])
    await emit(ctx, 'person', person.id, await getPerson(ctx.tx, person.id))
  },

  /**
   * A person's own email and phone. On a link the route has already matched
   * the id to the link's person, so the handler only sets what was sent.
   */
  async 'person.contact'(ctx, a) {
    const person = await getPerson(ctx.tx, a.id)
    if (!person) throw new Refused({ code: 'not-found', message: 'That person no longer exists.' })
    const fields: [string, string | null][] = []
    if (a.email !== undefined) fields.push(['email', a.email])
    if (a.phone !== undefined) fields.push(['phone', a.phone])
    if (!fields.length) return
    await ctx.tx.query(`UPDATE people SET ${fields.map(([k], i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [person.id, ...fields.map(([, v]) => v)])
    await emit(ctx, 'person', person.id, await getPerson(ctx.tx, person.id))
  },

  async 'unavailability.add'(ctx, a) {
    if (!(await getPerson(ctx.tx, a.personId))) throw new Refused({ code: 'not-found', message: 'That person no longer exists.' })
    if (await getAway(ctx.tx, a.id)) return
    await ctx.tx.query(
      'INSERT INTO unavailability (id, person_id, start_day, end_day, note, source) VALUES ($1, $2, $3, $4, $5, $6)',
      [a.id, a.personId, a.start, a.end, a.note, ctx.via === 'link' ? 'self' : 'ops']
    )
    await emit(ctx, 'unavailability', a.id, await getAway(ctx.tx, a.id))
  },

  async 'unavailability.remove'(ctx, a) {
    const { rows } = await ctx.tx.query('DELETE FROM unavailability WHERE id = $1 RETURNING id', [a.id])
    if (!rows.length) return
    await emitRemoved(ctx, 'unavailability', a.id)
  },

  async 'call.create'(ctx, a) {
    if (await getCall(ctx.tx, a.id)) throw new Refused({ code: 'conflict', message: 'This job already exists.' })
    const job = await callJob(ctx, a)
    await ctx.tx.query(
      `INSERT INTO crew_calls (id, project_id, phase_id, project, phase, venue, role, start_day, end_day, call_time, needed, day_rate_cents, details, reply_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'open')`,
      [a.id, job.projectId, job.phaseId, job.project, job.phase, job.venue, a.role, a.start, a.end, a.callTime, a.needed, a.dayRateCents, a.details, a.replyBy]
    )
    await emit(ctx, 'crewCall', a.id, await getCall(ctx.tx, a.id))
  },

  async 'call.update'(ctx, a) {
    const call = await openCall(ctx, a.id)
    if (call.projectId && (a.project !== undefined || a.phase !== undefined || a.venue !== undefined))
      throw new Refused({ code: 'invalid', message: `This call is part of ${call.project}: change the job, its phase or its venue in Jobs.` })
    const next: CrewCall = { ...call }
    for (const k of ['role', 'start', 'end', 'callTime', 'needed', 'dayRateCents', 'details', 'replyBy', 'project', 'phase', 'venue'] as const)
      if (a[k] !== undefined) (next as Record<string, unknown>)[k] = a[k]
    // One end may have moved on another device, so check the call as it will be.
    if (next.start > next.end) throw new Refused({ code: 'invalid', message: `${next.role} on ${next.project} would end before it starts.` })
    await changeCall(ctx, call, next)
  },

  async 'call.cancel'(ctx, a) {
    const call = await getCall(ctx.tx, a.id, true)
    if (!call) throw new Refused({ code: 'not-found', message: 'That job no longer exists.' })
    await cancelCall(ctx, a.id)
  },

  async 'offer.send'(ctx, a) {
    if (await getOffer(ctx.tx, a.id)) throw new Refused({ code: 'conflict', message: 'This offer has already been sent.' })
    const call = await openCall(ctx, a.callId)
    const person = await getPerson(ctx.tx, a.personId)
    if (!person) throw new Refused({ code: 'not-found', message: 'That person no longer exists.' })
    if (person.archived) throw new Refused({ code: 'conflict', message: `${person.name} has been archived. Bring them back on the Crew tab to offer them work.` })
    const offers = await offersForCall(ctx.tx, call.id)
    const live = offers.find((o) => o.personId === person.id && !['declined', 'filled', 'cancelled'].includes(o.status))
    if (live) throw new Refused({ code: 'conflict', message: `${person.name} already has this offer (${live.status}).` })
    const days = eachDay(call.start, call.end)
    const held = heldByDay(call, offers)
    if (days.every((d) => held[d]! >= call.needed))
      throw new Refused({ code: 'filled', message: `${call.role} on ${call.project} is already filled.` })
    if (!a.override) {
      const reasons: string[] = []
      for (const { u, hit } of await awayOn(ctx.tx, person.id, days))
        reasons.push(`marked unavailable ${daysLabel(hit)}${u.note ? ` (${u.note})` : ''}`)
      for (const c of await heldElsewhere(ctx.tx, person.id, days, call.id)) reasons.push(`booked on ${c.project} ${daysLabel(c.days)}`)
      if (reasons.length)
        throw new Refused({ code: 'clash', message: `${person.name} is ${reasons.join(' and ')}. Send anyway to override.` })
    }
    await ctx.tx.query(
      `INSERT INTO offers (id, call_id, person_id, status, days, day_rate_cents, override)
       VALUES ($1, $2, $3, 'offered', $4, $5, $6)`,
      [a.id, call.id, person.id, JSON.stringify(days), call.dayRateCents, a.override]
    )
    await emitOffer(ctx, a.id)
  },

  async 'offer.respond'(ctx, a) {
    const offer = await getOffer(ctx.tx, a.id)
    if (!offer) throw new Refused({ code: 'not-found', message: 'That offer no longer exists.' })
    const call = await openCall(ctx, offer.callId)
    if (offer.status === 'filled') throw new Refused({ code: 'filled', message: 'Sorry, this has already been filled by someone else.' })
    if (offer.status === 'cancelled') throw new Refused({ code: 'conflict', message: 'This offer was withdrawn.' })
    if (offer.status === 'confirmed')
      throw new Refused({ code: 'conflict', message: 'You are confirmed for this job. Please contact the office to change it.' })

    const answered = { responded_at: new Date().toISOString(), responded_via: ctx.via, note: a.note }
    if (a.answer === 'decline') {
      await setOffer(ctx, offer.id, { ...answered, status: 'declined' })
      return
    }
    const all = eachDay(call.start, call.end)
    const days = a.days ? [...new Set(a.days)].sort() : all
    const outside = days.filter((d) => !all.includes(d))
    if (outside.length) throw new Refused({ code: 'invalid', message: `${daysLabel(outside)} ${outside.length === 1 ? 'is' : 'are'} not part of this job.` })
    await checkCanHold(ctx, call, offer, days)
    if (a.answer === 'counter') {
      await setOffer(ctx, offer.id, { ...answered, status: 'countered', days, counter_rate_cents: a.counterRateCents })
      return
    }
    await setOffer(ctx, offer.id, { ...answered, status: 'accepted', days, counter_rate_cents: null })
    await closeIfFull(ctx, call)
  },

  async 'offer.confirm'(ctx, a) {
    const offer = await getOffer(ctx.tx, a.id)
    if (!offer) throw new Refused({ code: 'not-found', message: 'That offer no longer exists.' })
    const call = await openCall(ctx, offer.callId)
    if (offer.status === 'confirmed') return
    if (offer.status === 'accepted') {
      await setOffer(ctx, offer.id, { status: 'confirmed' })
      return
    }
    if (offer.status !== 'countered')
      throw new Refused({ code: 'conflict', message: `Only an accepted offer or a counter-offer can be confirmed; this one is ${offer.status}.` })
    // Agreeing a counter: the days may have filled while ops were deciding.
    await checkCanHold(ctx, call, offer, offer.days)
    await setOffer(ctx, offer.id, { status: 'confirmed', day_rate_cents: offer.counterRateCents })
    await closeIfFull(ctx, call)
  },

  async 'offer.cancel'(ctx, a) {
    const offer = await getOffer(ctx.tx, a.id)
    if (!offer) throw new Refused({ code: 'not-found', message: 'That offer no longer exists.' })
    if (offer.status === 'cancelled') return
    await setOffer(ctx, offer.id, { status: 'cancelled' })
  },
}
