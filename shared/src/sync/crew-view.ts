import type { CommandArgs, Mutation } from '../commands.ts'
import { eachDay, HOLDING, OPEN, type CrewCall, type CrewEntities, type Offer, type Person, type Unavailability } from '../crew.ts'

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

export function crewView(entities: Partial<Tables>, outbox: readonly (Mutation & { appliedSeq?: number })[], cursor: number): CrewView {
  const people = new Map<string, PersonView>()
  for (const p of Object.values(entities.person ?? {})) people.set(p.id, { ...p, pending: false })
  const calls = new Map<string, CrewCall & { pending: boolean }>()
  for (const c of Object.values(entities.crewCall ?? {})) calls.set(c.id, { ...c, pending: false })
  const offers = new Map<string, Offer & { pending: boolean }>()
  for (const o of Object.values(entities.offer ?? {})) offers.set(o.id, { ...o, pending: false })
  const away = new Map<string, UnavailabilityView>()
  for (const u of Object.values(entities.unavailability ?? {})) away.set(u.id, { ...u, pending: false })

  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    switch (m.name) {
      case 'person.upsert': {
        const a = m.args as CommandArgs<'person.upsert'>
        people.set(a.id, { linkToken: people.get(a.id)?.linkToken ?? '', ...a, pending: true })
        break
      }
      case 'call.create': {
        const a = m.args as CommandArgs<'call.create'>
        if (!calls.has(a.id)) calls.set(a.id, { ...a, status: 'open', pending: true })
        break
      }
      case 'call.cancel': {
        const c = calls.get((m.args as CommandArgs<'call.cancel'>).id)
        if (c) calls.set(c.id, { ...c, status: 'cancelled', pending: true })
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

  const callViews: CallView[] = [...calls.values()].map((c) => {
    const days = eachDay(c.start, c.end)
    const own = [...offers.values()]
      .filter((o) => o.callId === c.id)
      .map((o) => ({ ...o, person: people.get(o.personId) }))
      .sort((a, b) => statusRank(a.status) - statusRank(b.status) || (a.person?.name ?? '').localeCompare(b.person?.name ?? ''))
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
