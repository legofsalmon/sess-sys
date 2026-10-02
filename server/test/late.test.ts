import { addDays, dayLabel, irishToday, MemoryStorage, SyncClient, type PullResponse, type PushRequest, type PushResponse, type RunningLate } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { ANDROID, flashOf, IPHONE, onLink, server, staff } from './people.ts'

/**
 * Running late (ADR 0028): said from a freelancer's private link on a day
 * they're booked, it reaches the office's queue and the history at once,
 * and the contact on the day's call sheet, but no one else's; said again
 * it changes the one record; "I'm here" closes it; and on a day they're
 * not booked it's refused in words.
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
  const office = await new SyncClient({
    storage: new MemoryStorage(),
    transport: {
      push: async (req: PushRequest) => (await app.inject({ method: 'POST', url: '/api/sync/push', payload: req, cookies: colly.cookies })).json() as PushResponse,
      pull: async (after: number) => (await app.inject({ url: `/api/sync/pull?after=${after}`, cookies: colly.cookies })).json() as PullResponse,
    },
  }).open()
  return { app, db, colly, today, token, office }
}

/** Post a form from a link page and read back the message the page it lands on shows. */
async function post(app: FastifyInstance, path: string, fields: Record<string, string>) {
  const res = await app.inject({ method: 'POST', url: path, headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': ANDROID }, payload: new URLSearchParams(fields).toString() })
  expect(res.statusCode).toBe(303)
  const to = new URL(res.headers.location as string, 'http://x')
  return { ...flashOf((await app.inject({ url: to.pathname + to.search })).body), to }
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
    expect(await colly.send('late.say', { id: 'x', offerId: 'o-grainne', day: later, by: '15', arriveAt: null, note: '' })).toMatchObject({
      status: 'rejected',
      reason: { message: `You're not booked on ${dayLabel(later)}.` },
    })
    expect((await db.query('SELECT 1 FROM running_late')).rows).toEqual([])
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
