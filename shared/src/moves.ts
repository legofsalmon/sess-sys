import { z } from 'zod'
import { whole } from './plain.ts'
import { MAX_QTY } from './stock.ts'

/**
 * Scanning kit out to jobs and back in (ADR 0017). Each scan is a
 * movement: the job, out or back, the numbered item or the product and how
 * many, and when it happened on the phone. A scan records something that
 * already happened, so the server keeps it whatever the plan says; what's
 * out where is worked out on each device from the movements
 * (sync/pick-view.ts), ordered by when they happened.
 */

const id = z.string().min(1).max(64)

export const DIRECTIONS = ['out', 'in'] as const
export type Direction = (typeof DIRECTIONS)[number]

export interface Movement {
  id: string
  projectId: string
  direction: Direction
  /** The numbered item scanned; null for counted kit. A case takes what's in it along. */
  assetId: string | null
  /** The item's product, or the product counted. */
  modelId: string
  /** 1 for an item. */
  qty: number
  /** When it happened, by the phone's clock. */
  at: string
}

export interface MoveEntities {
  movement: Movement
}
export const MOVE_ENTITY_NAMES = ['movement'] as const

export const moveCommandSchemas = {
  /** Always kept, unless the job or the item was never saved. */
  'move.record': z
    .object({
      id,
      projectId: id,
      direction: z.enum(DIRECTIONS),
      assetId: id.nullable(),
      modelId: id,
      qty: whole(1, MAX_QTY, 'How many'),
      at: z.string().datetime({ offset: true }),
    })
    .refine((m) => m.assetId === null || m.qty === 1, { message: 'A numbered item is scanned one at a time.' }),
} as const
