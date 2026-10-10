import { z } from 'zod'
import type { StoredFileInfo } from './documents.ts'
import { needed } from './plain.ts'

/**
 * Documents kept on a venue or a client (ADR 0032): a venue's tech spec,
 * floor plan and health and safety pack; a client's contract, purchase
 * orders and brief. Each is a file, kept as people's documents are (ADR
 * 0029), or a link to where it's shared (a Dropbox or Google Drive page),
 * or both. The code calls them attachments, to keep them apart from
 * people's documents, which run out and are personal data; these are
 * neither.
 */

const id = z.string().min(1).max(64)

/** What a document can be kept on. */
export const ATTACHMENT_OWNERS = ['venue', 'client'] as const
export type AttachmentOwner = (typeof ATTACHMENT_OWNERS)[number]

/** The kinds each can have, in the order they're offered. */
export const ATTACHMENT_KINDS_OF = {
  venue: ['tech-spec', 'floor-plan', 'rigging', 'power', 'access', 'health-safety', 'other'],
  client: ['contract', 'purchase-order', 'brief', 'brand', 'insurance-terms', 'other'],
} as const satisfies Record<AttachmentOwner, readonly string[]>

export const ATTACHMENT_KINDS = [...new Set([...ATTACHMENT_KINDS_OF.venue, ...ATTACHMENT_KINDS_OF.client])] as [
  (typeof ATTACHMENT_KINDS_OF)[AttachmentOwner][number],
  ...(typeof ATTACHMENT_KINDS_OF)[AttachmentOwner][number][],
]
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  'tech-spec': 'Tech spec',
  'floor-plan': 'Floor plan',
  rigging: 'Rigging',
  power: 'Power',
  access: 'Access and load-in',
  'health-safety': 'Health and safety',
  contract: 'Contract',
  'purchase-order': 'Purchase order',
  brief: 'Brief',
  brand: 'Brand guidelines',
  'insurance-terms': 'Insurance they ask for',
  other: 'Something else',
}

/** The title each kind starts with, which can be changed; one for something else is typed. */
export const ATTACHMENT_TITLES: Record<AttachmentKind, string> = {
  'tech-spec': 'Tech spec',
  'floor-plan': 'Floor plan',
  rigging: 'Rigging plot',
  power: 'Power spec',
  access: 'Access and load-in',
  'health-safety': 'Health and safety pack',
  contract: 'Contract',
  'purchase-order': 'Purchase order',
  brief: 'Brief',
  brand: 'Brand guidelines',
  'insurance-terms': 'Insurance requirements',
  other: '',
}

/** A link the app will open: a web address, never one that runs code (javascript:) or opens something else. */
export const attachmentLink = z
  .string()
  .trim()
  .max(2000, 'The link can be up to 2,000 characters.')
  .refine((s) => {
    try {
      const u = new URL(s)
      return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname
    } catch {
      return false
    }
  }, "That link doesn't look right. Copy the whole address, starting https://.")

export interface Attachment {
  id: string
  /** What it's kept on, and which one. */
  owner: AttachmentOwner
  ownerId: string
  kind: AttachmentKind
  title: string
  /** Where it's shared, if that's how it came. */
  link: string | null
  /** The file's type and size, never its name or where it's kept; null for a link alone. */
  file: StoredFileInfo | null
  addedAt: string
}

export interface AttachmentEntities {
  attachment: Attachment
}
export const ATTACHMENT_ENTITY_NAMES = ['attachment'] as const

/** What a document on a venue or client is, as typed: the same on the form and an upload's details. */
export const attachmentDetails = z
  .object({
    id,
    owner: z.enum(ATTACHMENT_OWNERS),
    ownerId: id,
    kind: z.enum(ATTACHMENT_KINDS),
    title: needed(100, 'The title', 'A title'),
    link: attachmentLink.nullable(),
  })
  .refine((a) => (ATTACHMENT_KINDS_OF[a.owner] as readonly string[]).includes(a.kind), { message: "That kind of document isn't one for here.", path: ['kind'] })
export type AttachmentDetails = z.infer<typeof attachmentDetails>

export const attachmentCommandSchemas = {
  /** Add a document as a link, or change one's details; a file it has stays. Works with no signal. */
  'attachment.save': attachmentDetails,
  /** Remove it; its file is deleted from the storage. */
  'attachment.remove': z.object({ id }),
} as const

/** Said while the server has no storage for files: a link works meanwhile (ADR 0032). */
export const FILES_WAIT_LINK =
  "Files wait on the storage bucket being set up (the BACKUP_S3_ settings on the server in Railway, docs/backups.md). Meanwhile, keep a link to where it's shared, such as Dropbox or Google Drive."

/** What the server records a file put on one as: not a command, as it carries the file. */
export const ATTACHMENT_FILE_ACTION = 'attachment.file'

/** A title as it reads mid-sentence: "the Heritage's floor plan"; one typed keeps its capitals, as they may be a name. */
export const attachmentTitleInSentence = (title: string) =>
  Object.values(ATTACHMENT_TITLES).some((t) => t && title.startsWith(t)) ? title.charAt(0).toLowerCase() + title.slice(1) : title

/** Where a link goes, for a line under its title: "dropbox.com". */
export function linkHost(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '')
  } catch {
    return link
  }
}
