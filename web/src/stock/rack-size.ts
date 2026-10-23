import type { RackView } from '@sh/shared'

/** A rack unit, in mm. */
export const RACK_U = 44.45
/** Drawn for a rack, or kit, with no depth given (ADR 0076). */
export const GUESS_RACK_DEPTH = 500
export const GUESS_KIT_DEPTH = 250

/** The size the rack is drawn at, in mm: its units, its rails' depth and its case from the outside. */
export function rackSize(r: RackView) {
  const m = r.model
  const placed = r.slots.filter((s) => s.top !== null)
  const units = m.units ?? Math.max(4, ...placed.map((s) => s.top! + (s.model?.units ?? 1) - 1))
  const height = units * RACK_U
  const depth = m.depthMm ?? GUESS_RACK_DEPTH
  return {
    units,
    height,
    depth,
    depthGuessed: m.depthMm === null,
    outside: { w: m.caseWidthMm ?? 482.6 + 90, h: m.caseHeightMm ?? height + 90, d: m.caseDepthMm ?? depth + 140 },
  }
}
