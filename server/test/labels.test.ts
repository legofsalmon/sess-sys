import {
  MemoryStorage,
  newId,
  SyncClient,
  type Asset,
  type CommandInput,
  type CommandName,
  type LabelRun,
  type MutationResult,
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
 * Labels (ADR 0015): numbers set aside a run at a time for printing, which
 * the next free number for an item skips, so it never lands on a label
 * that isn't stuck on yet; and labels from a run claimed by typing or
 * scanning their number.
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

/** What the server has said about runs and items. */
async function records(app: FastifyInstance) {
  const res = await app.inject({ method: 'GET', url: '/api/sync/pull?after=0' })
  const runs = new Map<string, LabelRun>()
  const items = new Map<string, Asset>()
  for (const c of (res.json() as PullResponse).changes) {
    if (c.entity === 'labelRun') runs.set(c.id, c.data as LabelRun)
    if (c.entity === 'asset') items.set(c.id, c.data as Asset)
  }
  return { runs, items }
}

const run = (count: number, name = '', notes = ''): CommandInput<'labels.reserve'> => ({ id: newId(), count, name, notes })
const item = (modelId: string, number: string | null, extra: Partial<CommandInput<'asset.add'>> = {}): CommandInput<'asset.add'> => ({
  id: newId(),
  modelId,
  number,
  serial: '',
  placeId: null,
  caseId: null,
  notes: '',
  fromCount: false,
  ...extra,
})

/** A stock list with a numbered speaker, 10 of them counted in the warehouse and not labelled yet. */
async function warehouse() {
  const s = await server()
  const place = { id: newId(), name: 'Warehouse', notes: '' }
  const y10p = {
    id: newId(),
    name: 'd&b Y10P',
    department: 'audio' as const,
    category: 'Speakers',
    tracking: 'serialised' as const,
    isCase: false,
    valueCents: null,
    notes: '',
  }
  await ok(s.app, 'place.upsert', place)
  await ok(s.app, 'model.create', y10p)
  await ok(s.app, 'stock.set', { modelId: y10p.id, placeId: place.id, caseId: null, qty: 10 })
  return { ...s, place, y10p }
}

/** A laptop in the office, which can lose its signal. */
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
  await client.sync()
  return { client, signal }
}

describe('labels', () => {
  it('set numbers aside that the next free number skips', async () => {
    const { app, db, y10p } = await warehouse()
    const first = item(y10p.id, null)
    await ok(app, 'asset.add', first)
    const roll = run(5, ' Polyester roll from Label World ', ' Ordered 30 Sep ')
    await ok(app, 'labels.reserve', roll)
    const next = item(y10p.id, null)
    await ok(app, 'asset.add', next)
    const tags = run(3, 'Metal tags')
    await ok(app, 'labels.reserve', tags)

    const { runs, items } = await records(app)
    expect(items.get(first.id)?.number).toBe('SH-000001')
    expect(runs.get(roll.id)).toMatchObject({ first: 2, count: 5, name: 'Polyester roll from Label World', notes: 'Ordered 30 Sep' })
    expect(runs.get(roll.id)?.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
    // Past the roll: SH-000002 to SH-000006 wait on labels not stuck on yet.
    expect(items.get(next.id)?.number).toBe('SH-000007')
    expect(runs.get(tags.id)).toMatchObject({ first: 8, count: 3 })

    // A number typed further on moves the next ones on past it, as before.
    await ok(app, 'asset.add', item(y10p.id, 'SH-000050'))
    const more = run(2)
    await ok(app, 'labels.reserve', more)
    expect((await records(app)).runs.get(more.id)).toMatchObject({ first: 51, count: 2 })

    const { entries } = await readHistory(db)
    expect(entries.slice(0, 5).map((e) => e.what)).toEqual([
      'Set aside SH-000051 to SH-000052 for printing labels',
      'Added SH-000050 (d&b Y10P)',
      'Set aside SH-000008 to SH-000010 for printing labels (Metal tags)',
      'Added SH-000007 (d&b Y10P)',
      'Set aside SH-000002 to SH-000006 for printing labels (Polyester roll from Label World)',
    ])
  })

  it('are claimed by typing or scanning a label, in any form, once only', async () => {
    const { app, y10p, place } = await warehouse()
    const roll = run(100, 'Roll')
    await ok(app, 'labels.reserve', roll)
    // A scanner reading the label, straight onto the shelf it's on, one of the 10 counted there.
    const scanned = item(y10p.id, 'SH-000042', { placeId: place.id, fromCount: true })
    await ok(app, 'asset.add', scanned)
    await ok(app, 'asset.add', item(y10p.id, 'sh 43'))
    expect(await refused(app, 'asset.add', item(y10p.id, '42'))).toBe('SH-000042 is already in use (d&b Y10P).')

    const { items } = await records(app)
    expect(items.get(scanned.id)).toMatchObject({ number: 'SH-000042', placeId: place.id })
    const res = await app.inject({ method: 'GET', url: '/api/sync/pull?after=0' })
    const counted = (res.json() as PullResponse).changes.filter((c) => c.entity === 'stock').at(-1)
    expect(counted?.data).toMatchObject({ qty: 9 })
    // The roll's own numbers aren't given out: the next free one is after it.
    const next = item(y10p.id, null)
    await ok(app, 'asset.add', next)
    expect((await records(app)).items.get(next.id)?.number).toBe('SH-000101')
  })

  it('stop at the last six-digit number', async () => {
    const { app, y10p } = await warehouse()
    await ok(app, 'asset.add', item(y10p.id, 'SH-999990'))
    expect(await refused(app, 'labels.reserve', run(10))).toBe('Only 9 numbers are left, from SH-999991. Set aside those at most.')
    await ok(app, 'labels.reserve', run(8))
    expect(await refused(app, 'labels.reserve', run(2))).toBe('Only 1 number is left, from SH-999999. Set aside that one at most.')
    await ok(app, 'labels.reserve', run(1))
    expect(await refused(app, 'labels.reserve', run(1))).toBe('Every six-digit number has been used or set aside.')
    expect(await refused(app, 'asset.add', item(y10p.id, null))).toBe(
      'Every six-digit number has been used or set aside for printing. Use the number on a printed label.'
    )
    await ok(app, 'asset.add', item(y10p.id, 'SH-999999'))
    // Between 1 and 10,000 at a time.
    for (const count of [0, 10_001]) expect((await send(app, 'labels.reserve', run(count))).status).toBe('rejected')
  })

  it('keep their numbers for good; what they are for can change', async () => {
    const { app, db } = await warehouse()
    const roll = run(500, 'Roll')
    await ok(app, 'labels.reserve', roll)
    expect(await refused(app, 'labels.reserve', { ...roll, count: 10 })).toBe('These numbers are set aside already.')
    await ok(app, 'labels.update', { id: roll.id, name: 'Polyester roll, arrived 9 Oct', notes: '  Box on the shelf by the bench ' })
    expect((await records(app)).runs.get(roll.id)).toMatchObject({
      first: 1,
      count: 500,
      name: 'Polyester roll, arrived 9 Oct',
      notes: 'Box on the shelf by the bench',
    })
    expect(await refused(app, 'labels.update', { id: newId(), name: 'Gone' })).toBe('Those labels are no longer on the list.')
    expect((await send(app, 'labels.update', { id: roll.id })).status).toBe('rejected')

    const { entries } = await readHistory(db)
    expect(entries[2]?.what).toBe(
      "Changed the labels SH-000001 to SH-000500: what they're for to Polyester roll, arrived 9 Oct and the notes"
    )
  })

  it('never overlap when two devices set some aside with no signal', async () => {
    const { app, y10p } = await warehouse()
    const laptop = await device(app)
    const phone = await device(app)
    laptop.signal.on = false
    phone.signal.on = false
    const a = run(20, 'Laptop')
    const b = run(20, 'Phone')
    await laptop.client.mutate('labels.reserve', a)
    await phone.client.mutate('labels.reserve', b)
    // Waiting: the numbers come from the server.
    expect(laptop.client.view().labels.runs[0]).toMatchObject({ id: a.id, pending: true, first: null, firstNumber: '', count: 20 })

    laptop.signal.on = true
    phone.signal.on = true
    await laptop.client.sync()
    await phone.client.sync()
    await laptop.client.sync()
    const runs = laptop.client.view().labels.runs
    expect(runs.map((r) => [r.name, r.firstNumber, r.lastNumber, r.pending])).toEqual([
      ['Phone', 'SH-000021', 'SH-000040', false],
      ['Laptop', 'SH-000001', 'SH-000020', false],
    ])
    expect(laptop.client.view().labels.next).toBe('SH-000041')

    // How far each run has got: labels on items, including one since replaced.
    const one = item(y10p.id, 'SH-000003')
    await laptop.client.mutate('asset.add', one)
    await laptop.client.mutate('asset.add', item(y10p.id, 'SH-000025'))
    await laptop.client.mutate('asset.relabel', { id: one.id, number: 'SH-000004' })
    await laptop.client.sync()
    const view = laptop.client.view().labels
    expect(view.runs.map((r) => r.used)).toEqual([1, 2])
    expect(view.runOf('SH-000004')?.name).toBe('Laptop')
    expect(view.runOf('SH-000040')?.name).toBe('Phone')
    expect(view.runOf('SH-000041')).toBeUndefined()
  })
})
