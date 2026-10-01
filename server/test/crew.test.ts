import { MemoryStorage, newId, SyncClient, type CommandInput, type CommandName, type MutationResult, type Offer, type Person } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb } from '../src/db.ts'

/**
 * Crew booking, as the people involved see it: ops send offers from the
 * app, freelancers answer from their private link with no app or login,
 * and the server keeps anyone from being double booked or a call from
 * being over-filled.
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

async function call(app: FastifyInstance, over: Partial<CommandInput<'call.create'>> = {}) {
  const id = newId()
  const r = await send(app, 'call.create', {
    id,
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
  expect(r.status).toBe('applied')
  return id
}

async function offer(app: FastifyInstance, callId: string, personId: string, override = false) {
  const id = newId()
  const result = await send(app, 'offer.send', { id, callId, personId, override })
  return { id, result }
}

/** Post a form from a freelancer's link page, as their phone would. */
async function answer(app: FastifyInstance, token: string, offerId: string, fields: Record<string, string | string[]>) {
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) body.append(k, x)
  const res = await app.inject({
    method: 'POST',
    url: `/f/${token}/offers/${offerId}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: body.toString(),
  })
  expect(res.statusCode).toBe(303)
  const to = new URL(res.headers.location as string, 'http://x')
  return { ok: to.searchParams.get('ok') === '1', message: to.searchParams.get('m') ?? '', to }
}

/** One offer's card, as the page draws it. */
function cardOf(html: string, offerId: string) {
  const from = html.indexOf(`id="o-${offerId}"`)
  expect(from).toBeGreaterThan(-1)
  return html.slice(from, html.indexOf('</article>', from))
}

describe('freelancer link', () => {
  it('shows the full offer without a login and accepts from a plain form', async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const c = await call(app)
    const o = await offer(app, c, aoife.id)
    expect(o.result.status).toBe('applied')

    const page = await app.inject({ method: 'GET', url: `/f/${aoife.linkToken}` })
    expect(page.statusCode).toBe(200)
    expect(page.headers['cache-control']).toBe('no-store')
    expect(page.body).toContain('Hi Aoife')
    expect(page.body).toContain('Electric Picnic')
    expect(page.body).toContain('Stradbally Hall')
    expect(page.body).toContain('€250 a day')
    expect(page.body).toContain('Waiting on you')
    expect(page.body).not.toContain('<script')

    const r = await answer(app, aoife.linkToken, o.id, { answer: 'accept', picker: '1', days: ['2026-10-02', '2026-10-03', '2026-10-04'] })
    expect(r).toMatchObject({ ok: true })
    const after = await entity<Offer>(app, 'offer', o.id)
    expect(after).toMatchObject({ status: 'accepted', respondedVia: 'link' })
  })

  it('refuses unknown links and other people’s offers', async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const niall = await person(app, 'Niall Kerr')
    const o = await offer(app, await call(app), aoife.id)

    expect((await app.inject({ method: 'GET', url: '/f/not-a-real-token-at-all' })).statusCode).toBe(404)
    const r = await answer(app, niall.linkToken, o.id, { answer: 'decline' })
    expect(r.ok).toBe(false)
    expect((await entity<Offer>(app, 'offer', o.id)).status).toBe('offered')
  })

  it('stops working once ops issue a new link', async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    await send(app, 'person.newLink', { id: aoife.id })
    expect((await app.inject({ method: 'GET', url: `/f/${aoife.linkToken}` })).statusCode).toBe(404)
    const fresh = await entity<Person>(app, 'person', aoife.id)
    expect((await app.inject({ method: 'GET', url: `/f/${fresh.linkToken}` })).statusCode).toBe(200)
  })

  it('takes some days of a multi-day job, and a counter-offer', async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const niall = await person(app, 'Niall Kerr')
    const c = await call(app)
    const a = await offer(app, c, aoife.id)
    const n = await offer(app, c, niall.id)

    expect(await answer(app, aoife.linkToken, a.id, { answer: 'accept', picker: '1', days: [] })).toMatchObject({ ok: false })
    expect(await answer(app, aoife.linkToken, a.id, { answer: 'accept', picker: '1', days: ['2026-10-02', '2026-10-03'] })).toMatchObject({ ok: true })
    // Niall only asks for more money on the day still open.
    expect(await answer(app, niall.linkToken, n.id, { answer: 'counter', picker: '1', days: ['2026-10-04'], rate: '300' })).toMatchObject({ ok: true })
    expect(await entity<Offer>(app, 'offer', n.id)).toMatchObject({ status: 'countered', counterRateCents: 30000, days: ['2026-10-04'] })

    const confirmed = await send(app, 'offer.confirm', { id: n.id })
    expect(confirmed.status).toBe('applied')
    expect(await entity<Offer>(app, 'offer', n.id)).toMatchObject({ status: 'confirmed', dayRateCents: 30000 })
  })

  it('sends the rate when Enter is pressed in the rate field, and never accepts', async () => {
    // Enter presses the form's hidden first button, which answers "implicit": a rate is a counter, and nothing else happens.
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const o = await offer(app, await call(app), aoife.id)

    const blank = await answer(app, aoife.linkToken, o.id, { answer: 'implicit', picker: '1', days: ['2026-10-02', '2026-10-03'], rate: '' })
    expect(blank).toMatchObject({ ok: false, message: 'Tap Accept, Decline or Send rate.' })
    expect(await entity<Offer>(app, 'offer', o.id)).toMatchObject({ status: 'offered', counterRateCents: null })

    expect(await answer(app, aoife.linkToken, o.id, { answer: 'implicit', picker: '1', days: ['2026-10-02', '2026-10-03'], rate: '350' })).toMatchObject({ ok: true })
    expect(await entity<Offer>(app, 'offer', o.id)).toMatchObject({ status: 'countered', counterRateCents: 35000, days: ['2026-10-02', '2026-10-03'] })
  })

  it('puts the message in the offer’s card, where the page lands after an answer', async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const picnic = await offer(app, await call(app), aoife.id)
    const gig = await offer(app, await call(app, { project: 'Vicar Street', phase: 'Show', start: '2026-10-04', end: '2026-10-04' }), aoife.id)

    const thanks = await answer(app, aoife.linkToken, picnic.id, { answer: 'accept', picker: '1', days: ['2026-10-02', '2026-10-03', '2026-10-04'] })
    expect(thanks.to.searchParams.get('o')).toBe(picnic.id)
    expect(thanks.to.hash).toBe(`#o-${picnic.id}`)
    let page = (await app.inject({ method: 'GET', url: thanks.to.pathname + thanks.to.search })).body
    expect(cardOf(page, picnic.id)).toContain('<p class="flash ok" role="status">Thanks, you&#39;re down for it.')
    expect(page.match(/class="flash/g)).toHaveLength(1)

    // A refusal is an alert, in the card of the offer it's about.
    const refused = await answer(app, aoife.linkToken, gig.id, { answer: 'accept' })
    expect(refused.to.searchParams.get('o')).toBe(gig.id)
    page = (await app.inject({ method: 'GET', url: refused.to.pathname + refused.to.search })).body
    expect(cardOf(page, gig.id)).toContain('<p class="flash bad" role="alert">Already booked on Electric Picnic (Build)')
    expect(page.match(/class="flash/g)).toHaveLength(1)

    // A declined offer has no card any more, so its message goes at the top.
    const off = await answer(app, aoife.linkToken, gig.id, { answer: 'decline' })
    page = (await app.inject({ method: 'GET', url: off.to.pathname + off.to.search })).body
    expect(page).not.toContain(`id="o-${gig.id}"`)
    expect(page.indexOf('<p class="flash ok" role="status">Thanks for letting us know.')).toBeLessThan(page.indexOf('<section>'))
  })

  it('lets a freelancer mark days off, which ops then need to override', async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const res = await app.inject({
      method: 'POST',
      url: `/f/${aoife.linkToken}/away`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'start=2026-10-03&end=2026-10-05&note=On+tour',
    })
    expect(res.statusCode).toBe(303)

    const c = await call(app)
    const refused = await offer(app, c, aoife.id)
    expect(refused.result).toMatchObject({ status: 'rejected', reason: { code: 'clash' } })
    expect(refused.result.status === 'rejected' && refused.result.reason.message).toContain('On tour')
    const forced = await offer(app, c, aoife.id, true)
    expect(forced.result.status).toBe('applied')
    expect(await entity<Offer>(app, 'offer', forced.id)).toMatchObject({ override: true })
  })

  it('publishes bookings as a calendar feed any calendar app can subscribe to', async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const o = await offer(app, await call(app), aoife.id)
    await answer(app, aoife.linkToken, o.id, { answer: 'accept', picker: '1', days: ['2026-10-02', '2026-10-04'] })
    await send(app, 'offer.confirm', { id: o.id })

    const ics = await app.inject({ method: 'GET', url: `/f/${aoife.linkToken}/calendar.ics` })
    expect(ics.headers['content-type']).toContain('text/calendar')
    const body = ics.body
    // Two separate blocks, because she took the 2nd and the 4th only.
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(body).toContain('DTSTART;VALUE=DATE:20261002')
    expect(body).toContain('DTEND;VALUE=DATE:20261003')
    expect(body).toContain('SUMMARY:Electric Picnic - Build 1/2')
    expect(body).toContain('STATUS:CONFIRMED')
    for (const line of body.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75)
  })

  it('exports what is held on the person, without the link secret', async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const res = await app.inject({ method: 'GET', url: `/f/${aoife.linkToken}/data.json` })
    expect(res.json().profile.name).toBe('Aoife Byrne')
    expect(res.body).not.toContain(aoife.linkToken)
  })
})

describe('booking rules', () => {
  it('gives a shortlisted role to whoever accepts first and tells the rest', async () => {
    const app = await server()
    const people = await Promise.all(['Aoife Byrne', 'Niall Kerr', 'Siobhán Doyle'].map((n) => person(app, n)))
    const c = await call(app, { needed: 1, start: '2026-10-10', end: '2026-10-10' })
    const offers = []
    for (const p of people) offers.push(await offer(app, c, p.id))

    expect(await answer(app, people[1]!.linkToken, offers[1]!.id, { answer: 'accept' })).toMatchObject({ ok: true })
    expect((await entity<Offer>(app, 'offer', offers[0]!.id)).status).toBe('filled')
    expect((await entity<Offer>(app, 'offer', offers[2]!.id)).status).toBe('filled')

    const late = await answer(app, people[0]!.linkToken, offers[0]!.id, { answer: 'accept' })
    expect(late.ok).toBe(false)
    expect(late.message).toMatch(/filled/)
  })

  it('never double books a person, however the two acceptances arrive', async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const picnic = await call(app, { start: '2026-10-02', end: '2026-10-04' })
    const gig = await call(app, { project: 'Vicar Street', phase: 'Show', start: '2026-10-04', end: '2026-10-04' })
    const a = await offer(app, picnic, aoife.id)
    const b = await offer(app, gig, aoife.id)
    // Both offers were fine to send; she was free when they went out.
    expect(a.result.status).toBe('applied')
    expect(b.result.status).toBe('applied')

    expect(await answer(app, aoife.linkToken, a.id, { answer: 'accept', picker: '1', days: ['2026-10-02', '2026-10-03', '2026-10-04'] })).toMatchObject({ ok: true })
    const second = await answer(app, aoife.linkToken, b.id, { answer: 'accept' })
    expect(second.ok).toBe(false)
    expect(second.message).toContain('Already booked on Electric Picnic (Build)')

    // Dropping the clashing day from the first job frees her for the second.
    await answer(app, aoife.linkToken, a.id, { answer: 'accept', picker: '1', days: ['2026-10-02', '2026-10-03'] })
    expect(await answer(app, aoife.linkToken, b.id, { answer: 'accept' })).toMatchObject({ ok: true })
  })

  it('warns ops before offering someone already booked', async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const picnic = await call(app)
    const a = await offer(app, picnic, aoife.id)
    await answer(app, aoife.linkToken, a.id, { answer: 'accept', picker: '1', days: ['2026-10-02', '2026-10-03', '2026-10-04'] })
    const gig = await call(app, { project: 'Vicar Street', start: '2026-10-03', end: '2026-10-03' })
    const b = await offer(app, gig, aoife.id)
    expect(b.result).toMatchObject({ status: 'rejected', reason: { code: 'clash' } })
  })

  it('withdraws every open offer when a job is cancelled', async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const c = await call(app)
    const o = await offer(app, c, aoife.id)
    await send(app, 'call.cancel', { id: c })
    expect((await entity<Offer>(app, 'offer', o.id)).status).toBe('cancelled')
    const page = await app.inject({ method: 'GET', url: `/f/${aoife.linkToken}` })
    expect(page.body).toContain('Nothing waiting right now')
  })
})

describe('offline ops device', () => {
  it('queues people, calls and offers with no signal and shows them as pending', async () => {
    const app = await server()
    let online = false
    const client = await new SyncClient({
      storage: new MemoryStorage(),
      transport: {
        push: async (req) => {
          if (!online) throw new Error('offline')
          return (await app.inject({ method: 'POST', url: '/api/sync/push', payload: req })).json()
        },
        pull: async (after) => {
          if (!online) throw new Error('offline')
          return (await app.inject({ method: 'GET', url: `/api/sync/pull?after=${after}` })).json()
        },
      },
    }).open()

    const pid = newId()
    const cid = newId()
    await client.mutate('person.upsert', { id: pid, name: 'Aoife Byrne', kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '' })
    await client.mutate('call.create', {
      id: cid, project: 'Electric Picnic', phase: 'Build', venue: '', role: 'Audio tech',
      start: '2026-10-02', end: '2026-10-03', callTime: null, needed: 2, dayRateCents: 25000, details: '', replyBy: null,
    })
    await client.mutate('offer.send', { id: newId(), callId: cid, personId: pid, override: false })
    await expect(client.sync()).rejects.toThrow('offline')

    let view = client.view().crew
    expect(view.people[0]).toMatchObject({ name: 'Aoife Byrne', pending: true })
    expect(view.calls[0]!.offers[0]).toMatchObject({ status: 'offered', pending: true })
    expect(view.calls[0]!.openDays).toEqual(['2026-10-02', '2026-10-03'])

    online = true
    await client.sync()
    view = client.view().crew
    expect(view.people[0]!.pending).toBe(false)
    expect(view.people[0]!.linkToken.length).toBeGreaterThanOrEqual(24)
    expect(view.calls[0]!.offers[0]).toMatchObject({ status: 'offered', pending: false })
  })
})
