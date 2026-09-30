import { feedCodeFor, feedPath, newId, type CommandInput, type CommandName, type MutationResult, type Person } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp, type AppOptions } from '../src/app.ts'
import { pgliteDb, type Db } from '../src/db.ts'
import { pathForLog } from '../src/http.ts'

/**
 * Personal calendar feeds (ADR 0012): a read-only address of their own
 * that can go in a shared calendar, answered from memory so calendar apps
 * looking every hour don't wake the database, and private addresses kept
 * out of the server's log.
 */

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

/** The app, with a count of every question put to the database. */
async function server(options: Partial<AppOptions> = {}) {
  const real = await pgliteDb()
  const reads = { count: 0 }
  const db: Db = {
    ...real,
    query: (sql, params) => {
      reads.count++
      return real.query(sql, params)
    },
  }
  const app = await buildApp({ db, ...options })
  cleanup.push(async () => {
    await app.close()
    await real.close()
  })
  return { app, reads }
}

async function send<N extends CommandName>(app: FastifyInstance, name: N, args: CommandInput<N>): Promise<MutationResult> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    payload: { clientId: 'ops-laptop', mutations: [{ id: newId(), name, args, createdAt: new Date().toISOString() }] },
  })
  return res.json().results[0]
}

async function entity<T>(app: FastifyInstance, kind: string, id: string): Promise<T> {
  const res = await app.inject({ method: 'GET', url: '/api/sync/pull?after=0' })
  const changes = res.json().changes.filter((c: { entity: string; id: string }) => c.entity === kind && c.id === id)
  return changes[changes.length - 1].data
}

async function person(app: FastifyInstance, name: string): Promise<Person> {
  const id = newId()
  await send(app, 'person.upsert', { id, name, kind: 'freelancer', email: null, phone: '+353871234567', skills: ['audio'], dayRateCents: null, notes: '' })
  return entity<Person>(app, 'person', id)
}

/** A job with one offer to the person. */
async function offer(app: FastifyInstance, personId: string, over: Partial<CommandInput<'call.create'>> = {}) {
  const callId = newId()
  await send(app, 'call.create', {
    id: callId,
    project: 'Electric Picnic',
    phase: 'Build',
    venue: 'Stradbally Hall',
    role: 'Audio tech',
    start: '2026-10-02',
    end: '2026-10-04',
    callTime: '08:00',
    needed: 1,
    dayRateCents: 25000,
    details: 'Food on site. Parking at gate C.',
    replyBy: null,
    ...over,
  })
  const id = newId()
  expect((await send(app, 'offer.send', { id, callId, personId, override: false })).status).toBe('applied')
  return id
}

/** An answer from the freelancer's link page, as their phone would post it. */
async function answer(app: FastifyInstance, token: string, offerId: string, answer: 'accept' | 'decline') {
  const res = await app.inject({
    method: 'POST',
    url: `/f/${token}/offers/${offerId}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: `answer=${answer}`,
  })
  expect(res.headers.location).toContain('ok=1')
}

const feedOf = async (p: Person) => feedPath(await feedCodeFor(p.linkToken))
const events = (ics: string) => ics.match(/BEGIN:VEVENT/g)?.length ?? 0

describe('personal calendar feeds', () => {
  it('gives each person a read-only address, shown on their page, with nothing in it that answers for them', async () => {
    const { app } = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const o = await offer(app, aoife.id)
    await answer(app, aoife.linkToken, o, 'accept')
    await send(app, 'offer.confirm', { id: o })

    const path = await feedOf(aoife)
    expect(path).toMatch(/^\/cal\/[\w-]{24}\.ics$/)
    const page = await app.inject({ method: 'GET', url: `/f/${aoife.linkToken}` })
    expect(page.body).toContain(`http://localhost:80${path}`)
    expect(page.body).toContain(`webcal://localhost:80${path}`)
    expect(page.body).not.toContain(`${aoife.linkToken}/calendar.ics`)

    const feed = await app.inject({ method: 'GET', url: path })
    expect(feed.statusCode).toBe(200)
    expect(feed.headers['content-type']).toContain('text/calendar')
    expect(feed.headers['cache-control']).toBe('private, no-cache')
    expect(feed.headers['x-robots-tag']).toBe('noindex')
    expect(feed.body).toContain('X-WR-CALNAME:Session Hire: Aoife Byrne')
    expect(feed.body).toContain('SUMMARY:Electric Picnic - Build')
    expect(feed.body).toContain('LOCATION:Stradbally Hall')
    expect(feed.body).toContain('STATUS:CONFIRMED')
    // Nothing that opens her page: a shared calendar can't answer for her.
    expect(feed.body).not.toContain(aoife.linkToken)
    expect(feed.body).not.toContain('/f/')
    expect(feed.body).not.toMatch(/^URL:/m)
    for (const line of feed.body.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75)

    // The feed's code isn't a link, and works with or without .ics on the end.
    const code = path.slice(5, -4)
    expect((await app.inject({ method: 'GET', url: `/f/${code}` })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/cal/${code}` })).body).toBe(feed.body)
    // Anyone already subscribed at the first address keeps getting it.
    expect((await app.inject({ method: 'GET', url: `/f/${aoife.linkToken}/calendar.ics` })).body).toBe(feed.body)
  })

  it('answers calendar apps from memory, and builds the feeds again after any change', async () => {
    const { app, reads } = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const o = await offer(app, aoife.id)
    const path = await feedOf(aoife)

    expect(events((await app.inject({ method: 'GET', url: path })).body)).toBe(0)
    const before = reads.count
    for (const url of [path, path, `/f/${aoife.linkToken}/calendar.ics`, `/cal/${'x'.repeat(24)}.ics`, '/cal/nonsense', '/f/short/calendar.ics'])
      await app.inject({ method: 'GET', url })
    expect(reads.count).toBe(before)
    expect((await app.inject({ method: 'GET', url: `/cal/${'x'.repeat(24)}.ics` })).statusCode).toBe(404)

    // Her answer on the link reaches the feed, as tentative until the office confirms.
    await answer(app, aoife.linkToken, o, 'accept')
    const accepted = (await app.inject({ method: 'GET', url: path })).body
    expect(events(accepted)).toBe(1)
    expect(accepted).toContain('STATUS:TENTATIVE')
    expect(accepted).toContain('DESCRIPTION:Audio tech (accepted\\, waiting for the office to confirm)')

    // A change synced from the office does too.
    await send(app, 'offer.confirm', { id: o })
    expect((await app.inject({ method: 'GET', url: path })).body).toContain('STATUS:CONFIRMED')

    // A withdrawn job leaves it.
    await send(app, 'offer.cancel', { id: o })
    expect(events((await app.inject({ method: 'GET', url: path })).body)).toBe(0)
  })

  it('tells a calendar app when nothing has changed, even after other people change', async () => {
    const { app } = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const niall = await person(app, 'Niall Kerr')
    const o = await offer(app, aoife.id)
    await answer(app, aoife.linkToken, o, 'accept')
    const path = await feedOf(aoife)

    const first = await app.inject({ method: 'GET', url: path })
    const etag = first.headers.etag as string
    const modified = first.headers['last-modified'] as string
    expect(etag).toMatch(/^"[\w-]+"$/)
    expect(new Date(modified).getTime()).toBeGreaterThan(0)

    const again = await app.inject({ method: 'GET', url: path, headers: { 'if-none-match': etag } })
    expect(again.statusCode).toBe(304)
    expect(again.body).toBe('')
    expect(again.headers.etag).toBe(etag)
    expect((await app.inject({ method: 'GET', url: path, headers: { 'if-modified-since': modified } })).statusCode).toBe(304)

    // Niall's booking rebuilds every feed, but Aoife's says the same, so her calendar app hears "no change".
    const n = await offer(app, niall.id, { project: 'Vicar Street', phase: 'Show', start: '2026-10-09', end: '2026-10-09' })
    await answer(app, niall.linkToken, n, 'accept')
    expect(events((await app.inject({ method: 'GET', url: await feedOf(niall) })).body)).toBe(1)
    expect((await app.inject({ method: 'GET', url: path, headers: { 'if-none-match': etag } })).statusCode).toBe(304)

    // Her own booking being confirmed is news.
    await send(app, 'offer.confirm', { id: o })
    const changed = await app.inject({ method: 'GET', url: path, headers: { 'if-none-match': etag } })
    expect(changed.statusCode).toBe(200)
    expect(changed.headers.etag).not.toBe(etag)
    expect(changed.body).toContain('STATUS:CONFIRMED')
  })

  it('retires both feed addresses with the link when the office makes a new one', async () => {
    const { app } = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const old = await feedOf(aoife)
    expect((await app.inject({ method: 'GET', url: old })).statusCode).toBe(200)

    await send(app, 'person.newLink', { id: aoife.id })
    const renewed = await entity<Person>(app, 'person', aoife.id)
    expect(renewed.linkToken).not.toBe(aoife.linkToken)
    expect((await app.inject({ method: 'GET', url: old })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/f/${aoife.linkToken}/calendar.ics` })).statusCode).toBe(404)
    const now = await app.inject({ method: 'GET', url: await feedOf(renewed) })
    expect(now.statusCode).toBe(200)
    expect(now.body).toContain('X-WR-CALNAME:Session Hire: Aoife Byrne')
  })

  it('reads the database again after 6 hours even with no change, for a deploy when two servers run', async () => {
    let clock = new Date('2026-10-01T09:00:00Z')
    const { app, reads } = await server({ feeds: { now: () => clock } })
    const aoife = await person(app, 'Aoife Byrne')
    const path = await feedOf(aoife)

    await app.inject({ method: 'GET', url: path })
    const built = reads.count
    clock = new Date('2026-10-01T14:59:00Z')
    await app.inject({ method: 'GET', url: path })
    expect(reads.count).toBe(built)
    clock = new Date('2026-10-01T15:00:01Z')
    await app.inject({ method: 'GET', url: path })
    expect(reads.count).toBeGreaterThan(built)
  })

  it('works out the same feed code for the same link, and a different one for any other', async () => {
    const link = 'Zm9vYmFyYmF6cXV4cXV1eGNv'
    const code = await feedCodeFor(link)
    expect(code).toMatch(/^[\w-]{24}$/)
    expect(await feedCodeFor(link)).toBe(code)
    expect(await feedCodeFor(`${link.slice(0, -1)}p`)).not.toBe(code)
    expect(code).not.toContain(link.slice(0, 8))
  })
})

describe('the request log', () => {
  it('keeps private links, feed codes and sign-in codes out of it', async () => {
    const lines: string[] = []
    const { app } = await server({ logger: true, logTo: { write: (line) => void lines.push(line) } })
    const aoife = await person(app, 'Aoife Byrne')
    const feed = await feedOf(aoife)
    const urls = [`/f/${aoife.linkToken}`, `/f/${aoife.linkToken}/calendar.ics`, feed, '/api/auth/google/callback?code=4/0AVGzR1Bsecretcode&state=abc']
    for (const url of [...urls, `/f/${aoife.linkToken}/nothing?code=secretcode`, '/api/up']) await app.inject({ method: 'GET', url })

    const log = lines.join('')
    expect(log).toContain('"url":"/f/:token"')
    expect(log).toContain('"url":"/f/:token/calendar.ics"')
    expect(log).toContain('"url":"/cal/:token"')
    expect(log).toContain('"url":"/api/up"')
    expect(log).not.toContain(aoife.linkToken)
    expect(log).not.toContain(feed.slice(5, -4))
    expect(log).not.toContain('secretcode')
    expect(log).not.toContain('remoteAddress')
  })

  it('masks the addresses however they are written', () => {
    expect(pathForLog('/f/abcdefghijklmnopqrstuvwx/offers/o1?m=Thanks&ok=1')).toBe('/f/:token/offers/o1')
    expect(pathForLog('/cal/abcdefghijklmnopqrstuvwx.ics')).toBe('/cal/:token')
    expect(pathForLog('//f/abcdefghijklmnopqrstuvwx')).toBe('//f/:token')
    expect(pathForLog('/api/calendar/import/look')).toBe('/api/calendar/import/look')
    expect(pathForLog('/somewhere/abcdefghijklmnopqrstuvwxyz/aoife@example.com')).toBe('/somewhere/[secret]/[email]')
  })
})
