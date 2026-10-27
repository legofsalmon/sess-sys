import { spanAcross, TAPE_COLOUR_SWATCHES, type SlotView } from '@sh/shared'
import type { CSSProperties } from 'react'

/** How a thing in a rack is drawn flat, on the rack's page and in the designer (ADR 0079). */

/** What a thing in the rack is called there, and what's written on it: its label, else its product's name. */
export const slotName = (s: SlotView) => s.label || s.model?.name || '?'

/** A thing's look on the flat drawing: its tape as a swatch, its part, where it sits across (ADR 0079). */
export function thingStyle(s: SlotView, units: number): CSSProperties {
  const [from, to] = spanAcross(s.model?.rackWidth, s.across)
  return {
    gridRow: `${s.top} / span ${units}`,
    gridColumn: `${2 + Math.round(from * 12)} / ${2 + Math.round(to * 12)}`,
    ...(s.colour ? { '--tape': TAPE_COLOUR_SWATCHES[s.colour] } : {}),
  } as CSSProperties
}
export const thingClass = (s: SlotView) => [s.colour && 'taped', s.model?.rackPart && `part-${s.model.rackPart}`].filter(Boolean).join(' ')

