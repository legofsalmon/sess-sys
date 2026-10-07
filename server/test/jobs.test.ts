import {
  calendarTitles,
  crewFill,
  jobSpan,
  MemoryStorage,
  newId,
  SyncClient,
  venueLabel,
  type CommandInput,
  type CommandName,
  type CrewCall,
  type MutationResult,
  type Offer,
  type Person,
  type Phase,
  type Project,
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
 * Jobs (ADR 0007), as ops use them: a job for a client at a venue, made of
 * phases, with crew calls for its phases. The server keeps the crew's view
 * of the job in step, and nothing two people change gets lost.
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
    payload: { clientId: 'ops-laptop', mutations: [{ id: newId(), name, args, createdAt: new Date().toISOString() }] },
  })
  return res.json().results[0]
}

async function latest<T>(app: FastifyInstance, entity: string, id: string): Promise<T | undefined> {
  const res = await app.inject({ method: 'GET', url: '/api/sync/pull?after=0' })
  const changes = res.json().changes.filter((c: { entity: string; id: string }) => c.entity === entity && c.id === id)
  const last = changes[changes.length - 1]
  return last?.op === 'delete' ? undefined : last?.data
}

/** A device with a signal switch, talking to the in-process server. */
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

/** Nissan at the Heritage: a client, a venue, a job and three phases. */
async function nissan(app: FastifyInstance) {
  const ids = { client: newId(), venue: newId(), job: newId(), build: newId(), show: newId(), out: newId() }
  const ok = (r: MutationResult) => expect(r.status).toBe('applied')
  ok(await send(app, 'client.upsert', { id: ids.client, name: 'Nissan Ireland', contacts: [{ name: 'Orla Kavanagh', role: 'Producer', email: 'orla@example.ie', phone: '+353 86 000 0000' }], notes: '' }))
  ok(await send(app, 'venue.upsert', { id: ids.venue, name: 'The Heritage', address: 'Killenard, Co. Laois\nR32 AK37', notes: 'Load in by the spa entrance.' }))
  ok(await send(app, 'project.create', { id: ids.job, name: 'Nissan launch', clientId: ids.client, venueId: ids.venue, status: 'confirmed', notes: '' }))
  ok(await send(app, 'phase.add', { id: ids.build, projectId: ids.job, name: 'Build', start: '2026-10-07', end: '2026-10-08', venueId: null, notes: '' }))
  ok(await send(app, 'phase.add', { id: ids.show, projectId: ids.job, name: 'Show', start: '2026-10-09', end: '2026-10-09', venueId: null, notes: '' }))
  ok(await send(app, 'phase.add', { id: ids.out, projectId: ids.job, name: 'Load out', start: '2026-10-09', end: '2026-10-09', venueId: null, notes: '' }))
  return ids
}

async function crewFor(app: FastifyInstance, phaseId: string, over: Partial<CommandInput<'call.create'>> = {}) {
  const id = newId()
  const r = await send(app, 'call.create', {
    id,
    phaseId,
    // What the device had; the server writes the job's own names over it.
    project: 'Nissan',
    phase: 'Build',
    venue: '',
    role: 'Audio tech',
    start: '2026-10-07',
    end: '2026-10-08',
    callTime: '08:00',
    needed: 2,
    dayRateCents: 25000,
    details: '',
    replyBy: null,
    ...over,
  })
  return { id, r }
}

describe('a job, its phases, client and venue', () => {
  it('keeps a job for a client at a venue, with its phases', async () => {
    const { app } = await server()
    const ids = await nissan(app)
    expect(await latest<Project>(app, 'project', ids.job)).toEqual({
      id: ids.job,
      name: 'Nissan launch',
      clientId: ids.client,
      venueId: ids.venue,
      status: 'confirmed',
      notes: '',
      prepDays: 1,
      returnDays: 1,
    })
    expect(await latest<Phase>(app, 'phase', ids.build)).toMatchObject({ projectId: ids.job, name: 'Build', start: '2026-10-07', end: '2026-10-08', venueId: null })
  })

  it('says how each phase-day will read on the calendar, the way crew know it', () => {
    expect(calendarTitles('Nissan launch', { name: 'Build', start: '2026-10-07', end: '2026-10-08' })).toEqual(['Nissan launch - Build 1/2', 'Nissan launch - Build 2/2'])
    expect(calendarTitles('Nissan launch', { name: 'Show', start: '2026-10-09', end: '2026-10-09' })).toEqual(['Nissan launch - Show'])
    expect(jobSpan([{ start: '2026-10-09', end: '2026-10-09' }, { start: '2026-10-07', end: '2026-10-08' }])).toEqual({ start: '2026-10-07', end: '2026-10-09' })
    expect(jobSpan([])).toBeUndefined()
    expect(venueLabel({ name: 'The Heritage', address: 'Killenard, Co. Laois\nR32 AK37' })).toBe('The Heritage, Killenard, Co. Laois')
    expect(venueLabel({ name: 'RDS', address: 'RDS, Ballsbridge, Dublin 4' })).toBe('RDS, Ballsbridge, Dublin 4')
    expect(venueLabel({ name: 'Screggan', address: '' })).toBe('Screggan')
  })

  it('turns down a phase that ends before it starts, or one a device moved into that', async () => {
    const { app } = await server()
    const ids = await nissan(app)
    const backwards = await send(app, 'phase.add', { id: newId(), projectId: ids.job, name: 'Prep', start: '2026-10-06', end: '2026-10-05', venueId: null, notes: '' })
    expect(backwards).toMatchObject({ status: 'rejected', reason: { code: 'invalid', message: 'The phase ends before it starts.' } })
    // Only the end is sent, and it lands before the start the server has.
    const early = await send(app, 'phase.update', { id: ids.build, end: '2026-10-06' })
    expect(early).toMatchObject({ status: 'rejected', reason: { code: 'invalid', message: 'Build would end before it starts.' } })
    const tooLong = await send(app, 'phase.add', { id: newId(), projectId: ids.job, name: 'Babysit', start: '2026-10-01', end: '2027-12-01', venueId: null, notes: '' })
    expect(tooLong).toMatchObject({ status: 'rejected', reason: { message: 'A phase can be at most 366 days.' } })
    expect(await send(app, 'project.update', { id: ids.job })).toMatchObject({ status: 'rejected', reason: { message: 'Nothing to change.' } })
  })

  it("says so when a job's client, venue or job is gone, instead of saving half of it", async () => {
    const { app } = await server()
    const job = await send(app, 'project.create', { id: newId(), name: 'Fuel', clientId: 'nobody', venueId: null, status: 'enquiry', notes: '' })
    expect(job).toMatchObject({ status: 'rejected', reason: { code: 'not-found', message: 'That client no longer exists.' } })
    const phase = await send(app, 'phase.add', { id: newId(), projectId: 'nothing', name: 'Show', start: '2026-10-09', end: '2026-10-09', venueId: null, notes: '' })
    expect(phase).toMatchObject({ status: 'rejected', reason: { code: 'not-found', message: 'That job no longer exists.' } })
  })

  it('keeps both of two changes to different things about a job, made with no signal', async () => {
    const { app } = await server()
    const ids = await nissan(app)
    const aoife = await device(app)
    const dara = await device(app)
    await aoife.client.sync()
    await dara.client.sync()
    aoife.signal.on = false
    dara.signal.on = false

    await aoife.client.mutate('project.update', { id: ids.job, notes: 'Client wants a second mic.' })
    await dara.client.mutate('project.update', { id: ids.job, status: 'quoted' })
    await dara.client.mutate('phase.update', { id: ids.show, name: 'Show day' })
    // Each device shows its own change at once, waiting to sync.
    expect(aoife.client.view().jobs.jobs[0]).toMatchObject({ notes: 'Client wants a second mic.', status: 'confirmed', pending: true })
    expect(dara.client.view().jobs.jobs[0]!.phases.map((p) => p.name)).toEqual(['Build', 'Show day', 'Load out'])

    aoife.signal.on = true
    dara.signal.on = true
    await aoife.client.sync()
    await dara.client.sync()
    await aoife.client.sync()
    for (const d of [aoife, dara]) {
      const job = d.client.view().jobs.jobs[0]!
      expect(job).toMatchObject({ notes: 'Client wants a second mic.', status: 'quoted', pending: false })
      expect(job.phases.map((p) => p.name)).toEqual(['Build', 'Show day', 'Load out'])
    }
  })

  it('shows a whole new job made with no signal at once, and keeps it once synced', async () => {
    const { app } = await server()
    const phone = await device(app)
    phone.signal.on = false
    const [client, venue, job, build] = [newId(), newId(), newId(), newId()]
    await phone.client.mutate('client.upsert', { id: client, name: 'Fuel Events', contacts: [], notes: '' })
    await phone.client.mutate('venue.upsert', { id: venue, name: 'RDS', address: 'Ballsbridge, Dublin 4', notes: '' })
    await phone.client.mutate('project.create', { id: job, name: 'Fuel conference', clientId: client, venueId: venue, status: 'enquiry', notes: '' })
    await phone.client.mutate('phase.add', { id: build, projectId: job, name: 'Build', start: '2026-11-02', end: '2026-11-03', venueId: null, notes: '' })
    await expect(phone.client.sync()).rejects.toThrow('offline')

    let view = phone.client.view().jobs
    expect(view.jobs[0]).toMatchObject({ name: 'Fuel conference', pending: true, client: { name: 'Fuel Events' }, venue: { name: 'RDS' }, span: { start: '2026-11-02', end: '2026-11-03' } })
    expect(view.clients.map((c) => c.name)).toEqual(['Fuel Events'])

    phone.signal.on = true
    await phone.client.sync()
    view = phone.client.view().jobs
    expect(view.jobs[0]).toMatchObject({ name: 'Fuel conference', pending: false, phases: [{ name: 'Build', pending: false, venue: { name: 'RDS' } }] })
  })

  it('lists jobs with no dates yet first, then by their first day', async () => {
    const { app } = await server()
    await nissan(app)
    await send(app, 'project.create', { id: 'later', name: 'Later job', clientId: null, venueId: null, status: 'confirmed', notes: '' })
    await send(app, 'phase.add', { id: newId(), projectId: 'later', name: 'Show', start: '2026-12-01', end: '2026-12-01', venueId: null, notes: '' })
    await send(app, 'project.create', { id: 'undated', name: 'Undated enquiry', clientId: null, venueId: null, status: 'enquiry', notes: '' })
    const phone = await device(app)
    await phone.client.sync()
    expect(phone.client.view().jobs.jobs.map((j) => j.name)).toEqual(['Undated enquiry', 'Nissan launch', 'Later job'])
  })
})

describe("crew for a job's phases", () => {
  it("takes the job's, phase's and venue's names, whatever the device had", async () => {
    const { app } = await server()
    const ids = await nissan(app)
    const { id, r } = await crewFor(app, ids.build)
    expect(r.status).toBe('applied')
    expect(await latest<CrewCall>(app, 'crewCall', id)).toMatchObject({
      projectId: ids.job,
      phaseId: ids.build,
      project: 'Nissan launch',
      phase: 'Build',
      venue: 'The Heritage, Killenard, Co. Laois',
    })
  })

  it('keeps the names on crew calls in step when the job, a phase or the venue is renamed', async () => {
    const { app } = await server()
    const ids = await nissan(app)
    const build = await crewFor(app, ids.build)
    const show = await crewFor(app, ids.show, { start: '2026-10-09', end: '2026-10-09', role: 'LX op' })

    await send(app, 'project.update', { id: ids.job, name: 'Nissan Qashqai launch' })
    await send(app, 'phase.update', { id: ids.build, name: 'Build and rig' })
    await send(app, 'venue.upsert', { id: ids.venue, name: 'The Heritage Hotel', address: 'Killenard, Co. Laois\nR32 AK37', notes: '' })
    expect(await latest<CrewCall>(app, 'crewCall', build.id)).toMatchObject({ project: 'Nissan Qashqai launch', phase: 'Build and rig', venue: 'The Heritage Hotel, Killenard, Co. Laois' })
    expect(await latest<CrewCall>(app, 'crewCall', show.id)).toMatchObject({ project: 'Nissan Qashqai launch', phase: 'Show', venue: 'The Heritage Hotel, Killenard, Co. Laois' })

    // A phase at a venue of its own takes that venue's name.
    const warehouse = newId()
    await send(app, 'venue.upsert', { id: warehouse, name: 'Session Hire warehouse', address: '', notes: '' })
    await send(app, 'phase.update', { id: ids.build, venueId: warehouse })
    expect(await latest<CrewCall>(app, 'crewCall', build.id)).toMatchObject({ venue: 'Session Hire warehouse' })
    expect(await latest<CrewCall>(app, 'crewCall', show.id)).toMatchObject({ venue: 'The Heritage Hotel, Killenard, Co. Laois' })
  })

  it('shows freelancers the new name on their private link', async () => {
    const { app } = await server()
    const ids = await nissan(app)
    const { id: callId } = await crewFor(app, ids.build)
    const pid = newId()
    await send(app, 'person.upsert', { id: pid, name: 'Aoife Byrne', kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '' })
    await send(app, 'offer.send', { id: newId(), callId, personId: pid, override: false })
    await send(app, 'project.update', { id: ids.job, name: 'Nissan Qashqai launch' })
    const person = (await latest<Person>(app, 'person', pid))!
    const page = await app.inject({ url: `/f/${person.linkToken}` })
    expect(page.body).toContain('Nissan Qashqai launch')
    expect(page.body).not.toContain('Nissan launch')
  })

  it("won't remove a phase that still has crew, and keeps the job on its cancelled calls once removed", async () => {
    const { app } = await server()
    const ids = await nissan(app)
    const { id: callId } = await crewFor(app, ids.build)
    const refused = await send(app, 'phase.remove', { id: ids.build })
    expect(refused).toMatchObject({ status: 'rejected', reason: { code: 'conflict', message: 'Build still has crew: 2 × Audio tech. Cancel that first.' } })

    await send(app, 'call.cancel', { id: callId })
    expect(await send(app, 'phase.remove', { id: ids.build })).toMatchObject({ status: 'applied' })
    expect(await latest(app, 'phase', ids.build)).toBeUndefined()
    expect(await latest<CrewCall>(app, 'crewCall', callId)).toMatchObject({ projectId: ids.job, phaseId: null, status: 'cancelled', phase: 'Build' })
    // Removing it again, as a device that missed the news might, changes nothing.
    expect(await send(app, 'phase.remove', { id: ids.build })).toMatchObject({ status: 'applied' })
  })

  it('cancels the crew with the job, releasing anyone booked, and leaves them cancelled if the job comes back', async () => {
    const { app } = await server()
    const ids = await nissan(app)
    const { id: callId } = await crewFor(app, ids.build, { needed: 1 })
    const pid = newId()
    await send(app, 'person.upsert', { id: pid, name: 'Aoife Byrne', kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '' })
    const offerId = newId()
    await send(app, 'offer.send', { id: offerId, callId, personId: pid, override: false })
    await send(app, 'offer.respond', { id: offerId, answer: 'accept', days: null, note: '' })
    await send(app, 'offer.confirm', { id: offerId })

    expect(await send(app, 'project.update', { id: ids.job, status: 'cancelled' })).toMatchObject({ status: 'applied' })
    expect(await latest<CrewCall>(app, 'crewCall', callId)).toMatchObject({ status: 'cancelled' })
    expect(await latest<Offer>(app, 'offer', offerId)).toMatchObject({ status: 'cancelled' })

    // No new crew for a stopped job.
    const more = await crewFor(app, ids.show)
    expect(more.r).toMatchObject({ status: 'rejected', reason: { code: 'conflict', message: 'Nissan launch has been cancelled, so it needs no crew.' } })

    await send(app, 'project.update', { id: ids.job, status: 'confirmed' })
    expect(await latest<CrewCall>(app, 'crewCall', callId)).toMatchObject({ status: 'cancelled' })
    expect(await latest<Offer>(app, 'offer', offerId)).toMatchObject({ status: 'cancelled' })
  })

  it("won't tie a call to a phase of a different job", async () => {
    const { app } = await server()
    const ids = await nissan(app)
    const other = newId()
    await send(app, 'project.create', { id: other, name: 'Fuel', clientId: null, venueId: null, status: 'confirmed', notes: '' })
    const { r } = await crewFor(app, ids.build, { projectId: other })
    expect(r).toMatchObject({ status: 'rejected', reason: { code: 'invalid', message: 'That phase is part of a different job.' } })
  })

  it('still takes a call from a version of the app from before jobs', async () => {
    const { app } = await server()
    const id = newId()
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      payload: {
        clientId: 'old-phone',
        mutations: [
          {
            id: newId(),
            name: 'call.create',
            args: { id, project: 'Electric Picnic', phase: 'Build', venue: 'Stradbally', role: 'Rigger', start: '2026-08-28', end: '2026-08-30', callTime: null, needed: 1, dayRateCents: null, details: '', replyBy: null },
            createdAt: new Date().toISOString(),
          },
        ],
      },
    })
    expect(res.json().results[0].status).toBe('applied')
    expect(await latest<CrewCall>(app, 'crewCall', id)).toMatchObject({ projectId: null, phaseId: null, project: 'Electric Picnic', venue: 'Stradbally' })
  })

  it("counts a job's crew: people needed, and people holding every day", async () => {
    const { app } = await server()
    const ids = await nissan(app)
    const { id: callId } = await crewFor(app, ids.build)
    await crewFor(app, ids.show, { start: '2026-10-09', end: '2026-10-09', role: 'LX op', needed: 1 })
    const pid = newId()
    await send(app, 'person.upsert', { id: pid, name: 'Aoife Byrne', kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '' })
    const offerId = newId()
    await send(app, 'offer.send', { id: offerId, callId, personId: pid, override: false })
    // Only one of the two build days: not yet holding the whole call.
    await send(app, 'offer.respond', { id: offerId, answer: 'accept', days: ['2026-10-07'], note: '' })

    const phone = await device(app)
    await phone.client.sync()
    const job = phone.client.view().jobs.jobs[0]!
    expect(job.phases[0]!.calls.map((c) => c.role)).toEqual(['Audio tech'])
    expect(job.phases[1]!.calls.map((c) => c.role)).toEqual(['LX op'])
    expect(crewFill(job.calls)).toEqual({ needed: 3, booked: 0, toConfirm: 0 })

    const pid2 = newId()
    await send(app, 'person.upsert', { id: pid2, name: 'Dara Walsh', kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '' })
    const offer2 = newId()
    await send(app, 'offer.send', { id: offer2, callId, personId: pid2, override: false })
    await send(app, 'offer.respond', { id: offer2, answer: 'accept', days: null, note: '' })
    await phone.client.sync()
    // Dara has said yes to every day, but "booked" means confirmed: he's to confirm until the office does.
    expect(crewFill(phone.client.view().jobs.jobs[0]!.calls)).toEqual({ needed: 3, booked: 0, toConfirm: 1 })
    await send(app, 'offer.confirm', { id: offer2 })
    await phone.client.sync()
    expect(crewFill(phone.client.view().jobs.jobs[0]!.calls)).toEqual({ needed: 3, booked: 1, toConfirm: 0 })
  })

  it("leaves a job's call's job, phase and venue to the job", async () => {
    const { app } = await server()
    const ids = await nissan(app)
    const { id: callId } = await crewFor(app, ids.build)
    const refused = await send(app, 'call.update', { id: callId, venue: 'Somewhere else' })
    expect(refused).toMatchObject({ status: 'rejected', reason: { code: 'invalid', message: 'This call is part of Nissan launch: change the job, its phase or its venue in Jobs.' } })
    expect(await send(app, 'call.update', { id: callId, callTime: '07:30' })).toMatchObject({ status: 'applied' })
    expect(await latest<CrewCall>(app, 'crewCall', callId)).toMatchObject({ callTime: '07:30', venue: 'The Heritage, Killenard, Co. Laois' })
  })
})

describe('a phase that moves', () => {
  /** Build with two crew: Aoife confirmed for both days, Dara accepted for the second only. */
  async function buildCrew(app: FastifyInstance) {
    const ids = await nissan(app)
    const { id: callId } = await crewFor(app, ids.build, { needed: 2 })
    const [aoife, dara] = [newId(), newId()]
    await send(app, 'person.upsert', { id: aoife, name: 'Aoife Byrne', kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '' })
    await send(app, 'person.upsert', { id: dara, name: 'Dara Walsh', kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '' })
    const [a, d] = [newId(), newId()]
    await send(app, 'offer.send', { id: a, callId, personId: aoife, override: false })
    await send(app, 'offer.respond', { id: a, answer: 'accept', days: null, note: '' })
    await send(app, 'offer.confirm', { id: a })
    await send(app, 'offer.send', { id: d, callId, personId: dara, override: false })
    await send(app, 'offer.respond', { id: d, answer: 'accept', days: ['2026-10-08'], note: '' })
    return { ids, callId, offers: { aoife: a, dara: d }, people: { aoife, dara } }
  }

  it('takes its crew with it when asked, and leaves them on their days when not', async () => {
    const { app, db } = await server()
    const { ids, callId, offers, people } = await buildCrew(app)

    // Longer at the front, even when asked to move the crew: the phase hasn't moved, so they keep the days they agreed.
    expect(await send(app, 'phase.update', { id: ids.build, start: '2026-10-06', moveCrew: true })).toMatchObject({ status: 'applied' })
    expect(await latest<CrewCall>(app, 'crewCall', callId)).toMatchObject({ start: '2026-10-07', end: '2026-10-08' })
    expect(await latest<Offer>(app, 'offer', offers.aoife)).toMatchObject({ days: ['2026-10-07', '2026-10-08'] })

    // Not asked: the call stays where it was, outside its phase, as before.
    expect(await send(app, 'phase.update', { id: ids.build, start: '2026-10-08', end: '2026-10-09' })).toMatchObject({ status: 'applied' })
    expect(await latest<CrewCall>(app, 'crewCall', callId)).toMatchObject({ start: '2026-10-07', end: '2026-10-08' })

    // Asked: the call moves by the same shift as the phase's start, and the days each person holds move with it.
    expect(await send(app, 'phase.update', { id: ids.build, start: '2026-10-14', end: '2026-10-15', moveCrew: true })).toMatchObject({ status: 'applied' })
    expect(await latest<CrewCall>(app, 'crewCall', callId)).toMatchObject({ start: '2026-10-13', end: '2026-10-14' })
    expect(await latest<Offer>(app, 'offer', offers.aoife)).toMatchObject({ status: 'confirmed', days: ['2026-10-13', '2026-10-14'] })
    expect(await latest<Offer>(app, 'offer', offers.dara)).toMatchObject({ status: 'accepted', days: ['2026-10-14'] })

    // A phone sees the call under its phase on the new days (Build now comes after Show), and Aoife's page says so too.
    const phone = await device(app)
    await phone.client.sync()
    expect(phone.client.view().jobs.jobs[0]!.phases.find((p) => p.id === ids.build)!.calls[0]).toMatchObject({ start: '2026-10-13', end: '2026-10-14' })
    const aoife = (await latest<Person>(app, 'person', people.aoife))!
    expect((await app.inject({ url: `/f/${aoife.linkToken}` })).body).toContain('Tue 13 Oct to Wed 14 Oct')

    const { entries } = await readHistory(db)
    expect(entries[0]!.what).toBe('Changed Build on Nissan launch: dates to Wed 14 Oct to Thu 15 Oct, with its crew')
  })

  it('keeps a call inside the phase, and never un-books anyone quietly', async () => {
    const { app } = await server()
    const { ids, callId, offers } = await buildCrew(app)
    // Shrunk to one day: the call is cut to it, Aoife holds it, but Dara's one day would go.
    const refused = await send(app, 'phase.update', { id: ids.build, end: '2026-10-07', moveCrew: true })
    expect(refused).toMatchObject({ status: 'rejected', reason: { code: 'conflict', message: 'Dara Walsh is booked for days that would go. Release them or keep those days.' } })
    expect(await latest<Phase>(app, 'phase', ids.build)).toMatchObject({ start: '2026-10-07', end: '2026-10-08' })
    expect(await latest<CrewCall>(app, 'crewCall', callId)).toMatchObject({ start: '2026-10-07', end: '2026-10-08' })

    // Released, the same move goes through, and the call fits the phase.
    await send(app, 'offer.cancel', { id: offers.dara })
    expect(await send(app, 'phase.update', { id: ids.build, end: '2026-10-07', moveCrew: true })).toMatchObject({ status: 'applied' })
    expect(await latest<CrewCall>(app, 'crewCall', callId)).toMatchObject({ start: '2026-10-07', end: '2026-10-07' })
    expect(await latest<Offer>(app, 'offer', offers.aoife)).toMatchObject({ status: 'confirmed', days: ['2026-10-07'] })
  })
})

describe('the history of a job', () => {
  it('says in words what was done to each job, phase, client and venue', async () => {
    const { app, db } = await server()
    const ids = await nissan(app)
    await send(app, 'project.update', { id: ids.job, status: 'cancelled', notes: 'Client pulled out.' })
    await send(app, 'phase.update', { id: ids.show, start: '2026-10-10', end: '2026-10-10' })
    await send(app, 'phase.remove', { id: ids.out })
    const { entries } = await readHistory(db)
    expect(entries.map((e) => e.what).reverse()).toEqual([
      'Saved the client Nissan Ireland',
      'Saved the venue The Heritage',
      'Added the job Nissan launch for Nissan Ireland, confirmed',
      'Added Build to Nissan launch, Wed 7 Oct to Thu 8 Oct',
      'Added Show to Nissan launch, Fri 9 Oct',
      'Added Load out to Nissan launch, Fri 9 Oct',
      'Changed the job Nissan launch: status to cancelled and the notes',
      'Changed Show on Nissan launch: dates to Sat 10 Oct',
      'Removed Load out from Nissan launch',
    ])
  })
})
