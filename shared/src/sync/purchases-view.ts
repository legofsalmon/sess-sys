import type { CommandArgs, Mutation } from '../commands.ts'
import { irishToday } from '../day.ts'
import { PURCHASE_OPEN, voteId, type PurchaseEntities, type PurchaseRequest, type PurchaseStatus, type PurchaseVote } from '../purchases.ts'
import type { CrewView, PersonView } from './crew-view.ts'

/**
 * The purchase list (ADR 0077) as a device sees it: the requests and votes
 * the server has sent, with this device's own waiting changes laid over
 * them, so a vote counts the moment it's pressed, with no signal too.
 */

export interface PurchaseView extends PurchaseRequest {
  pending: boolean
  /** Who asked, when they're on the Crew tab. */
  asker: PersonView | undefined
  /** Who asked, in words: their name now, the name the list gave, or "Someone". */
  askerName: string
  /** Who voted for it, by name. */
  voters: PersonView[]
  /** The ids of everyone who voted, for "have I". */
  voterIds: ReadonlySet<string>
}

export interface PurchasesView {
  /** Every request, newest first. */
  all: PurchaseView[]
  /** Asked for or agreed: most votes first, then the newest. */
  open: PurchaseView[]
  /** Ordered and on the way, the oldest first. */
  ordered: PurchaseView[]
  /** Arrived or not buying, the newest first. */
  settled: PurchaseView[]
  get(id: string): PurchaseView | undefined
}

type Tables = { [E in keyof PurchaseEntities]: Record<string, PurchaseEntities[E]> }

/** Newest first: by the day asked, then the id, which sorts by when it was made. */
const newest = (a: PurchaseView, b: PurchaseView) => b.askedOn.localeCompare(a.askedOn) || b.id.localeCompare(a.id)

export function purchasesView(entities: Partial<Tables>, outbox: readonly (Mutation & { appliedSeq?: number })[], cursor: number, crew: CrewView): PurchasesView {
  const requests = new Map<string, PurchaseRequest & { pending: boolean }>()
  // Snapshots saved before the purchase list existed have no tables for it.
  for (const r of Object.values(entities.purchaseRequest ?? {})) requests.set(r.id, { ...r, pending: false })
  const votes = new Map<string, PurchaseVote & { pending: boolean }>()
  for (const v of Object.values(entities.purchaseVote ?? {})) votes.set(v.id, { ...v, pending: false })

  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    switch (m.name) {
      case 'purchase.ask': {
        // As the server keeps it: the args were tidied by the command's own schema before they were kept.
        const a = m.args as CommandArgs<'purchase.ask'>
        if (requests.has(a.id)) break
        requests.set(a.id, {
          id: a.id,
          title: a.title,
          details: a.details,
          link: a.link,
          department: a.department,
          askedBy: a.by ?? null,
          askedByName: '',
          askedOn: irishToday(new Date(m.createdAt)),
          status: 'asked',
          notes: '',
          pending: true,
        })
        break
      }
      case 'purchase.update': {
        const a = m.args as CommandArgs<'purchase.update'>
        const r = requests.get(a.id)
        if (!r) break
        const next = { ...r, pending: true }
        for (const k of ['title', 'details', 'link', 'department'] as const) if (a[k] !== undefined) (next as Record<string, unknown>)[k] = a[k]
        requests.set(a.id, next)
        break
      }
      case 'purchase.status': {
        const a = m.args as CommandArgs<'purchase.status'>
        const r = requests.get(a.id)
        if (r) requests.set(a.id, { ...r, status: a.status, notes: a.notes, pending: true })
        break
      }
      case 'purchase.remove': {
        const a = m.args as CommandArgs<'purchase.remove'>
        requests.delete(a.id)
        for (const v of [...votes.values()]) if (v.requestId === a.id) votes.delete(v.id)
        break
      }
      case 'purchase.vote': {
        const a = m.args as CommandArgs<'purchase.vote'>
        if (!a.by || !requests.has(a.requestId)) break
        const key = voteId(a.requestId, a.by)
        if (a.vote) {
          if (!votes.has(key)) votes.set(key, { id: key, requestId: a.requestId, personId: a.by, pending: true })
        } else votes.delete(key)
        break
      }
      case 'purchase.bringIn': {
        const a = m.args as CommandArgs<'purchase.bringIn'>
        // One already here is left as it is, as the server leaves it.
        for (const r of a.requests) if (!requests.has(r.id)) requests.set(r.id, { ...r, askedByName: r.askedBy ? '' : r.askedByName, pending: true })
        break
      }
    }
  }

  const people = new Map(crew.people.map((p) => [p.id, p]))
  const byRequest = new Map<string, PersonView[]>()
  const idsOf = new Map<string, Set<string>>()
  for (const v of [...votes.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!requests.has(v.requestId)) continue
    const p = people.get(v.personId)
    if (p) byRequest.set(v.requestId, [...(byRequest.get(v.requestId) ?? []), p])
    idsOf.set(v.requestId, (idsOf.get(v.requestId) ?? new Set()).add(v.personId))
  }

  const all: PurchaseView[] = [...requests.values()]
    .map((r) => {
      const asker = r.askedBy ? people.get(r.askedBy) : undefined
      return {
        ...r,
        asker,
        askerName: asker?.name ?? (r.askedByName || 'Someone'),
        voters: (byRequest.get(r.id) ?? []).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
        voterIds: idsOf.get(r.id) ?? new Set<string>(),
      }
    })
    .sort(newest)
  const at = (...s: PurchaseStatus[]) => all.filter((r) => s.includes(r.status))
  const index = new Map(all.map((r) => [r.id, r]))
  return {
    all,
    open: at(...PURCHASE_OPEN).sort((a, b) => b.voterIds.size - a.voterIds.size || newest(a, b)),
    ordered: at('ordered').sort((a, b) => -newest(a, b)),
    settled: at('arrived', 'no'),
    get: (id) => index.get(id),
  }
}
