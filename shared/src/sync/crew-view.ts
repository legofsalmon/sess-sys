import type { CommandArgs, Mutation } from '../commands.ts'
import { daysBetween, eachDay, HOLDING, LIVE, movedCallSpan, offerDaysAfter, OPEN, type CrewCall, type CrewEntities, type Offer, type Person, type Unavailability } from '../crew.ts'
import { STOPPED, type Phase } from '../jobs.ts'

/**
 * The crew screen's view of a device's data: what the server has said, with
 * this person's own waiting requests laid over it, the same way bookings are
 * shown in SyncClient.view().
 */

export interface PersonView extends Person {
  pending: boolean
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

export function crewView(
  entities: Partial<Tables> & { phase?: Record<string, Phase> },
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number
): CrewView {
  const people = new Map<string, PersonView>()
  // People synced before archiving existed read as not archived.
  for (const p of Object.values(entities.person ?? {})) people.set(p.id, { ...p, archived: p.archived ?? false, pending: false })
  const calls = new Map<string, CrewCall & { pending: boolean }>()
  // Calls synced before jobs existed have no job or phase.
  for (const c of Object.values(entities.crewCall ?? {})) calls.set(c.id, { ...c, projectId: c.projectId ?? null, phaseId: c.phaseId ?? null, pending: false })
  const offers = new Map<string, Offer & { pending: boolean }>()
  for (const o of Object.values(entities.offer ?? {})) offers.set(o.id, { ...o, pending: false })
  const away = new Map<string, UnavailabilityView>()
  for (const u of Object.values(entities.unavailability ?? {})) away.set(u.id, { ...u, pending: false })

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

  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    switch (m.name) {
      case 'person.upsert': {
        // Editing someone keeps what a device doesn't own: their link, and whether they're archived.
        const a = m.args as CommandArgs<'person.upsert'>
        const was = people.get(a.id)
        people.set(a.id, { linkToken: was?.linkToken ?? '', archived: was?.archived ?? false, ...a, pending: true })
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
        for (const c of calls.values()) if (c.projectId === a.id && c.status === 'open') calls.set(c.id, { ...c, status: 'cancelled', pending: true })
        break
      }
      case 'call.cancel': {
        const c = calls.get((m.args as CommandArgs<'call.cancel'>).id)
        if (c) calls.set(c.id, { ...c, status: 'cancelled', pending: true })
        break
      }
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
            pending: true,
          })
        break
      }
      case 'offer.respond': {
        const a = m.args as CommandArgs<'offer.respond'>
        const o = offers.get(a.id)
        if (!o) break
        const status = a.answer === 'accept' ? 'accepted' : a.answer === 'decline' ? 'declined' : 'countered'
        const days = a.answer !== 'decline' && a.days ? a.days : o.days
        offers.set(o.id, { ...o, status, days, pending: true })
        break
      }
      case 'offer.confirm':
      case 'offer.cancel': {
        const o = offers.get((m.args as { id: string }).id)
        if (o) offers.set(o.id, { ...o, status: m.name === 'offer.confirm' ? 'confirmed' : 'cancelled', pending: true })
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
      (a, b) => statusRank(a.status) - statusRank(b.status) || (a.person?.name ?? '').localeCompare(b.person?.name ?? '')
    )
    const heldByDay: Record<string, number> = {}
    for (const d of days) heldByDay[d] = own.filter((o) => HOLDING.includes(o.status) && o.days.includes(d)).length
    return { ...c, offers: own, days, heldByDay, openDays: days.filter((d) => heldByDay[d]! < c.needed) }
  })

  return {
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
    calls: callViews.sort((a, b) => a.start.localeCompare(b.start) || a.project.localeCompare(b.project)),
    unavailability: [...away.values()].sort((a, b) => a.start.localeCompare(b.start)),
  }
}

function statusRank(s: Offer['status']) {
  return ['confirmed', 'accepted', 'countered', 'offered', 'declined', 'filled', 'cancelled'].indexOf(s)
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
