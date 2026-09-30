import {
  MemoryStorage,
  newId,
  SyncClient,
  type CommandInput,
  type CommandName,
  type KitLine,
  type KitLineView,
  type Model,
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
 * Kit on jobs (ADR 0014): what a job needs, whether there's enough on its
 * days once the other jobs have theirs, and subhire. The server keeps the
 * lines tidy and never turns one down for being short; each device works
 * out what's short from what it has.
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

async function lines(app: FastifyInstance): Promise<Map<string, KitLine>> {
  const res = await app.inject({ method: 'GET', url: '/api/sync/pull?after=0' })
  const out = new Map<string, KitLine>()
  for (const c of (res.json() as PullResponse).changes) {
    if (c.entity !== 'kitLine') continue
    if (c.op === 'delete') out.delete(c.id)
    else out.set(c.id, c.data as KitLine)
  }
  return out
}

const product = (name: string, extra: Partial<Model> = {}): CommandInput<'model.create'> => ({
  id: newId(),
  name,
  department: 'audio',
  category: '',
  tracking: 'bulk',
  isCase: false,
  valueCents: null,
  notes: '',
  ...extra,
})

/** A job and its phases, as [name, first day, last day]. */
async function job(app: FastifyInstance, name: string, status: ProjectStatus, phases: [string, string, string][]) {
  const id = newId()
  await ok(app, 'project.create', { id, name, clientId: null, venueId: null, status, notes: '' })
  const ids: Record<string, string> = {}
  for (const [phase, start, end] of phases) {
    ids[phase] = newId()
    await ok(app, 'phase.add', { id: ids[phase]!, projectId: id, name: phase, start, end, venueId: null, notes: '' })
  }
  return { id, phases: ids }
}

const line = (projectId: string, modelId: string, qty: number, extra: Partial<CommandInput<'kit.add'>> = {}): CommandInput<'kit.add'> => ({
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

/** A stock list with 10 × d&b Y10P and 10 × XLR 10 m counted in the warehouse. */
async function warehouse() {
  const s = await server()
  const place = { id: newId(), name: 'Warehouse', notes: '' }
  const y10p = product('d&b Y10P', { tracking: 'serialised', category: 'Speakers' })
  const xlr = product('XLR 10 m', { category: 'Cables' })
  const sharpy = product('Clay Paky Sharpy', { department: 'lighting', tracking: 'serialised' })
  await ok(s.app, 'place.upsert', place)
  for (const p of [y10p, xlr, sharpy]) await ok(s.app, 'model.create', p)
  for (const p of [y10p, xlr]) await ok(s.app, 'stock.set', { modelId: p.id, placeId: place.id, caseId: null, qty: 10 })
  return { ...s, place, y10p, xlr, sharpy }
}

/** A laptop in the office on 1 October 2026, which can lose its signal. */
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

/** The state of a line as a device shows it. */
const state = (v: KitLineView | undefined) =>
  v && {
    short: v.short,
    shortDay: v.shortDay,
    shortDays: v.shortDays,
    ifPencilled: v.ifPencilled,
    pencilledDay: v.pencilledDay,
    spare: v.spare,
    others: v.others.map((o) => [o.name, o.qty, o.hold]),
  }

describe('kit lines', () => {
  it('go on a job for the whole job or a phase, change field by field, and come off', async () => {
    const { app, y10p, xlr } = await warehouse()
    const nissan = await job(app, 'Nissan', 'confirmed', [
      ['Build', '2026-10-06', '2026-10-07'],
      ['Show', '2026-10-08', '2026-10-08'],
    ])
    const pa = line(nissan.id, y10p.id, 8)
    const cables = line(nissan.id, xlr.id, 20, { phaseId: nissan.phases.Show!, subhireQty: 10, supplier: ' PRG ', notes: 'For the side stage' })
    await ok(app, 'kit.add', pa)
    await ok(app, 'kit.add', cables)
    // Short is never a reason to refuse: 20 cables when 10 are counted.
    expect((await lines(app)).get(cables.id)).toEqual({ ...cables, supplier: 'PRG' })

    await ok(app, 'kit.update', { id: pa.id, qty: 12 })
    await ok(app, 'kit.update', { id: cables.id, phaseId: null, subhireQty: 0, supplier: '' })
    const now = await lines(app)
    expect(now.get(pa.id)).toMatchObject({ qty: 12, phaseId: null, subhireQty: 0 })
    expect(now.get(cables.id)).toMatchObject({ qty: 20, phaseId: null, subhireQty: 0, supplier: '', notes: 'For the side stage' })

    await ok(app, 'kit.remove', { id: pa.id })
    await ok(app, 'kit.remove', { id: pa.id })
    expect([...(await lines(app)).keys()]).toEqual([cables.id])
  })

  it('need a job, a phase of that job and a product, and no more subhired than needed', async () => {
    const { app, y10p } = await warehouse()
    const nissan = await job(app, 'Nissan', 'confirmed', [['Show', '2026-10-08', '2026-10-08']])
    const fuel = await job(app, 'Fuel', 'confirmed', [['Build', '2026-10-08', '2026-10-09']])

    expect(await refused(app, 'kit.add', line(newId(), y10p.id, 4))).toBe('That job no longer exists.')
    expect(await refused(app, 'kit.add', line(nissan.id, newId(), 4))).toBe('That product is no longer in the stock list.')
    expect(await refused(app, 'kit.add', line(nissan.id, y10p.id, 4, { phaseId: fuel.phases.Build! }))).toBe('Build is part of another job.')
    expect(await refused(app, 'kit.add', line(nissan.id, y10p.id, 4, { phaseId: newId() }))).toBe(
      'That phase no longer exists. Put the kit on the whole job or another phase.'
    )
    expect(await refused(app, 'kit.add', line(nissan.id, y10p.id, 4, { subhireQty: 5 }))).toBe("More can't be subhired than the job needs.")

    // One person lowers how many while another subhires the old number: the second is told why.
    const pa = line(nissan.id, y10p.id, 8)
    await ok(app, 'kit.add', pa)
    await ok(app, 'kit.update', { id: pa.id, qty: 4 })
    expect(await refused(app, 'kit.update', { id: pa.id, subhireQty: 6, supplier: 'PRG' })).toBe(
      'The job needs 4 × d&b Y10P now, so no more than 4 can be subhired.'
    )
    expect(await refused(app, 'kit.update', { id: newId(), qty: 2 })).toBe('That kit is no longer on the job.')
  })

  it('keep their phase and their product: neither can go while the kit is on a job', async () => {
    const { app, place, y10p } = await warehouse()
    const nissan = await job(app, 'Nissan', 'confirmed', [
      ['Build', '2026-10-06', '2026-10-07'],
      ['Show', '2026-10-08', '2026-10-08'],
    ])
    const monitors = line(nissan.id, y10p.id, 4, { phaseId: nissan.phases.Show! })
    await ok(app, 'kit.add', monitors)
    expect(await refused(app, 'phase.remove', { id: nissan.phases.Show! })).toBe(
      'Show still has kit: 4 × d&b Y10P. Put it on the whole job or take it off first.'
    )
    await ok(app, 'kit.update', { id: monitors.id, phaseId: null })
    await ok(app, 'phase.remove', { id: nissan.phases.Show! })

    await ok(app, 'stock.set', { modelId: y10p.id, placeId: place.id, caseId: null, qty: 0 })
    expect(await refused(app, 'model.remove', { id: y10p.id })).toBe('d&b Y10P is on the kit for Nissan. Take it off that job first.')
    await ok(app, 'kit.remove', { id: monitors.id })
    await ok(app, 'model.remove', { id: y10p.id })
  })

  it('are described in the history', async () => {
    const { app, db, y10p, xlr } = await warehouse()
    const nissan = await job(app, 'Nissan', 'confirmed', [['Show', '2026-10-08', '2026-10-08']])
    const pa = line(nissan.id, y10p.id, 8)
    await ok(app, 'kit.add', pa)
    await ok(app, 'kit.add', line(nissan.id, xlr.id, 20, { phaseId: nissan.phases.Show!, subhireQty: 10, supplier: 'PRG' }))
    await ok(app, 'kit.update', { id: pa.id, qty: 10, subhireQty: 2, supplier: 'Audio Rent' })
    await ok(app, 'kit.update', { id: pa.id, phaseId: nissan.phases.Show!, notes: 'Spares' })
    await ok(app, 'kit.remove', { id: pa.id })

    const { entries } = await readHistory(db)
    expect(entries.slice(0, 5).map((e) => e.what)).toEqual([
      'Took d&b Y10P off the kit for Nissan',
      'Changed d&b Y10P on the kit for Nissan: for Show and the note',
      'Changed d&b Y10P on the kit for Nissan: how many to 10, 2 subhired and subhired from Audio Rent',
      'Added 20 × XLR 10 m to the kit for Nissan, for Show, 10 subhired from PRG',
      'Added 8 × d&b Y10P to the kit for Nissan, whole job',
    ])
  })
})

describe('what a device shows', () => {
  it('finds a shortage on the days two confirmed jobs share, gaps in a job included, and subhire sorts it', async () => {
    const { app, y10p } = await warehouse()
    // Nissan keeps its PA on site from the Build to the Show, days between included.
    const nissan = await job(app, 'Nissan', 'confirmed', [
      ['Build', '2026-10-06', '2026-10-07'],
      ['Show', '2026-10-10', '2026-10-11'],
    ])
    const fuel = await job(app, 'Fuel', 'confirmed', [['Show', '2026-10-08', '2026-10-08']])
    const pa = line(nissan.id, y10p.id, 8)
    const monitors = line(fuel.id, y10p.id, 4)
    await ok(app, 'kit.add', pa)
    await ok(app, 'kit.add', monitors)

    const office = await device(app)
    let kit = office.client.view().kit
    const find = (id: string) => kit.lines.find((l) => l.id === id)
    expect(find(pa.id)).toMatchObject({ span: { start: '2026-10-06', end: '2026-10-11' }, own: 8, owned: 10, hold: 'held' })
    expect(state(find(pa.id))).toEqual({
      short: 2,
      shortDay: '2026-10-08',
      shortDays: 1,
      ifPencilled: 0,
      pencilledDay: undefined,
      spare: undefined,
      others: [['Fuel', 4, 'held']],
    })
    expect(state(find(monitors.id))).toMatchObject({ short: 2, shortDay: '2026-10-08', others: [['Nissan', 8, 'held']] })
    expect(kit.short.map((l) => [l.job?.name, l.shortDay])).toEqual([
      ['Fuel', '2026-10-08'],
      ['Nissan', '2026-10-08'],
    ])
    expect(kit.byModel.get(y10p.id)!.map((l) => l.job?.name)).toEqual(['Nissan', 'Fuel'])

    // Two hired in for Fuel: nothing short, and nothing to spare on the day.
    await office.client.mutate('kit.update', { id: monitors.id, subhireQty: 2, supplier: 'PRG' })
    kit = office.client.view().kit
    expect(find(monitors.id)).toMatchObject({ pending: true, own: 2 })
    expect(state(find(pa.id))).toMatchObject({ short: 0, spare: 0 })
    expect(state(find(monitors.id))).toMatchObject({ short: 0, spare: 0 })
    expect(kit.short).toEqual([])
    expect(kit.suppliers).toEqual(['PRG'])
  })

  it('checks enquiries and quotes as if they went ahead, without counting them as taken', async () => {
    const { app, xlr } = await warehouse()
    const nissan = await job(app, 'Nissan', 'confirmed', [['Show', '2026-10-06', '2026-10-11']])
    const quote = await job(app, 'Electric Picnic', 'quoted', [['Show', '2026-10-10', '2026-10-10']])
    const cables = line(nissan.id, xlr.id, 6)
    const more = line(quote.id, xlr.id, 6)
    await ok(app, 'kit.add', cables)
    await ok(app, 'kit.add', more)

    const kit = (await device(app)).client.view().kit
    const find = (id: string) => kit.lines.find((l) => l.id === id)
    // Nissan has enough, unless the quote goes ahead.
    expect(state(find(cables.id))).toEqual({
      short: 0,
      shortDay: undefined,
      shortDays: 0,
      ifPencilled: 2,
      pencilledDay: '2026-10-10',
      spare: 4,
      others: [['Electric Picnic', 6, 'pencilled']],
    })
    // The quote would be short if it went ahead.
    expect(find(more.id)).toMatchObject({ hold: 'pencilled', short: 2, shortDay: '2026-10-10' })
    expect(kit.short.map((l) => l.job?.name)).toEqual(['Electric Picnic'])
  })

  it('leaves out cancelled jobs, days gone by and jobs with no dates, and shows kit added with no signal', async () => {
    const { app, y10p, xlr, sharpy } = await warehouse()
    const nissan = await job(app, 'Nissan', 'confirmed', [['Show', '2026-10-06', '2026-10-09']])
    const fuel = await job(app, 'Fuel', 'confirmed', [['Show', '2026-10-06', '2026-10-06']])
    const later = await job(app, 'Tour', 'enquiry', [])
    const pa = line(nissan.id, y10p.id, 8)
    await ok(app, 'kit.add', pa)
    await ok(app, 'kit.add', line(fuel.id, y10p.id, 4))
    await ok(app, 'kit.add', line(later.id, y10p.id, 40))

    // On the 7th, Fuel's day has gone, so Nissan has enough.
    const office = await device(app, '2026-10-07')
    let kit = office.client.view().kit
    expect(state(kit.lines.find((l) => l.id === pa.id))).toMatchObject({ short: 0, spare: 2, others: [] })
    // The tour has no dates yet, so it's checked against nothing, and listed last.
    expect(kit.lines.find((l) => l.projectId === later.id)).toMatchObject({ span: undefined, short: 0, spare: undefined })
    expect(kit.byModel.get(y10p.id)!.map((l) => l.job?.name)).toEqual(['Nissan', 'Tour'])

    // Cancelled, Nissan holds nothing; a line added with no signal counts at once.
    await ok(app, 'project.update', { id: nissan.id, status: 'cancelled' })
    await office.client.sync()
    office.signal.on = false
    const lights = line(fuel.id, sharpy.id, 2)
    const cables = line(fuel.id, xlr.id, 12)
    await office.client.mutate('kit.add', lights)
    await office.client.mutate('kit.add', cables)
    kit = office.client.view().kit
    expect(kit.lines.find((l) => l.id === pa.id)).toMatchObject({ hold: 'none', short: 0, spare: undefined })
    expect(kit.byModel.get(y10p.id)!.map((l) => l.job?.name)).toEqual(['Tour'])
    // Fuel's day is past on this laptop, so its new lines aren't checked either; by department, audio first.
    expect(kit.byJob.get(fuel.id)!.map((l) => [l.model?.name, l.pending])).toEqual([
      ['d&b Y10P', false],
      ['XLR 10 m', true],
      ['Clay Paky Sharpy', true],
    ])
  })
})
