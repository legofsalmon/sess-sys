import { z } from 'zod'
import type { StoredFileInfo } from './documents.ts'
import { needed } from './plain.ts'

/**
 * A venue's documents (ADR 0032): its tech spec, floor plan, rigging and
 * power details, access notes, health and safety pack, and anything else
 * the office keeps for a place it works in. Each is a file, kept as
 * people's documents are (ADR 0029), or a link to where the venue keeps it
 * (a Dropbox or Google Drive page), or both. Venues are places, not
 * people, so nothing here is personal data and nothing runs out.
 */

const id = z.string().min(1).max(64)

export const VENUE_DOCUMENT_KINDS = ['tech-spec', 'floor-plan', 'rigging', 'power', 'access', 'health-safety', 'other'] as const
export type VenueDocumentKind = (typeof VENUE_DOCUMENT_KINDS)[number]

export const VENUE_DOCUMENT_KIND_LABELS: Record<VenueDocumentKind, string> = {
  'tech-spec': 'Tech spec',
  'floor-plan': 'Floor plan',
  rigging: 'Rigging',
  power: 'Power',
  access: 'Access and load-in',
  'health-safety': 'Health and safety',
  other: 'Something else',
}

/** The title each kind starts with, which can be changed; one for something else is typed. */
export const VENUE_DOCUMENT_TITLES: Record<VenueDocumentKind, string> = {
  'tech-spec': 'Tech spec',
  'floor-plan': 'Floor plan',
  rigging: 'Rigging plot',
  power: 'Power spec',
  access: 'Access and load-in',
  'health-safety': 'Health and safety pack',
  other: '',
}

/** A link the app will open: a web address, never one that runs code (javascript:) or opens something else. */
export const venueLink = z
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

export interface VenueDocument {
  id: string
  venueId: string
  kind: VenueDocumentKind
  title: string
  /** Where the venue keeps it, if that's how it came. */
  link: string | null
  /** The file's type and size, never its name or where it's kept; null for a link alone. */
  file: StoredFileInfo | null
  addedAt: string
}

export interface VenueDocumentEntities {
  venueDocument: VenueDocument
}
export const VENUE_DOCUMENT_ENTITY_NAMES = ['venueDocument'] as const

/** What a venue's document is, as typed: the same on the form and an upload's details. */
export const venueDocumentDetails = z.object({
  id,
  venueId: id,
  kind: z.enum(VENUE_DOCUMENT_KINDS),
  title: needed(100, 'The title', 'A title'),
  link: venueLink.nullable(),
})
export type VenueDocumentDetails = z.infer<typeof venueDocumentDetails>

export const venueDocumentCommandSchemas = {
  /** Add a venue's document as a link, or change one's details; a file it has stays. Works with no signal. */
  'venueDocument.save': venueDocumentDetails,
  /** Remove it; its file is deleted from the storage. */
  'venueDocument.remove': z.object({ id }),
} as const

/** Said while the server has no storage for files: a link works meanwhile (ADR 0032). */
export const FILES_WAIT_VENUE =
  "Files wait on the storage bucket being set up (the BACKUP_S3_ settings on the server in Railway, docs/backups.md). Meanwhile, keep a link to where the venue shares it, such as Dropbox or Google Drive."

/** What the server records a file put on a venue's document as: not a command, as it carries the file. */
export const VENUE_DOCUMENT_FILE_ACTION = 'venueDocument.file'

/** A title as it reads mid-sentence: "the Heritage's floor plan"; one typed keeps its capitals, as they may be a name. */
export const venueTitleInSentence = (title: string) =>
  Object.values(VENUE_DOCUMENT_TITLES).some((t) => t && title.startsWith(t)) ? title.charAt(0).toLowerCase() + title.slice(1) : title

/** Where a link goes, for a line under its title: "dropbox.com". */
export function linkHost(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '')
  } catch {
    return link
  }
}
