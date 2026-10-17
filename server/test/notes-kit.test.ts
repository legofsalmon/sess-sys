import {
  MemoryStorage,
  newId,
  SyncClient,
  type CommandInput,
  type CommandName,
  type KitLine,
  type MutationResult,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type Transport,
} from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb, type Db } from '../src/db.ts'
import { readHistory } from '../src/history.ts'
import { runMigrations } from '../src/migrations.ts'
import { MODULES } from '../src/modules.ts'
import { STOCK } from '../src/stock/schema.ts'

/**
 * Kit read from jobs' notes (ADR 0043): a phone reads the notes, matches
 * them and says what goes on; the server adds only what's missing, for one
 * job or a season of them in one change, and remembers the names chosen.
 */

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

async function server(given?: Db) {
  const db = given ?? (await pgliteDb())
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

async function lines(app: FastifyInstance): Promise<KitLine[]> {
  const res = await app.inject({ method: 'GET', url: '/api/sync/pull?after=0' })
  const out = new Map<string, KitLine>()
  for (const c of (res.json() as PullResponse).changes) {
    if (c.entity !== 'kitLine') continue
    if (c.op === 'delete') out.delete(c.id)
    else out.set(c.id, c.data as KitLine)
  }
  return [...out.values()]
}

const model = (name: string, department: CommandInput<'model.create'>['department'] = 'audio'): CommandInput<'model.create'> => ({
  id: newId(),
  name,
  department,
  category: '',
  tracking: 'serialised',
  isCase: false,
  valueCents: null,
  notes: '',
})

const SHEET = 'Audio\n4 x d&b Y10P\n2x d20 amp\n1 x Allen & Heath SQ5\n\nTransport and labour\n1 x Luton van\n\n5.00pm - Crew Call'

async function setUp() {
  const s = await server()
  const y10p = model('d&b Y10P')
  const d20 = model('d&b D20')
  for (const m of [y10p, d20]) await ok(s.app, 'model.create', m)
  const job = newId()
  const show = newId()
  await ok(s.app, 'project.create', { id: job, name: 'Fairview Build', clientId: null, venueId: null, status: 'confirmed', notes: SHEET })
  await ok(s.app, 'phase.add', { id: show, projectId: job, name: 'Show', start: '2026-10-20', end: '2026-10-21', venueId: null, notes: 'Lighting\n2 x d&b Y10P' })
  return { ...s, y10p, d20, job, show }
}

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
  const client = await new SyncClient({ storage: new MemoryStorage(), transport, now: () => new Date('2026-10-17T09:00:00Z') }).open()
  await client.sync()
  return { client, signal }
}

/** What the device would send for a job, with nothing chosen. */
function asIs(client: SyncClient, jobId: string, names: CommandInput<'kit.fromNotes'>['names'] = []): CommandInput<'kit.fromNotes'> {
  const n = client.view().notesKit.forJob(jobId)!
  return { jobs: [{ projectId: jobId, sum: n.sum, lines: n.plan.lines }], names: [...n.plan.names, ...names] }
}

describe('kit from the notes', () => {
  it('reads the notes on the phone, with no signal, and the server adds what matched', async () => {
    const { app, job, show, y10p, d20 } = await setUp()
    const { client, signal } = await device(app)
    const n = client.view().notesKit.forJob(job)!
    expect(n.rows.map((r) => [r.phaseId, r.line.name, r.match.how])).toEqual([
      [null, 'd&b Y10P', 'name'],
      [null, 'd20 amp', 'code'],
      [null, 'Allen & Heath SQ5', 'none'],
      [null, 'Luton van', 'none'],
      [show, 'd&b Y10P', 'name'],
    ])
    expect(client.view().notesKit.toDo.map((j) => j.job.id)).toEqual([job])

    signal.on = false
    await client.mutate('kit.fromNotes', asIs(client, job))
    // Shown at once, waiting to go: the whole job's four, two amps, and the Show's two more on its own days.
    const pending = client.view().kit.byJob.get(job)!
    expect(pending.map((l) => [l.phaseId, l.modelId, l.qty, l.pending])).toEqual(
      expect.arrayContaining([
        [null, y10p.id, 4, true],
        [null, d20.id, 2, true],
      ])
    )
    // The phase's two are covered by the whole job's four, so nothing goes on the phase.
    expect(pending.some((l) => l.phaseId === show)).toBe(false)
    expect(client.view().notesKit.toDo).toEqual([])

    signal.on = true
    await client.sync()
    expect(client.view().problems).toEqual([])
    const saved = await lines(app)
    expect(saved.map((l) => [l.phaseId, l.modelId, l.qty]).sort()).toEqual([[null, d20.id, 2], [null, y10p.id, 4]].sort())
    // "d20 amp" was a guess taken as it was, so it's remembered for the next job's notes.
    expect(client.view().notesKit.names.size).toBe(1)
  })

  it('never doubles: the same notes twice, even from two phones with no signal, add nothing more', async () => {
    const { app, job, y10p } = await setUp()
    const a = await device(app)
    const b = await device(app)
    a.signal.on = false
    b.signal.on = false
    await a.client.mutate('kit.fromNotes', asIs(a.client, job))
    await b.client.mutate('kit.fromNotes', asIs(b.client, job))
    a.signal.on = true
    b.signal.on = true
    await a.client.sync()
    await b.client.sync()
    await ok(app, 'kit.fromNotes', asIs(a.client, job))
    const saved = await lines(app)
    expect(saved.filter((l) => l.modelId === y10p.id).reduce((n, l) => n + l.qty, 0)).toBe(4)
    expect(saved).toHaveLength(2)
  })

  it('adds only the difference onto the line already there', async () => {
    const { app, job, y10p } = await setUp()
    const there = newId()
    await ok(app, 'kit.add', { id: there, projectId: job, phaseId: null, modelId: y10p.id, qty: 1, subhireQty: 0, supplier: '', notes: '' })
    const { client } = await device(app)
    const row = client.view().notesKit.forJob(job)!.plan.rows[0]!
    expect(row).toMatchObject({ state: 'add', adds: 3, onJob: 1 })
    await client.mutate('kit.fromNotes', asIs(client, job))
    await client.sync()
    expect((await lines(app)).find((l) => l.id === there)?.qty).toBe(4)
  })

  it('remembers a name chosen as not kit or as a product, for the next job, and the history says what was done', async () => {
    const { app, db, job, d20 } = await setUp()
    const { client } = await device(app)
    const n = client.view().notesKit.forJob(job)!
    const sq5 = n.rows.find((r) => r.line.name === 'Allen & Heath SQ5')!
    const plan = (await import('@sh/shared')).notesPlan(n.rows, n.kit, { [sq5.key]: { pick: 'not-kit' } }, newId)
    await client.mutate('kit.fromNotes', { jobs: [{ projectId: job, sum: n.sum, lines: plan.lines }], names: plan.names })
    await client.sync()

    const next = newId()
    await ok(app, 'project.create', { id: next, name: 'Fairview Show', clientId: null, venueId: null, status: 'enquiry', notes: 'Audio\n1 x allen & heath sq5\n4 x D20 AMP' })
    await client.sync()
    const again = client.view().notesKit.forJob(next)!
    expect(again.rows.map((r) => [r.match.how, r.match.notKit, r.match.modelId])).toEqual([
      ['chosen', true, undefined],
      ['chosen', false, d20.id],
    ])
    // Nothing to check there now: it's ready to go in with the others.
    expect(client.view().notesKit.ready.map((r) => r.job.id)).toEqual([next])

    const { entries } = await readHistory(db)
    expect(entries.map((e) => e.what)).toContain('Put kit from the notes on Fairview Build (2 lines), and remembered 2 names the notes use')
  })

  it('takes a season of jobs in one change, and turns down a product since marked as a mistake, adding nothing', async () => {
    const { app } = await setUp()
    const jobs = Array.from({ length: 40 }, () => newId())
    for (const [i, id] of jobs.entries()) await ok(app, 'project.create', { id, name: `Gig ${i}`, clientId: null, venueId: null, status: 'confirmed', notes: 'Audio\n6 x d&b Y10P' })
    const { client } = await device(app)
    const ready = client.view().notesKit.ready.filter((r) => jobs.includes(r.job.id))
    expect(ready).toHaveLength(40)
    const args: CommandInput<'kit.fromNotes'> = { jobs: ready.map((r) => ({ projectId: r.job.id, sum: r.sum, lines: r.plan.lines })), names: [] }
    await ok(app, 'kit.fromNotes', args)
    expect((await lines(app)).filter((l) => jobs.includes(l.projectId))).toHaveLength(40)

    const other = model('Clay Paky Sharpy', 'lighting')
    await ok(app, 'model.create', other)
    await ok(app, 'model.mistake', { id: other.id })
    const r = await send(app, 'kit.fromNotes', { jobs: [{ projectId: jobs[0]!, sum: 'x', lines: [{ id: newId(), phaseId: null, modelId: other.id, qty: 1, notes: '' }] }], names: [] })
    expect(r).toMatchObject({ status: 'rejected', reason: { message: expect.stringContaining('added by mistake') } })
  })

  it('arrives on a database already in use, leaving its kit as it was', async () => {
    // A database from before this change, with a job and a kit line, takes the two new tables on the next start.
    const db = await pgliteDb()
    for (const mod of MODULES) await runMigrations(db, mod, mod === STOCK ? STOCK.migrations.length - 1 : undefined)
    expect((await db.query(`SELECT to_regclass('kit_names')::text AS found`)).rows).toEqual([{ found: null }])
    await db.query(`INSERT INTO models (id, name, department, tracking) VALUES ('y10p', 'd&b Y10P', 'audio', 'serialised')`)
    await db.query(`INSERT INTO projects (id, name, status, notes) VALUES ('p1', 'Fairview Build', 'confirmed', 'Audio
6 x d&b Y10P')`)
    await db.query(`INSERT INTO kit_lines (id, project_id, model_id, qty) VALUES ('k1', 'p1', 'y10p', 2)`)
    const { app } = await server(db)
    expect((await db.query(`SELECT version FROM stock_schema_version`)).rows).toEqual([{ version: STOCK.migrations.length }])
    await ok(app, 'kit.fromNotes', { jobs: [{ projectId: 'p1', sum: 's', lines: [{ id: newId(), phaseId: null, modelId: 'y10p', qty: 6, notes: '' }] }], names: [{ text: 'Y10P', modelId: 'y10p' }] })
    expect((await lines(app)).map((l) => [l.id, l.qty])).toEqual([['k1', 6]])
  })
})
