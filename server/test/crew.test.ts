import { feedCodeFor, feedPath, MemoryStorage, newId, SyncClient, type CommandInput, type CommandName, type CrewCall, type HistoryPage, type MutationResult, type Offer, type Person } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb } from '../src/db.ts'
import { IPHONE, server as signedIn, staff } from './people.ts'

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

  it('takes Enter in the rate field as Send rate, or asks for a tap: never as Accept', async () => {
    // Enter presses the form's out-of-sight first button, which answers "implicit": a rate is a counter, and nothing else happens.
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

describe('changing a call', () => {
  it("changes a call's time, rate and details, and the freelancer's page, feed and call sheet read the new values", async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const niall = await person(app, 'Niall Kerr')
    const c = await call(app, { needed: 2 })
    const a = await offer(app, c, aoife.id)
    const n = await offer(app, c, niall.id)
    await answer(app, aoife.linkToken, a.id, { answer: 'accept' })
    await send(app, 'offer.confirm', { id: a.id })

    const r = await send(app, 'call.update', { id: c, callTime: '09:00', dayRateCents: 28000, details: 'Food on site. Parking at gate B.', replyBy: '2026-09-30' })
    expect(r.status).toBe('applied')
    expect(await entity<CrewCall>(app, 'crewCall', c)).toMatchObject({ callTime: '09:00', dayRateCents: 28000, details: 'Food on site. Parking at gate B.', replyBy: '2026-09-30' })
    // The new rate reaches Niall, still deciding; Aoife keeps the rate she was confirmed at.
    expect(await entity<Offer>(app, 'offer', n.id)).toMatchObject({ status: 'offered', dayRateCents: 28000 })
    expect(await entity<Offer>(app, 'offer', a.id)).toMatchObject({ status: 'confirmed', dayRateCents: 25000 })

    const nialls = (await app.inject({ url: `/f/${niall.linkToken}` })).body
    expect(nialls).toContain('<dt>Call</dt><dd>09:00</dd>')
    expect(nialls).toContain('€280 a day')
    expect(nialls).toContain('<dt>Reply by</dt><dd>Wed 30 Sep</dd>')
    const aoifes = (await app.inject({ url: `/f/${aoife.linkToken}` })).body
    expect(aoifes).toContain('<dt>Call</dt><dd>09:00</dd>')
    expect(aoifes).toContain('€250 a day')
    expect(aoifes).toContain('Parking at gate B.')
    const sheet = (await app.inject({ url: `/f/${aoife.linkToken}/sheet/${c}` })).body
    expect(sheet).toContain('call <b>09:00</b>')
    expect(sheet).toContain('Parking at gate B.')
    const feed = (await app.inject({ url: `/f/${aoife.linkToken}/calendar.ics` })).body
    expect(feed).toContain('09:00')

    const history: HistoryPage = (await app.inject({ url: '/api/history' })).json()
    expect(history.entries[0]!.what).toBe('Changed the call for Audio tech on Electric Picnic: call time to 09:00, day rate to €280, the details and reply by Wed 30 Sep')
  })

  it("moves a call's days with the days its offers hold, and never strands anyone booked", async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const niall = await person(app, 'Niall Kerr')
    const dara = await person(app, 'Dara Walsh')
    const c = await call(app, { needed: 2 })
    const a = await offer(app, c, aoife.id)
    const n = await offer(app, c, niall.id)
    const d = await offer(app, c, dara.id)
    await answer(app, aoife.linkToken, a.id, { answer: 'accept' })
    await send(app, 'offer.confirm', { id: a.id })
    await answer(app, niall.linkToken, n.id, { answer: 'accept', picker: '1', days: ['2026-10-04'] })

    // A day later: Aoife, who held every day, holds every new day; Niall keeps the 4th; Dara is offered the new days.
    expect(await send(app, 'call.update', { id: c, start: '2026-10-03', end: '2026-10-05' })).toMatchObject({ status: 'applied' })
    expect(await entity<Offer>(app, 'offer', a.id)).toMatchObject({ status: 'confirmed', days: ['2026-10-03', '2026-10-04', '2026-10-05'] })
    expect(await entity<Offer>(app, 'offer', n.id)).toMatchObject({ status: 'accepted', days: ['2026-10-04'] })
    expect(await entity<Offer>(app, 'offer', d.id)).toMatchObject({ status: 'offered', days: ['2026-10-03', '2026-10-04', '2026-10-05'] })
    expect((await app.inject({ url: `/f/${aoife.linkToken}` })).body).toContain('Sat 3 Oct to Mon 5 Oct')
    const ics = (await app.inject({ url: `/f/${aoife.linkToken}/calendar.ics` })).body
    expect(ics).toContain('DTSTART;VALUE=DATE:20261003')
    expect(ics).not.toContain('DTSTART;VALUE=DATE:20261002')

    // Past the one day Niall holds: refused by name, and nothing changes.
    const refused = await send(app, 'call.update', { id: c, start: '2026-10-05', end: '2026-10-06' })
    expect(refused).toMatchObject({ status: 'rejected', reason: { code: 'conflict', message: 'Niall Kerr is booked for days that would go. Release them or keep those days.' } })
    expect(await entity<CrewCall>(app, 'crewCall', c)).toMatchObject({ start: '2026-10-03', end: '2026-10-05' })
    expect(await entity<Offer>(app, 'offer', n.id)).toMatchObject({ status: 'accepted', days: ['2026-10-04'] })
  })

  it("won't move someone booked onto a day they hold on another job", async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const picnic = await call(app)
    const gig = await call(app, { project: 'Vicar Street', phase: 'Show', start: '2026-10-05', end: '2026-10-05' })
    const a = await offer(app, picnic, aoife.id)
    const g = await offer(app, gig, aoife.id)
    await answer(app, aoife.linkToken, a.id, { answer: 'accept' })
    await answer(app, aoife.linkToken, g.id, { answer: 'accept' })
    const refused = await send(app, 'call.update', { id: picnic, start: '2026-10-03', end: '2026-10-05' })
    expect(refused).toMatchObject({
      status: 'rejected',
      reason: { code: 'clash', message: 'Aoife Byrne is already booked on Vicar Street (Show) Mon 5 Oct. Release them or keep those days.' },
    })
  })

  it("won't move someone booked onto a day they marked off, which an offer would need an override for", async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const c = await call(app)
    const a = await offer(app, c, aoife.id)
    await answer(app, aoife.linkToken, a.id, { answer: 'accept' })
    await send(app, 'unavailability.add', { id: newId(), personId: aoife.id, start: '2026-10-05', end: '2026-10-05', note: 'Dentist' })
    const refused = await send(app, 'call.update', { id: c, end: '2026-10-05' })
    expect(refused).toMatchObject({
      status: 'rejected',
      reason: { code: 'clash', message: 'Aoife Byrne is marked unavailable Mon 5 Oct (Dentist). Release them or keep those days.' },
    })
    expect(await entity<CrewCall>(app, 'crewCall', c)).toMatchObject({ end: '2026-10-04' })
    expect(await entity<Offer>(app, 'offer', a.id)).toMatchObject({ days: ['2026-10-02', '2026-10-03', '2026-10-04'] })
  })

  it("won't need fewer people than are booked, and opens the call again when it needs more", async () => {
    const app = await server()
    const [aoife, niall, dara, eimear] = await Promise.all(['Aoife Byrne', 'Niall Kerr', 'Dara Walsh', 'Eimear Nolan'].map((n) => person(app, n)))
    const c = await call(app, { needed: 2, start: '2026-10-10', end: '2026-10-10' })
    const a = await offer(app, c, aoife!.id)
    const n = await offer(app, c, niall!.id)
    const d = await offer(app, c, dara!.id)
    await answer(app, aoife!.linkToken, a.id, { answer: 'accept' })
    await answer(app, niall!.linkToken, n.id, { answer: 'accept' })
    expect((await entity<Offer>(app, 'offer', d.id)).status).toBe('filled')

    const refused = await send(app, 'call.update', { id: c, needed: 1 })
    expect(refused).toMatchObject({ status: 'rejected', reason: { code: 'conflict', message: '2 people are booked; release one first.' } })
    expect((await offer(app, c, eimear!.id)).result).toMatchObject({ status: 'rejected', reason: { code: 'filled' } })

    // Needing one more opens it again. Dara was told it had filled, so a new offer goes out.
    expect(await send(app, 'call.update', { id: c, needed: 3 })).toMatchObject({ status: 'applied' })
    expect((await entity<Offer>(app, 'offer', d.id)).status).toBe('filled')
    const again = await offer(app, c, dara!.id)
    expect(again.result.status).toBe('applied')
    expect(await answer(app, dara!.linkToken, again.id, { answer: 'accept' })).toMatchObject({ ok: true })
  })

  it('shows a change made with no signal at once, with the offers it reaches', async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const niall = await person(app, 'Niall Kerr')
    const c = await call(app, { needed: 2 })
    const a = await offer(app, c, aoife.id)
    const n = await offer(app, c, niall.id)
    await answer(app, aoife.linkToken, a.id, { answer: 'accept', picker: '1', days: ['2026-10-02', '2026-10-03', '2026-10-04'] })
    let online = true
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
    await client.sync()
    online = false
    await client.mutate('call.update', { id: c, start: '2026-10-03', end: '2026-10-05', dayRateCents: 30000 })
    await expect(client.sync()).rejects.toThrow('offline')
    const view = client.view().crew.calls[0]!
    expect(view).toMatchObject({ pending: true, start: '2026-10-03', end: '2026-10-05', dayRateCents: 30000 })
    expect(view.offers.find((o) => o.id === a.id)).toMatchObject({ days: ['2026-10-03', '2026-10-04', '2026-10-05'], dayRateCents: 25000, pending: true })
    expect(view.offers.find((o) => o.id === n.id)).toMatchObject({ days: ['2026-10-03', '2026-10-04', '2026-10-05'], dayRateCents: 30000, pending: true })

    online = true
    await client.sync()
    expect(client.view().crew.calls[0]).toMatchObject({ pending: false, start: '2026-10-03', end: '2026-10-05' })
    expect(await entity<Offer>(app, 'offer', n.id)).toMatchObject({ days: ['2026-10-03', '2026-10-04', '2026-10-05'], dayRateCents: 30000 })
describe('telling the office', () => {
  it('keeps a decline for the office to note, and says so in the history', async () => {
    // A decline leaves a call short; it waits in "Answers to check" (seenAt null) until the office taps Noted.
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const c = await call(app, { needed: 2 })
    const o = await offer(app, c, aoife.id)
    expect(await answer(app, aoife.linkToken, o.id, { answer: 'decline', note: 'At a wedding that weekend.' })).toMatchObject({ ok: true })
    expect(await entity<Offer>(app, 'offer', o.id)).toMatchObject({ status: 'declined', note: 'At a wedding that weekend.', seenAt: null })

    expect((await send(app, 'offer.seen', { id: o.id })).status).toBe('applied')
    const noted = await entity<Offer>(app, 'offer', o.id)
    expect(noted.seenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // Noted again, from another device: nothing changes.
    expect((await send(app, 'offer.seen', { id: o.id })).status).toBe('applied')
    expect((await entity<Offer>(app, 'offer', o.id)).seenAt).toBe(noted.seenAt)
    expect((await send(app, 'offer.seen', { id: 'nope' })).status).toBe('rejected')

    const history = (await app.inject({ url: '/api/history' })).json() as { entries: { what: string; outcome: string }[] }
    expect(history.entries.map((e) => [e.what, e.outcome]).slice(0, 4)).toEqual([
      ["Noted someone's answer on a role on a job", 'turned-down'],
      ['Noted that Aoife Byrne declined Audio tech on Electric Picnic', 'done'],
      ['Noted that Aoife Byrne declined Audio tech on Electric Picnic', 'done'],
      ['Aoife Byrne declined Audio tech on Electric Picnic', 'done'],
    ])
  })

  it('lets someone booked say they can’t make it: the place is free again, and the office hears of it', async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const niall = await person(app, 'Niall Kerr')
    const c = await call(app, { needed: 1 })
    const o = await offer(app, c, aoife.id)
    await answer(app, aoife.linkToken, o.id, { answer: 'accept' })
    await send(app, 'offer.confirm', { id: o.id })
    await send(app, 'offer.seen', { id: o.id })
    // Full, so Niall's offer is turned down.
    expect((await offer(app, c, niall.id)).result).toMatchObject({ status: 'rejected', reason: { code: 'filled' } })

    // Her page offers the way out on a booking, folded away, and takes the pull-out from its own form.
    let page = (await app.inject({ url: `/f/${aoife.linkToken}` })).body
    expect(cardOf(page, o.id)).toContain("Can't make it any more?")
    expect(cardOf(page, o.id)).toContain('name="answer" value="pullOut"')
    expect(cardOf(page, o.id)).not.toContain('value="decline"')
    const out = await answer(app, aoife.linkToken, o.id, { answer: 'pullOut', note: 'Double booked, sorry.' })
    expect(out).toMatchObject({ ok: true, message: "Thanks for telling us. You're off this one, and the office will find cover." })
    // A pull-out is new to the office, so it waits to be noted even though the booking had been.
    expect(await entity<Offer>(app, 'offer', o.id)).toMatchObject({ status: 'pulled-out', note: 'Double booked, sorry.', respondedVia: 'link', seenAt: null })

    // The card has gone to "Earlier", with the message at the top; the place is free, so Niall can be offered it and the sheet leaves her out.
    page = (await app.inject({ url: out.to.pathname + out.to.search })).body
    expect(page).toContain("You've pulled out")
    expect(page).not.toContain(`id="o-${o.id}"`)
    expect(page.indexOf('class="flash ok"')).toBeLessThan(page.indexOf('<section>'))
    const n = await offer(app, c, niall.id)
    expect(n.result.status).toBe('applied')
    // And she can be offered the same call again, afresh, while it's still open.
    const again = await offer(app, c, aoife.id)
    expect(again.result.status).toBe('applied')
    expect(await answer(app, niall.linkToken, n.id, { answer: 'accept' })).toMatchObject({ ok: true })
    expect((await entity<Offer>(app, 'offer', again.id)).status).toBe('filled')
    expect((await app.inject({ url: `/f/${aoife.linkToken}/sheet/${c}` })).statusCode).toBe(404)
    expect((await app.inject({ url: `/f/${niall.linkToken}/sheet/${c}` })).body).not.toContain('Aoife Byrne')

    const history = (await app.inject({ url: '/api/history' })).json() as { entries: { what: string; who: { kind: string; name: string } }[] }
    expect(history.entries.find((e) => e.what.startsWith('Aoife Byrne can'))).toMatchObject({
      what: "Aoife Byrne can't make it any more: Audio tech on Electric Picnic (Double booked, sorry.)",
      who: { kind: 'link', name: 'Aoife Byrne' },
    })
  })

  it('takes a pull-out only from someone who said yes, from the link or the app', async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const c = await call(app)
    const o = await offer(app, c, aoife.id)
    const early = await answer(app, aoife.linkToken, o.id, { answer: 'pullOut' })
    expect(early).toMatchObject({ ok: false, message: "You can only pull out of a job you've said yes to." })
    expect((await entity<Offer>(app, 'offer', o.id)).status).toBe('offered')

    // Accepted, not yet confirmed: the office records a pull-out that came by phone.
    await answer(app, aoife.linkToken, o.id, { answer: 'accept' })
    expect((await send(app, 'offer.respond', { id: o.id, answer: 'pullOut', note: 'Rang to say so.' })).status).toBe('applied')
    expect(await entity<Offer>(app, 'offer', o.id)).toMatchObject({ status: 'pulled-out', respondedVia: 'app' })
    // Pulled out is over: no answering it again.
    expect(await answer(app, aoife.linkToken, o.id, { answer: 'accept' })).toMatchObject({ ok: false, message: "You've pulled out of this one. Ask the office if you can do it after all." })
    const history = (await app.inject({ url: '/api/history' })).json() as { entries: { what: string }[] }
    expect(history.entries[1]!.what).toBe("Aoife Byrne can't make it any more: Audio tech on Electric Picnic (Rang to say so.)")
    await send(app, 'offer.seen', { id: o.id })
    expect((await app.inject({ url: '/api/history' })).json().entries[0].what).toBe("Noted that Aoife Byrne can't make Audio tech on Electric Picnic")
    // A Withdraw queued on another device changes nothing: the pull-out stays for the office to see.
    expect((await send(app, 'offer.cancel', { id: o.id })).status).toBe('applied')
    expect((await entity<Offer>(app, 'offer', o.id)).status).toBe('pulled-out')

    // Once the job has happened the page shows no way out, and a crafted post is refused, so the timesheet stays.
    const past = await call(app, { start: '2026-09-01', end: '2026-09-02' })
    const done = await offer(app, past, aoife.id)
    await answer(app, aoife.linkToken, done.id, { answer: 'accept' })
    await send(app, 'offer.confirm', { id: done.id })
    expect(await answer(app, aoife.linkToken, done.id, { answer: 'pullOut' })).toMatchObject({ ok: false, message: 'That job has already happened; talk to the office.' })
    expect((await entity<Offer>(app, 'offer', done.id)).status).toBe('confirmed')
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

/** A form posted from a freelancer's page, as their phone would, and where it lands. */
async function post(app: FastifyInstance, path: string, fields: Record<string, string>) {
  const res = await app.inject({
    method: 'POST',
    url: path,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  })
  expect(res.statusCode).toBe(303)
  const to = new URL(res.headers.location as string, 'http://x')
  return { ok: to.searchParams.get('ok') === '1', message: to.searchParams.get('m') ?? '', to }
}

describe('correcting people (audit finding 7)', () => {
  it('edits a person with person.upsert, keeping their link and whether they are archived', async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const edited = await send(app, 'person.upsert', { ...aoife, name: 'Aoife Byrne-Walsh', phone: '+353871234568', email: 'aoife@example.com', notes: 'Has a van' })
    expect(edited.status).toBe('applied')
    const after = await entity<Person>(app, 'person', aoife.id)
    expect(after).toMatchObject({ name: 'Aoife Byrne-Walsh', phone: '+353871234568', email: 'aoife@example.com', notes: 'Has a van', archived: false })
    // The link is the server's, not the device's: an edit never replaces it.
    expect(after.linkToken).toBe(aoife.linkToken)
    expect((await app.inject({ method: 'GET', url: `/f/${aoife.linkToken}` })).body).toContain('Hi Aoife')

    // Nor does an edit from a device that doesn't know they were archived bring them back.
    expect((await send(app, 'person.archive', { id: aoife.id, archived: true })).status).toBe('applied')
    expect((await send(app, 'person.upsert', { ...aoife, notes: 'Moved to Galway' })).status).toBe('applied')
    expect(await entity<Person>(app, 'person', aoife.id)).toMatchObject({ notes: 'Moved to Galway', archived: true, linkToken: aoife.linkToken })
  })

  it('archives someone who holds nothing, which stops their link and feed and keeps them off offers, and brings them back', async () => {
    const { app, db } = await signedIn()
    const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
    await colly.send('person.upsert', { id: 'p1', name: 'Aoife Byrne', kind: 'freelancer', email: null, phone: '+353871234567', skills: ['audio'], dayRateCents: null, notes: '' })
    const aoife = await colly.record<Person>('person', 'p1')
    const feed = feedPath(await feedCodeFor(aoife.linkToken))
    expect((await app.inject({ method: 'GET', url: feed })).statusCode).toBe(200)

    expect((await colly.send('person.archive', { id: 'p1', archived: true })).status).toBe('applied')
    expect(await colly.record<Person>('person', 'p1')).toMatchObject({ archived: true, linkToken: aoife.linkToken })
    const gone = await app.inject({ method: 'GET', url: `/f/${aoife.linkToken}` })
    expect(gone.statusCode).toBe(404)
    expect(gone.body).toContain("This link doesn't work any more")
    expect((await app.inject({ method: 'GET', url: `/f/${aoife.linkToken}/data.json` })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: feed })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/f/${aoife.linkToken}/calendar.ics` })).statusCode).toBe(404)
    const c = newId()
    await colly.send('call.create', { id: c, project: 'Electric Picnic', phase: 'Build', venue: '', role: 'Audio tech', start: '2030-10-02', end: '2030-10-04', callTime: null, needed: 1, dayRateCents: 25000, details: '', replyBy: null })
    const refused = await colly.send('offer.send', { id: newId(), callId: c, personId: 'p1', override: false })
    expect(refused).toMatchObject({ status: 'rejected', reason: { code: 'conflict', message: 'Aoife Byrne has been archived. Bring them back on the Crew tab to offer them work.' } })
    // Archiving twice changes nothing.
    expect((await colly.send('person.archive', { id: 'p1', archived: true })).status).toBe('applied')

    expect((await colly.send('person.archive', { id: 'p1', archived: false })).status).toBe('applied')
    expect(await colly.record<Person>('person', 'p1')).toMatchObject({ archived: false })
    expect((await app.inject({ method: 'GET', url: `/f/${aoife.linkToken}` })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: feed })).statusCode).toBe(200)
    expect((await colly.send('offer.send', { id: newId(), callId: c, personId: 'p1', override: false })).status).toBe('applied')

    const page = await colly.history()
    expect(page.entries.filter((e) => e.command === 'person.archive').map((e) => e.what)).toEqual(['Brought Aoife Byrne back', 'Archived Aoife Byrne', 'Archived Aoife Byrne'])
  })

  it('refuses to archive someone with an open offer or a booking from today on, naming the job', async () => {
    const app = await server()
    const aoife = await person(app, 'Aoife Byrne')
    const c = await call(app, { start: '2030-10-02', end: '2030-10-04' })
    const o = await offer(app, c, aoife.id)
    const archive = () => send(app, 'person.archive', { id: aoife.id, archived: true })

    expect(await archive()).toMatchObject({ status: 'rejected', reason: { code: 'conflict', message: 'Aoife Byrne has an open offer for Electric Picnic (Build); withdraw it first.' } })
    await answer(app, aoife.linkToken, o.id, { answer: 'accept' })
    expect(await archive()).toMatchObject({ status: 'rejected', reason: { message: 'Aoife Byrne has accepted Electric Picnic (Build); release them first.' } })
    await send(app, 'offer.confirm', { id: o.id })
    expect(await archive()).toMatchObject({ status: 'rejected', reason: { message: 'Aoife Byrne is booked on Electric Picnic (Build); release them first.' } })
    expect((await entity<Person>(app, 'person', aoife.id)).archived).toBe(false)

    // Released, nothing holds them. A job long over never did.
    await send(app, 'offer.cancel', { id: o.id })
    const old = await offer(app, await call(app, { project: 'Ploughing 2020', start: '2020-09-15', end: '2020-09-17' }), aoife.id)
    await answer(app, aoife.linkToken, old.id, { answer: 'accept' })
    await send(app, 'offer.confirm', { id: old.id })
    expect((await archive()).status).toBe('applied')
    expect((await entity<Person>(app, 'person', aoife.id)).archived).toBe(true)
  })

  it('lets a freelancer fix their own phone and email on their link, and tells the history which changed, never what', async () => {
    const { app, db } = await signedIn()
    const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
    await colly.send('person.upsert', { id: 'p1', name: 'Aoife Byrne', kind: 'freelancer', email: 'aoife@example.com', phone: '+353871234567', skills: [], dayRateCents: null, notes: '' })
    const aoife = await colly.record<Person>('person', 'p1')
    const details = `/f/${aoife.linkToken}/details`

    // Folded away until wanted, with what we hold filled in.
    let page = (await app.inject({ method: 'GET', url: `/f/${aoife.linkToken}` })).body
    expect(page).toContain('<details id="details">')
    expect(page).toContain('value="+353871234567"')
    expect(page).toContain('value="aoife@example.com"')

    // A new number, the email as it was: only the number is sent, and named.
    const saved = await post(app, details, { phone: '+353 87 999 8888', email: 'aoife@example.com' })
    expect(saved).toMatchObject({ ok: true, message: 'Saved. The office has your new details.' })
    expect(saved.to.searchParams.get('s')).toBe('details')
    expect(saved.to.hash).toBe('#details')
    page = (await app.inject({ method: 'GET', url: saved.to.pathname + saved.to.search })).body
    const open = page.indexOf('<details id="details" open>')
    expect(open).toBeGreaterThan(-1)
    const message = page.indexOf('<p class="flash ok" role="status">Saved. The office has your new details.</p>')
    expect(message).toBeGreaterThan(open)
    expect(message).toBeLessThan(page.indexOf('</details>', open))
    expect(page.match(/class="flash/g)).toHaveLength(1)
    expect(await colly.record<Person>('person', 'p1')).toMatchObject({ phone: '+353 87 999 8888', email: 'aoife@example.com', linkToken: aoife.linkToken })
    let history = await colly.history()
    expect(history.entries[0]).toMatchObject({ who: { kind: 'link', name: 'Aoife Byrne' }, command: 'person.contact', what: 'Aoife Byrne changed their phone number' })
    expect(JSON.stringify(history.entries[0])).not.toContain('999 8888')

    // Both at once; then nothing, which sends nothing.
    expect(await post(app, details, { phone: '', email: 'aoife.byrne@example.com' })).toMatchObject({ ok: true })
    expect(await colly.record<Person>('person', 'p1')).toMatchObject({ phone: null, email: 'aoife.byrne@example.com' })
    expect((await colly.history()).entries[0]?.what).toBe('Aoife Byrne changed their email address and phone number')
    expect(await post(app, details, { phone: '', email: 'aoife.byrne@example.com' })).toMatchObject({ ok: true, message: 'Nothing to change: those are the details we have.' })
    expect((await colly.history()).entries).toHaveLength(3)
    // A post with no fields at all, as a half-formed one would be, clears nothing.
    expect(await post(app, details, {})).toMatchObject({ ok: true, message: 'Nothing to change: those are the details we have.' })
    expect(await colly.record<Person>('person', 'p1')).toMatchObject({ phone: null, email: 'aoife.byrne@example.com' })

    // The same checks as the office's form, with the reason in the section.
    const badPhone = await post(app, details, { phone: 'ring me', email: 'aoife.byrne@example.com' })
    expect(badPhone).toMatchObject({ ok: false, message: 'Phone numbers need digits only, ideally starting with +353.' })
    expect(badPhone.to.searchParams.get('s')).toBe('details')
    expect(await post(app, details, { phone: '', email: 'not an address' })).toMatchObject({ ok: false, message: "That email address doesn't look right." })
    expect(await colly.record<Person>('person', 'p1')).toMatchObject({ phone: null, email: 'aoife.byrne@example.com' })

    // The office can run it from the app too, in its own words. A change with nothing in it is turned down, not quietly applied.
    expect((await colly.send('person.contact', { id: 'p1', phone: '+353871234567' })).status).toBe('applied')
    history = await colly.history()
    expect(history.entries[0]).toMatchObject({ who: { kind: 'staff', name: 'Colly Hewson' }, what: "Changed Aoife Byrne's phone number" })
    expect(await colly.send('person.contact', { id: 'p1' })).toMatchObject({ status: 'rejected', reason: { code: 'invalid', message: 'Nothing to change.' } })
    expect((await colly.history()).entries[0]).toMatchObject({ command: 'person.contact', outcome: 'turned-down', reason: 'Nothing to change.' })
    expect(await colly.record<Person>('person', 'p1')).toMatchObject({ phone: '+353871234567', email: 'aoife.byrne@example.com' })
  })
})
