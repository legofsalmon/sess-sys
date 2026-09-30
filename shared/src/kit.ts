import { z } from 'zod'
import { MAX_QTY } from './stock.ts'

/**
 * Kit on jobs (ADR 0014): how many of each product a job needs, for the
 * whole job or for one of its phases, and how many of those are hired in
 * from another company. The architecture calls a line of a job's kit an
 * equipment line; the code calls it a kit line.
 *
 * Nothing is refused for being short. What's free and what's short is
 * worked out on each device from the jobs, their phases, these lines and
 * the stock list (sync/kit-view.ts), and shown until someone sorts it out.
 */

const id = z.string().min(1).max(64)
const qty = z.number().int().min(1).max(MAX_QTY)
const subhireQty = z.number().int().min(0).max(MAX_QTY)

export const kitLine = z.object({
  id,
  projectId: id,
  /** Null: the whole job, from its first day to its last. */
  phaseId: id.nullable(),
  modelId: id,
  qty,
  /** How many of them are hired in from another company rather than taken from Session Hire's own. */
  subhireQty,
  /** Who they're hired from, as typed. */
  supplier: z.string().max(200),
  /** Such as "spares" or "for the side stage". */
  notes: z.string().max(500),
})
export type KitLine = z.infer<typeof kitLine>

export interface KitEntities {
  kitLine: KitLine
}
export const KIT_ENTITY_NAMES = ['kitLine'] as const

const subhireFits = [
  (l: { qty?: number; subhireQty?: number }) => l.qty === undefined || l.subhireQty === undefined || l.subhireQty <= l.qty,
  { message: "More can't be subhired than the job needs." },
] as const
const somethingToChange = [
  (u: Record<string, unknown>) => Object.keys(u).some((k) => k !== 'id' && u[k] !== undefined),
  { message: 'Nothing to change.' },
] as const

export const kitCommandSchemas = {
  'kit.add': kitLine.refine(...subhireFits),
  /**
   * Only the fields the person changed, as for jobs. How many and how many
   * are subhired are checked on the server as the line will be, since
   * someone else may have changed the other.
   */
  'kit.update': z
    .object({
      id,
      phaseId: kitLine.shape.phaseId.optional(),
      modelId: id.optional(),
      qty: qty.optional(),
      subhireQty: subhireQty.optional(),
      supplier: kitLine.shape.supplier.optional(),
      notes: kitLine.shape.notes.optional(),
    })
    .refine(...somethingToChange)
    .refine(...subhireFits),
  'kit.remove': z.object({ id }),
} as const
