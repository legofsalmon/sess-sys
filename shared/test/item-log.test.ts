import { describe, expect, it } from 'vitest'
import { deviceItemLog, itemLogWords, joinItemLog, type ItemEvent, type ItemLogEntry } from '../src/item-log.ts'
import type { Asset, Model } from '../src/stock.ts'
import { emptySnapshot, MemoryStorage, SyncClient, type Transport } from '../src/sync/client.ts'

/**
 * An item's log (ADR 0026), the phone's part and the join: with no signal,
 * the phone says the scans out and back (its own and its case's), faults
 * and how they ended, tests, and its own changes still waiting, newest
 * first; the server's part, when there's signal, takes the place of the
 * phone's entries it has too, adding who did each, and fills in what only
 * it knows, so nothing shows twice. Every kind of event has its words.
 */

const never: Transport = {
  push: () => Promise.reject(new Error('No signal')),
  pull: () => Promise.reject(new Error('No signal')),
}
const model = (id: string, name: string, isCase = false): Model => ({
  id,
  name,
  department: 'audio',
  category: '',
  tracking: 'serialised',
  isCase,
  valueCents: null,
  notes: '',
  patMonths: 12,
  liftingMonths: null,
  mistake: false,
})
const asset = (id: string, modelId: string, number: string, where: Partial<Asset>): Asset => ({
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
const at = (day: number, hour: number) => new Date(Date.UTC(2026, 8, day, hour)).toISOString()

/** A phone holding a speaker in an amp rack, the rack scanned out to a job and the speaker back on its own, a fault fixed and a test. */
async function phone() {
  const storage = new MemoryStorage()
  const snapshot = emptySnapshot('phone')
  snapshot.cursor = 40
  snapshot.entities.model = { k12: model('k12', 'Corvo K12'), rack: model('rack', 'Amp rack', true) }
  snapshot.entities.place = { bay: { id: 'bay', name: 'Bay A1', notes: '' }, van: { id: 'van', name: 'Van 1', notes: '' } }
  snapshot.entities.asset = {
    rack1: asset('rack1', 'rack', 'SH-000001', { placeId: 'bay' }),
    spk: asset('spk', 'k12', 'SH-000002', { caseId: 'rack1' }),
    other: asset('other', 'k12', 'SH-000003', { placeId: 'bay' }),
  }
  snapshot.entities.project = { nissan: { id: 'nissan', name: 'Nissan launch', clientId: null, venueId: null, status: 'confirmed', notes: '' } }
  snapshot.entities.movement = {
    m1: { id: 'm1', projectId: 'nissan', direction: 'out', assetId: 'rack1', modelId: 'rack', qty: 1, at: at(1, 9) },
    m2: { id: 'm2', projectId: 'nissan', direction: 'in', assetId: 'spk', modelId: 'k12', qty: 1, at: at(3, 18) },
    m3: { id: 'm3', projectId: 'nissan', direction: 'out', assetId: 'other', modelId: 'k12', qty: 1, at: at(1, 9) },
  }
  snapshot.entities.fault = {
    f1: {
      id: 'f1',
      kind: 'damaged',
      assetId: 'spk',
      modelId: 'k12',
      qty: 1,
      projectId: 'nissan',
      usable: false,
      note: 'Blown driver',
      repair: 'New driver',
      at: at(3, 19),
      outcome: 'fixed',
      closedAt: at(5, 10),
    },
  }
  snapshot.entities.inspection = { i1: { id: 'i1', assetId: 'spk', kind: 'pat', passed: true, at: at(6, 12), by: 'Sparky Testing', note: '0.1 Ω' } }
  await storage.save(snapshot)
  return new SyncClient({ storage, transport: never, clientId: 'phone' }).open()
}

const words = (entries: ItemLogEntry[]) => entries.map((e) => [itemLogWords(e.event), !!e.pending, e.who ?? null])

describe('the phone’s part', () => {
  it('says what the phone holds, newest first, with its own changes waiting, and nothing of other items', async () => {
    const client = await phone()
    // With no signal: moved to the van, and a fault reported, both waiting.
    await client.mutate('asset.move', { id: 'spk', placeId: 'van', caseId: null })
    await client.mutate('fault.report', { id: 'f2', kind: 'missing', assetId: 'spk', modelId: 'k12', qty: 1, projectId: null, usable: false, note: 'Not in the van', at: at(7, 8) })
    const log = deviceItemLog(client.view(), 'spk', client.waiting)
    // The move was made "now", after the rest.
    expect(words(log)).toEqual([
      ['Moved to Van 1', true, null],
      ['Reported missing: Not in the van', true, null],
      ['Passed its PAT, tested by Sparky Testing: 0.1 Ω', false, null],
      ['Marked fixed', false, null],
      ["Reported damaged back from Nissan launch, can't go out: Blown driver", false, null],
      ['Back in from Nissan launch', false, null],
    ])
    // Once moved to the van it's out of the rack, so the rack's scan out is no longer its own.
    expect(log.map((e) => e.key)).toEqual([expect.stringMatching(/^mutation:/), 'fault:f2', 'inspection:i1', 'closed:f1', 'fault:f1', 'movement:m2'])
  })

  it('counts the scans of the case it’s in as its own', async () => {
    const client = await phone()
    const log = deviceItemLog(client.view(), 'spk', client.waiting)
    expect(log.at(-1)).toMatchObject({ key: 'movement:m1', event: { kind: 'out', job: 'Nissan launch', inCase: 'SH-000001 (Amp rack)' }, from: 'device' })
    expect(itemLogWords(log.at(-1)!.event)).toBe('Out to Nissan launch, in SH-000001 (Amp rack)')
    expect(deviceItemLog(client.view(), 'nothing', [])).toEqual([])
  })
})

describe('the join', () => {
  const device: ItemLogEntry[] = [
    { key: 'mutation:w1', at: at(7, 9), event: { kind: 'moved', where: { place: 'Van 1' } }, pending: true, from: 'device' },
    { key: 'movement:m2', at: at(3, 18), event: { kind: 'back', job: 'Nissan launch', inCase: null }, pending: false, from: 'device' },
  ]
  const server: ItemLogEntry[] = [
    { key: 'movement:m2', at: at(3, 18), event: { kind: 'back', job: 'Nissan launch', inCase: null }, who: 'Colly Hewson', device: 'Safari on iPhone', from: 'server' },
    { key: 'mutation:a1', at: at(1, 8), event: { kind: 'added', number: 'SH-000002', where: { place: 'Bay A1' } }, who: 'Colly Hewson', from: 'server' },
  ]

  it('takes the server’s entry for one both have, keeps the phone’s still waiting, and fills in the rest', () => {
    expect(words(joinItemLog(device, server))).toEqual([
      ['Moved to Van 1', true, null],
      ['Back in from Nissan launch', false, 'Colly Hewson'],
      ['Added as SH-000002 at Bay A1', false, 'Colly Hewson'],
    ])
    // Without the server's part, the phone's alone.
    expect(words(joinItemLog(device, undefined))).toEqual([
      ['Moved to Van 1', true, null],
      ['Back in from Nissan launch', false, null],
    ])
  })
})

describe('every kind of entry', () => {
  it('has its words, about the item', () => {
    const said: [ItemEvent, string][] = [
      [{ kind: 'added', number: 'SH-000002', where: { case: 'SH-000001 (Amp rack)' } }, 'Added as SH-000002 in SH-000001 (Amp rack)'],
      [{ kind: 'added', number: '', where: null }, 'Added as a new item'],
      [{ kind: 'moved', where: null }, 'Taken off where it was kept'],
      [{ kind: 'moved', where: { case: 'SH-000001 (Amp rack)' } }, 'Put in SH-000001 (Amp rack)'],
      [{ kind: 'relabelled', number: 'SH-000009', before: 'SH-000002' }, 'New label SH-000009, replacing SH-000002'],
      [{ kind: 'edited', changes: ['its serial to X1', 'its notes'] }, 'Changed its serial to X1 and its notes'],
      [{ kind: 'fault', fault: 'damaged', usable: true, note: 'Dented', job: null }, 'Reported damaged, fit to go out: Dented'],
      [{ kind: 'fault', fault: 'missing', usable: false, note: '', job: 'Nissan launch' }, 'Reported missing from Nissan launch'],
      [{ kind: 'repair', usable: true }, 'Marked fit to go out'],
      [{ kind: 'repair', repair: '' }, 'Repair notes cleared'],
      [{ kind: 'closed', fault: 'missing', outcome: 'found' }, 'Found'],
      [{ kind: 'closed', fault: 'missing', outcome: 'written-off' }, 'Written off as lost'],
      [{ kind: 'closed', fault: 'damaged', outcome: 'written-off' }, 'Written off as scrapped'],
      [{ kind: 'closed', fault: 'damaged', outcome: 'not-faulty' }, 'Marked not faulty'],
      [{ kind: 'test', test: 'lifting', passed: false, by: 'Lift Co', note: '' }, 'Failed its thorough examination, examined by Lift Co'],
      [{ kind: 'retired', reason: 'stolen', note: 'From the van' }, 'Retired: stolen (From the van)'],
      [{ kind: 'retired', reason: 'mistake', note: '' }, 'Marked as added by mistake'],
      [{ kind: 'reinstated' }, 'Brought back into stock'],
      // What a count said of it (ADR 0030).
      [{ kind: 'counted', where: { place: 'Bay A3' }, found: true }, 'Found in the count at Bay A3'],
      [{ kind: 'counted', where: { case: 'SH-000001 (Amp rack)' }, found: false }, 'Not found in the count of SH-000001 (Amp rack)'],
      [{ kind: 'counted', where: { place: 'Bay A3' }, found: true, kept: { case: 'SH-000001 (Amp rack)' } }, 'Found in the count at Bay A3, kept in SH-000001 (Amp rack)'],
      [{ kind: 'counted', where: { place: 'Bay A3' }, found: true, kept: null }, 'Found in the count at Bay A3, not placed yet'],
    ]
    for (const [event, text] of said) expect(itemLogWords(event)).toBe(text)
  })
})
