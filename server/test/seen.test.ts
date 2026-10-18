import {
  MemoryStorage,
  newId,
  SyncClient,
  type CommandInput,
  type CommandName,
  type MutationResult,
  type Person,
  type Phase,
  type Project,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type Transport,
  type Venue,
} from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb } from '../src/db.ts'

/**
 * An edit made offline isn't saved over a newer one (audit, 18 October
 * 2026, finding 5): the device says how far its copy had read when the
 * person made the change, and the server turns it down when someone else
 * has changed the same thing since, keeping what was typed on the device.
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
  return app
}

/** From a device of an older version, which says nothing of what it had seen. */
async function send<N extends CommandName>(app: FastifyInstance, name: N, args: CommandInput<N>, clientId = 'old-phone'): Promise<MutationResult> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    payload: { clientId, mutations: [{ id: newId(), name, args, createdAt: new Date().toISOString() }] },
  })
  return res.json().results[0]
}

async function latest<T>(app: FastifyInstance, entity: string, id: string): Promise<T | undefined> {
  const res = await app.inject({ method: 'GET', url: '/api/sync/pull?after=0' })
  const changes = res.json().changes.filter((c: { entity: string; id: string }) => c.entity === entity && c.id === id)
  return changes[changes.length - 1]?.data
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
  const client = await new SyncClient({ storage: new MemoryStorage(), transport }).open()
  return { client, signal }
}

/** A job with a phase at a venue, and a phone and the office both holding it. */
async function setup() {
  const app = await server()
  const ids = { venue: newId(), job: newId(), show: newId() }
  const office = await device(app)
  const phone = await device(app)
  await office.client.mutate('venue.upsert', { id: ids.venue, name: 'Vicar Street', address: 'Thomas St, Dublin 8', notes: '' })
  await office.client.mutate('project.create', { id: ids.job, name: 'Electric Picnic', clientId: null, venueId: ids.venue, status: 'enquiry', notes: 'Monday: 4 × Y10P' })
  await office.client.mutate('phase.add', { id: ids.show, projectId: ids.job, name: 'Show', start: '2026-10-20', end: '2026-10-20', venueId: null, notes: '' })
  await office.client.sync()
  await phone.client.sync()
  return { app, ids, office, phone }
}

describe('an edit made against an older copy', () => {
  it('is turned down when someone else changed the same thing since, and the phone keeps what was typed', async () => {
    const { app, ids, office, phone } = await setup()
    phone.signal.on = false
    await phone.client.mutate('project.update', { id: ids.job, notes: "Monday's sheet: 6 × Y10P, 2 × sub" })
    await office.client.mutate('project.update', { id: ids.job, notes: "Tuesday's sheet: 8 × Y10P" })
    await office.client.sync()
    phone.signal.on = true
    await phone.client.sync()

    // The office's newer sheet stands.
    expect((await latest<Project>(app, 'project', ids.job))?.notes).toBe("Tuesday's sheet: 8 × Y10P")
    const view = phone.client.view()
    expect(view.problems).toHaveLength(1)
    const [problem] = view.problems
    expect(problem!.reason.code).toBe('conflict')
    expect(problem!.reason.message).toBe(
      "Someone changed the notes of the job Electric Picnic on another device before your change got here, so it wasn't saved over theirs. Check what's there now and make your change again."
    )
    // What was typed is kept with the problem, to copy.
    expect((problem!.mutation.args as { notes: string }).notes).toBe("Monday's sheet: 6 × Y10P, 2 × sub")
    // Both devices show the same job, with nothing pending.
    expect(view.jobs.jobs.find((j) => j.id === ids.job)?.notes).toBe("Tuesday's sheet: 8 × Y10P")
    expect(view.pendingCount).toBe(0)
  })

  it('is turned down for a status changed since, too', async () => {
    const { app, ids, office, phone } = await setup()
    phone.signal.on = false
    await phone.client.mutate('project.update', { id: ids.job, status: 'confirmed' })
    await office.client.mutate('project.update', { id: ids.job, status: 'lost' })
    await office.client.sync()
    phone.signal.on = true
    await phone.client.sync()
    expect((await latest<Project>(app, 'project', ids.job))?.status).toBe('lost')
    expect(phone.client.view().problems[0]?.reason.message).toMatch(/^Someone changed the status of the job Electric Picnic/)
  })

  it('applies when it was made against the latest version', async () => {
    const { app, ids, office, phone } = await setup()
    // The office changed it before the phone last synced, so the phone's edit is made against the newest.
    await office.client.mutate('project.update', { id: ids.job, notes: "Tuesday's sheet" })
    await office.client.sync()
    await phone.client.sync()
    phone.signal.on = false
    await phone.client.mutate('project.update', { id: ids.job, notes: "Tuesday's sheet, and the sub", status: 'confirmed' })
    phone.signal.on = true
    await phone.client.sync()
    expect(phone.client.view().problems).toEqual([])
    expect(await latest<Project>(app, 'project', ids.job)).toMatchObject({ notes: "Tuesday's sheet, and the sub", status: 'confirmed' })
  })

  it('applies when someone else changed something else, and both are kept', async () => {
    const { app, ids, office, phone } = await setup()
    phone.signal.on = false
    await phone.client.mutate('project.update', { id: ids.job, notes: 'Phone notes' })
    await phone.client.mutate('phase.update', { id: ids.show, notes: 'Doors 19:00' })
    await office.client.mutate('project.update', { id: ids.job, status: 'confirmed' })
    await office.client.mutate('phase.update', { id: ids.show, end: '2026-10-21' })
    await office.client.sync()
    phone.signal.on = true
    await phone.client.sync()
    expect(phone.client.view().problems).toEqual([])
    expect(await latest<Project>(app, 'project', ids.job)).toMatchObject({ notes: 'Phone notes', status: 'confirmed' })
    expect(await latest<Phase>(app, 'phase', ids.show)).toMatchObject({ notes: 'Doors 19:00', end: '2026-10-21' })
  })

  it("never counts the device's own earlier changes against it", async () => {
    const { app, ids, phone } = await setup()
    phone.signal.on = false
    await phone.client.mutate('project.update', { id: ids.job, notes: 'First go' })
    await phone.client.mutate('project.update', { id: ids.job, notes: 'Second go' })
    phone.signal.on = true
    await phone.client.sync()
    expect(phone.client.view().problems).toEqual([])
    expect((await latest<Project>(app, 'project', ids.job))?.notes).toBe('Second go')
  })

  it('saved whole from a form, keeps what someone else changed in a field the person left alone', async () => {
    const { app, ids, office, phone } = await setup()
    phone.signal.on = false
    // The venue's form sends every field, the address as the phone last had it.
    await phone.client.mutate('venue.upsert', { id: ids.venue, name: 'Vicar Street', address: 'Thomas St, Dublin 8', notes: 'Load in from the lane' })
    await office.client.mutate('venue.upsert', { id: ids.venue, name: 'Vicar Street', address: '58-59 Thomas St, Dublin 8, D08 V2FV', notes: '' })
    await office.client.sync()
    phone.signal.on = true
    await phone.client.sync()
    expect(phone.client.view().problems).toEqual([])
    expect(await latest<Venue>(app, 'venue', ids.venue)).toMatchObject({ address: '58-59 Thomas St, Dublin 8, D08 V2FV', notes: 'Load in from the lane' })
  })

  it("is turned down for a person's details changed on both", async () => {
    const { app, office, phone } = await setup()
    const id = newId()
    const aoife: CommandInput<'person.upsert'> = { id, name: 'Aoife Byrne', kind: 'freelancer', email: null, phone: null, skills: ['Audio'], notes: '' }
    await office.client.mutate('person.upsert', aoife)
    await office.client.sync()
    await phone.client.sync()
    phone.signal.on = false
    await phone.client.mutate('person.upsert', { ...aoife, notes: 'Has her own van' })
    await office.client.mutate('person.upsert', { ...aoife, notes: 'Prefers Leinster' })
    await office.client.sync()
    phone.signal.on = true
    await phone.client.sync()
    expect((await latest<Person>(app, 'person', id))?.notes).toBe('Prefers Leinster')
    expect(phone.client.view().problems[0]?.reason.message).toMatch(/^Someone changed the notes of Aoife Byrne on another device/)
  })

  it('from an older version of the app, which says nothing of what it saw, applies in arrival order as before', async () => {
    const { app, ids, office } = await setup()
    await office.client.mutate('project.update', { id: ids.job, notes: "Tuesday's sheet" })
    await office.client.sync()
    expect((await send(app, 'project.update', { id: ids.job, notes: "Monday's sheet" })).status).toBe('applied')
    expect((await latest<Project>(app, 'project', ids.job))?.notes).toBe("Monday's sheet")
  })

  it('with something other than a change number for what it saw, applies as from an older version', async () => {
    const { app, ids } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      payload: { clientId: 'odd-phone', mutations: [{ id: newId(), name: 'project.update', args: { id: ids.job, notes: 'Odd' }, createdAt: new Date().toISOString(), seen: 'yesterday' }] },
    })
    expect(res.json().results[0].status).toBe('applied')
  })
})
