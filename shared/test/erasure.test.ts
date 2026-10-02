import { describe, expect, it } from 'vitest'
import { COMMAND_NAMES, commandSchemas, type Mutation } from '../src/commands.ts'
import type { CrewCall, Offer, Person } from '../src/crew.ts'
import { ERASED_NAME, ERASED_REFUSAL, erasedPerson, nameKeptUntil, PERSON_COMMANDS, type Erasure } from '../src/erasure.ts'
import type { Phase, Project } from '../src/jobs.ts'
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
 * share: the six years, and every command that names a person.
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

describe('the rules the server and devices share', () => {
  it('keep a name for six whole years after the year of the latest approval, and no longer', () => {
    // Proves: as Revenue counts, from the end of the year the latest approved timesheet falls in, by Ireland's day.
    expect(nameKeptUntil([], TODAY)).toBeNull()
    expect(nameKeptUntil([null, '2021-03-01T10:00:00Z', '2024-06-30T23:30:00Z'], TODAY)).toBe('2031-01-01')
    // Paid on the last night of 2019: kept until 1 January 2026, so free to go by October.
    expect(nameKeptUntil(['2019-12-31T23:30:00Z'], TODAY)).toBeNull()
    expect(nameKeptUntil(['2020-01-01T00:30:00Z'], TODAY)).toBe('2027-01-01')
    // The day it can go, it goes.
    expect(nameKeptUntil(['2020-06-01T09:00:00Z'], '2027-01-01')).toBeNull()
  })

  it('name every command that names a person, so none keeps their details after they are erased', () => {
    // Proves: a command added later with a personId, or about a person, fails here until erasing knows what to keep of it.
    const kept = new Set(['person.erase'])
    for (const name of COMMAND_NAMES) {
      const schema = commandSchemas[name] as unknown as { _def: { schema?: { shape?: Record<string, unknown> } }; shape?: Record<string, unknown> }
      const shape = schema.shape ?? schema._def.schema?.shape ?? {}
      const aboutSomeone = 'personId' in shape || name.startsWith('person.')
      if (aboutSomeone && !kept.has(name)) expect(PERSON_COMMANDS[name], name).toBeDefined()
    }
  })
})
