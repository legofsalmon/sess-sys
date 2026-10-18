import { newId, type CommandInput, type CommandName, type CrewCall, type MutationResult, type Phase, type Project } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb, type Db } from '../src/db.ts'
import { readHistory } from '../src/history.ts'

/**
 * Tidying what came in from the calendars (ADR 0050): a festival the
 * calendar had as a job a department ("EP - LX", "EP - Audio") made one job,
 * with its days named for what each title said and its crew kept.
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

async function feed(app: FastifyInstance) {
  return (await app.inject({ method: 'GET', url: '/api/sync/pull?after=0' })).json().changes as { entity: string; id: string; op: string; data: unknown }[]
}
async function latest<T>(app: FastifyInstance, entity: string, id: string): Promise<T | undefined> {
  const last = (await feed(app)).filter((c) => c.entity === entity && c.id === id).at(-1)
  return last?.op === 'delete' ? undefined : (last?.data as T)
}

const ok = (r: MutationResult) => expect(r.status, JSON.stringify(r)).toBe('applied')

/** A job with one phase, and a call for two on it. */
async function job(app: FastifyInstance, name: string, day: string, over: Partial<CommandInput<'project.create'>> = {}) {
  const ids = { job: newId(), phase: newId(), call: newId() }
  ok(await send(app, 'project.create', { id: ids.job, name, clientId: null, venueId: null, status: 'confirmed', notes: '', ...over }))
  ok(await send(app, 'phase.add', { id: ids.phase, projectId: ids.job, name: 'Show', start: day, end: day, venueId: null, notes: '' }))
  ok(
    await send(app, 'call.create', {
      id: ids.call,
      phaseId: ids.phase,
      project: name,
      phase: 'Show',
      venue: '',
      role: 'Crew',
      start: day,
      end: day,
      callTime: '08:00',
      needed: 2,
      dayRateCents: null,
      details: '',
      replyBy: null,
    })
  )
  return ids
}

const broughtIn = (db: Db, ids: string[]) => db.query(`UPDATE projects SET source_calendar = 'adam@sessionhire.com' WHERE id = ANY($1::text[])`, [ids])

describe('making one job of several', () => {
  it('moves the phases and crew across, names each day for what its title said, and removes the rest', async () => {
    const { app, db } = await server()
    const lx = await job(app, 'EP - LX', '2026-08-20', { notes: 'Rig plot to follow.' })
    const audio = await job(app, 'EP - Audio', '2026-08-20')
    const smirnoff = await job(app, 'EP - Smirnoff LX', '2026-08-23')
    ok(await send(app, 'project.merge', { id: lx.job, from: [audio.job, smirnoff.job], name: 'EP' }))

    expect(await latest<Project>(app, 'project', lx.job)).toMatchObject({ name: 'EP', notes: 'Rig plot to follow.' })
    expect(await latest(app, 'project', audio.job)).toBeUndefined()
    expect(await latest(app, 'project', smirnoff.job)).toBeUndefined()
    expect(await latest<Phase>(app, 'phase', lx.phase)).toMatchObject({ projectId: lx.job, name: 'LX' })
    expect(await latest<Phase>(app, 'phase', audio.phase)).toMatchObject({ projectId: lx.job, name: 'Audio' })
    expect(await latest<Phase>(app, 'phase', smirnoff.phase)).toMatchObject({ projectId: lx.job, name: 'Smirnoff LX' })
    // The calls follow, with the job's new name and their departments from the titles.
    expect(await latest<CrewCall>(app, 'crewCall', audio.call)).toMatchObject({ projectId: lx.job, project: 'EP', phase: 'Audio', department: 'Audio' })
    expect(await latest<CrewCall>(app, 'crewCall', smirnoff.call)).toMatchObject({ projectId: lx.job, project: 'EP', phase: 'Smirnoff LX', department: 'LX' })
    const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM projects')
    expect(rows[0]!.n).toBe(1)
    const said = (await readHistory(db, { limit: 5 })).entries.map((e) => e.what)
    expect(said).toContain('Made EP - Audio and EP - Smirnoff LX part of EP')
  })

  it('keeps a phase someone named, with what the title said after it', async () => {
    const { app } = await server()
    const a = await job(app, 'Riverside - FLY', '2026-05-20')
    const b = await job(app, 'Riverside - FLY Travel', '2026-05-19')
    ok(await send(app, 'phase.update', { id: b.phase, name: 'Load in' }))
    ok(await send(app, 'project.merge', { id: a.job, from: [b.job], name: 'Riverside' }))
    expect(await latest<Phase>(app, 'phase', b.phase)).toMatchObject({ name: 'Load in (FLY Travel)' })
    expect(await latest<Phase>(app, 'phase', a.phase)).toMatchObject({ name: 'FLY' })
  })

  it("won't mix a job made in the app with one brought in from the calendar", async () => {
    const { app, db } = await server()
    const made = await job(app, 'Addison Rae', '2026-06-02')
    const brought = await job(app, 'Addison Rae Show', '2026-06-03')
    await broughtIn(db, [brought.job])
    const r = await send(app, 'project.merge', { id: made.job, from: [brought.job], name: 'Addison Rae' })
    expect(r).toMatchObject({ status: 'rejected', reason: { code: 'conflict' } })
    expect(await latest(app, 'project', brought.job)).toBeDefined()
  })

  it('makes two brought in from different calendars one, and refuses a job joining itself', async () => {
    const { app, db } = await server()
    const a = await job(app, 'Fuel Cupra', '2026-10-25')
    const b = await job(app, 'Fuel - Cupra Floor Package', '2026-10-25')
    await broughtIn(db, [a.job])
    await db.query(`UPDATE projects SET source_calendar = 'olan@sessionhire.com' WHERE id = $1`, [b.job])
    expect(await send(app, 'project.merge', { id: a.job, from: [a.job], name: 'Fuel' })).toMatchObject({ status: 'rejected' })
    ok(await send(app, 'project.merge', { id: a.job, from: [b.job], name: 'Fuel Cupra' }))
    expect(await latest<Phase>(app, 'phase', b.phase)).toMatchObject({ projectId: a.job, name: 'Floor Package' })
    // Still left off the jobs calendar, as both were.
    const { rows } = await db.query<{ source_calendar: string }>('SELECT source_calendar FROM projects WHERE id = $1', [a.job])
    expect(rows[0]!.source_calendar).toBe('adam@sessionhire.com')
  })
})
