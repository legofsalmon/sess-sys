import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { currentRmsList, currentRmsTable } from '../src/current-rms.ts'
import { parseCsv } from '../src/csv.ts'
import { previewStockList, readStockFile, stockRows } from '../src/stock-import.ts'

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
      ['Product', 'Department', 'Category', 'Quantity', 'Value', 'Day price'],
      ['Corvo K12', 'audio', 'Audio', '2', '1250.00', '60.00'],
      ['10m XLR cable', 'other', 'Cables', '3', '20.00', '2.00'],
      ['Lumo Par 7', 'lighting', 'Lighting', '6', '', ''],
      ['Stage deck 2x1', 'staging', 'Pipe & Drape', '0', '300.00', '15.00'],
    ])
    expect(got.list!.said).toBe('4 products and 11 pieces of kit from Current RMS, with the rates. Everything comes in counted, to be labelled later.')
  })

  it('go through the usual bring-in with no column step, every product new and counted where the office says', () => {
    const file = readStockFile(currentRmsList([PRODUCTS, LEVELS]).list!.text).file!
    expect(file.columns).toEqual(['product', 'department', 'category', 'quantity', 'value', 'dayPrice'])
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
