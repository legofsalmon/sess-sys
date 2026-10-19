import {
  callAsRead,
  offerAsRead,
  personAsRead,
  readingFor,
  readsDocumentOf,
  readsEverything,
  notesAsRead,
  timesheetAsRead,
  type CrewCall,
  type Document,
  type Offer,
  type Person,
  type ReaderOf,
  type Reading,
  type Role,
  type Timesheet,
} from '@sh/shared'
import type { Queryable } from './db.ts'
import { headsSeeRates } from './office/store.ts'

/**
 * The change feed narrowed to what a role reads of crew rates and private
 * links (ADR 0046), and of other people's details, documents and time off
 * (ADR 0062). The feed keeps every record as it was written; each one
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

/** The department of each booking's call, for a head who reads only their department's rates. A timesheet has its booking's id. */
async function callDepartments(q: Queryable, offerIds: string[]): Promise<Map<string, string | null>> {
  if (!offerIds.length) return new Map()
  const { rows } = await q.query<{ id: string; department: string | null }>(
    'SELECT o.id, c.department FROM offers o JOIN crew_calls c ON c.id = o.call_id WHERE o.id = ANY($1::text[])',
    [offerIds]
  )
  return new Map(rows.map((r) => [r.id, r.department]))
}

/**
 * A page of the feed as this reader is sent it: people, calls, offers,
 * timesheets and time off cut down, other people's documents left out, and
 * everything else as it is. A document left out still moves the cursor on.
 */
export async function asRead<C extends { entity: string; op: 'put' | 'delete'; data: unknown }>(q: Queryable, changes: C[], reading: Reading): Promise<C[]> {
  if (readsEverything(reading)) return changes
  const mine = reading.personId && changes.some((c) => c.entity === 'timesheet') ? await ownOffers(q, reading.personId) : new Set<string>()
  const departments =
    reading.ratesBy === 'department'
      ? await callDepartments(q, changes.filter((c) => c.op === 'put' && (c.entity === 'offer' || c.entity === 'timesheet')).map((c) => (c.data as { id: string }).id))
      : new Map<string, string | null>()
  return changes.flatMap((c) => {
    if (c.op !== 'put' || !c.data) return [c]
    switch (c.entity) {
      case 'person':
        return [{ ...c, data: personAsRead(c.data as Person, reading) }]
      case 'crewCall':
        return [{ ...c, data: callAsRead(c.data as CrewCall, reading) }]
      case 'offer': {
        const o = c.data as Offer
        return [{ ...c, data: offerAsRead(o, reading, departments.get(o.id)) }]
      }
      case 'timesheet': {
        const t = c.data as Timesheet
        return [{ ...c, data: timesheetAsRead(t, mine.has(t.id), reading, departments.get(t.id)) }]
      }
      case 'leaveRequest':
      case 'lieuEntry':
      case 'unavailability':
      case 'runningLate':
        return [{ ...c, data: notesAsRead(c.data as { personId: string; note: string; reason?: string }, reading) }]
      case 'document':
        return readsDocumentOf(reading, c.data as Document) ? [c] : []
      default:
        return [c]
    }
  })
}
