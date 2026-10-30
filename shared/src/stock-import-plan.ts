import { plural, type Department, type RetiredReason, type Tracking } from './stock.ts'
import type { WarehouseView } from './sync/stock-view.ts'
import type { StockField, StockListRow } from './stock-import-file.ts'

/**
 * The stock list's preview and plan (ADR 0026): what's here already to match
 * against, and what bringing the list in would do.
 */

// What's here already.

export interface KnownProduct {
  id: string
  name: string
  tracking: Tracking
  isCase: boolean
  valueCents: number | null
  patMonths: number | null
  notes: string
  mistake: boolean
  /** Its day price on the price list (ADR 0042); null for none, undefined where this device isn't sent prices. */
  dayCents?: number | null
  /** Its id in the list it was brought in from, such as Current RMS's; empty or left out for none. */
  listId?: string
  /** For saying a new product looks like one here renamed; left out where it isn't known. */
  category?: string
}
export interface KnownItem {
  id: string
  modelId: string
  number: string
  formerNumbers: string[]
  oldNumber: string
  serial: string
  placeId: string | null
  caseId: string | null
  status: 'active' | 'retired'
  retiredReason: RetiredReason | null
  patDue: string | null
  notes: string
}
/** The catalogue as the server holds it, or as a device does: what the rows are matched against. */
export interface KnownStock {
  products: KnownProduct[]
  items: KnownItem[]
  places: { id: string; name: string }[]
  counts: { modelId: string; placeId: string | null; caseId: string | null; qty: number }[]
}

/** What a device holds, as the rows are checked again while the office fixes them, with its day prices where it's sent them. */
export function knownStockOf(w: WarehouseView, priceOf?: (modelId: string) => number | undefined): KnownStock {
  return {
    products: [...w.models, ...w.mistakes.values()].map((m) => ({
      id: m.id,
      name: m.name,
      tracking: m.tracking,
      isCase: m.isCase,
      valueCents: m.valueCents,
      patMonths: m.patMonths,
      notes: m.notes,
      mistake: m.mistake,
      dayCents: priceOf ? (priceOf(m.id) ?? null) : undefined,
      listId: m.listId ?? '',
      category: m.category,
    })),
    items: [...w.assets.values()].map((a) => ({
      id: a.id,
      modelId: a.modelId,
      number: a.number,
      formerNumbers: a.formerNumbers,
      oldNumber: a.oldNumber,
      serial: a.serial,
      placeId: a.placeId,
      caseId: a.caseId,
      status: a.status,
      retiredReason: a.retiredReason,
      patDue: a.patDue,
      notes: a.notes,
    })),
    places: w.places.map((p) => ({ id: p.id, name: p.name })),
    counts: w.models.flatMap((m) => m.counted.map((s) => ({ modelId: s.modelId, placeId: s.placeId, caseId: s.caseId, qty: s.qty }))),
  }
}

// The preview and the plan.

export interface StockListOptions {
  /** Make the places and cases the list names that aren't here yet. */
  make: boolean
  /** Where kit is kept when its row says neither a place nor a case; empty for nowhere. */
  defaultPlace: string
  /** Everything goes to that one place, whatever the list's place column says (ADR 0061); kit in a case stays in it. Left out by an older app. */
  allAt?: boolean
}

export interface StockProblem {
  /** The field it's about, whose cell is fixed in place; null for the row as a whole. */
  field: StockField | null
  text: string
  /** Ticking “Make the places and cases this list names” solves it, so it needn't open the field. */
  tick?: true
}

export interface StockListPreviewRow extends StockListRow {
  skip: boolean
  /** The product's name as it will be. */
  product: string
  /** "4 items · Audio · Speakers · €1,250 · PAT due 30 Sep 2027". */
  facts: string
  /** "At Bay A1", "In Amp rack 1 (new case)"; empty when it doesn't say. */
  where: string
  /** What bringing it in does, in words, or "Already as the list says." */
  does: string[]
  /** Said, but not a problem: a PAT due day on counted stock, say. */
  asides: string[]
  problems: StockProblem[]
  /** Bringing it in changes something. */
  changes: boolean
  /** It changes something already here, rather than only adding. */
  updates: boolean
}

export interface StockListCounts {
  rows: number
  /** New products, and new items, the rows not skipped would add. */
  products: number
  items: number
  /** Counts set to something new. */
  counted: number
  /** Rows changing something already here. */
  updates: number
  /** Rows not skipped that would change nothing. */
  unchanged: number
  skipped: number
  /** Rows not skipped that still have a problem. */
  problems: number
}

export interface StockListPreview {
  rows: StockListPreviewRow[]
  counts: StockListCounts
  /** Places and cases the list names that aren't here yet, made only if the office ticks to. */
  places: string[]
  cases: string[]
}

/** What the server's preview answers with: the rows as read, and the columns no field is read from, by their headers. */
export interface StockListReading extends StockListPreview {
  notRead: string[]
}


/** What one call bringing the rows in did. */
export interface StockListResult {
  /** Rows brought in, and skipped. */
  rows: number
  skipped: number
  products: number
  items: number
  /** Counts set. */
  counted: number
  places: number
  /** Items already here that were moved or changed. */
  changed: number
  /**
   * What's left when a long list didn't all go in within one call: how
   * many changes, and what each row now does, for the rows to be sent
   * again with, so the next call carries on.
   */
  left?: { changes: number; rows: { row: number; does: string[] }[] }
}

/** A record already here, by its id, or one the import makes, by its key. */
export type StockRef = { id: string; key?: undefined } | { key: string; id?: undefined }
export interface PlannedWhere {
  place: StockRef | null
  case: StockRef | null
}
export interface PlannedProduct {
  key: string
  /** The first row that names it, for a refusal to name. */
  row: number
  name: string
  department: Department
  category: string
  tracking: Tracking
  isCase: boolean
  valueCents: number | null
  patMonths: number | null
  notes: string
  /** Its id in the list, for the next bring-in to match it by. */
  listId?: string
}
export interface PlannedProductChange {
  id: string
  /** Its name here now, for a refusal to name. */
  name: string
  row: number
  /** Renamed in the list, as its id there says. */
  rename?: string
  listId?: string
  tracking?: 'serialised'
  isCase?: true
  valueCents?: number
  patMonths?: number
  notes?: string
}
export interface PlannedItem {
  key: string
  row: number
  model: StockRef
  /** A Session Hire number kept from the list; null for the next free one. */
  number: string | null
  oldNumber: string
  serial: string
  patDue: string | null
  notes: string
  where: PlannedWhere
  /** One of those counted there, labelled now: the count goes down by one. */
  fromCount: boolean
  isCase: boolean
}
export interface PlannedChange {
  row: number
  id: string
  where?: PlannedWhere
  serial?: string
  oldNumber?: string
  patDue?: string
  notes?: string
}
/** A day price for the price list (ADR 0042), for a new product or one with none. */
export interface PlannedPrice {
  row: number
  model: StockRef
  dayCents: number
}
export interface PlannedCount {
  row: number
  model: StockRef
  where: PlannedWhere
  qty: number
}
/** What bringing the rows in does, for the server to turn into commands. */
export interface StockPlan {
  places: { key: string; name: string; row: number }[]
  products: PlannedProduct[]
  productChanges: PlannedProductChange[]
  items: PlannedItem[]
  changes: PlannedChange[]
  counts: PlannedCount[]
  prices: PlannedPrice[]
}

/** "Bring in 212 rows", or why not yet. */
export function bringInStockLabel(counts: StockListCounts): string {
  const n = counts.rows - counts.skipped
  if (n === 0) return 'Nothing to bring in'
  if (counts.unchanged === n) return 'Nothing to bring in: it’s all here'
  return `Bring in ${plural(n, 'row')}`
}

/** "10 rows read: 9 new products, 12 new items, 4 counts, 1 with a problem." */
export function stockListSaid(c: StockListCounts): string {
  const parts = [
    c.products > 0 && plural(c.products, 'new product'),
    c.items > 0 && plural(c.items, 'new item'),
    c.counted > 0 && plural(c.counted, 'count'),
    c.updates > 0 && `${c.updates} updating something`,
    c.unchanged > 0 && `${c.unchanged} already as the list says`,
    c.skipped > 0 && `${c.skipped} skipped`,
    c.problems > 0 && `${c.problems} with ${c.problems === 1 ? 'a problem' : 'problems'}`,
  ].filter(Boolean)
  return `${plural(c.rows, 'row')} read${parts.length ? `: ${parts.join(', ')}` : ''}.`
}
