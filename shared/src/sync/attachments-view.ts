import { ATTACHMENT_KINDS, type Attachment, type AttachmentOwner } from '../attachments.ts'
import type { CommandArgs, Mutation } from '../commands.ts'

/**
 * Documents kept on venues and clients (ADR 0032) as a device sees them:
 * the details the server has sent, with this device's own waiting changes
 * laid over them. Never the files: those open from the server, with signal.
 */

export interface AttachmentView extends Attachment {
  pending: boolean
}

export interface AttachmentsView {
  /** A venue's or a client's, by kind, then title. */
  of(owner: AttachmentOwner, ownerId: string): AttachmentView[]
}

export function attachmentsView(
  entities: { attachment?: Record<string, Attachment> },
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number
): AttachmentsView {
  const all = new Map<string, AttachmentView>()
  // Snapshots saved before these existed have no table for them.
  for (const d of Object.values(entities.attachment ?? {})) all.set(d.id, { ...d, pending: false })

  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    switch (m.name) {
      case 'attachment.save': {
        const a = m.args as CommandArgs<'attachment.save'>
        const was = all.get(a.id)
        // The server refuses an id already used for something else's: shown as it is until it says so.
        if (was && (was.owner !== a.owner || was.ownerId !== a.ownerId)) break
        all.set(a.id, { ...a, file: was?.file ?? null, addedAt: was?.addedAt ?? m.createdAt, pending: true })
        break
      }
      case 'attachment.remove':
        all.delete((m.args as CommandArgs<'attachment.remove'>).id)
        break
    }
  }

  const byOwner = new Map<string, AttachmentView[]>()
  // Every order ends on the id, so two devices agree.
  const docs = [...all.values()].sort(
    (a, b) => ATTACHMENT_KINDS.indexOf(a.kind) - ATTACHMENT_KINDS.indexOf(b.kind) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
  )
  const key = (owner: AttachmentOwner, ownerId: string) => `${owner}:${ownerId}`
  for (const d of docs) byOwner.set(key(d.owner, d.ownerId), [...(byOwner.get(key(d.owner, d.ownerId)) ?? []), d])
  return { of: (owner, ownerId) => byOwner.get(key(owner, ownerId)) ?? [] }
}
