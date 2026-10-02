import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BAD_LETTERS_HINT } from '../src/crew-import.ts'
import {
  bringInStockLabel,
  columnLetter,
  columnsFor,
  needsColumnStep,
  previewStockList,
  productNameOf,
  readQuantity,
  readStockDay,
  readStockFile,
  splitNumbers,
  stockListSaid,
  stockRows,
  UNCHANGED,
  unreadColumns,
  type KnownStock,
  type StockListOptions,
  type StockListRow,
} from '../src/stock-import.ts'

/**
 * Reading the stock list (ADR 0026): columns found by many names, and the
 * ones the app doesn't know asked about; days the Irish way, with anything
 * that reads two ways a problem; money read as the rest of the app reads
 * it; numbered rows against counted ones, several numbers to a cell; what's
 * matched against the catalogue already, and every problem said in words
 * on the field it's about.
 */

const SAMPLE = readFileSync(new URL('../../docs/samples/stock-list.csv', import.meta.url), 'utf8')
const NOTHING: KnownStock = { products: [], items: [], places: [], counts: [] }
const MAKE: StockListOptions = { make: true, defaultPlace: '' }
/** Rows as a file of these headers and lines would give them. */
const rowsOf = (text: string) => {
  const read = readStockFile(text)
  if (!read.file) throw new Error(read.problem)
  return stockRows(read.file)
}
const said = (text: string, known = NOTHING, options = MAKE) => previewStockList(rowsOf(text), known, options)
const problems = (r: { problems: { field: string | null; text: string }[] }) => r.problems.map((p) => `${p.field}: ${p.text}`)

describe('the columns', () => {
  it('are found by many names, with capitals, brackets and marks aside, the first column for a field read', () => {
    expect(
      columnsFor(['Description', 'Manufacturer', 'Model No.', 'Dept', 'Type', 'How many', 'S/N', 'SH Number', 'Shelf', 'Road Case', 'Cost (€)', 'Next PAT', 'Comments'])
    ).toEqual(['product', 'make', 'model', 'department', 'category', 'quantity', 'serial', 'number', 'place', 'case', 'value', 'patDue', 'notes'])
    expect(columnsFor(['ITEM NAME', 'Brand', 'qty', 'Serial #', 'Barcode', 'Bay', 'Flight case', 'Replacement value (EUR)', 'PAT due date', 'Notes:'])).toEqual([
      'product',
      'make',
      'quantity',
      'serial',
      'number',
      'place',
      'case',
      'value',
      'patDue',
      'notes',
    ])
    // Two columns that could each be the product: the first name in the list wins, and the other is left for the office.
    expect(columnsFor(['Description', 'Item', 'Supplier'])).toEqual([null, 'product', null])
  })

  it('pass over a title above the header, and ask which is which when one is unknown or none is the product', () => {
    const read = readStockFile(SAMPLE)
    expect(read.file!.headerRow).toBe(2)
    expect(read.file!.records[0]!.row).toBe(3)
    expect(unreadColumns(read.file!).map((i) => read.file!.header[i])).toEqual(['Supplier'])
    expect(needsColumnStep(read.file!)).toBe(true)
    expect(read.file!.samples[13]).toEqual(['Corvo Ireland', 'Corvo Ireland', 'Cable Co'])
    // Every column known: straight to the preview.
    expect(needsColumnStep(readStockFile('Item,Qty\nXLR,4').file!)).toBe(false)
    // None known: the first row is the header all the same, and the office says which is which.
    const unknown = readStockFile('Kit,Amount,\nXLR,4,spare').file!
    expect(unknown.columns).toEqual([null, null, null])
    expect(needsColumnStep(unknown)).toBe(true)
    expect(unreadColumns(unknown)).toEqual([0, 1, 2])
    expect(stockRows(unknown, ['product', 'quantity', 'notes'])).toEqual([{ row: 2, cells: { product: 'XLR', quantity: '4', notes: 'spare' } }])
    expect([0, 2, 25, 26, 27].map(columnLetter)).toEqual(['A', 'C', 'Z', 'AA', 'AB'])
  })

  // Proves a sheet saved by an Excel that writes commas as the decimal mark, split by semicolons, is read as its columns, and that "No.", a line's number as often as a count, is asked about.
  it('are split by semicolons where Excel saves them so, and a column headed No. is asked about', () => {
    const read = readStockFile('\uFEFFItem;Qty;Value;Location\r\nXLR 10 m;"1.200";12,50;Bay A\r\n').file!
    expect(read.columns).toEqual(['product', 'quantity', 'value', 'place'])
    expect(stockRows(read)).toEqual([{ row: 2, cells: { product: 'XLR 10 m', quantity: '1.200', value: '12,50', place: 'Bay A' } }])
    // Headers it doesn't know, split by semicolons all the same: more columns that way.
    expect(readStockFile('Ainm;Líon\nCábla;4').file!.header).toEqual(['Ainm', 'Líon'])
    // A comma file with a semicolon in a cell stays a comma file.
    expect(readStockFile('Item,Notes\nXLR,"spare; grey"').file!.columns).toEqual(['product', 'notes'])
    expect(columnsFor(['No.', 'Item', 'Qty'])).toEqual([null, 'product', 'quantity'])
  })

  it('say why a file can’t be read at all', () => {
    expect(readStockFile('')).toEqual({ problem: 'The file is empty.' })
    expect(readStockFile('Item,Qty\r\n,\r\n')).toEqual({ problem: 'The file has column names but no rows under them.' })
    expect(readStockFile('Item,Qty\nC�ble,4')).toEqual({ problem: BAD_LETTERS_HINT })
  })
})

describe('a cell', () => {
  it('reads a day the Irish way, day first, and marks one that could be read two ways', () => {
    const day = (t: string) => readStockDay(t).day
    expect(['30/09/2027', '30/9/27', '30.09.2027', '30-9-2027', '2027-09-30', '2027-09-30T00:00:00', '30 Sept 2027', '30-Sep-27', '30th September 2027', 'September 30, 2027'].map(day)).toEqual(
      Array(10).fill('2027-09-30')
    )
    // 3/4 is the 3rd of April, never March the 4th.
    expect(day('03/04/2027')).toBe('2027-04-03')
    // Excel adds a time to a date formatted with one.
    expect(['30/09/2027 00:00', '30/09/2027 00:00:00'].map(day)).toEqual(['2027-09-30', '2027-09-30'])
    expect(readStockDay('')).toEqual({ day: null })
    const problem = (t: string) => readStockDay(t).problem
    expect(problem('09/30/2027')).toBe('"09/30/2027" looks like the month first. Put it as day, month and year, like 30/09/2027.')
    expect(problem('46660')).toBe('"46660" is a spreadsheet\'s number for a date, not the date. Format the column as dates and save the file again.')
    expect(problem('Sept 2027')).toBe('"Sept 2027" has no day. Put it as day, month and year, like 30/09/2027.')
    expect(problem('09/2027')).toBe('"09/2027" has no day. Put it as day, month and year, like 30/09/2027.')
    expect(problem('31/02/2027')).toBe('Couldn\'t read "31/02/2027" as a date. Put it as day, month and year, like 30/09/2027.')
    expect(problem('next year')).toBe('Couldn\'t read "next year" as a date. Put it as day, month and year, like 30/09/2027.')
  })

  it('reads a quantity, several numbers to a cell, and the product’s name from make and model', () => {
    expect(['12', 'x12', '12 pcs', '12x', '1,200'].map((t) => readQuantity(t).qty)).toEqual([12, 12, 12, 12, 1200])
    expect(readQuantity('a few')).toEqual({ qty: null, problem: 'Couldn\'t read the quantity "a few". Put in a whole number, like 12.' })
    expect(splitNumbers('A1, A2;A3\nA4')).toEqual(['A1', 'A2', 'A3', 'A4'])
    expect(splitNumbers('n/a')).toEqual([])
    expect(splitNumbers(' - ')).toEqual([])
    expect(productNameOf({ make: 'Corvo', model: 'K12', product: 'Loudspeaker' })).toEqual({ name: 'Corvo K12', description: 'Loudspeaker' })
    expect(productNameOf({ make: 'Corvo', model: 'Corvo K12' })).toEqual({ name: 'Corvo K12', description: '' })
    expect(productNameOf({ make: 'Corvo', product: 'K12 speaker' })).toEqual({ name: 'Corvo K12 speaker', description: '' })
    expect(productNameOf({ make: 'Corvo' })).toEqual({ name: '', description: '' })
  })

  it('reads money as the rest of the app does, and marks a value it can’t read or two rows that disagree', () => {
    const p = said('Item,Qty,Value,Location\nA,1,"€1,250.50",Bay\nB,1,1 250,Bay\nC,1,about 40,Bay\nD,2,€40,Bay\nD,3,€45,Shelf')
    expect(p.rows.map((r) => r.facts)).toEqual(['1 counted · Other · €1,250.50', '1 counted · Other · €1,250', '1 counted · Other', '2 counted · Other · €40', '3 counted · Other · €45'])
    expect(problems(p.rows[2]!)).toEqual(['value: Couldn\'t read the value "about 40". Put in a price like 250 or 1,250.50.'])
    expect(problems(p.rows[4]!)).toEqual(['value: Row 5 gives D a value of €40; this row says €45. Make them the same, or clear one.'])
  })
})

describe('a row', () => {
  it('is numbered items when it has numbers, several to a cell, and counted stock when it has only a quantity', () => {
    const p = said(
      [
        'Item,Qty,Serial,Asset number,Location,Value',
        'Speaker,3,"S1, S2\nS3",,Bay A,',
        'Cable,40,,,Bay A,€12',
        'Amp,,,"SH-000501; A-77",Bay A,',
        'Desk,1,,,Bay A,"€9,000"',
      ].join('\n')
    )
    expect(p.rows.map((r) => [r.facts, r.does])).toEqual([
      ['3 items · Other', ['New product, numbered', '3 new items, numbered when brought in']],
      ['40 counted · Other · €12', ['New product, counted', 'Counts 40 at Bay A (new place)']],
      ['2 items · Other', ['New product, numbered', '2 new items: keeps SH-000501, and 1 numbered when brought in']],
      // Worth €150 or more, as ADR 0013 draws the line, so numbered, though counted until it's labelled.
      ['1 counted · Other · €9,000', ['New product, numbered, counted until labelled', 'Counts 1 at Bay A (new place)']],
    ])
    expect(p.plan.items.map((i) => [i.number, i.oldNumber, i.serial])).toEqual([
      [null, '', 'S1'],
      [null, '', 'S2'],
      [null, '', 'S3'],
      ['SH-000501', '', ''],
      [null, 'A-77', ''],
    ])
    expect(p.counts).toEqual({ rows: 4, products: 4, items: 5, counted: 2, updates: 0, unchanged: 0, skipped: 0, problems: 0 })
    expect(stockListSaid(p.counts)).toBe('4 rows read: 4 new products, 5 new items, 2 counts.')
    expect(bringInStockLabel(p.counts)).toBe('Bring in 4 rows')
  })

  it('says each problem on the field it’s about, in words', () => {
    const p = said(
      [
        'Item,Dept,Qty,Serial,Asset number,Location,PAT due',
        ',Audio,1,,,Bay,',
        'Speaker,Sound & Vision,2,"S1,S2,S3",,Bay,',
        'Amp,Audio,,"S1,S2","A1",Bay,',
        'Truss,Rigging,,,,Bay,',
        'Clamp,Rigging,"SH-000001 to SH-000010",,"SH-000001 to SH-000010",Bay,',
        'Light,Lighting,1,,X-1,Bay,',
        'Light,Lighting,1,,X-1,Bay,',
        'Cable,Audio,10,,,Bay,30/09/2027',
        'Cable,Audio,12,,,Bay,',
      ].join('\n')
    )
    expect(p.rows.map(problems)).toEqual([
      ['product: No product: the row needs a product name, or a make and a model.'],
      [
        'department: Couldn\'t tell which department "Sound & Vision" is: Audio, Lighting, Video, Staging, Rigging, Power or Other.',
        'quantity: The quantity is 2, but there are 3 numbers: one for each item, or fix the quantity.',
      ],
      ['serial: 1 asset number but 2 serials: one of each for every item, in the same order.'],
      ['quantity: No quantity and no numbers: say how many there are.'],
      [
        'quantity: Couldn\'t read the quantity "SH-000001 to SH-000010". Put in a whole number, like 12.',
        'number: "SH-000001 to SH-000010" is a range. Write each number out, separated by commas.',
      ],
      [],
      ['number: X-1 is on row 7 too.'],
      [],
      ['null: Row 9 counts Cable at Bay too. Add them up into one row, or skip one.'],
    ])
    // A PAT due day on counted stock isn't kept, and the row says so without stopping it.
    expect(p.rows[7]!.asides).toEqual(["A PAT due day is kept on each item, so it isn't kept for counted stock."])
    // Skipped, a row is out of the running: its twin goes in.
    const skipped = previewStockList(
      p.rows.map((r) => ({ row: r.row, cells: r.cells, skip: r.row === 7 })),
      NOTHING,
      MAKE
    )
    expect(skipped.rows.find((r) => r.row === 8)!.problems).toEqual([])
    expect(skipped.counts.skipped).toBe(1)
  })

  // Proves a row of totals, a spreadsheet's error, and a date that a month-first list leaves open are each a problem, never kit or a guessed day.
  it('marks a row of totals, a spreadsheet’s error, and a date that reads either way in a list that writes one month first', () => {
    const p = said(
      [
        'Item,Qty,Serial,Asset number,Location,PAT due',
        'Mic,1,M1,,Bay,09/30/2027',
        'Mic,1,M2,,Bay,03/04/2027',
        'Mic,1,M3,,Bay,13/04/2027',
        'Mic,1,M4,#N/A,Bay,',
        'Total,"1,234",,,Bay,',
      ].join('\n')
    )
    expect(p.rows.map(problems)).toEqual([
      ['patDue: "09/30/2027" looks like the month first. Put it as day, month and year, like 30/09/2027.'],
      ['patDue: Row 2 writes its date month first, so "03/04/2027" could be either. Write the month as a word, like 30 Sep 2027.'],
      [],
      ['number: "#N/A" is the spreadsheet\'s error where a formula went wrong. Put in what it should say, or skip the row.'],
      ['null: "Total" looks like a row of totals, not kit. Skip it.'],
    ])
    // Skipped, the month-first row still says how the list writes its dates.
    const skipped = previewStockList(
      p.rows.map((r) => ({ row: r.row, cells: r.cells, skip: r.row === 2 })),
      NOTHING,
      MAKE
    )
    expect(skipped.rows[1]!.problems).toHaveLength(1)
    // Written the Irish way throughout, the same day is read day first.
    expect(said('Item,Serial,PAT due\nMic,M2,03/04/2027').rows[0]).toMatchObject({ problems: [], facts: '1 item · Other · PAT due 3 Apr 2027' })
  })

  it('names a case by its number or by a product holding other kit with one item, and marks one that could be several', () => {
    const p = said(
      [
        'Item,Qty,Asset number,Location,Case',
        'Rack,1,,Bay A,',
        'Amp,2,"A1, A2",,Rack',
        'Trunk,2,,Bay B,',
        'Cable,10,,,Trunk',
        'Mic,4,,,Mic case 3',
        'Desk,1,SH-000045,Bay C,',
        'Talkback,1,,,SH-000045',
      ].join('\n')
    )
    expect(p.rows.map((r) => r.where)).toEqual([
      'At Bay A (new place)',
      'In Rack',
      'At Bay B (new place)',
      '',
      'In Mic case 3 (new case)',
      'At Bay C (new place)',
      'In SH-000045 (Desk)',
    ])
    expect(p.rows.map(problems)).toEqual([[], [], [], ["case: There are 2 × Trunk. Put the case's number in the Case column, such as SH-000123."], [], [], []])
    expect(p.cases).toEqual(['Mic case 3'])
    // A case named by its number makes its product one that holds other kit; one named by nothing here is made, with one item.
    expect(p.plan.products.find((x) => x.name === 'Desk')).toMatchObject({ isCase: true, tracking: 'serialised' })
    expect(p.plan.products.find((x) => x.name === 'Mic case 3')).toMatchObject({ isCase: true, category: 'Cases' })
    expect(p.plan.items.filter((i) => i.key.startsWith('case:'))).toMatchObject([{ model: { key: 'product:mic case 3' }, number: null, isCase: true }])
    // Unticked, the case to make is a problem the tick solves.
    const unticked = said('Item,Qty,Case\nMic,4,Mic case 3', NOTHING, { make: false, defaultPlace: '' })
    expect(unticked.rows[0]!.problems).toEqual([
      { field: 'case', text: "Mic case 3 isn't a case here yet. Tick “Make the places and cases this list names”, or fix the case.", tick: true },
    ])
    // Nothing goes inside itself.
    expect(problems(said('Item,Qty,Location,Case\nRack,1,Bay A,Rack').rows[0]!)).toEqual(["case: A case can't go inside itself."])
  })
})

describe('a case', () => {
  const desk: KnownStock = {
    ...NOTHING,
    products: [{ id: 'desk', name: 'Mixer desk', tracking: 'serialised', isCase: false, valueCents: null, patMonths: null, notes: '', mistake: false }],
    items: [{ id: 'd1', modelId: 'desk', number: 'SH-000001', formerNumbers: [], oldNumber: '', serial: '', placeId: null, caseId: null, status: 'active', retiredReason: null, patDue: null, notes: '' }],
  }

  // Proves a case named by a product here that holds nothing is a problem in the preview, rather than a refusal once the office brings the rows in.
  it('is never a product here that holds nothing, whether it has an item or none', () => {
    for (const known of [desk, { ...desk, items: [] }])
      expect(problems(said('Item,Qty,Case\nXLR,4,Mixer desk', known).rows[0]!)).toEqual([
        "case: Mixer desk doesn't hold other kit. Mark it as holding other kit on its page first, or fix the case.",
      ])
    // The list making it one is another matter: its own rows say so, and the preview with them.
    expect(said('Item,Qty,Case,Location\nMixer desk,1,,Bay A\nXLR,4,Mixer desk,', desk).rows.map((r) => r.does)).toEqual([
      ['Updates Mixer desk: holds other kit'],
      ['New product, counted', 'Counts 4 in SH-000001 (Mixer desk)'],
    ])
  })

  // Proves a case product numbered on one row, and named as a case by that number, still makes the items another row counts.
  it('named by a number on one row is counted on another as items too', () => {
    const p = said('Item,Qty,Asset number,Case,Location\nRack,1,SH-000020,,Bay A\nAmp,1,SH-000010,SH-000020,\nRack,2,,,Bay B')
    expect(p.rows.map((r) => r.does)).toEqual([
      ['New product, numbered, holds other kit', '1 new item: keeps SH-000020'],
      ['New product, numbered', '1 new item: keeps SH-000010'],
      ['2 new items, numbered when brought in'],
    ])
    expect(p.counts.items).toBe(4)
  })
})

describe('against what’s here', () => {
  const known: KnownStock = {
    products: [
      { id: 'k12', name: 'Corvo K12', tracking: 'serialised', isCase: false, valueCents: 125000, patMonths: 12, notes: '', mistake: false },
      { id: 'xlr', name: 'XLR 10 m', tracking: 'bulk', isCase: false, valueCents: null, patMonths: null, notes: '', mistake: false },
    ],
    items: [
      { id: 'a1', modelId: 'k12', number: 'SH-000005', formerNumbers: ['SH-000002'], oldNumber: 'A-0101', serial: 'CK1', placeId: 'bay', caseId: null, status: 'active', retiredReason: null, patDue: null, notes: '' },
      { id: 'a2', modelId: 'k12', number: 'SH-000006', formerNumbers: [], oldNumber: '', serial: 'CK2', placeId: 'bay', caseId: null, status: 'retired', retiredReason: 'sold', patDue: null, notes: '' },
    ],
    places: [{ id: 'bay', name: 'Bay A1' }],
    counts: [{ modelId: 'xlr', placeId: 'bay', caseId: null, qty: 20 }],
  }
  const rows = (lines: string[]): StockListRow[] => rowsOf(['Item,Qty,Serial,Asset number,Location', ...lines].join('\n'))

  it('matches an item by its Session Hire number, its old number or its serial, and says what changes', () => {
    // Each way of naming the one speaker, capitals and spacing aside, finds it as the list says.
    for (const line of ['corvo  k12,1,,SH-000005,Bay A1', 'Corvo K12,1,,a-0101,bay a1', 'Corvo K12,1,CK1,,Bay A1', 'XLR 10 m,20,,,Bay A1'])
      expect(previewStockList(rows([line]), known, MAKE).rows[0]!.does, line).toEqual([UNCHANGED])
    // All of it here already: nothing to send.
    expect(bringInStockLabel(previewStockList(rows(['Corvo K12,1,CK1,,Bay A1', 'XLR 10 m,20,,,Bay A1']), known, MAKE).counts)).toBe('Nothing to bring in: it’s all here')
    const p = previewStockList(rows(['Corvo K12,1,,SH-000005,', 'Corvo K12,1,CK1,,Bay B2', 'XLR 10 m,20,,,Bay A1', 'XLR 10 m,18,,,BAY A1 ']), known, MAKE)
    // Named twice, however each row names it, it's on one row too many; two counts of one product at one place likewise.
    expect(p.rows.map(problems)).toEqual([
      [],
      ['serial: SH-000005 (Corvo K12) is on row 2 too.'],
      [],
      ['null: Row 4 counts XLR 10 m at Bay A1 too. Add them up into one row, or skip one.'],
    ])
    // A later list that has it somewhere else moves it, with a new serial when it says one.
    const moved = previewStockList(rows(['Corvo K12,1,CK1-B,A-0101,Bay B2']), known, MAKE)
    expect(moved.rows[0]!.does).toEqual(['SH-000005: moves to Bay B2 (new place) and serial to CK1-B'])
    expect(moved.plan.changes).toEqual([{ row: 2, id: 'a1', where: { place: { key: 'place:bay b2' }, case: null }, serial: 'CK1-B' }])
  })

  it('marks a number used before, an item of another product, or one retired, and never guesses', () => {
    const p = previewStockList(rows(['Corvo K12,1,,SH-000002,', 'Corvo V8,1,,SH-000005,', 'Corvo K12,1,CK2,,', 'XLR 10 m,1,X9,,Bay A1']), known, MAKE)
    expect(p.rows.map(problems)).toEqual([
      ["number: SH-000002 was SH-000005 (Corvo K12)'s number before, and a number is never used twice. Use the number it has now."],
      ['product: SH-000005 (Corvo K12) is already here as Corvo K12, not Corvo V8. Fix the product, or skip the row.'],
      ['null: SH-000006 (Corvo K12) is retired (sold). Bring it back first, or skip the row.'],
      [],
    ])
    // Numbers for a counted product make it numbered, and the item labelled where some are counted takes one off the count.
    expect(p.rows[3]!.does).toEqual(['Updates XLR 10 m: numbered', '1 new item, numbered when brought in', 'Takes 1 off the 20 counted at Bay A1'])
    expect(p.plan.items.at(-1)).toMatchObject({ fromCount: true, serial: 'X9' })
  })
})
