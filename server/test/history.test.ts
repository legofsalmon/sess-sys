import { newId, waitLabel, type Person } from '@sh/shared'
import { describe, expect, it } from 'vitest'
import { IPHONE, onLink, server, staff, WINDOWS } from './people.ts'

/**
 * The history (ADR 0006), as staff read it on the History tab: who did what,
 * in words, when, on what device, whether it was made offline, and what the
 * server turned down.
 */

const y10p = { id: 'y10p', name: 'd&b Y10P', quantity: 4 }
const booking = (id: string, project: string, qty: number, start: string, end = start) => ({ id, productId: 'y10p', project, qty, start, end })

describe('the history', () => {
  it('says who did what, in words, on what device, and what the server turned down', async () => {
    const { app, db } = await server()
    const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
    const aoife = await staff(app, db, 'Aoife Byrne', WINDOWS, 'office-a1b2c3')
    await colly.send('product.upsert', y10p)
    await colly.send('booking.create', booking('b1', 'Electric Picnic', 4, '2026-10-02', '2026-10-04'))
    expect((await aoife.send('booking.create', booking('b2', 'Longitude', 2, '2026-10-03'))).status).toBe('rejected')
    await aoife.send('booking.cancel', { id: 'b1' })

    const page = await colly.history()
    expect(page.entries.map((e) => [e.who.name, e.what, e.outcome])).toEqual([
      ['Aoife Byrne', 'Cancelled the booking of 4 × d&b Y10P for Electric Picnic, Fri 2 Oct to Sun 4 Oct', 'done'],
      ['Aoife Byrne', 'Booked 2 × d&b Y10P for Longitude, Sat 3 Oct', 'turned-down'],
      ['Colly Hewson', 'Booked 4 × d&b Y10P for Electric Picnic, Fri 2 Oct to Sun 4 Oct', 'done'],
      ['Colly Hewson', 'Set d&b Y10P to 4 in stock', 'done'],
    ])
    expect(page.entries[1]!.reason).toBe('Only 0 × d&b Y10P free on 2026-10-03; 2 more needed. Subhire or change the dates.')
    expect(page.entries[0]).toMatchObject({ who: { kind: 'staff', key: `user:${aoife.id}` }, device: 'Edge on Windows', deviceCode: 'a1b2c3' })
    expect(page.entries[2]).toMatchObject({ device: 'Safari on iPhone', deviceCode: 'c0ffee', records: [{ entity: 'booking', id: 'b1' }] })
    // Turned down, so it changed nothing.
    expect(page.entries[1]!.records).toEqual([])
    expect(page.people).toEqual([
      { key: `user:${aoife.id}`, name: 'Aoife Byrne' },
      { key: `user:${colly.id}`, name: 'Colly Hewson' },
    ])
  })

  it("marks a change made offline, and puts it on the server's clock even when the phone's clock is wrong", async () => {
    const { app, db } = await server()
    const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
    await colly.send('product.upsert', y10p)
    // Booked in a basement three hours ago, on a phone whose clock is two days fast, and sent on the way out.
    await colly.send('booking.create', booking('b1', 'Electric Picnic', 1, '2026-10-02'), { hoursWaiting: 3, clockOffHours: 48 })
    // From a version of the app that doesn't say when it sent things.
    await colly.send('booking.create', booking('b2', 'Longitude', 1, '2026-10-02'), { oldApp: true })

    const [old, offline, online] = (await colly.history()).entries
    expect(online).toMatchObject({ madeOffline: false, waitedSeconds: 0 })
    expect(Date.parse(online!.madeAt)).toBe(Math.floor(Date.parse(online!.arrivedAt)))

    expect(offline).toMatchObject({ what: 'Booked 1 × d&b Y10P for Electric Picnic, Fri 2 Oct', madeOffline: true })
    expect(offline!.waitedSeconds).toBeCloseTo(3 * 3600, -1)
    const threeHoursAgo = Date.now() - 3 * 3_600_000
    expect(Math.abs(Date.parse(offline!.madeAt) - threeHoursAgo)).toBeLessThan(60_000)

    expect(old).toMatchObject({ madeOffline: false })
    expect(old).not.toHaveProperty('waitedSeconds')
    expect(Date.parse(old!.madeAt)).toBe(Math.floor(Date.parse(old!.arrivedAt)))
  })

  it("records a freelancer's own answers, on their private link, as theirs", async () => {
    const { app, db } = await server()
    const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
    await colly.send('person.upsert', { id: 'p1', name: 'Dara Kelly', kind: 'freelancer', email: null, phone: '+353871234567', skills: [], dayRateCents: 25000, notes: '' })
    await colly.send('call.create', {
      id: 'c1',
      project: 'Electric Picnic',
      phase: 'Build',
      venue: 'Stradbally Hall',
      role: 'Audio tech',
      start: '2026-10-02',
      end: '2026-10-04',
      callTime: '08:00',
      needed: 1,
      dayRateCents: 25000,
      details: '',
      replyBy: null,
    })
    await colly.send('offer.send', { id: 'o1', callId: 'c1', personId: 'p1', override: false })
    const dara = await colly.record<Person>('person', 'p1')

    await onLink(app, `/f/${dara.linkToken}/offers/o1`, { answer: 'accept' })
    await onLink(app, `/f/${dara.linkToken}/away`, { start: '2026-10-05', end: '2026-10-06', note: 'Family wedding' })

    const page = await colly.history()
    expect(page.entries.map((e) => [e.who.name, e.who.kind, e.what])).toEqual([
      ['Dara Kelly', 'link', 'Marked Dara Kelly away Mon 5 Oct to Tue 6 Oct (Family wedding)'],
      ['Dara Kelly', 'link', 'Dara Kelly accepted Audio tech on Electric Picnic'],
      ['Colly Hewson', 'staff', 'Offered Audio tech on Electric Picnic to Dara Kelly'],
      ['Colly Hewson', 'staff', 'Asked for 1 × Audio tech for Electric Picnic (Build), Fri 2 Oct to Sun 4 Oct'],
      ['Colly Hewson', 'staff', "Saved Dara Kelly's details"],
    ])
    expect(page.entries[0]).toMatchObject({ who: { key: 'link:p1' }, device: 'Chrome on Android' })
    expect(page.entries[0]).not.toHaveProperty('deviceCode')
    expect(page.people).toContainEqual({ key: 'link:p1', name: 'Dara Kelly' })
    // The history never shows a link's secret.
    expect(JSON.stringify(page)).not.toContain(dara.linkToken)

    // Just hers.
    const hers = await colly.history('?who=link:p1')
    expect(hers.entries.map((e) => e.command)).toEqual(['unavailability.add', 'offer.respond'])
  })

  it('pages back through all of it, and narrows it to one person or one record', async () => {
    const { app, db } = await server()
    const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
    const aoife = await staff(app, db, 'Aoife Byrne', WINDOWS, 'office-a1b2c3')
    await colly.send('product.upsert', y10p)
    for (let i = 1; i <= 3; i++) await aoife.send('booking.create', booking(`b${i}`, `Job ${i}`, 1, '2026-10-02'))
    await colly.send('booking.cancel', { id: 'b2' })
    await colly.send('booking.cancel', { id: 'nope' })
    await aoife.send('product.upsert', { ...y10p, quantity: 6 })

    const seen: string[] = []
    let page = await colly.history('?limit=3')
    expect(page.people).toHaveLength(2)
    for (;;) {
      seen.push(...page.entries.map((e) => e.what))
      if (!page.next) break
      page = await colly.history(`?limit=3&before=${page.next}`)
      expect(page).not.toHaveProperty('people')
    }
    expect(seen).toEqual([
      'Set d&b Y10P to 6 in stock',
      'Cancelled a booking',
      'Cancelled the booking of 1 × d&b Y10P for Job 2, Fri 2 Oct',
      'Booked 1 × d&b Y10P for Job 3, Fri 2 Oct',
      'Booked 1 × d&b Y10P for Job 2, Fri 2 Oct',
      'Booked 1 × d&b Y10P for Job 1, Fri 2 Oct',
      'Set d&b Y10P to 4 in stock',
    ])

    const hers = await colly.history(`?who=user:${aoife.id}`)
    expect(hers.entries.map((e) => e.what)).toEqual([
      'Set d&b Y10P to 6 in stock',
      'Booked 1 × d&b Y10P for Job 3, Fri 2 Oct',
      'Booked 1 × d&b Y10P for Job 2, Fri 2 Oct',
      'Booked 1 × d&b Y10P for Job 1, Fri 2 Oct',
    ])
    const b2 = await colly.history('?entity=booking&id=b2')
    expect(b2.entries.map((e) => [e.who.name, e.command])).toEqual([
      ['Colly Hewson', 'booking.cancel'],
      ['Aoife Byrne', 'booking.create'],
    ])

    const stale = await app.inject({ url: '/api/history?before=not-a-page', cookies: colly.cookies })
    expect(stale.statusCode).toBe(400)
  })

  it('is for signed-in staff only, and no device can pass itself off as a private link', async () => {
    const { app, db } = await server()
    expect((await app.inject('/api/history')).statusCode).toBe(401)
    const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      cookies: colly.cookies,
      payload: { clientId: 'link:p1', mutations: [{ id: newId(), name: 'product.upsert', args: y10p, createdAt: new Date().toISOString() }] },
    })
    expect(res.statusCode).toBe(400)
    expect((await colly.history()).entries).toEqual([])
  })
})

describe('how long a change waited on its device', () => {
  it('reads the way people say it', () => {
    expect([59, 25 * 60, 2 * 3600, 2 * 3600 + 10 * 60 + 59, 86400 + 3000, 3 * 86400 + 4 * 3600].map(waitLabel)).toEqual([
      'under a minute',
      '25 min',
      '2 h',
      '2 h 10 min',
      '1 day',
      '3 days 4 h',
    ])
  })
})
