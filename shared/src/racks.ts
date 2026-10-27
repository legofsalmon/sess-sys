import { z } from 'zod'
import { text, whole } from './plain.ts'
import { MAX_UNITS, RACK_WIDTH_PARTS, type Model, type RackWidth } from './stock.ts'

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

/**
 * Where kit narrower than the rails sits across them (ADR 0079): half-width
 * kit on the left or the right (or in the middle, on its own), a third in
 * any of the three.
 */
export const RACK_ACROSS = ['left', 'middle', 'right'] as const
export type RackAcross = (typeof RACK_ACROSS)[number]
export const RACK_ACROSS_LABELS: Record<RackAcross, string> = { left: 'On the left', middle: 'In the middle', right: 'On the right' }

/**
 * The colour of the tape or label a thing in a rack is marked with, as crew
 * colour-code a rack's kit and looms (ADR 0079). It's content, like a
 * fixture's colour: shown as a swatch with its name, never meaning anything
 * in the app.
 */
export const TAPE_COLOURS = ['red', 'orange', 'yellow', 'green', 'blue', 'violet', 'white', 'grey', 'black'] as const
export type TapeColour = (typeof TAPE_COLOURS)[number]
export const TAPE_COLOUR_LABELS: Record<TapeColour, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  violet: 'Violet',
  white: 'White',
  grey: 'Grey',
  black: 'Black',
}
/** As the tape looks, for the swatch. */
export const TAPE_COLOUR_SWATCHES: Record<TapeColour, string> = {
  red: '#d7263d',
  orange: '#f28c28',
  yellow: '#f6d32d',
  green: '#2e9e4f',
  blue: '#2f6fd6',
  violet: '#8a4fd1',
  white: '#f4f4f4',
  grey: '#8c8c8c',
  black: '#1c1c1c',
}

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
  /**
   * Where it sits across the rails, for kit narrower than them (ADR 0079).
   * Left out by an older app, as are the rest, so they have defaults.
   */
  across: z.enum(RACK_ACROSS).default('left'),
  /** What's written on its label in this rack, such as "IEM 1–4"; empty for its product's name. */
  label: text(40, 'The label').default(''),
  /** The group it's in, such as "RF" or "Playback", for kit that works together; empty for none. */
  group: text(40, 'The group').default(''),
  colour: z.enum(TAPE_COLOURS).nullable().default(null),
  /** For loose kit: the shelf or drawer in this rack it's in; null for loose in the rack. */
  inSlotId: id.nullable().default(null),
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
type Sized = Pick<Model, 'id' | 'name' | 'units' | 'depthMm' | 'weightKg' | 'powerW'> &
  Partial<Pick<Model, 'dryHire' | 'hireDayCents' | 'valueCents' | 'rackMount' | 'rackWidth' | 'castors' | 'powerLimitA' | 'rackPart'>>

/**
 * The part of the rails' width a thing takes, from 0 at the left to 1 at
 * the right (ADR 0079). Half-width kit in the middle sits centred.
 */
export function spanAcross(width: RackWidth | undefined, across: RackAcross | undefined): [number, number] {
  const parts = RACK_WIDTH_PARTS[width ?? 'full']
  if (parts === 1) return [0, 1]
  const w = 1 / parts
  const from = across === 'right' ? 1 - w : across === 'middle' ? (1 - w) / 2 : 0
  return [from, from + w]
}
const sideBySide = (a: [number, number], b: [number, number]) => a[1] <= b[0] + 1e-9 || b[1] <= a[0] + 1e-9

/** Where across the rails a thing of this width can go: left and right for a half, all three for a third, nowhere to choose for full. */
export function acrossFor(width: RackWidth | undefined): readonly RackAcross[] {
  return RACK_WIDTH_PARTS[width ?? 'full'] === 1 ? [] : RACK_ACROSS
}

/** Which third of the rails a point across them is in, from 0 at the left to 1 at the right, for where narrower kit is put. */
export function acrossAt(x: number, width: RackWidth | undefined): RackAcross {
  const parts = RACK_WIDTH_PARTS[width ?? 'full']
  if (parts === 2) return x < 0.375 ? 'left' : x > 0.625 ? 'right' : 'middle'
  return x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'middle'
}

/** The mains voltage power is worked out at, in amps (ADR 0076). */
export const MAINS_VOLTS = 230
/** Heat given off, in BTU an hour, for each watt drawn. */
export const BTU_PER_WATT = 3.412
/** A rack heavier than this, all in, needs castors or more than two people to lift it. */
export const LIFT_LIMIT_KG = 50

/** Something about a layout that won't work as planned, said plainly. */
export interface RackProblem {
  /** The slot it's about, if one. */
  slotId?: string
  kind: 'no-room' | 'overlap' | 'too-deep' | 'no-size' | 'clash' | 'not-rack-mount' | 'too-heavy' | 'over-power'
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
  /** That power in amps at 230 V, to one decimal place, and the heat it gives off in BTU an hour (ADR 0076). */
  amps: number
  heatBtu: number
  /**
   * The dry hire kit in it (ADR 0075): what hiring it in costs a day, what
   * buying it would, and how many have no price given for each.
   */
  hire: { count: number; dayCents: number; dayMissing: number; buyCents: number; buyMissing: number }
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
  const frontUnits = new Set<number>()
  const rearUnits = new Set<number>()
  let weightKg = rack.weightKg ?? 0
  let weightMissing = rack.weightKg === null ? 1 : 0
  let powerW = 0
  let powerMissing = 0
  const hire = { count: 0, dayCents: 0, dayMissing: 0, buyCents: 0, buyMissing: 0 }
  const placed: { slot: RackSlot; m: Sized | undefined; from: number; to: number; span: [number, number] }[] = []
  for (const s of slots) {
    const m = models.get(s.modelId)
    if (m?.weightKg !== null && m?.weightKg !== undefined) weightKg += m.weightKg * s.qty
    else weightMissing += s.qty
    if (m?.powerW !== null && m?.powerW !== undefined) powerW += m.powerW * s.qty
    else if (s.top !== null) powerMissing += 1
    if (m?.dryHire) {
      hire.count += s.qty
      if (m.hireDayCents !== null && m.hireDayCents !== undefined) hire.dayCents += m.hireDayCents * s.qty
      else hire.dayMissing += s.qty
      if (m.valueCents !== null && m.valueCents !== undefined) hire.buyCents += m.valueCents * s.qty
      else hire.buyMissing += s.qty
    }
    if (s.top === null) continue
    const units = m?.units ?? 1
    if (m && m.rackMount === false)
      problems.push({ slotId: s.id, kind: 'not-rack-mount', message: `${m.name} isn't marked as rack-mount, so it may not go on the rails. Put it loose, or mark it rack-mount.` })
    if (m && m.units === null) problems.push({ slotId: s.id, kind: 'no-size', message: `${m.name} has no height given, so it's drawn as 1U.` })
    const from = s.top
    const to = s.top + units - 1
    // A unit with narrower kit side by side on it is used once (ADR 0079).
    for (let u = from; u <= to; u++) (s.side === 'front' ? frontUnits : rearUnits).add(u)
    if (rack.units !== null && to > rack.units)
      problems.push({
        slotId: s.id,
        kind: 'no-room',
        message: `${m?.name ?? 'That'} (${unitsLabel(units)}) at U${from} runs past the bottom of a ${unitsLabel(rack.units)} rack.`,
      })
    if (rack.depthMm !== null && m?.depthMm && m.depthMm > rack.depthMm)
      problems.push({ slotId: s.id, kind: 'too-deep', message: `${m.name} is ${m.depthMm} mm deep, and the rack takes ${rack.depthMm} mm.` })
    placed.push({ slot: s, m, from, to, span: spanAcross(m?.rackWidth, s.across) })
  }
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!
      const b = placed[j]!
      if (a.to < b.from || b.to < a.from) continue
      // Narrower kit side by side (ADR 0079) neither sits on top of the other nor meets it in the middle.
      if (sideBySide(a.span, b.span)) continue
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
  weightKg = Math.round(weightKg * 10) / 10
  const amps = Math.round((powerW / MAINS_VOLTS) * 10) / 10
  if (weightKg > LIFT_LIMIT_KG && rack.castors === false)
    problems.push({ kind: 'too-heavy', message: `It weighs ${weightKg} kg all in, more than two people should lift (${LIFT_LIMIT_KG} kg), and it isn't on castors.` })
  if (rack.powerLimitA !== null && rack.powerLimitA !== undefined && amps > rack.powerLimitA)
    problems.push({ kind: 'over-power', message: `It draws up to ${amps} A, more than its ${rack.powerLimitA} A power can take.` })
  return { frontUsed: frontUnits.size, rearUsed: rearUnits.size, weightKg, weightMissing, powerW, powerMissing, amps, heatBtu: Math.round(powerW * BTU_PER_WATT), hire, problems }
}

/** A run of empty rack units on one side of a rack. */
export interface RackGap {
  top: number
  units: number
}

/**
 * The runs of rack units on one side with nothing on them at all, top to
 * bottom (ADR 0079): where blank panels would go. A unit with half-width
 * kit on it isn't empty.
 */
export function gapsOf(rackUnits: number, slots: readonly RackSlot[], models: ReadonlyMap<string, Sized>, side: RackSide): RackGap[] {
  const taken = new Set<number>()
  for (const s of slots) {
    if (s.top === null || s.side !== side) continue
    const units = models.get(s.modelId)?.units ?? 1
    for (let u = 0; u < units; u++) taken.add(s.top + u)
  }
  const gaps: RackGap[] = []
  for (let u = 1; u <= rackUnits; u++) {
    if (taken.has(u)) continue
    const last = gaps.at(-1)
    if (last && last.top + last.units === u) last.units++
    else gaps.push({ top: u, units: 1 })
  }
  return gaps
}

/**
 * Blank panels to fill the gaps with (ADR 0079), the tallest that fits
 * first, from the blanks there are. A gap no blank is short enough for is
 * left, and said by what's returned as left over.
 */
export function blanksFor(gaps: readonly RackGap[], blanks: readonly { id: string; units: number }[]): { put: { modelId: string; top: number }[]; left: number } {
  const tallestFirst = [...blanks].filter((b) => b.units >= 1).sort((a, b) => b.units - a.units || a.id.localeCompare(b.id))
  const put: { modelId: string; top: number }[] = []
  let left = 0
  for (const g of gaps) {
    let top = g.top
    let room = g.units
    while (room > 0) {
      const b = tallestFirst.find((x) => x.units <= room)
      if (!b) {
        left += room
        break
      }
      put.push({ modelId: b.id, top })
      top += b.units
      room -= b.units
    }
  }
  return { put, left }
}

/** What a built rack should hold and doesn't, and what it holds that its layout doesn't have. */
export interface RackCheck {
  missing: { modelId: string; qty: number }[]
  extra: { modelId: string; qty: number }[]
  /** Dry hire kit in its layout (ADR 0075): hired in for each job, so never missing. */
  hireIn: { modelId: string; qty: number }[]
}

/**
 * A built rack against its layout, product by product: what it should hold
 * (each slot's product and how many) against what's in it (its items and
 * what's counted in it, directly).
 */
export function checkBuilt(slots: readonly RackSlot[], holds: ReadonlyMap<string, number>, dryHire: (modelId: string) => boolean = () => false): RackCheck {
  const want = new Map<string, number>()
  const hired = new Map<string, number>()
  for (const s of slots) {
    const into = dryHire(s.modelId) ? hired : want
    into.set(s.modelId, (into.get(s.modelId) ?? 0) + s.qty)
  }
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
  return { missing, extra, hireIn: [...hired].map(([modelId, qty]) => ({ modelId, qty })) }
}
