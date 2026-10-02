import { COMMAND_NAMES, newId, waitLabel, type Person } from '@sh/shared'
import { describe, expect, it } from 'vitest'
import { IMPORT_ACTION } from '../src/calendar/import.ts'
import { CALENDAR_ACTIONS } from '../src/calendar/routes.ts'
import { DATA_ACTIONS } from '../src/data/fresh.ts'
import { describe as inWords, EXPORT_COMMAND, IMPORT_PEOPLE_ACTION, IMPORT_STOCK_ACTION } from '../src/history.ts'
import { IPHONE, onLink, server, staff, WINDOWS } from './people.ts'

/**
 * The history (ADR 0006), as staff read it on the History tab: who did what,
 * in words, when, on what device, whether it was made offline, and what the
 * server turned down.
 */

/** Counted, not numbered: the warehouse's plainest product. */
const Y10P = { id: 'y10p', name: 'd&b Y10P', department: 'audio', category: 'Speakers', tracking: 'bulk', isCase: false, valueCents: null, notes: '' } as const
const place = (id: string, name: string) => ({ id, name, notes: '' })
const move = (qty: number, from: string, to: string) => ({ modelId: 'y10p', fromPlaceId: from, fromCaseId: null, toPlaceId: to, toCaseId: null, qty })

describe('the history', () => {
  it('says who did what, in words, on what device, and what the server turned down', async () => {
    const { app, db } = await server()
    const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
    const aoife = await staff(app, db, 'Aoife Byrne', WINDOWS, 'office-a1b2c3')
    await colly.send('place.upsert', place('a3', 'Bay A3'))
    await colly.send('place.upsert', place('van1', 'Van 1'))
    await colly.send('model.create', Y10P)
    await colly.send('stock.set', { modelId: 'y10p', placeId: 'a3', caseId: null, qty: 4 })
    await aoife.send('stock.move', move(4, 'a3', 'van1'))
    expect((await aoife.send('stock.move', move(2, 'a3', 'van1'))).status).toBe('rejected')

    const page = await colly.history()
    expect(page.entries.map((e) => [e.who.name, e.what, e.outcome])).toEqual([
      ['Aoife Byrne', 'Moved 2 × d&b Y10P from Bay A3 to Van 1', 'turned-down'],
      ['Aoife Byrne', 'Moved 4 × d&b Y10P from Bay A3 to Van 1', 'done'],
      ['Colly Hewson', 'Counted 4 × d&b Y10P at Bay A3', 'done'],
      ['Colly Hewson', 'Added the product d&b Y10P (Audio, counted)', 'done'],
      ['Colly Hewson', 'Saved the place Van 1', 'done'],
      ['Colly Hewson', 'Saved the place Bay A3', 'done'],
    ])
    expect(page.entries[0]!.reason).toBe('Only 0 × d&b Y10P counted at Bay A3, not 2. Count them again first.')
    expect(page.entries[1]).toMatchObject({ who: { kind: 'staff', key: `user:${aoife.id}` }, device: 'Edge on Windows', deviceCode: 'a1b2c3' })
    expect(page.entries[2]).toMatchObject({ device: 'Safari on iPhone', deviceCode: 'c0ffee', records: [{ entity: 'stock', id: 'y10p@p:a3' }] })
    // Turned down, so it changed nothing.
    expect(page.entries[0]!.records).toEqual([])
    expect(page.people).toEqual([
      { key: `user:${aoife.id}`, name: 'Aoife Byrne' },
      { key: `user:${colly.id}`, name: 'Colly Hewson' },
    ])
  })

  it("marks a change made offline, and puts it on the server's clock even when the phone's clock is wrong", async () => {
    const { app, db } = await server()
    const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
    await colly.send('place.upsert', place('a3', 'Bay A3'))
    // Added in a basement three hours ago, on a phone whose clock is two days fast, and sent on the way out.
    await colly.send('place.upsert', place('van1', 'Van 1'), { hoursWaiting: 3, clockOffHours: 48 })
    // From a version of the app that doesn't say when it sent things.
    await colly.send('place.upsert', place('van2', 'Van 2'), { oldApp: true })

    const [old, offline, online] = (await colly.history()).entries
    expect(online).toMatchObject({ madeOffline: false, waitedSeconds: 0 })
    expect(Date.parse(online!.madeAt)).toBe(Math.floor(Date.parse(online!.arrivedAt)))

    expect(offline).toMatchObject({ what: 'Saved the place Van 1', madeOffline: true })
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
    await colly.send('model.create', Y10P)
    for (let i = 1; i <= 3; i++) await aoife.send('place.upsert', place(`p${i}`, `Bay ${i}`))
    await colly.send('place.remove', { id: 'p2' })
    expect((await colly.send('place.upsert', place('p9', 'Bay 1'))).status).toBe('rejected')
    await aoife.send('stock.set', { modelId: 'y10p', placeId: 'p1', caseId: null, qty: 6 })

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
      'Counted 6 × d&b Y10P at Bay 1',
      'Saved the place Bay 1',
      'Removed the place Bay 2',
      'Saved the place Bay 3',
      'Saved the place Bay 2',
      'Saved the place Bay 1',
      'Added the product d&b Y10P (Audio, counted)',
    ])

    const hers = await colly.history(`?who=user:${aoife.id}`)
    expect(hers.entries.map((e) => e.what)).toEqual([
      'Counted 6 × d&b Y10P at Bay 1',
      'Saved the place Bay 3',
      'Saved the place Bay 2',
      'Saved the place Bay 1',
    ])
    const p2 = await colly.history('?entity=place&id=p2')
    expect(p2.entries.map((e) => [e.who.name, e.command])).toEqual([
      ['Colly Hewson', 'place.remove'],
      ['Aoife Byrne', 'place.upsert'],
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
      payload: { clientId: 'link:p1', mutations: [{ id: newId(), name: 'place.upsert', args: place('a3', 'Bay A3'), createdAt: new Date().toISOString() }] },
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

describe('every command', () => {
  it('has its words in the history, so one added without any fails here before it ships', () => {
    // Proves: no command, nor anything the server records itself, falls to the default, which shows a person the command's own name.
    const nothing = () => undefined
    const recorded = [EXPORT_COMMAND, IMPORT_PEOPLE_ACTION, IMPORT_STOCK_ACTION, IMPORT_ACTION, ...Object.values(CALENDAR_ACTIONS), ...Object.values(DATA_ACTIONS)]
    for (const name of [...COMMAND_NAMES, ...recorded]) {
      const what = inWords(name, {}, nothing)
      expect(what, name).not.toBe(name)
      expect(what, name).toMatch(/\S+\s+\S+/)
    }
    expect(COMMAND_NAMES.length).toBeGreaterThanOrEqual(43)
  })
})
