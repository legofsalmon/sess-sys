import {
  MemoryStorage,
  newId,
  SyncClient,
  type Asset,
  type CommandInput,
  type CommandName,
  type Fault,
  type Model,
  type Movement,
  type MutationResult,
  type PickList,
  type ProjectStatus,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type Stock,
  type Transport,
} from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb } from '../src/db.ts'
import { readHistory } from '../src/history.ts'

/**
 * Faults and missing kit (ADR 0018): every report is kept, as a scan is;
 * closing one says how it ended, and writing off retires an item or takes
 * counted kit off the count. Kit that can't go out comes off what's free
 * for jobs and out of the pick list's places, and kit reported missing
 * from a job isn't out with it any more, nor back, until it's found.
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
  const faults = new Map<string, Fault>()
  const stock = new Map<string, Stock | null>()
  for (const c of (res.json() as PullResponse).changes) {
    if (c.entity === 'movement') moves.set(c.id, c.data as Movement)
    if (c.entity === 'asset') items.set(c.id, c.data as Asset)
    if (c.entity === 'fault') faults.set(c.id, c.data as Fault)
    if (c.entity === 'stock') stock.set(c.id, c.op === 'put' ? (c.data as Stock) : null)
  }
  return { moves, items, faults, stock }
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


const report = (
  kind: 'damaged' | 'missing',
  what: { assetId: string; modelId: string } | { modelId: string; qty: number },
  extra: Partial<CommandInput<'fault.report'>> = {}
): CommandInput<'fault.report'> => ({
  id: newId(),
  kind,
  assetId: null,
  qty: 1,
  projectId: null,
  usable: false,
  note: '',
  at: new Date().toISOString(),
  ...what,
  ...extra,
})

const close = (id: string, outcome: CommandInput<'fault.close'>['outcome']): CommandInput<'fault.close'> => ({ id, outcome, at: new Date().toISOString() })

/** A pick list's rows as [product, needed, out, back, missing]. */
const rows = (p: PickList | undefined) => p?.rows.map((r) => [r.model?.name, r.need, r.out, r.back, r.missing])

describe('reports', () => {
  it('are kept whatever the plan says, with the product the item has, and sent twice are kept once', async () => {
    const { app, amp, speakers, y10p } = await warehouse()
    const nissan = await job(app, 'Nissan', 'confirmed', '2026-10-06', '2026-10-06')
    // Not on the job's kit, never out with it, and the phone thinking it's an amp: kept, as a speaker.
    const first = report('damaged', { assetId: speakers[0]!, modelId: amp.id }, { projectId: nissan, note: ' Rattles at high level ', at: '2026-10-07T09:30:00+01:00' })
    await ok(app, 'fault.report', first)
    await ok(app, 'fault.report', first)
    const { faults } = await records(app)
    expect([...faults.values()]).toEqual([
      {
        ...first,
        modelId: y10p.id,
        note: 'Rattles at high level',
        repair: '',
        at: '2026-10-07T08:30:00.000Z',
        outcome: null,
        closedAt: null,
      },
    ])
  })

  it('are turned down only for what was never saved, or an item already retired', async () => {
    const { app, y10p, xlr, speakers, number } = await warehouse()
    expect(await refused(app, 'fault.report', report('damaged', { assetId: newId(), modelId: y10p.id }))).toMatch(/was never added to the stock list/)
    expect(await refused(app, 'fault.report', report('missing', { modelId: newId(), qty: 2 }))).toMatch(/no longer in the stock list/)
    expect(await refused(app, 'fault.report', report('missing', { modelId: xlr.id, qty: 2 }, { projectId: newId() }))).toBe(
      "2 × XLR 10 m was reported for a job that was never saved, so the report wasn't kept. Report it again on the job."
    )
    await ok(app, 'asset.retire', { id: speakers[0]!, reason: 'sold', note: '' })
    expect(await refused(app, 'fault.report', report('damaged', { assetId: speakers[0]!, modelId: y10p.id }))).toBe(
      `${number(speakers[0]!)} is marked as sold, so the report wasn't kept. Bring it back first if it's still here.`
    )
    expect(await refused(app, 'fault.report', report('damaged', { assetId: speakers[1]!, modelId: y10p.id }, { qty: 2 }))).toBe(
      'A numbered item is reported one at a time.'
    )
    expect(await refused(app, 'fault.report', report('missing', { modelId: xlr.id, qty: 1 }, { usable: true }))).toBe("Missing kit can't go out.")
  })

  it('are updated, and closed once, in a way that fits', async () => {
    const { app, y10p, speakers } = await warehouse()
    const damaged = report('damaged', { assetId: speakers[0]!, modelId: y10p.id }, { note: 'Grille dented' })
    const missing = report('missing', { assetId: speakers[1]!, modelId: y10p.id })
    await ok(app, 'fault.report', damaged)
    await ok(app, 'fault.report', missing)
    await ok(app, 'fault.update', { id: damaged.id, usable: true, repair: 'Grille knocked back out; sounds fine.' })
    expect(await refused(app, 'fault.update', { id: missing.id, usable: true })).toBe("Missing kit can't go out until it's found.")
    expect(await refused(app, 'fault.close', close(damaged.id, 'found'))).toBe('Damaged kit is fixed, not faulty, or written off, not found.')
    expect(await refused(app, 'fault.close', close(missing.id, 'fixed'))).toBe('Missing kit is found or written off, not fixed.')
    await ok(app, 'fault.close', close(damaged.id, 'fixed'))
    // Closed the same way twice, on two phones: fine. Another way: said.
    await ok(app, 'fault.close', close(damaged.id, 'fixed'))
    expect(await refused(app, 'fault.close', close(damaged.id, 'written-off'))).toMatch(/that fault was already closed as fixed\.$/)
    await ok(app, 'fault.close', close(missing.id, 'found'))
    expect(await refused(app, 'fault.close', close(newId(), 'fixed'))).toBe('That fault was never saved.')

    const { faults, items } = await records(app)
    expect(faults.get(damaged.id)).toMatchObject({ usable: true, repair: 'Grille knocked back out; sounds fine.', outcome: 'fixed' })
    expect(faults.get(damaged.id)!.closedAt).toMatch(/Z$/)
    expect(faults.get(missing.id)).toMatchObject({ usable: false, outcome: 'found' })
    // Nothing written off, nothing retired.
    expect(items.get(speakers[0]!)!.status).toBe('active')
  })

  it('written off retire an item, or take counted kit off the count from the biggest counts first', async () => {
    const { app, db, bayC, y10p, rack, xlr, speakers, rackId, number } = await warehouse()
    const bayD = { id: newId(), name: 'Bay D', notes: '' }
    await ok(app, 'place.upsert', bayD)
    await ok(app, 'stock.set', { modelId: xlr.id, placeId: bayD.id, caseId: null, qty: 5 })
    const nissan = await job(app, 'Nissan', 'confirmed', '2026-10-06', '2026-10-06')

    const blown = report('damaged', { assetId: speakers[0]!, modelId: y10p.id }, { projectId: nissan, note: 'Blown driver' })
    const lost = report('missing', { assetId: speakers[1]!, modelId: y10p.id }, { projectId: nissan })
    const cables = report('damaged', { modelId: xlr.id, qty: 22 }, { note: 'Cut' })
    const caseGone = report('missing', { assetId: rackId, modelId: rack.id })
    for (const r of [blown, lost, cables, caseGone]) await ok(app, 'fault.report', r)
    for (const r of [blown, lost, cables]) await ok(app, 'fault.close', close(r.id, 'written-off'))
    expect(await refused(app, 'fault.close', close(caseGone.id, 'written-off'))).toBe(`${number(rackId)} still holds 2 items. Empty it first.`)

    const { items, stock } = await records(app)
    expect(items.get(speakers[0]!)).toMatchObject({ status: 'retired', retiredReason: 'scrapped', retiredNote: 'Blown driver' })
    expect(items.get(speakers[1]!)).toMatchObject({ status: 'retired', retiredReason: 'lost', retiredNote: null })
    // 22 of 25: all 20 in Bay C, then 2 of the 5 in Bay D.
    expect([...stock.values()].filter((s) => s?.modelId === xlr.id)).toEqual([expect.objectContaining({ placeId: bayD.id, qty: 3 })])
    expect(stock.get(`${xlr.id}@p:${bayC.id}`)).toBeNull()

    // With none left counted, the product keeps its record of faults.
    await ok(app, 'stock.set', { modelId: xlr.id, placeId: bayD.id, caseId: null, qty: 0 })
    expect(await refused(app, 'model.remove', { id: xlr.id })).toBe("XLR 10 m has had faults reported, which are kept for the record, so it can't be removed.")

    const { entries } = await readHistory(db)
    expect(entries.filter((e) => e.outcome === 'done').map((e) => e.what).filter((w) => /Reported|Wrote off/.test(w))).toEqual([
      'Wrote off 22 × XLR 10 m',
      `Wrote off ${number(speakers[1]!)} (d&b Y10P)`,
      `Wrote off ${number(speakers[0]!)} (d&b Y10P)`,
      `Reported ${number(rackId)} (Amp rack) missing`,
      "Reported 22 × XLR 10 m damaged, can't go out: Cut",
      `Reported ${number(speakers[1]!)} (d&b Y10P) missing from Nissan`,
      `Reported ${number(speakers[0]!)} (d&b Y10P) damaged back from Nissan, can't go out: Blown driver`,
    ])
  })
})

describe('what a device shows', () => {
  it("kit that can't go out comes off what's free for jobs and out of where to find it", async () => {
    const { app, y10p, xlr, speakers, number } = await warehouse()
    const nissan = await job(app, 'Nissan', 'confirmed', '2026-10-06', '2026-10-06')
    await ok(app, 'kit.add', kit(nissan, y10p.id, 4))
    await ok(app, 'kit.add', kit(nissan, xlr.id, 20))
    const phone = await device(app)
    expect(phone.client.view().kit.short).toEqual([])

    // Reported with no signal: one speaker blown, one scuffed but fine, one missing; 3 cables cut.
    phone.signal.on = false
    const blown = report('damaged', { assetId: speakers[0]!, modelId: y10p.id }, { note: 'Blown driver' })
    await phone.client.mutate('fault.report', blown)
    await phone.client.mutate('fault.report', report('damaged', { assetId: speakers[1]!, modelId: y10p.id }, { usable: true, note: 'Scuffed' }))
    await phone.client.mutate('fault.report', report('missing', { assetId: speakers[2]!, modelId: y10p.id }))
    await phone.client.mutate('fault.report', report('damaged', { modelId: xlr.id, qty: 3 }, { note: 'Cut' }))
    let view = phone.client.view()
    expect(view.faults.open.map((f) => [f.asset?.number ?? f.model?.name, f.kind, f.stops, f.pending])).toEqual([
      [number(speakers[0]!), 'damaged', true, true],
      [number(speakers[1]!), 'damaged', false, true],
      [number(speakers[2]!), 'missing', true, true],
      ['XLR 10 m', 'damaged', true, true],
    ])
    expect(view.faults.unusable(y10p.id)).toBe(2)
    expect(view.faults.stopping(speakers[2]!)?.kind).toBe('missing')
    expect(view.kit.short.map((l) => [l.model?.name, l.owned, l.unusable, l.short])).toEqual([
      ['d&b Y10P', 2, 2, 2],
      ['XLR 10 m', 17, 3, 3],
    ])
    const pick = view.moves.pickList(nissan)!
    expect(pick.rows.map((r) => [r.model?.name, r.unusable, r.from.flatMap((f) => f.items.map((a) => a.number))])).toEqual([
      ['d&b Y10P', 2, [number(speakers[1]!), number(speakers[3]!)]],
      ['XLR 10 m', 3, []],
    ])

    // Synced, fixed on the bench, and seen by the office.
    phone.signal.on = true
    await phone.client.sync()
    await ok(app, 'fault.close', close(blown.id, 'fixed'))
    const office = await device(app)
    view = office.client.view()
    expect(view.faults.open).toHaveLength(3)
    expect(view.faults.ofAsset(speakers[0]!).map((f) => [f.outcome, f.open])).toEqual([['fixed', false]])
    expect(view.faults.ofModel(xlr.id).map((f) => f.qty)).toEqual([3])
    expect(view.kit.short.map((l) => [l.model?.name, l.short])).toEqual([
      ['d&b Y10P', 1],
      ['XLR 10 m', 3],
    ])
  })

  it("kit reported missing from a job isn't out with it, nor back, until it's found", async () => {
    const { app, y10p, amp, rack, xlr, speakers, rackId, amps } = await warehouse()
    const nissan = await job(app, 'Nissan', 'confirmed', '2026-09-20', '2026-09-21')
    await ok(app, 'kit.add', kit(nissan, y10p.id, 2))
    await ok(app, 'kit.add', kit(nissan, amp.id, 2))
    await ok(app, 'kit.add', kit(nissan, xlr.id, 12))
    const at = (h: number) => `2026-09-2${h < 12 ? 0 : 2}T${String(h % 12).padStart(2, '0')}:00:00.000Z`
    for (const id of speakers.slice(0, 2)) await ok(app, 'move.record', scan(nissan, 'out', { assetId: id, modelId: y10p.id }, at(8)))
    await ok(app, 'move.record', scan(nissan, 'out', { assetId: rackId, modelId: rack.id }, at(8)))
    await ok(app, 'move.record', scan(nissan, 'out', { modelId: xlr.id, qty: 12 }, at(8)))
    // Back: one speaker and 9 cables; the other speaker, the rack with its amps, and 3 cables didn't come back.
    await ok(app, 'move.record', scan(nissan, 'in', { assetId: speakers[0]!, modelId: y10p.id }, at(13)))
    await ok(app, 'move.record', scan(nissan, 'in', { modelId: xlr.id, qty: 9 }, at(13)))
    const phone = await device(app)
    expect(phone.client.view().moves.stillOut.map((p) => [p.job.name, p.stillOut])).toEqual([['Nissan', 7]])

    phone.signal.on = false
    const speaker = report('missing', { assetId: speakers[1]!, modelId: y10p.id }, { projectId: nissan, at: at(14) })
    const cables = report('missing', { modelId: xlr.id, qty: 3 }, { projectId: nissan, at: at(14) })
    await phone.client.mutate('fault.report', speaker)
    await phone.client.mutate('fault.report', cables)
    await phone.client.mutate('fault.report', report('missing', { assetId: rackId, modelId: rack.id }, { projectId: nissan, at: at(14) }))
    let moves = phone.client.view().moves
    expect(rows(moves.pickList(nissan))).toEqual([
      ['d&b D80', 2, 0, 0, 2],
      ['d&b Y10P', 2, 0, 1, 1],
      ['XLR 10 m', 12, 0, 9, 3],
      ['Amp rack', 0, 0, 0, 1],
    ])
    expect(moves.pickList(nissan)).toMatchObject({ stillOut: 0, back: 10, missing: 7 })
    expect(moves.stillOut).toEqual([])
    expect(moves.outOf(amps[0]!)).toBeUndefined()
    // The rack's missing, so the amps in it are too.
    expect(phone.client.view().faults.stopping(amps[0]!)?.assetId).toBe(rackId)
    expect(phone.client.view().faults.unusable(amp.id)).toBe(2)

    // Found: the speaker turned up in the van, and the cables with it.
    phone.signal.on = true
    await phone.client.sync()
    await phone.client.mutate('fault.close', close(speaker.id, 'found'))
    await phone.client.mutate('fault.close', close(cables.id, 'found'))
    moves = phone.client.view().moves
    expect(rows(moves.pickList(nissan))!.slice(1, 3)).toEqual([
      ['d&b Y10P', 2, 0, 2, 0],
      ['XLR 10 m', 12, 0, 12, 0],
    ])
    // And a missing item scanned out again later is out again.
    await ok(app, 'move.record', scan(nissan, 'out', { assetId: rackId, modelId: rack.id }, at(15)))
    await phone.client.sync()
    expect(phone.client.view().moves.outOf(amps[1]!)).toMatchObject({ projectId: nissan, inCase: { id: rackId } })
  })
})
