import { blankRecord, parseCsv } from './csv.ts'
import { departmentNamed } from './stock-import.ts'
import type { Department } from './stock.ts'

/**
 * Bringing the stock in from Current RMS (ADR 0056). Current RMS exports
 * one table a file: its products, its stock levels (a row for each numbered
 * asset, and one for each product's bulk stock), and its rates. None of
 * them is a stock list on its own: the products say what each is and what
 * it's worth but not how many, and the stock levels say how many but not
 * what each is. So the files are read together here, on the device, into
 * one stock list of a row a product, which then goes through the usual
 * bring-in (ADR 0026) as if the office had made that sheet: the preview,
 * every row checked, and a second time changing nothing.
 *
 * Everything comes in counted. Current RMS numbers each asset, but those
 * numbers aren't on the kit, so they would only be numbers nobody can scan;
 * the kit is labelled with the app's own, and labelling takes one off the
 * count, as ever (ADR 0013).
 */

export type CurrentRmsTable = 'products' | 'levels' | 'rates'

/** The headers that say which table a file is. */
const SAYS: Record<CurrentRmsTable, readonly string[]> = {
  products: ['Name', 'Product Group', 'Stock Method', 'Replacement Charge'],
  levels: ['Product', 'Store', 'Asset Number', 'Current Balance'],
  rates: ['Product', 'Store', 'Transaction Type', 'Rate Definition', 'Price'],
}

export const CURRENT_RMS_LABELS: Record<CurrentRmsTable, string> = {
  products: 'the products',
  levels: 'the stock levels',
  rates: 'the rates',
}

interface Table {
  header: string[]
  rows: Record<string, string>[]
}

function tableOf(text: string): Table | undefined {
  const lines = parseCsv(text)
  const header = lines[0]?.map((h) => h.trim())
  if (!header) return undefined
  const rows = lines
    .slice(1)
    .filter((l) => !blankRecord(l))
    .map((l) => Object.fromEntries(header.map((h, i) => [h, (l[i] ?? '').trim()])))
  return { header, rows }
}

/** Which Current RMS table a file is, by its headers; undefined for any other file. */
export function currentRmsTable(text: string): CurrentRmsTable | undefined {
  const header = parseCsv(text.slice(0, 4000))[0]?.map((h) => h.trim()) ?? []
  return (Object.keys(SAYS) as CurrentRmsTable[]).find((t) => SAYS[t].every((h) => header.includes(h)))
}

/**
 * Current RMS's product groups that don't name a department themselves.
 * Cables, and groups only this company has, are Other, kept as the category
 * so the office can sort them on the products' pages.
 */
const GROUP_DEPARTMENTS: Record<string, Department> = {
  microphones: 'audio',
  'xlr 3 pin cable': 'audio',
  'dmx 5pin': 'lighting',
  fx: 'lighting',
  'video equipment': 'video',
  tv: 'video',
  'pipe & drape': 'staging',
  'pipe & drpae': 'staging',
}
export const departmentOfGroup = (group: string): Department => departmentNamed(group) ?? GROUP_DEPARTMENTS[group.trim().toLowerCase()] ?? 'other'

/** "150.0" as the stock list writes money; nothing for nought, which Current RMS writes where nothing was put in. */
function money(cell: string | undefined): string {
  const n = Number(cell ?? '')
  return Number.isFinite(n) && n > 0 ? (Math.round(n * 100) / 100).toFixed(2) : ''
}

/** How many of it, from a balance Current RMS keeps as "4.0"; below nothing is nothing. */
function amount(cell: string | undefined): number {
  const n = Number(cell ?? '')
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

const quoted = (cell: string) => (/[",\n\r]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)

/** The store the office hires from has its own rate where it isn't the store-wide one, and that one wins. */
function dayPrices(rates: Table): Map<string, string> {
  const best = new Map<string, { store: boolean; price: string }>()
  for (const r of rates.rows) {
    if (r['Transaction Type'] !== 'Rental') continue
    const price = money(r.Price)
    const store = r.Store !== ''
    const was = best.get(r.Product!)
    // A rate for the store beats the store-wide one; a store's rate of nothing leaves the other as it is.
    if (!was || (store && !was.store && price) || (!was.price && price)) best.set(r.Product!, { store, price })
  }
  return new Map([...best].map(([k, v]) => [k, v.price]))
}

export interface CurrentRmsList {
  /** The stock list as a CSV file, with the headers the bring-in knows. */
  text: string
  /** What was read from what, for the screen to say. */
  said: string
}

/**
 * The files chosen, read together into one stock list, or what's missing.
 * The products and the stock levels are both needed; the rates are used
 * when chosen, for the prices the products table leaves out.
 */
export function currentRmsList(texts: readonly string[]): { list: CurrentRmsList; problem?: undefined } | { list?: undefined; problem: string } {
  const tables: Partial<Record<CurrentRmsTable, Table>> = {}
  for (const text of texts) {
    const kind = currentRmsTable(text)
    const table = kind && tableOf(text)
    if (!kind || !table) return { problem: 'Each file has to be one of Current RMS’s exports: the products, the stock levels, or the rates.' }
    if (tables[kind]) return { problem: `Two of the files are ${CURRENT_RMS_LABELS[kind]}. Choose each export once.` }
    tables[kind] = table
  }
  const { products, levels, rates } = tables
  if (!products || !levels) {
    const missing = (['products', 'levels'] as const).filter((t) => !tables[t]).map((t) => CURRENT_RMS_LABELS[t])
    return { problem: `From Current RMS, choose the products and the stock levels together, and the rates if you have them. Missing: ${missing.join(' and ')}.` }
  }

  // How many of each: an asset is one; bulk stock is its balance. Stock kept for sale isn't hire kit.
  const held = new Map<string, number>()
  for (const r of levels.rows) {
    if (r['Stock Type'] === 'Sale') continue
    const n = r['Asset Number'] === 'Bulk Stock' ? amount(r['Current Balance']) : r['Current Balance'] === '' ? 1 : amount(r['Current Balance'])
    held.set(r.Product!, (held.get(r.Product!) ?? 0) + n)
  }
  // Products the levels name that the products table doesn't: none in a whole export, but a partial one is said rather than lost.
  const named = new Set(products.rows.map((p) => p.Name))
  const unknown = [...held.keys()].filter((k) => !named.has(k))
  if (unknown.length)
    return { problem: `The stock levels count ${unknown.length === 1 ? `“${unknown[0]}”, which isn't` : `${unknown.length} products that aren't`} in the products file. Export both again at the same time.` }

  const priced = rates ? dayPrices(rates) : new Map<string, string>()
  // Its id there is kept on the product, so the next bring-in finds it however it's renamed (audit, 20 October 2026, finding 7).
  const out = [['Product', 'Department', 'Category', 'Quantity', 'Value', 'Day price', 'Current RMS id']]
  let items = 0
  for (const p of products.rows) {
    if (p.Active === 'No' || p['Allowed Stock Type'] === 'Sale') continue
    const n = held.get(p.Name!) ?? 0
    items += n
    const group = p['Product Group'] ?? ''
    out.push([p.Name!, departmentOfGroup(group), group, String(n), money(p['Replacement Charge']), priced.get(p.Name!) || money(p['Rental Price']), p.Id ?? ''])
  }
  const said = `${out.length - 1} products and ${items.toLocaleString('en-IE')} pieces of kit from Current RMS${rates ? ', with the rates' : ''}. Everything comes in counted, to be labelled later.`
  return { list: { text: out.map((r) => r.map(quoted).join(',')).join('\n') + '\n', said } }
}
