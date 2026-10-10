import type { CommandArgs, Mutation } from '../commands.ts'
import { VENUE_DOCUMENT_KINDS, type VenueDocument } from '../venue-documents.ts'

/**
 * Venues' documents (ADR 0032) as a device sees them: the details the
 * server has sent, with this device's own waiting changes laid over them.
 * Never the files: those open from the server, with signal.
 */

export interface VenueDocumentView extends VenueDocument {
  pending: boolean
}

export interface VenueDocumentsView {
  /** A venue's, by kind, then title. */
  of(venueId: string): VenueDocumentView[]
}

export function venueDocumentsView(
  entities: { venueDocument?: Record<string, VenueDocument> },
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number
): VenueDocumentsView {
  const all = new Map<string, VenueDocumentView>()
  // Snapshots saved before venues' documents existed have no table for them.
  for (const d of Object.values(entities.venueDocument ?? {})) all.set(d.id, { ...d, pending: false })

  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    switch (m.name) {
      case 'venueDocument.save': {
        const a = m.args as CommandArgs<'venueDocument.save'>
        const was = all.get(a.id)
        // The server refuses an id already used for another venue's: shown as it is until it says so.
        if (was && was.venueId !== a.venueId) break
        all.set(a.id, { ...a, file: was?.file ?? null, addedAt: was?.addedAt ?? m.createdAt, pending: true })
        break
      }
      case 'venueDocument.remove':
        all.delete((m.args as CommandArgs<'venueDocument.remove'>).id)
        break
    }
  }

  const byVenue = new Map<string, VenueDocumentView[]>()
  // Every order ends on the id, so two devices agree.
  const docs = [...all.values()].sort(
    (a, b) => VENUE_DOCUMENT_KINDS.indexOf(a.kind) - VENUE_DOCUMENT_KINDS.indexOf(b.kind) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
  )
  for (const d of docs) byVenue.set(d.venueId, [...(byVenue.get(d.venueId) ?? []), d])
  return { of: (venueId) => byVenue.get(venueId) ?? [] }
}
