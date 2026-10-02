import { describe, expect, it } from 'vitest'
import { commandSchemas, type Mutation } from '../src/commands.ts'
import type { Fault } from '../src/faults.ts'
import type { LabelRun } from '../src/labels.ts'
import { stillOutReason, stockId, type Asset, type Model, type Place } from '../src/stock.ts'
import { faultsView } from '../src/sync/faults-view.ts'
import type { JobsView } from '../src/sync/jobs-view.ts'
import { labelsView } from '../src/sync/labels-view.ts'
import { warehouseView } from '../src/sync/stock-view.ts'

/**
 * Things made by mistake can be taken back (audit finding 19), as a device
 * shows it before the server has answered: a product marked as added by
 * mistake leaves every list with its items and counts, though a scan of
 * one of its labels still finds the item to say so; a run of labels
 * cancelled leaves the list, and its numbers are never offered again.
 */

const model = (id: string, name: string, extra: Partial<Model> = {}): Model => ({
  id,
  name,
  department: 'audio',
  category: 'Speakers',
  tracking: 'serialised',
  isCase: false,
  valueCents: null,
  notes: '',
  patMonths: null,
  liftingMonths: null,
  mistake: false,
  ...extra,
})
const asset = (id: string, modelId: string, number: string, placeId: string | null = 'bay'): Asset => ({
  id,
  modelId,
  number,
  formerNumbers: [],
  serial: '',
  placeId,
  caseId: null,
  status: 'active',
  retiredReason: null,
  retiredNote: null,
  notes: '',
})
const bay: Place = { id: 'bay', name: 'Bay A3', notes: '' }
const table = <T extends { id: string }>(rows: readonly T[]): Record<string, T> => Object.fromEntries(rows.map((r) => [r.id, r]))
const waiting = (name: Mutation['name'], args: Mutation['args']): Mutation => ({ id: `m-${name}`, name, args, createdAt: '2026-10-01T09:00:00.000Z' })
const noJobs = { jobs: [] } as unknown as JobsView

describe('a product added by mistake', () => {
  const entities = {
    model: table([model('y10p', 'd&b Y10P'), model('xlr', 'XLR 10 m', { tracking: 'bulk', category: 'Cables' })]),
    asset: table([asset('a1', 'y10p', 'SH-000001'), asset('a2', 'y10p', 'SH-000002'), asset('a3', 'y10p', 'SH-000003')]),
    place: table([bay]),
    stock: table([{ id: stockId('y10p', { placeId: 'bay', caseId: null }), modelId: 'y10p', placeId: 'bay', caseId: null, qty: 4 }]),
  }

  it('leaves every list with its items and counts while the change waits, and still answers to its labels', () => {
    // Laid over the device's copy at once, as the server will leave it, so nothing of it is picked or counted meanwhile.
    const before = warehouseView(entities, [], 0)
    expect(before.models.map((m) => [m.name, m.total])).toEqual([['d&b Y10P', 7], ['XLR 10 m', 0]])
    expect(before.categories).toEqual(['Cables', 'Speakers'])

    const w = warehouseView(entities, [waiting('model.mistake', { id: 'y10p' })], 0)
    expect(w.models.map((m) => m.name)).toEqual(['XLR 10 m'])
    expect(w.mistakes.get('y10p')).toMatchObject({ name: 'd&b Y10P', mistake: true, pending: true, items: [], retired: [], counted: [], total: 0 })
    expect(w.categories).toEqual(['Cables'])
    expect(w.places[0]).toMatchObject({ name: 'Bay A3', itemTotal: 0, countedTotal: 0, items: [], counted: [] })
    // Its labels still find it, so scanning one can say it was a mistake.
    expect(w.byNumber.get('SH-000002')).toMatchObject({ id: 'a2', status: 'retired', retiredReason: 'mistake', placeId: null, pending: true })
    expect(w.byNumber.get('SH-000002')?.model).toMatchObject({ name: 'd&b Y10P', mistake: true })
  })

  it('as the server leaves it, and an item retired as a mistake on its own is out of the retired list too', () => {
    // Only its number finds one added by mistake; other retired items stay listed with their products.
    const w = warehouseView(
      {
        ...entities,
        model: table([model('y10p', 'd&b Y10P', { mistake: true }), model('xlr', 'XLR 10 m', { tracking: 'bulk' })]),
        asset: table([
          { ...asset('a1', 'y10p', 'SH-000001', null), status: 'retired', retiredReason: 'mistake' },
          { ...asset('a2', 'xlr', 'SH-000002', null), status: 'retired', retiredReason: 'mistake' },
          { ...asset('a3', 'xlr', 'SH-000003', null), status: 'retired', retiredReason: 'lost' },
        ]),
        stock: {},
      },
      [],
      0
    )
    expect(w.models.map((m) => m.name)).toEqual(['XLR 10 m'])
    expect(w.mistakes.has('y10p')).toBe(true)
    expect(w.models[0]!.retired.map((a) => a.number)).toEqual(['SH-000003'])
    expect(w.byNumber.get('SH-000002')?.retiredReason).toBe('mistake')
  })

  it('reads a product saved before products could be marked as not a mistake', () => {
    // A device's copy from before audit finding 19 has no flag on its products, and they stay in every list.
    const old = Object.values(entities.model).map(({ mistake: _, ...m }) => m) as unknown as Model[]
    const w = warehouseView({ ...entities, model: table(old) }, [], 0)
    expect(w.models.map((m) => [m.name, m.mistake])).toEqual([['d&b Y10P', false], ['XLR 10 m', false]])
    expect(w.mistakes.size).toBe(0)
  })

  it('takes its faults out of the repair list with it, though the pick lists still count them', () => {
    // Off the repair list and its pages; a report of its kit missing still ends that kit's time out with a job.
    const faults: Fault[] = [
      { id: 'f1', kind: 'damaged', assetId: 'a1', modelId: 'y10p', qty: 1, projectId: null, usable: false, note: 'Blown', repair: '', at: '2026-09-30T10:00:00.000Z', outcome: null, closedAt: null },
      { id: 'f2', kind: 'damaged', assetId: null, modelId: 'xlr', qty: 2, projectId: null, usable: false, note: 'Cut', repair: '', at: '2026-09-30T11:00:00.000Z', outcome: null, closedAt: null },
    ]
    const outbox = [waiting('model.mistake', { id: 'y10p' })]
    const w = warehouseView(entities, outbox, 0)
    const f = faultsView({ fault: table(faults) }, outbox, 0, noJobs, w)
    expect(f.open.map((x) => x.id)).toEqual(['f2'])
    expect(f.ofAsset('a1')).toEqual([])
    expect(f.all.map((x) => x.id)).toEqual(['f2', 'f1'])
  })

  it('is a command of its own, with an id and nothing else', () => {
    // Nothing else can be sent with it, so a phone can't mark more than the product.
    expect(commandSchemas['model.mistake'].safeParse({ id: 'y10p' }).success).toBe(true)
    expect(commandSchemas['model.mistake'].safeParse({}).success).toBe(false)
  })

  it('is turned down while some of it is out, in the same words on the phone and from the server', () => {
    // One wording for both, naming the job and what's out with it, or the jobs when there are several.
    const out = (what: string, job = 'Nissan launch') => ({ what, job })
    expect(stillOutReason('d&b Y10P', [out('SH-000001')])).toBe('d&b Y10P is out with Nissan launch (SH-000001). Scan it back first.')
    expect(stillOutReason('XLR 10 m', [out('1,200 counted')])).toBe('XLR 10 m is out with Nissan launch (1,200 counted). Scan it back first.')
    expect(stillOutReason('d&b Y10P', [out('SH-000001'), out('SH-000002'), out('SH-000003'), out('4 counted')])).toBe(
      'd&b Y10P is out with Nissan launch (SH-000001, SH-000002 and 2 more). Scan it back first.'
    )
    expect(stillOutReason('d&b Y10P', [out('SH-000001'), out('SH-000002', 'Electric Picnic')])).toBe(
      'd&b Y10P is out with 2 jobs (Electric Picnic, Nissan launch). Scan it back first.'
    )
  })
})

describe('a run of labels cancelled', () => {
  const runs: LabelRun[] = [
    { id: 'roll', first: 1, count: 5, name: 'Roll', notes: '', createdAt: '2026-10-01T08:00:00.000Z', cancelled: false },
    { id: 'tags', first: 6, count: 3, name: 'Tags', notes: '', createdAt: '2026-10-01T09:00:00.000Z', cancelled: false },
  ]
  const w = warehouseView({ model: table([model('y10p', 'd&b Y10P')]), asset: table([asset('a1', 'y10p', 'SH-000002')]) }, [], 0)

  it('leaves the list while the change waits and once the server agrees, and its numbers still count as set aside', () => {
    // Its labels may be printed already, so the next free number never goes back to them.
    const before = labelsView({ labelRun: table(runs) }, [], 0, w)
    expect(before.runs.map((r) => r.name)).toEqual(['Tags', 'Roll'])
    expect(before.next).toBe('SH-000009')

    const waitingNow = labelsView({ labelRun: table(runs) }, [waiting('labels.cancel', { id: 'tags' })], 0, w)
    const agreed = labelsView({ labelRun: table([runs[0]!, { ...runs[1]!, cancelled: true }]) }, [], 0, w)
    for (const after of [waitingNow, agreed]) {
      expect(after.runs.map((r) => r.name)).toEqual(['Roll'])
      expect(after.next).toBe('SH-000009')
      expect(after.runOf('SH-000007')).toBeUndefined()
      expect(after.runOf('SH-000002')?.used).toBe(1)
    }
  })

  it('reads a run saved before runs could be cancelled as not cancelled', () => {
    // A device's copy from before audit finding 19 has no flag on its runs.
    const old = runs.map(({ cancelled: _, ...r }) => r) as unknown as LabelRun[]
    expect(labelsView({ labelRun: table(old) }, [], 0, w).runs.map((r) => r.name)).toEqual(['Tags', 'Roll'])
  })

  it('is a command of its own, with an id and nothing else', () => {
    // A run is named by its id alone; the numbers are the server's to keep.
    expect(commandSchemas['labels.cancel'].safeParse({ id: 'tags' }).success).toBe(true)
    expect(commandSchemas['labels.cancel'].safeParse({ id: '' }).success).toBe(false)
  })
})
