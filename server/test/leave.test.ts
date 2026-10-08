import {
  addDays,
  dayLabel,
  irishToday,
  MemoryStorage,
  newId,
  plan,
  SyncClient,
  workingDays,
  type CommandInput,
  type CommandName,
  type LeaveAllowance,
  type LeaveRequest,
  type LeaveYear,
  type LieuEntry,
  type MutationResult,
  type Person,
  type Transport,
  type Unavailability,
} from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb, type Db } from '../src/db.ts'
import { LEAVE, LEAVE_YEARS_OPEN } from '../src/leave/schema.ts'
import { runMigrations } from '../src/migrations.ts'
import { migrateAll, MODULES } from '../src/modules.ts'
import { flashOf, IPHONE, server, staff, WINDOWS } from './people.ts'

/**
 * Staff leave and time in lieu (ADR 0024): the rules the server keeps, one
 * by one, with staff signed in on their own devices; what approved leave
 * does to the planner, offers and the person's calendar feed; the device
 * saying who it is while sign-in is off; and the years the office opens.
 */

const today = irishToday()
const day = (n: number) => addDays(today, n)

/**
 * Years opened for leave in a test's setup, straight into the table as the migration opens a year with leave in it:
 * the tests use 2031 for its fixed weekdays, which no approver can open today, as only this year and next open.
 */
const openYears = (db: Db, ...years: number[]) => db.query(`INSERT INTO leave_years (year) SELECT unnest($1::int[]) ON CONFLICT DO NOTHING`, [years])

/** Colly approves time off; Aoife and Cian are staff; Dara is a freelancer. Each staff account's email is on their person. */
async function company() {
  const { app, db } = await server()
  const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
  const aoife = await staff(app, db, 'Aoife Byrne', WINDOWS, 'office-a1b2c3')
  const cian = await staff(app, db, 'Cian Murphy', IPHONE, 'phone-c1an00')
  const person = (id: string, name: string, email: string | null, kind: 'staff' | 'freelancer' = 'staff', approvesLeave = false): CommandInput<'person.upsert'> => ({
    id,
    name,
    kind,
    email,
    phone: null,
    skills: [],
    dayRateCents: kind === 'staff' ? null : 25000,
    notes: '',
    approvesLeave,
  })
  for (const p of [person('colly', 'Colly Hewson', 'Colly@SessionHire.com', 'staff', true), person('aoife', 'Aoife Byrne', aoife.email), person('cian', 'Cian Murphy', cian.email), person('dara', 'Dara Quinn', null, 'freelancer')])
    expect(await colly.send('person.upsert', p)).toMatchObject({ status: 'applied' })
  await openYears(db, 2031)
  return { app, db, colly, aoife, cian }
}

const refused = (r: MutationResult) => (r.status === 'rejected' ? r.reason.message : `applied (${r.seq})`)

/** A request for the first week of March 2031, a Monday to a Friday with no public holiday. */
const week = (id: string, personId: string, over: Partial<CommandInput<'leave.request'>> = {}): CommandInput<'leave.request'> => ({
  id,
  personId,
  type: 'annual',
  start: '2031-03-03',
  end: '2031-03-07',
  note: 'Skiing',
  ...over,
})

/** What a synced office laptop holds, signed in as this person. */
async function synced(app: FastifyInstance, cookies: Record<string, string>) {
  const transport: Transport = {
    async push(req) {
      return (await app.inject({ method: 'POST', url: '/api/sync/push', payload: req, cookies })).json()
    },
    async pull(after) {
      return (await app.inject({ method: 'GET', url: `/api/sync/pull?after=${after}`, cookies })).json()
    },
  }
  const client = await new SyncClient({ storage: new MemoryStorage(), transport }).open()
  await client.sync()
  return client.view()
}

describe('asking for leave', () => {
  it('is for staff, and for yourself, counted in working days and written into the history', async () => {
    const { app, aoife, colly } = await company()
    expect(refused(await aoife.send('leave.request', week('r-dara', 'dara')))).toBe('Only staff have leave; freelancers mark days off on their link.')
    expect(refused(await aoife.send('leave.request', week('r-cian', 'cian')))).toBe("You're signed in as Aoife Byrne, so you can only ask for your own leave.")
    expect(refused(await aoife.send('leave.request', week('r-xmas', 'aoife', { start: '2031-12-29', end: '2032-01-02' })))).toBe(
      "A request can't cross the year end: ask for December and January separately."
    )
    expect(refused(await aoife.send('leave.request', week('r-weekend', 'aoife', { start: '2031-03-01', end: '2031-03-02' })))).toBe(
      "There are no working days in that span: it's all weekend or public holidays."
    )
    expect(await aoife.send('leave.request', week('r1', 'aoife'))).toMatchObject({ status: 'applied' })
    expect(await aoife.record<LeaveRequest>('leaveRequest', 'r1')).toMatchObject({ personId: 'aoife', type: 'annual', days: 5, status: 'waiting', note: 'Skiing', decidedBy: null })
    // Across the October bank holiday, the count drops.
    expect(await aoife.send('leave.request', week('r-oct', 'aoife', { start: '2031-10-24', end: '2031-10-28' }))).toMatchObject({ status: 'applied' })
    expect((await aoife.record<LeaveRequest>('leaveRequest', 'r-oct')).days).toBe(2)
    expect(refused(await aoife.send('leave.request', week('r-again', 'aoife', { start: '2031-03-07', end: '2031-03-10' })))).toBe(
      'That overlaps the annual leave asked for Mon 3 Mar to Fri 7 Mar.'
    )
    const history = await colly.history()
    expect(history.entries.map((e) => [e.who.name, e.what, e.outcome])).toContainEqual(['Aoife Byrne', 'Aoife Byrne asked for annual leave, Mon 3 Mar to Fri 7 Mar (5 days)', 'done'])
  })

  it('cannot ask for more than is left this year, nor be approved past it', async () => {
    const { aoife, colly, db } = await company()
    // Her 2031 allowance, which an approver could set only in 2030 or 2031, put straight in: this is about what's left.
    await db.query(`INSERT INTO leave_allowances (id, person_id, year, days, carried_over, note) VALUES ('aoife-2031', 'aoife', 2031, 6, 0, '')`)
    expect(await aoife.send('leave.request', week('r1', 'aoife'))).toMatchObject({ status: 'applied' })
    // Waiting requests don't hold days, so a second week can be asked for; approving the first leaves one day.
    expect(await aoife.send('leave.request', week('r2', 'aoife', { start: '2031-03-10', end: '2031-03-14' }))).toMatchObject({ status: 'applied' })
    expect(await colly.send('leave.decide', { id: 'r1', approved: true, reason: '' })).toMatchObject({ status: 'applied' })
    expect(refused(await colly.send('leave.decide', { id: 'r2', approved: true, reason: '' }))).toBe('Only 1 day of annual leave left this year.')
    expect(refused(await aoife.send('leave.request', week('r3', 'aoife', { start: '2031-04-01', end: '2031-04-02' })))).toBe('Only 1 day of annual leave left this year.')
    expect(await aoife.send('leave.request', week('r4', 'aoife', { start: '2031-04-01', end: '2031-04-01' }))).toMatchObject({ status: 'applied' })
    expect(refused(await aoife.send('leave.request', week('r5', 'aoife', { type: 'lieu', start: '2031-04-03', end: '2031-04-03' })))).toBe('No days in lieu to take.')
  })
})

describe('deciding', () => {
  it('takes the flag, never your own request, and the signed-in person cannot act as someone else', async () => {
    const { aoife, cian, colly } = await company()
    expect(await aoife.send('leave.request', week('r1', 'aoife'))).toMatchObject({ status: 'applied' })
    expect(await colly.send('leave.request', week('r-colly', 'colly', { start: '2031-05-06', end: '2031-05-07' }))).toMatchObject({ status: 'applied' })
    expect(refused(await cian.send('leave.decide', { id: 'r1', approved: true, reason: '' }))).toMatch(/^Only someone who can approve time off can do this/)
    expect(refused(await colly.send('leave.decide', { id: 'r-colly', approved: true, reason: '' }))).toBe("You can't decide your own request; another approver has to.")
    expect(refused(await colly.send('leave.decide', { id: 'r1', approved: true, reason: '', by: 'aoife' }))).toBe("You're signed in as Colly Hewson, so you can't act as someone else.")
    expect(refused(await cian.send('leave.allowance', { personId: 'aoife', year: 2031, days: 25, carriedOver: 0, note: '' }))).toMatch(/^Only someone who can approve time off/)
    // Declined, with the reason kept for the person; deciding again is turned down.
    expect(await colly.send('leave.decide', { id: 'r1', approved: false, reason: 'Too many away that week' })).toMatchObject({ status: 'applied' })
    expect(await colly.record<LeaveRequest>('leaveRequest', 'r1')).toMatchObject({ status: 'declined', decidedBy: 'colly', reason: 'Too many away that week' })
    expect(refused(await colly.send('leave.decide', { id: 'r1', approved: true, reason: '' }))).toBe('This request was already declined.')
    const history = await colly.history()
    expect(history.entries.map((e) => [e.who.name, e.what])).toContainEqual(['Colly Hewson', "Declined Aoife Byrne's annual leave, Mon 3 Mar to Fri 7 Mar: Too many away that week"])
  })

  it('approves nothing for someone archived since they asked, so no days off are written for them', async () => {
    const { cian, colly } = await company()
    expect(await cian.send('leave.request', week('r-cian', 'cian', { start: '2031-06-09', end: '2031-06-10' }))).toMatchObject({ status: 'applied' })
    expect(await cian.send('lieu.log', { id: 'e-cian', personId: 'cian', day: day(-2), days: 1, note: '' })).toMatchObject({ status: 'applied' })
    expect(await colly.send('person.archive', { id: 'cian', archived: true })).toMatchObject({ status: 'applied' })
    expect(refused(await colly.send('leave.decide', { id: 'r-cian', approved: true, reason: '' }))).toBe("Cian Murphy has been archived, so their leave can't be approved.")
    expect(refused(await colly.send('lieu.decide', { id: 'e-cian', approved: true, reason: '' }))).toBe("Cian Murphy has been archived, so their day in lieu can't be approved.")
    // Declining still clears the queue.
    expect(await colly.send('leave.decide', { id: 'r-cian', approved: false, reason: 'Left the company' })).toMatchObject({ status: 'applied' })
    expect(await colly.record<LeaveRequest>('leaveRequest', 'r-cian')).toMatchObject({ status: 'declined' })
  })

  it('tells an approver who has since been archived so, plainly, for each thing only an approver does', async () => {
    // Proves: Colly, ticked to approve time off and then archived, signed in on his phone, is told he's been archived, not sent to
    // tick a box, on deciding leave, deciding a day in lieu, setting an allowance and opening a year: everything that needs an approver.
    const { aoife, colly } = await company()
    const year = Number(today.slice(0, 4))
    expect(await aoife.send('leave.request', week('r1', 'aoife'))).toMatchObject({ status: 'applied' })
    expect(await aoife.send('lieu.log', { id: 'e1', personId: 'aoife', day: day(-2), days: 1, note: '' })).toMatchObject({ status: 'applied' })
    expect(await colly.send('person.archive', { id: 'colly', archived: true })).toMatchObject({ status: 'applied' })
    const archived = "You've been archived on the Crew tab, so you can't approve time off."
    expect(refused(await colly.send('leave.decide', { id: 'r1', approved: true, reason: '' }))).toBe(archived)
    expect(refused(await colly.send('lieu.decide', { id: 'e1', approved: true, reason: '' }))).toBe(archived)
    expect(refused(await colly.send('leave.allowance', { personId: 'aoife', year, days: 22, carriedOver: 0, note: '' }))).toBe(archived)
    expect(refused(await colly.send('leave.open', { year: year + 1 }))).toBe(archived)
  })

  it('approves into days off, which the planner, offers and the calendar feed see, until the request is cancelled', async () => {
    const { app, aoife, cian, colly } = await company()
    expect(await aoife.send('leave.request', week('r1', 'aoife'))).toMatchObject({ status: 'applied' })
    expect(await colly.send('leave.decide', { id: 'r1', approved: true, reason: '', by: 'colly' })).toMatchObject({ status: 'applied' })
    expect(await colly.record<LeaveRequest>('leaveRequest', 'r1')).toMatchObject({ status: 'approved', decidedBy: 'colly' })
    expect(await colly.record<Unavailability>('unavailability', 'r1')).toMatchObject({ personId: 'aoife', start: '2031-03-03', end: '2031-03-07', note: 'Annual leave', source: 'leave' })

    // An offer for those days needs an override, as any days off do.
    await colly.send('call.create', {
      id: 'c1',
      project: 'Harbour Lights',
      phase: 'Show',
      venue: '',
      role: 'Crew chief',
      start: '2031-03-04',
      end: '2031-03-05',
      callTime: null,
      needed: 1,
      dayRateCents: null,
      details: '',
      replyBy: null,
    })
    expect(refused(await colly.send('offer.send', { id: 'o1', callId: 'c1', personId: 'aoife', override: false }))).toBe(
      'Aoife Byrne is marked unavailable Tue 4 Mar to Wed 5 Mar (Annual leave). Send anyway to override.'
    )
    // The planner shows the days as off, and the office can't take them off by hand.
    const view = await synced(app, colly.cookies)
    const p = plan(view, ['2031-03-03', '2031-03-04', '2031-03-05'])
    expect(p.people.find((l) => l.person.id === 'aoife')?.days['2031-03-04']).toMatchObject({ away: 'Annual leave' })
    expect(refused(await colly.send('unavailability.remove', { id: 'r1' }))).toBe('These days off are approved leave: cancel the leave on the Leave screen instead.')
    // Her own calendar gets the leave as an all-day event.
    const token = (await colly.record<Person>('person', 'aoife')).linkToken
    const ics = await app.inject({ url: `/f/${token}/calendar.ics` })
    expect(ics.body).toContain('SUMMARY:Annual leave')
    expect(ics.body).toContain('DTSTART;VALUE=DATE:20310303')
    expect(ics.body).toContain('DTEND;VALUE=DATE:20310308')
    // Nor from her own link: the page says it's approved leave with no Remove, and the form, if posted anyway, answers with the refusal and leaves the days off.
    const page = (await app.inject({ url: `/f/${token}` })).body
    expect(page).toContain('Approved leave')
    expect(page).not.toContain('/away/r1/remove')
    const posted = await app.inject({ method: 'POST', url: `/f/${token}/away/r1/remove`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: '' })
    expect(posted.statusCode).toBe(303)
    const to = new URL(posted.headers.location as string, 'http://x')
    expect(flashOf((await app.inject({ url: to.pathname + to.search })).body)).toEqual({
      ok: false,
      message: 'These days off are approved leave: cancel the leave on the Leave screen instead.',
    })
    expect(await colly.record<Unavailability>('unavailability', 'r1')).toMatchObject({ source: 'leave' })

    // Only Aoife cancels it, and the days off go with it. Signed in, she can't say she's someone else either.
    expect(refused(await cian.send('leave.cancel', { id: 'r1' }))).toBe('Only Aoife Byrne can cancel their own request.')
    expect(refused(await aoife.send('leave.cancel', { id: 'r1', by: 'colly' }))).toBe("You're signed in as Aoife Byrne, so you can't act as someone else.")
    expect(await aoife.send('leave.cancel', { id: 'r1' })).toMatchObject({ status: 'applied' })
    expect(await aoife.record<LeaveRequest>('leaveRequest', 'r1')).toMatchObject({ status: 'cancelled' })
    const changes = (await app.inject({ url: '/api/sync/pull?after=0', cookies: colly.cookies })).json().changes as { entity: string; id: string; op: string }[]
    expect(changes.filter((c) => c.entity === 'unavailability' && c.id === 'r1').at(-1)).toMatchObject({ op: 'delete' })
    expect(await colly.send('offer.send', { id: 'o1', callId: 'c1', personId: 'aoife', override: false })).toMatchObject({ status: 'applied' })
    expect((await app.inject({ url: `/f/${token}/calendar.ics` })).body).not.toContain('SUMMARY:Annual leave')
    const history = await colly.history()
    expect(history.entries.map((e) => e.what)).toEqual(
      expect.arrayContaining(["Colly Hewson approved Aoife Byrne's annual leave, Mon 3 Mar to Fri 7 Mar", 'Aoife Byrne cancelled their annual leave, Mon 3 Mar to Fri 7 Mar'])
    )
  })
})

describe('days in lieu', () => {
  it('are logged for a day worked, approved, taken as leave, and then cannot be un-earned', async () => {
    const { aoife, colly, db } = await company()
    const worked = day(-9)
    await openYears(db, Number(worked.slice(0, 4)))
    expect(refused(await aoife.send('lieu.log', { id: 'e-soon', personId: 'aoife', day: day(1), days: 1, note: '' }))).toMatch(/hasn't come yet/)
    expect(await aoife.send('lieu.log', { id: 'e1', personId: 'aoife', day: worked, days: 1, note: 'Drove the kit back' })).toMatchObject({ status: 'applied' })
    expect(refused(await aoife.send('lieu.log', { id: 'e-twice', personId: 'aoife', day: worked, days: 1, note: '' }))).toMatch(/is already logged\.$/)
    expect(await aoife.record<LieuEntry>('lieuEntry', 'e1')).toMatchObject({ day: worked, days: 1, status: 'waiting', note: 'Drove the kit back' })
    expect(refused(await aoife.send('lieu.decide', { id: 'e1', approved: true, reason: '' }))).toMatch(/^Only someone who can approve time off/)
    expect(await colly.send('lieu.decide', { id: 'e1', approved: true, reason: '' })).toMatchObject({ status: 'applied' })
    expect(await colly.record<LieuEntry>('lieuEntry', 'e1')).toMatchObject({ status: 'approved', decidedBy: 'colly' })

    // One day earned: one can be taken, in the same leave year, and no more.
    const year = worked.slice(0, 4)
    const take = workingDays(addDays(worked, 1), `${year}-12-31`)[0] ?? workingDays(`${year}-01-01`, worked)[0]!
    expect(await aoife.send('leave.request', { id: 'l1', personId: 'aoife', type: 'lieu', start: take, end: take, note: '' })).toMatchObject({ status: 'applied' })
    expect(await colly.send('leave.decide', { id: 'l1', approved: true, reason: '' })).toMatchObject({ status: 'applied' })
    expect(await colly.record<Unavailability>('unavailability', 'l1')).toMatchObject({ note: 'Day in lieu', source: 'leave' })
    expect(refused(await aoife.send('lieu.cancel', { id: 'e1' }))).toBe("That day has already been taken as leave, so this can't be cancelled.")
    const history = await colly.history()
    expect(history.entries.map((e) => e.what)).toEqual(
      expect.arrayContaining([`Aoife Byrne logged a day in lieu for ${dayLabel(worked)}`, `Approved Aoife Byrne's day in lieu for ${dayLabel(worked)}`])
    )
  })
})

describe('allowances', () => {
  it('are set by an approver, for staff only, and read as 20 days until then', async () => {
    // Next year's, as an allowance can now be set only for this year or next.
    const { app, aoife, colly } = await company()
    const next = Number(today.slice(0, 4)) + 1
    const before = await synced(app, aoife.cookies)
    expect(before.leave.balance('aoife', next)).toMatchObject({ allowance: 20, carriedOver: 0, allowanceSet: false })
    expect(refused(await colly.send('leave.allowance', { personId: 'dara', year: next, days: 20, carriedOver: 0, note: '' }))).toBe('Only staff have an allowance; Dara Quinn is a freelancer.')
    const note = `Two days left from ${next - 1}`
    expect(await colly.send('leave.allowance', { personId: 'aoife', year: next, days: 22, carriedOver: 2, note, by: 'colly' })).toMatchObject({ status: 'applied' })
    expect(await colly.record<LeaveAllowance>('leaveAllowance', `aoife-${next}`)).toEqual({ id: `aoife-${next}`, personId: 'aoife', year: next, days: 22, carriedOver: 2, note })
    const after = await synced(app, aoife.cookies)
    expect(after.leave.balance('aoife', next)).toMatchObject({ allowance: 22, carriedOver: 2, allowanceSet: true, annual: { left: 24 } })
    const history = await colly.history()
    expect(history.entries[0]).toMatchObject({ who: { name: 'Colly Hewson' }, what: `Colly Hewson set Aoife Byrne's ${next} allowance to 22 days, 2 carried over` })
  })
})

describe('while sign-in is off', () => {
  it('takes the device at its word about who is deciding, and still needs the flag', async () => {
    const db = await pgliteDb()
    const app = await buildApp({ db })
    const send = async <N extends CommandName>(name: N, args: CommandInput<N>): Promise<MutationResult> => {
      const res = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'office', mutations: [{ id: newId(), name, args, createdAt: new Date().toISOString() }] } })
      return res.json().results[0]
    }
    const person = (id: string, name: string, approvesLeave = false): CommandInput<'person.upsert'> => ({ id, name, kind: 'staff', email: null, phone: null, skills: [], dayRateCents: null, notes: '', approvesLeave })
    for (const p of [person('colly', 'Colly Hewson', true), person('aoife', 'Aoife Byrne'), person('cian', 'Cian Murphy')]) expect(await send('person.upsert', p)).toMatchObject({ status: 'applied' })
    await openYears(db, 2031)
    // Nobody is signed in, so a request for anyone goes through, as the rest of the app trusts a device today.
    expect(await send('leave.request', week('r1', 'aoife'))).toMatchObject({ status: 'applied' })
    expect(refused(await send('leave.decide', { id: 'r1', approved: true, reason: '' }))).toBe('Say who you are first: pick your name on the Leave screen.')
    expect(refused(await send('leave.decide', { id: 'r1', approved: true, reason: '', by: 'cian' }))).toBe(`Cian Murphy can't approve time off. Tick "Can approve time off" on their person on the Crew tab.`)
    expect(refused(await send('leave.decide', { id: 'r1', approved: true, reason: '', by: 'aoife' }))).toBe(`Aoife Byrne can't approve time off. Tick "Can approve time off" on their person on the Crew tab.`)
    expect(await send('leave.decide', { id: 'r1', approved: true, reason: '', by: 'colly' })).toMatchObject({ status: 'applied' })
    // A freelancer, or an edit from an older app, can't be made an approver by accident.
    expect(await send('person.upsert', { ...person('dara', 'Dara Quinn', true), kind: 'freelancer' })).toMatchObject({ status: 'applied' })
    const { approvesLeave, ...older } = person('colly', 'Colly Hewson')
    void approvesLeave
    expect(await send('person.upsert', older)).toMatchObject({ status: 'applied' })
    const pulled = (await app.inject({ url: '/api/sync/pull?after=0' })).json().changes as { entity: string; id: string; data: Person }[]
    const latest = (id: string) => pulled.filter((c) => c.entity === 'person' && c.id === id).at(-1)!.data
    expect(latest('dara').approvesLeave).toBe(false)
    expect(latest('colly').approvesLeave).toBe(true)
    await app.close()
    await db.close()
  })

  it('tells the device plainly when the approver it says is deciding has since been archived, for each thing only an approver does', async () => {
    // Proves: Colly, picked on the Leave screen and ticked to approve time off, then archived from another device, is said to have
    // been archived, not to need the box ticked, on deciding leave, deciding a day in lieu, setting an allowance and opening a year.
    const db = await pgliteDb()
    const app = await buildApp({ db })
    const send = async <N extends CommandName>(name: N, args: CommandInput<N>): Promise<MutationResult> => {
      const res = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'office', mutations: [{ id: newId(), name, args, createdAt: new Date().toISOString() }] } })
      return res.json().results[0]
    }
    const year = Number(today.slice(0, 4))
    for (const p of [
      { id: 'colly', name: 'Colly Hewson', approvesLeave: true },
      { id: 'aoife', name: 'Aoife Byrne', approvesLeave: false },
    ])
      expect(await send('person.upsert', { ...p, kind: 'staff', email: null, phone: null, skills: [], dayRateCents: null, notes: '' })).toMatchObject({ status: 'applied' })
    await openYears(db, 2031)
    expect(await send('leave.request', week('r1', 'aoife'))).toMatchObject({ status: 'applied' })
    expect(await send('lieu.log', { id: 'e1', personId: 'aoife', day: day(-2), days: 1, note: '' })).toMatchObject({ status: 'applied' })
    expect(await send('person.archive', { id: 'colly', archived: true })).toMatchObject({ status: 'applied' })
    const archived = "Colly Hewson has been archived, so they can't approve time off."
    expect(refused(await send('leave.decide', { id: 'r1', approved: true, reason: '', by: 'colly' }))).toBe(archived)
    expect(refused(await send('lieu.decide', { id: 'e1', approved: true, reason: '', by: 'colly' }))).toBe(archived)
    expect(refused(await send('leave.allowance', { personId: 'aoife', year, days: 22, carriedOver: 0, note: '', by: 'colly' }))).toBe(archived)
    expect(refused(await send('leave.open', { year: year + 1, by: 'colly' }))).toBe(archived)
    await app.close()
    await db.close()
  })
})


describe('the years open for leave', () => {
  const year = Number(today.slice(0, 4))
  /** A working day in early February of a year, for a one-day request. */
  const february = (y: number) => workingDays(`${y}-02-02`, `${y}-02-08`)[0]!
  const one = (id: string, y: number): CommandInput<'leave.request'> => ({ id, personId: 'aoife', type: 'annual', start: february(y), end: february(y), note: '' })

  it('are opened by an approver only, this year or next, and opening again changes nothing', async () => {
    // Proves: Colly's decision (3 October 2026): the office opens each year. Without the flag it's refused; a year before
    // this one or after next is refused, so a slip can't open 2062, and a number that isn't a year is refused with the
    // years written as years; next year opens, devices hear of it, the history says who opened it, and a second Open, as
    // a phone sending twice does, writes nothing more.
    const { app, cian, colly } = await company()
    expect(refused(await cian.send('leave.open', { year: year + 1 }))).toMatch(/^Only someone who can approve time off can do this/)
    expect(refused(await colly.send('leave.open', { year: year + 2 }))).toBe(`Only this year or next can be opened for leave: ${year} or ${year + 1}.`)
    expect(refused(await colly.send('leave.open', { year: year - 1 }))).toBe(`Only this year or next can be opened for leave: ${year} or ${year + 1}.`)
    expect(refused(await colly.send('leave.open', { year: year + 0.5 }))).toBe('The year is a whole number from 2000 to 2999.')
    expect(await colly.send('leave.open', { year: year + 1 })).toMatchObject({ status: 'applied' })
    expect(await colly.record<LeaveYear>('leaveYear', String(year + 1))).toMatchObject({ id: String(year + 1), year: year + 1 })
    expect(await colly.send('leave.open', { year: year + 1 })).toMatchObject({ status: 'applied' })
    const changes = (await app.inject({ url: '/api/sync/pull?after=0', cookies: colly.cookies })).json().changes as { entity: string }[]
    expect(changes.filter((c) => c.entity === 'leaveYear')).toHaveLength(1)
    const view = await synced(app, colly.cookies)
    expect([view.leave.isOpen(year + 1), view.leave.toOpen]).toEqual([true, year])
    const history = await colly.history()
    expect(history.entries.map((e) => [e.who.name, e.what, e.outcome])).toContainEqual(['Colly Hewson', `Opened ${year + 1} for leave`, 'done'])
  })

  it('takes a request only in an open year, in the words the device uses, and takes it once the year is open', async () => {
    // Proves: next year, not open yet, is refused as the Leave screen says it before sending; last year, never opened
    // here, can't be now; once an approver opens next year, the same request goes in, waiting. A day in lieu is logged
    // for a day already worked, so it needs no open year.
    const { aoife, colly } = await company()
    expect(refused(await aoife.send('leave.request', one('r-next', year + 1)))).toBe(`Leave for ${year + 1} isn't open yet. The office opens each year when it's ready.`)
    expect(refused(await aoife.send('leave.request', one('r-last', year - 1)))).toBe(`Leave for ${year - 1} isn't open, and only this year and next can be opened.`)
    expect(await aoife.send('lieu.log', { id: 'e-last', personId: 'aoife', day: `${year - 1}-12-13`, days: 1, note: '' })).toMatchObject({ status: 'applied' })
    expect(await colly.send('leave.open', { year: year + 1 })).toMatchObject({ status: 'applied' })
    expect(await aoife.send('leave.request', one('r-next', year + 1))).toMatchObject({ status: 'applied' })
    expect(await aoife.record<LeaveRequest>('leaveRequest', 'r-next')).toMatchObject({ start: february(year + 1), status: 'waiting' })
  })

  it('take allowances for this year or next only, next year\'s before it opens', async () => {
    // Proves: next year's allowances can be set while it is still shut, so they're ready the day it opens; this year's as
    // before; and a year gone or after next is refused, as a typo would otherwise set 2062's.
    const { colly } = await company()
    const allowance = (y: number): CommandInput<'leave.allowance'> => ({ personId: 'aoife', year: y, days: 22, carriedOver: 0, note: '' })
    expect(await colly.send('leave.allowance', allowance(year + 1))).toMatchObject({ status: 'applied' })
    expect(await colly.send('leave.allowance', allowance(year))).toMatchObject({ status: 'applied' })
    for (const y of [year - 1, year + 2]) expect(refused(await colly.send('leave.allowance', allowance(y)))).toBe(`Allowances are set for this year or next only: ${year} or ${year + 1}.`)
  })

  it('open, by the migration, this year and every year up to next with leave in it on a server in use, and none on an empty one', async () => {
    // Proves: on the live server nothing stops working. A database as it was the day before, with a request two years
    // ago, a day in lieu last year and an allowance typed for three years on, opens the first two years and this one,
    // and tells devices through the feed as the server's own, outside anyone's history. Next year stays shut, and so
    // does the year typed far ahead, as no approver could open it. A new, empty database opens nothing, so it stays
    // empty for made-up data.
    const db = await pgliteDb()
    for (const mod of MODULES) await runMigrations(db, mod, mod === LEAVE ? LEAVE_YEARS_OPEN - 1 : undefined)
    await db.query(`INSERT INTO people (id, name, kind, link_token) VALUES ('aoife', 'Aoife Byrne', 'staff', 'aoife-link-token-000000000000')`)
    await db.query(`INSERT INTO changes (entity, entity_id, op, data) VALUES ('person', 'aoife', 'put', '{"id": "aoife", "name": "Aoife Byrne", "kind": "staff"}')`)
    await db.query(`INSERT INTO leave_requests (id, person_id, type, start_day, end_day, days, status) VALUES ('r-old', 'aoife', 'annual', $1, $1, 1, 'approved')`, [february(year - 2)])
    await db.query(`INSERT INTO lieu_entries (id, person_id, day, days, status) VALUES ('e-last', 'aoife', $1, 1, 'approved')`, [`${year - 1}-12-13`])
    await db.query(`INSERT INTO leave_allowances (id, person_id, year, days) VALUES ($1, 'aoife', $2, 20)`, [`aoife-${year + 3}`, year + 3])
    const app = await buildApp({ db })
    const opened = [year - 2, year - 1, year]
    expect((await db.query<{ year: number }>(`SELECT year FROM leave_years ORDER BY year`)).rows.map((r) => r.year)).toEqual(opened)
    const feed = (await db.query<{ id: string; data: LeaveYear; mutation_id: string | null }>(`SELECT entity_id AS id, data, mutation_id FROM changes WHERE entity = 'leaveYear' ORDER BY seq`)).rows
    expect(feed.map((c) => [c.id, c.data.id, c.data.year, c.mutation_id])).toEqual(opened.map((y) => [String(y), String(y), y, null]))
    expect(feed.every((c) => !Number.isNaN(Date.parse(c.data.openedAt)))).toBe(true)
    const send = async (args: CommandInput<'leave.request'>): Promise<MutationResult> =>
      (await app.inject({ method: 'POST', url: '/api/sync/push', payload: { clientId: 'office', mutations: [{ id: newId(), name: 'leave.request', args, createdAt: new Date().toISOString() }] } })).json()
        .results[0]
    expect(await send(one('r-last', year - 1))).toMatchObject({ status: 'applied' })
    for (const y of [year + 1, year + 3]) expect(refused(await send(one(`r-${y}`, y)))).toBe(`Leave for ${y} isn't open yet. The office opens each year when it's ready.`)
    await app.close()
    await db.close()

    const empty = await pgliteDb()
    await migrateAll(empty)
    expect((await empty.query(`SELECT year FROM leave_years`)).rows).toEqual([])
    expect((await empty.query(`SELECT 1 FROM changes`)).rows).toEqual([])
    await empty.close()
  })
})
