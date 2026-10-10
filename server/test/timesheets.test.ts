import { addDays, dayLabel, irishToday, newId, type CommandInput, type CommandName, type HistoryPage, type Mutation, type MutationResult, type Timesheet } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb } from '../src/db.ts'
import { flashOf } from './people.ts'

/**
 * Timesheets (ADR 0022): a freelancer sends the days they worked on a
 * booking, and their extras, from their private link; the office checks,
 * changes and approves them, and the freelancer sees what was agreed.
 */

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

const today = irishToday()
const day = (n: number) => addDays(today, n)

function m<N extends CommandName>(name: N, args: CommandInput<N>): Mutation {
  return { id: newId(), name, args, createdAt: new Date().toISOString() } as Mutation
}

async function send(app: FastifyInstance, ...mutations: Mutation[]): Promise<MutationResult[]> {
  const res = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'office', mutations } })
  return res.json().results
}

async function ok(app: FastifyInstance, ...mutations: Mutation[]) {
  for (const r of await send(app, ...mutations)) expect(r).toMatchObject({ status: 'applied' })
}

const person = (id: string, name: string, kind: 'staff' | 'freelancer' = 'freelancer') =>
  m('person.upsert', { id, name, kind, email: `${id}@example.com`, phone: null, skills: [], dayRateCents: 30000, notes: '' })

const call = (id: string, role: string, from: number, to: number, rate: number | null = 32000) =>
  m('call.create', {
    id,
    projectId: 'gala',
    phaseId: 'show',
    project: 'Autumn Gala',
    phase: 'Show',
    venue: 'Northbank',
    role,
    start: day(from),
    end: day(to),
    callTime: '08:00',
    needed: 2,
    dayRateCents: rate,
    details: '',
    replyBy: null,
  })

const booked = (offerId: string, callId: string, personId: string) => [
  m('offer.send', { id: offerId, callId, personId, override: false }),
  m('offer.respond', { id: offerId, answer: 'accept', days: null, note: '' }),
  m('offer.confirm', { id: offerId }),
]

/** A gala that was on the last two days, and a job still to come. */
async function gala() {
  const db = await pgliteDb()
  const app = await buildApp({ db })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  await ok(
    app,
    m('project.create', { id: 'gala', name: 'Autumn Gala', clientId: null, venueId: null, status: 'confirmed', notes: '' }),
    m('phase.add', { id: 'show', projectId: 'gala', name: 'Show', start: day(-3), end: day(-1), venueId: null, notes: '' }),
    person('dara', 'Dara Quinn'),
    person('eimear', 'Eimear Nolan'),
    person('fionn', 'Fionn Gallagher'),
    person('aoife', 'Aoife Brennan', 'staff'),
    call('sound', 'Sound No.1', -2, -1),
    call('chief', 'Crew chief', -3, -1, null),
    call('later', 'Monitors', 5, 6),
    ...booked('dara-sound', 'sound', 'dara'),
    ...booked('aoife-chief', 'chief', 'aoife'),
    ...booked('eimear-later', 'later', 'eimear'),
    m('offer.send', { id: 'fionn-sound', callId: 'sound', personId: 'fionn', override: false })
  )
  const token = async (id: string) => (await db.query<{ t: string }>('SELECT link_token AS t FROM people WHERE id = $1', [id])).rows[0]!.t
  const timesheet = async (id: string) => (await db.query<{ status: string }>('SELECT status FROM timesheets WHERE id = $1', [id])).rows[0]?.status
  return { app, db, token, timesheet }
}

const page = async (app: FastifyInstance, url: string) => {
  const res = await app.inject({ url })
  return { status: res.statusCode, html: res.body }
}

/** Post the timesheet form as a phone would, and follow the redirect back. */
async function post(app: FastifyInstance, url: string, fields: [string, string][]) {
  const res = await app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  })
  // A refusal is drawn at once, with what was typed still in the form (rule 11).
  if (res.statusCode === 422) return { ...flashOf(res.body), back: { status: 422, html: res.body } }
  expect(res.statusCode).toBe(303)
  const to = new URL(res.headers.location as string, 'http://x')
  const back = await page(app, `${to.pathname}${to.search}`)
  // The message is read from the page: the address carries only a code (audit finding 21).
  return { ...flashOf(back.html), back }
}

describe('a timesheet from a private link', () => {
  it('is sent with the days worked and the extras, and shows on the freelancer\'s page', async () => {
    const { app, token } = await gala()
    const dara = await token('dara')
    const home = await page(app, `/f/${dara}`)
    expect(home.html).toContain('<h2>Timesheets</h2>')
    expect(home.html).toContain(`/f/${dara}/timesheet/dara-sound`)
    expect(home.html).toContain('Send your days and extras')

    const form = await page(app, `/f/${dara}/timesheet/dara-sound`)
    expect(form.status).toBe(200)
    expect(form.html).toContain('€320 a day, as agreed.')
    expect(form.html).toContain(`value="${day(-2)}" checked`)
    expect(form.html).toContain(`value="${day(-1)}" checked`)

    const sent = await post(app, `/f/${dara}/timesheet/dara-sound`, [
      ['picker', '1'],
      ['days', day(-2)],
      ['days', day(-1)],
      ['what', 'Parking'],
      ['euro', '18'],
      ['what', 'Mileage'],
      ['euro', '25,50'],
      ['what', ''],
      ['euro', ''],
      ['note', 'Receipts in the post.'],
    ])
    expect(sent.ok).toBe(true)
    expect(sent.message).toContain("it's gone to the office")
    expect(sent.back.html).toContain('€683.50 in all')
    expect(sent.back.html).toContain('value="Mileage"')
    expect(sent.back.html).toContain('value="25.50"')
    expect(sent.back.html).toContain('Update what you sent')
    expect((await page(app, `/f/${dara}`)).html).toContain('Sent: €683.50. The office will check it')

    // It reached the office's devices, and the history says who sent it.
    const pulled = (await app.inject({ url: '/api/sync/pull?after=0' })).json()
    const t = pulled.changes.find((c: { entity: string }) => c.entity === 'timesheet').data as Timesheet
    expect(t).toMatchObject({ id: 'dara-sound', status: 'sent', days: [day(-2), day(-1)], dayRateCents: 32000, sentVia: 'link', note: 'Receipts in the post.' })
    expect(t.extras).toEqual([
      { what: 'Parking', cents: 1800 },
      { what: 'Mileage', cents: 2550 },
    ])
    const history: HistoryPage = (await app.inject({ url: '/api/history' })).json()
    expect(history.entries[0]).toMatchObject({
      what: "Sent Dara Quinn's timesheet for Sound No.1 on Autumn Gala: 2 days, and €43.50 of extras",
      who: { kind: 'link', name: 'Dara Quinn' },
    })
  })

  it('is only for a freelancer\'s own confirmed booking, from its first day, for the days they were booked', async () => {
    const { app, token, timesheet } = await gala()
    const [dara, eimear, fionn, aoife] = [await token('dara'), await token('eimear'), await token('fionn'), await token('aoife')]
    // Not started yet: nothing to send.
    expect((await page(app, `/f/${eimear}`)).html).not.toContain('<h2>Timesheets</h2>')
    expect((await page(app, `/f/${eimear}/timesheet/eimear-later`)).html).toContain(`The timesheet opens on`)
    const early = await post(app, `/f/${eimear}/timesheet/eimear-later`, [['days', day(5)]])
    expect(early).toMatchObject({ ok: false })
    expect(early.message).toContain('opens on')
    // Only offered; staff; someone else's.
    expect((await post(app, `/f/${fionn}/timesheet/fionn-sound`, [['days', day(-1)]])).message).toBe('Only a confirmed booking has a timesheet.')
    expect((await post(app, `/f/${aoife}/timesheet/aoife-chief`, [['days', day(-1)]])).message).toContain('Staff are paid through payroll')
    expect((await post(app, `/f/${dara}/timesheet/aoife-chief`, [['days', day(-1)]])).message).toBe("That booking isn't one of yours.")
    expect((await page(app, `/f/${dara}/timesheet/aoife-chief`)).status).toBe(404)
    // Days they weren't booked, none at all, and extras without a name or an amount.
    expect((await post(app, `/f/${dara}/timesheet/dara-sound`, [['days', day(-3)]])).message).toContain("wasn't one of your booked days")
    expect((await post(app, `/f/${dara}/timesheet/dara-sound`, [['picker', '1']])).message).toBe('Tick at least one day you worked.')
    expect((await post(app, `/f/${dara}/timesheet/dara-sound`, [['days', day(-1)], ['what', ''], ['euro', '12']])).message).toBe('Say what each extra is for.')
    // The message is one of the page's own, so it can't name the extra typed (audit finding 21).
    const lots = await post(app, `/f/${dara}/timesheet/dara-sound`, [['days', day(-1)], ['what', 'Tolls'], ['euro', 'lots'], ['note', 'Left at 2am']])
    expect(lots.message).toBe('Put in the amount for each extra, in euro.')
    // Drawn again at once with everything typed still in the form, to fix the one thing (rule 11).
    expect(lots.back.html).toContain('value="Tolls"')
    expect(lots.back.html).toContain('value="lots"')
    expect(lots.back.html).toContain('>Left at 2am</textarea>')
    expect(lots.back.html).toContain(`value="${day(-1)}" checked`)
    expect(lots.back.html).not.toContain(`value="${day(-2)}" checked`)
    expect(await timesheet('dara-sound')).toBeUndefined()
  })
})

describe('the office and timesheets', () => {
  it('approves with changes, which the freelancer sees, and reopens to change it again', async () => {
    const { app, token, timesheet } = await gala()
    const dara = await token('dara')
    await post(app, `/f/${dara}/timesheet/dara-sound`, [
      ['days', day(-2)],
      ['days', day(-1)],
      ['what', 'Parking'],
      ['euro', '18'],
      ['what', 'Dinner'],
      ['euro', '22'],
    ])
    const approve = m('timesheet.approve', {
      id: 'dara-sound',
      days: [day(-1)],
      dayRateCents: 32000,
      extras: [
        { what: 'Parking', cents: 1500 },
        { what: 'Tolls', cents: 310 },
      ],
      officeNote: 'Load in was Eimear only on the first day. Food was on site.',
    })
    await ok(app, approve)
    expect(await timesheet('dara-sound')).toBe('approved')

    const seen = (await page(app, `/f/${dara}/timesheet/dara-sound`)).html
    expect(seen).toContain('Approved: €338.10')
    for (const change of [`Days: ${dayLabel(day(-1))}, not`, 'Parking: €15, not €18', 'Left out: Dinner €22', 'Added: Tolls €3.10'])
      expect(seen).toContain(change)
    expect(seen).toContain('Food was on site.')
    expect(seen).not.toContain('<form')
    expect((await page(app, `/f/${dara}`)).html).toContain('Approved: €338.10')

    // Settled: the freelancer can't change it, the same approval again changes nothing, and a different one is turned down.
    expect((await post(app, `/f/${dara}/timesheet/dara-sound`, [['days', day(-1)]])).message).toContain('already approved')
    await ok(app, { ...approve, id: newId() })
    const [changed] = await send(app, m('timesheet.approve', { id: 'dara-sound', days: [day(-1)], dayRateCents: 30000, extras: [], officeNote: '' }))
    expect(changed).toMatchObject({ status: 'rejected', reason: { message: 'This timesheet has already been approved, with other figures. Reopen it to change it.' } })

    await ok(app, m('timesheet.reopen', { id: 'dara-sound' }))
    expect(await timesheet('dara-sound')).toBe('sent')
    expect((await page(app, `/f/${dara}/timesheet/dara-sound`)).html).toContain('Update what you sent')
    const history: HistoryPage = (await app.inject({ url: '/api/history' })).json()
    expect(history.entries.slice(0, 1).map((e) => e.what)).toEqual(["Reopened Dara Quinn's timesheet for Sound No.1 on Autumn Gala, to change it"])
    expect(history.entries.map((e) => e.what)).toContain("Approved Dara Quinn's timesheet for Sound No.1 on Autumn Gala: 1 day at €320, and €18.10 of extras: €338.10")
  })

  it('puts one in for a freelancer, with any of the job\'s days, and needs one before approving', async () => {
    const { app, timesheet } = await gala()
    const [early] = await send(app, m('timesheet.approve', { id: 'dara-sound', days: [day(-1)], dayRateCents: 32000, extras: [], officeNote: '' }))
    expect(early).toMatchObject({ status: 'rejected', reason: { message: "There's no timesheet for this booking yet: put one in first." } })
    const [outside] = await send(app, m('timesheet.send', { id: 'dara-sound', days: [day(0)], extras: [], note: '' }))
    expect(outside).toMatchObject({ status: 'rejected', reason: { message: expect.stringContaining("isn't part of Autumn Gala.") } })
    // The office can say they worked a day of the job they weren't booked for.
    await ok(
      app,
      m('timesheet.send', { id: 'dara-sound', days: [day(-2), day(-1)], extras: [], note: '' }),
      m('timesheet.approve', { id: 'dara-sound', days: [day(-3), day(-2), day(-1)], dayRateCents: 32000, extras: [], officeNote: 'Came in for the build too.' })
    )
    expect(await timesheet('dara-sound')).toBe('approved')
    const pulled = (await app.inject({ url: '/api/sync/pull?after=0' })).json()
    const t = pulled.changes.filter((c: { entity: string }) => c.entity === 'timesheet').at(-1).data as Timesheet
    expect(t).toMatchObject({ sentVia: 'app', days: [day(-3), day(-2), day(-1)], sent: { days: [day(-2), day(-1)] } })
  })
})
