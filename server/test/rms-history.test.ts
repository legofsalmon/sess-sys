import { newId, type CommandInput, type CommandName, type Mutation, type RmsClientStats, type RmsLastCharged, type RmsMatches } from '@sh/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb } from '../src/db.ts'

/**
 * Current RMS's history put to use (ADR 0092), from the server's copy:
 * each opportunity's likeliest job, linked by the office and taken off
 * again; a job's past quotes and how its client's went; and what a line was
 * last charged, to the client and to anyone.
 */

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

const m = <N extends CommandName>(name: N, args: CommandInput<N>): Mutation => ({ id: newId(), name, args, createdAt: new Date().toISOString() }) as Mutation

async function setup() {
  const db = await pgliteDb()
  const app = await buildApp({ db })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  const res = await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    payload: {
      clientId: 'office',
      mutations: [
        m('client.upsert', { id: 'bw', name: 'Brightwater Events', contacts: [], notes: '' }),
        m('project.create', { id: 'gala', name: 'Autumn Gala', clientId: 'bw', venueId: null, status: 'confirmed', notes: '' }),
        m('phase.add', { id: 'show', projectId: 'gala', name: 'Show', start: '2026-03-01', end: '2026-03-02', venueId: null, notes: '' }),
      ],
    },
  })
  expect(res.json().results.every((r: { status: string }) => r.status === 'applied')).toBe(true)
  const opp = (id: number, number: string, subject: string, client: string, state: string, status: string, start: string, net: number, before = net) =>
    db.query(
      `INSERT INTO rms_opportunities (id, number, subject, client, state, status, starts_at, ends_at, net_cents, undiscounted_cents) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9)`,
      [id, number, subject, client, state, status, `${start}T10:00:00Z`, net, before]
    )
  await opp(1, '1043', 'Autumn Gala', 'Brightwater Events Ltd', 'Order', 'Completed', '2026-03-01', 90000, 100000)
  await opp(2, '0990', 'Spring do', 'Brightwater Events', 'Quotation', 'Lost', '2025-04-01', 50000)
  await opp(3, '1001', 'Expo', 'Other Co', 'Order', 'Active', '2026-02-01', 20000)
  const line = (id: number, opportunityId: number, name: string, price: number, discount = 0) =>
    db.query(`INSERT INTO rms_lines (id, opportunity_id, kind, name, price_cents, unit_cents, discount_pct, rate_definition) VALUES ($1, $2, 'Principal', $3, $4, $5, $6, 'Weekly Rate')`, [
      id,
      opportunityId,
      name,
      price,
      Math.round(price * (1 - discount / 100)),
      discount,
    ])
  await line(1, 1, 'Robe Spiider', 6000, 10)
  await line(2, 2, 'Robe Spiider', 5500)
  await line(3, 3, 'Robe Spiider ', 7000)
  await line(4, 3, 'Audio technician', 40000)
  return { app }
}

describe("Current RMS's history (ADR 0092)", () => {
  it('suggests each opportunity its job, links it and takes it off, and shows a job its past quotes and how its client went', async () => {
    const { app } = await setup()
    const matches = (await app.inject({ url: '/api/rms/matches' })).json() as RmsMatches
    const gala = matches.rows.find((r) => r.opportunity.id === 1)!
    expect(gala).toMatchObject({ linked: null, suggested: { projectId: 'gala', sure: true } })
    expect(matches.jobs.gala).toMatchObject({ name: 'Autumn Gala', client: 'Brightwater Events', start: '2026-03-01' })

    const link = (links: unknown) => app.inject({ method: 'POST', url: '/api/rms/matches', payload: { links } })
    expect((await link([{ opportunityId: 1, projectId: 'gala' }, { opportunityId: 99, projectId: 'gala' }, { opportunityId: 3, projectId: 'gone' }])).json()).toEqual({ linked: 1 })
    expect((await link([{ opportunityId: 'x', projectId: 'gala' }])).statusCode).toBe(400)
    expect(((await app.inject({ url: '/api/rms/matches' })).json() as RmsMatches).rows.find((r) => r.opportunity.id === 1)!.linked).toBe('gala')

    expect((await app.inject({ url: '/api/rms/opportunities/1' })).json().job).toEqual({ id: 'gala', name: 'Autumn Gala' })
    const job = (await app.inject({ url: '/api/rms/jobs/gala' })).json()
    expect(job.opportunities.map((o: { number: string }) => o.number)).toEqual(['1043'])
    expect(job.client).toMatchObject({ quotes: 2, ahead: 1, decided: 2, winPct: 50, discountPct: 10 })

    await link([{ opportunityId: 1, projectId: null }])
    expect((await app.inject({ url: '/api/rms/jobs/gala' })).json().opportunities).toEqual([])
    expect((await app.inject({ url: '/api/rms/jobs/nope' })).statusCode).toBe(404)
  })

  it('says what a line was last charged to the job’s client and to anyone, by the names it goes by, and how each client went', async () => {
    const { app } = await setup()
    const asked = (await app.inject({ method: 'POST', url: '/api/rms/last-charged', payload: { projectId: 'gala', names: ['Robe Spiider', 'Audio Technician', 'Nothing like it'] } })).json() as RmsLastCharged
    expect(asked['robe spiider']).toMatchObject({ client: { priceCents: 6000, unitCents: 5400, discountPct: 10, number: '1043', on: '2026-03-01' }, any: { number: '1043' } })
    expect(asked['audio technician']).toMatchObject({ client: null, any: { priceCents: 40000, client: 'Other Co' } })
    expect(asked['nothing like it']).toBeUndefined()

    const clients = (await app.inject({ url: '/api/rms/clients' })).json() as RmsClientStats[]
    expect(clients.map((c) => [c.client, c.quotes, c.winPct])).toEqual([
      ['Brightwater Events Ltd', 2, 50],
      ['Other Co', 1, 100],
    ])
  })
})
