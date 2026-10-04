import type { CommandArgs, Mutation } from '../commands.ts'
import { certificateOf, DOCUMENT_KINDS, documentRunsOut, type Document } from '../documents.ts'
import type { CrewView, PersonView } from './crew-view.ts'

/**
 * People's documents (ADR 0029) as a device sees them: the details the
 * server has sent, with this device's own waiting changes laid over them.
 * Never the files: those open from the server, with signal.
 */

export interface DocumentView extends Document {
  pending: boolean
  person: PersonView | undefined
  /** The day it runs out as everything shows it: a certificate's card by the certificate on the person (documentRunsOut). */
  runsOut: string | null
}

export interface DocumentsView {
  /** Everyone's, by name, then kind, then title. */
  all: DocumentView[]
  /** A person's, by kind, then title. */
  of(personId: string): DocumentView[]
  /** Sent from a link and not checked yet: in "Answers to check" and on the Crew badge, oldest first. */
  toCheck: DocumentView[]
}

export function documentsView(
  entities: { document?: Record<string, Document> },
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number,
  crew: CrewView,
  /** People erased on request, an erasure still to send included: theirs go at once, as the server deletes them (ADR 0027). */
  erased: Readonly<Record<string, unknown>> = {}
): DocumentsView {
  const all = new Map<string, Document & { pending: boolean }>()
  // Snapshots saved before documents existed have no table for them.
  for (const d of Object.values(entities.document ?? {})) all.set(d.id, { ...d, pending: false })

  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    switch (m.name) {
      case 'document.save': {
        const a = m.args as CommandArgs<'document.save'>
        const was = all.get(a.id)
        // The server refuses another person's, and one still to check: shown as it is until it says so.
        if (was && (was.personId !== a.personId || !was.checkedAt)) break
        all.set(a.id, {
          id: a.id,
          personId: a.personId,
          kind: a.kind,
          title: a.title,
          // A certificate's card keeps no date of its own: the certificate on the person holds it.
          expires: certificateOf(a.kind) ? null : a.expires,
          file: was?.file ?? null,
          sentVia: was?.sentVia ?? 'office',
          sentAt: was?.sentAt ?? m.createdAt,
          checkedAt: was?.checkedAt ?? m.createdAt,
          renews: was?.renews ?? null,
          pending: true,
        })
        break
      }
      case 'document.check': {
        const a = m.args as CommandArgs<'document.check'>
        const d = all.get(a.id)
        if (!d || d.checkedAt) break
        all.set(d.id, { ...d, expires: certificateOf(d.kind) ? null : a.expires, checkedAt: m.createdAt, pending: true })
        // A renewal takes the place of the one it renews.
        const old = d.renews ? all.get(d.renews) : undefined
        if (old && old.personId === d.personId && old.id !== d.id) all.delete(old.id)
        break
      }
      case 'document.remove':
        all.delete((m.args as CommandArgs<'document.remove'>).id)
        break
    }
  }

  const people = new Map(crew.people.map((p) => [p.id, p]))
  const order = (a: DocumentView, b: DocumentView) =>
    DOCUMENT_KINDS.indexOf(a.kind) - DOCUMENT_KINDS.indexOf(b.kind) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
  const docs: DocumentView[] = [...all.values()]
    .filter((d) => !erased[d.personId])
    .map((d) => {
      const person = people.get(d.personId)
      return { ...d, person, runsOut: documentRunsOut(d, person) }
    })
    // Every order ends on the id, so two devices agree.
    .sort((a, b) => (a.person?.name ?? '').localeCompare(b.person?.name ?? '') || a.personId.localeCompare(b.personId) || order(a, b))
  const byPerson = new Map<string, DocumentView[]>()
  for (const d of docs) byPerson.set(d.personId, [...(byPerson.get(d.personId) ?? []), d])
  return {
    all: docs,
    of: (personId) => byPerson.get(personId) ?? [],
    toCheck: docs
      .filter((d) => d.sentVia === 'link' && !d.checkedAt && d.person && !d.person.archived)
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id)),
  }
}
