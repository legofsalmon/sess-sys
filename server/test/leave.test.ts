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
  type LieuEntry,
  type MutationResult,
  type Person,
  type Transport,
  type Unavailability,
} from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb } from '../src/db.ts'
import { IPHONE, server, staff, WINDOWS } from './people.ts'

/**
 * Staff leave and time in lieu (ADR 0024): the rules the server keeps, one
 * by one, with staff signed in on their own devices; what approved leave
 * does to the planner, offers and the person's calendar feed; and the
 * device saying who it is while sign-in is off.
 */

const today = irishToday()
const day = (n: number) => addDays(today, n)

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
    const { aoife, colly } = await company()
    expect(await colly.send('leave.allowance', { personId: 'aoife', year: 2031, days: 6, carriedOver: 0, note: '' })).toMatchObject({ status: 'applied' })
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
    expect(to.searchParams.get('ok')).toBe('0')
    expect(to.searchParams.get('m')).toBe('These days off are approved leave: cancel the leave on the Leave screen instead.')
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
    const { aoife, colly } = await company()
    const worked = day(-9)
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
    const { app, aoife, colly } = await company()
    const before = await synced(app, aoife.cookies)
    expect(before.leave.balance('aoife', 2031)).toMatchObject({ allowance: 20, carriedOver: 0, allowanceSet: false })
    expect(refused(await colly.send('leave.allowance', { personId: 'dara', year: 2031, days: 20, carriedOver: 0, note: '' }))).toBe('Only staff have an allowance; Dara Quinn is a freelancer.')
    expect(await colly.send('leave.allowance', { personId: 'aoife', year: 2031, days: 22, carriedOver: 2, note: 'Two days left from 2030', by: 'colly' })).toMatchObject({ status: 'applied' })
    expect(await colly.record<LeaveAllowance>('leaveAllowance', 'aoife-2031')).toEqual({ id: 'aoife-2031', personId: 'aoife', year: 2031, days: 22, carriedOver: 2, note: 'Two days left from 2030' })
    const after = await synced(app, aoife.cookies)
    expect(after.leave.balance('aoife', 2031)).toMatchObject({ allowance: 22, carriedOver: 2, allowanceSet: true, annual: { left: 24 } })
    const history = await colly.history()
    expect(history.entries[0]).toMatchObject({ who: { name: 'Colly Hewson' }, what: "Colly Hewson set Aoife Byrne's 2031 allowance to 22 days, 2 carried over" })
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
})

