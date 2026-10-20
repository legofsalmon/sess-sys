import { newId, type CommandInput, type CommandName, type HistoryPage, type MutationResult, type Offer, type Person } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { roleOfAccount } from '../src/auth/roles.ts'
import { readApp } from '../src/calendar/import.ts'
import { personByEmail } from '../src/crew/store.ts'
import { pgliteDb } from '../src/db.ts'

/**
 * Combining people brought in twice (ADR 0055): a freelancer the calendars
 * met as aoife@gmail.com and as aoife@sessionhire.com is one person again,
 * with every booking, day off and address, and her old link still opens.
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
const ok = (r: MutationResult) => expect(r.status, JSON.stringify(r)).toBe('applied')
const reason = (r: MutationResult) => (r.status === 'rejected' ? r.reason : undefined)

async function feed(app: FastifyInstance) {
  return (await app.inject({ method: 'GET', url: '/api/sync/pull?after=0' })).json().changes as { entity: string; id: string; op: string; data: unknown }[]
}
async function latest<T>(app: FastifyInstance, entity: string, id: string): Promise<T | undefined> {
  const last = (await feed(app)).filter((c) => c.entity === entity && c.id === id).at(-1)
  return last?.op === 'delete' ? undefined : (last?.data as T)
}

async function person(app: FastifyInstance, name: string, over: Partial<CommandInput<'person.upsert'>> = {}) {
  const id = newId()
  ok(await send(app, 'person.upsert', { id, name, kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '', ...over }))
  return (await latest<Person>(app, 'person', id))!
}

async function call(app: FastifyInstance, project: string, start: string, end = start) {
  const id = newId()
  ok(
    await send(app, 'call.create', { id, project, phase: 'Show', venue: '', role: 'Audio tech', start, end, callTime: '08:00', needed: 2, dayRateCents: 25000, details: '', replyBy: null })
  )
  return id
}

async function booked(app: FastifyInstance, callId: string, personId: string, days?: string[]) {
  const id = newId()
  ok(await send(app, 'offer.send', { id, callId, personId, override: true }))
  ok(await send(app, 'offer.respond', { id, answer: 'accept', days: days ?? null, note: '' }))
  ok(await send(app, 'offer.confirm', { id }))
  return id
}

describe('combining people brought in twice', () => {
  it('makes one person of two, with both their bookings, days off and addresses, and both links opening them', async () => {
    const { app, db } = await server()
    const aoife = await person(app, 'Aoife Byrne', { email: 'aoife@sessionhire.com', phone: '+353871234567', skills: ['Audio'] })
    const twice = await person(app, 'Aoifebyrne', { email: 'AoifeByrne@gmail.com', skills: ['audio', 'LX'], notes: 'Has a van.' })
    const picnic = await call(app, 'Electric Picnic', '2026-10-02')
    const arena = await call(app, '3Arena', '2026-10-09')
    const first = await booked(app, picnic, aoife.id)
    const second = await booked(app, arena, twice.id)
    const off = newId()
    ok(await send(app, 'unavailability.add', { id: off, personId: twice.id, start: '2026-10-20', end: '2026-10-21', note: 'Wedding' }))

    ok(await send(app, 'person.merge', { id: aoife.id, from: [twice.id] }))

    const one = (await latest<Person>(app, 'person', aoife.id))!
    expect(one).toMatchObject({ name: 'Aoife Byrne', email: 'aoife@sessionhire.com', otherEmails: ['aoifebyrne@gmail.com'], skills: ['Audio', 'LX'], notes: 'Has a van.' })
    expect(await latest(app, 'person', twice.id)).toBeUndefined()
    expect((await latest<Offer>(app, 'offer', first))!.personId).toBe(aoife.id)
    expect((await latest<Offer>(app, 'offer', second))!.personId).toBe(aoife.id)
    expect((await latest<{ personId: string }>(app, 'unavailability', off))!.personId).toBe(aoife.id)
    expect((await db.query('SELECT count(*)::int AS n FROM people')).rows).toEqual([{ n: 1 }])

    // Her old link and its calendar feed still open, as her.
    const page = await app.inject({ url: `/f/${twice.linkToken}` })
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain('Aoife Byrne')
    expect((await app.inject({ url: `/f/${twice.linkToken}/calendar.ics` })).body).toContain('3Arena')

    // Either address finds her: her Google sign-in, the feed card, and the next bring-in.
    expect((await personByEmail(db, ' aoifebyrne@GMAIL.com'))?.id).toBe(aoife.id)
    expect((await readApp(db, '2026-10-01', '2026-10-31')).people).toEqual([expect.objectContaining({ id: aoife.id, otherEmails: ['aoifebyrne@gmail.com'] })])
    // Nobody else can be given an address she has.
    const other = await person(app, 'Someone Else')
    const taken = await send(app, 'person.upsert', { id: other.id, name: other.name, kind: 'freelancer', email: 'aoifebyrne@gmail.com', phone: null, skills: [], dayRateCents: null, notes: '' })
    expect(taken.status).toBe('rejected')
    expect(reason(taken)?.message).toContain('Aoife Byrne already has that email')

    const history = (await app.inject({ url: '/api/history' })).json() as HistoryPage
    expect(history.entries.map((e) => e.what)).toContain('Made Aoifebyrne part of Aoife Byrne, as one person')
  })

  it("keeps one offer when both were offered the same call, holding every day either held", async () => {
    const { app } = await server()
    const a = await person(app, 'Cian Walsh', { email: 'cian@sessionhire.com' })
    const b = await person(app, 'Cianw', { email: 'cianw@gmail.com' })
    const build = await call(app, 'Longitude', '2026-07-01', '2026-07-03')
    const one = await booked(app, build, a.id, ['2026-07-01'])
    const two = await booked(app, build, b.id, ['2026-07-02', '2026-07-03'])
    const asked = newId()
    const other = await call(app, 'Ploughing', '2026-09-15')
    ok(await send(app, 'offer.send', { id: asked, callId: other, personId: b.id, override: false }))

    ok(await send(app, 'person.merge', { id: b.id, from: [a.id] }))

    // The one kept was named from an address; the other's real name is the one the record takes.
    expect((await latest<Person>(app, 'person', b.id))!).toMatchObject({ name: 'Cian Walsh', email: 'cianw@gmail.com', otherEmails: ['cian@sessionhire.com'] })
    const kept = [await latest<Offer>(app, 'offer', one), await latest<Offer>(app, 'offer', two)].filter(Boolean) as Offer[]
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ personId: b.id, status: 'confirmed', days: ['2026-07-01', '2026-07-02', '2026-07-03'] })
    expect((await latest<Offer>(app, 'offer', asked))!.personId).toBe(b.id)
  })

  it('finds the role of whoever signs in with any of their addresses', async () => {
    const { app, db } = await server()
    const colly = await person(app, 'Colly', { kind: 'staff', email: 'colly@sessionhire.com' })
    const again = await person(app, 'Colly Hewson', { kind: 'staff', email: 'colly@gmail.com' })
    ok(await send(app, 'person.role', { id: colly.id, role: 'director' }))
    expect((await roleOfAccount(db, 'colly@gmail.com')).role).toBe('crew')

    ok(await send(app, 'person.merge', { id: colly.id, from: [again.id] }))
    expect(await roleOfAccount(db, 'colly@gmail.com')).toMatchObject({ role: 'director', personId: colly.id })
    // "Colly" was only what colly@ said; the other had a whole name.
    expect((await latest<Person>(app, 'person', colly.id))!.name).toBe('Colly Hewson')
  })

  it('makes another of their addresses the main one, and they still sign in with the same role by either (ADR 0064)', async () => {
    const { app, db } = await server()
    const colly = await person(app, 'Colly', { kind: 'staff', email: 'colly@sessionhire.com' })
    const again = await person(app, 'Colly Hewson', { kind: 'staff', email: 'colly@gmail.com' })
    ok(await send(app, 'person.role', { id: colly.id, role: 'director' }))
    ok(await send(app, 'person.merge', { id: colly.id, from: [again.id] }))

    ok(await send(app, 'person.mainEmail', { id: colly.id, email: 'Colly@Gmail.com' }))
    const now = (await latest<Person>(app, 'person', colly.id))!
    expect([now.email, now.otherEmails]).toEqual(['colly@gmail.com', ['colly@sessionhire.com']])
    for (const e of ['colly@gmail.com', 'colly@sessionhire.com']) expect(await roleOfAccount(db, e)).toMatchObject({ role: 'director', personId: colly.id })

    // Back again is the same move; an address they aren't found by isn't theirs to make main.
    ok(await send(app, 'person.mainEmail', { id: colly.id, email: 'colly@sessionhire.com' }))
    expect((await latest<Person>(app, 'person', colly.id))!.email).toBe('colly@sessionhire.com')
    expect(reason(await send(app, 'person.mainEmail', { id: colly.id, email: 'colly@sessionhire.com' }))?.code).toBe('conflict')
    expect(reason(await send(app, 'person.mainEmail', { id: colly.id, email: 'someone@else.ie' }))?.code).toBe('conflict')
  })

  it('refuses two different roles, and leaves everything as it was', async () => {
    const { app, db } = await server()
    const a = await person(app, 'Sean Murphy', { kind: 'staff', email: 'sean@sessionhire.com' })
    const b = await person(app, 'Sean Murphy', { kind: 'staff', email: 'sean@gmail.com' })
    ok(await send(app, 'person.role', { id: a.id, role: 'director' }))
    ok(await send(app, 'person.role', { id: b.id, role: 'office' }))
    const r = await send(app, 'person.merge', { id: a.id, from: [b.id] })
    expect(r.status).toBe('rejected')
    expect(reason(r)?.message).toContain('have different roles')
    expect((await db.query('SELECT count(*)::int AS n FROM people')).rows).toEqual([{ n: 2 }])
  })

  it('refuses a person and themselves, and someone no longer there', async () => {
    const { app } = await server()
    const a = await person(app, 'Niamh Kelly')
    expect((await send(app, 'person.merge', { id: a.id, from: [a.id] })).status).toBe('rejected')
    expect(reason(await send(app, 'person.merge', { id: a.id, from: ['nobody'] }))?.code).toBe('not-found')
  })

  it('stops the old links with a new one, and erasing the one person erases what the others held', async () => {
    const { app, db } = await server()
    const a = await person(app, 'Dara Nolan', { email: 'dara@sessionhire.com' })
    const b = await person(app, 'Daranolan', { email: 'daranolan@gmail.com', phone: '+353861112223' })
    ok(await send(app, 'person.merge', { id: a.id, from: [b.id] }))
    ok(await send(app, 'person.newLink', { id: a.id }))
    expect((await app.inject({ url: `/f/${b.linkToken}` })).statusCode).toBe(404)

    ok(await send(app, 'person.archive', { id: a.id, archived: true }))
    ok(await send(app, 'person.erase', { id: a.id }))
    const text = JSON.stringify((await db.query('SELECT data FROM changes')).rows) + JSON.stringify((await db.query('SELECT args, result FROM mutations')).rows)
    expect(text).not.toContain('daranolan@gmail.com')
    expect(text).not.toContain('861112223')
    expect(text).not.toContain('Daranolan')
    expect((await db.query('SELECT count(*)::int AS n FROM person_merges')).rows).toEqual([{ n: 0 }])
  })
})

