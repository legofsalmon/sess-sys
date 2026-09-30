import {
  MemoryStorage,
  newId,
  normaliseNumber,
  stockId,
  SyncClient,
  type Asset,
  type CommandInput,
  type CommandName,
  type Model,
  type MutationResult,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type Stock,
  type Transport,
} from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { restoreBackup, writeBackup } from '../src/backup/format.ts'
import { pgliteDb, type Db } from '../src/db.ts'
import { readHistory } from '../src/history.ts'

/**
 * The warehouse catalogue (ADR 0013), as the office and warehouse use it:
 * products, numbered items and their labels, places, cases, and counted
 * stock, with the server keeping numbers unique and nothing inside itself.
 */

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

async function server() {
  const db = await pgliteDb()
  const app = await buildApp({ db })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  return { app, db }
}

async function send<N extends CommandName>(app: FastifyInstance, name: N, args: CommandInput<N>): Promise<MutationResult> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    payload: { clientId: 'warehouse-phone', mutations: [{ id: newId(), name, args, createdAt: new Date().toISOString() }] },
  })
  return res.json().results[0]
}

/** Send, and expect it done. */
async function ok<N extends CommandName>(app: FastifyInstance, name: N, args: CommandInput<N>) {
  const r = await send(app, name, args)
  expect(r, `${name} ${JSON.stringify(args)}`).toMatchObject({ status: 'applied' })
  return r
}

/** Send, and expect it turned down; the reason's message. */
async function refused<N extends CommandName>(app: FastifyInstance, name: N, args: CommandInput<N>) {
  const r = await send(app, name, args)
  expect(r.status, `${name} ${JSON.stringify(args)}`).toBe('rejected')
  return r.status === 'rejected' ? r.reason.message : ''
}

/** Every record of a kind, as the latest change says. */
async function all<T>(app: FastifyInstance, entity: string): Promise<Map<string, T>> {
  const res = await app.inject({ method: 'GET', url: '/api/sync/pull?after=0' })
  const out = new Map<string, T>()
  for (const c of (res.json() as PullResponse).changes) {
    if (c.entity !== entity) continue
    if (c.op === 'delete') out.delete(c.id)
    else out.set(c.id, c.data as T)
  }
  return out
}
const asset = async (app: FastifyInstance, id: string) => (await all<Asset>(app, 'asset')).get(id)
const counted = async (app: FastifyInstance) => [...(await all<Stock>(app, 'stock')).values()].map((s) => [s.id, s.qty])

const product = (name: string, extra: Partial<Model> = {}): CommandInput<'model.create'> => ({
  id: newId(),
  name,
  department: 'audio',
  category: 'Speakers',
  tracking: 'serialised',
  isCase: false,
  valueCents: null,
  notes: '',
  ...extra,
})
const item = (modelId: string, extra: Partial<CommandInput<'asset.add'>> = {}): CommandInput<'asset.add'> => ({
  id: newId(),
  modelId,
  number: null,
  serial: '',
  placeId: null,
  caseId: null,
  notes: '',
  fromCount: false,
  ...extra,
})
const place = (name: string) => ({ id: newId(), name, notes: '' })

/** A warehouse with a bay, speakers (numbered), XLRs (counted) and amp racks (cases). */
async function warehouse() {
  const s = await server()
  const bay = place('Bay A3')
  const y10p = product('d&b Y10P', { valueCents: 350000 })
  const xlr = product('XLR 10 m', { tracking: 'bulk', category: 'Cables' })
  const rack = product('Amp rack', { isCase: true, category: 'Cases' })
  await ok(s.app, 'place.upsert', bay)
  for (const p of [y10p, xlr, rack]) await ok(s.app, 'model.create', p)
  return { ...s, bay, y10p, xlr, rack }
}

describe('numbers', () => {
  it('reads a number however it is typed or scanned', () => {
    expect(['SH-000123', 'sh 123', 'SH123', ' 000123 ', '123', 'https://s.sessionhire.ie/a/000123'].map(normaliseNumber)).toEqual(Array(6).fill('SH-000123'))
    expect(['', 'SH-', 'SH-1234567', '0', 'SH-000000', 'Y10P', '12a'].map(normaliseNumber)).toEqual(Array(7).fill(undefined))
  })

  it('gives the next free number, or takes one from a label already stuck on', async () => {
    const { app, y10p } = await warehouse()
    const [a, b, c, d] = [item(y10p.id), item(y10p.id), item(y10p.id, { number: 'sh 500' }), item(y10p.id)]
    for (const x of [a, b, c, d]) await ok(app, 'asset.add', x)
    expect((await asset(app, a.id))?.number).toBe('SH-000001')
    expect((await asset(app, b.id))?.number).toBe('SH-000002')
    expect((await asset(app, c.id))?.number).toBe('SH-000500')
    // One more than the highest ever used, so a pre-printed roll's number isn't given out again.
    expect((await asset(app, d.id))?.number).toBe('SH-000501')
  })

  it('never uses a number twice, even once its label is replaced', async () => {
    const { app, y10p, rack } = await warehouse()
    const a = item(y10p.id, { number: '123' })
    await ok(app, 'asset.add', a)
    expect(await refused(app, 'asset.add', item(rack.id, { number: 'SH-000123' }))).toBe('SH-000123 is already in use (d&b Y10P).')

    // A worn label: the item gets a new number, and the old one is kept as a former label.
    await ok(app, 'asset.relabel', { id: a.id, number: '124' })
    const relabelled = await asset(app, a.id)
    expect(relabelled).toMatchObject({ number: 'SH-000124', formerNumbers: ['SH-000123'] })
    expect(await refused(app, 'asset.add', item(y10p.id, { number: '123' }))).toBe(
      'SH-000123 was used before (d&b Y10P, now SH-000124), and a number is never used twice. Use another label.'
    )
    // The next free number is past every number used, current or former.
    await ok(app, 'asset.relabel', { id: a.id, number: null })
    expect(await asset(app, a.id)).toMatchObject({ number: 'SH-000125', formerNumbers: ['SH-000123', 'SH-000124'] })

    expect(await refused(app, 'asset.add', item(y10p.id, { number: 'Y10P-7' }))).toMatch(/isn't a Session Hire number/)
  })

  it('keeps a retired item and its number, and brings it back when it turns up', async () => {
    const { app, y10p, bay } = await warehouse()
    const a = item(y10p.id, { placeId: bay.id })
    await ok(app, 'asset.add', a)
    await ok(app, 'asset.retire', { id: a.id, reason: 'lost', note: 'Left at the RDS' })
    expect(await asset(app, a.id)).toMatchObject({ status: 'retired', retiredReason: 'lost', retiredNote: 'Left at the RDS', placeId: null })
    expect(await refused(app, 'asset.move', { id: a.id, placeId: bay.id, caseId: null })).toBe('SH-000001 (d&b Y10P) is retired. Bring it back first.')
    expect(await refused(app, 'asset.add', item(y10p.id, { number: '1' }))).toBe('SH-000001 is already in use (d&b Y10P).')

    await ok(app, 'asset.reinstate', { id: a.id })
    expect(await asset(app, a.id)).toMatchObject({ status: 'active', retiredReason: null, number: 'SH-000001' })
  })
})

describe('counted stock', () => {
  it('counts, moves, and refuses to move more than is there', async () => {
    const { app, xlr, bay } = await warehouse()
    const van = place('Van 1')
    await ok(app, 'place.upsert', van)
    await ok(app, 'stock.set', { modelId: xlr.id, placeId: bay.id, caseId: null, qty: 120 })
    await ok(app, 'stock.move', { modelId: xlr.id, fromPlaceId: bay.id, fromCaseId: null, toPlaceId: van.id, toCaseId: null, qty: 20 })
    expect(await counted(app)).toEqual([
      [stockId(xlr.id, { placeId: bay.id, caseId: null }), 100],
      [stockId(xlr.id, { placeId: van.id, caseId: null }), 20],
    ])
    const r = await send(app, 'stock.move', { modelId: xlr.id, fromPlaceId: van.id, fromCaseId: null, toPlaceId: bay.id, toCaseId: null, qty: 25 })
    expect(r).toMatchObject({
      status: 'rejected',
      reason: { code: 'short', short: 5, message: 'Only 20 × XLR 10 m counted at Van 1, not 25. Count them again first.' },
    })

    // Moving them all, or counting none, takes the count away.
    await ok(app, 'stock.move', { modelId: xlr.id, fromPlaceId: van.id, fromCaseId: null, toPlaceId: bay.id, toCaseId: null, qty: 20 })
    expect(await counted(app)).toEqual([[stockId(xlr.id, { placeId: bay.id, caseId: null }), 120]])
    await ok(app, 'stock.set', { modelId: xlr.id, placeId: bay.id, caseId: null, qty: 0 })
    expect(await counted(app)).toEqual([])
  })

  it('labels counted speakers one by one without changing how many there are', async () => {
    const { app, y10p, bay } = await warehouse()
    await ok(app, 'stock.set', { modelId: y10p.id, placeId: bay.id, caseId: null, qty: 24 })
    await ok(app, 'asset.add', item(y10p.id, { placeId: bay.id, fromCount: true }))
    await ok(app, 'asset.add', item(y10p.id, { placeId: bay.id, fromCount: true }))
    // One not from the count: a speaker nobody had counted.
    await ok(app, 'asset.add', item(y10p.id, { placeId: bay.id }))
    expect(await counted(app)).toEqual([[stockId(y10p.id, { placeId: bay.id, caseId: null }), 22]])
    expect([...(await all<Asset>(app, 'asset')).values()]).toHaveLength(3)
  })
})

describe('cases', () => {
  it('holds items and counted stock, moves with them, and never goes inside itself', async () => {
    const { app, y10p, xlr, rack, bay } = await warehouse()
    const [outer, inner, amp] = [item(rack.id, { placeId: bay.id }), item(rack.id, { placeId: bay.id }), item(y10p.id, { placeId: bay.id })]
    for (const x of [outer, inner, amp]) await ok(app, 'asset.add', x)
    await ok(app, 'asset.move', { id: amp.id, placeId: null, caseId: inner.id })
    await ok(app, 'asset.move', { id: inner.id, placeId: null, caseId: outer.id })
    await ok(app, 'stock.set', { modelId: xlr.id, placeId: null, caseId: inner.id, qty: 10 })

    expect(await refused(app, 'asset.move', { id: outer.id, placeId: null, caseId: inner.id })).toBe(
      'SH-000002 is inside it, and nothing can go inside itself.'
    )
    expect(await refused(app, 'asset.move', { id: outer.id, placeId: null, caseId: outer.id })).toMatch(/nothing can go inside itself/)
    expect(await refused(app, 'asset.move', { id: bay.id, placeId: null, caseId: amp.id })).toBe('That item no longer exists.')
    expect(await refused(app, 'asset.move', { id: inner.id, placeId: null, caseId: amp.id })).toBe("SH-000003 (d&b Y10P) doesn't hold other kit.")

    // Moving the outer case leaves everything in it where it is: inside.
    const van = place('Van 1')
    await ok(app, 'place.upsert', van)
    await ok(app, 'asset.move', { id: outer.id, placeId: van.id, caseId: null })
    expect(await asset(app, inner.id)).toMatchObject({ caseId: outer.id, placeId: null })
    expect(await asset(app, amp.id)).toMatchObject({ caseId: inner.id })

    // Nothing is retired with kit still in it, and a case with kit in it stays a case.
    expect(await refused(app, 'asset.retire', { id: inner.id, reason: 'scrapped', note: '' })).toBe(
      'SH-000002 still holds 1 item and 10 counted. Empty it first.'
    )
    expect(await refused(app, 'model.update', { id: rack.id, isCase: false })).toBe('2 cases of Amp rack have kit in them. Empty them first.')
    expect(await refused(app, 'asset.update', { id: inner.id, modelId: y10p.id })).toBe(
      "SH-000002 has kit in it, and d&b Y10P doesn't hold other kit. Empty it first."
    )
  })

  it('goes no more than five cases deep', async () => {
    const { app, rack, bay } = await warehouse()
    const cases = Array.from({ length: 6 }, () => item(rack.id, { placeId: bay.id }))
    for (const c of cases) await ok(app, 'asset.add', c)
    for (let i = 1; i < 5; i++) await ok(app, 'asset.move', { id: cases[i]!.id, placeId: null, caseId: cases[i - 1]!.id })
    expect(await refused(app, 'asset.move', { id: cases[5]!.id, placeId: null, caseId: cases[4]!.id })).toBe(
      'That would put kit more than 5 cases deep. Take something out of a case first.'
    )
    // A case holding two levels can't go where it would make six either.
    await ok(app, 'asset.move', { id: cases[4]!.id, placeId: bay.id, caseId: null })
    await ok(app, 'asset.move', { id: cases[5]!.id, placeId: null, caseId: cases[4]!.id })
    expect(await refused(app, 'asset.move', { id: cases[4]!.id, placeId: null, caseId: cases[3]!.id })).toMatch(/more than 5 cases deep/)
  })
})

describe('products and places', () => {
  it('keeps names unique and removes only what has nothing left', async () => {
    const { app, y10p, xlr, bay } = await warehouse()
    expect(await refused(app, 'model.create', product('D&B y10p'))).toBe("There's already a product called d&b Y10P.")
    expect(await refused(app, 'place.upsert', place('bay a3'))).toBe("There's already a place called Bay A3.")
    expect(await refused(app, 'model.update', { id: xlr.id, name: 'd&b Y10P ' })).toBe("There's already a product called d&b Y10P.")

    const a = item(y10p.id, { placeId: bay.id })
    await ok(app, 'asset.add', a)
    await ok(app, 'stock.set', { modelId: xlr.id, placeId: bay.id, caseId: null, qty: 40 })
    expect(await refused(app, 'place.remove', { id: bay.id })).toBe('Bay A3 still has 1 item and 40 counted. Move them first.')
    expect(await refused(app, 'model.remove', { id: xlr.id })).toBe('XLR 10 m still has 40 counted. Count them as none first.')
    await ok(app, 'asset.retire', { id: a.id, reason: 'sold', note: '' })
    // Retired, but kept for its history: the product stays too.
    expect(await refused(app, 'model.remove', { id: y10p.id })).toMatch(/has numbered items, which are kept for their history/)

    await ok(app, 'stock.set', { modelId: xlr.id, placeId: bay.id, caseId: null, qty: 0 })
    await ok(app, 'model.remove', { id: xlr.id })
    await ok(app, 'place.remove', { id: bay.id })
    expect((await all(app, 'model')).has(xlr.id)).toBe(false)
    expect((await all(app, 'place')).size).toBe(0)
  })

  it('switches between numbered and counted only while nothing is numbered', async () => {
    const { app, y10p, xlr } = await warehouse()
    await ok(app, 'asset.add', item(y10p.id))
    expect(await refused(app, 'model.update', { id: y10p.id, tracking: 'bulk' })).toBe(
      "d&b Y10P has 1 numbered item, so it can't be counted only. Retire them first."
    )
    expect(await refused(app, 'asset.add', item(xlr.id))).toBe('XLR 10 m is counted, not numbered. Change it to numbered to label them one by one.')
    expect((await send(app, 'model.create', product('Cable trunk', { tracking: 'bulk', isCase: true }))).status).toBe('rejected')
    await ok(app, 'model.update', { id: xlr.id, tracking: 'serialised' })
    await ok(app, 'asset.add', item(xlr.id))
  })
})

describe('on a device', () => {
  async function device(app: FastifyInstance) {
    const signal = { on: true }
    const transport: Transport = {
      async push(req: PushRequest): Promise<PushResponse> {
        if (!signal.on) throw new Error('offline')
        return (await app.inject({ method: 'POST', url: '/api/sync/push', payload: req })).json()
      },
      async pull(after: number): Promise<PullResponse> {
        if (!signal.on) throw new Error('offline')
        return (await app.inject({ method: 'GET', url: `/api/sync/pull?after=${after}` })).json()
      },
    }
    const client = await new SyncClient({ storage: new MemoryStorage(), transport }).open()
    return { client, signal }
  }

  it('labels with no signal, waiting for a number, and shows where everything is', async () => {
    const { app, y10p, rack, bay } = await warehouse()
    const phone = await device(app)
    await phone.client.sync()
    await phone.client.mutate('stock.set', { modelId: y10p.id, placeId: bay.id, caseId: null, qty: 4 })
    await phone.client.sync()

    phone.signal.on = false
    const [amp, spare, box] = [newId(), newId(), newId()]
    await phone.client.mutate('asset.add', item(rack.id, { id: box, placeId: bay.id, number: '777' }))
    await phone.client.mutate('asset.add', item(y10p.id, { id: amp, caseId: box, fromCount: false }))
    await phone.client.mutate('asset.add', item(y10p.id, { id: spare, placeId: bay.id, fromCount: true }))
    await phone.client.sync().catch(() => {})

    let w = phone.client.view().warehouse
    const speakers = w.models.find((m) => m.id === y10p.id)!
    expect(speakers.items.map((i) => [i.number, i.pending, i.at?.name])).toEqual([
      ['', true, 'Bay A3'],
      ['', true, 'Bay A3'],
    ])
    expect(speakers).toMatchObject({ countedTotal: 3, total: 5 })
    expect(w.byNumber.get('SH-000777')?.items.map((i) => i.id)).toEqual([amp])
    expect(w.places[0]).toMatchObject({ name: 'Bay A3', itemTotal: 3, countedTotal: 3 })

    phone.signal.on = true
    await phone.client.sync()
    w = phone.client.view().warehouse
    expect(w.assets.get(amp)).toMatchObject({ number: 'SH-000778', pending: false, inCase: expect.objectContaining({ number: 'SH-000777' }) })
    expect(w.assets.get(spare)).toMatchObject({ number: 'SH-000779', pending: false })
    expect(w.models.find((m) => m.id === y10p.id)).toMatchObject({ countedTotal: 3, total: 5 })
  })
})

describe('the history', () => {
  it('says what was done to stock, in words', async () => {
    const { app, db, y10p, xlr, rack, bay } = await warehouse()
    const [a, box] = [item(y10p.id, { placeId: bay.id }), item(rack.id, { placeId: bay.id, number: '200' })]
    await ok(app, 'asset.add', box)
    await ok(app, 'asset.add', a)
    await ok(app, 'asset.relabel', { id: a.id, number: null })
    await ok(app, 'asset.move', { id: a.id, placeId: null, caseId: box.id })
    await ok(app, 'asset.update', { id: a.id, serial: 'Y10P-4471' })
    await ok(app, 'stock.set', { modelId: xlr.id, placeId: bay.id, caseId: null, qty: 40 })
    await ok(app, 'stock.move', { modelId: xlr.id, fromPlaceId: bay.id, fromCaseId: null, toPlaceId: null, toCaseId: box.id, qty: 10 })
    await ok(app, 'model.update', { id: xlr.id, category: '', valueCents: 1250 })
    await refused(app, 'asset.retire', { id: box.id, reason: 'scrapped', note: '' })

    const { entries } = await readHistory(db)
    expect(entries.map((e) => e.what).reverse()).toEqual([
      'Saved the place Bay A3',
      'Added the product d&b Y10P (Audio, numbered)',
      'Added the product XLR 10 m (Audio, counted)',
      'Added the product Amp rack (Audio, numbered, holds other kit)',
      'Added SH-000200 (Amp rack) at Bay A3',
      // The number it got then, though it has had another since.
      'Added SH-000201 (d&b Y10P) at Bay A3',
      'Put a new label on d&b Y10P: SH-000202, replacing SH-000201',
      'Put SH-000202 (d&b Y10P) in SH-000200 (Amp rack)',
      'Changed SH-000202 (d&b Y10P): serial to Y10P-4471',
      'Counted 40 × XLR 10 m at Bay A3',
      'Moved 10 × XLR 10 m from Bay A3 to SH-000200 (Amp rack)',
      'Changed the product XLR 10 m: no category and value to €12.50',
      'Retired SH-000200 (Amp rack): scrapped',
    ])
    expect(entries[0]).toMatchObject({ outcome: 'turned-down', reason: 'SH-000200 still holds 1 item and 10 counted. Empty it first.' })
  })
})

describe('backups', () => {
  it('put items back in any order, cases after what is in them', async () => {
    const { app, db, y10p, rack, bay } = await warehouse()
    // The case sorts after the 600 speakers in it, so they go back first, in more than one batch.
    const box = item(rack.id, { id: `zz${newId()}`, placeId: bay.id })
    await ok(app, 'asset.add', box)
    await db.query(`INSERT INTO assets (id, model_id, case_id, status) SELECT 'aa' || lpad(n::text, 4, '0'), $1, $2, 'active' FROM generate_series(1, 600) n`, [
      y10p.id,
      box.id,
    ])

    const backup = await writeBackup(db)
    const fresh: Db = await pgliteDb()
    cleanup.push(() => fresh.close())
    const report = await restoreBackup(fresh, backup.data)
    expect(report.tables).toMatchObject({ assets: 601, identifiers: 1, models: 3, places: 1 })
    expect((await fresh.query(`SELECT count(*)::int AS n FROM assets WHERE case_id = $1`, [box.id])).rows).toEqual([{ n: 600 }])
  })
})
