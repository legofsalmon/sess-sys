import { describe, expect, it } from 'vitest'
import { countCommandSchemas, countSetTo, countSummaryWords, type Count, type CountDraft, type CountItem } from '../src/counts.ts'
import type { Fault } from '../src/faults.ts'
import { deviceItemLog, itemLogWords } from '../src/item-log.ts'
import type { Movement } from '../src/moves.ts'
import type { Asset, Model, Place, Stock } from '../src/stock.ts'
import { emptySnapshot, MemoryStorage, SyncClient, type Transport } from '../src/sync/client.ts'
import { compareCount, keptWithin } from '../src/sync/counts-view.ts'

/**
 * Counts (ADR 0030), as each phone works them out with no signal: what's
 * expected at a place or in a case, what the count found against it (kit
 * out with a job, already missing or in repair never said to be newly
 * missing), what to set counted kit to so a count taken while some are out
 * never shrinks what's owned, what each count said of an item for its log,
 * and which places to count this week.
 */

const never: Transport = {
  push: () => Promise.reject(new Error('No signal')),
  pull: () => Promise.reject(new Error('No signal')),
}
const model = (id: string, name: string, extra: Partial<Model> = {}): Model => ({
  id,
  name,
  department: 'audio',
  category: '',
  tracking: 'serialised',
  isCase: false,
  valueCents: null,
  notes: '',
  patMonths: null,
  liftingMonths: null,
  mistake: false,
  ...extra,
})
const asset = (id: string, modelId: string, number: string, where: Partial<Asset> = {}): Asset => ({
  id,
  modelId,
  number,
  formerNumbers: [],
  serial: '',
  oldNumber: '',
  patDue: null,
  placeId: null,
  caseId: null,
  status: 'active',
  retiredReason: null,
  retiredNote: null,
  notes: '',
  ...where,
})
const place = (id: string, name: string): Place => ({ id, name, notes: '' })
const stock = (modelId: string, where: { placeId?: string; caseId?: string }, qty: number): Stock => ({
  id: `${modelId}@${where.placeId ? `p:${where.placeId}` : `c:${where.caseId}`}`,
  modelId,
  placeId: where.placeId ?? null,
  caseId: where.caseId ?? null,
  qty,
})
const fault = (id: string, kind: Fault['kind'], what: { assetId?: string; modelId: string; qty?: number }, extra: Partial<Fault> = {}): Fault => ({
  id,
  kind,
  assetId: what.assetId ?? null,
  modelId: what.modelId,
  qty: what.qty ?? 1,
  projectId: null,
  usable: false,
  note: '',
  repair: '',
  at: '2026-10-01T09:00:00.000Z',
  outcome: null,
  closedAt: null,
  ...extra,
})
const move = (id: string, direction: Movement['direction'], what: { assetId?: string; modelId: string; qty?: number }): Movement => ({
  id,
  projectId: 'nissan',
  direction,
  assetId: what.assetId ?? null,
  modelId: what.modelId,
  qty: what.qty ?? 1,
  at: '2026-10-02T09:00:00.000Z',
})
const table = <T extends { id: string }>(rows: readonly T[]): Record<string, T> => Object.fromEntries(rows.map((r) => [r.id, r]))
const draft = (where: { placeId?: string; caseId?: string }, scanned: string[], more: Partial<CountDraft> = {}): CountDraft => ({
  id: 'count1',
  placeId: where.placeId ?? null,
  caseId: where.caseId ?? null,
  startedAt: '2026-10-07T09:00:00.000Z',
  by: null,
  scanned,
  unknown: [],
  counted: {},
  added: [],
  ...more,
})

/**
 * A warehouse on a Wednesday: Bay A3 with speakers in every state, an amp
 * rack holding two amps, and counted XLRs and mics; Bay B1 and the van
 * elsewhere; a job with kit out.
 */
async function phone(extra: { counts?: Count[]; places?: Place[]; assets?: Asset[]; faults?: Fault[] } = {}) {
  const storage = new MemoryStorage()
  const s = emptySnapshot('phone')
  s.cursor = 50
  s.entities.model = table([
    model('y10p', 'd&b Y10P'),
    model('d20', 'd&b D20'),
    model('rack', 'Amp rack', { isCase: true }),
    model('xlr', 'XLR 10 m', { tracking: 'bulk' }),
    model('sm58', 'Shure SM58', { tracking: 'bulk' }),
    model('deck', 'Stage deck', { tracking: 'bulk' }),
  ])
  s.entities.place = table([place('a3', 'Bay A3'), place('b1', 'Bay B1'), place('van', 'Van 1'), ...(extra.places ?? [])])
  s.entities.asset = table([
    asset('found', 'y10p', 'SH-000001', { placeId: 'a3' }),
    asset('lost', 'y10p', 'SH-000002', { placeId: 'a3' }),
    asset('gone-out', 'y10p', 'SH-000003', { placeId: 'a3' }),
    asset('was-missing', 'y10p', 'SH-000004', { placeId: 'a3' }),
    asset('blown', 'y10p', 'SH-000005', { placeId: 'a3' }),
    asset('dented', 'y10p', 'SH-000006', { placeId: 'a3' }),
    asset('stray', 'y10p', 'SH-000007', { placeId: 'b1' }),
    asset('sold', 'y10p', 'SH-000008', { status: 'retired', retiredReason: 'sold' }),
    asset('rack1', 'rack', 'SH-000010', { placeId: 'a3' }),
    asset('amp1', 'd20', 'SH-000011', { caseId: 'rack1' }),
    asset('amp2', 'd20', 'SH-000012', { caseId: 'rack1' }),
    asset('van-out', 'y10p', 'SH-000013', { placeId: 'van' }),
    asset('van-missing', 'y10p', 'SH-000014', { placeId: 'van' }),
    asset('unplaced', 'y10p', 'SH-000015'),
    ...(extra.assets ?? []),
  ])
  s.entities.stock = table([stock('xlr', { placeId: 'a3' }, 120), stock('sm58', { placeId: 'a3' }, 10), stock('deck', { placeId: 'a3' }, 30), stock('xlr', { caseId: 'rack1' }, 4)])
  s.entities.project = { nissan: { id: 'nissan', name: 'Nissan launch', clientId: null, venueId: null, status: 'confirmed', notes: '' } }
  s.entities.movement = table([
    move('m1', 'out', { assetId: 'gone-out', modelId: 'y10p' }),
    move('m2', 'out', { assetId: 'van-out', modelId: 'y10p' }),
    // 20 XLRs counted out to the job; they stay in Bay A3's count while they're away.
    move('m3', 'out', { modelId: 'xlr', qty: 20 }),
  ])
  s.entities.fault = table([
    fault('f1', 'missing', { assetId: 'was-missing', modelId: 'y10p' }),
    fault('f2', 'damaged', { assetId: 'blown', modelId: 'y10p' }, { note: 'Blown driver' }),
    fault('f3', 'damaged', { assetId: 'dented', modelId: 'y10p' }, { usable: true, note: 'Dented grille' }),
    fault('f4', 'missing', { assetId: 'van-missing', modelId: 'y10p' }),
    // Two mics reported missing, not from a job: away too, as far as a count of mics goes.
    fault('f5', 'missing', { modelId: 'sm58', qty: 2 }),
    ...(extra.faults ?? []),
  ])
  s.entities.count = table(extra.counts ?? [])
  await storage.save(s)
  return new SyncClient({ storage, transport: never, clientId: 'phone', now: () => new Date('2026-10-07T12:00:00Z') }).open()
}

const said = (items: CountItem[]) => Object.fromEntries(items.map((i) => [i.assetId, [i.said, i.scanned]]))

describe('the comparison', () => {
  it('says what was found and not found, and kit out with a job, already missing or in repair as that, never as newly missing', async () => {
    // Proves: of what's kept at Bay A3, the scanned speaker is found; the one not scanned is not found, and so is one
    // damaged but fit to go out; the one out with Nissan launch is out, the one already reported missing is missing,
    // and the one in repair is in repair, none of them newly missing. The tally counts only what's expected on the
    // shelf: out and missing kit isn't, kit in repair is.
    const view = (await phone()).view()
    const r = compareCount(view, draft({ placeId: 'a3' }, ['found', 'rack1']))
    expect(said(r.items)).toEqual({
      found: ['found', true],
      lost: ['not-found', false],
      'gone-out': ['out', false],
      'was-missing': ['missing', false],
      blown: ['repair', false],
      dented: ['not-found', false],
      rack1: ['found', true],
    })
    expect(r.items.find((i) => i.assetId === 'gone-out')).toMatchObject({ projectId: 'nissan' })
    expect(r.summary).toMatchObject({ expected: 5, found: 2, notFound: 2, elsewhere: 0, unexpected: 0 })
  })

  it('says where an item scanned here is kept, and what scanned kit was not expected', async () => {
    // Proves: a speaker kept at Bay B1 is in the wrong place, with where it was; one not placed yet is too, with nowhere;
    // a sold one is retired; one kept in the van and out with the job is out, and one in the van reported missing is
    // missing, each with where it's kept, so a fix can bring it here; an amp in the rack kept here is in its case, and
    // the rack found through it; and a number no item has is kept as scanned. Retired, missing, out and unknown are the
    // not expected.
    const view = (await phone()).view()
    const r = compareCount(view, draft({ placeId: 'a3' }, ['stray', 'unplaced', 'sold', 'van-out', 'van-missing', 'amp1', 'found'], { unknown: ['SH-000999'] }))
    const by = Object.fromEntries(r.items.map((i) => [i.assetId, i]))
    expect(by.stray).toEqual({ assetId: 'stray', said: 'elsewhere', scanned: true, placeId: 'b1', caseId: null })
    expect(by.unplaced).toEqual({ assetId: 'unplaced', said: 'elsewhere', scanned: true, placeId: null, caseId: null })
    expect(by.sold).toEqual({ assetId: 'sold', said: 'retired', scanned: true })
    expect(by['van-out']).toEqual({ assetId: 'van-out', said: 'out', scanned: true, placeId: 'van', caseId: null, projectId: 'nissan' })
    expect(by['van-missing']).toEqual({ assetId: 'van-missing', said: 'missing', scanned: true, placeId: 'van', caseId: null })
    expect(by.amp1).toEqual({ assetId: 'amp1', said: 'in-case', scanned: true, placeId: null, caseId: 'rack1' })
    expect(r.unknown).toEqual(['SH-000999'])
    expect(r.summary).toMatchObject({ elsewhere: 2, unexpected: 4, found: 2 })
    // In number order, the same on every phone.
    expect(r.items.map((i) => i.assetId).slice(0, 3)).toEqual(['found', 'lost', 'gone-out'])
  })

  it('checks a case is at its place, and what is in it when the case itself is counted', async () => {
    // Proves: counting the place expects the rack, not the amps in it; counting the rack expects its amps and its four
    // XLRs, and an amp found is found there.
    const view = (await phone()).view()
    const atPlace = compareCount(view, draft({ placeId: 'a3' }, []))
    expect(atPlace.items.map((i) => i.assetId)).toContain('rack1')
    expect(atPlace.items.map((i) => i.assetId)).not.toContain('amp1')
    const inRack = compareCount(view, draft({ caseId: 'rack1' }, ['amp2'], { counted: { xlr: 4 } }))
    expect(said(inRack.items)).toEqual({ amp1: ['not-found', false], amp2: ['found', true] })
    expect(inRack.products).toEqual([{ modelId: 'xlr', recorded: 4, counted: 4, away: 20 }])
    expect(inRack.summary).toMatchObject({ expected: 2, found: 1, notFound: 1, short: 0, over: 0 })
  })

  it('finds a case by what is in it, and never counts the case being counted, or one it is in, as part of it', async () => {
    // Proves: counting Bay A3, an amp scanned two cases deep is in its case, and the rack it's in is found through it,
    // label or not, so it's never said to be not found (reporting a case missing takes what's in it along). An amp in
    // the rack reported missing and scanned is missing, and kept within Bay A3, so marking it found leaves it in its
    // case. Counting the inner rack, its own label and the rack it's in are what hold the count: neither is in the
    // wrong place, nor offered a move into itself.
    const view = (
      await phone({
        assets: [asset('rack2', 'rack', 'SH-000016', { caseId: 'rack1' }), asset('amp3', 'd20', 'SH-000017', { caseId: 'rack2' })],
        faults: [fault('f6', 'missing', { assetId: 'amp2', modelId: 'd20' })],
      })
    ).view()
    const place = compareCount(view, draft({ placeId: 'a3' }, ['amp3', 'amp2']))
    expect(place.items.filter((i) => i.assetId.startsWith('rack') || i.assetId.startsWith('amp'))).toEqual([
      { assetId: 'rack1', said: 'found', scanned: true },
      { assetId: 'amp2', said: 'missing', scanned: true, placeId: null, caseId: 'rack1' },
      { assetId: 'amp3', said: 'in-case', scanned: true, placeId: null, caseId: 'rack2' },
    ])
    expect(keptWithin(view.warehouse.assets.get('amp2')!, { placeId: 'a3', caseId: null })).toBe(true)
    expect(keptWithin(view.warehouse.assets.get('stray')!, { placeId: 'a3', caseId: null })).toBe(false)

    const inner = compareCount(view, draft({ caseId: 'rack2' }, ['rack2', 'rack1', 'amp3']))
    expect(inner.items).toEqual([{ assetId: 'amp3', said: 'found', scanned: true }])
    expect(inner.summary).toMatchObject({ expected: 1, found: 1, elsewhere: 0, unexpected: 0 })
  })

  it('keeps any code no item has so that the count can always be finished', async () => {
    // Proves: a maker's QR code holding a long web address, and a barcode with a separator in it, are kept cut short
    // and plain, and a label typed two ways is kept once, so the record passes its own checks.
    const view = (await phone()).view()
    const long = `https://www.example.com/products/loudspeakers/${'y10p-'.repeat(30)}`
    const r = compareCount(view, draft({ placeId: 'a3' }, [], { unknown: [long, '01\u001d0123', 'sh 999', 'SH-000999'] }))
    expect(r.unknown).toEqual([`${long.slice(0, 99)}…`, '01 0123', 'SH-000999'])
    expect(r.summary.unexpected).toBe(3)
    const sent = { id: 'c1', startedAt: '2026-10-07T09:00:00.000Z', finishedAt: '2026-10-07T09:30:00.000Z', by: null, ...r }
    expect(countCommandSchemas['count.record'].safeParse(sent).success).toBe(true)
  })

  it('compares counted kit short and over, and says which products were not counted', async () => {
    // Proves: decks 30 recorded and 27 counted are short, set to 27; mics 10 recorded, 2 reported missing, and 14
    // counted are over, set to 14; a product added as there, not expected, is over by what was counted; one added and
    // left blank says nothing; and XLRs left blank are not counted. Products are in name order.
    const view = (await phone()).view()
    const r = compareCount(view, draft({ placeId: 'a3' }, [], { counted: { deck: 27, sm58: 14, y10p: 3 }, added: ['y10p', 'd20'] }))
    expect(r.products).toEqual([
      { modelId: 'y10p', recorded: 0, counted: 3, away: 0 },
      { modelId: 'sm58', recorded: 10, counted: 14, away: 2 },
      { modelId: 'deck', recorded: 30, counted: 27, away: 0 },
      { modelId: 'xlr', recorded: 120, counted: null, away: 20 },
    ])
    expect(r.products.map(countSetTo)).toEqual([3, 14, 27, null])
    expect(r.summary).toMatchObject({ short: 1, over: 2, uncounted: 1 })
  })

  it('never lowers what the warehouse owns because counted kit is out on a job', async () => {
    // Proves: with 20 of 120 XLRs out with Nissan launch, 95 on the shelf is five short (set to 115, not 95); 100 fits,
    // and so does 105, since only once the 20 are back can anyone tell; 130 is over. Two mics reported missing are
    // away the same way. And kept at two places, the 20 out are taken to be from the one counted, as far as its record
    // allows, so neither count loses them.
    const view = (await phone()).view()
    const xlr = (n: number) => compareCount(view, draft({ placeId: 'a3' }, [], { counted: { xlr: n } })).products.find((p) => p.modelId === 'xlr')!
    expect(xlr(95)).toEqual({ modelId: 'xlr', recorded: 120, counted: 95, away: 20 })
    expect([95, 100, 105, 130].map((n) => countSetTo(xlr(n)))).toEqual([115, 120, 120, 130])
    expect(countSetTo({ recorded: 10, counted: 7, away: 2 })).toBe(9)
    // Bay A3 holds 120 and the van 30, with 20 out: whichever is counted, the 20 can be its own.
    expect(countSetTo({ recorded: 120, counted: 120, away: 20 })).toBe(120)
    expect(countSetTo({ recorded: 30, counted: 10, away: 20 })).toBe(30)
    expect(countSetTo({ recorded: 30, counted: 5, away: 20 })).toBe(25)
    expect(countSetTo({ recorded: 30, counted: null, away: 20 })).toBeNull()
  })
})

describe('the summary', () => {
  it('says what a count found in a line', () => {
    // Proves: the words the history, the place's page and the Counts card all use.
    const none = { notFound: 0, elsewhere: 0, unexpected: 0, uncounted: 0, short: 0, over: 0 }
    expect(countSummaryWords({ expected: 10, found: 9, ...none, notFound: 1, short: 1 })).toBe('9 of 10 found, 1 not found, 1 count short')
    expect(countSummaryWords({ expected: 4, found: 4, ...none })).toBe('All 4 found, as recorded')
    // One expected and not scanned, but in repair: said as that, never as not found.
    expect(countSummaryWords({ expected: 4, found: 3, ...none })).toBe('3 of 4 found, 1 in repair, as recorded')
    expect(countSummaryWords({ expected: 0, found: 0, ...none })).toBe('All as recorded')
    expect(countSummaryWords({ expected: 0, found: 0, ...none, elsewhere: 2, unexpected: 1, over: 2, uncounted: 1 })).toBe(
      '2 in the wrong place, 1 not expected, 2 counts over, 1 product not counted'
    )
  })
})

const counted = (id: string, placeId: string, day: string, items: CountItem[] = []): Count => ({
  id,
  placeId,
  caseId: null,
  startedAt: `${day}T09:00:00.000Z`,
  finishedAt: `${day}T09:30:00.000Z`,
  by: null,
  items,
  unknown: [],
  products: [],
  summary: { expected: 0, found: 0, notFound: 0, elsewhere: 0, unexpected: 0, uncounted: 0, short: 0, over: 0 },
})

describe('counts on the phone', () => {
  it('says when each place was last counted, and what a count said of an item for its log, with no line for kit away', async () => {
    // Proves: a place's counts newest first; the item log says found, not found, and found though kept elsewhere, keyed by
    // the count as the server keys it; a speaker out with the job, away and not scanned, gets no line; and a count still
    // on its way shows as waiting.
    const items: CountItem[] = [
      { assetId: 'found', said: 'found', scanned: true },
      { assetId: 'lost', said: 'not-found', scanned: false },
      { assetId: 'gone-out', said: 'out', scanned: false, projectId: 'nissan' },
      { assetId: 'stray', said: 'elsewhere', scanned: true, placeId: 'b1', caseId: null },
    ]
    const client = await phone({ counts: [counted('old', 'a3', '2026-07-01'), counted('c2', 'a3', '2026-10-06', items)] })
    await client.mutate('count.record', { ...counted('c3', 'b1', '2026-10-07', [{ assetId: 'stray', said: 'found', scanned: true }]), placeId: 'b1' })
    const view = client.view()
    expect(view.counts.of({ placeId: 'a3' }).map((c) => [c.id, c.day, c.what, c.pending])).toEqual([
      ['c2', '2026-10-06', 'Bay A3', false],
      ['old', '2026-07-01', 'Bay A3', false],
    ])
    const log = (id: string) => deviceItemLog(view, id).filter((e) => e.event.kind === 'counted').map((e) => [e.key, itemLogWords(e.event), !!e.pending])
    expect(log('found')).toEqual([['count:c2', 'Found in the count at Bay A3', false]])
    expect(log('lost')).toEqual([['count:c2', 'Not found in the count at Bay A3', false]])
    expect(log('gone-out')).toEqual([])
    expect(log('stray')).toEqual([
      ['count:c3', 'Found in the count at Bay B1', true],
      ['count:c2', 'Found in the count at Bay A3, kept at Bay B1', false],
    ])
  })

  it("lists this week's places: never counted first, then those counted longest ago, enough to count each one a quarter", async () => {
    // Proves: 14 places is two a week. Every place never counted is on the list, in order of name with numbers in order
    // (Bay 2 before Bay 10), then the oldest counted, to make up two less those counted since Monday. Once the week's
    // are done, the next is named to get ahead. The cycle counts places counted in the last 13 weeks, not Bay A3, a
    // year ago, nor Bay B1, four months ago.
    const extra = Array.from({ length: 11 }, (_, i) => place(`p${i + 2}`, `Bay ${i + 2}`))
    const all = [...['a3', 'b1', 'van'], ...extra.map((p) => p.id)]
    // Every place counted but Bay 10 and Bay 2; Bay A3 longest ago, a year back; Bay B1 four months ago.
    const counts = all
      .filter((id) => id !== 'p10' && id !== 'p2')
      .map((id, i) => counted(`c-${id}`, id, id === 'a3' ? '2025-10-01' : id === 'b1' ? '2026-06-01' : `2026-09-${String(10 + i).padStart(2, '0')}`))
    let view = (await phone({ places: extra, counts })).view()
    expect(view.counts.week.perWeek).toBe(2)
    expect(view.counts.week.due.map((d) => d.place.name)).toEqual(['Bay 2', 'Bay 10'])
    expect([view.counts.week.counted, view.counts.week.places]).toEqual([10, 14])

    // Bay 2 and Bay 10 counted this week: the week is done, and Bay A3 is next.
    view = (await phone({ places: extra, counts: [...counts, counted('n2', 'p2', '2026-10-05'), counted('n10', 'p10', '2026-10-06')] })).view()
    expect(view.counts.week.due).toEqual([])
    expect(view.counts.week.done.map((d) => d.place.name)).toEqual(['Bay 10', 'Bay 2'])
    expect(view.counts.week.next?.place.name).toBe('Bay A3')
    expect(view.counts.week.counted).toBe(12)

    // Bay 10 counted this week and Bay 2 never: Bay 2 makes up the week's two.
    view = (await phone({ places: extra, counts: [...counts, counted('n10', 'p10', '2026-10-06')] })).view()
    expect(view.counts.week.due.map((d) => [d.place.name, d.last?.id ?? null])).toEqual([['Bay 2', null]])
    // A place never counted stays on the list once the week's two are done: the baseline isn't finished until it is.
    view = (await phone({ places: extra, counts: [...counts.filter((c) => c.placeId !== 'p3'), counted('n10', 'p10', '2026-10-06'), counted('n2', 'p2', '2026-10-06')] })).view()
    expect(view.counts.week.due.map((d) => d.place.name)).toEqual(['Bay 3'])
  })
})
