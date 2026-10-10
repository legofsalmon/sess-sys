import { addDays, dayLabel, irishToday, lateLine, MemoryStorage, SyncClient, type PullResponse, type PushRequest, type PushResponse, type RunningLate } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearOldLate } from '../src/crew/late.ts'
import { DueErasures } from '../src/erasure/due.ts'
import { LATE_CLEARED_ACTION } from '../src/history.ts'
import { ANDROID, flashOf, IPHONE, onLink, server, staff, typedOnly } from './people.ts'

/**
 * Running late (ADR 0028): said from a freelancer's private link on a day
 * they're booked, it reaches the office's queue and the history at once,
 * and the contact on the day's call sheet, but no one else's; said again
 * it changes the one record; "I'm here" closes it; and on a day they're
 * not booked it's refused in words. The office notes it the same way for
 * someone who rang, and every record goes 30 days after its day.
 */

/** A shoot today: Gráinne on camera, Dara on sound, and Aoife running it as the contact on the day. */
async function shoot() {
  const { app, db } = await server()
  const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
  const today = irishToday()
  const person = (id: string, name: string, phone: string, kind: 'staff' | 'freelancer' = 'freelancer') =>
    colly.send('person.upsert', { id, name, kind, email: `${id}@example.com`, phone, skills: [], dayRateCents: 30000, notes: '' })
  const call = (id: string, role: string, callTime: string) =>
    colly.send('call.create', { id, projectId: 'shoot', phaseId: 'day', project: 'Liffey Brands Shoot', phase: 'Shoot', venue: '', role, start: today, end: today, callTime, needed: 1, dayRateCents: 30000, details: '', replyBy: null })
  const book = async (offerId: string, callId: string, personId: string) => {
    for (const r of [
      await colly.send('offer.send', { id: offerId, callId, personId, override: false }),
      await colly.send('offer.respond', { id: offerId, answer: 'accept', days: null, note: '' }),
      await colly.send('offer.confirm', { id: offerId }),
    ])
      expect(r).toMatchObject({ status: 'applied' })
  }
  for (const r of [
    await colly.send('project.create', { id: 'shoot', name: 'Liffey Brands Shoot', clientId: null, venueId: null, status: 'confirmed', notes: '' }),
    await colly.send('phase.add', { id: 'day', projectId: 'shoot', name: 'Shoot', start: today, end: today, venueId: null, notes: '' }),
    await person('grainne', 'Gráinne Power', '+44 7700 900111'),
    await person('dara', 'Dara Quinn', '+44 7700 900112'),
    await person('aoife', 'Aoife Brennan', '+44 7700 900105', 'staff'),
    await call('camera', 'Camera', '08:00'),
    await call('sound', 'Sound No.1', '08:00'),
    await call('chief', 'Crew chief', '07:30'),
  ])
    expect(r).toMatchObject({ status: 'applied' })
  await book('o-grainne', 'camera', 'grainne')
  await book('o-dara', 'sound', 'dara')
  await book('o-aoife', 'chief', 'aoife')
  expect(await colly.send('phase.update', { id: 'day', contactId: 'aoife' })).toMatchObject({ status: 'applied' })
  const token = async (id: string) => (await db.query<{ t: string }>('SELECT link_token AS t FROM people WHERE id = $1', [id])).rows[0]!.t
  // The office's own phone, with its copy of everything, as the Crew tab reads it.
  const storage = new MemoryStorage()
  const office = await new SyncClient({
    storage,
    transport: {
      push: async (req: PushRequest) => (await app.inject({ method: 'POST', url: '/api/sync/push', payload: req, cookies: colly.cookies })).json() as PushResponse,
      pull: async (after: number) => (await app.inject({ url: `/api/sync/pull?after=${after}`, cookies: colly.cookies })).json() as PullResponse,
    },
  }).open()
  return { app, db, colly, today, token, office, storage }
}

/** Post a form from a link page and read back the message the page it lands on shows. */
async function post(app: FastifyInstance, path: string, fields: Record<string, string>) {
  const res = await app.inject({ method: 'POST', url: path, headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': ANDROID }, payload: new URLSearchParams(fields).toString() })
  // A refusal is drawn at once, with what was typed still in the form (rule 11); it lands at the address posted to.
  if (res.statusCode === 422) return { ...flashOf(res.body), to: new URL(path, 'http://x'), page: res.body }
  expect(res.statusCode).toBe(303)
  const to = new URL(res.headers.location as string, 'http://x')
  const page = (await app.inject({ url: to.pathname + to.search })).body
  return { ...flashOf(page), to, page }
}

describe('running late from a link', () => {
  it("reaches the office's queue, the history and the contact's call sheet, and no other crew's", async () => {
    // Proves: one post from Gráinne's phone is in the office's queue and on its call, in the history in words, and on Aoife's sheet as contact, never on Dara's.
    const { app, colly, today, token, office } = await shoot()
    const gráinne = await token('grainne')
    const page = (await app.inject({ url: `/f/${gráinne}` })).body
    expect(page).toContain('<h2>Today</h2>')
    expect(page).toContain('Running late?')
    // Sending needs signal, so the form says who to ring if it won't go.
    expect(page).toContain('If it won\'t go, ring Aoife Brennan on <a href="tel:+447700900105">')

    await onLink(app, `/f/${gráinne}/late`, { offer: 'o-grainne', day: today, by: '30', at: '', note: 'Traffic on the M50' })
    const after = (await app.inject({ url: `/f/${gráinne}` })).body
    expect(after).toContain("You've told us: about 30 minutes late, “Traffic on the M50”.")
    expect(after).toContain("I'm here now")

    await office.sync()
    const view = office.view()
    expect(view.late.toCheck.map((l) => [l.person?.name, l.call?.role, l.day])).toEqual([['Gráinne Power', 'Camera', today]])

    const entry = (await colly.history()).entries[0]!
    expect(entry).toMatchObject({ command: 'late.say', who: { kind: 'link', name: 'Gráinne Power' }, device: 'Chrome on Android' })
    expect(entry.what).toBe(`Gráinne Power said they'll be about 30 minutes late for Liffey Brands Shoot (Shoot), ${dayLabel(today)}: Traffic on the M50`)

    const aoife = (await app.inject({ url: `/f/${await token('aoife')}/sheet/chief` })).body
    expect(aoife).toContain('<h2>Running late</h2>')
    expect(aoife).toContain('<b>Gráinne Power</b>: about 30 minutes late, “Traffic on the M50”')
    const dara = (await app.inject({ url: `/f/${await token('dara')}/sheet/sound` })).body
    expect(dara).toContain('Gráinne Power')
    expect(dara).not.toContain('Running late')
    expect(dara).not.toContain('Traffic on the M50')
  })

  it("changes the one record when said again, and closes with Noted and I'm here", async () => {
    // Proves: said again it's the same record, new to the office again; the office's Noted and the person's "I'm here" each take it from the queue, and the person's download holds it.
    const { app, db, colly, today, token, office } = await shoot()
    const gráinne = await token('grainne')
    await onLink(app, `/f/${gráinne}/late`, { offer: 'o-grainne', day: today, by: '15', note: '' })
    await office.sync()
    const [said] = office.view().late.toCheck
    expect(await colly.send('late.seen', { id: said!.id })).toMatchObject({ status: 'applied' })
    await office.sync()
    expect(office.view().late.toCheck).toEqual([])

    await onLink(app, `/f/${gráinne}/late`, { offer: 'o-grainne', day: today, at: '09:15', note: 'Puncture <i>again</i>' })
    // What they typed is drawn as text, on their page and on the contact's sheet.
    expect((await app.inject({ url: `/f/${gráinne}` })).body).toContain('Puncture &lt;i&gt;again&lt;/i&gt;')
    expect((await app.inject({ url: `/f/${await token('aoife')}/sheet/chief` })).body).toContain('there at about 09:15, “Puncture &lt;i&gt;again&lt;/i&gt;”')
    const { rows } = await db.query<{ id: string; arrive_at: string; seen_at: string | null }>('SELECT id, arrive_at, seen_at FROM running_late')
    expect(rows).toEqual([{ id: said!.id, arrive_at: '09:15', seen_at: null }])
    await office.sync()
    expect(office.view().late.toCheck.map((l) => l.id)).toEqual([said!.id])

    await onLink(app, `/f/${gráinne}/late/here`, { id: said!.id })
    await office.sync()
    expect(office.view().late.toCheck).toEqual([])
    expect(office.view().late.current[0]).toMatchObject({ arrivedAt: expect.any(String) })
    expect((await app.inject({ url: `/f/${gráinne}` })).body).toContain("You've told us you're there. Thanks.")

    const words = (await colly.history()).entries.map((e) => e.what)
    expect(words.slice(0, 3)).toEqual([
      "Gráinne Power said they're there now, at Liffey Brands Shoot (Shoot)",
      `Gráinne Power said they'll be there at about 09:15 for Liffey Brands Shoot (Shoot), ${dayLabel(today)}: Puncture <i>again</i>`,
      'Noted that Gráinne Power is running late for Liffey Brands Shoot (Shoot)',
    ])
    const mine = (await app.inject({ url: `/f/${gráinne}/data.json` })).json() as { runningLate: RunningLate[] }
    expect(mine.runningLate.map((l) => [l.offerId, l.arriveAt, l.note])).toEqual([['o-grainne', '09:15', 'Puncture <i>again</i>']])
  })

  it("is refused on a day they're not booked, for a booking not theirs, and with nothing said", async () => {
    // Proves: the server, not the page, decides: a day they don't hold is refused in words, someone else's booking is not theirs, and an empty form asks for how late.
    const { app, db, colly, today, token } = await shoot()
    const gráinne = await token('grainne')
    const later = addDays(today, 3)
    expect(await post(app, `/f/${gráinne}/late`, { offer: 'o-grainne', day: later, by: '30' })).toMatchObject({ ok: false, message: `You're not booked on ${dayLabel(later)}.` })
    expect(await post(app, `/f/${gráinne}/late`, { offer: 'o-dara', day: today, by: '30' })).toMatchObject({ ok: false, message: "That booking isn't one of yours." })
    expect(await post(app, `/f/${gráinne}/late`, { offer: 'o-grainne', day: today, note: 'Soon' })).toMatchObject({
      ok: false,
      message: "Tap roughly how late you'll be, or put in the time you'll be there.",
    })
    // The page's time field sends a real time, but anything can be posted.
    expect(await post(app, `/f/${gráinne}/late`, { offer: 'o-grainne', day: today, at: '99:99' })).toMatchObject({
      ok: false,
      message: "The time you'll be there is a time of day, such as 09:30.",
    })
    // An offer only, not a booking: nothing to be late for.
    expect(await colly.send('offer.send', { id: 'o-dara-2', callId: 'camera', personId: 'dara', override: true })).toMatchObject({ status: 'rejected' })
    // From the office's app it's the same rule, said about her by name (ADR 0028, amended).
    expect(await colly.send('late.say', { id: 'x', offerId: 'o-grainne', day: later, by: '15', arriveAt: null, note: '' })).toMatchObject({
      status: 'rejected',
      reason: { message: `Gráinne Power isn't booked on ${dayLabel(later)}.` },
    })
    expect((await db.query('SELECT 1 FROM running_late')).rows).toEqual([])
  })

  it('takes a note with a NUL in it, or cut to its length in the middle of an emoji, as words', async () => {
    // Proves: what the link page's form posts reaches the server as typed: a NUL, which the database can't hold, is cleaned
    // out of the note as the app cleans typed text, and a note cut to 200 characters inside an emoji loses the half, which
    // the database's JSON can't hold either; each lands with "Thanks" rather than failing on the server.
    const { app, db, today, token } = await shoot()
    const gráinne = await token('grainne')
    const sent = { ok: true, message: "Thanks. The office, and whoever's running the day, can see it now." }
    expect(await post(app, `/f/${gráinne}/late`, { offer: 'o-grainne', day: today, by: '30', note: 'Traffic\u0000 on the M50' })).toMatchObject(sent)
    expect((await db.query('SELECT note FROM running_late')).rows).toEqual([{ note: 'Traffic on the M50' }])
    const long = `${'Stuck behind a tractor. '.repeat(9).slice(0, 199)}\u{1F69C}`
    expect(await post(app, `/f/${gráinne}/late`, { offer: 'o-grainne', day: today, by: '60', note: long })).toMatchObject(sent)
    expect((await db.query('SELECT note FROM running_late')).rows).toEqual([{ note: long.slice(0, 199).trim() }])
  })

  it("never writes over another booking's record that has the same id", async () => {
    // Proves: a change sent with the id of Gráinne's record, for Dara's booking, is refused and leaves hers as she said it.
    const { app, db, colly, today, token } = await shoot()
    await onLink(app, `/f/${await token('grainne')}/late`, { offer: 'o-grainne', day: today, by: '30', note: 'Traffic on the M50' })
    const { rows } = await db.query<{ id: string }>('SELECT id FROM running_late')
    expect(await colly.send('late.say', { id: rows[0]!.id, offerId: 'o-dara', day: today, by: 'more', arriveAt: null, note: 'Not hers' })).toMatchObject({
      status: 'rejected',
      reason: { message: 'That running late is for another booking or day.' },
    })
    expect((await db.query('SELECT person_id, offer_id, late_by, note FROM running_late')).rows).toEqual([
      { person_id: 'grainne', offer_id: 'o-grainne', late_by: '30', note: 'Traffic on the M50' },
    ])
  })
})

describe('running late noted by the office, for someone who rang', () => {
  it("lands in the same record: in the queue, on the call, on the contact's sheet and their own page, the history saying who noted it", async () => {
    // Proves: Colly notes from the app that Dara rang to say he'll be about 30 minutes late; it's in the office's queue and on the call as one from a link would be, on Aoife's sheet as contact and on Dara's own page, and the history says Colly noted it; marking him there closes it, in words too.
    const { app, colly, today, token, office } = await shoot()
    expect(await colly.send('late.say', { id: 'l-dara', offerId: 'o-dara', day: today, by: '30', arriveAt: null, note: 'Rang from the M50' })).toMatchObject({ status: 'applied' })
    await office.sync()
    expect(office.view().late.toCheck.map((l) => [l.person?.name, l.call?.role, lateLine(l)])).toEqual([['Dara Quinn', 'Sound No.1', 'about 30 minutes late, “Rang from the M50”']])
    expect(office.view().late.forOffer('o-dara').map((l) => l.id)).toEqual(['l-dara'])
    const sheet = async () => (await app.inject({ url: `/f/${await token('aoife')}/sheet/chief` })).body
    expect(await sheet()).toContain('<b>Dara Quinn</b>: about 30 minutes late, “Rang from the M50”')
    expect((await app.inject({ url: `/f/${await token('dara')}` })).body).toContain("You've told us: about 30 minutes late, “Rang from the M50”.")
    const [noted] = (await colly.history()).entries
    expect(noted).toMatchObject({ command: 'late.say', who: { kind: 'staff', name: 'Colly Hewson' } })
    expect(noted!.what).toBe(`Noted that Dara Quinn rang to say they'll be about 30 minutes late for Liffey Brands Shoot (Shoot), ${dayLabel(today)}: Rang from the M50`)

    expect(await colly.send('late.arrived', { id: 'l-dara' })).toMatchObject({ status: 'applied' })
    await office.sync()
    expect(office.view().late.toCheck).toEqual([])
    expect(await sheet()).toContain('<b>Dara Quinn</b>: there now')
    expect((await colly.history()).entries[0]).toMatchObject({ what: 'Marked Dara Quinn as there now, at Liffey Brands Shoot (Shoot)', who: { name: 'Colly Hewson' } })
  })

  it("finds her record when a phone that hadn't heard hers notes it again, and Noted and Mark as there go straight after", async () => {
    // Proves: Gráinne says on her link she's running late; the office's phone, behind, hasn't heard it, so noting it for the same
    // booking and day makes an id of its own, which the server writes into her record. Noted, tapped straight after and sent with
    // it, and Mark as there, tapped once the phone has heard hers but on the line it showed before, carry the booking and the day
    // as the app sends them, so the phone shows hers closed at once and the server finds and closes it, rather than either
    // calling it gone; the phone and the server end on the one record, and the history says whose. Thirty days on, the record
    // goes and the commands keep nothing she wrote.
    const { app, db, colly, today, token, office } = await shoot()
    await office.sync()
    await onLink(app, `/f/${await token('grainne')}/late`, { offer: 'o-grainne', day: today, by: '30', note: 'Traffic on the M50' })
    const [hers] = (await db.query<{ id: string }>('SELECT id FROM running_late')).rows
    await office.mutate('late.say', { id: 'from-the-phone', offerId: 'o-grainne', day: today, by: '15', arriveAt: null, note: 'Rang the office' })
    const said = office.view().late.forOffer('o-grainne')
    expect(said.map((l) => l.id)).toEqual(['from-the-phone'])
    const { id, offerId, day } = said[0]!
    await office.mutate('late.seen', { id, offerId, day })
    await office.sync()
    expect(office.view().late.forOffer('o-grainne')).toMatchObject([{ id: hers!.id, seenAt: expect.any(String), arrivedAt: null }])
    await office.mutate('late.arrived', { id, offerId, day })
    expect(office.view().late.forOffer('o-grainne')).toMatchObject([{ id: hers!.id, arrivedAt: expect.any(String), pending: true }])
    await office.sync()
    expect(office.view().problems).toEqual([])
    expect((await db.query('SELECT id, late_by, note, seen_at IS NOT NULL AS seen, arrived_at IS NOT NULL AS there FROM running_late')).rows).toEqual([
      { id: hers!.id, late_by: '15', note: 'Rang the office', seen: true, there: true },
    ])
    expect(office.view().late.forOffer('o-grainne')).toMatchObject([{ id: hers!.id, arrivedAt: expect.any(String), seenAt: expect.any(String) }])
    expect((await colly.history()).entries.slice(0, 2).map((e) => e.what)).toEqual([
      'Marked Gráinne Power as there now, at Liffey Brands Shoot (Shoot)',
      'Noted that Gráinne Power is running late for Liffey Brands Shoot (Shoot)',
    ])

    expect(await clearOldLate(db, addDays(today, 30))).toBe(1)
    expect((await db.query('SELECT 1 FROM running_late')).rows).toEqual([])
    for (const table of ['changes', 'mutations']) {
      const text = typedOnly((await db.query<{ j: string }>(`SELECT row_to_json(t)::text AS j FROM ${table} t`)).rows.map((r) => r.j).join('\n'))
      for (const t of ['Traffic on the M50', 'Rang the office']) expect(text, `${table} still holds "${t}"`).not.toContain(t)
    }
    expect((await colly.history('?limit=50')).entries.filter((e) => e.command === 'late.arrived').map((e) => e.what)).toEqual([
      'Marked Gráinne Power as there now, at Liffey Brands Shoot (Shoot)',
    ])
  })

  it("is refused on a day they're not booked, and once the booking is let go, in words about them", async () => {
    // Proves: the link's refusals hold when the office notes it, said about the person by name, and nothing is written.
    const { db, colly, today } = await shoot()
    const later = addDays(today, 2)
    expect(await colly.send('late.say', { id: 'l-dara', offerId: 'o-dara', day: later, by: '30', arriveAt: null, note: '' })).toMatchObject({
      status: 'rejected',
      reason: { message: `Dara Quinn isn't booked on ${dayLabel(later)}.` },
    })
    expect(await colly.send('offer.cancel', { id: 'o-dara' })).toMatchObject({ status: 'applied' })
    expect(await colly.send('late.say', { id: 'l-dara', offerId: 'o-dara', day: today, by: '30', arriveAt: null, note: 'Rang' })).toMatchObject({
      status: 'rejected',
      reason: { message: "Dara Quinn isn't booked on this one any more, so there's nothing to be late for." },
    })
    expect((await db.query('SELECT 1 FROM running_late')).rows).toEqual([])
  })
})

describe('running late, 30 days after its day', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('goes on the 30th day after in Ireland, not before: the record, its copies, the note in the history, and from the devices', async () => {
    // Proves: the server's daily look clears a running late the first moment of the 30th day after its day in Ireland
    // (12.30am in summer, still the day before by the server's clock), and not at 11.30pm the night before; the row and
    // every copy in the change feed go, the device drops it, the notes go from the stored commands (one turned down too),
    // and the history still says who, how late and for which job, without the note, in one entry naming nobody. A second
    // run that day changes nothing. One said for the next day stays until its own 30th day.
    vi.useFakeTimers({ toFake: ['Date'] })
    // 9am in Ireland on the day of the shoot.
    vi.setSystemTime(new Date('2027-06-01T08:00:00Z'))
    const { app, db, colly, today, token, office, storage } = await shoot()
    expect(today).toBe('2027-06-01')
    const gráinne = await token('grainne')
    await onLink(app, `/f/${gráinne}/late`, { offer: 'o-grainne', day: today, by: '30', note: 'Traffic on the M50' })
    // Turned down, and kept in the history with what she typed.
    expect(await post(app, `/f/${gráinne}/late`, { offer: 'o-grainne', day: today, at: '99:99', note: 'Puncture on the N7' })).toMatchObject({ ok: false })
    const [said] = (await db.query<{ id: string }>('SELECT id FROM running_late')).rows
    expect(await colly.send('late.seen', { id: said!.id })).toMatchObject({ status: 'applied' })
    // Pick-ups the next day, with Dara on sound; he rings that evening to say he'll be late in the morning.
    const tomorrow = addDays(today, 1)
    for (const r of [
      await colly.send('call.create', {
        id: 'pickups',
        project: 'Liffey Brands Shoot',
        phase: 'Pick-ups',
        venue: '',
        role: 'Sound No.1',
        start: tomorrow,
        end: tomorrow,
        callTime: '09:00',
        needed: 1,
        dayRateCents: 30000,
        details: '',
        replyBy: null,
      }),
      await colly.send('offer.send', { id: 'o-dara-2', callId: 'pickups', personId: 'dara', override: false }),
      await colly.send('offer.respond', { id: 'o-dara-2', answer: 'accept', days: null, note: '' }),
      await colly.send('offer.confirm', { id: 'o-dara-2' }),
    ])
      expect(r).toMatchObject({ status: 'applied' })
    vi.setSystemTime(new Date('2027-06-01T18:30:00Z'))
    expect(await colly.send('late.say', { id: 'l-dara', offerId: 'o-dara-2', day: tomorrow, by: '15', arriveAt: null, note: 'Dropping the kids first' })).toMatchObject({
      status: 'applied',
    })
    await office.sync()
    const held = async () => Object.keys((await storage.load())!.entities.runningLate ?? {}).sort()
    expect(await held()).toEqual(['l-dara', said!.id].sort())

    let told = 0
    const daily = new DueErasures(db, { changed: () => told++ })
    const left = async () => (await db.query<{ id: string }>('SELECT id FROM running_late ORDER BY id')).rows.map((r) => r.id)
    const runs = async () => (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM mutations WHERE name = $1', [LATE_CLEARED_ACTION])).rows[0]!.n

    // 11.30pm on 30 June in Ireland, the 29th day after: still kept.
    vi.setSystemTime(new Date('2027-06-30T22:30:00Z'))
    await daily.run()
    expect([await left(), await runs(), told]).toEqual([['l-dara', said!.id].sort(), 0, 0])

    // 12.30am on 1 July in Ireland, the 30th day after, still 30 June by the server's clock.
    vi.setSystemTime(new Date('2027-06-30T23:30:00Z'))
    await daily.run()
    expect([await left(), await runs(), told]).toEqual([['l-dara'], 1, 1])
    expect((await db.query(`SELECT DISTINCT op FROM changes WHERE entity = 'runningLate' AND entity_id = $1`, [said!.id])).rows).toEqual([{ op: 'delete' }])
    for (const table of ['changes', 'mutations']) {
      const text = typedOnly((await db.query<{ j: string }>(`SELECT row_to_json(t)::text AS j FROM ${table} t`)).rows.map((r) => r.j).join('\n'))
      for (const t of ['Traffic on the M50', 'Puncture on the N7']) expect(text, `${table} still holds "${t}"`).not.toContain(t)
      expect(text, `${table} lost Dara's, still in its 30 days`).toContain('Dropping the kids first')
    }
    await office.sync()
    expect(await held()).toEqual(['l-dara'])
    expect(((await app.inject({ url: `/f/${gráinne}/data.json` })).json() as { runningLate: RunningLate[] }).runningLate).toEqual([])

    const entries = (await colly.history('?limit=50')).entries
    expect(entries[0]).toMatchObject({ command: LATE_CLEARED_ACTION, what: 'Cleared running late more than 30 days after its day, notes and all', who: { kind: 'unknown' } })
    expect(entries.filter((e) => e.command.startsWith('late.') && e.command !== LATE_CLEARED_ACTION).map((e) => e.what)).toEqual([
      `Noted that Dara Quinn rang to say they'll be about 15 minutes late for Liffey Brands Shoot (Pick-ups), ${dayLabel(tomorrow)}: Dropping the kids first`,
      // Noting it carried only the record's id: it's given the booking as the record goes, so it still says whose.
      'Noted that Gráinne Power is running late for Liffey Brands Shoot (Shoot)',
      `Gráinne Power said they'll be there at about 99:99 for Liffey Brands Shoot (Shoot), ${dayLabel(today)}`,
      `Gráinne Power said they'll be about 30 minutes late for Liffey Brands Shoot (Shoot), ${dayLabel(today)}`,
    ])

    // Again that day, by the timer or by hand: nothing more, and no second entry.
    expect(await daily.run()).toBeUndefined()
    expect(await clearOldLate(db)).toBe(0)
    expect([await runs(), told]).toEqual([1, 1])

    // The next night, Dara's own 30th day: his goes too.
    vi.setSystemTime(new Date('2027-07-01T23:30:00Z'))
    await daily.run()
    expect([await left(), await runs(), told]).toEqual([[], 2, 2])
    expect((await colly.history('?limit=5')).entries.map((e) => e.what)).toContain(
      `Noted that Dara Quinn rang to say they'll be about 15 minutes late for Liffey Brands Shoot (Pick-ups), ${dayLabel(tomorrow)}`
    )
  })

  it('takes the note from one turned down for a day years off, or for no real day, a month after it came in', async () => {
    // Proves: none can be said further ahead than the next day, so one turned down for a day in 2999 on the link, or for
    // a day that doesn't exist from a device, counts as for the day after it came in: its note goes on the 30th day
    // after that one, and not a day before, rather than being kept for centuries.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-06-01T08:00:00Z'))
    const { app, db, colly, today, token } = await shoot()
    expect(await post(app, `/f/${await token('grainne')}/late`, { offer: 'o-grainne', day: '2999-12-31', by: '30', note: 'Puncture on the N7' })).toMatchObject({
      ok: false,
      message: `You're not booked on ${dayLabel('2999-12-31')}.`,
    })
    expect(await colly.send('late.say', { id: 'l-dara', offerId: 'o-dara', day: '2027-13-45', by: '15', arriveAt: null, note: 'Dropping the kids first' })).toMatchObject({
      status: 'rejected',
    })
    const notes = async () => (await db.query<{ note: string }>(`SELECT args->>'note' AS note FROM mutations WHERE name = 'late.say' ORDER BY received_at`)).rows.map((r) => r.note)
    expect(await clearOldLate(db, addDays(today, 30))).toBe(0)
    expect(await notes()).toEqual(['Puncture on the N7', 'Dropping the kids first'])
    expect(await clearOldLate(db, addDays(today, 31))).toBe(0)
    expect(await notes()).toEqual(['', ''])
  })

  it('clears once when two runs look at the same moment', async () => {
    // Proves: each run looks again under the lock every change takes, so two at once delete the record once, in one
    // history entry, and tell devices once. Postgres proves it for two copies of the server (postgres.test.ts).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-06-01T08:00:00Z'))
    const { app, db, today, token } = await shoot()
    await onLink(app, `/f/${await token('grainne')}/late`, { offer: 'o-grainne', day: today, by: '60', note: 'Traffic on the M50' })
    expect(await clearOldLate(db, addDays(today, 29))).toBe(0)
    const due = addDays(today, 30)
    expect((await Promise.all([clearOldLate(db, due), clearOldLate(db, due)])).sort()).toEqual([0, 1])
    expect((await db.query('SELECT 1 FROM running_late')).rows).toEqual([])
    const sent = await db.query(`SELECT c.entity, c.op FROM changes c JOIN mutations m ON m.id = c.mutation_id WHERE m.name = $1`, [LATE_CLEARED_ACTION])
    expect(sent.rows).toEqual([{ entity: 'runningLate', op: 'delete' }])
  })
})
