import {
  MemoryStorage,
  newId,
  SyncClient,
  type Asset,
  type CommandInput,
  type CommandName,
  type Model,
  type Movement,
  type MutationResult,
  type PickList,
  type ProjectStatus,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type Transport,
} from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb } from '../src/db.ts'
import { readHistory } from '../src/history.ts'

/**
 * Kit out and back (ADR 0017): every scan is kept, whatever the plan says,
 * and each device works out what's out with which job from the scans in
 * the order they happened, a case taking what's in it along; each job's
 * pick list says what's still to go and where to find it.
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
    payload: { clientId: 'office-laptop', mutations: [{ id: newId(), name, args, createdAt: new Date().toISOString() }] },
  })
  return res.json().results[0]
}

async function ok<N extends CommandName>(app: FastifyInstance, name: N, args: CommandInput<N>) {
  const r = await send(app, name, args)
  expect(r, `${name} ${JSON.stringify(args)}`).toMatchObject({ status: 'applied' })
  return r
}

async function refused<N extends CommandName>(app: FastifyInstance, name: N, args: CommandInput<N>) {
  const r = await send(app, name, args)
  expect(r.status, `${name} ${JSON.stringify(args)}`).toBe('rejected')
  return r.status === 'rejected' ? r.reason.message : ''
}

async function records(app: FastifyInstance) {
  const res = await app.inject({ method: 'GET', url: '/api/sync/pull?after=0' })
  const moves = new Map<string, Movement>()
  const items = new Map<string, Asset>()
  for (const c of (res.json() as PullResponse).changes) {
    if (c.entity === 'movement') moves.set(c.id, c.data as Movement)
    if (c.entity === 'asset') items.set(c.id, c.data as Asset)
  }
  return { moves, items }
}

const product = (name: string, extra: Partial<Model> = {}): CommandInput<'model.create'> => ({
  id: newId(),
  name,
  department: 'audio',
  category: '',
  tracking: 'serialised',
  isCase: false,
  valueCents: null,
  notes: '',
  ...extra,
})

async function job(app: FastifyInstance, name: string, status: ProjectStatus, start: string, end: string) {
  const id = newId()
  await ok(app, 'project.create', { id, name, clientId: null, venueId: null, status, notes: '' })
  await ok(app, 'phase.add', { id: newId(), projectId: id, name: 'Show', start, end, venueId: null, notes: '' })
  return id
}

const kit = (projectId: string, modelId: string, qty: number, extra: Partial<CommandInput<'kit.add'>> = {}): CommandInput<'kit.add'> => ({
  id: newId(),
  projectId,
  phaseId: null,
  modelId,
  qty,
  subhireQty: 0,
  supplier: '',
  notes: '',
  ...extra,
})

/**
 * Two bays: four d&b Y10P in Bay A3 and two more in an amp rack in Bay A4
 * with its two amps, and 20 × XLR 10 m counted in Bay C.
 */
async function warehouse() {
  const s = await server()
  const bayA3 = { id: newId(), name: 'Bay A3', notes: '' }
  const bayA4 = { id: newId(), name: 'Bay A4', notes: '' }
  const bayC = { id: newId(), name: 'Bay C', notes: '' }
  for (const p of [bayA3, bayA4, bayC]) await ok(s.app, 'place.upsert', p)
  const y10p = product('d&b Y10P')
  const amp = product('d&b D80')
  const rack = product('Amp rack', { isCase: true, category: 'Cases' })
  const xlr = product('XLR 10 m', { tracking: 'bulk', category: 'Cables' })
  for (const p of [y10p, amp, rack, xlr]) await ok(s.app, 'model.create', p)
  const add = async (modelId: string, where: { placeId: string | null; caseId: string | null }) => {
    const id = newId()
    await ok(s.app, 'asset.add', { id, modelId, number: null, serial: '', ...where, notes: '', fromCount: false })
    return id
  }
  const speakers = [] as string[]
  for (let i = 0; i < 4; i++) speakers.push(await add(y10p.id, { placeId: bayA3.id, caseId: null }))
  const rackId = await add(rack.id, { placeId: bayA4.id, caseId: null })
  const amps = [await add(amp.id, { placeId: null, caseId: rackId }), await add(amp.id, { placeId: null, caseId: rackId })]
  await ok(s.app, 'stock.set', { modelId: xlr.id, placeId: bayC.id, caseId: null, qty: 20 })
  const { items } = await records(s.app)
  const number = (id: string) => items.get(id)!.number
  return { ...s, bayC, y10p, amp, rack, xlr, speakers, rackId, amps, number }
}

/** A phone in the warehouse on 1 October 2026, which can lose its signal. */
async function device(app: FastifyInstance, day = '2026-10-01') {
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
  const client = await new SyncClient({ storage: new MemoryStorage(), transport, now: () => new Date(`${day}T09:00:00Z`) }).open()
  await client.sync()
  return { client, signal }
}

const scan = (
  projectId: string,
  direction: 'out' | 'in',
  what: { assetId: string; modelId: string } | { modelId: string; qty: number },
  at = new Date().toISOString()
): CommandInput<'move.record'> => ({ id: newId(), projectId, direction, assetId: null, qty: 1, ...what, at })

/** A pick list's rows as [product, needed, out, back]. */
const rows = (p: PickList | undefined) => p?.rows.map((r) => [r.model?.name, r.need, r.out, r.back])

describe('scans', () => {
  it('are kept whatever the plan says, with the product the item has, and sent twice are kept once', async () => {
    const { app, y10p, amp, xlr, speakers } = await warehouse()
    const quote = await job(app, 'Fuel', 'quoted', '2026-10-06', '2026-10-06')
    // Not on the kit, the job only a quote, and the phone thinking it's an amp: kept, as a speaker.
    const first = scan(quote, 'out', { assetId: speakers[0]!, modelId: amp.id }, '2026-10-01T10:15:00+01:00')
    await ok(app, 'move.record', first)
    await ok(app, 'move.record', scan(quote, 'out', { modelId: xlr.id, qty: 12 }))
    // Retired, and scanned back in: kept.
    await ok(app, 'asset.retire', { id: speakers[1]!, reason: 'lost', note: '' })
    await ok(app, 'move.record', scan(quote, 'in', { assetId: speakers[1]!, modelId: y10p.id }))

    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      payload: { clientId: 'phone', mutations: [{ id: newId(), name: 'move.record', args: first, createdAt: new Date().toISOString() }] },
    })
    expect(res.json().results[0]).toMatchObject({ status: 'applied' })

    const { moves } = await records(app)
    expect(moves.size).toBe(3)
    expect(moves.get(first.id)).toEqual({ ...first, modelId: y10p.id, at: '2026-10-01T09:15:00.000Z' })
  })

  it('are turned down only when the job, the item or the product was never saved', async () => {
    const { app, y10p, xlr, speakers } = await warehouse()
    const nissan = await job(app, 'Nissan', 'confirmed', '2026-10-06', '2026-10-06')
    expect(await refused(app, 'move.record', scan(newId(), 'out', { assetId: speakers[0]!, modelId: y10p.id }))).toMatch(
      /scanned out for a job that was never saved/
    )
    expect(await refused(app, 'move.record', scan(nissan, 'in', { assetId: newId(), modelId: y10p.id }))).toMatch(
      /An item scanned back in was never added to the stock list/
    )
    expect(await refused(app, 'move.record', scan(nissan, 'out', { modelId: newId(), qty: 2 }))).toMatch(/no longer in the stock list/)
    expect(await refused(app, 'move.record', { ...scan(nissan, 'out', { assetId: speakers[0]!, modelId: y10p.id }), qty: 2 })).toBe(
      'A numbered item is scanned one at a time.'
    )
    expect(await refused(app, 'move.record', { ...scan(nissan, 'out', { modelId: xlr.id, qty: 1 }), at: 'Tuesday' })).toMatch(/datetime/i)
  })

  it('keep a counted product in the stock list, and are described in the history', async () => {
    const { app, db, bayC, y10p, xlr, speakers, number } = await warehouse()
    const nissan = await job(app, 'Nissan', 'confirmed', '2026-10-06', '2026-10-06')
    await ok(app, 'move.record', scan(nissan, 'out', { assetId: speakers[0]!, modelId: y10p.id }))
    await ok(app, 'move.record', scan(nissan, 'out', { modelId: xlr.id, qty: 12 }))
    await ok(app, 'move.record', scan(nissan, 'in', { modelId: xlr.id, qty: 12 }))
    await ok(app, 'move.record', scan(nissan, 'in', { assetId: speakers[0]!, modelId: y10p.id }))
    await ok(app, 'stock.set', { modelId: xlr.id, placeId: bayC.id, caseId: null, qty: 0 })
    expect(await refused(app, 'model.remove', { id: xlr.id })).toBe("XLR 10 m has been out on jobs, which is kept for the record, so it can't be removed.")

    const { entries } = await readHistory(db)
    expect(entries.map((e) => e.what).filter((w) => /out to|back in from/.test(w))).toEqual([
      `Scanned ${number(speakers[0]!)} (d&b Y10P) back in from Nissan`,
      'Counted 12 × XLR 10 m back in from Nissan',
      'Counted 12 × XLR 10 m out to Nissan',
      `Scanned ${number(speakers[0]!)} (d&b Y10P) out to Nissan`,
    ])
  })
})

describe('what a device shows', () => {
  it("a job's pick list: what it needs, where to find it, and what's out, a case taking what's in it along", async () => {
    const { app, y10p, amp, rack, xlr, speakers, rackId, amps, number } = await warehouse()
    const nissan = await job(app, 'Nissan', 'confirmed', '2026-10-06', '2026-10-08')
    // Six speakers, two of them subhired; the two amps; 12 cables; 8 more cables for the show from PRG.
    await ok(app, 'kit.add', kit(nissan, y10p.id, 6, { subhireQty: 2, supplier: 'PRG' }))
    await ok(app, 'kit.add', kit(nissan, amp.id, 2))
    await ok(app, 'kit.add', kit(nissan, xlr.id, 12))
    await ok(app, 'kit.add', kit(nissan, xlr.id, 8, { subhireQty: 8, notes: 'show' }))

    const phone = await device(app)
    let pick = phone.client.view().moves.pickList(nissan)!
    expect(rows(pick)).toEqual([
      ['d&b D80', 2, 0, 0],
      ['d&b Y10P', 4, 0, 0],
      ['XLR 10 m', 12, 0, 0],
    ])
    expect(pick).toMatchObject({ need: 18, out: 0, stillOut: 0 })
    // Where to find them: the speakers in Bay A3, the amps in their rack in Bay A4, the cables counted in Bay C.
    expect(pick.rows.map((r) => r.from.map((f) => [f.where, f.items.map((a) => a.number), f.counted]))).toEqual([
      [[`Bay A4, in ${number(rackId)}`, amps.map(number), 0]],
      [['Bay A3', speakers.map(number), 0]],
      [['Bay C', [], 20]],
    ])

    // Out with no signal: two speakers, the rack with the amps in it, and 12 cables.
    phone.signal.on = false
    for (const id of speakers.slice(0, 2)) await phone.client.mutate('move.record', scan(nissan, 'out', { assetId: id, modelId: y10p.id }))
    await phone.client.mutate('move.record', scan(nissan, 'out', { assetId: rackId, modelId: rack.id }))
    await phone.client.mutate('move.record', scan(nissan, 'out', { modelId: xlr.id, qty: 12 }))
    pick = phone.client.view().moves.pickList(nissan)!
    expect(rows(pick)).toEqual([
      ['d&b D80', 2, 2, 0],
      ['d&b Y10P', 4, 2, 0],
      ['XLR 10 m', 12, 12, 0],
      // The rack isn't on the kit: what's in it is.
      ['Amp rack', 0, 1, 0],
    ])
    expect(pick).toMatchObject({ need: 18, out: 16, stillOut: 17 })
    expect(pick.rows[0]!.from).toEqual([])
    expect(pick.rows[1]!.from.map((f) => [f.where, f.items.map((a) => a.number)])).toEqual([['Bay A3', speakers.slice(2).map(number)]])
    expect(phone.client.view().moves.outOf(amps[0]!)).toMatchObject({ projectId: nissan, inCase: { id: rackId } })
    expect(phone.client.view().moves.outOf(speakers[0]!)).toMatchObject({ projectId: nissan, inCase: undefined })
    expect(phone.client.view().moves.outOf(speakers[2]!)).toBeUndefined()

    // Synced, and another device sees the same.
    phone.signal.on = true
    await phone.client.sync()
    const office = await device(app)
    expect(rows(office.client.view().moves.pickList(nissan))).toEqual(rows(pick))

    // Back: an amp taken out of the rack on site comes back on its own; the rack, and the rest in it, after.
    await ok(app, 'move.record', scan(nissan, 'in', { assetId: amps[1]!, modelId: amp.id }))
    await office.client.sync()
    expect(rows(office.client.view().moves.pickList(nissan))![0]).toEqual(['d&b D80', 2, 1, 1])
    await ok(app, 'move.record', scan(nissan, 'in', { assetId: rackId, modelId: rack.id }))
    await ok(app, 'move.record', scan(nissan, 'in', { modelId: xlr.id, qty: 10 }))
    await ok(app, 'move.record', scan(nissan, 'in', { assetId: speakers[0]!, modelId: y10p.id }))
    await office.client.sync()
    pick = office.client.view().moves.pickList(nissan)!
    expect(rows(pick)).toEqual([
      ['d&b D80', 2, 0, 2],
      ['d&b Y10P', 4, 1, 1],
      ['XLR 10 m', 12, 2, 10],
      ['Amp rack', 0, 0, 1],
    ])
    expect(pick).toMatchObject({ stillOut: 3, back: 14 })
    expect(pick.rows[1]!.items.map((a) => a.number)).toEqual([number(speakers[1]!)])
  })

  it('goes by when scans happened, not when they synced, and a job can take an item still out with another', async () => {
    const { app, y10p, speakers } = await warehouse()
    const nissan = await job(app, 'Nissan', 'confirmed', '2026-10-06', '2026-10-06')
    const fuel = await job(app, 'Fuel', 'confirmed', '2026-10-09', '2026-10-09')
    const phone = await device(app)
    const van = await device(app)
    // Scanned out at 10:00 on a phone with no signal, and back in at 11:00 on one with.
    phone.signal.on = false
    await phone.client.mutate('move.record', scan(nissan, 'out', { assetId: speakers[0]!, modelId: y10p.id }, '2026-10-06T10:00:00.000Z'))
    await van.client.mutate('move.record', scan(nissan, 'in', { assetId: speakers[0]!, modelId: y10p.id }, '2026-10-06T11:00:00.000Z'))
    phone.signal.on = true
    await van.client.sync()
    await phone.client.sync()
    await van.client.sync()
    for (const d of [phone, van]) {
      expect(d.client.view().moves.outOf(speakers[0]!)).toBeUndefined()
      expect(rows(d.client.view().moves.pickList(nissan))).toEqual([['d&b Y10P', 0, 0, 1]])
    }
    // Out with Nissan, then scanned out for Fuel: it's out with Fuel now, and Nissan counts it as gone from it.
    await ok(app, 'move.record', scan(nissan, 'out', { assetId: speakers[1]!, modelId: y10p.id }, '2026-10-06T12:00:00.000Z'))
    await ok(app, 'move.record', scan(fuel, 'out', { assetId: speakers[1]!, modelId: y10p.id }, '2026-10-08T12:00:00.000Z'))
    await van.client.sync()
    expect(van.client.view().moves.outOf(speakers[1]!)).toMatchObject({ projectId: fuel, since: '2026-10-08T12:00:00.000Z' })
    expect(rows(van.client.view().moves.pickList(nissan))).toEqual([['d&b Y10P', 0, 0, 2]])
    expect(rows(van.client.view().moves.pickList(fuel))).toEqual([['d&b Y10P', 0, 1, 0]])
  })

  it('lists jobs going out in the next two weeks, and jobs over with kit still out', async () => {
    const { app, y10p, xlr, speakers } = await warehouse()
    const on = await job(app, 'On now', 'confirmed', '2026-09-30', '2026-10-02')
    const soon = await job(app, 'Soon', 'confirmed', '2026-10-14', '2026-10-14')
    const quote = await job(app, 'A quote', 'quoted', '2026-10-03', '2026-10-03')
    const far = await job(app, 'Later', 'confirmed', '2026-10-15', '2026-10-15')
    const over = await job(app, 'Over', 'confirmed', '2026-09-20', '2026-09-21')
    const allBack = await job(app, 'All back', 'confirmed', '2026-09-22', '2026-09-22')
    for (const id of [on, soon, quote, far, over, allBack]) await ok(app, 'kit.add', kit(id, y10p.id, 1))
    await ok(app, 'kit.add', kit(on, xlr.id, 4))
    await ok(app, 'move.record', scan(on, 'out', { assetId: speakers[0]!, modelId: y10p.id }))
    await ok(app, 'move.record', scan(over, 'out', { modelId: xlr.id, qty: 3 }))
    await ok(app, 'move.record', scan(allBack, 'out', { assetId: speakers[1]!, modelId: y10p.id }))
    await ok(app, 'move.record', scan(allBack, 'in', { assetId: speakers[1]!, modelId: y10p.id }))

    const office = await device(app)
    const moves = office.client.view().moves
    expect(moves.soon.map((p) => [p.job.name, p.need, p.out])).toEqual([
      ['On now', 5, 1],
      ['Soon', 1, 0],
    ])
    expect(moves.stillOut.map((p) => [p.job.name, p.stillOut])).toEqual([['Over', 3]])
  })
})
