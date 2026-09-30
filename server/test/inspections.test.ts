import {
  MemoryStorage,
  monthsLater,
  newId,
  SyncClient,
  type Asset,
  type CommandInput,
  type CommandName,
  type Inspection,
  type Model,
  type Movement,
  type MutationResult,
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
 * Inspections (ADR 0020): a product says how often its items need an
 * electrical test (PAT) or a thorough examination; each one done is kept,
 * as a scan is; and each device works out when each item is next due. An
 * item whose last one failed, or that's overdue, can't go out, and comes
 * off what's free for jobs; one never recorded here is listed, not stopped.
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
  const inspections = new Map<string, Inspection>()
  const models = new Map<string, Model>()
  for (const c of (res.json() as PullResponse).changes) {
    if (c.entity === 'movement') moves.set(c.id, c.data as Movement)
    if (c.entity === 'asset') items.set(c.id, c.data as Asset)
    if (c.entity === 'inspection') inspections.set(c.id, c.data as Inspection)
    if (c.entity === 'model') models.set(c.id, c.data as Model)
  }
  return { moves, items, inspections, models }
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

const test = (
  assetId: string,
  passed: boolean,
  at: string,
  extra: Partial<CommandInput<'inspection.record'>> = {}
): CommandInput<'inspection.record'> => ({ id: newId(), assetId, kind: 'pat', passed, at, by: '', note: '', ...extra })

describe('months later', () => {
  it('keeps the day, or takes the last of a shorter month', () => {
    expect(monthsLater('2026-03-15', 12)).toBe('2027-03-15')
    expect(monthsLater('2026-08-31', 6)).toBe('2027-02-28')
    expect(monthsLater('2027-08-31', 6)).toBe('2028-02-29')
    expect(monthsLater('2026-11-30', 3)).toBe('2027-02-28')
  })
})

describe('inspections', () => {
  it('are kept as done, once each, and turned down only for an item never saved or retired', async () => {
    const { app, y10p, speakers, number } = await warehouse()
    await ok(app, 'model.update', { id: y10p.id, patMonths: 12 })
    const first = test(speakers[0]!, true, '2026-09-30T10:00:00+01:00', { by: ' Sparks Testing Ltd ', note: '' })
    await ok(app, 'inspection.record', first)
    await ok(app, 'inspection.record', first)
    const { inspections, models } = await records(app)
    expect([...inspections.values()]).toEqual([{ ...first, by: 'Sparks Testing Ltd', at: '2026-09-30T09:00:00.000Z' }])
    expect(models.get(y10p.id)).toMatchObject({ patMonths: 12, liftingMonths: null })

    expect(await refused(app, 'inspection.record', test(newId(), true, new Date().toISOString()))).toBe(
      "An item's PAT was for an item never added to the stock list, so it wasn't kept. Add the item, then record it again."
    )
    await ok(app, 'asset.retire', { id: speakers[1]!, reason: 'sold', note: '' })
    expect(await refused(app, 'inspection.record', test(speakers[1]!, true, new Date().toISOString(), { kind: 'lifting' }))).toBe(
      `${number(speakers[1]!)} is marked as sold, so its thorough examination wasn't kept. Bring it back first if it's still here.`
    )
    expect(await refused(app, 'model.update', { id: y10p.id, patMonths: 0 })).toMatch(/greater than or equal to 1/)
  })

  it('are described in the history, with the product\'s intervals', async () => {
    const { app, db, y10p, speakers, number } = await warehouse()
    await ok(app, 'model.update', { id: y10p.id, patMonths: 12, liftingMonths: 6 })
    await ok(app, 'model.update', { id: y10p.id, liftingMonths: null })
    await ok(app, 'inspection.record', test(speakers[0]!, true, '2026-09-30T10:00:00+01:00', { by: 'Sparks Testing Ltd' }))
    await ok(app, 'inspection.record', test(speakers[1]!, false, '2026-09-29T12:00:00Z', { kind: 'lifting', note: 'Eyebolt worn' }))
    const { entries } = await readHistory(db)
    expect(entries.filter((e) => e.outcome === 'done').slice(0, 4).map((e) => e.what)).toEqual([
      `Recorded ${number(speakers[1]!)} (d&b Y10P) failing its thorough examination on Tue 29 Sep: Eyebolt worn`,
      `Recorded ${number(speakers[0]!)} (d&b Y10P) passing its PAT on Wed 30 Sep by Sparks Testing Ltd`,
      'Changed the product d&b Y10P: no thorough examination',
      'Changed the product d&b Y10P: a PAT every 12 months and a thorough examination every 6 months',
    ])
  })
})

describe('what a device shows', () => {
  it("when each item is next due, and one failed or overdue can't go out", async () => {
    const { app, y10p, speakers, number } = await warehouse()
    const nissan = await job(app, 'Nissan', 'confirmed', '2026-10-06', '2026-10-06')
    await ok(app, 'kit.add', kit(nissan, y10p.id, 4))
    const phone = await device(app)
    // Nothing needs testing yet: nothing to say.
    expect(phone.client.view().inspections.dueOf(speakers[0]!)).toEqual([])

    await ok(app, 'model.update', { id: y10p.id, patMonths: 12 })
    // Passed on 2 Oct last year: due 2 Oct, within the month. Passed in March: fine. Failed: stopped. None here: listed, not stopped.
    await ok(app, 'inspection.record', test(speakers[0]!, true, '2025-10-02T10:00:00Z'))
    await ok(app, 'inspection.record', test(speakers[1]!, true, '2026-03-01T10:00:00Z'))
    await ok(app, 'inspection.record', test(speakers[2]!, true, '2026-09-01T10:00:00Z'))
    await ok(app, 'inspection.record', test(speakers[2]!, false, '2026-09-01T11:00:00Z', { note: 'Earth fault' }))
    await phone.client.sync()
    let view = phone.client.view()
    const states = () => speakers.map((id) => phone.client.view().inspections.dueOf(id).map((d) => [d.state, d.due]))
    expect(states()).toEqual([[['soon', '2026-10-02']], [['ok', '2027-03-01']], [['failed', undefined]], [['unrecorded', undefined]]])
    expect(view.inspections.attention.map((d) => [number(d.asset.id), d.state])).toEqual([
      [number(speakers[2]!), 'failed'],
      [number(speakers[0]!), 'soon'],
    ])
    expect(view.inspections.unrecorded.map((d) => number(d.asset.id))).toEqual([number(speakers[3]!)])
    expect(view.faults.unusable(y10p.id)).toBe(1)
    expect(view.kit.lines.map((l) => [l.owned, l.unusable, l.short])).toEqual([[3, 1, 1]])
    expect(view.moves.pickList(nissan)!.rows[0]!.from.flatMap((f) => f.items.map((a) => a.number))).not.toContain(number(speakers[2]!))

    // Retested with no signal: passed. A year on, the first is overdue.
    phone.signal.on = false
    await phone.client.mutate('inspection.record', test(speakers[2]!, true, '2026-09-30T09:00:00Z'))
    expect(states()[2]).toEqual([['ok', '2027-09-30']])
    expect(phone.client.view().inspections.ofAsset(speakers[2]!).map((i) => [i.passed, i.pending])).toEqual([
      [true, true],
      [false, false],
      [true, false],
    ])
    expect(phone.client.view().kit.lines[0]!.short).toBe(0)
    const later = await device(app, '2026-10-03')
    expect(later.client.view().inspections.blocks(speakers[0]!)).toMatchObject({ state: 'overdue', due: '2026-10-02' })
  })
})
