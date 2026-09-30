import { z } from 'zod'

/**
 * Inspections (ADR 0019): the electrical test (PAT) and the thorough
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

export interface InspectionEntities {
  inspection: Inspection
}
export const INSPECTION_ENTITY_NAMES = ['inspection'] as const

/** How often a product's items need each inspection, in months; null for never. */
export const months = z.number().int().min(1).max(MAX_MONTHS).nullable()

export const inspectionCommandSchemas = {
  /** Always kept, unless the item was never saved or is retired. */
  'inspection.record': z.object({
    id,
    assetId: id,
    kind: z.enum(INSPECTION_KINDS),
    passed: z.boolean(),
    at: z.string().datetime({ offset: true }),
    by: z.string().max(200),
    note: z.string().max(2000),
  }),
} as const

/** The same day `n` months on, or the month's last day when it has fewer: 31 Aug and 6 months is 28 Feb. */
export function monthsLater(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const first = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, last))
  return first.toISOString().slice(0, 10)
}
