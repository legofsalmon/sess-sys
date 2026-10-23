import type { DragEvent } from 'react'

/** Picking kit up and putting it down in the rack designer (ADR 0075), shared by its flat and 3D views (ADR 0076). */

/** What's picked up: a product from the list, or a thing already in the rack. */
export type Held = ({ kind: 'new'; modelId: string } | { kind: 'slot'; slotId: string }) & {
  /** Picked up by dragging, which needs no line telling how to put it down. */
  drag?: true
}

export const DRAG_TYPE = 'application/x-sh-rack'
export const heldOf = (e: DragEvent): Held | undefined => {
  const raw = e.dataTransfer.getData(DRAG_TYPE)
  if (!raw) return undefined
  const [kind, id] = raw.split(':')
  return kind === 'new' ? { kind, modelId: id! } : kind === 'slot' ? { kind, slotId: id! } : undefined
}
