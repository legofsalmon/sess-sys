import { describe, expect, it } from 'vitest'
import { lineCostOf, linesFor, quoteMargin, type QuoteLine } from '../src/quotes.ts'
import type { KitLineView, KitView } from '../src/sync/kit-view.ts'
import { quoteKit, quoteWants } from '../src/sync/quote-kit.ts'
import type { ModelView } from '../src/sync/stock-view.ts'

/**
 * The cost side of a quote (ADR 0089): whether there's enough of each
 * product on the job's days, by the job's kit's rules, leaving the job's
 * own kit out; what each line costs; and what the quote makes.
 */

const job = { id: 'gala', span: { start: '2026-11-10', end: '2026-11-11' }, prepDays: 1, returnDays: 1 }
const other = (projectId: string, own: number, hold: 'held' | 'pencilled', start: string, end: string) =>
  ({ projectId, own, hold, held: { start, end }, job: { name: projectId } }) as unknown as KitLineView
const kitOf = (lines: KitLineView[]) => ({ byModel: new Map([['y10', lines]]) }) as unknown as KitView
const models = (m: Partial<ModelView> = {}) => (id: string) => (id === 'y10' ? ({ id, total: 10, racked: 0, dryHire: false, ...m } as ModelView) : undefined)
const inputs = (lines: KitLineView[], m?: Partial<ModelView>, unusable = 0) => ({ kit: kitOf(lines), models: models(m), unusable: () => unusable, lateOut: () => 0 })

describe('enough kit for a quote', () => {
  it("is short by what other jobs hold on the job's days, with the days to get it ready and back, and not its own kit", () => {
    const lines = [other('wedding', 6, 'held', '2026-11-09', '2026-11-09'), other('gala', 10, 'held', '2026-11-09', '2026-11-12'), other('expo', 2, 'pencilled', '2026-11-12', '2026-11-12')]
    const r = quoteKit(job, new Map([['y10', 8]]), '2026-11-01', inputs(lines)).get('y10')!
    expect(r).toMatchObject({ wanted: 8, owned: 10, short: 4, shortDay: '2026-11-09', ifPencilled: 0 })
    expect(r.others).toEqual([{ jobId: 'wedding', name: 'wedding', qty: 6, held: true }])
  })

  it("says what pencilled jobs would make it short by, takes off what's not fit to use, and doesn't check dry hire or past days", () => {
    const lines = [other('expo', 4, 'pencilled', '2026-11-11', '2026-11-11')]
    expect(quoteKit(job, new Map([['y10', 7]]), '2026-11-01', inputs(lines, {}, 1)).get('y10')).toMatchObject({ owned: 9, short: 0, ifPencilled: 2, pencilledDay: '2026-11-11' })
    expect(quoteKit(job, new Map([['y10', 70]]), '2026-11-01', inputs([], { dryHire: true })).size).toBe(0)
    expect(quoteKit(job, new Map([['y10', 70]]), '2026-12-01', inputs([])).size).toBe(0)
    expect(quoteKit({ ...job, span: undefined }, new Map([['y10', 70]]), '2026-11-01', inputs([])).size).toBe(0)
  })

  it("wants each kit line's own, less those hired in, and a package's pieces for each one quoted", () => {
    const lines = [
      { kind: 'kit', modelId: 'y10', qty: 8, subhireQty: 2 },
      { kind: 'kit', modelId: 'y10', qty: 2 },
      { kind: 'kit', modelId: null, packageId: 'mics', qty: 3 },
      { kind: 'crew', qty: 4 },
    ]
    expect(quoteWants(lines, (id) => (id === 'mics' ? [{ modelId: 'sm58', qty: 4 }] : undefined))).toEqual(new Map([['y10', 8], ['sm58', 12]]))
  })
})

const l = (x: Partial<QuoteLine>): QuoteLine => ({ id: 'l', kind: 'kit', what: 'Y10', ref: null, group: 'Audio', qty: 2, days: 3, unitCents: 5000, vat: '23', ...x })

describe("what a quote's lines cost", () => {
  it('is what is typed, crew at their booked rate, our own kit nothing, and unknown for kit hired in or anything else with none typed', () => {
    expect(lineCostOf(l({ costCents: 12000 }))).toBe(12000)
    expect(lineCostOf(l({ kind: 'crew' }), 25000)).toBe(150000)
    expect(lineCostOf(l({ kind: 'crew' }))).toBeUndefined()
    expect(lineCostOf(l({}))).toBe(0)
    expect(lineCostOf(l({ subhireQty: 1 }))).toBeUndefined()
    expect(lineCostOf(l({ kind: 'other', per: 'once' }))).toBeUndefined()
    expect(lineCostOf(l({ kind: 'other', extra: 'subsistence', qty: 4, days: 2, unitCents: 3500 }))).toBe(28000)
  })

  it("makes the quote's margin from what it's charged before VAT, leaving lines with no cost known out and counting them", () => {
    expect(quoteMargin(100000, [20000, 0, undefined])).toEqual({ cost: 20000, margin: 80000, pct: 80, unknown: 1 })
    expect(quoteMargin(0, [5000])).toEqual({ cost: 5000, margin: -5000, pct: null, unknown: 0 })
  })

  it("starts a line with the job's kit hired in, and who from", () => {
    const [k] = linesFor([{ id: 'k', modelId: 'y10', name: 'Y10', group: 'Audio', qty: 4, days: 2, subhireQty: 6, supplier: ' Hire Co ' }], [], { product: () => 100, role: () => undefined }, () => 'n')
    expect(k).toMatchObject({ qty: 4, subhireQty: 4, supplier: 'Hire Co' })
  })
})
