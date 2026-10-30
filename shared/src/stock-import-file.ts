import { BAD_LETTERS_HINT } from './crew-import.ts'
import { blankRecord, parseCsv } from './csv.ts'
import { isDay } from './day.ts'
import { MAX_QTY, type Department } from './stock.ts'

/**
 * Reading the stock list (ADR 0026): its columns found by their headers, its
 * rows, and what each cell says.
 */

// The columns.

export const STOCK_FIELDS = ['product', 'make', 'model', 'department', 'category', 'quantity', 'serial', 'number', 'place', 'case', 'value', 'patDue', 'notes', 'dayPrice', 'listId'] as const
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
  dayPrice: 'Day price',
  listId: 'Id in the old system',
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
  // A hire price for one day, for quotes (ADR 0042); a "price" alone is the value of one, as it always was.
  dayPrice: ['day price', 'day rate', 'daily rate', 'price a day', 'hire price', 'rental price'],
  // The product's own id where the list came from (audit, 20 October 2026, finding 7). Never a bare "Id", which is as often a line's number or an asset number.
  listId: ['current rms id', 'rms id', 'old system id', 'id in the old system'],
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
export const writtenMonthFirst = (cell: string) => {
  const n = inNumbers(cell.trim())
  return !!n && n.second > 12 && n.first <= 12
}
/** "03/04/2027": 3 April the Irish way, 4 March the American way. */
export const readsEitherWay = (cell: string) => {
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
export const RANGE = /^sh[\s-]*\d{1,6}\s*(?:-|–|to)\s*(?:sh[\s-]*)?\d{1,6}$/i
/** "#N/A", "#REF!": what a spreadsheet shows where a formula went wrong, never what the cell meant. */
export const SHEET_ERROR = /^#(n\/a|ref!|value!|name\?|div\/0!|null!|num!|spill!|calc!)$/i
/** "Total", "Grand total", "Subtotal:": a sum at the foot of a list, not kit. */
export const TOTALS = /^(grand |sub ?)?totals?:?$|^sum:?$/i

export const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
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
