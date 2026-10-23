import { z } from 'zod'
import { day } from './day.ts'
import { months } from './inspections.ts'
import { euroCents, needed, text, whole } from './plain.ts'

/**
 * The warehouse catalogue (ADR 0013): products, the numbered items of them,
 * the places kit lives, cases, and counted stock.
 *
 * The code calls a product a model, since the Phase 0 sync test already had
 * products, and a numbered item an asset, as the architecture does; the app
 * says product and item.
 *
 * Nothing is labelled yet, so a numbered product can be counted until its
 * items are labelled: 24 × d&b Y10P counted at the warehouse are 24 not
 * labelled yet, and labelling one turns one counted into one item.
 */

const id = z.string().min(1).max(64)
/** The tallest rack there is: 60 rack units. */
export const MAX_UNITS = 60

/** How much of a rack's width a thing takes (ADR 0076). */
export const RACK_WIDTHS = ['full', 'half', 'third'] as const
export type RackWidth = (typeof RACK_WIDTHS)[number]
export const RACK_WIDTH_LABELS: Record<RackWidth, string> = { full: 'Full width', half: 'Half width', third: 'A third' }
/** How many fit side by side. */
export const RACK_WIDTH_PARTS: Record<RackWidth, number> = { full: 1, half: 2, third: 3 }
/**
 * The parts a rack is built with besides kit (ADR 0078): a
 * blank panel over an empty unit, a vent panel, a shelf for kit that isn't
 * rack-mount, and a drawer for cables and spares.
 */
export const RACK_PARTS = ['blank', 'vent', 'shelf', 'drawer'] as const
export type RackPart = (typeof RACK_PARTS)[number]
export const RACK_PART_LABELS: Record<RackPart, string> = { blank: 'A blank panel', vent: 'A vent panel', shelf: 'A shelf', drawer: 'A drawer' }
/** Kilos to a tenth, as typed: "12.5". */
const kilos = z
  .number({ invalid_type_error: 'The weight is a number of kilos, such as 12.5.' })
  .min(0, 'The weight is a number of kilos, such as 12.5.')
  .max(5000, 'The weight can be up to 5,000 kg.')
  .transform((n) => Math.round(n * 10) / 10)
/** A stock code as kept: trimmed, so the phone shows what the server keeps. */
const stockCode = text(30, 'The stock code').transform((s) => s.trim())
/** Money in euro cents, so sums never drift. */
const cents = euroCents(1_000_000_00, 'A value')

export const DEPARTMENTS = ['audio', 'lighting', 'video', 'staging', 'rigging', 'power', 'other'] as const
export type Department = (typeof DEPARTMENTS)[number]
export const DEPARTMENT_LABELS: Record<Department, string> = {
  audio: 'Audio',
  lighting: 'Lighting',
  video: 'Video',
  staging: 'Staging',
  rigging: 'Rigging',
  power: 'Power',
  other: 'Other',
}

/** Categories to suggest before any are in use. Any other can be typed. */
export const CATEGORY_IDEAS = [
  'Speakers',
  'Amps',
  'Mics',
  'Consoles',
  'Stage boxes',
  'Cables',
  'Fixtures',
  'Dimmers',
  'Screens',
  'Projectors',
  'Truss',
  'Motors',
  'Distros',
  'Cases',
] as const

/**
 * Numbered (serialised): each one has its own label, for anything worth
 * more than about €150, needing its own test or inspection history, or
 * likely to go missing. Counted (bulk): quantities only.
 */
/** The most other names a product can have. */
export const MOST_ALIASES = 20

/** Other names as typed, split at commas: trimmed, each once whatever its case, and none that is the name itself. */
export function aliasesOf(typed: string, name = ''): string[] {
  const out: string[] = []
  for (const part of typed.split(/[,;\n]/)) {
    const a = part.trim().replace(/\s+/g, ' ')
    if (a && a.toLowerCase() !== name.trim().toLowerCase() && !out.some((x) => x.toLowerCase() === a.toLowerCase())) out.push(a)
  }
  return out
}

export const TRACKING = ['serialised', 'bulk'] as const
export type Tracking = (typeof TRACKING)[number]

export const model = z.object({
  id,
  name: needed(200, "The product's name", "The product's name"),
  department: z.enum(DEPARTMENTS),
  /** Typed, such as Speakers or Cables; the app suggests the ones in use. */
  category: text(100, 'The category'),
  tracking: z.enum(TRACKING),
  /** Holds other kit: a road case, rack, bag or cable bundle. Always numbered. */
  isCase: z.boolean(),
  /** What one would cost to replace. */
  valueCents: cents.nullable(),
  notes: text(2000, 'The notes'),
  /** How often its items need an electrical test (PAT), and a thorough examination, in months; null for never (ADR 0020). */
  patMonths: months.default(null),
  liftingMonths: months.default(null),
  /**
   * Other names it goes by (ADR 0070): what crew and the notes call it, such
   * as "58" or "Beta 58" for a Shure SM58. Found by the product picker and by
   * Kit from the notes as the name is. Left out by an older app, so a default.
   */
  aliases: z.array(needed(100, 'Another name', 'Another name')).max(MOST_ALIASES, `Up to ${MOST_ALIASES} other names, please.`).default([]),
  /**
   * Its id in the list it was brought in from, such as Current RMS's (audit,
   * 20 October 2026, finding 7), so a later bring-in of the same list finds
   * it however it has been renamed there. Empty or left out for none.
   */
  listId: text(100, 'Its id in the list').optional(),
  /**
   * A rack (ADR 0074): kit built up in a rack case that travels as one, with
   * a layout of what goes where (rackSlot). Its items are the built racks,
   * each holding the kit in it, so it's always a numbered case. What's in a
   * built rack goes with the rack, not on its own.
   */
  isRack: z.boolean().default(false),
  /** Its own short stock code, such as RK-MON-A; found as its name is. Empty for none. */
  code: stockCode.default(''),
  /**
   * Its size in a rack (ADR 0074): how many rack units high, and how deep,
   * for anything that goes in one; for a rack, the room in it. Null where
   * not given.
   */
  units: whole(1, MAX_UNITS, 'Rack units').nullable().default(null),
  depthMm: whole(1, 3000, 'The depth in mm').nullable().default(null),
  /** What one weighs, to a tenth of a kilo; for a rack, the case empty. */
  weightKg: kilos.nullable().default(null),
  /** What it draws at most, in watts. */
  powerW: whole(0, 100_000, 'The power in watts').nullable().default(null),
  /**
   * Dry hire stock (ADR 0075): not ours, hired in from a supplier whenever a
   * job or a rack needs it, so it has no items or counts of its own and is
   * never short. Its value is then what one would cost to buy.
   */
  dryHire: z.boolean().default(false),
  /** Who it's hired from, as typed. */
  supplier: text(200, 'The supplier').transform((s) => s.trim()).default(''),
  /** What the supplier charges for one a day. */
  hireDayCents: euroCents(100_000_00, 'A hire price').nullable().default(null),
  /**
   * Made to go on a rack's rails (ADR 0076): its height in rack units, how
   * wide it is across the rails and its depth then mean something, and it
   * can be put on the rails in a layout. Kit that isn't can go loose in one.
   */
  rackMount: z.boolean().default(false),
  /** How much of the rails' width it takes: a whole 19-inch width, half or a third. */
  rackWidth: z.enum(RACK_WIDTHS).default('full'),
  /** A rack's case from the outside, in mm, for the truck and the lift (ADR 0076). Null where not given. */
  caseWidthMm: whole(1, 3000, 'The width in mm').nullable().default(null),
  caseHeightMm: whole(1, 3000, 'The height in mm').nullable().default(null),
  caseDepthMm: whole(1, 3000, 'The depth in mm').nullable().default(null),
  /** A rack's case on castors, so it's wheeled rather than lifted. */
  castors: z.boolean().default(false),
  /** What a rack's power can take, in amps, such as a 16 A distro in it. Null where not given. */
  powerLimitA: whole(1, 125, 'The amps').nullable().default(null),
  /** A rack part rather than kit (ADR 0078): a blank, a vent, a shelf or a drawer; null for kit. Only rack-mount products are. */
  rackPart: z.enum(RACK_PARTS).nullable().default(null),
})
/** A product of our own that isn't a rack and has no size or stock code given (ADR 0074), as products made before racks read. */
export const PLAIN_PRODUCT = {
  isRack: false,
  code: '',
  units: null,
  depthMm: null,
  weightKg: null,
  powerW: null,
  dryHire: false,
  supplier: '',
  hireDayCents: null,
  rackMount: false,
  rackWidth: 'full',
  caseWidthMm: null,
  caseHeightMm: null,
  caseDepthMm: null,
  castors: false,
  powerLimitA: null,
  rackPart: null,
} as const

export type Model = z.infer<typeof model> & {
  /**
   * Marked as added by mistake (audit finding 19): kept for the history, with
   * its items retired as `mistake` and its counts gone, and out of every list.
   */
  mistake: boolean
}

/** Why an item is no longer stock. `mistake` is for one that never was: it's hidden everywhere but the history. */
export const RETIRED_REASONS = ['sold', 'scrapped', 'lost', 'stolen', 'mistake'] as const
export type RetiredReason = (typeof RETIRED_REASONS)[number]
export const RETIRED_LABELS: Record<RetiredReason, string> = { sold: 'Sold', scrapped: 'Scrapped', lost: 'Lost', stolen: 'Stolen', mistake: 'Added by mistake' }

/**
 * One numbered item. Its id is internal and never printed, so a worn label
 * can be replaced without touching its history. It lives at a place or in
 * a case, never both; neither while nobody has said where.
 */
export interface Asset {
  id: string
  modelId: string
  /** Its Session Hire number, as on its label. Given by the server; empty on a device until then. */
  number: string
  /** Numbers it had before a new label replaced them, oldest first. Never used again. */
  formerNumbers: string[]
  /** The manufacturer's serial. */
  serial: string
  /**
   * A tag it had before Session Hire's labels, such as an old asset number or
   * a maker's barcode, brought in with the stock list (ADR 0026), so scanning
   * it still finds the item. Empty for none; never one in Session Hire's form.
   */
  oldNumber: string
  /** When the stock list said its next PAT is due, used until a test is recorded here (ADR 0026); null for none. */
  patDue: string | null
  placeId: string | null
  caseId: string | null
  status: 'active' | 'retired'
  retiredReason: RetiredReason | null
  retiredNote: string | null
  notes: string
}

/** Where kit lives: the warehouse, a bay or shelf, a van, the repair bench. */
export const place = z.object({
  id,
  name: needed(200, "The place's name", "The place's name"),
  notes: text(2000, 'The notes'),
})
export type Place = z.infer<typeof place>

/** How many of a product are at a place or in a case. Gone once there are none. */
export interface Stock {
  /** From the product and where: see `stockId`. */
  id: string
  modelId: string
  placeId: string | null
  caseId: string | null
  qty: number
}

export interface StockEntities {
  model: Model
  asset: Asset
  place: Place
  stock: Stock
}
export const STOCK_ENTITY_NAMES = ['model', 'asset', 'place', 'stock'] as const

/** A place or a case, as commands name where something is. */
export interface Where {
  placeId: string | null
  caseId: string | null
}

/** The id of the counted stock of a product at a place or in a case, the same on every device. */
export const stockId = (modelId: string, w: Where) => `${modelId}@${w.placeId ? `p:${w.placeId}` : `c:${w.caseId}`}`

/** Cases inside cases, counted from the outermost: a rack in a truck pack is two deep. */
export const MAX_CASE_DEPTH = 5

/** The most of anything counted in one place. */
export const MAX_QTY = 1_000_000

/**
 * "SH-000123" from what a person types or a scanner reads: "SH-000123",
 * "sh 123", "SH123", "000123" or "123", or a label's link ending in
 * /a/000123. Undefined for anything else.
 */
export function normaliseNumber(text: string): string | undefined {
  const t = text.trim().toUpperCase()
  const m = /^(?:SH[\s-]*)?(\d{1,6})$/.exec(t) ?? /\/A\/(\d{1,6})\/?$/.exec(t)
  if (!m || Number(m[1]) === 0) return undefined
  return `SH-${m[1]!.padStart(6, '0')}`
}

/** Written in Session Hire's own form, "SH-000123" or "sh 123", as against digits alone, which could be any old tag (ADR 0026). */
export const inShForm = (text: string) => /^\s*sh[\s-]*\d{1,6}\s*$/i.test(text) && normaliseNumber(text) !== undefined

const oneOrNone = [(w: Where) => !(w.placeId && w.caseId), { message: 'Something lives at a place or in a case, not both.' }] as const
const exactlyOne = [(w: Where) => !!w.placeId !== !!w.caseId, { message: 'Say where: a place or a case.' }] as const
const caseIsNumbered = [
  (m: { tracking?: Tracking; isCase?: boolean }) => !(m.isCase && m.tracking === 'bulk'),
  { message: 'A case has its own number, so it is numbered, not counted.' },
] as const
const rackIsOurs = [
  (m: { isRack?: boolean; dryHire?: boolean }) => !(m.isRack && m.dryHire),
  { message: 'A rack is built here, so it is ours, not dry hired.' },
] as const
const rackIsCase = [
  (m: { isRack?: boolean; isCase?: boolean }) => !(m.isRack && m.isCase === false),
  { message: 'A rack holds other kit, so it is a case.' },
] as const
const rackIsNotMounted = [
  (m: { isRack?: boolean; rackMount?: boolean }) => !(m.isRack && m.rackMount),
  { message: 'A rack holds rack-mount kit; it doesn\'t go on the rails of another.' },
] as const
const partIsMounted = [
  (m: { isRack?: boolean; rackMount?: boolean; rackPart?: RackPart | null }) => !(m.rackPart && (m.rackMount === false || m.isRack)),
  { message: 'A blank, vent, shelf or drawer goes on the rails, so it is rack-mount.' },
] as const
const somethingToChange = [
  (u: Record<string, unknown>) => Object.keys(u).some((k) => k !== 'id' && u[k] !== undefined),
  { message: 'Nothing to change.' },
] as const

const where = { placeId: id.nullable(), caseId: id.nullable() }
/** As typed or scanned; the server reads it as `normaliseNumber` does. Null: the next free number. */
const typedNumber = text(100, 'The number').nullable()
/** An old tag kept on an item (ADR 0026); left out by an older app, so optional. */
const oldNumber = text(100, 'The old number')
const patDue = day.nullable()

export const stockCommandSchemas = {
  'model.create': model.refine(...caseIsNumbered).refine(...rackIsCase).refine(...rackIsOurs).refine(...rackIsNotMounted).refine(...partIsMounted),
  /** Only the fields the person changed, as for jobs. */
  'model.update': z
    .object({
      id,
      name: model.shape.name.optional(),
      department: model.shape.department.optional(),
      category: model.shape.category.optional(),
      tracking: model.shape.tracking.optional(),
      isCase: model.shape.isCase.optional(),
      valueCents: model.shape.valueCents.optional(),
      notes: model.shape.notes.optional(),
      patMonths: months.optional(),
      liftingMonths: months.optional(),
      aliases: model.shape.aliases.removeDefault().optional(),
      listId: model.shape.listId,
      isRack: z.boolean().optional(),
      code: stockCode.optional(),
      units: model.shape.units.removeDefault().optional(),
      depthMm: model.shape.depthMm.removeDefault().optional(),
      weightKg: model.shape.weightKg.removeDefault().optional(),
      powerW: model.shape.powerW.removeDefault().optional(),
      dryHire: z.boolean().optional(),
      supplier: model.shape.supplier.removeDefault().optional(),
      hireDayCents: model.shape.hireDayCents.removeDefault().optional(),
      rackMount: z.boolean().optional(),
      rackWidth: model.shape.rackWidth.removeDefault().optional(),
      caseWidthMm: model.shape.caseWidthMm.removeDefault().optional(),
      caseHeightMm: model.shape.caseHeightMm.removeDefault().optional(),
      caseDepthMm: model.shape.caseDepthMm.removeDefault().optional(),
      castors: z.boolean().optional(),
      powerLimitA: model.shape.powerLimitA.removeDefault().optional(),
      rackPart: model.shape.rackPart.removeDefault().optional(),
    })
    .refine(...somethingToChange)
    .refine(...caseIsNumbered)
    .refine(...rackIsCase)
    .refine(...rackIsOurs)
    .refine(...rackIsNotMounted)
    .refine(...partIsMounted),
  /** Refused while it has items, retired ones included, or counted stock. */
  'model.remove': z.object({ id }),
  /**
   * Added by mistake: the product and its items are hidden everywhere but
   * the history, its items retired as `mistake` and its counts taken away.
   * Refused while any of it is out on a job, on a job's kit, or in a case
   * that still holds kit.
   */
  'model.mistake': z.object({ id }),
  'place.upsert': place,
  /** Refused while anything is at it. */
  'place.remove': z.object({ id }),
  'asset.add': z
    .object({
      id,
      modelId: id,
      number: typedNumber,
      serial: text(100, 'The serial'),
      ...where,
      notes: text(2000, 'The notes'),
      /** One of those counted where it's going, not labelled until now: take one off the count. */
      fromCount: z.boolean(),
      oldNumber: oldNumber.default(''),
      patDue: patDue.default(null),
    })
    .refine(...oneOrNone),
  /** Field by field. A new product must be numbered, and a case if this holds anything. */
  'asset.update': z
    .object({
      id,
      modelId: id.optional(),
      serial: text(100, 'The serial').optional(),
      notes: text(2000, 'The notes').optional(),
      oldNumber: oldNumber.optional(),
      patDue: patDue.optional(),
    })
    .refine(...somethingToChange),
  /** Where it lives. A case takes everything in it along. */
  'asset.move': z.object({ id, ...where }).refine(...oneOrNone),
  /** A new label: the old number becomes a former one, never used again. */
  'asset.relabel': z.object({ id, number: typedNumber }),
  /** Kept, with its number, but no longer stock. A case is emptied first. */
  'asset.retire': z.object({ id, reason: z.enum(RETIRED_REASONS), note: text(500, 'The note') }),
  /** A retired item back in stock, such as a lost one that turned up. */
  'asset.reinstate': z.object({ id }),
  /** How many are there now, after counting. None takes the count away. */
  'stock.set': z.object({ modelId: id, ...where, qty: whole(0, MAX_QTY, 'How many') }).refine(...exactlyOne),
  /** Some of a count moved elsewhere; refused if fewer are there. */
  'stock.move': z
    .object({
      modelId: id,
      fromPlaceId: id.nullable(),
      fromCaseId: id.nullable(),
      toPlaceId: id.nullable(),
      toCaseId: id.nullable(),
      qty: whole(1, MAX_QTY, 'How many'),
    })
    .refine((m) => !!m.fromPlaceId !== !!m.fromCaseId && !!m.toPlaceId !== !!m.toCaseId, { message: 'Say where from and where to.' })
    .refine((m) => (m.fromPlaceId ?? m.fromCaseId) !== (m.toPlaceId ?? m.toCaseId), { message: "That's where they are already." }),
} as const

// Made once: making one for every value was most of what checking a long stock list again cost (ADR 0026).
const WHOLE_EUROS = new Intl.NumberFormat('en-IE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const EUROS_AND_CENTS = new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "€1,250", or "€12.50". */
export function valueLabel(c: number): string {
  return `€${(c % 100 === 0 ? WHOLE_EUROS : EUROS_AND_CENTS).format(c / 100)}`
}

/** "1 item", "12 items". */
export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n.toLocaleString('en-IE')} ${n === 1 ? one : many}`
}

/**
 * Why a product can't be marked as added by mistake while some of it is
 * out with a job, in the same words on the phone and from the server:
 * "d&b Y10P is out with Nissan launch (SH-000001 and 5 counted). Scan it
 * back first."
 */
export function stillOutReason(product: string, out: readonly { what: string; job: string }[]): string {
  const jobs = [...new Set(out.map((o) => o.job))].sort((a, b) => a.localeCompare(b))
  const whats = out.length > 3 ? [...out.slice(0, 2).map((o) => o.what), `${out.length - 2} more`] : out.map((o) => o.what)
  const listed = whats.length < 2 ? whats[0] : `${whats.slice(0, -1).join(', ')} and ${whats.at(-1)}`
  const where = jobs.length === 1 ? `${jobs[0]} (${listed})` : `${jobs.length} jobs (${jobs.slice(0, 3).join(', ')}${jobs.length > 3 ? '…' : ''})`
  return `${product} is out with ${where}. Scan it back first.`
}
