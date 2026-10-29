import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { currentRmsList, currentRmsTable } from '../src/current-rms.ts'
import { parseCsv } from '../src/csv.ts'
import { previewStockList, readStockFile, stockRows, UNCHANGED } from '../src/stock-import.ts'

/**
 * Bringing the stock in from Current RMS (ADR 0056), on made-up exports:
 * each file is known by its headers; the products and the stock levels are
 * read together into one stock list of a row a product, everything counted;
 * sale stock is left out; the store's own rate beats the store-wide one;
 * and the list needs no column step, so it goes straight to the preview.
 */

const sample = (name: string) => readFileSync(new URL(`../../docs/samples/current-rms/${name}.csv`, import.meta.url), 'utf8')
const PRODUCTS = sample('products')
const LEVELS = sample('stock-levels')
const RATES = sample('rates')

describe('Current RMS’s exports', () => {
  it('are known by their headers, and any other file is not one', () => {
    expect([PRODUCTS, LEVELS, RATES].map(currentRmsTable)).toEqual(['products', 'levels', 'rates'])
    expect(currentRmsTable('Item,Quantity\nSpeaker,4\n')).toBeUndefined()
  })

  it('read together make one counted stock list, a row a product, with departments, values and day prices', () => {
    const got = currentRmsList([LEVELS, RATES, PRODUCTS])
    expect(got.problem).toBeUndefined()
    // Sale-only stock isn't hire kit; an asset is one, bulk its balance; the store's rate fills the price the product table left at nothing.
    expect(parseCsv(got.list!.text).filter((r) => r.length > 1)).toEqual([
      ['Product', 'Department', 'Category', 'Quantity', 'Value', 'Day price', 'Current RMS id'],
      ['Corvo K12', 'audio', 'Audio', '2', '1250.00', '60.00', '1'],
      ['10m XLR cable', 'other', 'Cables', '3', '20.00', '2.00', '2'],
      ['Lumo Par 7', 'lighting', 'Lighting', '6', '', '', '3'],
      ['Stage deck 2x1', 'staging', 'Pipe & Drape', '0', '300.00', '15.00', '5'],
    ])
    expect(got.list!.said).toBe('4 products and 11 pieces of kit from Current RMS, with the rates. Everything comes in counted, to be labelled later.')
  })

  it('go through the usual bring-in with no column step, every product new and counted where the office says', () => {
    const file = readStockFile(currentRmsList([PRODUCTS, LEVELS]).list!.text).file!
    expect(file.columns).toEqual(['product', 'department', 'category', 'quantity', 'value', 'dayPrice', 'listId'])
    const p = previewStockList(stockRows(file), { products: [], items: [], places: [], counts: [] }, { make: true, defaultPlace: 'Warehouse' })
    expect(p.counts).toMatchObject({ rows: 4, products: 4, items: 0, counted: 3, problems: 0 })
    expect(p.rows[0]).toMatchObject({ product: 'Corvo K12', facts: '2 counted · Audio · €1,250 · €60 a day' })
    expect(p.rows[0]!.does).toEqual(['New product, numbered, counted until labelled, €60 a day', 'Counts 2 at Warehouse (new place)'])
    // None held is a product with nothing counted yet; without the rates its price is the product table's, which is none.
    expect(p.rows[3]!.does).toEqual(['New product, numbered, counted until labelled'])
    expect(p.plan.prices.map((x) => x.dayCents)).toEqual([6000, 200])
  })

  it('say what is missing, or chosen twice, rather than bring half of it in', () => {
    expect(currentRmsList([PRODUCTS]).problem).toBe(
      'From Current RMS, choose the products and the stock levels together, and the rates if you have them. Missing: the stock levels.'
    )
    expect(currentRmsList([RATES]).problem).toMatch(/Missing: the products and the stock levels\.$/)
    expect(currentRmsList([PRODUCTS, PRODUCTS, LEVELS]).problem).toBe('Two of the files are the products. Choose each export once.')
    expect(currentRmsList([PRODUCTS, 'Item,Quantity\nSpeaker,4\n']).problem).toMatch(/^Each file has to be one of Current RMS’s exports/)
    const stray = LEVELS + '9,Ghost light,Default,Rental,0000000009,"","",01/04/2021,1.0,,1.0,\n'
    expect(currentRmsList([PRODUCTS, stray]).problem).toBe("The stock levels count “Ghost light”, which isn't in the products file. Export both again at the same time.")
  })
})

describe('a day price in any stock list', () => {
  const known = (dayCents: number | null) => ({
    products: [{ id: 'm1', name: 'Corvo K12', tracking: 'serialised' as const, isCase: false, valueCents: null, patMonths: null, notes: '', mistake: false, dayCents }],
    items: [],
    places: [{ id: 'p1', name: 'Warehouse' }],
    counts: [],
  })
  const rows = (...cells: Record<string, string>[]) => cells.map((c, i) => ({ row: i + 2, cells: { product: 'Corvo K12', quantity: '2', place: 'Warehouse', ...c } }))
  const opts = { make: false, defaultPlace: '' }

  it('fills a product’s price only where it has none, and two rows giving it different prices is a problem', () => {
    expect(previewStockList(rows({ dayPrice: '€60' }), known(null), opts).rows[0]!.does).toEqual(['Updates Corvo K12: day price €60', 'Counts 2 at Warehouse'])
    const kept = previewStockList(rows({ dayPrice: '60' }), known(5000), opts)
    expect(kept.plan.prices).toEqual([])
    expect(kept.rows[0]!.does).toEqual(['Counts 2 at Warehouse'])
    const two = previewStockList(rows({ dayPrice: '60' }, { dayPrice: '70', place: 'Yard' }), known(null), { make: true, defaultPlace: '' })
    expect(two.rows[1]!.problems.map((x) => x.text)).toEqual(['Row 2 gives Corvo K12 a day price of €60; this row says €70. Make them the same, or clear one.'])
    expect(previewStockList(rows({ dayPrice: 'lots' }), known(null), opts).rows[0]!.problems[0]).toMatchObject({ field: 'dayPrice' })
  })
})

describe('one place for all of it (ADR 0061)', () => {
  const none = { products: [], items: [], places: [{ id: 'p1', name: 'Warehouse' }], counts: [] }
  const rows = [
    { row: 2, cells: { product: 'Gaffer tape', quantity: '40' } },
    { row: 3, cells: { product: 'IEC lead', quantity: '12', place: 'Bay D' } },
    { row: 4, cells: { product: 'XLR 10m', quantity: '20', case: 'Cable trunk' } },
  ]
  const where = (allAt: boolean) =>
    previewStockList(rows, none, { make: true, defaultPlace: 'Warehouse', allAt }).rows.map((r) => r.where)

  it('puts only unplaced kit there unless told to put all of it there; kit in a case stays in its case', () => {
    expect(where(false)).toEqual(['At Warehouse', 'At Bay D (new place)', 'In Cable trunk (new case)'])
    expect(where(true)).toEqual(['At Warehouse', 'At Warehouse', 'In Cable trunk (new case)'])
  })

  it('adds up a product the list has at two places into one count there (audit, 20 October 2026, finding 105)', () => {
    const two = [
      { row: 2, cells: { product: 'Gaffer tape', quantity: '40', place: 'Bay A' } },
      { row: 3, cells: { product: 'Gaffer tape', quantity: '15', place: 'Bay B' } },
    ]
    const all = previewStockList(two, none, { make: true, defaultPlace: 'Warehouse', allAt: true })
    expect(all.rows.map((r) => [r.problems, r.does])).toEqual([
      [[], ['New product, counted', 'Counts 55 at Warehouse']],
      [[], ["Added into row 2's count at Warehouse"]],
    ])
    expect(all.plan.counts.map((c) => c.qty)).toEqual([55])
    // Each at its own place, they stay two counts.
    expect(previewStockList(two, none, { make: true, defaultPlace: 'Warehouse' }).plan.counts.map((c) => c.qty)).toEqual([40, 15])
  })
})

describe('a second bring-in of the same list (audit, 20 October 2026, finding 7)', () => {
  const amp = { id: 'm1', name: 'Amp', tracking: 'bulk' as const, isCase: false, valueCents: 50000, patMonths: null, notes: '', mistake: false, category: 'Amps' }
  const places = [
    { id: 'p1', name: 'Store one' },
    { id: 'p2', name: 'Store two' },
  ]
  const here = (over: Partial<typeof amp> & { listId?: string } = {}, counts = [{ modelId: 'm1', placeId: 'p1', caseId: null, qty: 12 }]) => ({
    products: [{ ...amp, ...over }],
    items: [],
    places,
    counts,
  })
  const row = (cells: Record<string, string>) => [{ row: 2, cells: { product: 'Amp', category: 'Amps', quantity: '12', value: '500', ...cells } }]

  it('moves the count to the place typed for the list, rather than counting it twice', () => {
    for (const options of [
      { make: true, defaultPlace: 'Store two' },
      { make: true, defaultPlace: 'Store two', allAt: true },
    ]) {
      const p = previewStockList(row({}), here(), options)
      expect(p.rows[0]!.does).toEqual(['Counts 12 at Store two', 'Counts none at Store one (12 there now): the list counts them all at Store two'])
      expect(p.plan.counts.map((c) => [c.where.place, c.qty])).toEqual([
        [{ id: 'p2' }, 12],
        [{ id: 'p1' }, 0],
      ])
    }
    // To a new place the same.
    const fresh = previewStockList(row({}), here(), { make: true, defaultPlace: 'Store three' })
    expect(fresh.rows[0]!.does).toEqual(['Counts 12 at Store three (new place)', 'Counts none at Store one (12 there now): the list counts them all at Store three'])
    // Brought in again where it is, nothing changes.
    expect(previewStockList(row({}), here(), { make: true, defaultPlace: 'Store one' }).rows[0]!.does).toEqual([UNCHANGED])
  })

  it('leaves a count the list does not mention where the row names its own place, and says so', () => {
    const p = previewStockList(row({ place: 'Store two' }), here(), { make: true, defaultPlace: '' })
    expect(p.rows[0]!.does).toEqual(['Counts 12 at Store two'])
    expect(p.rows[0]!.asides).toEqual(["12 more at Store one, which the list doesn't count, so that count stays."])
    expect(p.plan.counts).toHaveLength(1)
    // Where the list counts it at both places itself, both are as it says.
    const both = previewStockList(
      [
        { row: 2, cells: { product: 'Amp', quantity: '4', place: 'Store one' } },
        { row: 3, cells: { product: 'Amp', quantity: '8' } },
      ],
      here(),
      { make: true, defaultPlace: 'Store two' }
    )
    expect(both.rows.map((r) => r.does)).toEqual([['Counts 4 at Store one (12 there now)'], ['Counts 8 at Store two']])
  })

  it('finds a product renamed in Current RMS by its id there, and renames it here', () => {
    const p = previewStockList(row({ product: 'Amp mk2', listId: '7' }), here({ listId: '7' }), { make: true, defaultPlace: 'Store one' })
    expect(p.counts.products).toBe(0)
    expect(p.rows[0]!.does).toEqual(['Updates Amp: renamed Amp mk2'])
    expect(p.plan.productChanges).toEqual([{ id: 'm1', name: 'Amp', row: 2, rename: 'Amp mk2' }])
    // The first bring-in again keeps the id on each product, matched by name.
    const kept = previewStockList(row({ listId: '7' }), here(), { make: true, defaultPlace: 'Store one' })
    expect(kept.rows[0]!.does).toEqual(['Updates Amp: its id in the old system kept, 7'])
    expect(kept.plan.productChanges).toEqual([{ id: 'm1', name: 'Amp', row: 2, listId: '7' }])
    // A new product keeps its id from the start.
    expect(previewStockList(row({ product: 'Desk', listId: '9' }), { products: [], items: [], places, counts: [] }, { make: true, defaultPlace: 'Store one' }).plan.products[0]).toMatchObject({ name: 'Desk', listId: '9' })
  })

  it('says a new product looks like one here renamed, where there is no id to go by', () => {
    const p = previewStockList(row({ product: 'Amp mk2' }), here(), { make: true, defaultPlace: 'Store one' })
    expect(p.rows[0]!.does[0]).toMatch(/^New product/)
    expect(p.rows[0]!.asides).toEqual(["Looks like Amp renamed: the same category, value and count. If it is, rename Amp to Amp mk2 on its page first, so it isn't counted twice."])
    // Not when the list names that product too, or the count differs.
    expect(previewStockList([...row({ product: 'Amp mk2' }), { row: 3, cells: { product: 'Amp', quantity: '12', place: 'Store one' } }], here(), { make: true, defaultPlace: 'Store one' }).rows[0]!.asides).toEqual([])
    expect(previewStockList(row({ product: 'Amp mk2', quantity: '11' }), here(), { make: true, defaultPlace: 'Store one' }).rows[0]!.asides).toEqual([])
  })

  it('marks a row whose id is another product’s than the one its name finds', () => {
    const known = { products: [{ ...amp, listId: '7' }, { ...amp, id: 'm2', name: 'Desk', listId: '8' }], items: [], places, counts: [] }
    const p = previewStockList(row({ product: 'Desk', listId: '7' }), known, { make: true, defaultPlace: 'Store one' })
    expect(p.rows[0]!.problems.map((x) => x.text)).toEqual(["Desk is already here, and this row's id in the old system (7) is Amp's. Rename one of them on its page first."])
  })
})
