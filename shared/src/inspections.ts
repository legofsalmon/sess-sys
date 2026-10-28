import { z } from 'zod'
import { attachmentLink } from './attachments.ts'
import { day } from './day.ts'
import type { StoredFileInfo } from './documents.ts'
import { needed, text } from './plain.ts'

/**
 * Inspections (ADR 0020): the electrical test (PAT) and the thorough
 * examination of lifting gear, recorded on numbered items. A product says
 * how often its items need each; an item whose last one failed, or that's
 * overdue, can't go out until it passes again. A record says something that
 * already happened, so it's kept, as a scan is.
 */

const id = z.string().min(1).max(64)

/** Electrical testing (PAT), and the thorough examination lifting gear needs by law (S.I. 299/2007). */
export const INSPECTION_KINDS = ['pat', 'lifting'] as const
export type InspectionKind = (typeof INSPECTION_KINDS)[number]
export const INSPECTION_LABELS: Record<InspectionKind, string> = { pat: 'Electrical test (PAT)', lifting: 'Thorough examination' }
/** As a sentence says it: "its PAT", "its thorough examination". */
export const INSPECTION_SHORT: Record<InspectionKind, string> = { pat: 'PAT', lifting: 'thorough examination' }
/** What to suggest: a year between electrical tests, and six months for lifting gear, as the law sets for accessories. */
export const INSPECTION_MONTHS: Record<InspectionKind, number> = { pat: 12, lifting: 6 }
/** How soon before it's due the Stock tab starts listing it. */
export const DUE_SOON_DAYS = 30
export const MAX_MONTHS = 60

export interface Inspection {
  id: string
  assetId: string
  kind: InspectionKind
  passed: boolean
  /** When it was done, by the phone's clock; a day typed in is taken as noon, Irish time. */
  at: string
  /** Who did it: a person, or a testing company. */
  by: string
  note: string
}

/**
 * A certificate kept on numbered items (ADR 0094): the PAT certificate or
 * the report of a thorough examination that a test left, or another, such
 * as a declaration of conformity or a fire-retardancy certificate. One
 * certificate can cover many items, as a tester's report of a whole round
 * does. A test's certificate is the one of its kind covering its item and
 * dated the day it was done; another can run out on a day, and says so.
 */
export const ITEM_CERTIFICATE_KINDS = ['pat', 'lifting', 'other'] as const
export type ItemCertificateKind = (typeof ITEM_CERTIFICATE_KINDS)[number]
export const ITEM_CERTIFICATE_LABELS: Record<ItemCertificateKind, string> = {
  pat: 'PAT certificate',
  lifting: 'Report of thorough examination',
  other: 'Another certificate',
}
/** The title each kind starts with, which can be changed; another's is typed. */
export const ITEM_CERTIFICATE_TITLES: Record<ItemCertificateKind, string> = {
  pat: 'PAT certificate',
  lifting: 'Report of thorough examination',
  other: '',
}
/** As many items as one certificate covers: a big round of testing, with room. */
export const MAX_CERTIFICATE_ITEMS = 1000

export interface ItemCertificate {
  id: string
  kind: ItemCertificateKind
  title: string
  /** The day on it: the day the test was done, or the day another was issued. */
  day: string
  /** The day another runs out, if it does; never for a test's, which is due as its product says. */
  expires: string | null
  /** The items it covers, in the order they were added. */
  assetIds: string[]
  /** Where it's shared, if that's how it came. */
  link: string | null
  /** The file's type and size; null for a link alone. */
  file: StoredFileInfo | null
  addedAt: string
}

export interface InspectionEntities {
  inspection: Inspection
  itemCertificate: ItemCertificate
}
export const INSPECTION_ENTITY_NAMES = ['inspection', 'itemCertificate'] as const

/** How often a product's items need each inspection, in months; null for never. */
export const months = z.number().int().min(1).max(MAX_MONTHS).nullable()

/** What a certificate is, as typed: the same on the form and on an upload's details. */
export const itemCertificateDetails = z
  .object({
    id,
    kind: z.enum(ITEM_CERTIFICATE_KINDS),
    title: needed(100, 'The title', 'A title'),
    day,
    expires: day.nullable(),
    assetIds: z
      .array(id)
      .min(1, 'Choose the items it covers.')
      .max(MAX_CERTIFICATE_ITEMS, `One certificate can cover up to ${MAX_CERTIFICATE_ITEMS.toLocaleString('en-IE')} items.`)
      .transform((ids) => [...new Set(ids)]),
    link: attachmentLink.nullable(),
  })
  .refine((c) => c.kind === 'other' || c.expires === null, {
    message: "A test's certificate doesn't run out on a day of its own: it's due again as its product says.",
    path: ['expires'],
  })
  .refine((c) => !c.expires || c.expires >= c.day, { message: 'It runs out after the day on it.', path: ['expires'] })
export type ItemCertificateDetails = z.infer<typeof itemCertificateDetails>

export const inspectionCommandSchemas = {
  /** Always kept, unless the item was never saved or is retired. */
  'inspection.record': z.object({
    id,
    assetId: id,
    kind: z.enum(INSPECTION_KINDS),
    passed: z.boolean(),
    at: z.string().datetime({ offset: true }),
    by: text(200, 'Who did it'),
    note: text(2000, 'The note'),
  }),
  /** A certificate added as a link, or one's details changed, with every item it covers; a file it has stays. */
  'itemCertificate.save': itemCertificateDetails,
  /** Remove it; its file is deleted from the storage. The tests it was for stay. */
  'itemCertificate.remove': z.object({ id }),
} as const

/** What the server records a file put on one as: not a command, as it carries the file. */
export const ITEM_CERTIFICATE_FILE_ACTION = 'itemCertificate.file'

/** The same day `n` months on, or the month's last day when it has fewer: 31 Aug and 6 months is 28 Feb. */
export function monthsLater(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const first = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, last))
  return first.toISOString().slice(0, 10)
}
