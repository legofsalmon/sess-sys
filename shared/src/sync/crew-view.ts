import type { CommandArgs, Mutation } from '../commands.ts'
import { irishToday } from '../calendar.ts'
import { certificatesAfter, daysBetween, DEFAULT_LEVEL, eachDay, HOLDING, LIVE, movedCallSpan, offerDaysAfter, OPEN, type CrewCall, type CrewEntities, type Offer, type Person, type Unavailability } from '../crew.ts'
import { certificateOf, type Document } from '../documents.ts'
import { STOPPED, type Phase, type Project } from '../jobs.ts'
import { leaveLabel, type LeaveRequest } from '../leave.ts'

/**
 * The crew screen's view of a device's data: what the server has said, with
 * this person's own waiting requests laid over it, the same way bookings are
 * shown in SyncClient.view().
 */

/** A job a person was booked on (ADR 0025): the booking's call, with the person's own days. */
export interface Worked {
  callId: string
  projectId: string | null
  name: string
  phase: string
  start: string
  end: string
}

export interface PersonView extends Person {
  pending: boolean
  /** The jobs they were booked on whose first day has come, newest first. */
  worked: Worked[]
}
export interface OfferView extends Offer {
  pending: boolean
  person: Person | undefined
}
export interface CallView extends CrewCall {
  pending: boolean
  offers: OfferView[]
  days: string[]
  /** People holding each day (accepted or confirmed). */
  heldByDay: Record<string, number>
  /** Days that still need someone. */
  openDays: string[]
}
export interface UnavailabilityView extends Unavailability {
  pending: boolean
}

export interface CrewView {
  people: PersonView[]
  calls: CallView[]
  unavailability: UnavailabilityView[]
}

type Tables = { [E in keyof CrewEntities]: Record<string, CrewEntities[E]> }

/** The fields a change names, without its id; the rest stay as they are. */
function changed(a: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(a)) if (k !== 'id' && v !== undefined) out[k] = v
  return out
}

/** A person synced before the profile existed (ADR 0025) reads as not archived, not approving leave, Level 1, with nothing else set. */
const withDefaults = (p: Person): Person => ({
  ...p,
  archived: p.archived ?? false,
  approvesLeave: p.approvesLeave ?? false,
  department: p.department ?? null,
  level: p.level ?? DEFAULT_LEVEL,
  knownAs: p.knownAs ?? null,
  certificates: p.certificates ?? {},
  company: p.company ?? null,
})

export function crewView(
  entities: Partial<Tables> & { phase?: Record<string, Phase>; project?: Record<string, Project>; leaveRequest?: Record<string, LeaveRequest>; document?: Record<string, Document> },
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number,
  today = irishToday()
): CrewView {
  const people = new Map<string, PersonView>()
  for (const p of Object.values(entities.person ?? {})) people.set(p.id, { ...withDefaults(p), pending: false, worked: [] })
  const calls = new Map<string, CrewCall & { pending: boolean }>()
  // Calls synced before jobs existed have no job or phase.
  for (const c of Object.values(entities.crewCall ?? {})) calls.set(c.id, { ...c, projectId: c.projectId ?? null, phaseId: c.phaseId ?? null, pending: false })
  const offers = new Map<string, Offer & { pending: boolean }>()
  // Offers synced before "Answers to check" kept declines have no seenAt.
  for (const o of Object.values(entities.offer ?? {})) offers.set(o.id, { ...o, seenAt: o.seenAt ?? null, pending: false })
  const away = new Map<string, UnavailabilityView>()
  for (const u of Object.values(entities.unavailability ?? {})) away.set(u.id, { ...u, pending: false })

  /** A call cancelled takes every offer still live on it, as the server withdraws them: the office sees it at once, not after the sync. */
  const cancelCall = (id: string) => {
    const c = calls.get(id)
    if (!c) return
    calls.set(c.id, { ...c, status: 'cancelled', pending: true })
    for (const o of offers.values()) if (o.callId === c.id && LIVE.includes(o.status)) offers.set(o.id, { ...o, status: 'cancelled', pending: true })
  }

  // Phases' dates, followed through this device's own changes, for calls that move with their phase.
  const phaseDates = new Map<string, { start: string; end: string }>()
  for (const p of Object.values(entities.phase ?? {})) phaseDates.set(p.id, { start: p.start, end: p.end })
  /** A call's offers once its days change, by the same rule as the server's: chosen days shift with a phase that moved. */
  const moveOffers = (callId: string, oldDays: string[], newDays: string[], shift = 0) => {
    for (const o of offers.values()) {
      if (o.callId !== callId || !LIVE.includes(o.status)) continue
      let days = offerDaysAfter(o.days, oldDays, newDays, shift)
      if (!days.length) {
        // Nobody has answered, so the offer is simply for the new days. Anyone booked or countering is shown as they were: the server refuses to strand them.
        if (o.status !== 'offered') continue
        days = [...newDays]
      }
      if (days.join() !== o.days.join()) offers.set(o.id, { ...o, days, pending: true })
    }
  }

  /** A certificate's card is in: the certificate is held, running out on its day, the note kept. */
  const cardSets = (personId: string, kind: Document['kind'], expires: string | null) => {
    const cert = certificateOf(kind)
    const p = people.get(personId)
    if (cert && p) people.set(p.id, { ...p, certificates: { ...p.certificates, [cert]: { held: true, expires, note: p.certificates[cert]?.note ?? '' } }, pending: true })
  }

  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    switch (m.name) {
      case 'person.upsert': {
        // Editing someone keeps what a device doesn't own: their link, and whether they're archived. An
        // edit that says nothing about approving leave, or about the profile (ADR 0025), keeps those too.
        const a = m.args as CommandArgs<'person.upsert'>
        const was = people.get(a.id)
        const approvesLeave = a.kind === 'staff' && (a.approvesLeave ?? was?.approvesLeave ?? false)
        people.set(a.id, {
          linkToken: was?.linkToken ?? '',
          archived: was?.archived ?? false,
          ...a,
          approvesLeave,
          department: a.department !== undefined ? a.department : (was?.department ?? null),
          level: a.level ?? was?.level ?? DEFAULT_LEVEL,
          knownAs: a.knownAs !== undefined ? a.knownAs : (was?.knownAs ?? null),
          // As the server lays them (ADR 0028).
          certificates: certificatesAfter(was?.certificates, a.certificates),
          company: a.company !== undefined ? a.company : (was?.company ?? null),
          pending: true,
          worked: was?.worked ?? [],
        })
        break
      }
      case 'person.level': {
        const a = m.args as CommandArgs<'person.level'>
        const p = people.get(a.id)
        if (p) people.set(p.id, { ...p, level: a.level, pending: true })
        break
      }
      // A certificate's card saved or checked sets the certificate on the person, which holds its date (ADR 0029).
      case 'document.save': {
        const a = m.args as CommandArgs<'document.save'>
        const doc = entities.document?.[a.id]
        // As the server: someone else's, or one sent from a link and not checked yet, isn't changed by a save.
        if (!doc || (doc.personId === a.personId && doc.checkedAt)) cardSets(a.personId, a.kind, a.expires)
        break
      }
      case 'document.check': {
        const a = m.args as CommandArgs<'document.check'>
        const doc = entities.document?.[a.id]
        // Checked once is checked.
        if (doc && !doc.checkedAt) cardSets(doc.personId, doc.kind, a.expires)
        break
      }
      case 'person.archive': {
        const a = m.args as CommandArgs<'person.archive'>
        const p = people.get(a.id)
        if (p) people.set(p.id, { ...p, archived: a.archived, pending: true })
        break
      }
      case 'person.contact': {
        // Only the fields sent change, so an unchanged one is never named in the history.
        const a = m.args as CommandArgs<'person.contact'>
        const p = people.get(a.id)
        if (p) people.set(p.id, { ...p, ...(a.email !== undefined ? { email: a.email } : {}), ...(a.phone !== undefined ? { phone: a.phone } : {}), pending: true })
        break
      }
      case 'call.create': {
        const a = m.args as CommandArgs<'call.create'>
        if (!calls.has(a.id)) calls.set(a.id, { ...a, projectId: a.projectId ?? null, phaseId: a.phaseId ?? null, status: 'open', pending: true })
        break
      }
      case 'project.update': {
        // A job being stopped takes its crew calls with it (ADR 0007).
        const a = m.args as CommandArgs<'project.update'>
        if (!a.status || !STOPPED.includes(a.status)) break
        for (const c of [...calls.values()]) if (c.projectId === a.id && c.status === 'open') cancelCall(c.id)
        break
      }
      case 'call.cancel':
        cancelCall((m.args as CommandArgs<'call.cancel'>).id)
        break
      case 'call.update': {
        const a = m.args as CommandArgs<'call.update'>
        const c = calls.get(a.id)
        if (!c) break
        const next = { ...c, ...(changed(a) as Partial<CrewCall>), pending: true }
        calls.set(c.id, next)
        if (next.start !== c.start || next.end !== c.end) moveOffers(c.id, eachDay(c.start, c.end), eachDay(next.start, next.end))
        // A new rate reaches only offers nobody has answered; the rest keep what was agreed.
        if (next.dayRateCents !== c.dayRateCents)
          for (const o of offers.values()) if (o.callId === c.id && o.status === 'offered') offers.set(o.id, { ...o, dayRateCents: next.dayRateCents, pending: true })
        break
      }
      case 'phase.add': {
        const a = m.args as CommandArgs<'phase.add'>
        if (!phaseDates.has(a.id)) phaseDates.set(a.id, { start: a.start, end: a.end })
        break
      }
      case 'phase.update': {
        // A phase moving with its crew takes its open calls, and their offers' days, along.
        const a = m.args as CommandArgs<'phase.update'>
        const from = phaseDates.get(a.id)
        if (!from) break
        const to = { start: a.start ?? from.start, end: a.end ?? from.end }
        phaseDates.set(a.id, to)
        if (!a.moveCrew || (to.start === from.start && to.end === from.end)) break
        for (const c of [...calls.values()]) {
          if (c.phaseId !== a.id || c.status !== 'open') continue
          const span = movedCallSpan(c, from, to)
          if (span.start === c.start && span.end === c.end) continue
          calls.set(c.id, { ...c, ...span, pending: true })
          moveOffers(c.id, eachDay(c.start, c.end), eachDay(span.start, span.end), daysBetween(from.start, to.start))
        }
        break
      }
      case 'offer.send': {
        const a = m.args as CommandArgs<'offer.send'>
        const c = calls.get(a.callId)
        if (!offers.has(a.id) && c)
          offers.set(a.id, {
            id: a.id,
            callId: a.callId,
            personId: a.personId,
            status: 'offered',
            days: eachDay(c.start, c.end),
            dayRateCents: c.dayRateCents,
            counterRateCents: null,
            note: '',
            respondedAt: null,
            respondedVia: null,
            override: a.override,
            seenAt: null,
            pending: true,
          })
        break
      }
      case 'offer.respond': {
        const a = m.args as CommandArgs<'offer.respond'>
        const o = offers.get(a.id)
        if (!o) break
        const status = a.answer === 'accept' ? 'accepted' : a.answer === 'decline' ? 'declined' : a.answer === 'pullOut' ? 'pulled-out' : 'countered'
        const days = (a.answer === 'accept' || a.answer === 'counter') && a.days ? a.days : o.days
        // A new answer is one the office hasn't seen yet.
        offers.set(o.id, { ...o, status, days, note: a.note, seenAt: null, pending: true })
        break
      }
      case 'offer.confirm': {
        const o = offers.get((m.args as CommandArgs<'offer.confirm'>).id)
        // Agreeing a counter makes its rate the rate, as the server does, so the timesheet's total follows at once.
        const agreed = o?.status === 'countered' && o.counterRateCents !== null ? { dayRateCents: o.counterRateCents } : {}
        if (o) offers.set(o.id, { ...o, status: 'confirmed', ...agreed, pending: true })
        break
      }
      case 'offer.cancel': {
        const o = offers.get((m.args as CommandArgs<'offer.cancel'>).id)
        // An offer that is over stays as it ended, as on the server: a Withdraw queued offline never rewrites a decline.
        if (o && LIVE.includes(o.status)) offers.set(o.id, { ...o, status: 'cancelled', pending: true })
        break
      }
      case 'offer.seen': {
        const o = offers.get((m.args as CommandArgs<'offer.seen'>).id)
        if (o && !o.seenAt) offers.set(o.id, { ...o, seenAt: m.createdAt, pending: true })
        break
      }
      case 'unavailability.add': {
        const a = m.args as CommandArgs<'unavailability.add'>
        if (!away.has(a.id)) away.set(a.id, { ...a, source: 'ops', pending: true })
        break
      }
      case 'unavailability.remove':
        away.delete((m.args as CommandArgs<'unavailability.remove'>).id)
        break
      case 'leave.decide': {
        // Approved leave is days off (ADR 0024), under the request's own id, so the planner shows it before it syncs.
        const a = m.args as CommandArgs<'leave.decide'>
        const r = entities.leaveRequest?.[a.id]
        if (!r || r.status !== 'waiting' || !a.approved || away.has(a.id)) break
        away.set(a.id, { id: a.id, personId: r.personId, start: r.start, end: r.end, note: leaveLabel(r.type, r.days), source: 'leave', pending: true })
        break
      }
      case 'leave.cancel':
        away.delete((m.args as CommandArgs<'leave.cancel'>).id)
        break
    }
  }

  // Each call's offers gathered once: looking through every offer for every call is calls × offers, most of a year's rebuild.
  const byCall = new Map<string, OfferView[]>()
  for (const o of offers.values()) {
    const list = byCall.get(o.callId) ?? []
    list.push({ ...o, person: people.get(o.personId) })
    byCall.set(o.callId, list)
  }
  const callViews: CallView[] = [...calls.values()].map((c) => {
    const days = eachDay(c.start, c.end)
    const own = (byCall.get(c.id) ?? []).sort(
      (a, b) => statusRank(a.status) - statusRank(b.status) || (a.person?.name ?? '').localeCompare(b.person?.name ?? '') || a.id.localeCompare(b.id)
    )
    const heldByDay: Record<string, number> = {}
    for (const d of days) heldByDay[d] = own.filter((o) => HOLDING.includes(o.status) && o.days.includes(d)).length
    return { ...c, offers: own, days, heldByDay, openDays: days.filter((d) => heldByDay[d]! < c.needed) }
  })

  // What each person has worked (ADR 0025): a place held on a call that stands, from the person's own first day on it, newest first.
  // The job's name as it is today, where the call is part of one; the call's own name otherwise.
  for (const c of callViews) {
    if (c.status === 'cancelled') continue
    const name = (c.projectId && entities.project?.[c.projectId]?.name) || c.project
    for (const o of c.offers) {
      if (!HOLDING.includes(o.status) || o.days.length === 0) continue
      const p = people.get(o.personId)
      if (!p) continue
      const days = [...o.days].sort()
      if (days[0]! > today) continue
      p.worked.push({ callId: c.id, projectId: c.projectId, name, phase: c.phase, start: days[0]!, end: days[days.length - 1]! })
    }
  }
  for (const p of people.values()) p.worked.sort((a, b) => b.start.localeCompare(a.start) || a.name.localeCompare(b.name) || a.callId.localeCompare(b.callId))

  // Every order ends on the id, so two devices holding the same data show the same order whatever order it arrived in.
  return {
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    calls: callViews.sort((a, b) => a.start.localeCompare(b.start) || a.project.localeCompare(b.project) || a.id.localeCompare(b.id)),
    unavailability: [...away.values()].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)),
  }
}

function statusRank(s: Offer['status']) {
  return ['confirmed', 'accepted', 'countered', 'offered', 'pulled-out', 'declined', 'filled', 'cancelled'].indexOf(s)
}

/** Why an offer is in "Answers to check", and so what the office does next. */
export type AnswerKind = 'accepted' | 'countered' | 'declined' | 'pulled-out'

export interface AnswerToCheck {
  call: CallView
  offer: OfferView
  kind: AnswerKind
  /** Places still to fill on the call's busiest day, now that this answer is in. */
  short: number
}

const ANSWER_ORDER: readonly AnswerKind[] = ['pulled-out', 'accepted', 'countered', 'declined']

/**
 * Answers the office hasn't dealt with, on calls still to come (audit
 * finding 9): a yes or a counter waits for Confirm or Withdraw; a decline or
 * a pull-out stays until the office taps Noted (offer.seen), since either
 * can leave the call short. The Crew tab's count is the length of this.
 */
export function answersToCheck(crew: CrewView, today: string): AnswerToCheck[] {
  const out: AnswerToCheck[] = []
  for (const call of crew.calls) {
    if (call.status !== 'open' || call.end < today) continue
    const short = Math.max(0, ...call.days.map((d) => call.needed - (call.heldByDay[d] ?? 0)))
    for (const offer of call.offers) {
      const kind = offer.status as AnswerKind
      if (!ANSWER_ORDER.includes(kind)) continue
      if ((kind === 'declined' || kind === 'pulled-out') && offer.seenAt) continue
      out.push({ call, offer, kind, short })
    }
  }
  return out.sort(
    (a, b) => ANSWER_ORDER.indexOf(a.kind) - ANSWER_ORDER.indexOf(b.kind) || a.call.start.localeCompare(b.call.start) || a.call.id.localeCompare(b.call.id) || a.offer.id.localeCompare(b.offer.id)
  )
}

/**
 * Why a person might not be right for these days: marked unavailable, or
 * already holding another call. Shown as a warning before an offer goes out;
 * the server checks again when it arrives.
 */
export function personConflicts(view: CrewView, personId: string, days: string[], exceptCallId?: string): string[] {
  const out: string[] = []
  for (const u of view.unavailability) {
    if (u.personId !== personId) continue
    const hit = days.filter((d) => d >= u.start && d <= u.end)
    if (hit.length) out.push(`Marked unavailable ${hit.length === 1 ? hit[0] : `${hit[0]} to ${hit[hit.length - 1]}`}${u.note ? ` (${u.note})` : ''}`)
  }
  for (const c of view.calls) {
    if (c.id === exceptCallId || c.status !== 'open') continue
    for (const o of c.offers) {
      if (o.personId !== personId) continue
      const hit = o.days.filter((d) => days.includes(d))
      if (!hit.length) continue
      if (HOLDING.includes(o.status)) out.push(`Booked on ${c.project} (${hit.join(', ')})`)
      else if (OPEN.includes(o.status)) out.push(`Also offered ${c.project} (${hit.join(', ')})`)
    }
  }
  return out
}
