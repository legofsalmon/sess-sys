import { z } from 'zod'
import { text, whole } from './plain.ts'
import { MAX_UNITS, type Model } from './stock.ts'

/**
 * Racks (ADR 0074). A rack is a product that is a rack case built up with
 * kit that travels together: a monitor rack, an amp rack, a playback rack.
 * Its layout says what goes where (a slot for each thing, at a rack unit
 * counted from the top, on the front or the back rails, or loose in it,
 * such as cables in the drawer). Its items are the racks actually built,
 * each a case holding the kit in it, so scanning one out or in takes all
 * of it along (ADR 0017), and a job books a rack by its name as one line.
 *
 * Nothing in a layout is refused for not fitting: it's a plan, and the
 * app says what doesn't fit, as it says what's short (ADR 0014).
 */

const id = z.string().min(1).max(64)

export const RACK_SIDES = ['front', 'rear'] as const
export type RackSide = (typeof RACK_SIDES)[number]
export const RACK_SIDE_LABELS: Record<RackSide, string> = { front: 'Front', rear: 'Back' }

/** The most of one thing loose in a rack: cables, adaptors. */
export const MAX_SLOT_QTY = 999

export const rackSlot = z.object({
  id,
  /** The rack's product. */
  rackId: id,
  /** What goes in it. */
  modelId: id,
  /** The rack unit its top sits at, counted from the top as 1; null for loose in the rack, such as in a drawer. */
  top: whole(1, MAX_UNITS, 'The rack unit').nullable(),
  side: z.enum(RACK_SIDES),
  /** How many: one for anything on the rails; loose kit can be more. */
  qty: whole(1, MAX_SLOT_QTY, 'How many'),
  notes: text(200, 'The note'),
})
export type RackSlot = z.infer<typeof rackSlot>

export interface RackEntities {
  rackSlot: RackSlot
}
export const RACK_ENTITY_NAMES = ['rackSlot'] as const

const onRailsIsOne = [(s: { top?: number | null; qty?: number }) => !(s.top !== null && s.top !== undefined && s.qty !== undefined && s.qty > 1), {
  message: 'Something on the rails is one at a time: add another for the next.',
}] as const

export const rackCommandSchemas = {
  /** A slot in a rack's layout, new or changed in full. */
  'rackSlot.set': rackSlot.refine(...onRailsIsOne),
  'rackSlot.remove': z.object({ id }),
} as const

/** The size of one thing in a rack, from its product. */
type Sized = Pick<Model, 'id' | 'name' | 'units' | 'depthMm' | 'weightKg' | 'powerW'>

/** Something about a layout that won't work as planned, said plainly. */
export interface RackProblem {
  /** The slot it's about, if one. */
  slotId?: string
  kind: 'no-room' | 'overlap' | 'too-deep' | 'no-size' | 'clash'
  message: string
}

export interface RackLayout {
  /** Rack units in use on the front, and on the back. */
  frontUsed: number
  rearUsed: number
  /** What it all weighs, the case's own weight included, and how much of that wasn't given. */
  weightKg: number
  weightMissing: number
  /** What it all draws at most, in watts, and how many on the rails have no figure. */
  powerW: number
  powerMissing: number
  problems: RackProblem[]
}

const unitsLabel = (n: number) => `${n}U`

/** "U3", "U3–4". */
export function unitsAt(top: number, units: number): string {
  return units <= 1 ? `U${top}` : `U${top}–${top + units - 1}`
}

/**
 * What a layout comes to and what won't fit: off the bottom of the rack,
 * on top of something else on the same rails, deeper than the rack, or a
 * front and back that meet in the middle. A slot on the rails whose
 * product has no height given takes one unit, and says so.
 */
export function layoutOf(rack: Sized, slots: readonly RackSlot[], models: ReadonlyMap<string, Sized>): RackLayout {
  const problems: RackProblem[] = []
  let frontUsed = 0
  let rearUsed = 0
  let weightKg = rack.weightKg ?? 0
  let weightMissing = rack.weightKg === null ? 1 : 0
  let powerW = 0
  let powerMissing = 0
  const placed: { slot: RackSlot; m: Sized | undefined; from: number; to: number }[] = []
  for (const s of slots) {
    const m = models.get(s.modelId)
    if (m?.weightKg !== null && m?.weightKg !== undefined) weightKg += m.weightKg * s.qty
    else weightMissing += s.qty
    if (m?.powerW !== null && m?.powerW !== undefined) powerW += m.powerW * s.qty
    else if (s.top !== null) powerMissing += 1
    if (s.top === null) continue
    const units = m?.units ?? 1
    if (m && m.units === null) problems.push({ slotId: s.id, kind: 'no-size', message: `${m.name} has no height given, so it's drawn as 1U.` })
    const from = s.top
    const to = s.top + units - 1
    if (s.side === 'front') frontUsed += units
    else rearUsed += units
    if (rack.units !== null && to > rack.units)
      problems.push({
        slotId: s.id,
        kind: 'no-room',
        message: `${m?.name ?? 'That'} (${unitsLabel(units)}) at U${from} runs past the bottom of a ${unitsLabel(rack.units)} rack.`,
      })
    if (rack.depthMm !== null && m?.depthMm && m.depthMm > rack.depthMm)
      problems.push({ slotId: s.id, kind: 'too-deep', message: `${m.name} is ${m.depthMm} mm deep, and the rack takes ${rack.depthMm} mm.` })
    placed.push({ slot: s, m, from, to })
  }
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!
      const b = placed[j]!
      if (a.to < b.from || b.to < a.from) continue
      const an = a.m?.name ?? 'That'
      const bn = b.m?.name ?? 'that'
      if (a.slot.side === b.slot.side)
        problems.push({ slotId: b.slot.id, kind: 'overlap', message: `${bn} at U${b.from} is on top of ${an} at U${a.from} on the ${RACK_SIDE_LABELS[a.slot.side].toLowerCase()}.` })
      else if (rack.depthMm !== null && a.m?.depthMm && b.m?.depthMm && a.m.depthMm + b.m.depthMm > rack.depthMm)
        problems.push({
          slotId: b.slot.id,
          kind: 'clash',
          message: `${an} on the ${RACK_SIDE_LABELS[a.slot.side].toLowerCase()} and ${bn} on the ${RACK_SIDE_LABELS[b.slot.side].toLowerCase()} meet in the middle: ${a.m.depthMm + b.m.depthMm} mm in a ${rack.depthMm} mm rack.`,
        })
    }
  return { frontUsed, rearUsed, weightKg: Math.round(weightKg * 10) / 10, weightMissing, powerW, powerMissing, problems }
}

/** What a built rack should hold and doesn't, and what it holds that its layout doesn't have. */
export interface RackCheck {
  missing: { modelId: string; qty: number }[]
  extra: { modelId: string; qty: number }[]
}

/**
 * A built rack against its layout, product by product: what it should hold
 * (each slot's product and how many) against what's in it (its items and
 * what's counted in it, directly).
 */
export function checkBuilt(slots: readonly RackSlot[], holds: ReadonlyMap<string, number>): RackCheck {
  const want = new Map<string, number>()
  for (const s of slots) want.set(s.modelId, (want.get(s.modelId) ?? 0) + s.qty)
  const missing: RackCheck['missing'] = []
  const extra: RackCheck['extra'] = []
  for (const [modelId, qty] of want) {
    const has = holds.get(modelId) ?? 0
    if (has < qty) missing.push({ modelId, qty: qty - has })
  }
  for (const [modelId, qty] of holds) {
    const short = qty - (want.get(modelId) ?? 0)
    if (short > 0) extra.push({ modelId, qty: short })
  }
  return { missing, extra }
}
