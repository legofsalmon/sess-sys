import { spanAcross, TAPE_COLOUR_SWATCHES, type RackView, type SlotView } from '@sh/shared'
import type { CSSProperties } from 'react'
import { productPhotoOf } from '../Picture.tsx'

/** How a thing in a rack is drawn flat, on the rack's page and in the designer (ADR 0079). */

/** What a thing in the rack is called there, and what's written on it: its label, else its product's name. */
export const slotName = (s: SlotView) => s.label || s.model?.name || '?'

/** A thing's look on the flat drawing: its tape as a swatch, its part, where it sits across (ADR 0079), and its product's photo (ADR 0083). */
export function thingStyle(s: SlotView, units: number): CSSProperties {
  const [from, to] = spanAcross(s.model?.rackWidth, s.across)
  const photo = productPhotoOf(s.model)
  return {
    gridRow: `${s.top} / span ${units}`,
    gridColumn: `${2 + Math.round(from * 12)} / ${2 + Math.round(to * 12)}`,
    ...(s.colour ? { '--tape': TAPE_COLOUR_SWATCHES[s.colour] } : {}),
    ...(photo ? { '--photo': `url("${photo}")` } : {}),
  } as CSSProperties
}
export const thingClass = (s: SlotView) => [s.colour && 'taped', s.model?.rackPart && `part-${s.model.rackPart}`, s.model?.photo && 'with-photo'].filter(Boolean).join(' ')


/** The shelves and drawers on a rack's rails, which loose kit can be in (ADR 0079). */
export const holdersIn = (r: RackView) => r.slots.filter((s) => s.top !== null && (s.model?.rackPart === 'shelf' || s.model?.rackPart === 'drawer'))

/** "2U drawer at U3", as a shelf or drawer is told from another. */
export const holderName = (s: SlotView) => `${s.label || s.model?.name || '?'} at U${s.top}${s.side === 'rear' ? ' on the back' : ''}`
