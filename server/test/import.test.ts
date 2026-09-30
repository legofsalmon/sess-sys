import {
  leftOutLabel,
  importFromDefault,
  phaseOnCalendar,
  type CrewCall,
  type ImportChoices,
  type ImportPreview,
  type ImportResult,
  type Offer,
  type Person,
  type Phase,
  type Project,
  type Venue,
} from '@sh/shared'
import type { LightMyRequestResponse } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import type { IdentityProvider } from '../src/auth/google.ts'
import { nameFromEmail, nameKey, parseTitle, planImport, plainText, type AppData, type SourceEvent } from '../src/calendar/import-plan.ts'
import { pgliteDb } from '../src/db.ts'
import { everythingJson, readEverything } from '../src/export.ts'
import { FakeGoogle } from './fake-google-calendar.ts'
import { staff, WINDOWS } from './people.ts'

/**
 * Bringing the jobs already on the organisers' Google calendars into the
 * app (ADR 0011): how titles, days, places and guests become jobs, phases,
 * venues and crew; and, against a pretend Google, looking at a calendar,
 * bringing in what the office ticked, and looking again later.
 */

describe('titles', () => {
  const t = (title: string) => {
    const p = parseTitle(title)
    return `${p.job} | ${p.phases.join(' + ')}${p.guessed ? ' (guessed)' : ''}${p.pencilled ? ' (pencilled)' : ''}`
  }

  it('are the job, then the phase after the last " - ", in the app’s own words', () => {
    expect(t('Nissan - Build 2/2')).toBe('Nissan | Build')
    expect(t('Tik Tok - Ploughing - Load In')).toBe('Tik Tok - Ploughing | Load in')
    expect(t('Web Summit - Rehearsals')).toBe('Web Summit | Rehearsal')
    expect(t('Web Summit - Tech')).toBe('Web Summit | Rehearsal')
    expect(t('Web Summit - Set up')).toBe('Web Summit | Build')
    expect(t('Web Summit - Derig')).toBe('Web Summit | Load out')
    expect(t('Web Summit - Get out')).toBe('Web Summit | Load out')
    expect(t('Aviva - Babysitting')).toBe('Aviva | Babysit')
    expect(t('Aviva - Warehouse Prep (1 of 2)')).toBe('Aviva | Prep')
    expect(t('Café Olé - Show day 3')).toBe('Café Olé | Show')
  })

  it('give a day of two phases to both, and keep other day names as typed', () => {
    expect(t('Fairview - Show Day 2/ Load Out')).toBe('Fairview | Show + Load out')
    expect(t('EY - Load In/Build')).toBe('EY | Load in + Build')
    expect(t('Web Summit - Recce')).toBe('Web Summit | Recce')
    expect(t('Web Summit - Site visit')).toBe('Web Summit | Site visit')
  })

  it('split a title with no " - " before a phase at its end, but leave a name ending in Show alone', () => {
    expect(t('Fairview Build')).toBe('Fairview | Build')
    expect(t('U2 Load In 1/2')).toBe('U2 | Load in')
    expect(t('Fairview Show Day 2/ Load Out')).toBe('Fairview | Show + Load out')
    expect(t('Dublin Horse Show')).toBe('Dublin Horse Show | Show (guessed)')
    expect(t('Christmas party')).toBe('Christmas party | Show (guessed)')
    expect(t('Web Summit - Day 2')).toBe('Web Summit | Show (guessed)')
    expect(t('RDS - Delivery')).toBe('RDS | Load in')
  })

  it('pencil a job in for TBC, hold, pencil, provisional or a question mark, and take the word off its name', () => {
    expect(t('Christmas party (TBC)')).toBe('Christmas party | Show (guessed) (pencilled)')
    expect(t('Christmas party - TBC - Show')).toBe('Christmas party | Show (pencilled)')
    expect(t('Hold - EY Awards')).toBe('EY Awards | Show (guessed) (pencilled)')
    expect(t('EY Awards [provisional]')).toBe('EY Awards | Show (guessed) (pencilled)')
    expect(t('Pencil - Web Summit - Build')).toBe('Web Summit | Build (pencilled)')
    expect(t('Web Summit?')).toBe('Web Summit | Show (guessed) (pencilled)')
    expect(t('Holdings AGM - Show')).toBe('Holdings AGM | Show')
  })

  it('are compared ignoring case, accents, spacing and punctuation', () => {
    expect(nameKey('  Café  Olé!! ')).toBe(nameKey('cafe ole'))
    expect(nameKey('Tik-Tok')).toBe(nameKey('tik tok'))
  })
})

describe('job sheets and names', () => {
  it('turn Google’s HTML descriptions into plain text', () => {
    expect(plainText('<b>Kit</b><br>2x K2<ul><li>Desk</li><li>Mics &amp; stands</li></ul><p>Gate 3&nbsp;&#8211; ask for Tom</p>')).toBe(
      'Kit\n2x K2\n- Desk\n- Mics & stands\n\nGate 3 – ask for Tom'
    )
    expect(plainText('Access via the loading bay\r\nPower: 63A')).toBe('Access via the loading bay\nPower: 63A')
  })

  it('make a name from an address when Google has none', () => {
    expect(nameFromEmail('aoife.byrne92@gmail.com')).toBe('Aoife Byrne')
    expect(nameFromEmail('sean_og.murphy@hotmail.com')).toBe('Sean Og Murphy')
  })
})

describe('planning', () => {
  let n = 0
  const ev = (title: string, days: string | [string, string], more: Partial<SourceEvent> = {}): SourceEvent => {
    const [start, end] = typeof days === 'string' ? [days, days] : days
    const id = `e${++n}`
    return { id, uid: `${id}@google.com`, cancelled: false, title, days: { start, end }, location: '', description: '', guests: [], repeating: false, special: false, ours: false, ...more }
  }
  const empty: AppData = { people: [], venues: [], jobs: [], imported: [] }
  const opts = { account: 'ops@sessionhire.com', calendarId: 'ops@sessionhire.com', from: '2031-01-01', to: '2033-01-01' }
  const phases = (j: { runs: { name: string; days: string[] }[] }) => j.runs.map((r) => `${r.name} ${r.days[0]}${r.days.length > 1 ? `–${r.days.at(-1)}` : ''}`)

  it('makes one job of a name’s days, and a phase of each run of days, unless a fortnight apart', () => {
    const plan = planImport(
      [
        ev('Nissan - Build 1/2', '2031-03-10'),
        ev('Nissan - Build 2/2', '2031-03-11'),
        ev('NISSAN - Show', '2031-03-12'),
        ev('Nissan - Show', '2031-03-14'),
        ev('Nissan - Load Out', '2031-03-14'),
        ev('Nissan - Show', '2031-04-20'),
      ],
      empty,
      opts
    )
    expect(plan.jobs.map((j) => [j.name, phases(j)])).toEqual([
      ['Nissan', ['Build 2031-03-10–2031-03-11', 'Show 2031-03-12', 'Show 2031-03-14', 'Load out 2031-03-14']],
      ['Nissan', ['Show 2031-04-20']],
    ])
    expect(plan.jobs.map((j) => j.status)).toEqual(['confirmed', 'confirmed'])
  })

  it('brings two jobs in as one when the office gives them the same name', () => {
    const events = [ev('Nissan Build', '2031-03-10'), ev('Nissan Qashqai launch', '2031-03-12'), ev('Other gig', '2031-03-12')]
    const first = planImport(events, empty, opts)
    const [a, b, c] = first.jobs
    const plan = planImport(events, empty, opts, {
      names: new Map([
        [a!.key, 'Nissan Qashqai launch'],
        [b!.key, 'Nissan Qashqai launch'],
      ]),
      include: new Set([a!.key, b!.key]),
    })
    expect(c!.name).toBe('Other gig')
    expect(plan.jobs.map((j) => [j.name, phases(j)])).toEqual([['Nissan Qashqai launch', ['Build 2031-03-10', 'Show 2031-03-12']]])
  })

  it('leaves out days of jobs already in the app, and of jobs cancelled there', () => {
    const app: AppData = {
      ...empty,
      jobs: [
        { id: 'j1', name: 'Web Summit', status: 'confirmed', venueId: null, sourceCalendar: null, phases: [{ id: 'p1', name: 'Show', start: '2031-03-20', end: '2031-03-21' }] },
        { id: 'j2', name: 'EY Awards', status: 'cancelled', venueId: null, sourceCalendar: null, phases: [{ id: 'p2', name: 'Show', start: '2031-05-01', end: '2031-05-01' }] },
      ],
    }
    const plan = planImport([ev('Web Summit - Show', '2031-03-20'), ev('EY Awards - Build', '2031-04-30'), ev('Web Summit - Show', '2031-09-20')], app, opts)
    expect(plan.jobs.map((j) => [j.name, phases(j)])).toEqual([['Web Summit', ['Show 2031-09-20']]])
    expect(plan.leftOut.map((l) => leftOutLabel(l))).toEqual(['1 day already in the app', '1 day of jobs cancelled or lost in the app'])
  })

  it('pencils a job in only when all of it is', () => {
    const plan = planImport(
      [ev('Party (TBC) - Build', '2031-06-01'), ev('Party (TBC) - Show', '2031-06-02'), ev('Launch - Build', '2031-06-01'), ev('Launch - Show TBC', '2031-06-02')],
      empty,
      opts
    )
    expect(plan.jobs.map((j) => [j.name, j.status])).toEqual([
      ['Party', 'enquiry'],
      ['Launch', 'confirmed'],
    ])
  })

  it('finds venues in the app by name or address, and adds one per new place', () => {
    const app: AppData = { ...empty, venues: [{ id: 'v1', name: 'The Convention Centre', address: 'Spencer Dock, North Wall Quay, Dublin 1' }] }
    const plan = planImport(
      [
        ev('A - Show', '2031-06-01', { location: 'Spencer Dock, North Wall Quay, Dublin 1' }),
        ev('B - Show', '2031-06-01', { location: 'The Marker Hotel, Grand Canal Square, Dublin 2' }),
        ev('C - Build', '2031-06-01', { location: 'The Marker Hotel, Grand Canal Square, Dublin 2' }),
        ev('C - Show', '2031-06-02', { location: 'Vicar Street' }),
        ev('C - Load out', '2031-06-03', { location: 'Vicar Street' }),
      ],
      app,
      opts
    )
    expect(plan.jobs.map((j) => [j.name, j.venue, j.runs.map((r) => r.venue?.name ?? null)])).toEqual([
      ['A', { id: 'v1', name: 'The Convention Centre' }, [null]],
      ['B', { key: 'the marker hotel', name: 'The Marker Hotel', address: 'The Marker Hotel, Grand Canal Square, Dublin 2' }, [null]],
      ['C', { key: 'vicar street', name: 'Vicar Street', address: '' }, ['The Marker Hotel', null, null]],
    ])
  })

  it('finds guests in the app by email, or by name for someone with none, and suggests adding people', () => {
    const app: AppData = {
      ...empty,
      people: [
        { id: 'p1', name: 'Ciara Walsh', email: 'Ciara@example.ie' },
        { id: 'p2', name: 'Tom Kelly', email: null },
      ],
    }
    const guests = [
      { email: 'ops@sessionhire.com', name: null, answer: 'accepted' as const, notCrew: true },
      { email: 'ciara@example.ie', name: 'Ciara', answer: 'accepted' as const, notCrew: false },
      { email: 'tomkelly@gmail.com', name: 'Tom Kelly', answer: 'needsAction' as const, notCrew: false },
      { email: 'aoife.byrne@gmail.com', name: null, answer: 'declined' as const, notCrew: false },
      { email: 'sean@sessionhire.com', name: 'Seán Óg', answer: 'tentative' as const, notCrew: false },
      { email: 'hire@stagesupplies.ie', name: 'Stage Supplies', answer: 'accepted' as const, notCrew: false },
      { email: 'room-1@resource.calendar.google.com', name: 'Room 1', answer: 'accepted' as const, notCrew: true },
    ]
    const plan = planImport([ev('Gig - Show', '2031-06-01', { guests })], app, opts)
    expect(plan.jobs[0]!.runs[0]!.crew.map((c) => [c.person, c.answers['2031-06-01']])).toEqual([
      [{ id: 'p1' }, 'accepted'],
      [{ id: 'p2' }, 'needsAction'],
      [{ email: 'aoife.byrne@gmail.com' }, 'declined'],
      [{ email: 'sean@sessionhire.com' }, 'tentative'],
      [{ email: 'hire@stagesupplies.ie' }, 'accepted'],
    ])
    expect(plan.people).toEqual([
      { email: 'aoife.byrne@gmail.com', name: 'Aoife Byrne', kind: 'freelancer', suggested: true, jobs: 1 },
      { email: 'sean@sessionhire.com', name: 'Seán Óg', kind: 'staff', suggested: true, jobs: 1 },
      { email: 'hire@stagesupplies.ie', name: 'Stage Supplies', kind: 'freelancer', suggested: false, jobs: 1 },
    ])
  })

  it('says what it left out, and why', () => {
    const plan = planImport(
      [
        ev('Call with Nissan', '2031-03-06', { days: null }),
        ev('Stock check', '2031-03-07', { repeating: true }),
        ev('Out of office', '2031-03-08', { special: true }),
        ev('  ', '2031-03-09'),
        ev('Nissan - Show 1/1', '2031-03-12', { ours: true }),
        ev('Summer season', ['2031-06-01', '2031-07-31']),
        ev('Gone', '2031-03-09', { cancelled: true }),
      ],
      empty,
      opts
    )
    expect(plan.events).toBe(6)
    expect(plan.jobs).toEqual([])
    expect(plan.leftOut.map((l) => [leftOutLabel(l), l.examples])).toEqual([
      ['1 event with a start time (meetings, calls)', ['Call with Nissan']],
      ['1 repeating event (birthdays, reminders)', ['Stock check']],
      ['1 out-of-office or other special event', ['Out of office']],
      ['1 event with no title', []],
      ['1 event the app wrote itself', ['Nissan - Show 1/1']],
      ['1 event longer than a month', ['Summer season']],
    ])
  })
})

describe('the job page', () => {
  it('says a job brought in stays on the calendar it came from', () => {
    const job: Pick<Project, 'name' | 'status' | 'sourceCalendar'> = { name: 'Nissan', status: 'confirmed', sourceCalendar: 'ops@sessionhire.com' }
    const phase = { id: 'p1', name: 'Build', start: '2031-03-10', end: '2031-03-11' }
    expect(phaseOnCalendar(job, phase, undefined, {}, '2031-03-05')).toEqual({ state: 'theirs', calendar: 'ops@sessionhire.com' })
    expect(importFromDefault('2031-03-05')).toBe('2030-12-01')
  })
})

// Against a pretend Google.

const OPS = 'ops@sessionhire.com'
const TEST_CAL = 'test-cal@group.calendar.google.com'
const TODAY = '2031-03-05'

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

async function setup({ calendar = true }: { calendar?: boolean } = {}) {
  const db = await pgliteDb()
  const google = new FakeGoogle()
  const now = new Date(`${TODAY}T10:00:00Z`)
  google.clock = () => now
  const app = await buildApp({
    db,
    auth: { provider: {} as IdentityProvider, domains: ['sessionhire.com'], emails: [] },
    ...(calendar
      ? { calendar: { clientId: google.clientId, clientSecret: google.clientSecret, fetch: google.fetch, gapMs: 0, settleMs: 3_600_000, pollMs: 0, now: () => now } }
      : {}),
  })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  const colly = await staff(app, db, 'Colly Hewson', WINDOWS, 'collylaptop')
  const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, cookies: colly.cookies, headers: { 'user-agent': WINDOWS }, payload: payload as object })
  return {
    app,
    db,
    google,
    colly,
    async connect() {
      const start = await app.inject({ url: '/api/calendar/connect?client=collylaptop', cookies: colly.cookies })
      const attempt = start.cookies.find((c) => c.name === 'sh_calendar')!
      const { code, state } = google.consent(start.headers.location as string)
      const back = await app.inject({ url: `/api/calendar/callback?code=${code}&state=${state}`, cookies: { ...colly.cookies, sh_calendar: attempt.value } })
      expect(back.headers.location).toBe('/?calendar=connected#account')
    },
    look: (calendarId: string, from = '2031-01-01') => post('/api/calendar/import/look', { calendarId, from }),
    bring: (choices: ImportChoices) => post('/api/calendar/import/bring?client=collylaptop', choices),
    /** Every record the devices have been told of, by kind. */
    async feed() {
      const res = await app.inject({ url: '/api/sync/pull?after=0', cookies: colly.cookies })
      const all = new Map<string, Map<string, unknown>>()
      for (const c of res.json().changes as { entity: string; id: string; op: string; data: unknown }[]) {
        const table = all.get(c.entity) ?? new Map<string, unknown>()
        all.set(c.entity, table)
        if (c.op === 'delete') table.delete(c.id)
        else table.set(c.id, c.data)
      }
      const list = <T>(entity: string) => [...(all.get(entity)?.values() ?? [])] as T[]
      return {
        projects: list<Project>('project'),
        phases: list<Phase>('phase'),
        venues: list<Venue>('venue'),
        people: list<Person>('person'),
        calls: list<CrewCall>('crewCall'),
        offers: list<Offer>('offer'),
      }
    },
  }
}

type Setup = Awaited<ReturnType<typeof setup>>

/** An organiser's calendar as it is today: gigs as all-day events with their crew as guests, and everything else. */
function organisersCalendar(google: FakeGoogle) {
  const nissan = { location: 'Convention Centre Dublin, Spencer Dock, Dublin 1', description: '<b>Access</b> via the Spencer Dock loading bay' }
  const aoife = { email: 'aoife.byrne@gmail.com', displayName: 'Aoife Byrne', responseStatus: 'accepted' as const }
  const room = { email: 'room-1@resource.calendar.google.com', displayName: 'Warehouse room', resource: true }
  return {
    build1: google.add(OPS, { summary: 'Nissan - Build 1/2', days: '2031-03-10', ...nissan, guests: [aoife, { email: 'sean@sessionhire.com' }, room] }),
    build2: google.add(OPS, { summary: 'Nissan - Build 2/2', days: '2031-03-11', ...nissan, guests: [aoife, { email: 'ciara@example.ie', responseStatus: 'declined' }] }),
    show1: google.add(OPS, { summary: 'Nissan - Show Day 1/2', days: '2031-03-12', ...nissan, guests: [aoife, { email: 'hire@stagesupplies.ie', responseStatus: 'accepted' }] }),
    show2: google.add(OPS, { summary: 'Nissan - Show Day 2/ Load Out', days: '2031-03-13', ...nissan, guests: [aoife] }),
    party: google.add(OPS, { summary: 'Christmas party (TBC)', days: '2031-12-12', location: 'The Marker Hotel, Grand Canal Square, Dublin 2' }),
    summit: google.add(OPS, { summary: 'Web Summit', days: ['2031-03-20', '2031-03-21'] }),
    call: google.add(OPS, { summary: 'Call with Nissan', at: '2031-03-06T10:00:00Z' }),
    stock: google.add(OPS, { summary: 'Stock check', days: '2031-03-07' }, { recurringEventId: 'weekly1' }),
    away: google.add(OPS, { summary: 'Out of office', days: '2031-03-08' }, { eventType: 'outOfOffice' }),
    old: google.add(OPS, { summary: 'Old gig - Show', days: '2030-11-20' }),
  }
}

const choose = (preview: ImportPreview, jobs: Record<string, string | false> = {}): ImportChoices => ({
  calendarId: preview.calendar.id,
  from: preview.from,
  jobs: preview.jobs.map((j) => ({ key: j.key, name: typeof jobs[j.name] === 'string' ? (jobs[j.name] as string) : j.name, include: jobs[j.name] !== false })),
  people: preview.people.map((p) => ({ email: p.email, include: p.suggested })),
})

const ok = <T>(res: LightMyRequestResponse): T => {
  expect(res.statusCode, res.body).toBe(200)
  return res.json() as T
}

describe('bringing jobs in from Google Calendar', () => {
  it('lists the calendars the account can see, its own first, without Google’s own', async () => {
    const s = await setup()
    await s.connect()
    s.google.share(OPS, 'aoife@sessionhire.com', 'Aoife Byrne')
    const calendars = ok<{ id: string; name: string }[]>(await s.app.inject({ url: '/api/calendar/import/calendars', cookies: s.colly.cookies }))
    expect(calendars.map((c) => c.name)).toEqual(['ops@sessionhire.com', 'Aoife Byrne', 'Session Hire Gigs', 'Test calendar'])
  })

  it('shows what a calendar holds as jobs, and saves nothing', async () => {
    const s = await setup()
    await s.connect()
    await s.colly.send('person.upsert', { id: 'ciara', name: 'Ciara Walsh', kind: 'freelancer', email: 'ciara@example.ie', phone: null, skills: [], dayRateCents: null, notes: '' })
    organisersCalendar(s.google)
    const preview = ok<ImportPreview>(await s.look(OPS))

    expect(preview).toMatchObject({ calendar: { id: OPS, name: OPS, primary: true }, from: '2031-01-01', to: '2033-03-06', events: 9 })
    expect(preview.jobs.map((j) => ({ name: j.name, status: j.status, phases: j.phases.map((p) => `${p.name} ${p.start} ${p.end}`), venue: j.venue, crew: j.crew }))).toEqual([
      {
        name: 'Nissan',
        status: 'confirmed',
        phases: ['Build 2031-03-10 2031-03-11', 'Show 2031-03-12 2031-03-13', 'Load out 2031-03-13 2031-03-13'],
        venue: { name: 'Convention Centre Dublin', isNew: true },
        crew: { booked: 2, waiting: 1, declined: 1, notInApp: 3 },
      },
      { name: 'Web Summit', status: 'confirmed', phases: ['Show 2031-03-20 2031-03-21'], venue: null, crew: { booked: 0, waiting: 0, declined: 0, notInApp: 0 } },
      {
        name: 'Christmas party',
        status: 'enquiry',
        phases: ['Show 2031-12-12 2031-12-12'],
        venue: { name: 'The Marker Hotel', isNew: true },
        crew: { booked: 0, waiting: 0, declined: 0, notInApp: 0 },
      },
    ])
    expect(preview.jobs[1]!.phases[0]!.guessed).toBe(true)
    expect(preview.people).toEqual([
      { email: 'aoife.byrne@gmail.com', name: 'Aoife Byrne', kind: 'freelancer', suggested: true, jobs: 1 },
      { email: 'sean@sessionhire.com', name: 'Sean', kind: 'staff', suggested: true, jobs: 1 },
      { email: 'hire@stagesupplies.ie', name: 'Hire', kind: 'freelancer', suggested: false, jobs: 1 },
    ])
    expect(preview.leftOut.map((l) => leftOutLabel(l))).toEqual([
      '1 event with a start time (meetings, calls)',
      '1 repeating event (birthdays, reminders)',
      '1 out-of-office or other special event',
    ])
    expect(preview.changed).toEqual([])
    expect((await s.feed()).projects).toEqual([])
    // Read with only what it needs, from the day chosen to two years ahead; nothing written.
    expect(s.google.lists.at(-1)!.get('timeMin')).toBe('2031-01-01T00:00:00Z')
    expect(s.google.lists.at(-1)!.get('timeMax')).toBe('2033-03-06T00:00:00Z')
    expect(s.google.lists.at(-1)!.get('fields')).not.toContain('conferenceData')
    expect(s.google.writes).toEqual([])
  })

  it('brings in what was ticked, under the names given, in one go, and the calendar sync leaves it alone', async () => {
    const s = await setup()
    await s.connect()
    await s.colly.send('person.upsert', { id: 'ciara', name: 'Ciara Walsh', kind: 'freelancer', email: 'ciara@example.ie', phone: null, skills: [], dayRateCents: null, notes: '' })
    organisersCalendar(s.google)
    const preview = ok<ImportPreview>(await s.look(OPS))
    const result = ok<ImportResult>(await s.bring(choose(preview, { 'Web Summit': false, 'Christmas party': 'EY Christmas party' })))
    expect(result).toEqual({ jobs: 2, added: 0, days: 6, venues: 2, people: 2, crew: 5, missing: [] })

    const f = await s.feed()
    const nissan = f.projects.find((p) => p.name === 'Nissan')!
    const party = f.projects.find((p) => p.name === 'EY Christmas party')!
    expect(nissan).toMatchObject({ status: 'confirmed', sourceCalendar: OPS, notes: 'Access via the Spencer Dock loading bay' })
    expect(party).toMatchObject({ status: 'enquiry', sourceCalendar: OPS })
    expect(f.venues.map((v) => [v.name, v.address]).sort()).toEqual([
      ['Convention Centre Dublin', 'Convention Centre Dublin, Spencer Dock, Dublin 1'],
      ['The Marker Hotel', 'The Marker Hotel, Grand Canal Square, Dublin 2'],
    ])
    expect(nissan.venueId).toBe(f.venues.find((v) => v.name === 'Convention Centre Dublin')!.id)
    expect(f.phases.filter((p) => p.projectId === nissan.id).map((p) => `${p.name} ${p.start} ${p.end}`)).toEqual([
      'Build 2031-03-10 2031-03-11',
      'Show 2031-03-12 2031-03-13',
      'Load out 2031-03-13 2031-03-13',
    ])
    expect(f.people.map((p) => [p.name, p.kind, p.email, p.notes]).sort()).toEqual([
      ['Aoife Byrne', 'freelancer', 'aoife.byrne@gmail.com', 'Added from the guests on Google Calendar.'],
      ['Ciara Walsh', 'freelancer', 'ciara@example.ie', ''],
      ['Sean', 'staff', 'sean@sessionhire.com', 'Added from the guests on Google Calendar.'],
    ])

    // A crew call per phase, for as many as were on its busiest day; a Yes is booked, no answer is offered, a No declined.
    const name = (id: string) => f.people.find((p) => p.id === id)!.name
    const crew = f.calls
      .filter((c) => c.projectId === nissan.id)
      .map((c) => ({
        phase: c.phase,
        role: c.role,
        needed: c.needed,
        days: `${c.start} ${c.end}`,
        offers: f.offers
          .filter((o) => o.callId === c.id)
          .map((o) => `${name(o.personId)} ${o.status} ${o.days.join(' ')}`)
          .sort(),
      }))
    expect(crew).toEqual([
      {
        phase: 'Build',
        role: 'Crew',
        needed: 2,
        days: '2031-03-10 2031-03-11',
        offers: ['Aoife Byrne confirmed 2031-03-10 2031-03-11', 'Ciara Walsh declined 2031-03-11', 'Sean offered 2031-03-10'],
      },
      { phase: 'Show', role: 'Crew', needed: 1, days: '2031-03-12 2031-03-13', offers: ['Aoife Byrne confirmed 2031-03-12 2031-03-13'] },
      { phase: 'Load out', role: 'Crew', needed: 1, days: '2031-03-13 2031-03-13', offers: ['Aoife Byrne confirmed 2031-03-13'] },
    ])
    expect(f.offers.find((o) => o.status === 'confirmed')!.respondedVia).toBe('calendar')

    // The history says who did it and how much came in.
    const history = await s.colly.history()
    expect(history.entries[0]!.what).toBe(
      'Brought in 2 jobs from ops@sessionhire.com on Google Calendar: 6 days, 5 crew bookings and offers, 2 new people and 2 new venues'
    )
    expect(history.entries[0]!.who.name).toBe('Colly Hewson')

    // Choosing a calendar for jobs doesn't put these on it too: they're on the organiser's already.
    const use = await s.app.inject({ method: 'POST', url: '/api/calendar/use', cookies: s.colly.cookies, payload: { calendarId: TEST_CAL } })
    expect(use.statusCode).toBe(200)
    await s.app.calendar!.run()
    expect(s.google.visible(TEST_CAL)).toEqual([])
    expect(s.google.writes).toEqual([])

    // And the export has what was brought in from where.
    const everything = everythingJson(await readEverything(s.db)) as Record<string, unknown>
    expect(everything.calendar_imports).toHaveLength(5)
  })

  it('shows only what is new when looking again, adds new days to jobs brought in before, and lists events moved or deleted since', async () => {
    const s = await setup()
    await s.connect()
    const cal = organisersCalendar(s.google)
    ok(await s.bring(choose(ok<ImportPreview>(await s.look(OPS)), { 'Web Summit': false })))

    s.google.add(OPS, { summary: 'Nissan - Load Out 2/2', days: '2031-03-14' })
    s.google.move(OPS, cal.party.id, '2031-12-13')
    s.google.edit(OPS, cal.show1.id, { status: 'cancelled' })
    const again = ok<ImportPreview>(await s.look(OPS))
    expect(again.jobs.map((j) => [j.name, j.adds?.name ?? null, j.phases.map((p) => `${p.name} ${p.start}${p.extends ? ' (more days)' : ''}`)])).toEqual([
      ['Nissan', 'Nissan', ['Load out 2031-03-14 (more days)']],
      ['Web Summit', null, ['Show 2031-03-20']],
    ])
    expect(again.leftOut.find((l) => l.reason === 'before')!.count).toBe(4)
    expect(again.changed.map((c) => [c.job, c.title, c.was.join(' '), c.now.join(' ')])).toEqual([
      ['Nissan', 'Nissan - Show Day 1/2', '2031-03-12', ''],
      ['Christmas party', 'Christmas party (TBC)', '2031-12-12', '2031-12-13'],
    ])

    const result = ok<ImportResult>(await s.bring(choose(again, { 'Web Summit': false })))
    expect(result).toMatchObject({ jobs: 0, added: 1, days: 1 })
    const f = await s.feed()
    const nissan = f.projects.find((p) => p.name === 'Nissan')!
    expect(f.phases.filter((p) => p.projectId === nissan.id).map((p) => `${p.name} ${p.start} ${p.end}`)).toContain('Load out 2031-03-13 2031-03-14')
    expect(f.projects).toHaveLength(2)
    expect((await s.colly.history()).entries[0]!.what).toBe('Brought in more days for 1 job from ops@sessionhire.com on Google Calendar: 1 day')
  })

  it('reads a colleague’s calendar shared with the account, and knows events it has already brought in from another', async () => {
    const s = await setup()
    await s.connect()
    const shared = 'aoife@sessionhire.com'
    s.google.share(OPS, shared, 'Aoife Byrne')
    const mine = s.google.add(OPS, { summary: 'Nissan - Build', days: '2031-03-10', guests: [{ email: shared }] })
    // The same event, on the guest's calendar.
    s.google.add(shared, { summary: 'Nissan - Build', days: '2031-03-10' }, { iCalUID: mine.iCalUID })
    s.google.add(shared, { summary: 'Aviva - Babysit', days: '2031-04-02' })
    ok(await s.bring(choose(ok<ImportPreview>(await s.look(OPS)))))

    const theirs = ok<ImportPreview>(await s.look(shared))
    expect(theirs.calendar).toEqual({ id: shared, name: 'Aoife Byrne', primary: false })
    expect(theirs.jobs.map((j) => j.name)).toEqual(['Aviva'])
    expect(theirs.leftOut.map((l) => leftOutLabel(l))).toEqual(['1 event brought in before'])
    expect(theirs.changed).toEqual([])
  })

  it('says why it can’t, when it can’t', async () => {
    const off = await setup({ calendar: false })
    expect((await off.app.inject({ url: '/api/calendar/import/calendars', cookies: off.colly.cookies })).json().error).toBe(
      'Google Calendar needs the Google key on the server first.'
    )

    const s = await setup()
    expect((await s.look(OPS)).json().error).toBe('Connect a Google account first.')
    await s.connect()
    expect((await s.look('someone-else@sessionhire.com')).json().error).toMatch(/can't see that calendar/)
    expect((await s.look(OPS, '2020-01-01')).json().error).toBe('Jobs can be brought in from at most 5 years back.')
    expect((await s.look(OPS, '2031-02-30')).statusCode).toBe(400)
    const preview = ok<ImportPreview>(await s.look(OPS))
    expect((await s.bring({ ...choose(preview), jobs: [] })).json().error).toBe('Tick at least one job to bring in.')
    s.google.apiEnabled = false
    expect((await s.look(OPS)).json().error).toMatch(/Calendar API is switched off/)
    // Not signed in: no access at all.
    expect((await s.app.inject({ method: 'POST', url: '/api/calendar/import/look', payload: { calendarId: OPS, from: '2031-01-01' } })).statusCode).toBe(401)
  })

  it('reports jobs that went from the calendar between looking and bringing in', async () => {
    const s = await setup()
    await s.connect()
    const cal = organisersCalendar(s.google)
    const preview = ok<ImportPreview>(await s.look(OPS))
    s.google.edit(OPS, cal.summit.id, { status: 'cancelled' })
    const result = ok<ImportResult>(await s.bring(choose(preview, { Nissan: false, 'Christmas party': false })))
    expect(result).toEqual({ jobs: 0, added: 0, days: 0, venues: 0, people: 0, crew: 0, missing: ['Web Summit'] })
    expect((await s.colly.history()).entries.map((e) => e.command)).not.toContain('calendar.import')
  })
})
