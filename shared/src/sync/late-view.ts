import type { CommandArgs, Mutation } from '../commands.ts'
import { lateShown, type RunningLate } from '../late.ts'
import type { CallView, CrewView, OfferView, PersonView } from './crew-view.ts'

/**
 * Running late (ADR 0028) as a device sees it: what the server has said,
 * with this device's own waiting changes laid over it, shown only until
 * each one's day is over.
 */

export interface LateNote extends RunningLate {
  pending: boolean
  person: PersonView | undefined
  call: CallView | undefined
  offer: OfferView | undefined
}

export interface LateView {
  /** Every one still showing, by day, then by name. */
  current: LateNote[]
  /** Said and not yet noted, and not there yet: in "Answers to check" and on the Crew badge. */
  toCheck: LateNote[]
  /** The ones for a booking, for a call's line and the planner. */
  forOffer(offerId: string): LateNote[]
}

export function lateView(
  entities: { runningLate?: Record<string, RunningLate> },
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number,
  crew: CrewView,
  today: string,
  /** People erased on request, an erasure still to send included: theirs go at once, as the server deletes them (ADR 0027). */
  erased: Readonly<Record<string, unknown>> = {}
): LateView {
  const all = new Map<string, RunningLate & { pending: boolean }>()
  // Snapshots saved before running late existed have no table for it.
  for (const l of Object.values(entities.runningLate ?? {})) all.set(l.id, { ...l, pending: false })
  const offers = new Map<string, { offer: OfferView; call: CallView }>()
  for (const call of crew.calls) for (const offer of call.offers) offers.set(offer.id, { offer, call })

  /** The record a "they're there" or "noted" is about: by its id, or by the booking and day, as the server finds it. */
  const named = (a: CommandArgs<'late.arrived' | 'late.seen'>) =>
    all.get(a.id) ?? (a.offerId ? [...all.values()].find((l) => l.offerId === a.offerId && l.day === a.day) : undefined)

  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    switch (m.name) {
      case 'late.say': {
        // One for a booking and a day, as on the server: a second says it again, new to the office.
        const a = m.args as CommandArgs<'late.say'>
        const was = [...all.values()].find((l) => l.offerId === a.offerId && l.day === a.day)
        const known = offers.get(a.offerId)
        const personId = was?.personId ?? known?.offer.personId
        const callId = was?.callId ?? known?.call.id
        if (!personId || !callId) break
        all.set(was?.id ?? a.id, {
          id: was?.id ?? a.id,
          personId,
          offerId: a.offerId,
          callId,
          day: a.day,
          by: a.by,
          arriveAt: a.arriveAt,
          note: a.note,
          saidAt: m.createdAt,
          arrivedAt: null,
          seenAt: null,
          pending: true,
        })
        break
      }
      case 'late.arrived': {
        const l = named(m.args as CommandArgs<'late.arrived'>)
        if (l && !l.arrivedAt) all.set(l.id, { ...l, arrivedAt: m.createdAt, pending: true })
        break
      }
      case 'late.seen': {
        const l = named(m.args as CommandArgs<'late.seen'>)
        if (l && !l.seenAt) all.set(l.id, { ...l, seenAt: m.createdAt, pending: true })
        break
      }
    }
  }

  const people = new Map(crew.people.map((p) => [p.id, p]))
  const current: LateNote[] = [...all.values()]
    .filter((l) => lateShown(l, today) && !erased[l.personId])
    .map((l) => ({ ...l, person: people.get(l.personId), call: offers.get(l.offerId)?.call, offer: offers.get(l.offerId)?.offer }))
    // Every order ends on the id, so two devices agree.
    .sort((a, b) => a.day.localeCompare(b.day) || (a.person?.name ?? '').localeCompare(b.person?.name ?? '') || a.id.localeCompare(b.id))
  const byOffer = new Map<string, LateNote[]>()
  for (const l of current) byOffer.set(l.offerId, [...(byOffer.get(l.offerId) ?? []), l])
  return {
    current,
    // A booking withdrawn or a call cancelled since leaves nothing to check.
    toCheck: current.filter((l) => !l.seenAt && !l.arrivedAt && l.call?.status === 'open' && (l.offer?.status === 'accepted' || l.offer?.status === 'confirmed')),
    forOffer: (offerId) => byOffer.get(offerId) ?? [],
  }
}
