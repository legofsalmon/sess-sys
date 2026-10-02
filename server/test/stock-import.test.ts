import {
  itemLogWords,
  newId,
  previewStockList,
  UNCHANGED,
  type ItemLogPage,
  type MutationResult,
  type StockListOptions,
  type StockListReading,
  type StockListResult,
} from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AppOptions } from '../src/app.ts'
import type { Db } from '../src/db.ts'
import { IPHONE, server, staff } from './people.ts'

/**
 * Bringing in the stock list (ADR 0026), on the made-up sample file: the
 * preview reads it whatever its layout and saves nothing; places and cases
 * are made only when the office ticks; items keep a Session Hire number
 * that's free, keep any other tag as their old number, and the rest get the
 * next numbers, never one used before or set aside for printing, a
 * cancelled run's included; the same file twice changes nothing; a row that
 * would now do something else than the preview showed is refused; and an
 * item's log, the server's part, says what happened to it, with who.
 */

const SAMPLE = readFileSync(new URL('../../docs/samples/stock-list.csv', import.meta.url), 'utf8')
/** The sample with its one date that reads two ways put right, as the office would fix it. */
const FIXED = SAMPLE.replace('09/30/2027', '30/09/2027')
const MAKE: StockListOptions = { make: true, defaultPlace: '' }
const NO: StockListOptions = { make: false, defaultPlace: '' }

const refused = (r: MutationResult) => (r.status === 'rejected' ? r.reason.message : `applied (${r.seq})`)

/** Colly, signed in on her phone. */
async function office(more: Partial<AppOptions> = {}) {
  const { app, db } = await server(more)
  const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
  return { app, db, colly }
}

async function preview(app: FastifyInstance, cookies: Record<string, string>, text: string, options = MAKE) {
  const res = await app.inject({ method: 'POST', url: '/api/stock/import/preview', cookies, payload: { text, options } })
  expect(res.statusCode, res.body).toBe(200)
  return res.json() as StockListReading
}

/** The rows as the office sends them back, with what the preview said each does. */
const choices = (p: StockListReading) => p.rows.map((r) => ({ row: r.row, cells: r.cells, skip: r.skip, does: r.does }))

function bringIn(app: FastifyInstance, cookies: Record<string, string>, rows: unknown[], options = MAKE, going?: boolean) {
  return app.inject({ method: 'POST', url: '/api/stock/import?client=phonec0ffee', cookies, headers: { 'user-agent': IPHONE }, payload: { rows, options, going } })
}

/** As the app brings a long list in: a call at a time, each with what the last said each row now does, until nothing's left. */
async function bringAllIn(app: FastifyInstance, cookies: Record<string, string>, p: StockListReading) {
  let rows = choices(p)
  const calls: StockListResult[] = []
  for (;;) {
    const res = await bringIn(app, cookies, rows, MAKE, calls.length > 0)
    expect(res.statusCode, res.body).toBe(200)
    const got = res.json() as StockListResult
    calls.push(got)
    if (!got.left) return calls
    const now = new Map(got.left.rows.map((r) => [r.row, r.does]))
    rows = rows.map((r) => ({ ...r, does: now.get(r.row)! }))
  }
}

/** Every item, as the warehouse would read it off the shelves. */
async function items(db: Db) {
  const { rows } = await db.query<{ number: string; product: string; old: string; serial: string; place: string | null; inside: string | null; due: string | null }>(
    `SELECT (SELECT value FROM identifiers i WHERE i.asset_id = a.id AND i.retired_at IS NULL) AS number, m.name AS product,
            a.old_number AS old, a.serial, p.name AS place,
            (SELECT value FROM identifiers i WHERE i.asset_id = a.case_id AND i.retired_at IS NULL) AS inside, a.pat_due::text AS due
       FROM assets a JOIN models m ON m.id = a.model_id LEFT JOIN places p ON p.id = a.place_id
      ORDER BY number`
  )
  return rows
}

/** Everything the import could change, to compare before and after. */
async function everything(db: Db) {
  const read = async (sql: string) => (await db.query(sql)).rows
  return {
    models: await read('SELECT * FROM models ORDER BY id'),
    assets: await read('SELECT * FROM assets ORDER BY id'),
    identifiers: await read('SELECT id, asset_id, kind, value, retired_at FROM identifiers ORDER BY id'),
    places: await read('SELECT * FROM places ORDER BY id'),
    stock: await read('SELECT * FROM stock ORDER BY id'),
    changes: Number((await read('SELECT count(*) AS n FROM changes'))[0]!.n),
  }
}

describe('the preview', () => {
  it('reads the made-up list whatever its layout, says what each row will do, marks what it cannot be sure of, and saves nothing', async () => {
    const { app, db, colly } = await office()
    const p = await preview(app, colly.cookies, SAMPLE, NO)
    // A title above the headers is passed over; Supplier is no field, so it's listed as not read. The rows in a case need no place.
    expect(p.notRead).toEqual(['Supplier'])
    expect(p.counts).toEqual({ rows: 10, products: 9, items: 12, counted: 4, updates: 0, unchanged: 0, skipped: 0, problems: 9 })
    expect(p.places).toEqual(['Bay A1', 'Bay B2', 'Bay C1', 'Yard'])
    const row = (n: number) => p.rows.find((r) => r.row === n)!
    // Make and model make the name, the item column its description; "Sound" is Audio; €1,250 is read as money; the date the Irish way.
    expect(row(3)).toMatchObject({
      product: 'Corvo K12',
      facts: '4 items · Audio · Speakers · €1,250 · PAT due 30 Sep 2027',
      where: 'At Bay A1 (new place)',
      does: ['New product, numbered, a PAT every 12 months', '4 new items, numbered when brought in'],
    })
    expect(row(4).does).toEqual(['New product, numbered, a PAT every 12 months', '2 new items: keeps SH-000501 and SH-000502'])
    expect(row(4).where).toBe('In Amp rack 1')
    expect(row(5).does).toEqual(['New product, numbered, holds other kit', '1 new item, numbered when brought in'])
    expect(row(7).does).toEqual(['Counts 24 in Cable trunk 1'])
    expect(row(11).does).toEqual(['New product, numbered, counted until labelled', 'Counts 8 at Yard (new place)'])
    // A date that reads two ways is a problem, never a guess; a place not here yet waits on the tick.
    expect(row(10).problems.map((x) => x.text)).toEqual([
      '"09/30/2027" looks like the month first. Put it as day, month and year, like 30/09/2027.',
      "Bay C1 isn't a place here yet. Tick “Make the places and cases this list names”, or fix the place.",
    ])
    expect(row(10).problems[1]).toMatchObject({ field: 'place', tick: true })
    // With one date month first, one that reads either way could be either.
    expect(row(4).problems.map((x) => x.text)).toEqual(['Row 10 writes its date month first, so "1.3.27" could be either. Write the month as a word, like 30 Sep 2027.'])
    // Ticked, only the dates are left.
    const ticked = await preview(app, colly.cookies, SAMPLE)
    expect(ticked.counts.problems).toBe(2)
    expect((await db.query('SELECT count(*)::int AS n FROM models')).rows[0]).toEqual({ n: 0 })
  })

  it('says why a file cannot be read, and is for signed-in staff only', async () => {
    const { app, colly } = await office()
    const ask = (text: string) => app.inject({ method: 'POST', url: '/api/stock/import/preview', cookies: colly.cookies, payload: { text } })
    expect((await ask('')).json().error).toBe('The file is empty.')
    expect((await ask('Item,Qty\n')).json().error).toBe('The file has column names but no rows under them.')
    expect((await ask('Kit,Amount\nXLR,4')).json().error).toBe('No column is the product. Say which column is which, with one as the Product or the Model.')
    // The office says which column is which.
    const said = await app.inject({ method: 'POST', url: '/api/stock/import/preview', cookies: colly.cookies, payload: { text: 'Kit,Amount\nXLR,4', columns: ['product', 'quantity'] } })
    expect(said.json().rows[0]).toMatchObject({ product: 'XLR', cells: { product: 'XLR', quantity: '4' } })
    expect((await app.inject({ method: 'POST', url: '/api/stock/import/preview', payload: { text: SAMPLE } })).statusCode).toBe(401)
  })
})

describe('bringing the list in', () => {
  it('makes places and cases only when ticked, and brings every row in as the commands a device would send', async () => {
    const { app, db, colly } = await office()
    // Unticked, the new places are a problem, so nothing goes in.
    const unticked = await bringIn(app, colly.cookies, choices(await preview(app, colly.cookies, FIXED, NO)), NO)
    expect(unticked.statusCode).toBe(400)
    expect(unticked.json().error).toBe(
      "Row 3 (Corvo K12): Bay A1 isn't a place here yet. Tick “Make the places and cases this list names”, or fix the place. Nothing was brought in."
    )
    expect((await db.query('SELECT count(*)::int AS n FROM places')).rows[0]).toEqual({ n: 0 })

    const res = await bringIn(app, colly.cookies, choices(await preview(app, colly.cookies, FIXED)))
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ rows: 10, skipped: 0, products: 9, items: 12, counted: 4, places: 4, changed: 0 } satisfies StockListResult)
    // Numbers kept go in first, so the next free ones come after them; the cases next, so the amps have somewhere to go.
    expect(await items(db)).toEqual([
      { number: 'SH-000501', product: 'Corvo PA4', old: '', serial: 'CPA4-2201', place: null, inside: 'SH-000503', due: '2027-03-01' },
      { number: 'SH-000502', product: 'Corvo PA4', old: '', serial: 'CPA4-2202', place: null, inside: 'SH-000503', due: '2027-03-01' },
      { number: 'SH-000503', product: 'Amp rack 1', old: '', serial: '', place: 'Bay A1', inside: null, due: null },
      { number: 'SH-000504', product: 'Cable trunk 1', old: '', serial: '', place: 'Bay B2', inside: null, due: null },
      { number: 'SH-000505', product: 'Corvo K12', old: 'A-0101', serial: 'CK12-0101', place: 'Bay A1', inside: null, due: '2027-09-30' },
      { number: 'SH-000506', product: 'Corvo K12', old: 'A-0102', serial: 'CK12-0102', place: 'Bay A1', inside: null, due: '2027-09-30' },
      { number: 'SH-000507', product: 'Corvo K12', old: 'A-0103', serial: 'CK12-0103', place: 'Bay A1', inside: null, due: '2027-09-30' },
      { number: 'SH-000508', product: 'Corvo K12', old: 'A-0104', serial: 'CK12-0104', place: 'Bay A1', inside: null, due: '2027-09-30' },
      { number: 'SH-000509', product: 'Brightline Spot 7', old: '', serial: 'BL7-001', place: 'Bay C1', inside: null, due: '2027-01-15' },
      { number: 'SH-000510', product: 'Brightline Spot 7', old: '', serial: 'BL7-002', place: 'Bay C1', inside: null, due: '2027-01-15' },
      { number: 'SH-000511', product: 'Brightline Spot 7', old: '', serial: 'BL7-003', place: 'Bay C1', inside: null, due: '2027-01-15' },
      { number: 'SH-000512', product: 'Halden D32', old: '', serial: 'HD32-77', place: 'Bay C1', inside: null, due: '2027-09-30' },
    ])
    const { rows: models } = await db.query(
      'SELECT name, department, category, tracking, is_case, value_cents, pat_months, notes FROM models ORDER BY name'
    )
    expect(models).toContainEqual({ name: 'Corvo K12', department: 'audio', category: 'Speakers', tracking: 'serialised', is_case: false, value_cents: 125000, pat_months: 12, notes: 'Loudspeaker' })
    expect(models).toContainEqual({ name: 'XLR cable 10 m', department: 'audio', category: 'Cables', tracking: 'bulk', is_case: false, value_cents: 1200, pat_months: null, notes: 'Grey jackets' })
    expect(models).toContainEqual({ name: 'Halden D32', department: 'power', category: 'Distros', tracking: 'serialised', is_case: false, value_cents: 110000, pat_months: 12, notes: 'Power distro 32A' })
    const { rows: counts } = await db.query<{ product: string; place: string | null; qty: number }>(
      `SELECT m.name AS product, coalesce(p.name, (SELECT value FROM identifiers i WHERE i.asset_id = s.case_id)) AS place, s.qty
         FROM stock s JOIN models m ON m.id = s.model_id LEFT JOIN places p ON p.id = s.place_id ORDER BY m.name, place`
    )
    expect(counts).toEqual([
      { product: 'Stage deck 2x1', place: 'Yard', qty: 6 },
      { product: 'Truss 2 m', place: 'Yard', qty: 8 },
      { product: 'XLR cable 10 m', place: 'Bay B2', qty: 120 },
      { product: 'XLR cable 10 m', place: 'SH-000504', qty: 24 },
    ])
    // The history: a line for each command, all Colly's from her phone, and one for the import.
    const history = await colly.history('?limit=200')
    expect(history.entries[0]).toMatchObject({ what: 'Brought in the stock list (10 rows)', who: { name: 'Colly Hewson' }, deviceCode: 'c0ffee' })
    const said = history.entries.map((e) => e.what)
    expect(said).toContain('Saved the place Bay A1')
    expect(said).toContain('Added the product Corvo K12 (Audio, numbered)')
    expect(said).toContain('Added SH-000501 (Corvo PA4)')
    expect(said).toContain('Put SH-000501 (Corvo PA4) in SH-000503 (Amp rack 1)')
    expect(said).toContain('Counted 24 × XLR cable 10 m in SH-000504 (Cable trunk 1)')
    expect(said).toHaveLength(1 + 4 + 9 + 12 + 2 + 4)
  })

  it('changes nothing the second time the same file comes in', async () => {
    const { app, db, colly } = await office()
    expect((await bringIn(app, colly.cookies, choices(await preview(app, colly.cookies, FIXED)))).statusCode).toBe(200)
    const before = await everything(db)
    const historyBefore = (await colly.history('?limit=200')).entries.length

    // Numbered rows match their items by number, old number or serial; counted rows set what's set already.
    const again = await preview(app, colly.cookies, FIXED)
    expect(again.counts).toEqual({ rows: 10, products: 0, items: 0, counted: 0, updates: 0, unchanged: 10, skipped: 0, problems: 0 })
    expect(again.places).toEqual([])
    expect(again.rows.map((r) => r.does)).toEqual(again.rows.map(() => [UNCHANGED]))
    const res = await bringIn(app, colly.cookies, choices(again))
    expect(res.json()).toEqual({ rows: 10, skipped: 0, products: 0, items: 0, counted: 0, places: 0, changed: 0 })
    // Not one record or change more, and no line in the history for an import that found everything as it says.
    expect(await everything(db)).toEqual(before)
    expect((await colly.history('?limit=200')).entries).toHaveLength(historyBefore)
  })

  // Proves a list too long for one call goes in a call at a time to the same end as in one, with the history's line once, and that
  // a call refused part way leaves what went in, with the same file chosen again carrying on from there.
  it('brings a long list in a call at a time, to the same end as one call, and carries on after one is refused', async () => {
    const once = await office()
    expect((await bringIn(once.app, once.colly.cookies, choices(await preview(once.app, once.colly.cookies, FIXED)))).statusCode).toBe(200)
    const { app, db, colly } = await office({ stockImport: { ms: 60_000, commands: 7 } })
    const calls = await bringAllIn(app, colly.cookies, await preview(app, colly.cookies, FIXED))
    // 31 changes, 7 a call; each call but the last says how many are left.
    expect(calls.map((c) => c.left?.changes)).toEqual([24, 17, 10, 3, undefined])
    expect(calls.reduce((n, c) => n + c.items, 0)).toBe(12)
    expect(await items(db)).toEqual(await items(once.db))
    const history = (await colly.history('?limit=200')).entries.map((e) => e.what)
    expect(history).toHaveLength((await once.colly.history('?limit=200')).entries.length)
    expect(history.filter((w) => w.startsWith('Brought in the stock list'))).toEqual(['Brought in the stock list (10 rows)'])
    expect(history[0]).toBe('Brought in the stock list (10 rows)')

    // Another office, the same list, refused part way: someone adds the last row's product between two calls.
    const third = await office({ stockImport: { ms: 60_000, commands: 7 } })
    const first = await bringIn(third.app, third.colly.cookies, choices(await preview(third.app, third.colly.cookies, FIXED)))
    const left = (first.json() as StockListResult).left!
    expect(await third.colly.send('model.create', { id: newId(), name: 'Stage deck 2x1', department: 'staging', category: '', tracking: 'bulk', isCase: false, valueCents: null, notes: '' })).toMatchObject({ status: 'applied' })
    const now = new Map(left.rows.map((r) => [r.row, r.does]))
    const refused = await bringIn(third.app, third.colly.cookies, choices(await preview(third.app, third.colly.cookies, FIXED, MAKE)).map((r) => ({ ...r, does: now.get(r.row)! })), MAKE, true)
    expect(refused.statusCode).toBe(400)
    expect(refused.json().error).toBe(
      'Row 12 (Stage deck 2x1) would now do something else than the preview showed: Updates Stage deck 2x1: value €220 and notes added to; Counts 6 at Yard. Choose the file again to see it. Nothing more was brought in.'
    )
    // What went in stays, the places and three products: the same file again shows the rest, and brings it in.
    const again = await preview(third.app, third.colly.cookies, FIXED)
    expect(again).toMatchObject({ places: [], counts: { products: 5, items: 12, problems: 0 } })
    await bringAllIn(third.app, third.colly.cookies, again)
    expect((await items(third.db)).map((i) => i.number)).toEqual((await items(once.db)).map((i) => i.number))
  })

  // Proves an item's labels are found by the item: without it, reading one item read every label there is, so reading thousands, as each call does, took minutes.
  it('finds an item’s labels by the item, as each call reads every item', async () => {
    const { db } = await office()
    const { rows } = await db.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE tablename = 'identifiers'`)
    expect(rows.map((r) => r.indexdef)).toContainEqual(expect.stringMatching(/USING btree \(asset_id\)$/))
  })

  it('moves what a later list says has moved, sets its counts, and retires nothing it leaves out', async () => {
    const { app, db, colly } = await office()
    expect((await bringIn(app, colly.cookies, choices(await preview(app, colly.cookies, FIXED)))).statusCode).toBe(200)
    // Next month's list: one speaker has gone to Bay C1, the cables are counted again, and the trusses aren't on it.
    const later = [
      'Item,Make,Model,Qty,Serial No,Asset Tag,Location,Notes',
      'Loudspeaker,Corvo,K12,1,CK12-0101,A-0101,Bay C1,Grille dented',
      'XLR cable 10 m,,,118,,,Bay B2,',
    ].join('\n')
    const p = await preview(app, colly.cookies, later)
    expect(p.rows.map((r) => r.does)).toEqual([['SH-000505: moves to Bay C1 and notes added to'], ['Counts 118 at Bay B2 (120 there now)']])
    expect(p.counts).toMatchObject({ updates: 2, items: 0, products: 0 })
    expect((await bringIn(app, colly.cookies, choices(p))).json()).toMatchObject({ changed: 1, counted: 1 })
    expect((await items(db)).find((i) => i.number === 'SH-000505')).toMatchObject({ place: 'Bay C1' })
    expect((await db.query(`SELECT notes FROM assets WHERE old_number = 'A-0101'`)).rows[0]).toEqual({ notes: 'Grille dented' })
    expect((await db.query(`SELECT count(*)::int AS n FROM stock s JOIN models m ON m.id = s.model_id WHERE m.name = 'Truss 2 m'`)).rows[0]).toEqual({ n: 1 })
  })

  it('never gives out a number used before or set aside for printing, a cancelled run’s included', async () => {
    const { app, db, colly } = await office()
    // Numbers 1 to 600 set aside for a roll, then cancelled: its labels may be printed, so none is given out again.
    const roll = newId()
    expect(await colly.send('labels.reserve', { id: roll, count: 600, name: 'Roll', notes: '' })).toMatchObject({ status: 'applied' })
    expect(await colly.send('labels.cancel', { id: roll })).toMatchObject({ status: 'applied' })
    // An old speaker numbered SH-000700, then given a new label: SH-000700 is spent.
    const speaker = newId()
    const old = newId()
    expect(await colly.send('model.create', { id: speaker, name: 'Old speaker', department: 'audio', category: '', tracking: 'serialised', isCase: false, valueCents: null, notes: '' })).toMatchObject({ status: 'applied' })
    expect(await colly.send('asset.add', { id: old, modelId: speaker, number: 'SH-000700', serial: '', placeId: null, caseId: null, notes: '', fromCount: false })).toMatchObject({ status: 'applied' })
    expect(await colly.send('asset.relabel', { id: old, number: null })).toMatchObject({ status: 'applied' })

    // A list giving the spent number is told so, row by row.
    const spent = await preview(app, colly.cookies, 'Item,Asset number\nOld speaker,SH-000700\nOld speaker,SH-000701')
    expect(spent.rows.map((r) => r.problems.map((x) => x.text))).toEqual([
      ["SH-000700 was SH-000701 (Old speaker)'s number before, and a number is never used twice. Use the number it has now."],
      [],
    ])
    expect(spent.rows[1]!.does).toEqual([UNCHANGED])

    // The sample keeps its own two, from the cancelled run, since those labels may be on the amps; the rest come after everything spent.
    expect((await bringIn(app, colly.cookies, choices(await preview(app, colly.cookies, FIXED)))).statusCode).toBe(200)
    const numbers = (await items(db)).map((i) => i.number)
    expect(numbers).toEqual(['SH-000501', 'SH-000502', 'SH-000701', ...Array.from({ length: 10 }, (_, i) => `SH-000${702 + i}`)])
  })

  it('takes a row fixed in place and skips a row skipped, and refuses one that would now do something else than the preview showed', async () => {
    const { app, db, colly } = await office()
    const p = await preview(app, colly.cookies, SAMPLE)
    const bad = p.rows.find((r) => r.row === 10)!
    expect(bad.problems).toHaveLength(1)
    // As the device does it: the cell fixed, every row read again by the shared rules against what it holds, here nothing.
    const fixed = p.rows.map((r) => ({ ...r, cells: r.row === 10 ? { ...r.cells, patDue: '30.9.2027' } : r.cells, skip: r.row === 12 }))
    const again = previewStockList(fixed, { products: [], items: [], places: [], counts: [] }, MAKE)
    expect(again.rows.find((r) => r.row === 10)).toMatchObject({ problems: [], facts: '1 item · Power · Distros · €1,100 · PAT due 30 Sep 2027' })
    expect(again.counts).toMatchObject({ problems: 0, skipped: 1 })
    const rows = again.rows.map((r) => ({ row: r.row, cells: r.cells, skip: r.skip, does: r.does }))

    // Meanwhile, someone adds Corvo K12 on another phone: row 3 would now update it, not make it, which the office hasn't seen.
    const k12 = newId()
    expect(await colly.send('model.create', { id: k12, name: 'Corvo K12', department: 'audio', category: '', tracking: 'serialised', isCase: false, valueCents: null, notes: '' })).toMatchObject({ status: 'applied' })
    const stale = await bringIn(app, colly.cookies, rows)
    expect(stale.statusCode).toBe(400)
    expect(stale.json().error).toBe(
      'Row 3 (Corvo K12) would now do something else than the preview showed: Updates Corvo K12: value €1,250, a PAT every 12 months and notes added to; 4 new items, numbered when brought in. Choose the file again to see it. Nothing was brought in.'
    )
    expect((await db.query('SELECT count(*)::int AS n FROM assets')).rows[0]).toEqual({ n: 0 })
    expect(await colly.send('model.mistake', { id: k12 })).toMatchObject({ status: 'applied' })

    const res = await bringIn(app, colly.cookies, rows)
    expect(res.json()).toEqual({ rows: 9, skipped: 1, products: 8, items: 12, counted: 3, places: 4, changed: 0 })
    expect((await items(db)).find((i) => i.product === 'Halden D32')).toMatchObject({ due: '2027-09-30' })
    expect((await db.query(`SELECT count(*)::int AS n FROM models WHERE name = 'Stage deck 2x1'`)).rows[0]).toEqual({ n: 0 })
    expect((await colly.history()).entries[0]!.what).toBe('Brought in the stock list (9 rows, 1 skipped)')
  })

  it('puts kit the list does not place where the office says, and marks counted stock with nowhere to be', async () => {
    const { app, db, colly } = await office()
    const text = 'Item,Qty,Location\nGaffer tape,40,\nIEC lead 2 m,12,Bay D\n'
    const nowhere = await preview(app, colly.cookies, text)
    expect(nowhere.rows[0]!.problems.map((x) => x.text)).toEqual([
      "Say where these are kept: counted stock is at a place or in a case. Fill in the place, or the place for kit the list doesn't place, above.",
    ])
    const somewhere = await preview(app, colly.cookies, text, { make: true, defaultPlace: 'Warehouse' })
    expect(somewhere.rows.map((r) => r.does)).toEqual([
      ['New product, counted', 'Counts 40 at Warehouse (new place)'],
      ['New product, counted', 'Counts 12 at Bay D (new place)'],
    ])
    expect(somewhere.places).toEqual(['Warehouse', 'Bay D'])
    expect((await bringIn(app, colly.cookies, choices(somewhere), { make: true, defaultPlace: 'Warehouse' })).statusCode).toBe(200)
    expect((await db.query('SELECT name FROM places ORDER BY name')).rows).toEqual([{ name: 'Bay D' }, { name: 'Warehouse' }])
  })
})

describe('an item’s old number and PAT due day', () => {
  it('are kept by their own rules, said in the history, and the PAT due day stands until a test is recorded', async () => {
    const { app, colly } = await office()
    const model = newId()
    const a = newId()
    const b = newId()
    expect(await colly.send('model.create', { id: model, name: 'Corvo K12', department: 'audio', category: '', tracking: 'serialised', isCase: false, valueCents: null, notes: '', patMonths: 12 })).toMatchObject({ status: 'applied' })
    const add = (id: string, more: object) => colly.send('asset.add', { id, modelId: model, number: null, serial: '', placeId: null, caseId: null, notes: '', fromCount: false, ...more })
    expect(await add(a, { oldNumber: 'A-0101', patDue: '2027-09-30' })).toMatchObject({ status: 'applied' })
    // One item to an old tag, whatever the capitals, and never a Session Hire number.
    expect(refused(await add(b, { oldNumber: 'a-0101' }))).toBe('a-0101 is already the old number of SH-000001 (Corvo K12).')
    expect(refused(await add(b, { oldNumber: 'SH-000123' }))).toBe("SH-000123 is a Session Hire number. Put it on as the item's label, not as its old number.")
    expect(refused(await colly.send('asset.update', { id: a, patDue: '2027-02-31' }))).toBe("That isn't a real date.")
    // An older app's add says nothing of either: it has none.
    expect(await add(b, {})).toMatchObject({ status: 'applied' })
    expect(await colly.record('asset', b)).toMatchObject({ oldNumber: '', patDue: null })
    expect(await colly.send('asset.update', { id: b, oldNumber: 'A-0102', patDue: '2027-01-15' })).toMatchObject({ status: 'applied' })
    expect((await colly.history()).entries[0]!.what).toBe('Changed SH-000002 (Corvo K12): old number to A-0102 and PAT due 15 Jan 2027')
    expect(await colly.record('asset', a)).toMatchObject({ oldNumber: 'A-0101', patDue: '2027-09-30' })
  })
})

describe('an item’s log, the server’s part', () => {
  it('says what happened to the item, newest first, with who, keyed so the phone can join its own part to it', async () => {
    const { app, colly } = await office()
    const id = () => newId()
    const [bay, rack, speaker, rackItem, item, job, fault] = [id(), id(), id(), id(), id(), id(), id()]
    const at = (h: number) => new Date(Date.UTC(2026, 9, 2, h)).toISOString()
    const steps: [string, Record<string, unknown>][] = [
      ['place.upsert', { id: bay, name: 'Bay A1', notes: '' }],
      ['model.create', { id: rack, name: 'Amp rack', department: 'audio', category: '', tracking: 'serialised', isCase: true, valueCents: null, notes: '' }],
      ['model.create', { id: speaker, name: 'Corvo K12', department: 'audio', category: '', tracking: 'serialised', isCase: false, valueCents: null, notes: '' }],
      ['asset.add', { id: rackItem, modelId: rack, number: null, serial: '', placeId: bay, caseId: null, notes: '', fromCount: false }],
      ['asset.add', { id: item, modelId: speaker, number: null, serial: '', placeId: bay, caseId: null, notes: '', fromCount: false }],
      ['asset.move', { id: item, placeId: null, caseId: rackItem }],
      ['project.create', { id: job, name: 'Nissan launch', clientId: null, venueId: null, status: 'confirmed', notes: '' }],
      // The rack scanned out takes the speaker; the speaker comes back on its own, damaged.
      ['move.record', { id: 'out-1', projectId: job, direction: 'out', assetId: rackItem, modelId: rack, qty: 1, at: at(9) }],
      ['move.record', { id: 'back-1', projectId: job, direction: 'in', assetId: item, modelId: speaker, qty: 1, at: at(18) }],
      ['fault.report', { id: fault, kind: 'damaged', assetId: item, modelId: speaker, qty: 1, projectId: job, usable: false, note: 'Blown driver', at: at(19) }],
      ['fault.update', { id: fault, repair: 'New driver fitted' }],
      ['fault.close', { id: fault, outcome: 'fixed', at: at(20) }],
      ['inspection.record', { id: 'pat-1', assetId: item, kind: 'pat', passed: true, at: at(21), by: 'Sparky Testing', note: '' }],
      ['asset.relabel', { id: item, number: null }],
      ['asset.update', { id: item, serial: 'CK12-0101' }],
    ]
    for (const [name, args] of steps) expect(await colly.send(name as never, args as never), name).toMatchObject({ status: 'applied' })

    const res = await app.inject({ url: `/api/stock/items/${item}/log`, cookies: colly.cookies })
    expect(res.statusCode).toBe(200)
    const page = res.json() as ItemLogPage
    const said = page.entries.map((e) => [e.key.split(':')[0], e.who, (e as { event: { kind: string } }).event.kind])
    expect(said).toEqual([
      ['mutation', 'Colly Hewson', 'edited'],
      ['mutation', 'Colly Hewson', 'relabelled'],
      ['inspection', 'Colly Hewson', 'test'],
      ['closed', 'Colly Hewson', 'closed'],
      ['mutation', 'Colly Hewson', 'repair'],
      ['fault', 'Colly Hewson', 'fault'],
      ['movement', 'Colly Hewson', 'back'],
      ['movement', 'Colly Hewson', 'out'],
      ['mutation', 'Colly Hewson', 'moved'],
      ['mutation', 'Colly Hewson', 'added'],
    ])
    expect(page.entries.map((e) => itemLogWords(e.event))).toEqual([
      'Changed its serial to CK12-0101',
      'New label SH-000003, replacing SH-000002',
      'Passed its PAT, tested by Sparky Testing',
      'Marked fixed',
      'Repair notes: New driver fitted',
      "Reported damaged back from Nissan launch, can't go out: Blown driver",
      'Back in from Nissan launch',
      'Out to Nissan launch, in SH-000001 (Amp rack)',
      'Put in SH-000001 (Amp rack)',
      'Added as SH-000002 at Bay A1',
    ])
    // Keyed as the phone keys what it holds, so the two parts join without doubling.
    expect(page.entries.find((e) => e.event.kind === 'back')).toMatchObject({ key: 'movement:back-1', at: at(18), device: 'Safari on iPhone', from: 'server' })
    expect(page.entries.find((e) => e.event.kind === 'test')).toMatchObject({ key: 'inspection:pat-1' })
    // An item the server doesn't have yet, such as one still on its way from a phone, has no log there yet.
    expect((await app.inject({ url: '/api/stock/items/nothing/log', cookies: colly.cookies })).json()).toEqual({ entries: [] })
  })
})
