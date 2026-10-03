import { describe, expect, it } from 'vitest'
import { COMMAND_NAMES, commandSchemas, type Mutation } from '../src/commands.ts'
import type { CrewCall, Offer, Person } from '../src/crew.ts'
import { irishToday } from '../src/day.ts'
import { ERASED_NAME, ERASED_REFUSAL, erasedPerson, leaveRecordKept, nameKept, nameKeptUntil, PERSON_COMMANDS, type Erasure } from '../src/erasure.ts'
import type { Phase, Project } from '../src/jobs.ts'
import type { RunningLate } from '../src/late.ts'
import type { LeaveAllowance, LeaveRequest, LieuEntry } from '../src/leave.ts'
import type { Change, PullResponse } from '../src/protocol.ts'
import { emptySnapshot, MemoryStorage, SyncClient, type Snapshot, type Transport } from '../src/sync/client.ts'
import { eraseRefusal, forgetErased } from '../src/sync/erasure-view.ts'
import type { Timesheet } from '../src/timesheets.ts'

/**
 * Erasing a person (ADR 0027) on a device: an erasure still waiting to
 * send shows them erased everywhere at once, as the server will leave
 * them; the device refuses the same things the server does, in the same
 * words; and when the server says someone was erased, the device forgets
 * what it still held about them outside its records. Plus the rules both
 * share: the six years for pay, the three for staff leave, and every
 * command that names a person.
 */

const TODAY = '2026-10-02'
const at = new Date(`${TODAY}T10:00:00Z`)

const ciara: Person = {
  id: 'p7',
  name: 'Ciara Ní Mhurchú',
  kind: 'freelancer',
  email: 'ciara.nm@example.ie',
  phone: '+353 86 555 0101',
  skills: ['rigging'],
  dayRateCents: 30000,
  notes: 'Allergic to nuts',
  linkToken: 'abcdefghijklmnopqrstuvwx',
  archived: true,
  approvesLeave: false,
  department: 'Rope access',
  level: 3,
  knownAs: 'Kiki B',
  certificates: { 'first-aid': { held: true, expires: '2027-05-01', note: '' } },
  company: { name: 'Mhurchú Rigging Ltd', vatNumber: 'IE9988776Q', croNumber: '7654321' },
}

const call = (id: string, start: string, end: string): CrewCall => ({
  id,
  projectId: null,
  phaseId: null,
  project: 'Body & Soul',
  phase: 'Build',
  venue: '',
  role: 'Rigger',
  start,
  end,
  callTime: null,
  needed: 1,
  dayRateCents: 30000,
  details: '',
  replyBy: null,
  status: 'open',
})
const offer = (id: string, callId: string, status: Offer['status'], days: string[], note = ''): Offer => ({
  id,
  callId,
  personId: 'p7',
  status,
  days,
  dayRateCents: 30000,
  counterRateCents: null,
  note,
  respondedAt: null,
  respondedVia: null,
  override: false,
  seenAt: null,
})
const sheet = (id: string, status: Timesheet['status'], approvedAt: string | null): Timesheet => ({
  id,
  status,
  days: ['2026-06-10'],
  dayRateCents: 30000,
  extras: [],
  sent: { days: ['2026-06-10'], dayRateCents: 30000, extras: [] },
  note: '',
  officeNote: '',
  sentAt: '2026-06-11T09:00:00Z',
  sentVia: 'link',
  approvedAt,
})

/** Aoife, on the staff, who has left and asked for her details to go. */
const aoife: Person = {
  ...ciara,
  id: 'aoife',
  name: 'Aoife Byrne',
  kind: 'staff',
  email: 'aoife.byrne@example.ie',
  phone: '+353 87 555 0303',
  skills: [],
  dayRateCents: null,
  notes: 'Prefers the early van',
  linkToken: 'zyxwvutsrqponmlkjihgfedc',
  department: null,
  level: 1,
  knownAs: null,
  certificates: {},
  company: null,
}
const request = (id: string, start: string, end: string, over: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id,
  personId: 'aoife',
  type: 'annual',
  start,
  end,
  days: 5,
  note: 'Family wedding in Kerry',
  status: 'approved',
  requestedAt: `${start.slice(0, 4)}-01-05T09:00:00.000Z`,
  decidedBy: 'colly',
  decidedAt: `${start.slice(0, 4)}-01-06T09:00:00.000Z`,
  reason: 'Covered by Cian',
  ...over,
})
const entry = (id: string, day: string, over: Partial<LieuEntry> = {}): LieuEntry => ({
  id,
  personId: 'aoife',
  day,
  days: 1,
  note: 'Worked the Saturday get-out',
  status: 'approved',
  loggedAt: `${day}T18:00:00.000Z`,
  decidedBy: 'colly',
  decidedAt: `${day}T19:00:00.000Z`,
  reason: 'Thanks for staying late',
  ...over,
})
const allowance = (year: number): LeaveAllowance => ({ id: `aoife-${year}`, personId: 'aoife', year, days: 22, carriedOver: 2, note: 'Agreed at interview' })
/** What anyone wrote in Aoife's leave: none of it may be left once she's erased. */
const LEAVE_WORDS = ['Kerry', 'Covered by', 'get-out', 'staying late', 'interview']

const offline: Transport = { push: () => Promise.reject(new Error('offline')), pull: () => Promise.reject(new Error('offline')) }

/** A device holding these records, with no signal. */
async function device(entities: Partial<Record<keyof Snapshot['entities'], Record<string, unknown>>>) {
  const snapshot = emptySnapshot('laptop')
  Object.assign(snapshot.entities, entities)
  const storage = new MemoryStorage()
  await storage.save(snapshot)
  return new SyncClient({ storage, transport: offline, now: () => at }).open()
}

const past = call('past', '2026-06-10', '2026-06-12')

describe('an erasure waiting to send', () => {
  it('shows them erased everywhere the crew reaches, their days off and their own notes gone, before the server answers', async () => {
    // Proves: the device lays person.erase over its copy as the server will do it, so the card reads "Erased person" at once.
    const client = await device({
      person: { p7: ciara },
      crewCall: { past },
      offer: { o1: offer('o1', 'past', 'confirmed', ['2026-06-10'], 'Bringing my own harness') },
      unavailability: { u1: { id: 'u1', personId: 'p7', start: '2026-11-01', end: '2026-11-02', note: 'Wedding', source: 'self' } },
    })
    await client.mutate('person.erase', { id: 'p7' })
    const view = client.view()
    expect(view.erasures.p7).toEqual({ id: 'p7', erasedAt: at.toISOString(), nameKeptUntil: null, pending: true })
    expect(view.crew.people).toEqual([{ ...erasedPerson(ciara, false), pending: true, worked: [expect.objectContaining({ callId: 'past' })] }])
    expect(view.crew.unavailability).toEqual([])
    expect(view.crew.calls[0]!.offers[0]).toMatchObject({ note: '', person: { name: ERASED_NAME } })
    expect(JSON.stringify(view.crew)).not.toContain('Mhurch')
  })

  it('takes what they said about running late off every screen at once (ADR 0028)', async () => {
    // Proves: let go from today's job after saying she'd be late, then erased, her note goes from the device's running late as the server deletes it.
    const late: RunningLate = {
      id: 'l1',
      personId: 'p7',
      offerId: 'o2',
      callId: 'now',
      day: TODAY,
      by: '30',
      arriveAt: null,
      note: 'Traffic on the M50',
      saidAt: '2026-10-02T07:10:00.000Z',
      arrivedAt: null,
      seenAt: '2026-10-02T07:20:00.000Z',
    }
    const client = await device({
      person: { p7: ciara },
      crewCall: { now: call('now', TODAY, TODAY) },
      offer: { o2: offer('o2', 'now', 'cancelled', [TODAY]) },
      runningLate: { l1: late },
    })
    expect(client.view().late.current.map((l) => l.note)).toEqual(['Traffic on the M50'])
    await client.mutate('person.erase', { id: 'p7' })
    expect(client.view().late.current).toEqual([])
    expect(JSON.stringify(client.view().crew)).not.toContain('M50')
  })

  it("keeps the name, and says until when, for someone with paid work in the last six years", async () => {
    // Proves: an approved timesheet keeps the name on the device as on the server, for six whole years after the year it was approved in.
    const client = await device({
      person: { p7: ciara },
      crewCall: { past },
      offer: { o1: offer('o1', 'past', 'confirmed', ['2026-06-10']) },
      timesheet: { o1: sheet('o1', 'approved', '2026-06-20T15:00:00Z') },
    })
    await client.mutate('person.erase', { id: 'p7' })
    expect(client.view().erasures.p7).toMatchObject({ nameKeptUntil: '2033-01-01', pending: true })
    expect(client.view().crew.people[0]).toMatchObject({ name: ciara.name, phone: null, notes: '', company: null, knownAs: null })
  })

  it("keeps a member of staff's leave for three years, without notes or reasons, and her name with it", async () => {
    // Proves: the device lays the erasure over her leave as the server does (server/test/erasure.test.ts erases the same):
    // this year's request, day in lieu and allowance kept with their dates, days and decisions but nothing anyone wrote in
    // them; 2022's gone, its three years up; the approved leave's days off gone; and her name kept until 1 January 2030.
    const client = await device({
      person: { aoife },
      leaveRequest: { now: request('now', '2026-02-09', '2026-02-13'), old: request('old', '2022-02-07', '2022-02-11') },
      lieuEntry: { sat: entry('sat', '2026-09-26') },
      leaveAllowance: { 'aoife-2026': allowance(2026), 'aoife-2022': allowance(2022) },
      unavailability: { now: { id: 'now', personId: 'aoife', start: '2026-02-09', end: '2026-02-13', note: 'Annual leave', source: 'leave' } },
    })
    expect(client.view().keptFor('aoife')).toEqual({ pay: null, leave: '2030-01-01', until: '2030-01-01' })
    await client.mutate('person.erase', { id: 'aoife' })
    const view = client.view()
    expect(view.erasures.aoife).toMatchObject({ nameKeptUntil: '2030-01-01', pending: true })
    expect(view.crew.people[0]).toMatchObject({ name: 'Aoife Byrne', email: null, phone: null, notes: '', pending: true })
    expect(view.crew.unavailability).toEqual([])
    expect(view.leave.requests.map((r) => [r.id, r.status, r.start, r.end, r.days, r.decidedBy, r.note, r.reason])).toEqual([
      ['now', 'approved', '2026-02-09', '2026-02-13', 5, 'colly', '', ''],
    ])
    expect(view.leave.entries.map((e) => [e.id, e.status, e.day, e.days, e.decidedBy, e.note, e.reason])).toEqual([['sat', 'approved', '2026-09-26', 1, 'colly', '', '']])
    expect(view.leave.allowance('aoife', 2026)).toMatchObject({ days: 22, carriedOver: 2, note: '' })
    expect(view.leave.allowance('aoife', 2022)).toBeUndefined()
    const shown = JSON.stringify(view.leave.requests) + JSON.stringify(view.leave.entries) + JSON.stringify(view.leave.allowance('aoife', 2026))
    for (const t of LEAVE_WORDS) expect(shown, t).not.toContain(t)
  })
})

describe('what has to be settled first', () => {
  const job: Project = { id: 'j1', name: 'Culture Night', clientId: null, venueId: null, status: 'confirmed', notes: '' } as Project
  const phase = (end: string, contactId: string | null): Phase => ({ id: 'ph1', projectId: 'j1', name: 'Show', start: end, end, venueId: null, notes: '', contactId }) as Phase

  it('is said on the device in the words the server uses, and nothing is said once it is settled', async () => {
    // Proves: the card refuses before sending, for each thing the server refuses, so nobody waits on a sync to hear it.
    const refusal = async (entities: Parameters<typeof device>[0], who: Person = ciara) => eraseRefusal(who, (await device(entities)).view(), TODAY)
    expect(await refusal({ person: { p7: { ...ciara, archived: false } } }, { ...ciara, archived: false })).toBe(`${ciara.name} isn't archived. Archive them first, then erase their details.`)
    const running = call('now', '2026-10-01', '2026-10-03')
    expect(await refusal({ person: { p7: ciara }, crewCall: { now: running }, offer: { o2: offer('o2', 'now', 'confirmed', ['2026-10-01']) } })).toBe(
      `${ciara.name} is booked on Body & Soul (Build), which hasn't ended. Erase their details once it has, or release them first.`
    )
    expect(await refusal({ person: { p7: ciara }, crewCall: { now: running }, offer: { o2: offer('o2', 'now', 'offered', ['2026-10-01', '2026-10-02', '2026-10-03']) } })).toBe(
      `${ciara.name} has an open offer for Body & Soul (Build); withdraw it first.`
    )
    expect(await refusal({ person: { p7: ciara }, project: { j1: job }, phase: { ph1: phase('2026-10-04', 'p7') } })).toBe(
      `${ciara.name} is the contact on the day for Culture Night (Show), which hasn't ended. Choose someone else first.`
    )
    expect(
      await refusal({ person: { p7: ciara }, crewCall: { past }, offer: { o1: offer('o1', 'past', 'confirmed', ['2026-06-10']) }, timesheet: { o1: sheet('o1', 'sent', null) } })
    ).toBe(`${ciara.name} has a timesheet waiting on Body & Soul: approve it first, so their pay is on record.`)
    const link = { id: 'main', state: 'on', account: 'Ciara.NM@example.ie', calendarId: 'c', calendarName: 'Jobs', problem: null, connectedBy: null, connectedAt: null }
    expect(await refusal({ person: { p7: ciara }, calendarLink: { main: link } })).toBe(
      `${ciara.name}'s Google account writes the jobs to Google Calendar: connect another account on the Account tab first.`
    )
    // A job over, a phase over, a timesheet approved, the calendar on another account: nothing in the way.
    expect(
      await refusal({
        person: { p7: ciara },
        crewCall: { past },
        offer: { o1: offer('o1', 'past', 'confirmed', ['2026-06-10']) },
        timesheet: { o1: sheet('o1', 'approved', '2026-06-20T15:00:00Z') },
        project: { j1: job },
        phase: { ph1: phase('2026-06-12', 'p7') },
        calendarLink: { main: { ...link, account: 'office@example.ie' } },
      })
    ).toBeUndefined()
  })

  it('names the first of several by its first day, as the server does', async () => {
    // Proves: with two phases still to come, the device names the one that starts first (server/test/erasure.test.ts says the same words), not the one whose job comes first in the list.
    const at = (id: string, projectId: string, name: string, start: string, end: string): Phase => ({ id, projectId, name, start, end, venueId: null, notes: '', contactId: 'p7' }) as Phase
    const client = await device({
      person: { p7: ciara },
      project: { ep: { ...job, id: 'ep', name: 'Electric Picnic' }, bs: { ...job, id: 'bs', name: 'Body & Soul' } },
      phase: { prep: at('prep', 'ep', 'Prep', '2026-09-01', '2026-09-01'), show: at('show', 'ep', 'Show', '2026-12-01', '2026-12-02'), build: at('build', 'bs', 'Build', '2026-10-12', '2026-10-13') },
    })
    expect(eraseRefusal(ciara, client.view(), TODAY)).toBe(`${ciara.name} is the contact on the day for Body & Soul (Build), which hasn't ended. Choose someone else first.`)
  })

  it('is said for leave still waiting for a decision, in the words the server uses', async () => {
    // Proves: her leave stays once she's erased, and nothing more can be decided for her, so a request or a day in lieu
    // still waiting is settled first, or it would sit in the approvers' queue for good. A request is named before a day in
    // lieu, as on the server (server/test/erasure.test.ts).
    const refusal = async (entities: Parameters<typeof device>[0]) => eraseRefusal(aoife, (await device({ person: { aoife }, ...entities })).view(), TODAY)
    const undecided = { status: 'waiting', decidedBy: null, decidedAt: null, reason: '' } as const
    const words = (what: string) => `Aoife Byrne has ${what} waiting for a decision: decide it on the Leave screen first, so their leave records say how it ended.`
    expect(await refusal({ lieuEntry: { e: entry('e', '2026-09-26', undecided) }, leaveRequest: { r: request('r', '2026-11-02', '2026-11-06', undecided) } })).toBe(words('leave'))
    expect(await refusal({ lieuEntry: { e: entry('e', '2026-09-26', undecided) } })).toBe(words('a day in lieu'))
    // Decided either way, or taken back, nothing is in the way.
    expect(
      await refusal({
        leaveRequest: { r: request('r', '2026-11-02', '2026-11-06', { status: 'declined' }), c: request('c', '2026-12-07', '2026-12-08', { ...undecided, status: 'cancelled' }) },
        lieuEntry: { e: entry('e', '2026-09-26') },
      })
    ).toBeUndefined()
  })
})

describe('when the server says someone was erased', () => {
  const m = (id: string, name: Mutation['name'], args: unknown): Mutation => ({ id, name, args, createdAt: '2026-09-01T09:00:00Z' }) as Mutation

  it('sets aside what was waiting about them as a problem, forgets what could only be turned down, and strips the rest', () => {
    // Proves: the outbox, the problems and what the device remembers sending keep nothing of hers that the server wouldn't.
    const state = emptySnapshot('laptop')
    Object.assign(state.entities, { person: { p7: ciara }, offer: { o1: offer('o1', 'past', 'confirmed', ['2026-06-10']) } })
    const edit = m('a', 'person.upsert', { ...ciara, notes: 'Allergic to nuts and shellfish' })
    const answer = m('b', 'offer.respond', { id: 'o1', answer: 'decline', note: 'At a wedding' })
    const confirm = m('c', 'offer.confirm', { id: 'o1' })
    const other = m('d', 'person.contact', { id: 'p8', phone: '+353 87 000 0000' })
    state.outbox = [edit, { ...confirm, appliedSeq: 9 }, other]
    state.sent = [{ ...answer, sentAt: '2026-09-01T09:01:00Z' }, { ...confirm, sentAt: '2026-09-01T09:01:00Z' }]
    state.problems = [{ mutation: m('e', 'person.contact', { id: 'p7', phone: '+353 86 555 0202' }), reason: { code: 'invalid', message: 'No' }, at: '2026-09-01T09:02:00Z' }]
    const erasure: Erasure = { id: 'p7', erasedAt: at.toISOString(), nameKeptUntil: null }

    forgetErased(state, erasure, at.toISOString())

    expect(state.outbox).toEqual([{ ...confirm, appliedSeq: 9 }, other])
    expect(state.sent).toEqual([{ ...confirm, sentAt: '2026-09-01T09:01:00Z' }])
    expect(state.problems).toEqual([
      { mutation: m('e', 'person.contact', { id: 'p7', phone: null }), reason: { code: 'invalid', message: 'No' }, at: '2026-09-01T09:02:00Z' },
      { mutation: m('a', 'person.upsert', { id: 'p7', kind: 'freelancer', name: ERASED_NAME }), reason: { code: 'conflict', message: ERASED_REFUSAL }, at: at.toISOString() },
    ])
    // Her records themselves arrive erased from the server, after this.
    const held = JSON.stringify({ outbox: state.outbox, sent: state.sent, problems: state.problems })
    for (const t of ['Mhurch', 'Allergic', 'wedding', '555']) expect(held, t).not.toContain(t)
  })

  it('arrives before the records it changes, and leaves nothing older in the copy it saves', async () => {
    // Proves: through a real pull, the erasure, then her records as the server erased them, replace everything the device held.
    const changes: Change[] = [
      { seq: 1, entity: 'person', id: 'p7', op: 'put', data: ciara },
      { seq: 2, entity: 'unavailability', id: 'u1', op: 'put', data: { id: 'u1', personId: 'p7', start: '2026-11-01', end: '2026-11-02', note: 'Wedding', source: 'self' } },
    ]
    const served = (after: number): PullResponse => {
      const rest = changes.filter((c) => c.seq > after)
      return { changes: rest, cursor: rest.at(-1)?.seq ?? after, more: false, generation: 'g1', head: changes.at(-1)!.seq }
    }
    const storage = new MemoryStorage()
    const transport: Transport = { push: async () => ({ results: [] }), pull: async (after) => served(after) }
    const client = await new SyncClient({ storage, transport, clientId: 'laptop', now: () => at }).open()
    await client.sync()
    expect(JSON.stringify(await storage.load())).toContain('Wedding')

    changes.push(
      { seq: 3, entity: 'erasure', id: 'p7', op: 'put', data: { id: 'p7', erasedAt: at.toISOString(), nameKeptUntil: null } },
      { seq: 4, entity: 'unavailability', id: 'u1', op: 'delete', data: null },
      { seq: 5, entity: 'person', id: 'p7', op: 'put', data: erasedPerson(ciara, false) }
    )
    await client.sync()
    const kept = JSON.stringify(await storage.load())
    for (const t of ['Mhurch', 'Wedding', '555', 'abcdefghijklmnopqrstuvwx']) expect(kept, t).not.toContain(t)
    expect(client.view().crew.people[0]).toMatchObject({ name: ERASED_NAME, pending: false })
    expect(client.view().erasures.p7).toMatchObject({ pending: false })
  })
})

describe('the certificate kinds that came later (ADR 0028)', () => {
  it('all go, and an edit from a version that knows only the first three cannot bring one back', async () => {
    // Proves: an older edit keeps the later kinds only while her record holds them. The erasure sets that edit aside, as the
    // server refuses it, and her record arrives holding none, so nothing is laid back over it.
    const six: Person['certificates'] = {
      'first-aid': { held: true, expires: '2027-05-01', note: '' },
      'manual-handling': { held: true, expires: '2027-01-01', note: '' },
      'driving-licence': { held: true, expires: null, note: '' },
      'safe-pass': { held: true, expires: '2027-02-01', note: '' },
      'working-at-height': { held: true, expires: '2027-03-01', note: 'Harness course' },
      ipaf: { held: true, expires: '2027-04-01', note: '3a, 3b' },
    }
    const changes: Change[] = [{ seq: 1, entity: 'person', id: 'p7', op: 'put', data: { ...ciara, certificates: six } }]
    const served = (after: number): PullResponse => {
      const rest = changes.filter((c) => c.seq > after)
      return { changes: rest, cursor: rest.at(-1)?.seq ?? after, more: false, generation: 'g1', head: changes.at(-1)!.seq }
    }
    const storage = new MemoryStorage()
    // A push the server never answers, so the edit is still waiting when the erasure comes down.
    const transport: Transport = { push: async () => ({ results: [] }), pull: async (after) => served(after) }
    const client = await new SyncClient({ storage, transport, clientId: 'laptop', now: () => at }).open()
    await client.sync()

    // The version before sends only the kinds it knows: the later three are kept, on the device as on the server.
    const { id, name, kind, email, phone, skills, dayRateCents, notes } = ciara
    await client.mutate('person.upsert', { id, name, kind, email, phone, skills, dayRateCents, notes, certificates: { 'first-aid': six['first-aid']! } })
    expect(Object.keys(client.view().crew.people[0]!.certificates).sort()).toEqual(['first-aid', 'ipaf', 'safe-pass', 'working-at-height'])

    changes.push(
      { seq: 2, entity: 'erasure', id: 'p7', op: 'put', data: { id: 'p7', erasedAt: at.toISOString(), nameKeptUntil: null } },
      { seq: 3, entity: 'person', id: 'p7', op: 'put', data: erasedPerson(ciara, false) }
    )
    await client.sync()
    expect(client.view().crew.people[0]).toMatchObject({ name: ERASED_NAME, certificates: {}, pending: false })
    expect(client.view().pendingCount).toBe(0)
    expect(client.view().problems.map((p) => [p.mutation.name, p.reason.message])).toEqual([['person.upsert', ERASED_REFUSAL]])
    const kept = JSON.stringify(await storage.load())
    for (const t of ['3a, 3b', 'Harness course', '2027-04-01']) expect(kept, t).not.toContain(t)
  })
})

describe('the rules the server and devices share', () => {
  const paid = (...approvedAt: (string | null)[]) => ({ approvedAt, leave: [] })

  it('keep a name for six whole years after the year of the latest approval, and no longer', () => {
    // Proves: as Revenue counts, from the end of the year the latest approved timesheet falls in, by Ireland's day.
    expect(nameKeptUntil(paid(), TODAY)).toBeNull()
    expect(nameKeptUntil(paid(null, '2021-03-01T10:00:00Z', '2024-06-30T23:30:00Z'), TODAY)).toBe('2031-01-01')
    // Paid on the last night of 2019: kept until 1 January 2026, so free to go by October.
    expect(nameKeptUntil(paid('2019-12-31T23:30:00Z'), TODAY)).toBeNull()
    expect(nameKeptUntil(paid('2020-01-01T00:30:00Z'), TODAY)).toBe('2027-01-01')
    // The day it can go, it goes.
    expect(nameKeptUntil(paid('2020-06-01T09:00:00Z'), '2027-01-01')).toBeNull()
  })

  it('keep a leave record, and the name with it, for three whole years after the end of its year', () => {
    // Proves: as the Working Time Act asks, counted like the timesheets' rule: a request by the year of its last day, a day
    // in lieu by its day, an allowance by its year. Leave late in 2023 is still kept in October 2026, on the safe side of
    // "three years from when it was made"; leave in 2022 is not.
    const leave = (...records: ({ end: string } | { day: string } | { year: number })[]) => ({ approvedAt: [], leave: records })
    expect(nameKept(leave({ end: '2026-02-13' }), TODAY)).toEqual({ pay: null, leave: '2030-01-01', until: '2030-01-01' })
    expect(nameKeptUntil(leave({ day: '2025-12-27' }), TODAY)).toBe('2029-01-01')
    expect(nameKeptUntil(leave({ year: 2024 }), TODAY)).toBe('2028-01-01')
    expect(nameKeptUntil(leave({ end: '2023-12-31' }), TODAY)).toBe('2027-01-01')
    expect(nameKeptUntil(leave({ end: '2022-12-31' }, { day: '2022-06-04' }, { year: 2022 }), TODAY)).toBeNull()
    // The latest decides the name; each record keeps its own day.
    expect(nameKeptUntil(leave({ year: 2022 }, { end: '2026-02-13' }, { day: '2025-12-27' }), TODAY)).toBe('2030-01-01')
    expect([leaveRecordKept({ year: 2022 }, TODAY), leaveRecordKept({ day: '2025-12-27' }, TODAY)]).toEqual([false, true])
  })

  it('keep no leave still waiting for a decision, nor a name for it', () => {
    // Proves: a request or a day in lieu still waiting records no leave, and nothing more can be decided once its person is
    // erased, so it isn't kept and keeps no name (a restore can bring one back from before it was decided). Decided either
    // way, the same record is kept for its three years.
    expect(leaveRecordKept({ end: '2026-11-06', status: 'waiting' }, TODAY)).toBe(false)
    expect(leaveRecordKept({ day: '2026-09-26', status: 'waiting' }, TODAY)).toBe(false)
    expect([leaveRecordKept({ end: '2026-11-06', status: 'declined' }, TODAY), leaveRecordKept({ day: '2026-09-26', status: 'cancelled' }, TODAY)]).toEqual([true, true])
    expect(nameKept({ approvedAt: [], leave: [{ end: '2026-11-06', status: 'waiting' }, { year: 2024 }] }, TODAY)).toEqual({ pay: null, leave: '2028-01-01', until: '2028-01-01' })
    expect(nameKeptUntil({ approvedAt: [], leave: [{ day: '2026-09-26', status: 'waiting' }] }, TODAY)).toBeNull()
  })

  it('keep the name for both, until the later of the two', () => {
    // Proves: pay and leave are counted apart and the name waits for the later, whichever it is.
    expect(nameKept({ approvedAt: ['2021-03-01T10:00:00Z'], leave: [{ end: '2026-02-13' }] }, TODAY)).toEqual({ pay: '2028-01-01', leave: '2030-01-01', until: '2030-01-01' })
    expect(nameKept({ approvedAt: ['2026-06-20T15:00:00Z'], leave: [{ year: 2024 }] }, TODAY)).toEqual({ pay: '2033-01-01', leave: '2028-01-01', until: '2033-01-01' })
    // Paid too long ago to keep it, but on leave this year: kept for the leave alone.
    expect(nameKept({ approvedAt: ['2019-06-01T09:00:00Z'], leave: [{ day: '2026-09-26' }] }, TODAY)).toEqual({ pay: null, leave: '2030-01-01', until: '2030-01-01' })
  })

  it('let a record and the name go on the day its years are up, and not the day before', () => {
    // Proves: the boundary, for leave alone and for pay and leave ending the same day.
    expect(leaveRecordKept({ end: '2026-12-31' }, '2029-12-31')).toBe(true)
    expect(leaveRecordKept({ end: '2026-12-31' }, '2030-01-01')).toBe(false)
    const both = { approvedAt: ['2023-11-30T12:00:00Z'], leave: [{ year: 2026 }] }
    expect(nameKept(both, '2029-12-31')).toEqual({ pay: '2030-01-01', leave: '2030-01-01', until: '2030-01-01' })
    expect(nameKept(both, '2030-01-01')).toEqual({ pay: null, leave: null, until: null })
  })

  it("count by Ireland's day across midnight", () => {
    // Proves: an approval just before midnight on New Year's Eve in Ireland belongs to the old year, even when written
    // with another offset, and the name goes at midnight in Ireland, not before.
    const records = { approvedAt: ['2023-12-31T23:59:00Z'], leave: [{ end: '2026-03-06' }] }
    expect(nameKeptUntil(records, irishToday(new Date('2029-12-31T23:59:00Z')))).toBe('2030-01-01')
    expect(nameKeptUntil(records, irishToday(new Date('2030-01-01T00:00:00Z')))).toBeNull()
    // 11.30pm on New Year's Eve in New York is already New Year's Day in Ireland.
    expect(nameKept({ approvedAt: ['2023-12-31T23:30:00-05:00'], leave: [] }, TODAY).pay).toBe('2031-01-01')
    expect(nameKept({ approvedAt: ['2023-12-31T23:30:00+01:00'], leave: [] }, TODAY).pay).toBe('2030-01-01')
  })

  it('name every command that names a person, so none keeps their details after they are erased', () => {
    // Proves: a command added later with a personId, or one of their bookings by its offerId (running late, ADR 0028), or about a
    // person, fails here until erasing knows what to keep of it.
    const kept = new Set(['person.erase'])
    const about: string[] = []
    for (const name of COMMAND_NAMES) {
      const schema = commandSchemas[name] as unknown as { _def: { schema?: { shape?: Record<string, unknown> } }; shape?: Record<string, unknown> }
      const shape = schema.shape ?? schema._def.schema?.shape ?? {}
      const aboutSomeone = 'personId' in shape || 'offerId' in shape || name.startsWith('person.')
      if (aboutSomeone) about.push(name)
      if (aboutSomeone && !kept.has(name)) expect(PERSON_COMMANDS[name], name).toBeDefined()
    }
    // Running late's schema is refined, so its fields sit a level down: found all the same.
    expect(about).toContain('late.say')
  })
})
