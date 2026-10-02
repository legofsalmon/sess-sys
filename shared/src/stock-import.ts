import { BAD_LETTERS_HINT } from './crew-import.ts'
import { blankRecord, parseCsv } from './csv.ts'
import { isDay } from './day.ts'
import { INSPECTION_MONTHS } from './inspections.ts'
import { parseEuro } from './money.ts'
import {
  DEPARTMENT_LABELS,
  inShForm,
  MAX_QTY,
  normaliseNumber,
  plural,
  RETIRED_LABELS,
  valueLabel,
  type Department,
  type RetiredReason,
  type Tracking,
} from './stock.ts'
import type { WarehouseView } from './sync/stock-view.ts'

/**
 * Bringing in the stock list (ADR 0026): a spreadsheet nobody here has seen,
 * read into products, numbered items and counted stock for the office to
 * check before any of it is saved. Columns are found by their headers, with
 * many names for each, and a column the app doesn't know is the office's to
 * say, never guessed at. What a row says that the app isn't sure of is a
 * problem, fixed in place or skipped. The same reading and the same plan run
 * on the server for the preview, on the device as the office fixes a row,
 * and on the server again as the rows go in, so a second import of the same
 * file finds everything as the list says and changes nothing.
 */

// The columns.

export const STOCK_FIELDS = ['product', 'make', 'model', 'department', 'category', 'quantity', 'serial', 'number', 'place', 'case', 'value', 'patDue', 'notes'] as const
export type StockField = (typeof STOCK_FIELDS)[number]

export const STOCK_FIELD_LABELS: Record<StockField, string> = {
  product: 'Product',
  make: 'Make',
  model: 'Model',
  department: 'Department',
  category: 'Category',
  quantity: 'How many',
  serial: "Maker's serial",
  number: 'Asset number',
  place: "Where it's kept",
  case: 'Case',
  value: 'Value of one',
  patDue: 'PAT due',
  notes: 'Notes',
}

/** What each field is headed in a file, as `tidyHeader` leaves it; the first column found for a field is read. */
const HEADERS: Record<StockField, readonly string[]> = {
  product: ['product', 'product name', 'item', 'item name', 'description', 'name', 'equipment'],
  make: ['make', 'manufacturer', 'brand'],
  model: ['model', 'model no', 'model number'],
  department: ['department', 'dept'],
  category: ['category', 'type', 'group', 'sub category', 'subcategory'],
  // Not "No.", which is as often a line's number or an asset number as a quantity, so it's asked about.
  quantity: ['quantity', 'qty', 'count', 'how many', 'units'],
  serial: ['serial', 'serial number', 'serial no', 's/n', 'sn', 'serials', 'serial numbers'],
  number: ['asset number', 'asset', 'asset no', 'asset tag', 'tag', 'tag number', 'sh number', 'barcode', 'label', 'asset numbers', 'tags'],
  place: ['location', 'place', 'shelf', 'bay', 'store', 'storage', 'where'],
  case: ['case', 'flight case', 'container', 'road case', 'in case'],
  value: ['value', 'replacement value', 'cost', 'price', 'unit price', 'replacement cost', 'unit value'],
  patDue: ['pat due', 'pat due date', 'next test', 'next test due', 'next pat', 'next pat due', 'inspection due'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks'],
}

/** A header as it's compared: capitals, anything in brackets ("Value (€)"), and marks other than letters, digits, "/" and "&" left out. */
export const tidyHeader = (h: string) =>
  h
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9/&]+/g, ' ')
    .trim()

/** Which field each column is read as, by its header; null for one the app doesn't know. */
export function columnsFor(header: readonly string[]): (StockField | null)[] {
  const tidy = header.map(tidyHeader)
  const columns: (StockField | null)[] = header.map(() => null)
  for (const field of STOCK_FIELDS) {
    for (const name of HEADERS[field]) {
      const i = tidy.findIndex((t, j) => t === name && columns[j] === null)
      if (i >= 0) {
        columns[i] = field
        break
      }
    }
  }
  return columns
}

/** A stock list as read, before anyone has said which column is which. */
export interface StockFile {
  /** The header row as the file has it. */
  header: string[]
  /** The header's row in the spreadsheet, counting from 1. */
  headerRow: number
  /** Which field each column is read as, by its header; null for one the app doesn't know. */
  columns: (StockField | null)[]
  /** Each column's first few values, for saying which column is which. */
  samples: string[][]
  /** The rows under the header, with their row in the spreadsheet; blank ones left out. */
  records: { row: number; cells: string[] }[]
}

/** How far down a title may push the header. */
const HEADER_WITHIN = 10

/** The row, of the first ten, with the most headers the app knows, and how many; -1 for none. */
function headerOf(lines: string[][]): { at: number; known: number } {
  let at = -1
  let best = 0
  lines.slice(0, HEADER_WITHIN).forEach((line, i) => {
    const known = columnsFor(line).filter(Boolean).length
    if (known > best) [best, at] = [known, i]
  })
  return { at, known: best }
}

/**
 * The file as a header and rows, or why it can't be read at all. The
 * header is the row, of the first ten, with the most headers the app
 * knows, so a title above it is passed over. Fields are split by commas,
 * or by semicolons where that finds more of the headers, or more columns
 * when it knows none of them: Excel saves CSV that way where a comma is
 * the decimal mark.
 */
export function readStockFile(text: string): { file: StockFile; problem?: undefined } | { file?: undefined; problem: string } {
  // A sheet saved as plain CSV on Windows isn't UTF-8, and its accented letters arrive as the replacement mark.
  if (text.includes('�')) return { problem: BAD_LETTERS_HINT }
  const commas = parseCsv(text)
  const semicolons = parseCsv(text, ';')
  const [byComma, bySemicolon] = [headerOf(commas), headerOf(semicolons)]
  const widthOf = (lines: string[][]) => lines.find((line) => !blankRecord(line))?.length ?? 0
  const semi = bySemicolon.known > byComma.known || (bySemicolon.known === byComma.known && widthOf(semicolons) > widthOf(commas))
  const lines = semi ? semicolons : commas
  let at = (semi ? bySemicolon : byComma).at
  if (at < 0) at = lines.findIndex((line) => !blankRecord(line))
  if (at < 0) return { problem: 'The file is empty.' }
  const header = lines[at]!.map((h) => h.trim())
  // A record's index is its row in the spreadsheet, less one.
  const records = lines
    .slice(at + 1)
    .map((cells, i) => ({ row: at + i + 2, cells }))
    .filter((r) => !blankRecord(r.cells))
  if (records.length === 0) return { problem: 'The file has column names but no rows under them.' }
  const width = Math.max(header.length, ...records.map((r) => r.cells.length))
  const full = [...header, ...Array<string>(width - header.length).fill('')]
  const samples = full.map((_, c) =>
    records
      .map((r) => (r.cells[c] ?? '').trim())
      .filter(Boolean)
      .slice(0, 3)
  )
  return { file: { header: full, headerRow: at + 1, columns: columnsFor(full), samples, records } }
}

/** Columns with something in them that no field is read from: the ones to ask about, or to list as not read. */
export function unreadColumns(file: StockFile, columns: readonly (StockField | null)[] = file.columns): number[] {
  return file.header.map((_, i) => i).filter((i) => columns[i] == null && (file.header[i]!.trim() !== '' || file.samples[i]!.length > 0))
}

/** Whether to ask which column is which before the preview: a column the app doesn't know, or none for the product. */
export function needsColumnStep(file: StockFile): boolean {
  return unreadColumns(file).length > 0 || !(file.columns.includes('product') || file.columns.includes('model'))
}

/** "Column C", as a spreadsheet names it, for a column with no header. */
export function columnLetter(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** A row as the file has it: what's in each field, trimmed. What the office fixes in place. */
export interface StockListRow {
  /** Its row in the spreadsheet, so the office can find it there. */
  row: number
  cells: Partial<Record<StockField, string>>
}

/** The rows, read with the columns as the office said; the first column for a field wins. */
export function stockRows(file: StockFile, columns: readonly (StockField | null)[] = file.columns): StockListRow[] {
  const first = new Map<StockField, number>()
  columns.forEach((f, i) => {
    if (f && !first.has(f)) first.set(f, i)
  })
  return file.records.map((r) => {
    const cells: Partial<Record<StockField, string>> = {}
    for (const [f, i] of first) {
      const v = (r.cells[i] ?? '').trim()
      if (v) cells[f] = v
    }
    return { row: r.row, cells }
  })
}

// Reading a cell.

/** "12", "x12", "12 pcs", "1,200": a whole number of things; null for nothing said. */
export function readQuantity(cell: string): { qty: number | null; problem?: string } {
  const t = cell
    .trim()
    .toLowerCase()
    .replace(/^x\s*/, '')
    .replace(/\s*(x|pcs|pieces|units|off)\.?$/, '')
  if (!t) return { qty: null }
  const digits = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replaceAll(',', '') : t
  if (/^\d+$/.test(digits) && Number(digits) <= MAX_QTY) return { qty: Number(digits) }
  return { qty: null, problem: `Couldn't read the quantity "${cell.trim()}". Put in a whole number, like 12.` }
}

export const DATE_HINT = 'Put it as day, month and year, like 30/09/2027.'
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Sep", "sept.", "September": the month's number; undefined for anything else. */
const monthOf = (word: string) => {
  const w = word.toLowerCase().replace(/\.$/, '')
  const i = w.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(w)) : -1
  return i < 0 ? undefined : i + 1
}
const pad = (n: number) => String(n).padStart(2, '0')
/** A two-digit year is this century: a PAT due in "27" is due in 2027. */
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y))

/** "30 Sep 2027", the day as the preview and the log write it, with its year. */
export function fullDayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return `${d} ${SHORT_MONTHS[m - 1]} ${y}`
}

/** A day written in numbers alone, "30/09/2027" or "3.4.27", with any time Excel adds; its two first parts as written. */
const inNumbers = (t: string) => {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(t)
  return m ? { first: Number(m[1]), second: Number(m[2]), year: fullYear(m[3]!) } : undefined
}
/** "09/30/2027": the month first, as only a sheet written the American way has it. */
const writtenMonthFirst = (cell: string) => {
  const n = inNumbers(cell.trim())
  return !!n && n.second > 12 && n.first <= 12
}
/** "03/04/2027": 3 April the Irish way, 4 March the American way. */
const readsEitherWay = (cell: string) => {
  const n = inNumbers(cell.trim())
  return !!n && n.first <= 12 && n.second <= 12 && n.first !== n.second
}

/**
 * A day the Irish way, day first: "30/09/2027", "30.9.27", "30-Sep-27",
 * "30 September 2027", or "2027-09-30". Anything that could be read two
 * ways is a problem, never a guess: a month over 12 (written month first),
 * a spreadsheet's date number, a month with no day, or a day that doesn't
 * exist. A list with one date written month first may write them all that
 * way, which the preview checks across the rows.
 */
export function readStockDay(cell: string): { day: string | null; problem?: string } {
  const t = cell.trim()
  if (!t) return { day: null }
  const notRead = { day: null, problem: `Couldn't read "${t}" as a date. ${DATE_HINT}` }
  const real = (y: number, m: number, d: number) => {
    const s = `${y}-${pad(m)}-${pad(d)}`
    return isDay(s) ? { day: s } : notRead
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ][\d:.]+Z?)?$/.exec(t)
  if (m) return real(Number(m[1]), Number(m[2]), Number(m[3]))
  const n = inNumbers(t)
  if (n) {
    if (writtenMonthFirst(t)) return { day: null, problem: `"${t}" looks like the month first. ${DATE_HINT}` }
    return real(n.year, n.second, n.first)
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]+)\.?,?[\s-]+(\d{4}|\d{2})$/i.exec(t)
  if (m && monthOf(m[2]!)) return real(fullYear(m[3]!), monthOf(m[2]!)!, Number(m[1]))
  m = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(t)
  if (m && monthOf(m[1]!)) return real(Number(m[3]), monthOf(m[1]!)!, Number(m[2]))
  if (/^\d{5}(\.\d+)?$/.test(t)) return { day: null, problem: `"${t}" is a spreadsheet's number for a date, not the date. Format the column as dates and save the file again.` }
  if (/^([a-z]+\.?[\s-]+\d{2,4}|\d{1,2}[/.-]\d{4}|\d{4}[/.-]\d{1,2})$/i.test(t)) return { day: null, problem: `"${t}" has no day. ${DATE_HINT}` }
  return notRead
}

/** What a department cell can say, beyond the app's own names. */
const DEPARTMENT_WORDS: Record<string, Department> = {
  audio: 'audio',
  sound: 'audio',
  lighting: 'lighting',
  lights: 'lighting',
  lx: 'lighting',
  video: 'video',
  vision: 'video',
  staging: 'staging',
  stage: 'staging',
  rigging: 'rigging',
  power: 'power',
  electrical: 'power',
  distro: 'power',
  other: 'other',
  misc: 'other',
  miscellaneous: 'other',
  general: 'other',
}
export const departmentNamed = (text: string): Department | undefined => DEPARTMENT_WORDS[text.trim().toLowerCase()]

/** Cells that mean no number at all. */
const NO_NUMBER = new Set(['-', '–', 'n/a', 'na', 'none', 'tbc', '?'])
/** Several numbers in a cell, split by commas, semicolons or line breaks. */
export function splitNumbers(cell: string): string[] {
  return cell
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter((x) => x && !NO_NUMBER.has(x.toLowerCase()))
}
/** "SH-000001 to SH-000010": a range, which isn't read, so the office writes the numbers out. */
const RANGE = /^sh[\s-]*\d{1,6}\s*(?:-|–|to)\s*(?:sh[\s-]*)?\d{1,6}$/i
/** "#N/A", "#REF!": what a spreadsheet shows where a formula went wrong, never what the cell meant. */
const SHEET_ERROR = /^#(n\/a|ref!|value!|name\?|div\/0!|null!|num!|spill!|calc!)$/i
/** "Total", "Grand total", "Subtotal:": a sum at the foot of a list, not kit. */
const TOTALS = /^(grand |sub ?)?totals?:?$|^sum:?$/i

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
/** Whether `text` has `part` in it, capitals and spacing aside. */
const holds = (text: string, part: string) => norm(text).includes(norm(part))

/** The product's name: the model with the make in front, or the product column with the make in front; a product column beside a model is its description. */
export function productNameOf(cells: StockListRow['cells']): { name: string; description: string } {
  const product = cells.product?.trim() ?? ''
  const make = cells.make?.trim() ?? ''
  const model = cells.model?.trim() ?? ''
  const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()
  if (model) {
    const name = tidy(make && !holds(model, make) ? `${make} ${model}` : model)
    return { name, description: product && !holds(name, product) ? product : '' }
  }
  if (!product) return { name: '', description: '' }
  return { name: tidy(make && !holds(product, make) ? `${make} ${product}` : product), description: '' }
}

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

/** What a device holds, as the rows are checked again while the office fixes them. */
export function knownStockOf(w: WarehouseView): KnownStock {
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

/** A row as the office sends it back: fixed where it needed fixing, or skipped, with what the preview said it does, so the server can tell when that has changed. */
export interface StockListChoice extends StockListRow {
  skip: boolean
  does: string[]
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
}
export interface PlannedProductChange {
  id: string
  name: string
  row: number
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

export const UNCHANGED = 'Already as the list says.'
/** The PAT is every year unless the office says otherwise on the product's page. */
const LIST_PAT_MONTHS = INSPECTION_MONTHS.pat
/** ADR 0013's line between numbered and counted: anything worth more than about €150. */
const NUMBERED_FROM_CENTS = 150_00
const MOST_CENTS = 1_000_000_00

const inWords = (parts: string[]) => (parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`)
const refKey = (r: StockRef | null) => (r ? (r.id ?? `new ${r.key}`) : '')
const whereKey = (w: PlannedWhere) => (w.case ? `c:${refKey(w.case)}` : w.place ? `p:${refKey(w.place)}` : '')
/** The text added to notes once, as the crew list adds to them, cut to what they hold. */
export function withNotes(was: string, added: string, room = 2000): string {
  const kept = was.trim()
  const text = added.trim().slice(0, Math.max(0, room - kept.length - (kept ? 1 : 0)))
  if (!text || kept.includes(text)) return was
  return [kept, text].filter(Boolean).join('\n')
}

/** A row as read on its own, before it's matched to anything. */
interface Read {
  input: StockListRow & { skip?: boolean }
  live: boolean
  name: string
  description: string
  department: Department | undefined
  category: string
  qty: number | null
  tags: string[]
  serials: string[]
  numbered: boolean
  valueCents: number | null
  patDue: string | null
  notes: string
  placeCell: string
  caseCell: string
  /** Its PAT due day is written month first, or could be read either way. */
  monthFirst: boolean
  eitherWay: boolean
  problems: StockProblem[]
  asides: string[]
}

function readRow(input: StockListRow & { skip?: boolean }, options: StockListOptions): Read {
  const c = input.cells
  const problems: StockProblem[] = []
  const { name, description } = productNameOf(c)
  if (!name) problems.push({ field: 'product', text: 'No product: the row needs a product name, or a make and a model.' })
  else if (name.length > 200) problems.push({ field: 'product', text: "The product's name can be up to 200 characters." })
  else if (TOTALS.test(name)) problems.push({ field: null, text: `"${name}" looks like a row of totals, not kit. Skip it.` })
  for (const f of STOCK_FIELDS) {
    const cell = c[f]?.trim() ?? ''
    if (SHEET_ERROR.test(cell)) problems.push({ field: f, text: `"${cell}" is the spreadsheet's error where a formula went wrong. Put in what it should say, or skip the row.` })
  }
  const deptCell = c.department ?? ''
  const catCell = c.category ?? ''
  const department = departmentNamed(deptCell) ?? departmentNamed(catCell)
  if (!department && deptCell)
    problems.push({ field: 'department', text: `Couldn't tell which department "${deptCell}" is: Audio, Lighting, Video, Staging, Rigging, Power or Other.` })
  const qty = readQuantity(c.quantity ?? '')
  if (qty.problem) problems.push({ field: 'quantity', text: qty.problem })
  const tags = splitNumbers(c.number ?? '')
  const serials = splitNumbers(c.serial ?? '')
  for (const t of tags) {
    if (RANGE.test(t)) problems.push({ field: 'number', text: `"${t}" is a range. Write each number out, separated by commas.` })
    else if (t.length > 100) problems.push({ field: 'number', text: 'An asset number can be up to 100 characters.' })
  }
  if (serials.some((s) => s.length > 100)) problems.push({ field: 'serial', text: 'A serial can be up to 100 characters.' })
  const numbered = tags.length > 0 || serials.length > 0
  const n = Math.max(tags.length, serials.length)
  if (tags.length && serials.length && tags.length !== serials.length)
    problems.push({ field: 'serial', text: `${plural(tags.length, 'asset number')} but ${plural(serials.length, 'serial')}: one of each for every item, in the same order.` })
  if (numbered && qty.qty !== null && qty.qty !== n)
    problems.push({ field: 'quantity', text: `The quantity is ${qty.qty}, but there ${n === 1 ? 'is 1 number' : `are ${n} numbers`}: one for each item, or fix the quantity.` })
  if (!numbered && qty.qty === null && !qty.problem) problems.push({ field: 'quantity', text: 'No quantity and no numbers: say how many there are.' })
  const value = parseEuro(c.value ?? '')
  if (value.reason !== undefined) problems.push({ field: 'value', text: `Couldn't read the value "${c.value}". ${value.reason}` })
  else if (value.cents !== null && value.cents > MOST_CENTS) problems.push({ field: 'value', text: 'A value can be up to €1,000,000.' })
  const due = readStockDay(c.patDue ?? '')
  if (due.problem) problems.push({ field: 'patDue', text: due.problem })
  const caseCell = c.case ?? ''
  return {
    input,
    live: !input.skip,
    name,
    description,
    department,
    category: departmentNamed(catCell) ? '' : catCell.slice(0, 100),
    qty: qty.qty,
    tags,
    serials,
    numbered,
    valueCents: value.reason === undefined ? value.cents : null,
    patDue: due.day ?? null,
    notes: (c.notes ?? '').slice(0, 2000),
    // Kit the row doesn't place goes where the office said, if it said.
    placeCell: c.place ?? (caseCell ? '' : options.defaultPlace.trim()),
    caseCell,
    monthFirst: writtenMonthFirst(c.patDue ?? ''),
    eitherWay: readsEitherWay(c.patDue ?? ''),
    problems,
    asides: [],
  }
}

/** One item a row names: one already here, or a new one with its key. */
type ItemOf =
  | { known: KnownItem; tag: string; serial: string; sh: string | undefined }
  | { known?: undefined; key: string; number: string | null; oldNumber: string; serial: string }

interface Group {
  key: string
  name: string
  known: KnownProduct | undefined
  rows: Read[]
  isCase: boolean
  department: Department
  category: string
  valueCents: number | null
  /** New items of it the list adds, in row order, and its items here in stock. */
  added: string[]
}

/**
 * Every row checked and matched against what's here, with what bringing it
 * in would do, in words and as a plan. The device runs this again as the
 * office fixes or skips a row, with what it holds; the server runs it for
 * the preview and again as the rows go in.
 */
export function previewStockList(
  input: readonly (StockListRow & { skip?: boolean })[],
  known: KnownStock,
  options: StockListOptions
): StockListPreview & { plan: StockPlan } {
  // What's here, looked up the ways a row names it.
  const productByName = new Map<string, KnownProduct>()
  for (const p of known.products) if (!p.mistake && !productByName.has(norm(p.name))) productByName.set(norm(p.name), p)
  const productById = new Map(known.products.map((p) => [p.id, p]))
  const placeByName = new Map(known.places.map((p) => [norm(p.name), p]))
  const byNumber = new Map<string, KnownItem>()
  const byFormer = new Map<string, KnownItem>()
  const byOld = new Map<string, KnownItem>()
  const bySerial = new Map<string, KnownItem[]>()
  for (const i of known.items) {
    if (i.number) byNumber.set(i.number, i)
    for (const n of i.formerNumbers) byFormer.set(n, i)
    if (i.oldNumber) byOld.set(norm(i.oldNumber), i)
    if (i.serial) bySerial.set(norm(i.serial), [...(bySerial.get(norm(i.serial)) ?? []), i])
  }
  const countNow = new Map(known.counts.map((c) => [`${c.modelId}@${c.caseId ? `c:${c.caseId}` : `p:${c.placeId}`}`, c.qty]))
  const activeOf = (modelId: string) => known.items.filter((i) => i.modelId === modelId && i.status === 'active')
  const itemSaid = (i: KnownItem) => `${i.number || 'an item'} (${productById.get(i.modelId)?.name ?? 'another product'})`

  const rows = input.map((r) => readRow(r, options))
  const live = rows.filter((r) => r.live)
  // A list with one date written month first, skipped or not, may write them all that way: one that reads either way is then a guess.
  const monthFirst = rows.find((r) => r.monthFirst)
  if (monthFirst)
    for (const r of live)
      if (r.eitherWay)
        r.problems.push({
          field: 'patDue',
          text: `Row ${monthFirst.input.row} writes its date month first, so "${r.input.cells.patDue!.trim()}" could be either. Write the month as a word, like 30 Sep 2027.`,
        })

  // Products, by name, capitals and spacing aside.
  const groups = new Map<string, Group>()
  for (const r of live) {
    if (!r.name) continue
    const k = norm(r.name)
    let g = groups.get(k)
    if (!g) groups.set(k, (g = { key: k, name: r.name, known: productByName.get(k), rows: [], isCase: false, department: 'other', category: '', valueCents: null, added: [] }))
    g.rows.push(r)
  }
  for (const g of groups.values()) {
    let value: { cents: number; row: number } | undefined
    let department: { is: Department; row: number } | undefined
    for (const r of g.rows) {
      if (r.valueCents !== null) {
        if (!value) value = { cents: r.valueCents, row: r.input.row }
        else if (value.cents !== r.valueCents)
          r.problems.push({
            field: 'value',
            text: `Row ${value.row} gives ${g.name} a value of ${valueLabel(value.cents)}; this row says ${valueLabel(r.valueCents)}. Make them the same, or clear one.`,
          })
      }
      if (!g.known && r.department) {
        if (!department) department = { is: r.department, row: r.input.row }
        else if (department.is !== r.department)
          r.problems.push({
            field: 'department',
            text: `Row ${department.row} puts ${g.name} in ${DEPARTMENT_LABELS[department.is]}; this row says ${DEPARTMENT_LABELS[r.department]}. Make them the same.`,
          })
      }
      if (!g.category && r.category) g.category = r.category
    }
    g.valueCents = value?.cents ?? null
    g.department = department?.is ?? 'other'
  }
  const groupOf = (r: Read) => (r.name ? groups.get(norm(r.name)) : undefined)

  // Every number the list gives, so a second mention is marked and a case can be named by one.
  const fileSh = new Map<string, { row: Read; key: string }>()
  const fileOld = new Map<string, { row: Read; key: string }>()
  const fileSerial = new Map<string, number>()
  const fileItems = new Map<string, number>()

  // Which products hold other kit: those that do already, and those the Case column names.
  const named = (cell: string) => !inShForm(cell) && !byOld.has(norm(cell))
  const caseNames = new Set(live.filter((r) => r.caseCell && named(r.caseCell)).map((r) => norm(r.caseCell)))
  for (const g of groups.values()) g.isCase = !!g.known?.isCase || caseNames.has(g.key)

  // Each row's items: the ones already here it names, and the new ones.
  const itemsOf = new Map<Read, ItemOf[]>()
  for (const r of live) {
    const g = groupOf(r)
    const items: ItemOf[] = []
    if (r.numbered) {
      const n = Math.max(r.tags.length, r.serials.length)
      for (let i = 0; i < n; i++) {
        const tag = r.tags[i] ?? ''
        const serial = r.serials[i] ?? ''
        const sh = tag && inShForm(tag) ? normaliseNumber(tag) : undefined
        let hit: KnownItem | undefined
        if (sh) {
          hit = byNumber.get(sh)
          const before = !hit ? byFormer.get(sh) : undefined
          if (before)
            r.problems.push({ field: 'number', text: `${sh} was ${itemSaid(before)}'s number before, and a number is never used twice. Use the number it has now.` })
          const first = fileSh.get(sh)
          if (first && first.row !== r) r.problems.push({ field: 'number', text: `${sh} is on row ${first.row.input.row} too.` })
        } else if (tag) {
          hit = byOld.get(norm(tag))
          const first = fileOld.get(norm(tag))
          if (first && first.row !== r) r.problems.push({ field: 'number', text: `${tag} is on row ${first.row.input.row} too.` })
        }
        let bySer: KnownItem | undefined
        if (serial) {
          const same = (bySerial.get(norm(serial)) ?? []).filter((x) => x.modelId === g?.known?.id)
          if (same.length === 1) bySer = same[0]
          else if (same.length > 1 && !hit)
            r.problems.push({ field: 'serial', text: `${same.length} items of ${g!.name} have the serial ${serial}. Put their asset numbers in too.` })
          const k = `${g?.key}|${norm(serial)}`
          const first = fileSerial.get(k)
          if (first !== undefined && first !== r.input.row) r.problems.push({ field: 'serial', text: `The serial ${serial} is on row ${first} too.` })
          else fileSerial.set(k, r.input.row)
        }
        if (hit && bySer && hit.id !== bySer.id) r.problems.push({ field: 'serial', text: `${tag} is ${itemSaid(hit)}, but the serial ${serial} is on ${itemSaid(bySer)}.` })
        const item = hit ?? bySer
        // One item on two rows, however each names it, is one row too many.
        const before = item ? fileItems.get(item.id) : undefined
        if (item && before !== undefined && before !== r.input.row) r.problems.push({ field: hit ? 'number' : 'serial', text: `${itemSaid(item)} is on row ${before} too.` })
        else if (item) fileItems.set(item.id, r.input.row)
        if (item && item.modelId !== g?.known?.id)
          r.problems.push({ field: 'product', text: `${itemSaid(item)} is already here as ${productById.get(item.modelId)?.name ?? 'another product'}, not ${r.name || 'this'}. Fix the product, or skip the row.` })
        else if (item && item.status !== 'active')
          r.problems.push({
            field: null,
            text:
              item.retiredReason === 'mistake'
                ? `${itemSaid(item)} was added by mistake, so nothing more is done as it. Skip the row.`
                : `${itemSaid(item)} is retired (${item.retiredReason ? RETIRED_LABELS[item.retiredReason].toLowerCase() : 'retired'}). Bring it back first, or skip the row.`,
          })
        if (item) items.push({ known: item, tag, serial, sh })
        else {
          const key = `item:${r.input.row}:${i}`
          items.push({ key, number: sh ?? null, oldNumber: tag && !sh ? tag : '', serial })
          if (sh && !fileSh.has(sh)) fileSh.set(sh, { row: r, key })
          if (tag && !sh && !fileOld.has(norm(tag))) fileOld.set(norm(tag), { row: r, key })
          g?.added.push(key)
        }
      }
    }
    itemsOf.set(r, items)
  }
  // An item the list adds, named as a case by its number: its product holds other kit, so its counted rows make items too.
  for (const r of live) {
    const ref = !r.caseCell ? undefined : inShForm(r.caseCell) ? fileSh.get(normaliseNumber(r.caseCell)!) : fileOld.get(norm(r.caseCell))
    const g = ref && groupOf(ref.row)
    if (g) g.isCase = true
  }

  // Places, by name. One the list names that isn't here is made only if the office ticks to.
  const newPlaces = new Map<string, { name: string; row: number }>()
  const placeOf = (r: Read): StockRef | null => {
    if (!r.placeCell) return null
    const k = norm(r.placeCell)
    const p = placeByName.get(k)
    if (p) return { id: p.id }
    if (!newPlaces.has(k)) newPlaces.set(k, { name: r.placeCell.trim(), row: r.input.row })
    if (!options.make) r.problems.push({ field: 'place', text: `${r.placeCell.trim()} isn't a place here yet. Tick “Make the places and cases this list names”, or fix the place.`, tick: true })
    return { key: `place:${k}` }
  }
  // A row naming a case puts its kit in the case, which keeps its own place, so only rows with no case are placed here.
  const placeRefs = new Map(live.filter((r) => !r.caseCell).map((r) => [r, placeOf(r)]))

  // A case counted rather than numbered: it has a number of its own, so the list's count is of items, made up to that many
  // of the product altogether, never fewer. Worked out before cases are named, so "Amp rack 1, 1" can be named.
  const caseCountNew = new Map<Read, string[]>()
  const caseRowsOf = new Map<Group, Read[]>()
  for (const r of live) {
    const g = groupOf(r)
    if (g?.isCase && !r.numbered && r.qty !== null) caseRowsOf.set(g, [...(caseRowsOf.get(g) ?? []), r])
  }
  for (const [g, rs] of caseRowsOf) {
    let have = g.known ? activeOf(g.known.id).length : 0
    for (const r of rs) {
      const there = Math.min(have, r.qty!)
      have -= there
      const keys = Array.from({ length: r.qty! - there }, (_, i) => `item:${r.input.row}:${i}`)
      caseCountNew.set(r, keys)
      g.added.push(...keys)
    }
    if (have > 0) rs.at(-1)!.asides.push(`${plural(have, 'more')} of ${g.name} ${have === 1 ? 'is' : 'are'} here than the list counts. The list retires none: retire any that have gone on their pages.`)
  }

  // Cases: by number, by old number, or by the name of a product holding other kit with one item.
  const newCases = new Map<string, { name: string; product: string; known: KnownProduct | undefined; first: Read }>()
  const caseRefs = new Map<string, { ref: StockRef; said: string; made?: boolean } | { problem: string }>()
  const resolveCase = (r: Read): { ref: StockRef; said: string; made?: boolean } | { problem: string } => {
    const cell = r.caseCell.trim()
    const k = norm(cell)
    const byItem = (i: KnownItem) => {
      const p = productById.get(i.modelId)
      const g = p ? groups.get(norm(p.name)) : undefined
      if (!p?.isCase && !g?.isCase) return { problem: `${itemSaid(i)} doesn't hold other kit. Mark ${p?.name ?? 'its product'} as holding other kit on its page first.` }
      if (i.status !== 'active') return { problem: `${itemSaid(i)} is retired, so nothing can go in it.` }
      return { ref: { id: i.id }, said: itemSaid(i) }
    }
    // An item the list adds, named as a case by its number; its product holds other kit, as marked above.
    const byRow = (f: { row: Read; key: string }) => ({ ref: { key: f.key }, said: `${cell} (${f.row.name})` })
    if (inShForm(cell)) {
      const sh = normaliseNumber(cell)!
      const here = byNumber.get(sh)
      if (here) return byItem(here)
      const inList = fileSh.get(sh)
      if (inList) return byRow(inList)
      return { problem: `No item has the number ${sh}. Fix the case, or skip the row.` }
    }
    const old = byOld.get(k)
    if (old) return byItem(old)
    const oldInList = fileOld.get(k)
    if (oldInList) return byRow(oldInList)
    const g = groups.get(k)
    const p = g?.known ?? productByName.get(k)
    // A product here that the list doesn't make a case of isn't turned into one by being named as one.
    if (p && !p.isCase && !g?.isCase) return { problem: `${p.name} doesn't hold other kit. Mark it as holding other kit on its page first, or fix the case.` }
    const items = [...(p ? activeOf(p.id).map((i) => ({ ref: { id: i.id } as StockRef, said: itemSaid(i) })) : []), ...(g?.added ?? []).map((key) => ({ ref: { key } as StockRef, said: cell }))]
    if (items.length === 1) return items[0]!
    if (items.length > 1) return { problem: `There are ${items.length} × ${p?.name ?? g?.name ?? cell}. Put the case's number in the Case column, such as SH-000123.` }
    // Named by nothing here or in the list: a case to make, if the office ticks to.
    if (!newCases.has(k)) newCases.set(k, { name: cell, product: p?.name ?? cell, known: p, first: r })
    return { ref: { key: `case:${k}` }, said: cell, made: true }
  }
  for (const r of live) {
    if (!r.caseCell) continue
    const k = norm(r.caseCell)
    if (!caseRefs.has(k)) caseRefs.set(k, resolveCase(r))
  }
  // A case made from its name is kept where the first row naming it says, if it says.
  const newCasePlaces = new Map([...newCases].map(([k, c]) => [k, placeOf(c.first)]))

  // Where each row's kit goes: in its case, else at its place.
  const whereOf = new Map<Read, PlannedWhere>()
  const whereSaid = new Map<Read, string>()
  for (const r of live) {
    const place = placeRefs.get(r) ?? null
    let w: PlannedWhere = { place, case: null }
    let said = place ? `At ${r.placeCell.trim()}${place.key ? ' (new place)' : ''}` : ''
    if (r.caseCell) {
      const c = caseRefs.get(norm(r.caseCell))!
      if ('problem' in c) r.problems.push({ field: 'case', text: c.problem })
      else {
        w = { place: null, case: c.ref }
        said = `In ${c.said}${c.made ? ' (new case)' : ''}`
        if (c.made && !options.make)
          r.problems.push({ field: 'case', text: `${r.caseCell.trim()} isn't a case here yet. Tick “Make the places and cases this list names”, or fix the case.`, tick: true })
        const own = itemsOf.get(r)!.some((i) => (i.known ? i.known.id === c.ref.id : i.key === c.ref.key)) || (caseCountNew.get(r) ?? []).includes(c.ref.key ?? '')
        if (own) r.problems.push({ field: 'case', text: "A case can't go inside itself." })
      }
    }
    whereOf.set(r, w)
    whereSaid.set(r, said)
  }
  const atSaid = (r: Read) => {
    const s = whereSaid.get(r) ?? ''
    return s ? `${s[0]!.toLowerCase()}${s.slice(1)}` : ''
  }

  // The plan, and each row's words.
  const plan: StockPlan = { places: [...newPlaces].map(([k, p]) => ({ key: `place:${k}`, ...p })), products: [], productChanges: [], items: [], changes: [], counts: [] }
  const modelRef = (g: Group): StockRef => (g.known ? { id: g.known.id } : { key: `product:${g.key}` })
  // Counted rows by product and where, so two rows counting one thing in one place are marked, and labelling takes from a count only the list leaves alone.
  const countedRows = new Map<string, Read>()
  for (const r of live) {
    const g = groupOf(r)
    if (!g || r.numbered || r.qty === null || g.isCase) continue
    const k = `${refKey(modelRef(g))}@${whereKey(whereOf.get(r)!)}`
    const first = countedRows.get(k)
    if (first) r.problems.push({ field: null, text: `Row ${first.input.row} counts ${g.name} ${atSaid(first).replace(/ \(new (place|case)\)$/, '')} too. Add them up into one row, or skip one.` })
    else countedRows.set(k, r)
  }
  const takeable = new Map<string, number>()

  const said = new Map<Read, { does: string[]; updates: boolean }>()
  const doing = (r: Read) => {
    let s = said.get(r)
    if (!s) said.set(r, (s = { does: [], updates: false }))
    return s
  }
  for (const g of groups.values()) {
    const first = g.rows[0]!
    const makesItems = (r: Read) => r.numbered || g.isCase
    const patDays = g.rows.some((r) => makesItems(r) && r.patDue)
    const notes = [g.rows.find((r) => r.description)?.description ?? '', ...g.rows.filter((r) => !makesItems(r) && r.notes).map((r) => r.notes)]
      .filter((x, i, all) => x && all.indexOf(x) === i)
      .join('\n')
    if (!g.known) {
      const numbered = g.isCase || g.rows.some((r) => r.numbered || r.patDue) || (g.valueCents ?? 0) >= NUMBERED_FROM_CENTS
      const tracking: Tracking = numbered ? 'serialised' : 'bulk'
      const patMonths = patDays ? LIST_PAT_MONTHS : null
      plan.products.push({ key: `product:${g.key}`, row: first.input.row, name: g.name, department: g.department, category: g.category, tracking, isCase: g.isCase, valueCents: g.valueCents, patMonths, notes: notes.slice(0, 2000) })
      const how = !numbered ? 'counted' : g.isCase ? 'numbered, holds other kit' : g.rows.some(makesItems) ? 'numbered' : 'numbered, counted until labelled'
      doing(first).does.push(`New product, ${how}${patMonths ? `, a PAT every ${patMonths} months` : ''}`)
    } else {
      const k = g.known
      const change: PlannedProductChange = { id: k.id, name: k.name, row: first.input.row }
      const parts: string[] = []
      if (k.tracking === 'bulk' && (g.isCase || g.rows.some((r) => r.numbered))) {
        change.tracking = 'serialised'
        parts.push('numbered')
      }
      if (g.isCase && !k.isCase) {
        change.isCase = true
        parts.push('holds other kit')
      }
      if (k.valueCents === null && g.valueCents !== null) {
        change.valueCents = g.valueCents
        parts.push(`value ${valueLabel(g.valueCents)}`)
      }
      if (k.patMonths === null && patDays) {
        change.patMonths = LIST_PAT_MONTHS
        parts.push(`a PAT every ${LIST_PAT_MONTHS} months`)
      }
      const withList = withNotes(k.notes, notes)
      if (withList !== k.notes) {
        change.notes = withList
        parts.push('notes added to')
      }
      if (parts.length) {
        plan.productChanges.push(change)
        const s = doing(first)
        s.does.push(`Updates ${k.name}: ${inWords(parts)}`)
        s.updates = true
      }
    }
  }

  // Cases to make, from their names alone.
  for (const [k, c] of newCases) {
    let model: StockRef
    // A product here named as a case holds other kit already, or the list makes it, as its own rows say.
    if (c.known) model = { id: c.known.id }
    else {
      model = { key: `product:${k}` }
      if (!plan.products.some((p) => p.key === model.key))
        plan.products.push({ key: model.key!, row: c.first.input.row, name: c.product, department: groupOf(c.first)?.department ?? 'other', category: 'Cases', tracking: 'serialised', isCase: true, valueCents: null, patMonths: null, notes: '' })
    }
    plan.items.push({ key: `case:${k}`, row: c.first.input.row, model, number: null, oldNumber: '', serial: '', patDue: null, notes: '', where: { place: newCasePlaces.get(k) ?? null, case: null }, fromCount: false, isCase: true })
  }

  for (const r of live) {
    const g = groupOf(r)
    if (!g) continue
    const w = whereOf.get(r)!
    const s = doing(r)
    const model = modelRef(g)
    if (r.numbered || g.isCase) {
      const fresh: PlannedItem[] = []
      const isNew = (i: ItemOf): i is Extract<ItemOf, { key: string }> => !i.known
      const listed = r.numbered ? itemsOf.get(r)! : (caseCountNew.get(r) ?? []).map((key): ItemOf => ({ key, number: null, oldNumber: '', serial: '' }))
      // Labelling one that was counted takes it off the count, unless the list counts it there itself.
      const k = `${refKey(model)}@${whereKey(w)}`
      if (!takeable.has(k))
        takeable.set(k, countedRows.has(k) || (!w.place?.id && !w.case?.id) || !g.known ? 0 : (countNow.get(`${g.known.id}@${w.case ? `c:${w.case.id}` : `p:${w.place!.id}`}`) ?? 0))
      let took = 0
      for (const i of listed) {
        if (isNew(i)) {
          const fromCount = takeable.get(k)! > 0
          if (fromCount) {
            takeable.set(k, takeable.get(k)! - 1)
            took++
          }
          fresh.push({ key: i.key, row: r.input.row, model, number: i.number, oldNumber: i.oldNumber, serial: i.serial, patDue: r.patDue, notes: r.notes, where: w, fromCount, isCase: g.isCase })
        }
      }
      plan.items.push(...fresh)
      if (fresh.length) {
        const kept = fresh.filter((i) => i.number).map((i) => i.number!)
        const numbered = fresh.length - kept.length
        const keptSaid = kept.length > 3 ? `${kept.slice(0, 2).join(', ')} and ${kept.length - 2} more` : inWords(kept)
        const how = kept.length
          ? `: keeps ${keptSaid}${numbered ? `, and ${numbered} numbered when brought in` : ''}`
          : `, numbered when brought in`
        s.does.push(`${plural(fresh.length, 'new item')}${how}`)
      }
      if (took) {
        s.does.push(`Takes ${took} off the ${takeable.get(k)! + took} counted ${atSaid(r)}`)
        s.updates = true
      }
      const changed: string[] = []
      for (const i of itemsOf.get(r) ?? []) {
        if (!i.known) continue
        const item = i.known
        const change: PlannedChange = { row: r.input.row, id: item.id }
        const parts: string[] = []
        const moves = (w.case || w.place) && !(w.case ? item.caseId === w.case.id && !w.case.key : item.placeId === w.place!.id && !item.caseId && !w.place!.key)
        if (moves) {
          change.where = w
          parts.push(`moves ${w.case ? 'into' : 'to'} ${(whereSaid.get(r) ?? '').replace(/^(At|In) /, '')}`)
        }
        if (i.serial && norm(i.serial) !== norm(item.serial)) {
          change.serial = i.serial
          parts.push(`serial to ${i.serial}`)
        }
        if (i.tag && !i.sh && norm(i.tag) !== norm(item.oldNumber)) {
          change.oldNumber = i.tag
          parts.push(`old number to ${i.tag}`)
        }
        if (r.patDue && r.patDue !== item.patDue) {
          change.patDue = r.patDue
          parts.push(`PAT due ${fullDayLabel(r.patDue)}`)
        }
        const notes = r.notes ? withNotes(item.notes, r.notes) : item.notes
        if (notes !== item.notes) {
          change.notes = notes
          parts.push('notes added to')
        }
        if (parts.length) {
          plan.changes.push(change)
          changed.push(`${item.number || 'An item'}: ${inWords(parts)}`)
        }
      }
      if (changed.length) {
        s.does.push(...(changed.length > 3 ? [...changed.slice(0, 2), `${changed.length - 2} more changed as the list says`] : changed))
        s.updates = true
      }
    } else if (r.qty !== null) {
      if (!w.place && !w.case) {
        // A case that couldn't be named has said so already.
        if (!r.caseCell)
          r.problems.push({ field: 'place', text: "Say where these are kept: counted stock is at a place or in a case. Fill in the place, or the place for kit the list doesn't place, above." })
        continue
      }
      if (r.patDue) r.asides.push("A PAT due day is kept on each item, so it isn't kept for counted stock.")
      const now = g.known && !w.place?.key && !w.case?.key ? (countNow.get(`${g.known.id}@${w.case ? `c:${w.case.id}` : `p:${w.place!.id}`}`) ?? 0) : 0
      if (countedRows.get(`${refKey(model)}@${whereKey(w)}`) !== r) continue
      if (r.qty !== now) {
        plan.counts.push({ row: r.input.row, model, where: w, qty: r.qty })
        s.does.push(`Counts ${r.qty.toLocaleString('en-IE')} ${atSaid(r)}${now ? ` (${now.toLocaleString('en-IE')} there now)` : ''}`)
        if (now) s.updates = true
      }
    }
  }

  // Each row as the preview shows it.
  const out: StockListPreviewRow[] = rows.map((r) => {
    const g = groupOf(r)
    const s = r.live ? said.get(r) : undefined
    const does = s?.does.length ? s.does : r.live && r.name ? [UNCHANGED] : []
    const n = r.numbered ? Math.max(r.tags.length, r.serials.length) : r.qty
    const items = r.numbered || g?.isCase
    const facts = [
      n === null ? '' : items ? plural(n, 'item') : `${n.toLocaleString('en-IE')} counted`,
      g?.known ? '' : DEPARTMENT_LABELS[r.department ?? g?.department ?? 'other'],
      r.category,
      r.valueCents !== null ? valueLabel(r.valueCents) : '',
      r.patDue ? `PAT due ${fullDayLabel(r.patDue)}` : '',
    ].filter(Boolean)
    return {
      ...r.input,
      skip: !r.live,
      product: r.name,
      facts: facts.join(' · '),
      where: (r.live && whereSaid.get(r)) || (r.live && r.numbered ? 'Not placed yet' : ''),
      does,
      asides: r.asides,
      problems: r.problems,
      changes: does.length > 0 && does[0] !== UNCHANGED,
      updates: !!s?.updates,
    }
  })
  const liveOut = out.filter((r) => !r.skip)
  const counts: StockListCounts = {
    rows: out.length,
    products: plan.products.length,
    items: plan.items.length,
    counted: plan.counts.length,
    updates: liveOut.filter((r) => r.updates).length,
    unchanged: liveOut.filter((r) => !r.changes && r.problems.length === 0).length,
    skipped: out.length - liveOut.length,
    problems: liveOut.filter((r) => r.problems.length > 0).length,
  }
  return {
    rows: out,
    counts,
    places: [...newPlaces.values()].map((p) => p.name),
    cases: [...newCases.values()].map((c) => c.name),
    plan,
  }
}
