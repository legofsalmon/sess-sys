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
import { PERSON_NOTE, TAKE_BACK_ACTION } from '../src/calendar/import.ts'
import { isMailbox, nameFromEmail, nameKey, parseTitle, planImport, plainText, type AppData, type SourceEvent } from '../src/calendar/import-plan.ts'
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
    return `${p.job} | ${p.phases.join(' + ')}${p.note ? ` "${p.note}"` : ''}${p.guessed ? ' (guessed)' : ''}${p.pencilled ? ' (pencilled)' : ''}${p.kind === 'gig' ? '' : ` [${p.kind}]`}`
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

  it('keep what follows a phase word as a note, and take a phase at the end of a name (ADR 0037)', () => {
    expect(t('WL - Malahide Build 4/9 & Client Walk Through')).toBe('WL - Malahide | Build "Client Walk Through"')
    expect(t('WL - Fota Build 7/7 & Final Changes')).toBe('WL - Fota | Build "Final Changes"')
    expect(t('Mansion House - Load Out PA')).toBe('Mansion House | Load out "PA"')
    expect(t('Mansion House - Launch Event')).toBe('Mansion House | Show')
    expect(t('Coca Cola Truck - Live RDS')).toBe('Coca Cola Truck | Show "RDS"')
    expect(t("St. Patrick's Cathedral Install")).toBe("St. Patrick's Cathedral | Build")
    expect(t('Back 2 Basics Gym installation')).toBe('Back 2 Basics Gym | Build')
    // A note is a few words; more than that is the job's name.
    expect(t('Nissan - Show scope changes and more words than a note has here')).toBe('Nissan - Show scope changes and more words than a note has here | Show (guessed)')
    expect(t('Nissan - Client & Build')).toBe('Nissan - Client | Build')
    expect(t('Dan daly fit out in Back to basics meeting 3.45')).toBe('Dan daly fit out in Back to basics meeting 3.45 | Meeting (guessed) [meeting]')
  })

  it('say what kind of job a name is: a hire, an errand or a meeting is not a gig (ADR 0037)', () => {
    expect(t('Murt lx hire')).toBe('Murt lx hire | Hire (guessed) [hire]')
    expect(t('Show scope drape rental')).toBe('Show scope drape rental | Hire (guessed) [hire]')
    expect(t('Bold Frontiers Dry hire')).toBe('Bold Frontiers Dry hire | Hire (guessed) [hire]')
    expect(t('Davin lx hire - Load out')).toBe('Davin lx hire | Load out [hire]')
    expect(t('Collect Screwfix')).toBe('Collect Screwfix | Errand (guessed) [errand]')
    expect(t('Return PSI Truss Adapters')).toBe('Return PSI Truss Adapters | Errand (guessed) [errand]')
    expect(t('Ryder Cup Meeting')).toBe('Ryder Cup Meeting | Meeting (guessed) [meeting]')
    expect(t('Site visit Ryder cup')).toBe('Site visit Ryder cup | Meeting (guessed) [meeting]')
    expect(t('Session Hire Christmas party')).toBe('Session Hire Christmas party | Show (guessed)')
    // A phase word is still a phase of a gig: a collection after " - " is its Load out.
    expect(t('Nissan - Collection')).toBe('Nissan | Load out')
  })

  it("make a department's day after \" - \" a day of the job, not a job of its own (ADR 0050)", () => {
    expect(t('EP - Smirnoff LX')).toBe('EP | Smirnoff LX')
    expect(t('EP - Audio')).toBe('EP | Audio')
    expect(t('District X - Video D8 Upstage')).toBe('District X | Video D8 Upstage')
    expect(t('ATN - LX Stage 1, 2 & 3')).toBe('ATN | LX Stage 1, 2 & 3')
    // Not a department: still a job of its own, for the Tidy up page to offer to put together.
    expect(t('Sreenath - CCD')).toBe('Sreenath - CCD | Show (guessed)')
    expect(t('Coca Cola Truck - Install')).toBe('Coca Cola Truck | Build')
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

  it('know a company mailbox from a person', () => {
    expect(['info@sessionhire.com', 'Accounts@example.ie', 'hire@stagesupplies.ie', 'no-reply@x.com'].map(isMailbox)).toEqual([true, true, true, true])
    expect(['aoife.byrne@gmail.com', 'sean@sessionhire.com', 'hired.hands@gmail.com'].map(isMailbox)).toEqual([false, false, false])
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
  const opts = { account: 'ops@sessionhire.com', calendarId: 'ops@sessionhire.com', from: '2031-01-01', to: '2033-01-01', today: '2031-03-05' }
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
        { id: 'j1', name: 'Web Summit', status: 'confirmed', kind: 'gig', venueId: null, sourceCalendar: null, phases: [{ id: 'p1', name: 'Show', start: '2031-03-20', end: '2031-03-21' }] },
        { id: 'j2', name: 'EY Awards', status: 'cancelled', kind: 'gig', venueId: null, sourceCalendar: null, phases: [{ id: 'p2', name: 'Show', start: '2031-05-01', end: '2031-05-01' }] },
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
        // Kept with a space, as an older version could: still her (audit finding 12).
        { id: 'p1', name: 'Ciara Walsh', email: ' Ciara@example.ie' },
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
    ])
    // A company's mailbox is never crew: it's noted on the phase for anyone looking.
    expect(plan.jobs[0]!.runs[0]!.notes).toBe('Also on the invite: Stage Supplies')
    expect(plan.people).toEqual([
      { email: 'aoife.byrne@gmail.com', name: 'Aoife Byrne', kind: 'freelancer', suggested: true, needsName: true, jobs: 1 },
      { email: 'sean@sessionhire.com', name: 'Seán Óg', kind: 'staff', suggested: true, needsName: false, jobs: 1 },
    ])
    // The office can give a name as it will show; a person's own address is suggested only once they're on a gig.
    const named = planImport([ev('Gig - Show', '2031-06-01', { guests }), ev('Client meeting', '2031-06-02', { guests: [{ email: 'client@gmail.com', name: null, answer: 'accepted', notCrew: false }] })], app, {
      ...opts,
    }, { names: new Map(), include: new Set(['gig|2031-06-01', 'client meeting|2031-06-02']), people: new Map([['aoife.byrne@gmail.com', 'Aoife Ní Bhriain']]) })
    expect(named.people.map((p) => [p.name, p.suggested, p.needsName])).toEqual([
      ['Aoife Ní Bhriain', true, false],
      ['Seán Óg', true, false],
      ['Client', false, true],
    ])
  })

  it('brings a hire, an errand or a meeting in with no crew, naming the invited in the notes, unless the office says it is a gig (ADR 0037)', () => {
    const guests = [
      { email: 'aoife.byrne@gmail.com', name: 'Aoife Byrne', answer: 'accepted' as const, notCrew: false },
      { email: 'sean@sessionhire.com', name: null, answer: 'needsAction' as const, notCrew: false },
    ]
    const events = [ev('Murt lx hire', ['2031-06-01', '2031-06-03'], { guests }), ev('Collect Screwfix', '2031-06-02', { guests }), ev('Ryder Cup Meeting', '2031-06-04', { guests })]
    const plan = planImport(events, empty, opts)
    expect(plan.jobs.map((j) => [j.name, j.kind, j.runs.map((r) => `${r.name} ${r.crew.length} crew: ${r.notes}`)])).toEqual([
      ['Murt lx hire', 'hire', ['Hire 0 crew: On the invite: Aoife Byrne, Sean']],
      ['Collect Screwfix', 'errand', ['Errand 0 crew: On the invite: Aoife Byrne, Sean']],
      ['Ryder Cup Meeting', 'meeting', ['Meeting 0 crew: On the invite: Aoife Byrne, Sean']],
    ])
    // Nobody is suggested for the crew list from a hire alone; Sean is staff, so always.
    expect(plan.people.map((p) => [p.name, p.suggested])).toEqual([['Sean', true], ['Aoife Byrne', false]])

    const gig = planImport(events, empty, opts, { names: new Map(), kinds: new Map([[plan.jobs[0]!.key, 'gig']]), include: new Set(plan.jobs.map((j) => j.key)) })
    expect(gig.jobs[0]).toMatchObject({ name: 'Murt lx hire', kind: 'gig' })
    expect(gig.jobs[0]!.runs.map((r) => `${r.name} ${r.crew.length} crew: ${r.notes}`)).toEqual(['Show 2 crew: '])
    expect(gig.jobs[1]!.kind).toBe('errand')
  })

  it('treats days gone as the record of who worked: a Yes is a booking, the rest is noted, not offered (ADR 0037)', () => {
    const guests = [
      { email: 'aoife.byrne@gmail.com', name: 'Aoife Byrne', answer: 'accepted' as const, notCrew: false },
      { email: 'dara@gmail.com', name: 'Dara Walsh', answer: 'needsAction' as const, notCrew: false },
      { email: 'niall@gmail.com', name: 'Niall Kerr', answer: 'declined' as const, notCrew: false },
    ]
    const plan = planImport([ev('Gig - Show', ['2031-03-03', '2031-03-04'], { guests }), ev('Gig - Load out', '2031-03-05', { guests })], empty, opts)
    const runs = plan.jobs[0]!.runs
    expect(runs.map((r) => [r.name, r.crew.map((c) => `${'email' in c.person ? c.person.email : c.person.id} ${JSON.stringify(c.answers)}`)])).toEqual([
      ['Show', ['aoife.byrne@gmail.com {"2031-03-03":"accepted","2031-03-04":"accepted"}']],
      // Today is still to come: everyone's answer stands.
      ['Load out', ['aoife.byrne@gmail.com {"2031-03-05":"accepted"}', 'dara@gmail.com {"2031-03-05":"needsAction"}', 'niall@gmail.com {"2031-03-05":"declined"}']],
    ])
    expect(runs[0]!.noted).toEqual([
      { name: 'Dara Walsh', days: ['2031-03-03', '2031-03-04'], answer: 'none' },
      { name: 'Niall Kerr', days: ['2031-03-03', '2031-03-04'], answer: 'declined' },
    ])
    expect(runs[0]!.notes).toBe('No answer on the invite: Dara Walsh (Mon 3 Mar to Tue 4 Mar)\n\nSaid no: Niall Kerr (Mon 3 Mar to Tue 4 Mar)')
    expect(runs[1]!.notes).toBe('')
  })

  it('puts the crew of a day naming two phases on the first phase only (ADR 0037)', () => {
    const guests = [{ email: 'aoife.byrne@gmail.com', name: 'Aoife Byrne', answer: 'accepted' as const, notCrew: false }]
    const plan = planImport([ev('Nissan - Show Day 1/2', '2031-06-01', { guests }), ev('Nissan - Show Day 2/ Load Out', '2031-06-02', { guests })], empty, opts)
    expect(plan.jobs[0]!.runs.map((r) => `${r.name} ${r.days.join(' ')}: ${r.crew.length} crew`)).toEqual(['Show 2031-06-01 2031-06-02: 1 crew', 'Load out 2031-06-02: 0 crew'])
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
      expect(back.headers.location).toBe('/?calendar=connected#admin/connections')
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
        crew: { booked: 1, waiting: 1, declined: 1, notInApp: 2, noted: 0 },
      },
      { name: 'Web Summit', status: 'confirmed', phases: ['Show 2031-03-20 2031-03-21'], venue: null, crew: { booked: 0, waiting: 0, declined: 0, notInApp: 0, noted: 0 } },
      {
        name: 'Christmas party',
        status: 'enquiry',
        phases: ['Show 2031-12-12 2031-12-12'],
        venue: { name: 'The Marker Hotel', isNew: true },
        crew: { booked: 0, waiting: 0, declined: 0, notInApp: 0, noted: 0 },
      },
    ])
    expect(preview.jobs.map((j) => j.kind)).toEqual(['gig', 'gig', 'gig'])
    expect(preview.jobs[1]!.phases[0]!.guessed).toBe(true)
    // The supplier's hire@ mailbox is never crew.
    expect(preview.people).toEqual([
      { email: 'aoife.byrne@gmail.com', name: 'Aoife Byrne', kind: 'freelancer', suggested: true, needsName: false, jobs: 1 },
      { email: 'sean@sessionhire.com', name: 'Sean', kind: 'staff', suggested: true, needsName: true, jobs: 1 },
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
    const choices = choose(preview, { 'Web Summit': false, 'Christmas party': 'EY Christmas party' })
    // The office gives Sean his name as it will show.
    choices.people = choices.people.map((p) => (p.email === 'sean@sessionhire.com' ? { ...p, name: 'Seán Mac Aodha' } : p))
    const result = ok<ImportResult>(await s.bring(choices))
    expect(result).toEqual({ jobs: 2, added: 0, days: 6, venues: 2, people: 2, crew: 4, missing: [] })

    const f = await s.feed()
    const nissan = f.projects.find((p) => p.name === 'Nissan')!
    const party = f.projects.find((p) => p.name === 'EY Christmas party')!
    expect(nissan).toMatchObject({ status: 'confirmed', kind: 'gig', sourceCalendar: OPS, notes: 'Access via the Spencer Dock loading bay' })
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
      ['Seán Mac Aodha', 'staff', 'sean@sessionhire.com', 'Added from the guests on Google Calendar.'],
    ])
    // The supplier on the Show's invite is noted on the phase.
    expect(f.phases.find((p) => p.projectId === nissan.id && p.name === 'Show')!.notes).toBe('Also on the invite: hire@stagesupplies.ie')

    // A crew call per phase, for as many as were on its busiest day; a Yes is booked, no answer is offered, a No declined.
    // The day naming Show and Load out puts its crew on the Show, so the Load out needs no call.
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
        offers: ['Aoife Byrne confirmed 2031-03-10 2031-03-11', 'Ciara Walsh declined 2031-03-11', 'Seán Mac Aodha offered 2031-03-10'],
      },
      { phase: 'Show', role: 'Crew', needed: 1, days: '2031-03-12 2031-03-13', offers: ['Aoife Byrne confirmed 2031-03-12 2031-03-13'] },
    ])
    expect(f.offers.find((o) => o.status === 'confirmed')!.respondedVia).toBe('calendar')

    // The history says who did it and how much came in.
    const history = await s.colly.history()
    expect(history.entries[0]!.what).toBe(
      'Brought in 2 jobs from ops@sessionhire.com on Google Calendar, from 1 Jan 2031: 6 days, 4 crew bookings and offers, 2 new people and 2 new venues. Left out: 1 event with a start time (meetings, calls), 1 repeating event (birthdays, reminders) and 1 out-of-office or other special event'
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

  it('brings each event in once when two people bring the same calendar in at once', async () => {
    // Proves (audit finding 7): planning outside the write lock doesn't let two bring-ins both save the same jobs; the one
    // that finds the app changed by the other once it has the lock plans again, and has nothing left to bring.
    const s = await setup()
    await s.connect()
    organisersCalendar(s.google)
    const choices = choose(ok<ImportPreview>(await s.look(OPS)), { 'Web Summit': false })
    const both = (await Promise.all([s.bring(choices), s.bring(choices)])).map((r) => ok<ImportResult>(r))
    expect(both.map((r) => r.jobs).sort()).toEqual([0, 2])
    const f = await s.feed()
    expect(f.projects.map((p) => p.name).sort()).toEqual(['Christmas party', 'Nissan'])
    const phases = f.phases.map((p) => `${p.projectId} ${p.name} ${p.start}`)
    expect(new Set(phases).size).toBe(phases.length)
    expect(f.calls.filter((c) => c.phase === 'Build')).toHaveLength(1)
  })

  it('writes forty new people and venues in a few statements, not several each, while it holds the write lock', async () => {
    // Proves (audit, 20 October 2026, finding 17): new people and venues are written in bulk like the jobs, so a season
    // with many of both holds the lock every device's change waits for about as long as one whose people are known.
    const s = await setup()
    await s.connect()
    for (let i = 0; i < 40; i++)
      s.google.add(OPS, {
        summary: `Gig ${i} - Show`,
        days: `2031-04-${String((i % 28) + 1).padStart(2, '0')}`,
        location: `Hall ${i}, Main Street, Town ${i}`,
        guests: [{ email: `crew${i}@gmail.com`, displayName: `Crew Member${i}`, responseStatus: 'accepted' }],
      })
    const preview = ok<ImportPreview>(await s.look(OPS))
    expect(preview.people).toHaveLength(40)
    const choices = { ...choose(preview), people: preview.people.map((p) => ({ email: p.email, include: true })) }
    let statements = 0
    const transaction = s.db.transaction.bind(s.db)
    s.db.transaction = (fn) => transaction((tx) => fn({ ...tx, query: (sql, params) => (statements++, tx.query(sql, params)) }))
    expect(ok<ImportResult>(await s.bring(choices))).toMatchObject({ jobs: 40, venues: 40, people: 40, crew: 40 })
    expect(statements).toBeLessThan(40)

    const f = await s.feed()
    const crew = f.people.filter((p) => p.notes === PERSON_NOTE)
    expect(crew).toHaveLength(40)
    // Each as the command makes someone new: the name in two, a private link of their own, the usual level.
    expect(crew.find((p) => p.email === 'crew7@gmail.com')).toMatchObject({ name: 'Crew Member7', firstName: 'Crew', lastName: 'Member7', kind: 'freelancer', skills: [], level: 1 })
    expect(new Set(crew.map((p) => p.linkToken)).size).toBe(40)
    expect(f.venues.find((v) => v.name === 'Hall 7')).toMatchObject({ address: 'Hall 7, Main Street, Town 7', notes: '' })
    expect(f.projects.find((p) => p.name === 'Gig 7')!.venueId).toBe(f.venues.find((v) => v.name === 'Hall 7')!.id)
  })

  it('gives each call the department most of its people are in, or none to give it later (ADR 0046)', async () => {
    const s = await setup()
    await s.connect()
    await s.colly.send('person.upsert', { id: 'aoife', name: 'Aoife Byrne', kind: 'freelancer', email: 'aoife.byrne@gmail.com', phone: null, skills: [], dayRateCents: null, notes: '', department: 'LX' })
    organisersCalendar(s.google)
    ok<ImportResult>(await s.bring(choose(ok<ImportPreview>(await s.look(OPS)), { 'Web Summit': false })))
    const f = await s.feed()
    const nissan = f.projects.find((p) => p.name === 'Nissan')!
    // The Show is Aoife's alone, and she's in LX; the Build is hers, Seán's and Ciara's, in no one department.
    expect(f.calls.filter((c) => c.projectId === nissan.id).map((c) => [c.phase, c.department])).toEqual([
      ['Build', null],
      ['Show', 'LX'],
    ])
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
    expect((await s.colly.history()).entries[0]!.what).toBe('Brought in more days for 1 job from ops@sessionhire.com on Google Calendar, from 1 Jan 2031: 1 day. Left out: 1 event with a start time (meetings, calls), 1 repeating event (birthdays, reminders) and 1 out-of-office or other special event')
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

  it('brings in an event whose title, place and notes carry control characters, as pasted from Word, cleaned', async () => {
    // Proves: a NUL, which the database can't hold, and a vertical tab (Word's line break) typed into an event in Google don't
    // fail bringing it in: they're cleaned as the app cleans typed text, so the preview shows the job as it comes in.
    const s = await setup()
    await s.connect()
    s.google.add(OPS, { summary: 'Aviva\u0000 - Build', days: '2031-04-02', location: 'Aviva Stadium\u0000, Lansdowne Road, Dublin 4', description: 'Load in\u000bvia the north gate' })
    const preview = ok<ImportPreview>(await s.look(OPS))
    expect(preview.jobs.map((j) => [j.name, j.venue?.name])).toEqual([['Aviva', 'Aviva Stadium']])
    ok(await s.bring(choose(preview)))
    const f = await s.feed()
    expect(f.projects.map((p) => p.name)).toEqual(['Aviva'])
    expect(f.venues.map((v) => [v.name, v.address])).toEqual([['Aviva Stadium', 'Aviva Stadium, Lansdowne Road, Dublin 4']])
    expect(JSON.stringify(f)).toContain('Load in\\nvia the north gate')
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

  it('takes back everything brought in, so it can be brought in again, unless someone has acted on it since (ADR 0037)', async () => {
    const s = await setup()
    await s.connect()
    await s.colly.send('person.upsert', { id: 'ciara', name: 'Ciara Walsh', kind: 'freelancer', email: 'ciara@example.ie', phone: null, skills: [], dayRateCents: null, notes: '' })
    organisersCalendar(s.google)
    const preview = ok<ImportPreview>(await s.look(OPS))
    ok<ImportResult>(await s.bring(choose(preview)))
    const brought = () => s.app.inject({ url: '/api/calendar/import/brought', cookies: s.colly.cookies })
    expect(ok(await brought())).toEqual({ jobs: 3, days: 8, crew: 4, people: 2, calendars: [OPS], blocked: null })

    // Sean answers in the app, so the bring-in can't be taken back as a whole any more: his answer would go with it.
    const before = await s.feed()
    const aoife = before.people.find((p) => p.name === 'Aoife Byrne')!
    const sean = before.people.find((p) => p.email === 'sean@sessionhire.com')!
    const seansOffer = before.offers.find((o) => o.personId === sean.id)!
    await s.colly.send('offer.respond', { id: seansOffer.id, answer: 'decline', note: '' })
    const blocked = ok<{ blocked: string }>(await brought())
    expect(blocked.blocked).toBe("These jobs have been worked on in the app since (answers to offers), so they can't be taken back as a whole.")
    const refused = await s.app.inject({ method: 'POST', url: '/api/calendar/import/take-back?client=collylaptop', cookies: s.colly.cookies, headers: { 'user-agent': WINDOWS } })
    expect(refused.statusCode).toBe(409)
    // Had the No come from the calendar instead, it would be the bring-in's own, and go with it.
    await s.db.query(`UPDATE offers SET responded_via = 'calendar' WHERE id = $1`, [seansOffer.id])

    const taken = ok<{ jobs: number; days: number; crew: number; people: number; calendars: string[] }>(
      await s.app.inject({ method: 'POST', url: '/api/calendar/import/take-back?client=collylaptop', cookies: s.colly.cookies, headers: { 'user-agent': WINDOWS } })
    )
    expect(taken).toEqual({ jobs: 3, days: 8, crew: 4, people: 2, calendars: [OPS] })
    const f = await s.feed()
    expect(f.projects).toEqual([])
    expect(f.phases).toEqual([])
    expect(f.calls).toEqual([])
    expect(f.offers).toEqual([])
    expect(f.people.map((p) => p.name)).toEqual(['Ciara Walsh'])
    expect(f.venues).toHaveLength(2)
    expect(aoife.notes).toBe(PERSON_NOTE)
    const history = await s.colly.history()
    expect(history.entries[0]!.what).toBe('Took back everything brought in from Google Calendar, to bring it in again: 3 jobs, 8 days, 4 crew bookings and offers and 2 people added from the invites')
    expect(history.entries[0]!.command).toBe(TAKE_BACK_ACTION)
    expect(ok(await brought())).toEqual({ jobs: 0, days: 0, crew: 0, people: 0, calendars: [], blocked: null })

    // And the calendar can be brought in again, whole.
    const again = ok<ImportPreview>(await s.look(OPS))
    expect(again.jobs.map((j) => j.name)).toEqual(['Nissan', 'Web Summit', 'Christmas party'])
    expect(again.leftOut.map((l) => l.reason)).not.toContain('before')
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
