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
import { outWithJobs } from '../src/stock/moves.ts'

/**
 * The warehouse catalogue (ADR 0013), as the office and warehouse use it:
 * products, numbered items and their labels, places, cases, and counted
 * stock, with the server keeping numbers unique and nothing inside itself;
 * and a product added by mistake taken out of it all but the history
 * (audit finding 19).
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

describe('added by mistake', () => {
  it('hides a product with its items and counts, once nothing of it is out, on a kit, or holding kit', async () => {
    // A product made by mistake goes from every list but the history, and nothing more is done as it; only kit in use stops that.
    const { app, db, y10p, xlr, rack, bay } = await warehouse()
    const [a, b, box] = [item(y10p.id, { placeId: bay.id }), item(y10p.id, { placeId: bay.id }), item(rack.id, { placeId: bay.id })]
    for (const x of [a, b, box]) await ok(app, 'asset.add', x)
    await ok(app, 'stock.set', { modelId: y10p.id, placeId: bay.id, caseId: null, qty: 4 })
    await ok(app, 'stock.set', { modelId: xlr.id, placeId: bay.id, caseId: null, qty: 20 })
    const job = newId()
    await ok(app, 'project.create', { id: job, name: 'Nissan launch', clientId: null, venueId: null, status: 'confirmed', notes: '' })
    const scan = (what: { assetId: string; modelId: string } | { modelId: string; qty: number }, direction: 'out' | 'in') =>
      ok(app, 'move.record', { id: newId(), projectId: job, direction, assetId: null, qty: 1, ...what, at: new Date().toISOString() })

    // On a job's kit, or out with one, or a case still holding kit: not yet.
    const line = { id: newId(), projectId: job, phaseId: null, modelId: y10p.id, qty: 2, subhireQty: 0, supplier: '', notes: '' }
    await ok(app, 'kit.add', line)
    expect(await refused(app, 'model.mistake', { id: y10p.id })).toBe('d&b Y10P is on the kit for Nissan launch. Take it off that job first.')
    await ok(app, 'kit.remove', { id: line.id })
    await scan({ assetId: a.id, modelId: y10p.id }, 'out')
    expect(await refused(app, 'model.mistake', { id: y10p.id })).toBe('d&b Y10P is out with Nissan launch (SH-000001). Scan it back first.')
    await scan({ assetId: a.id, modelId: y10p.id }, 'in')
    await scan({ modelId: xlr.id, qty: 5 }, 'out')
    expect(await refused(app, 'model.mistake', { id: xlr.id })).toBe('XLR 10 m is out with Nissan launch (5 counted). Scan it back first.')
    await ok(app, 'asset.move', { id: a.id, placeId: null, caseId: box.id })
    expect(await refused(app, 'model.mistake', { id: rack.id })).toBe('SH-000003 still holds 1 item. Empty it first.')

    // Marked: its items retired as a mistake, its counts gone, and nothing more can be done as it.
    await ok(app, 'model.mistake', { id: y10p.id })
    expect(await asset(app, a.id)).toMatchObject({ status: 'retired', retiredReason: 'mistake', retiredNote: null, placeId: null, caseId: null })
    expect(await asset(app, b.id)).toMatchObject({ status: 'retired', retiredReason: 'mistake' })
    expect((await all<Model>(app, 'model')).get(y10p.id)).toMatchObject({ name: 'd&b Y10P', mistake: true })
    expect(await counted(app)).toEqual([[stockId(xlr.id, { placeId: bay.id, caseId: null }), 20]])
    const said = 'd&b Y10P was added by mistake, so nothing more can be done as it.'
    expect(await refused(app, 'asset.add', item(y10p.id))).toBe(said)
    expect(await refused(app, 'asset.reinstate', { id: a.id })).toBe(said)
    expect(await refused(app, 'stock.set', { modelId: y10p.id, placeId: bay.id, caseId: null, qty: 2 })).toBe(said)
    expect(await refused(app, 'model.update', { id: y10p.id, name: 'd&b Y10P-D' })).toBe(said)
    expect(await refused(app, 'kit.add', { ...line, id: newId() })).toBe("d&b Y10P was added by mistake, so it can't go on a job's kit.")
    // Marked twice, from two phones: fine. Removing it outright: no.
    await ok(app, 'model.mistake', { id: y10p.id })
    expect(await refused(app, 'model.remove', { id: y10p.id })).toBe(said)
    // Its name is free for the product that was meant.
    const meant = product('d&b Y10P', { tracking: 'bulk' })
    await ok(app, 'model.create', meant)
    expect(await refused(app, 'model.create', product('D&B y10p'))).toBe("There's already a product called d&b Y10P.")

    // One item on its own can be retired as a mistake too, and brought back if it was real after all.
    await ok(app, 'asset.retire', { id: box.id, reason: 'mistake', note: '' })
    expect(await asset(app, box.id)).toMatchObject({ status: 'retired', retiredReason: 'mistake' })
    await ok(app, 'asset.reinstate', { id: box.id })

    const { entries } = await readHistory(db)
    expect(entries.slice(0, 2).map((e) => e.what)).toEqual(['Brought back SH-000003 (Amp rack)', 'Retired SH-000003 (Amp rack): added by mistake'])
    expect(entries.find((e) => e.command === 'model.mistake')).toMatchObject({ what: 'Marked the product d&b Y10P as added by mistake', outcome: 'done' })
    expect(entries.find((e) => e.command === 'model.mistake' && e.outcome === 'turned-down')).toMatchObject({
      what: 'Marked the product Amp rack as added by mistake',
      reason: 'SH-000003 still holds 1 item. Empty it first.',
    })
  })

  it('takes kit as out the way the pick lists do: in a case scanned out, but not once reported missing', async () => {
    // The server never turns it down for kit the phone shows as back, nor lets it through for kit the phone shows as out.
    const { app, y10p, xlr, rack, bay } = await warehouse()
    const [a, b, box] = [item(y10p.id, { placeId: bay.id }), item(y10p.id, { placeId: bay.id }), item(rack.id, { placeId: bay.id })]
    for (const x of [a, b, box]) await ok(app, 'asset.add', x)
    const job = async (name: string) => {
      const id = newId()
      await ok(app, 'project.create', { id, name, clientId: null, venueId: null, status: 'confirmed', notes: '' })
      return id
    }
    const [nissan, picnic] = [await job('Nissan launch'), await job('Electric Picnic')]
    type What = { assetId: string; modelId: string } | { modelId: string; qty: number }
    const scan = (projectId: string, what: What, direction: 'out' | 'in') =>
      ok(app, 'move.record', { id: newId(), projectId, direction, assetId: null, qty: 1, ...what, at: new Date().toISOString() })
    const missing = (projectId: string, what: What) =>
      ok(app, 'fault.report', { id: newId(), kind: 'missing', assetId: null, qty: 1, projectId, usable: false, note: '', ...what, at: new Date().toISOString() })

    // Only the case is scanned out, so what's in it went too; another item is out with a second job.
    await ok(app, 'asset.move', { id: a.id, placeId: null, caseId: box.id })
    await scan(nissan, { assetId: box.id, modelId: rack.id }, 'out')
    await scan(picnic, { assetId: b.id, modelId: y10p.id }, 'out')
    expect(await refused(app, 'model.mistake', { id: y10p.id })).toBe('d&b Y10P is out with 2 jobs (Electric Picnic, Nissan launch). Scan it back first.')
    await scan(picnic, { assetId: b.id, modelId: y10p.id }, 'in')
    expect(await refused(app, 'model.mistake', { id: y10p.id })).toBe('d&b Y10P is out with Nissan launch (SH-000001). Scan it back first.')

    // Reported missing from the job ends its time out, as a scan back would, for an item and for counted kit.
    await missing(nissan, { assetId: a.id, modelId: y10p.id })
    await scan(nissan, { modelId: xlr.id, qty: 5 }, 'out')
    await scan(nissan, { modelId: xlr.id, qty: 2 }, 'in')
    expect(await refused(app, 'model.mistake', { id: xlr.id })).toBe('XLR 10 m is out with Nissan launch (3 counted). Scan it back first.')
    await missing(nissan, { modelId: xlr.id, qty: 3 })
    await ok(app, 'model.mistake', { id: xlr.id })
    await ok(app, 'model.mistake', { id: y10p.id })
    expect(await asset(app, a.id)).toMatchObject({ status: 'retired', retiredReason: 'mistake', caseId: null })
    // Nothing more is reported as it either.
    const report = { id: newId(), kind: 'damaged' as const, assetId: null, modelId: xlr.id, qty: 1, projectId: null, usable: false, note: 'Cut', at: new Date().toISOString() }
    expect(await refused(app, 'fault.report', report)).toBe("XLR 10 m was added by mistake, so the report wasn't kept.")
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

  it('works out what of a product is out just as the server does, through cases, kit partly back and kit missing', async () => {
    // The phone says first what the server would answer to marking a product as added by mistake, so the two agree on every step of one history.
    const { app, db, y10p, xlr, rack, bay } = await warehouse()
    const [a, b, box] = [item(y10p.id, { placeId: bay.id }), item(y10p.id, { placeId: bay.id }), item(rack.id, { placeId: bay.id })]
    for (const x of [a, b, box]) await ok(app, 'asset.add', x)
    await ok(app, 'stock.set', { modelId: xlr.id, placeId: bay.id, caseId: null, qty: 20 })
    const job = async (name: string) => {
      const id = newId()
      await ok(app, 'project.create', { id, name, clientId: null, venueId: null, status: 'confirmed', notes: '' })
      return id
    }
    const [nissan, picnic] = [await job('Nissan launch'), await job('Electric Picnic')]
    // The phones' clocks, a minute apart, as the scans happened.
    let clock = Date.parse('2026-10-01T09:00:00.000Z')
    const at = () => new Date((clock += 60_000)).toISOString()
    type What = { assetId: string; modelId: string } | { modelId: string; qty: number }
    const scan = (projectId: string, what: What, direction: 'out' | 'in') =>
      ok(app, 'move.record', { id: newId(), projectId, direction, assetId: null, qty: 1, ...what, at: at() })
    const missing = async (projectId: string, what: What) => {
      const id = newId()
      await ok(app, 'fault.report', { id, kind: 'missing', assetId: null, qty: 1, projectId, usable: false, note: '', ...what, at: at() })
      return id
    }
    const phone = await device(app)
    const agree = async (expected: Record<string, string[]>) => {
      await phone.client.sync()
      for (const m of [y10p, xlr]) {
        const onPhone = phone.client.view().moves.outWith(m.id)
        expect(onPhone, m.name).toEqual(await outWithJobs(db, m.id))
        expect(onPhone.map((o) => `${o.what} with ${o.job}`), m.name).toEqual(expected[m.name] ?? [])
      }
    }

    await agree({})
    // Out on its own; then put in a case that went out with another job after: the case takes it along.
    await scan(nissan, { assetId: a.id, modelId: y10p.id }, 'out')
    await agree({ 'd&b Y10P': ['SH-000001 with Nissan launch'] })
    await ok(app, 'asset.move', { id: a.id, placeId: null, caseId: box.id })
    await scan(picnic, { assetId: box.id, modelId: rack.id }, 'out')
    await agree({ 'd&b Y10P': ['SH-000001 with Electric Picnic'] })
    // The case back with it still inside: back too.
    await scan(picnic, { assetId: box.id, modelId: rack.id }, 'in')
    await agree({})
    // Two jobs at once, and counted kit partly back.
    await scan(nissan, { assetId: b.id, modelId: y10p.id }, 'out')
    await scan(picnic, { assetId: box.id, modelId: rack.id }, 'out')
    await scan(nissan, { modelId: xlr.id, qty: 5 }, 'out')
    await scan(picnic, { modelId: xlr.id, qty: 4 }, 'out')
    await scan(nissan, { modelId: xlr.id, qty: 2 }, 'in')
    await agree({
      'd&b Y10P': ['SH-000001 with Electric Picnic', 'SH-000002 with Nissan launch'],
      'XLR 10 m': ['4 counted with Electric Picnic', '3 counted with Nissan launch'],
    })
    // Reported missing from the job: its time out ends, for an item and for counted kit, and stays ended once it's found.
    const lost = await missing(nissan, { assetId: b.id, modelId: y10p.id })
    await missing(nissan, { modelId: xlr.id, qty: 3 })
    await agree({ 'd&b Y10P': ['SH-000001 with Electric Picnic'], 'XLR 10 m': ['4 counted with Electric Picnic'] })
    await ok(app, 'fault.close', { id: lost, outcome: 'found', at: at() })
    await scan(picnic, { assetId: box.id, modelId: rack.id }, 'in')
    await scan(picnic, { modelId: xlr.id, qty: 4 }, 'in')
    await agree({})

    // Taken out of the case, an item goes by its own last scan again: out with the first job until it's scanned back.
    await ok(app, 'asset.move', { id: a.id, placeId: bay.id, caseId: null })
    await agree({ 'd&b Y10P': ['SH-000001 with Nissan launch'] })
    await scan(nissan, { assetId: a.id, modelId: y10p.id }, 'in')
    await agree({})

    // Marked as added by mistake once it's all in, its reports of kit missing out of sight: still nothing out, on any job.
    await ok(app, 'model.mistake', { id: y10p.id })
    await ok(app, 'model.mistake', { id: xlr.id })
    await agree({})
    const v = phone.client.view()
    expect(v.faults.open).toEqual([])
    expect([v.moves.stillOut, v.moves.pickList(nissan)?.stillOut, v.moves.pickList(picnic)?.stillOut]).toEqual([[], 0, 0])
  })

  it('knows, as the server does, a product kept for having been out on a job, so it offers Added by mistake rather than Remove', async () => {
    // A product with nothing left but its time out with a job can't simply be removed; the phone must know so to offer the other way.
    const { app, xlr, rack } = await warehouse()
    const job = newId()
    await ok(app, 'project.create', { id: job, name: 'Nissan launch', clientId: null, venueId: null, status: 'confirmed', notes: '' })
    const at = new Date().toISOString()
    await ok(app, 'move.record', { id: newId(), projectId: job, direction: 'out', assetId: null, modelId: xlr.id, qty: 5, at })
    await ok(app, 'move.record', { id: newId(), projectId: job, direction: 'in', assetId: null, modelId: xlr.id, qty: 5, at })
    const phone = await device(app)
    await phone.client.sync()
    expect([phone.client.view().moves.everMoved(xlr.id), phone.client.view().moves.everMoved(rack.id)]).toEqual([true, false])
    expect(await refused(app, 'model.remove', { id: xlr.id })).toBe("XLR 10 m has been out on jobs, which is kept for the record, so it can't be removed.")
    await ok(app, 'model.mistake', { id: xlr.id })
    await ok(app, 'model.remove', { id: rack.id })
  })

  it('shows nothing of a product added by mistake, before and after the server agrees, but its labels still say so', async () => {
    // Gone from the phone's lists while the change waits with no signal, and still once it's synced; a scan of its label says what it was.
    const { app, y10p, bay } = await warehouse()
    const a = item(y10p.id, { placeId: bay.id, number: '501' })
    await ok(app, 'asset.add', a)
    await ok(app, 'stock.set', { modelId: y10p.id, placeId: bay.id, caseId: null, qty: 3 })
    const phone = await device(app)
    await phone.client.sync()
    expect(phone.client.view().warehouse.models.map((m) => m.name)).toEqual(['Amp rack', 'd&b Y10P', 'XLR 10 m'])

    phone.signal.on = false
    await phone.client.mutate('model.mistake', { id: y10p.id })
    await phone.client.sync().catch(() => {})
    let w = phone.client.view().warehouse
    expect(w.models.map((m) => m.name)).toEqual(['Amp rack', 'XLR 10 m'])
    expect(w.places[0]).toMatchObject({ name: 'Bay A3', itemTotal: 0, countedTotal: 0 })
    expect(w.byNumber.get('SH-000501')).toMatchObject({ status: 'retired', retiredReason: 'mistake', pending: true })

    phone.signal.on = true
    await phone.client.sync()
    w = phone.client.view().warehouse
    expect(w.models.map((m) => m.name)).toEqual(['Amp rack', 'XLR 10 m'])
    expect(w.mistakes.get(y10p.id)).toMatchObject({ name: 'd&b Y10P', mistake: true, pending: false })
    expect(w.byNumber.get('SH-000501')).toMatchObject({ retiredReason: 'mistake', pending: false, model: expect.objectContaining({ name: 'd&b Y10P' }) })
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
