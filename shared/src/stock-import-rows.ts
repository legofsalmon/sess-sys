import { INSPECTION_MONTHS } from './inspections.ts'
import { parseEuro } from './money.ts'
import { plural, valueLabel, type Department } from './stock.ts'
import {
  departmentNamed,
  productNameOf,
  RANGE,
  readQuantity,
  readsEitherWay,
  readStockDay,
  SHEET_ERROR,
  splitNumbers,
  STOCK_FIELDS,
  TOTALS,
  writtenMonthFirst,
  type StockListRow,
} from './stock-import-file.ts'
import type { PlannedWhere, StockListOptions, StockProblem, StockRef } from './stock-import-plan.ts'

/**
 * A row of the stock list as read on its own (ADR 0026), before it's matched
 * to anything.
 */

export const UNCHANGED = 'Already as the list says.'
/** The PAT is every year unless the office says otherwise on the product's page. */
export const LIST_PAT_MONTHS = INSPECTION_MONTHS.pat
/** ADR 0013's line between numbered and counted: anything worth more than about €150. */
export const NUMBERED_FROM_CENTS = 150_00
const MOST_CENTS = 1_000_000_00
/** As the price list takes (quotes.ts). */
const MOST_DAY_CENTS = 100_000_00
export const dayLabel = (cents: number) => `${valueLabel(cents)} a day`

export const inWords = (parts: string[]) => (parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`)
export const refKey = (r: StockRef | null) => (r ? (r.id ?? `new ${r.key}`) : '')
export const whereKey = (w: PlannedWhere) => (w.case ? `c:${refKey(w.case)}` : w.place ? `p:${refKey(w.place)}` : '')
/** The text added to notes once, as the crew list adds to them, cut to what they hold. */
export function withNotes(was: string, added: string, room = 2000): string {
  const kept = was.trim()
  const text = added.trim().slice(0, Math.max(0, room - kept.length - (kept ? 1 : 0)))
  if (!text || kept.includes(text)) return was
  return [kept, text].filter(Boolean).join('\n')
}

/** A row as read on its own, before it's matched to anything. */
export interface Read {
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
  dayCents: number | null
  patDue: string | null
  notes: string
  placeCell: string
  caseCell: string
  /** Its place is the one the office typed for the whole list, not one of its own. */
  typedPlace: boolean
  /** The product's id in the old system, such as Current RMS's. */
  listId: string
  /** Its PAT due day is written month first, or could be read either way. */
  monthFirst: boolean
  eitherWay: boolean
  problems: StockProblem[]
  asides: string[]
}

export function readRow(input: StockListRow & { skip?: boolean }, options: StockListOptions): Read {
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
  const day = parseEuro(c.dayPrice ?? '')
  if (day.reason !== undefined) problems.push({ field: 'dayPrice', text: `Couldn't read the day price "${c.dayPrice}". ${day.reason}` })
  else if (day.cents !== null && day.cents > MOST_DAY_CENTS) problems.push({ field: 'dayPrice', text: 'A day price can be up to €100,000.' })
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
    dayCents: day.reason === undefined && (day.cents ?? 0) <= MOST_DAY_CENTS ? day.cents : null,
    patDue: due.day ?? null,
    notes: (c.notes ?? '').slice(0, 2000),
    // Kit the row doesn't place goes where the office said, if it said; all of it, when the office said all of it.
    placeCell: caseCell ? (c.place ?? '') : options.allAt && options.defaultPlace.trim() ? options.defaultPlace.trim() : (c.place ?? options.defaultPlace.trim()),
    caseCell,
    typedPlace: !caseCell && !!options.defaultPlace.trim() && (!!options.allAt || !c.place),
    listId: (c.listId ?? '').slice(0, 100),
    monthFirst: writtenMonthFirst(c.patDue ?? ''),
    eitherWay: readsEitherWay(c.patDue ?? ''),
    problems,
    asides: [],
  }
}
