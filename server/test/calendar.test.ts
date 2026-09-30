import {
  calendarDayId,
  newId,
  phaseOnCalendar,
  type CalendarDay,
  type CalendarLink,
  type CommandInput,
  type CommandName,
  type HistoryEntry,
  type Phase,
  type Project,
} from '@sh/shared'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import type { IdentityProvider } from '../src/auth/google.ts'
import { seal } from '../src/calendar/crypto.ts'
import { pgliteDb, type Db } from '../src/db.ts'
import { everythingJson, readEverything } from '../src/export.ts'
import { FakeGoogle } from './fake-google-calendar.ts'
import { staff, WINDOWS } from './people.ts'

/**
 * Confirmed jobs on Google Calendar (ADR 0008), as ops and crew would see
 * it: connecting an account from the Account tab, picking a calendar, and
 * the calendar then holding every day of every confirmed job from today on,
 * in the shape crew know, whatever happens to the job, to Google, or to the
 * server in between. Google is played by a stand-in that answers as the
 * real one does (fake-google-calendar.ts).
 */

const TEST_CAL = 'test-cal@group.calendar.google.com'
const GIGS = 'gigs@group.calendar.google.com'
const TODAY = '2030-03-02'

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

async function setup(opts: { settleMs?: number; calendar?: boolean } = {}) {
  const db = await pgliteDb()
  const google = new FakeGoogle()
  let now = new Date(`${TODAY}T10:00:00Z`)
  const app = await buildApp({
    db,
    auth: { provider: {} as IdentityProvider, domains: ['sessionhire.com'], emails: [] },
    ...(opts.calendar === false
      ? {}
      : {
          calendar: {
            clientId: google.clientId,
            clientSecret: google.clientSecret,
            fetch: google.fetch,
            gapMs: 0,
            // Runs happen when a test asks, unless it is testing the automatic ones.
            settleMs: opts.settleMs ?? 3_600_000,
            now: () => now,
          },
        }),
  })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  const colly = await staff(app, db, 'Colly Hewson', WINDOWS, 'collylaptop')
  return {
    app,
    db,
    google,
    colly,
    sync: () => app.calendar!.run(),
    check: () => app.calendar!.run(true),
    setToday: (day: string) => (now = new Date(`${day}T10:00:00Z`)),
  }
}

type Setup = Awaited<ReturnType<typeof setup>>

/** Connect Google Calendar from the Account tab: off to Google, allow, and back. */
async function connect({ app, google, colly }: Setup, answer?: (authorizeUrl: string) => string): Promise<LightMyRequestResponse> {
  const start = await app.inject({ url: '/api/calendar/connect?client=collylaptop', cookies: colly.cookies })
  expect(start.statusCode).toBe(302)
  const attempt = start.cookies.find((c) => c.name === 'sh_calendar')!
  const authorizeUrl = start.headers.location as string
  let query = answer?.(authorizeUrl)
  if (!query) {
    const { code, state } = google.consent(authorizeUrl)
    query = `code=${code}&state=${state}`
  }
  return app.inject({ url: `/api/calendar/callback?${query}`, cookies: { ...colly.cookies, sh_calendar: attempt.value } })
}

async function use(s: Setup, calendarId: string) {
  return s.app.inject({ method: 'POST', url: '/api/calendar/use?client=collylaptop', cookies: s.colly.cookies, payload: { calendarId } })
}

async function connectTo(s: Setup, calendarId = TEST_CAL) {
  expect((await connect(s)).headers.location).toBe('/?calendar=connected#account')
  expect((await use(s, calendarId)).statusCode).toBe(200)
  await s.sync()
}

/** What the devices have been told, record by record. */
async function feed(s: Setup) {
  const res = await s.app.inject({ url: '/api/sync/pull?after=0', cookies: s.colly.cookies })
  const all = new Map<string, Map<string, unknown>>()
  for (const c of res.json().changes as { entity: string; id: string; op: string; data: unknown }[]) {
    const table = all.get(c.entity) ?? new Map<string, unknown>()
    all.set(c.entity, table)
    if (c.op === 'delete') table.delete(c.id)
    else table.set(c.id, c.data)
  }
  return {
    text: res.body,
    link: all.get('calendarLink')?.get('main') as CalendarLink | undefined,
    days: Object.fromEntries(all.get('calendarDay') ?? []) as Record<string, CalendarDay>,
    get: <T>(entity: string, id: string) => all.get(entity)?.get(id) as T,
  }
}

const titles = (google: FakeGoogle, calendarId = TEST_CAL) => google.visible(calendarId).map((e) => `${e.start.date} ${e.summary}`)

async function send<N extends CommandName>(s: Setup, name: N, args: CommandInput<N>) {
  const r = await s.colly.send(name, args)
  expect(r.status, JSON.stringify(r)).toBe('applied')
}

/** Nissan, confirmed: Prep yesterday at the warehouse, Build today and tomorrow, Show the day after, with crew on Build. */
async function nissan(s: Setup) {
  const clientId = newId()
  const venueId = newId()
  const jobId = newId()
  const phases = { prep: newId(), build: newId(), show: newId() }
  await send(s, 'client.upsert', { id: clientId, name: 'Nissan Ireland', contacts: [{ name: 'Mary Walsh', role: 'Producer', email: 'mary@nissan.example', phone: '+353 1 555 0100' }], notes: '' })
  await send(s, 'venue.upsert', {
    id: venueId,
    name: 'The Convention Centre Dublin',
    address: 'Spencer Dock, North Wall Quay\nDublin 1, D01 T1W6',
    notes: 'Load-in via Mayor Street.',
  })
  await send(s, 'project.create', { id: jobId, name: 'Nissan', clientId, venueId, status: 'confirmed', notes: 'Launch of the new Leaf.' })
  await send(s, 'phase.add', { id: phases.prep, projectId: jobId, name: 'Prep', start: '2030-03-01', end: '2030-03-01', venueId: null, notes: '' })
  await send(s, 'phase.add', { id: phases.build, projectId: jobId, name: 'Build', start: '2030-03-02', end: '2030-03-03', venueId: null, notes: '' })
  await send(s, 'phase.add', { id: phases.show, projectId: jobId, name: 'Show', start: '2030-03-04', end: '2030-03-04', venueId: null, notes: 'Doors 19:00.' })

  // Two audio techs wanted for Build out of three: Aoife confirmed, Seán said yes and waits on the office.
  const aoife = newId()
  const sean = newId()
  const callId = newId()
  await send(s, 'person.upsert', { id: aoife, name: 'Aoife Byrne', kind: 'freelancer', email: 'aoife@example.com', phone: '+353 87 123 4567', skills: ['audio'], dayRateCents: 25000, notes: '' })
  await send(s, 'person.upsert', { id: sean, name: 'Seán Murphy', kind: 'freelancer', email: null, phone: '+353 86 765 4321', skills: ['audio'], dayRateCents: 26000, notes: '' })
  await send(s, 'call.create', {
    id: callId,
    projectId: jobId,
    phaseId: phases.build,
    project: 'Nissan',
    phase: 'Build',
    venue: '',
    role: 'Audio tech',
    start: '2030-03-02',
    end: '2030-03-03',
    callTime: '08:00',
    needed: 3,
    dayRateCents: 25000,
    details: '',
    replyBy: null,
  })
  const offerA = newId()
  const offerS = newId()
  await send(s, 'offer.send', { id: offerA, callId, personId: aoife, override: false })
  await send(s, 'offer.send', { id: offerS, callId, personId: sean, override: false })
  await send(s, 'offer.respond', { id: offerA, answer: 'accept', days: null, note: '' })
  await send(s, 'offer.confirm', { id: offerA })
  await send(s, 'offer.respond', { id: offerS, answer: 'accept', days: null, note: '' })
  return { jobId, clientId, venueId, phases, callId, offers: { aoife: offerA, sean: offerS } }
}

describe('connecting a calendar', () => {
  it('asks Google for only what it needs, and writes nothing until a calendar is picked', async () => {
    const s = await setup()
    const early = await s.app.inject({ url: '/api/calendar/calendars', cookies: s.colly.cookies })
    expect(early.statusCode).toBe(409)
    expect(early.json().error).toBe('Connect a Google account first.')
    await nissan(s)

    const back = await connect(s, (url) => {
      const q = new URL(url).searchParams
      expect(url).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/)
      expect(q.get('scope')!.split(' ').sort()).toEqual([
        'email',
        'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
        'https://www.googleapis.com/auth/calendar.events',
        'openid',
      ])
      expect(q.get('access_type')).toBe('offline')
      expect(q.get('prompt')).toBe('consent')
      expect(q.get('login_hint')).toBe('colly@sessionhire.com')
      expect(q.get('code_challenge_method')).toBe('S256')
      expect(q.get('redirect_uri')).toBe('http://localhost:80/api/calendar/callback')
      return ''
    })
    expect(back.statusCode).toBe(303)
    expect(back.headers.location).toBe('/?calendar=connected#account')

    const { link } = await feed(s)
    expect(link).toMatchObject({ state: 'choosing', account: 'ops@sessionhire.com', calendarId: null, connectedBy: 'Colly Hewson', problem: null })

    // Only calendars the account can change, its own first.
    const list = await s.app.inject({ url: '/api/calendar/calendars', cookies: s.colly.cookies })
    expect(list.json()).toEqual([
      { id: 'ops@sessionhire.com', name: 'ops@sessionhire.com', primary: true, access: 'owner' },
      { id: GIGS, name: 'Session Hire Gigs', primary: false, access: 'writer' },
      { id: TEST_CAL, name: 'Test calendar', primary: false, access: 'owner' },
    ])

    await s.sync()
    expect(s.google.calls.filter((c) => c.includes('/events'))).toEqual([])

    const readOnly = await use(s, 'holidays@group.v.calendar.google.com')
    expect(readOnly.statusCode).toBe(400)
    expect(readOnly.json().error).toContain("ops@sessionhire.com can't change that calendar")

    const chosen = await use(s, TEST_CAL)
    expect(chosen.json()).toMatchObject({ state: 'on', calendarId: TEST_CAL, calendarName: 'Test calendar' })
  })

  it('keeps the key Google gives locked, out of the export, and away from devices', async () => {
    const s = await setup()
    await connectTo(s)
    const { rows } = await s.db.query<{ refresh_token: string }>('SELECT refresh_token FROM calendar_link')
    expect(rows[0]!.refresh_token).toMatch(/^v1\./)
    expect(rows[0]!.refresh_token).not.toContain('refresh-')

    const everything = JSON.stringify(everythingJson(await readEverything(s.db)))
    expect(everything).toContain('"calendar_link"')
    expect(everything).not.toContain('refresh_token')
    expect(everything).not.toContain(rows[0]!.refresh_token)
    expect((await feed(s)).text).not.toMatch(/refresh|v1\./)
  })

  it('says why when connecting goes wrong, and connects nothing', async () => {
    const s = await setup()
    const cancelled = await connect(s, () => 'error=access_denied')
    expect(cancelled.headers.location).toBe('/?calendar=cancelled#account')

    const forged = await connect(s, (url) => {
      const { code } = s.google.consent(url)
      return `code=${code}&state=someone-elses`
    })
    expect(forged.headers.location).toBe('/?calendar=failed#account')

    // Without a lasting key the app could only write for an hour.
    s.google.grant.refresh = false
    expect((await connect(s)).headers.location).toBe('/?calendar=failed#account')
    s.google.grant.refresh = true

    // Google lets people untick the calendar on its consent page.
    s.google.grant.scopes = 'openid https://www.googleapis.com/auth/userinfo.email'
    expect((await connect(s)).headers.location).toBe('/?calendar=missing#account')
    expect(s.google.revokedFor('ops@sessionhire.com')).toBe(true)
    expect((await feed(s)).link).toBeUndefined()
  })

  it('without the Google key, says the calendar needs it', async () => {
    const s = await setup({ calendar: false })
    const start = await s.app.inject({ url: '/api/calendar/connect', cookies: s.colly.cookies })
    expect(start.headers.location).toBe('/?calendar=off#account')
    const list = await s.app.inject({ url: '/api/calendar/calendars', cookies: s.colly.cookies })
    expect(list.statusCode).toBe(409)
    expect(s.app.calendar).toBeUndefined()
  })

  it('needs someone signed in, like the rest of the app', async () => {
    const s = await setup()
    for (const url of ['/api/calendar/connect', '/api/calendar/calendars', '/api/calendar/callback?code=x&state=y']) expect((await s.app.inject({ url })).statusCode).toBe(401)
    for (const url of ['/api/calendar/use', '/api/calendar/check', '/api/calendar/disconnect']) expect((await s.app.inject({ method: 'POST', url })).statusCode).toBe(401)
  })
})

describe('what goes on the calendar', () => {
  it('puts every day of a confirmed job on it from today on, as crew know it', async () => {
    const s = await setup()
    const job = await nissan(s)
    // Not confirmed, so not on the calendar.
    const pencilled = newId()
    await send(s, 'project.create', { id: pencilled, name: 'Pencilled', clientId: null, venueId: null, status: 'enquiry', notes: '' })
    await send(s, 'phase.add', { id: newId(), projectId: pencilled, name: 'Show', start: '2030-03-03', end: '2030-03-03', venueId: null, notes: '' })
    await connectTo(s)

    // Yesterday's Prep is left alone.
    expect(titles(s.google)).toEqual(['2030-03-02 Nissan - Build 1/2', '2030-03-03 Nissan - Build 2/2', '2030-03-04 Nissan - Show'])
    const [build1, , show] = s.google.visible(TEST_CAL)
    expect(build1).toMatchObject({
      start: { date: '2030-03-02' },
      end: { date: '2030-03-03' },
      location: 'The Convention Centre Dublin, Spencer Dock, North Wall Quay, Dublin 1, D01 T1W6',
      extendedProperties: { private: { shJob: job.jobId, shPhase: job.phases.build, shDay: '2030-03-02' } },
    })
    expect(build1!.description).toBe(
      [
        'Client: Nissan Ireland',
        'Build, day 1 of 2: Sat 2 Mar to Sun 3 Mar',
        '',
        'Venue: The Convention Centre Dublin',
        'Spencer Dock, North Wall Quay, Dublin 1, D01 T1W6',
        'At the venue: Load-in via Mayor Street.',
        '',
        'Crew',
        'Audio tech, call 08:00: Aoife Byrne, Seán Murphy (to confirm) and 1 still to find',
        '',
        'Job notes',
        'Launch of the new Leaf.',
        '',
        `The job in the Session Hire app: http://localhost:80/#jobs/${job.jobId}`,
        '',
        'Written by the Session Hire app. Change the job in the app: changes made here are put back.',
      ].join('\n')
    )
    expect(show!.description).toContain('Show, Mon 4 Mar')
    expect(show!.description).toContain('Show notes\nDoors 19:00.')
    // Names only: no rates, phone numbers or emails.
    for (const ev of s.google.visible(TEST_CAL)) expect(ev.description).not.toMatch(/€|250|260|\+353|@/)

    // Devices see each day, and the job page what it means.
    const f = await feed(s)
    expect(Object.keys(f.days).sort()).toEqual(
      [calendarDayId(job.phases.build, '2030-03-02'), calendarDayId(job.phases.build, '2030-03-03'), calendarDayId(job.phases.show, '2030-03-04')].sort()
    )
    expect(f.days[calendarDayId(job.phases.build, '2030-03-02')]).toMatchObject({ state: 'on', title: 'Nissan - Build 1/2', calendarId: TEST_CAL, problem: null })
    const project = f.get<Project>('project', job.jobId)
    const phase = (id: string) => f.get<Phase>('phase', id)
    expect(phaseOnCalendar(project, phase(job.phases.build), f.link, f.days, TODAY)).toMatchObject({ state: 'on', calendar: 'Test calendar', days: 2 })
    expect(phaseOnCalendar(project, phase(job.phases.prep), f.link, f.days, TODAY)).toEqual({ state: 'past' })
    expect(phaseOnCalendar({ name: 'Pencilled', status: 'enquiry' }, phase(job.phases.show), f.link, f.days, TODAY)).toEqual({ state: 'waiting' })

    // A second run with nothing changed writes nothing.
    const before = s.google.calls.length
    expect(await s.sync()).toEqual({ written: 0, removed: 0, failed: 0 })
    expect(s.google.calls.slice(before).filter((c) => !c.startsWith('POST /token'))).toEqual([])
  })

  it('keeps the calendar in step as the job changes, touching only what changed', async () => {
    const s = await setup()
    const job = await nissan(s)
    await connectTo(s)
    const ids = s.google.visible(TEST_CAL).map((e) => e.id)

    await send(s, 'project.update', { id: job.jobId, name: 'Nissan Leaf' })
    await s.sync()
    expect(titles(s.google)).toEqual(['2030-03-02 Nissan Leaf - Build 1/2', '2030-03-03 Nissan Leaf - Build 2/2', '2030-03-04 Nissan Leaf - Show'])
    expect(s.google.visible(TEST_CAL).map((e) => e.id)).toEqual(ids)

    // A note on Show changes Show's event only.
    let before = s.google.calls.length
    await send(s, 'phase.update', { id: job.phases.show, notes: 'Doors 19:30.' })
    await s.sync()
    expect(s.google.calls.slice(before).filter((c) => c.includes('/events'))).toEqual([`PUT /calendar/v3/calendars/${encodeURIComponent(TEST_CAL)}/events/${ids[2]}`])

    // Show moves a day later; Build grows to three days.
    await send(s, 'phase.update', { id: job.phases.show, start: '2030-03-05', end: '2030-03-05' })
    await send(s, 'phase.update', { id: job.phases.build, end: '2030-03-04' })
    await s.sync()
    expect(titles(s.google)).toEqual([
      '2030-03-02 Nissan Leaf - Build 1/3',
      '2030-03-03 Nissan Leaf - Build 2/3',
      '2030-03-04 Nissan Leaf - Build 3/3',
      '2030-03-05 Nissan Leaf - Show',
    ])

    // Booking crew changes the days they are on.
    before = s.google.calls.length
    await send(s, 'offer.confirm', { id: job.offers.sean })
    await s.sync()
    expect(s.google.visible(TEST_CAL)[0]!.description).toContain('Audio tech, call 08:00: Aoife Byrne, Seán Murphy and 1 still to find')
    expect(s.google.calls.slice(before).filter((c) => c.includes('/events'))).toHaveLength(2)

    // Cancelled: off the calendar, and off the devices' list.
    await send(s, 'project.update', { id: job.jobId, status: 'cancelled' })
    await s.sync()
    expect(titles(s.google)).toEqual([])
    expect((await feed(s)).days).toEqual({})

    // Confirmed again: back, in the same events.
    await send(s, 'project.update', { id: job.jobId, status: 'confirmed' })
    await s.sync()
    expect(titles(s.google)).toEqual(['2030-03-02 Nissan Leaf - Build 1/3', '2030-03-03 Nissan Leaf - Build 2/3', '2030-03-04 Nissan Leaf - Build 3/3', '2030-03-05 Nissan Leaf - Show'])
    expect(s.google.visible(TEST_CAL).map((e) => e.id).slice(0, 2)).toEqual(ids.slice(0, 2))

    // A phase removed takes its days with it.
    await send(s, 'phase.remove', { id: job.phases.show })
    await s.sync()
    expect(titles(s.google)).toHaveLength(3)
  })

  it('leaves days that have gone alone', async () => {
    const s = await setup()
    const job = await nissan(s)
    await connectTo(s)
    s.setToday('2030-03-04')
    await send(s, 'project.update', { id: job.jobId, name: 'Nissan Leaf' })
    await s.sync()
    // Build is over: its events keep the old name. Show is today.
    expect(titles(s.google)).toEqual(['2030-03-02 Nissan - Build 1/2', '2030-03-03 Nissan - Build 2/2', '2030-03-04 Nissan Leaf - Show'])
    await send(s, 'project.update', { id: job.jobId, status: 'cancelled' })
    await s.sync()
    expect(titles(s.google)).toEqual(['2030-03-02 Nissan - Build 1/2', '2030-03-03 Nissan - Build 2/2'])
  })

  it('an answer lost on the way back from Google makes no second event', async () => {
    const s = await setup()
    await nissan(s)
    await connect(s)
    await use(s, TEST_CAL)
    s.google.loseReplies = 1
    await s.sync()
    await s.sync()
    expect(titles(s.google)).toEqual(['2030-03-02 Nissan - Build 1/2', '2030-03-03 Nissan - Build 2/2', '2030-03-04 Nissan - Show'])
    expect([...s.google.events.get(TEST_CAL)!.values()]).toHaveLength(3)
  })
})

describe('when the calendar and the app disagree', () => {
  it('the nightly check puts back what was changed or deleted in Google, and clears up strays', async () => {
    const s = await setup()
    await nissan(s)
    await connectTo(s)
    const [build1, build2, show] = s.google.visible(TEST_CAL)
    s.google.edit(TEST_CAL, build1!.id, { summary: 'Nissan - Build (moved?)' })
    s.google.edit(TEST_CAL, build2!.id, { status: 'cancelled' })
    // Deleted long ago enough that Google has forgotten it.
    s.google.events.get(TEST_CAL)!.delete(show!.id)
    s.google.purged.add(show!.id)
    // One of the app's own events it has lost track of (a restored database, say), and someone's own event.
    const appKey = build1!.extendedProperties!.private!.sh!
    const store = s.google.events.get(TEST_CAL)!
    const stray = { ...build1!, id: 'straystraystray1', summary: 'Old - Show', start: { date: '2030-03-06' }, end: { date: '2030-03-07' }, extendedProperties: { private: { sh: appKey, shDay: '2030-03-06' } } }
    store.set(stray.id, stray)
    const own = { ...build1!, id: 'mineminemine1', summary: 'Dentist', extendedProperties: undefined }
    store.set(own.id, own)

    // Without looking, the app doesn't know.
    expect(await s.sync()).toEqual({ written: 0, removed: 0, failed: 0 })
    expect(await s.check()).toEqual({ written: 3, removed: 1, failed: 0 })
    expect(titles(s.google)).toEqual(['2030-03-02 Dentist', '2030-03-02 Nissan - Build 1/2', '2030-03-03 Nissan - Build 2/2', '2030-03-04 Nissan - Show'])
    // The forgotten one could only be made again, with a new id.
    expect(s.google.visible(TEST_CAL).find((e) => e.summary === 'Nissan - Show')!.id).not.toBe(show!.id)
    expect(await s.check()).toEqual({ written: 0, removed: 0, failed: 0 })
  })

  it('Google being busy only delays things, and says so if it goes on', async () => {
    const s = await setup()
    await nissan(s)
    await connect(s)
    await use(s, TEST_CAL)
    s.google.busyFor = 1
    expect(await s.sync()).toEqual({ written: 0, removed: 0, failed: 0 })
    expect((await feed(s)).link!.problem).toBeNull()
    s.google.busyFor = 2
    await s.sync()
    await s.sync()
    expect((await feed(s)).link!.problem).toMatch(/^Google Calendar isn't answering, so some days are still on their way\. Trying again at \d\d:\d\d\.$/)
    await s.sync()
    expect(titles(s.google)).toHaveLength(3)
    expect((await feed(s)).link!.problem).toBeNull()
  })

  it('a day Google turns down shows on the job page, and the rest still go on', async () => {
    const s = await setup()
    const job = await nissan(s)
    s.google.refuse.add('Nissan - Show')
    await connectTo(s)
    expect(titles(s.google)).toEqual(['2030-03-02 Nissan - Build 1/2', '2030-03-03 Nissan - Build 2/2'])
    const f = await feed(s)
    const project = f.get<Project>('project', job.jobId)
    expect(phaseOnCalendar(project, f.get<Phase>('phase', job.phases.show), f.link, f.days, TODAY)).toMatchObject({
      state: 'failed',
      problem: 'Google turned this day down (badRequest). It is tried again when the job changes, and each night.',
    })
    // Not tried again on every change to anything else.
    const before = s.google.calls.length
    await send(s, 'phase.update', { id: job.phases.build, notes: 'Bring the long ladder.' })
    await s.sync()
    expect(s.google.calls.slice(before).filter((c) => c.includes('/events'))).toHaveLength(2)
    s.google.refuse.clear()
    await s.check()
    expect(titles(s.google)).toHaveLength(3)
  })
})

describe('when access goes wrong', () => {
  it('asks to connect again when Google stops accepting the key, then carries on', async () => {
    const s = await setup()
    const job = await nissan(s)
    await connectTo(s)
    s.google.revokeAll()
    await send(s, 'project.update', { id: job.jobId, name: 'Nissan Leaf' })
    await s.sync()
    const f = await feed(s)
    expect(f.link).toMatchObject({ state: 'reconnect', problem: expect.stringContaining('Connect again to carry on') })
    expect(phaseOnCalendar(f.get<Project>('project', job.jobId), f.get<Phase>('phase', job.phases.build), f.link, f.days, TODAY)).toEqual({ state: 'paused' })

    // The same account again: the calendar is kept, and the calendar catches up.
    expect((await connect(s)).headers.location).toBe('/?calendar=connected#account')
    expect((await feed(s)).link).toMatchObject({ state: 'on', calendarId: TEST_CAL })
    await s.sync()
    expect(titles(s.google)).toEqual(['2030-03-02 Nissan Leaf - Build 1/2', '2030-03-03 Nissan Leaf - Build 2/2', '2030-03-04 Nissan Leaf - Show'])
  })

  it('asks to connect again when the Google secret has changed since', async () => {
    const s = await setup()
    await nissan(s)
    await connectTo(s)
    await s.db.query(`UPDATE calendar_link SET refresh_token = $1`, [seal('an-older-secret', 'refresh-1', 'sub-ops@sessionhire.com')])
    s.google.expireAccess()
    await s.check()
    expect((await feed(s)).link).toMatchObject({ state: 'reconnect', problem: expect.stringContaining("The app's Google key has changed") })
  })

  it('explains a Calendar API that is switched off, and waits for Check now', async () => {
    const s = await setup()
    const job = await nissan(s)
    await connect(s)
    await use(s, TEST_CAL)
    s.google.apiEnabled = false
    await s.sync()
    expect((await feed(s)).link).toMatchObject({ state: 'on', problem: expect.stringContaining('The Google Calendar API is switched off') })

    // Changes don't keep knocking on Google's door.
    const before = s.google.calls.length
    await send(s, 'project.update', { id: job.jobId, notes: 'Changed.' })
    s.app.calendar!.kick()
    await new Promise((r) => setTimeout(r, 50))
    expect(s.google.calls.length).toBe(before)

    s.google.apiEnabled = true
    const res = await s.app.inject({ method: 'POST', url: '/api/calendar/check', cookies: s.colly.cookies })
    expect(res.json()).toEqual({ written: 3, removed: 0, failed: 0 })
    expect((await feed(s)).link!.problem).toBeNull()
  })

  it('explains a calendar that has been unshared', async () => {
    const s = await setup()
    const job = await nissan(s)
    await connectTo(s)
    s.google.unshare('ops@sessionhire.com', TEST_CAL)
    await send(s, 'project.update', { id: job.jobId, name: 'Nissan Leaf' })
    await s.sync()
    expect((await feed(s)).link!.problem).toBe(
      "ops@sessionhire.com can't change Test calendar any more: it may have been deleted, or its sharing changed. Choose another calendar, or give that account permission to change it again."
    )
  })
})

describe('changing calendar and disconnecting', () => {
  it('moves the days to a new calendar, takes them off when disconnecting, and hands the key back', async () => {
    const s = await setup()
    await nissan(s)
    await connectTo(s)
    s.setToday('2030-03-03')
    expect((await use(s, GIGS)).statusCode).toBe(200)
    await s.sync()
    // Yesterday stays where it was.
    expect(titles(s.google, TEST_CAL)).toEqual(['2030-03-02 Nissan - Build 1/2'])
    expect(titles(s.google, GIGS)).toEqual(['2030-03-03 Nissan - Build 2/2', '2030-03-04 Nissan - Show'])

    const off = await s.app.inject({ method: 'POST', url: '/api/calendar/disconnect?client=collylaptop', cookies: s.colly.cookies })
    expect(off.json()).toMatchObject({ state: 'stopping' })
    await s.sync()
    expect(titles(s.google, GIGS)).toEqual([])
    expect(titles(s.google, TEST_CAL)).toEqual(['2030-03-02 Nissan - Build 1/2'])
    expect(s.google.revokedFor('ops@sessionhire.com')).toBe(true)
    const f = await feed(s)
    expect(f.link).toMatchObject({ state: 'off', account: null, calendarId: null, problem: null })
    // Devices still know where yesterday went.
    expect(Object.values(f.days).map((d) => [d.day, d.calendarId])).toEqual([['2030-03-02', TEST_CAL]])

    // All in the history, as Colly's.
    const history = (await s.colly.history()).entries.filter((e: HistoryEntry) => e.command.startsWith('calendar.'))
    expect(history.map((e: HistoryEntry) => [e.who.name, e.what, e.deviceCode])).toEqual([
      ['Colly Hewson', "Disconnected Google Calendar (ops@sessionhire.com), taking the app's days off Session Hire Gigs", 'laptop'],
      ['Colly Hewson', 'Chose Session Hire Gigs as the calendar for jobs', 'laptop'],
      ['Colly Hewson', 'Chose Test calendar as the calendar for jobs', 'laptop'],
      ['Colly Hewson', 'Connected Google Calendar as ops@sessionhire.com', 'laptop'],
    ])
  })

  it('disconnecting when Google no longer accepts the key says what was left behind', async () => {
    const s = await setup()
    await nissan(s)
    await connectTo(s)
    s.google.revokeAll()
    await s.sync()
    await s.app.inject({ method: 'POST', url: '/api/calendar/disconnect', cookies: s.colly.cookies })
    await s.sync()
    expect((await feed(s)).link).toMatchObject({
      state: 'off',
      problem: "3 days were left on Test calendar, because Google no longer accepts the app's access. Delete them in Google Calendar if they aren't wanted.",
    })
    expect(titles(s.google)).toHaveLength(3)

    // Connecting again later picks the same days back up rather than doubling them.
    await connectTo(s)
    expect(titles(s.google)).toHaveLength(3)
    expect([...s.google.events.get(TEST_CAL)!.values()]).toHaveLength(3)
  })
})

describe('running by itself', () => {
  it('a change in the app reaches the calendar a moment later, with nobody asking', async () => {
    const s = await setup({ settleMs: 10 })
    const job = await nissan(s)
    await connectTo(s)
    await send(s, 'project.update', { id: job.jobId, name: 'Nissan Leaf' })
    for (let i = 0; i < 100 && !titles(s.google)[0]?.includes('Leaf'); i++) await new Promise((r) => setTimeout(r, 20))
    expect(titles(s.google)[0]).toBe('2030-03-02 Nissan Leaf - Build 1/2')
  })
})

/** Keep TypeScript honest about the helpers' shapes. */
export type { Db, FastifyInstance }
