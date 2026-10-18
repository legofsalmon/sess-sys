import { callAsRead, offerAsRead, personAsRead, readingFor, readsEverything, timesheetAsRead, type CrewCall, type Offer, type Person, type ReaderOf, type Reading, type Role, type Timesheet } from '@sh/shared'
import type { Queryable } from './db.ts'
import { headsSeeRates } from './office/store.ts'

/**
 * The change feed narrowed to what a role reads of crew rates and private
 * links (ADR 0046). The feed keeps every record as it was written; each one
 * is cut down as it goes out, so a device holds only what it may show. The
 * rules are shared/src/reading.ts's.
 */

/** What this request reads: its role, who it is, and for a head, whether a director lets them see rates. */
export async function readingOf(q: Queryable, role: Role | null, reader: ReaderOf): Promise<Reading> {
  return readingFor(role, { ...reader, headsSeeRates: role === 'head' && (await headsSeeRates(q)) })
}

/** The bookings that are this reader's own, whose timesheets they always read. Only asked for when a page has timesheets on it. */
async function ownOffers(q: Queryable, personId: string): Promise<Set<string>> {
  const { rows } = await q.query<{ id: string }>('SELECT id FROM offers WHERE person_id = $1', [personId])
  return new Set(rows.map((r) => r.id))
}

/** A page of the feed as this reader is sent it: people, calls, offers and timesheets cut down, everything else as it is. */
export async function asRead<C extends { entity: string; op: 'put' | 'delete'; data: unknown }>(q: Queryable, changes: C[], reading: Reading): Promise<C[]> {
  if (readsEverything(reading)) return changes
  const mine = reading.personId && changes.some((c) => c.entity === 'timesheet') ? await ownOffers(q, reading.personId) : new Set<string>()
  return changes.map((c) => {
    if (c.op !== 'put' || !c.data) return c
    switch (c.entity) {
      case 'person':
        return { ...c, data: personAsRead(c.data as Person, reading) }
      case 'crewCall':
        return { ...c, data: callAsRead(c.data as CrewCall, reading) }
      case 'offer':
        return { ...c, data: offerAsRead(c.data as Offer, reading) }
      case 'timesheet': {
        const t = c.data as Timesheet
        return { ...c, data: timesheetAsRead(t, mine.has(t.id), reading) }
      }
      default:
        return c
    }
  })
}
