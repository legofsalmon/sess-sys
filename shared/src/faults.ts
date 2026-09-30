import { z } from 'zod'
import { MAX_QTY } from './stock.ts'

/**
 * Faults and missing kit (ADR 0018): something wrong with a numbered item,
 * or with some counted kit, reported at the warehouse, on return from a
 * job, or anywhere else. A report records something that already
 * happened, so the server keeps it, as it does a scan. Open ones are the
 * repair list; kit that can't go out is taken off what's free for jobs.
 */

const id = z.string().min(1).max(64)

/** Damaged: broken, worn or needing a check. Missing: didn't come back, or can't be found. */
export const FAULT_KINDS = ['damaged', 'missing'] as const
export type FaultKind = (typeof FAULT_KINDS)[number]

/**
 * How a fault ends. Fixed or not faulty after all, for damage; found, for
 * missing kit; written off for either, which retires an item (scrapped,
 * or lost) or takes counted kit off the count.
 */
export const FAULT_OUTCOMES = ['fixed', 'not-faulty', 'found', 'written-off'] as const
export type FaultOutcome = (typeof FAULT_OUTCOMES)[number]
export const OUTCOME_LABELS: Record<FaultOutcome, string> = {
  fixed: 'Fixed',
  'not-faulty': 'Not faulty',
  found: 'Found',
  'written-off': 'Written off',
}
/** Which outcomes fit which kind of fault. */
export const OUTCOMES_FOR: Record<FaultKind, readonly FaultOutcome[]> = {
  damaged: ['fixed', 'not-faulty', 'written-off'],
  missing: ['found', 'written-off'],
}

export interface Fault {
  id: string
  kind: FaultKind
  /** The numbered item; null for counted kit. */
  assetId: string | null
  /** The item's product, or the product counted. */
  modelId: string
  /** 1 for an item. */
  qty: number
  /** The job it came back from, or didn't; null when it wasn't on a job. */
  projectId: string | null
  /** Damaged but fine to go out, such as a dented case. Missing kit never can. */
  usable: boolean
  /** What's wrong, or where it was last seen. */
  note: string
  /** What's been done about it, for whoever repairs it next. */
  repair: string
  /** When it was reported, by the phone's clock. */
  at: string
  /** Null while it's open. */
  outcome: FaultOutcome | null
  closedAt: string | null
}

export interface FaultEntities {
  fault: Fault
}
export const FAULT_ENTITY_NAMES = ['fault'] as const

export const faultCommandSchemas = {
  /** Always kept, unless the item, product or job was never saved, or the item is retired. */
  'fault.report': z
    .object({
      id,
      kind: z.enum(FAULT_KINDS),
      assetId: id.nullable(),
      modelId: id,
      qty: z.number().int().min(1).max(MAX_QTY),
      projectId: id.nullable(),
      usable: z.boolean(),
      note: z.string().max(2000),
      at: z.string().datetime({ offset: true }),
    })
    .refine((f) => f.assetId === null || f.qty === 1, { message: 'A numbered item is reported one at a time.' })
    .refine((f) => f.kind === 'damaged' || !f.usable, { message: "Missing kit can't go out." }),
  /** What's wrong, what's been done, and whether it can go out meanwhile. */
  'fault.update': z
    .object({ id, usable: z.boolean().optional(), note: z.string().max(2000).optional(), repair: z.string().max(4000).optional() })
    .refine((u) => u.usable !== undefined || u.note !== undefined || u.repair !== undefined, { message: 'Nothing to change.' }),
  /** Done with: fixed, not faulty, found, or written off. Written off retires an item or takes counted kit off the count. */
  'fault.close': z.object({ id, outcome: z.enum(FAULT_OUTCOMES), at: z.string().datetime({ offset: true }) }),
} as const
