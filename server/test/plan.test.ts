import {
  addMonths,
  initials,
  isDay,
  MemoryStorage,
  monthLabel,
  monthOf,
  mondayOf,
  newId,
  phaseCode,
  plan,
  SyncClient,
  weekOf,
  type CallView,
  type CommandInput,
  type CommandName,
  type CrewView,
  type MutationResult,
  type PersonView,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type Transport,
} from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb } from '../src/db.ts'

/**
 * The planner (ADR 0010), worked out on a device from what the server has
 * sent it: a week by job and by person, with the crew still needed and the
 * clashes to sort out.
 */

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

async function server() {
  const db = await pgliteDb()
  const app = await buildApp({ db })
  cleanup.push(async () => {
    await app.close()
    await db.close()
  })
  return app
}

async function send<N extends CommandName>(app: FastifyInstance, name: N, args: CommandInput<N>): Promise<MutationResult> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    payload: { clientId: 'ops-laptop', mutations: [{ id: newId(), name, args, createdAt: new Date().toISOString() }] },
  })
  const result: MutationResult = res.json().results[0]
  expect(result.status === 'rejected' ? result.reason.message : result.status).toBe('applied')
  return result
}

/** What an office laptop holds once it has synced. */
async function synced(app: FastifyInstance) {
  const transport: Transport = {
    async push(req: PushRequest): Promise<PushResponse> {
      return (await app.inject({ method: 'POST', url: '/api/sync/push', payload: req })).json()
    },
    async pull(after: number): Promise<PullResponse> {
      return (await app.inject({ method: 'GET', url: `/api/sync/pull?after=${after}` })).json()
    },
  }
  const client = await new SyncClient({ storage: new MemoryStorage(), transport }).open()
  await client.sync()
  return client.view()
}

// The first week of March 2031: Monday 3 to Sunday 9.
const [MON, TUE, WED, THU, FRI] = weekOf('2031-03-05')

async function job(app: FastifyInstance, name: string, status: CommandInput<'project.create'>['status'], phases: [string, string, string][]) {
  const id = newId()
  await send(app, 'project.create', { id, name, clientId: null, venueId: null, status, notes: '' })
  const ids: Record<string, string> = {}
  for (const [phase, start, end] of phases) {
    ids[phase] = newId()
    await send(app, 'phase.add', { id: ids[phase], projectId: id, name: phase, start, end, venueId: null, notes: '' })
  }
  return { id, phases: ids }
}

async function crew(app: FastifyInstance, over: Partial<CommandInput<'call.create'>> & Pick<CommandInput<'call.create'>, 'start' | 'end'>) {
  const id = newId()
  await send(app, 'call.create', {
    id,
    project: 'As typed',
    phase: '',
    venue: '',
    role: 'Audio tech',
    callTime: null,
    needed: 1,
    dayRateCents: 25000,
    details: '',
    replyBy: null,
    ...over,
  })
  return id
}

async function person(app: FastifyInstance, name: string) {
  const id = newId()
  await send(app, 'person.upsert', { id, name, kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '' })
  return id
}

async function offer(app: FastifyInstance, callId: string, personId: string, answer?: 'accept' | 'confirm', override = false) {
  const id = newId()
  await send(app, 'offer.send', { id, callId, personId, override })
  if (answer) await send(app, 'offer.respond', { id, answer: 'accept', days: null, note: '' })
  if (answer === 'confirm') await send(app, 'offer.confirm', { id })
  return id
}

describe('the week by job', () => {
  it('shows each phase-day as the calendar titles it, with how many of its crew are booked', async () => {
    const app = await server()
    const summit = await job(app, 'Web Summit', 'confirmed', [
      ['Build', MON!, TUE!],
      ['Show', WED!, WED!],
    ])
    const picnic = await job(app, 'Electric Picnic', 'quoted', [['Prep', THU!, THU!]])
    await job(app, 'Nissan launch', 'cancelled', [['Build', MON!, MON!]])
    const build = await crew(app, { phaseId: summit.phases.Build!, start: MON!, end: TUE!, needed: 2 })
    await crew(app, { phaseId: summit.phases.Show!, start: WED!, end: WED!, role: 'LX op' })
    await crew(app, { project: 'Corporate gig', role: 'Stage hand', start: FRI!, end: FRI! })
    await offer(app, build, await person(app, 'Aoife Byrne'), 'confirm')
    await offer(app, build, await person(app, 'Conor Walsh'))

    const week = plan(await synced(app), weekOf(WED!))
    expect(week.days).toEqual(['2031-03-03', '2031-03-04', '2031-03-05', '2031-03-06', '2031-03-07', '2031-03-08', '2031-03-09'])
    // The cancelled job isn't there; crew asked for outside Jobs get a row by the name typed.
    expect(week.jobs.map((l) => [l.name, l.status, l.tentative])).toEqual([
      ['Web Summit', 'confirmed', false],
      ['Electric Picnic', 'quoted', true],
      ['Corporate gig', null, false],
    ])
    const [s, p, gig] = week.jobs
    expect(s!.jobId).toBe(summit.id)
    expect(s!.days).toEqual({
      [MON!]: { phases: [{ name: 'Build', label: 'Build 1/2' }], needed: 2, booked: 1, asked: 1, stray: false },
      [TUE!]: { phases: [{ name: 'Build', label: 'Build 2/2' }], needed: 2, booked: 1, asked: 1, stray: false },
      [WED!]: { phases: [{ name: 'Show', label: 'Show' }], needed: 1, booked: 0, asked: 0, stray: false },
    })
    expect(p!.jobId).toBe(picnic.id)
    expect(p!.days).toEqual({ [THU!]: { phases: [{ name: 'Prep', label: 'Prep' }], needed: 0, booked: 0, asked: 0, stray: false } })
    expect(gig!.jobId).toBeNull()
    expect(gig!.days[FRI!]).toMatchObject({ phases: [{ label: 'Stage hand' }], needed: 1, booked: 0 })
    // Monday and Tuesday of the build, the show, and the gig.
    expect(week.short).toBe(4)

    // The week before has nothing on.
    expect(plan(await synced(app), weekOf('2031-02-26'))).toMatchObject({ jobs: [], problems: [], short: 0 })
  })

  it("shows crew left on days a moved phase no longer covers, so it's seen before the day", async () => {
    const app = await server()
    const summit = await job(app, 'Web Summit', 'confirmed', [['Build', MON!, TUE!]])
    await offer(app, await crew(app, { phaseId: summit.phases.Build!, start: MON!, end: TUE! }), await person(app, 'Aoife Byrne'), 'confirm')
    await send(app, 'phase.update', { id: summit.phases.Build!, start: WED!, end: THU! })

    const [lane] = plan(await synced(app), weekOf(MON!)).jobs
    expect(lane!.days[MON!]).toEqual({ phases: [], needed: 1, booked: 1, asked: 0, stray: true })
    expect(lane!.days[WED!]).toEqual({ phases: [{ name: 'Build', label: 'Build 1/2' }], needed: 0, booked: 0, asked: 0, stray: false })
  })
})

describe('the week by person', () => {
  it('says where each person is, and flags who is booked on a day they are marked unavailable', async () => {
    const app = await server()
    const summit = await job(app, 'Web Summit', 'confirmed', [['Build', MON!, TUE!]])
    const picnic = await job(app, 'Electric Picnic', 'confirmed', [['Build', TUE!, TUE!]])
    const build = await crew(app, { phaseId: summit.phases.Build!, start: MON!, end: TUE!, needed: 3 })
    const other = await crew(app, { phaseId: picnic.phases.Build!, start: TUE!, end: TUE!, needed: 2 })
    const [aoife, niamh, conor, dara] = [
      await person(app, 'Aoife Byrne'),
      await person(app, 'Niamh Kelly'),
      await person(app, 'Conor Walsh'),
      await person(app, 'Dara Nolan'),
    ]
    await offer(app, build, aoife, 'confirm')
    // Marked unavailable after she was booked: on her link, or by the office.
    await send(app, 'unavailability.add', { id: newId(), personId: aoife, start: TUE!, end: TUE!, note: 'Dentist' })
    await offer(app, build, niamh, 'accept')
    // Sent despite her booking, with the override the office is asked for.
    await offer(app, other, niamh, undefined, true)
    // Two offers still open on one day are normal while crew are being found.
    await offer(app, build, conor)
    await offer(app, other, conor)
    await send(app, 'unavailability.add', { id: newId(), personId: dara, start: WED!, end: THU!, note: '' })

    const week = plan(await synced(app), weekOf(MON!))
    const row = (id: string) => week.people.find((l) => l.person.id === id)!.days
    expect(row(aoife)[MON!]).toEqual({
      work: [expect.objectContaining({ job: 'Web Summit', phase: 'Build', role: 'Audio tech', booked: true, confirmed: true })],
      away: null,
      problem: null,
      severity: null,
    })
    expect(row(aoife)[TUE!]).toMatchObject({ away: 'Dentist', severity: 'clash', problem: 'Booked on Web Summit but marked unavailable (Dentist)' })
    expect(row(niamh)[TUE!]).toMatchObject({ severity: 'check', problem: 'Offered Electric Picnic while booked on Web Summit' })
    expect(row(niamh)[MON!]!.severity).toBeNull()
    expect(row(conor)[TUE!]).toMatchObject({ work: [{ booked: false }, { booked: false }], severity: null })
    expect(row(dara)).toEqual({ [WED!]: { work: [], away: '', problem: null, severity: null }, [THU!]: { work: [], away: '', problem: null, severity: null } })

    // Clashes first, with the job to open: the booking for a clash, the offer for a check.
    expect(week.problems.map((x) => [x.person.name, x.day, x.severity, x.jobId])).toEqual([
      ['Aoife Byrne', TUE, 'clash', summit.id],
      ['Niamh Kelly', TUE, 'check', picnic.id],
    ])
    // Everyone has a row, busy or not, by name.
    expect(week.people.map((l) => l.person.name)).toEqual(['Aoife Byrne', 'Conor Walsh', 'Dara Nolan', 'Niamh Kelly'])
  })

  it('counts someone booked on two calls on one day as a clash, and leaves out answers that hold nothing', () => {
    // The server refuses such a booking, so this is a device's view made by hand, as one from before that check would be.
    const aoife: PersonView = {
      id: 'p1',
      name: 'Aoife Byrne',
      kind: 'freelancer',
      email: null,
      phone: null,
      skills: [],
      dayRateCents: null,
      notes: '',
      linkToken: '',
      archived: false,
      approvesLeave: false,
      pending: false,
    }
    const call = (id: string, project: string, status: CallView['status'], offers: [string, CallView['offers'][number]['status']][]): CallView => ({
      id,
      projectId: null,
      phaseId: null,
      project,
      phase: 'Show',
      venue: '',
      role: 'Audio tech',
      start: '2031-03-04',
      end: '2031-03-04',
      callTime: null,
      needed: 1,
      dayRateCents: null,
      details: '',
      replyBy: null,
      status,
      pending: false,
      days: ['2031-03-04'],
      heldByDay: { '2031-03-04': 1 },
      openDays: [],
      offers: offers.map(([oid, st]) => ({
        id: oid,
        callId: id,
        personId: aoife.id,
        status: st,
        days: ['2031-03-04'],
        dayRateCents: null,
        counterRateCents: null,
        note: '',
        respondedAt: null,
        respondedVia: null,
        override: false,
        seenAt: null,
        pending: false,
        person: aoife,
      })),
    })
    const crew: CrewView = {
      // Someone who has left gets no lane, even with "Show everyone".
      people: [aoife, { ...aoife, id: 'p2', name: 'Niall Kerr', archived: true }],
      calls: [
        call('c1', 'Web Summit', 'open', [['o1', 'confirmed']]),
        call('c2', 'Electric Picnic', 'open', [['o2', 'accepted']]),
        call('c3', 'Nissan launch', 'open', [['o3', 'declined']]),
        call('c4', 'Tom Jones', 'cancelled', [['o4', 'confirmed']]),
        call('c5', 'Fairview', 'open', [['o5', 'filled']]),
      ],
      unavailability: [],
    }
    const week = plan({ jobs: { jobs: [], clients: [], venues: [] }, crew }, weekOf('2031-03-04'))
    expect(week.people[0]!.days['2031-03-04']).toMatchObject({ severity: 'clash', problem: 'Booked on Web Summit and Electric Picnic' })
    expect(week.people[0]!.days['2031-03-04']!.work.map((w) => w.job)).toEqual(['Web Summit', 'Electric Picnic'])
    expect(week.jobs.map((l) => l.name)).toEqual(['Electric Picnic', 'Fairview', 'Nissan launch', 'Web Summit'])
    expect(week.people.map((l) => l.person.name)).toEqual(['Aoife Byrne'])
  })
})

describe('weeks and months', () => {
  it('runs weeks Monday to Sunday and months first to last, across the ends of years and in leap years', () => {
    expect(mondayOf('2031-03-09')).toBe('2031-03-03')
    expect(mondayOf('2031-03-03')).toBe('2031-03-03')
    expect(weekOf('2026-12-31')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'])
    expect(monthOf('2028-02-10')).toHaveLength(29)
    expect(monthOf('2031-02-28')).toHaveLength(28)
    expect(monthOf('2026-10-05')[0]).toBe('2026-10-01')
    expect(monthOf('2026-10-05').at(-1)).toBe('2026-10-31')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01')
    expect(monthLabel('2026-10-05')).toBe('October 2026')
    expect([isDay('2026-10-05'), isDay('2026-02-30'), isDay('2026-13-01'), isDay('next week')]).toEqual([true, false, false, false])
  })

  it("shortens phases and jobs for a month's narrow columns", () => {
    expect(['Prep', 'Load in', 'Build', 'Rehearsal', 'Show', 'Babysit', 'Load out', 'site visit'].map(phaseCode)).toEqual([
      'Pr',
      'In',
      'Bu',
      'Re',
      'Sh',
      'Ba',
      'Out',
      'Si',
    ])
    expect(['Web Summit', 'Nissan', 'Tik Tok - Ploughing', '"Beyond The Pale"', ''].map(initials)).toEqual(['WS', 'N', 'TT', 'BT', '•'])
  })
})
