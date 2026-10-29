import { describe, expect, it } from 'vitest'
import type { Mutation } from '../src/commands.ts'
import { departmentForRole, departmentOf, departmentOfPeople, type CrewCall, type Offer, type Person } from '../src/crew.ts'
import type { PullResponse, PushRequest, PushResponse } from '../src/protocol.ts'
import {
  callAsRead,
  changesLinkOf,
  notesAsRead,
  offerAsRead,
  readsDocumentOf,
  readsEveryRate,
  readsLinkOf,
  readsRatesIn,
  personAsRead,
  READS_EVERYTHING,
  readingFor,
  readsEverything,
  sameReading,
  setsRates,
  timesheetAsRead,
  readsAttachmentOf,
  documentsRead,
  type Reading,
} from '../src/reading.ts'
import { MemoryStorage, SyncClient, type Transport } from '../src/sync/client.ts'
import { crewView } from '../src/sync/crew-view.ts'
import type { Timesheet } from '../src/timesheets.ts'

/**
 * A department on every crew call, and what each role reads (ADR 0046):
 * the department a call is given from its role or its people, what the
 * server leaves out of a record for each role, and a device that reads its
 * copy again when what it's sent changes.
 */

const person = (id: string, p: Partial<Person> = {}): Person => ({
  id,
  name: `Person ${id}`,
  kind: 'freelancer',
  email: null,
  phone: null,
  skills: [],
  dayRateCents: 25000,
  notes: '',
  linkToken: `token-${id}-abcdefghijklmnop`,
  archived: false,
  approvesLeave: false,
  role: null,
  department: null,
  level: 1,
  knownAs: null,
  certificates: {},
  company: null,
  ...p,
})

const call = (id: string, c: Partial<CrewCall> = {}): CrewCall => ({
  id,
  projectId: null,
  phaseId: null,
  project: `Job ${id}`,
  phase: '',
  venue: '',
  role: 'Stagehand',
  start: '2026-10-20',
  end: '2026-10-20',
  callTime: null,
  needed: 1,
  dayRateCents: 30000,
  details: '',
  replyBy: null,
  status: 'open',
  ...c,
})

const offer = (id: string, personId: string, o: Partial<Offer> = {}): Offer => ({
  id,
  callId: 'c1',
  personId,
  status: 'confirmed',
  days: ['2026-10-20'],
  dayRateCents: 30000,
  counterRateCents: 32000,
  note: '',
  respondedAt: null,
  respondedVia: null,
  override: false,
  seenAt: null,
  ...o,
})

describe('the department a call is given', () => {
  it('follows calls already made for the same role, however it is typed', () => {
    const calls = [call('a', { role: 'Stagehand', department: 'Production' }), call('b', { role: ' stagehand ', department: 'Production' }), call('c', { role: 'Stagehand', department: 'LX' })]
    expect(departmentForRole('STAGEHAND', { calls })).toBe('Production')
  })

  it('or else the department most people with the role as a skill are in, leaving out the archived', () => {
    const people = [
      person('1', { skills: ['Rigger'], department: 'Rigger' }),
      person('2', { skills: ['rigger'], department: 'Rigger' }),
      person('3', { skills: ['Rigger'], department: 'LX', archived: true }),
      person('4', { skills: ['Rigger'], department: 'LX', archived: true }),
    ]
    expect(departmentForRole('Rigger', { people })).toBe('Rigger')
  })

  it("or else what the role's own words say, and none when they say nothing", () => {
    expect(departmentForRole('Sound No.1')).toBe('Audio')
    expect(departmentForRole('FOH engineer')).toBe('Audio')
    expect(departmentForRole('LX op')).toBe('LX')
    expect(departmentForRole('Lighting tech')).toBe('LX')
    expect(departmentForRole('Camera op')).toBe('Video')
    expect(departmentForRole('Head rigger')).toBe('Rigger')
    expect(departmentForRole('Van driver')).toBe('Transport')
    expect(departmentForRole('Stagehand')).toBeNull()
    expect(departmentForRole('Crew')).toBeNull()
    expect(departmentForRole('  ')).toBeNull()
  })

  it('for a call from the calendar, the department more than half its people are in, or none', () => {
    expect(departmentOfPeople(['Audio', 'audio', 'LX'])).toBe('Audio')
    expect(departmentOfPeople(['Audio', 'LX'])).toBeNull()
    expect(departmentOfPeople(['Audio', null, null])).toBeNull()
    expect(departmentOfPeople([])).toBeNull()
  })

  it('reads none on a call saved before calls had one', () => {
    expect(departmentOf(call('a'))).toBeNull()
    expect(departmentOf(call('a', { department: 'LX' }))).toBe('LX')
  })
})

describe('what each role reads', () => {
  const own = 'me'
  const head = readingFor('head', { personId: own, department: 'Audio' })
  const crew = readingFor('crew', { personId: own })

  it('is everything for the office, directors and with roles off; for others, rates and links are narrowed', () => {
    for (const role of ['director', 'office', null] as const) expect(readsEverything(readingFor(role))).toBe(true)
    expect(head).toEqual({ rates: false, links: 'department', personId: own, department: 'Audio', clientDocuments: false })
    expect(readingFor('head', { department: 'Audio', headsSeeRates: true })).toMatchObject({ rates: true, ratesBy: 'department' })
    expect(readingFor('freelancer')).toEqual({ rates: false, links: 'own', details: 'own', documents: 'own', clientDocuments: false })
    expect(crew).toEqual({ rates: false, links: 'own', personId: own, details: 'phones', documents: 'own', clientDocuments: false })
  })

  it('leaves a rate and link out of a person, saying so, and never out of their own', () => {
    const sound = person('s', { department: 'audio' })
    const lights = person('l', { department: 'LX' })
    expect(personAsRead(sound, head)).toMatchObject({ dayRateCents: null, rateHidden: true, linkToken: sound.linkToken })
    expect(personAsRead(sound, head).linkHidden).toBeUndefined()
    expect(personAsRead(lights, head)).toMatchObject({ dayRateCents: null, linkToken: '', linkHidden: true })
    expect(personAsRead(lights, crew)).toMatchObject({ dayRateCents: null, linkToken: '', linkHidden: true, rateHidden: true })
    expect(personAsRead(person(own), crew)).toEqual(person(own))
    expect(personAsRead(lights, READS_EVERYTHING)).toBe(lights)
  })

  it("leaves rates out of calls and others' offers, and amounts out of others' timesheets", () => {
    expect(callAsRead(call('c'), crew)).toMatchObject({ dayRateCents: null, rateHidden: true })
    expect(offerAsRead(offer('o', 'other'), crew)).toMatchObject({ dayRateCents: null, counterRateCents: null, rateHidden: true })
    expect(offerAsRead(offer('o', own), crew)).toEqual(offer('o', own))
    const sheet = {
      id: 'o',
      offerId: 'o',
      days: [],
      dayRateCents: 30000,
      extras: [{ what: 'Taxi', cents: 2500 }],
      sent: { days: [], dayRateCents: 30000, extras: [{ what: 'Taxi', cents: 2500 }] },
    } as unknown as Timesheet
    expect(timesheetAsRead(sheet, false, crew)).toMatchObject({ dayRateCents: null, extras: [{ what: 'Taxi', cents: 0 }], sent: { dayRateCents: null, extras: [{ cents: 0 }] }, amountsHidden: true })
    expect(timesheetAsRead(sheet, true, crew)).toBe(sheet)
    // What was written on it goes as for time off (audit, 20 October 2026, finding 37), for a head with rates too.
    const noted = { ...sheet, note: 'Left early, hospital', officeNote: 'No dinner' }
    expect(timesheetAsRead(noted, false, crew)).toMatchObject({ note: '', officeNote: '' })
    expect(timesheetAsRead(noted, false, readingFor('head', { department: 'Audio', headsSeeRates: true }), 'Audio')).toMatchObject({ note: 'Left early, hospital', dayRateCents: 30000 })
    expect(timesheetAsRead(noted, true, crew)).toBe(noted)
    expect(timesheetAsRead(noted, false, READS_EVERYTHING)).toBe(noted)
  })

  it('tells setting a rate or deciding a timesheet from the rest', () => {
    expect(setsRates('call.create', { dayRateCents: 30000 })).toBe(true)
    expect(setsRates('call.create', { dayRateCents: null })).toBe(false)
    expect(setsRates('call.update', { id: 'c', venue: 'Vicar St' })).toBe(false)
    expect(setsRates('call.update', { id: 'c', dayRateCents: null })).toBe(true)
    expect(setsRates('timesheet.approve', {})).toBe(true)
    expect(setsRates('call.department', { ids: ['c'], department: 'LX' })).toBe(false)
  })

  it('knows a new link from other changes, and whose link a reader is sent', () => {
    expect(changesLinkOf('person.newLink', { id: 'p1' })).toBe('p1')
    expect(changesLinkOf('person.archive', { id: 'p1', archived: true })).toBeUndefined()
    expect(readsLinkOf(head, { id: 'x', department: 'AUDIO' })).toBe(true)
    expect(readsLinkOf(head, { id: 'x', department: 'LX' })).toBe(false)
    expect(readsLinkOf(head, { id: own, department: null })).toBe(true)
    expect(readsLinkOf(crew, { id: 'x', department: 'Audio' })).toBe(false)
    expect(readsLinkOf(READS_EVERYTHING, { id: 'x' })).toBe(true)
  })

  it('compares readings by what they leave out', () => {
    expect(sameReading(undefined, READS_EVERYTHING)).toBe(true)
    expect(sameReading(head, { ...head, department: 'AUDIO' })).toBe(true)
    expect(sameReading(head, { ...head, department: 'LX' })).toBe(false)
    expect(sameReading(crew, readingFor('crew', { personId: 'someone else' }))).toBe(false)
    expect(sameReading(crew, undefined)).toBe(false)
    // What's read of other people (ADR 0062) counts too, so a device reads its copy again when it changes.
    expect(sameReading(crew, { ...crew, details: 'own' })).toBe(false)
    expect(sameReading(crew, { ...crew, documents: undefined, details: undefined })).toBe(false)
    const ratedHead = readingFor('head', { personId: own, department: 'Audio', headsSeeRates: true })
    expect(sameReading(ratedHead, { ...ratedHead, ratesBy: undefined })).toBe(false)
    expect(sameReading(ratedHead, { ...ratedHead, department: 'LX' })).toBe(false)
  })
})

/** What staff crew and freelancers read of other people, and a head their own department's rates (ADR 0062). */
describe('what staff crew and freelancers read of other people', () => {
  const own = 'me'
  const crew = readingFor('crew', { personId: own })
  const freelancer = readingFor('freelancer', { personId: own })
  const head = readingFor('head', { personId: own, department: 'Audio', headsSeeRates: true })
  const someone = person('s', {
    email: 'sean@example.com',
    otherEmails: ['sean@old.ie'],
    phone: '+353871234567',
    notes: 'Bad back',
    company: { name: 'Seán Sound Ltd', vatNumber: 'IE1', croNumber: null },
    department: 'Audio',
  })

  it('gives staff crew a phone number but not the email, notes or company', () => {
    const read = personAsRead(someone, crew)
    expect(read).toMatchObject({ phone: '+353871234567', email: null, notes: '', company: null, detailsHidden: true })
    expect(read.otherEmails).toBeUndefined()
    // The name, skills, department and certificates stay, so the crew screens work.
    expect(read).toMatchObject({ name: someone.name, department: 'Audio', certificates: {} })
  })

  it('gives a freelancer none of it, and everyone their own', () => {
    expect(personAsRead(someone, freelancer)).toMatchObject({ phone: null, email: null, detailsHidden: true })
    expect(personAsRead(person(own, { email: 'me@example.com' }), freelancer)).toMatchObject({ email: 'me@example.com' })
    expect(personAsRead(someone, head)).toMatchObject({ email: 'sean@example.com', notes: 'Bad back' })
    expect(personAsRead(someone, head).detailsHidden).toBeUndefined()
  })

  it("sends a client's documents only to the office and directors, and a venue's to everyone (audit, 20 October 2026, finding 39)", () => {
    expect(readsAttachmentOf(crew, { owner: 'client' })).toBe(false)
    expect(readsAttachmentOf(head, { owner: 'client' })).toBe(false)
    expect(readsAttachmentOf(crew, { owner: 'venue' })).toBe(true)
    expect(readsAttachmentOf(READS_EVERYTHING, { owner: 'client' })).toBe(true)
    expect(documentsRead(crew)).toBe(own)
    expect(documentsRead(head)).toBe(true)
  })

  it("sends only their own documents to staff crew and freelancers", () => {
    expect(readsDocumentOf(crew, { personId: 's' })).toBe(false)
    expect(readsDocumentOf(freelancer, { personId: own })).toBe(true)
    expect(readsDocumentOf(head, { personId: 's' })).toBe(true)
    expect(readsDocumentOf(READS_EVERYTHING, { personId: 's' })).toBe(true)
  })

  it('keeps the days of time off and the answers, without what was written', () => {
    const away = { id: 'u', personId: 's', start: '2026-10-20', end: '2026-10-21', note: 'Hospital', source: 'ops' as const }
    expect(notesAsRead(away, crew)).toEqual({ ...away, note: '' })
    const leave = { id: 'l', personId: 's', note: 'Wedding', reason: 'Too busy that week' }
    expect(notesAsRead(leave, freelancer)).toEqual({ ...leave, note: '', reason: '' })
    expect(notesAsRead({ ...leave, personId: own }, crew)).toEqual({ ...leave, personId: own })
    expect(notesAsRead(leave, head)).toBe(leave)
    expect(offerAsRead(offer('o', 'other', { note: 'Can do half days' }), crew)).toMatchObject({ note: '', rateHidden: true })
  })

  it("gives a head who reads rates their own department's, and not everyone's", () => {
    expect(readsRatesIn(head, 'audio')).toBe(true)
    expect(readsRatesIn(head, 'LX')).toBe(false)
    expect(readsRatesIn(head, null)).toBe(false)
    expect(readsEveryRate(head)).toBe(false)
    expect(readsEveryRate(READS_EVERYTHING)).toBe(true)
    expect(callAsRead(call('c', { department: 'Audio' }), head).rateHidden).toBeUndefined()
    expect(callAsRead(call('c', { department: 'LX' }), head)).toMatchObject({ dayRateCents: null, rateHidden: true })
    expect(personAsRead(person('l', { department: 'LX' }), head)).toMatchObject({ dayRateCents: null, rateHidden: true })
    expect(offerAsRead(offer('o', 'other'), head, 'Audio').rateHidden).toBeUndefined()
    expect(offerAsRead(offer('o', 'other'), head, 'LX')).toMatchObject({ rateHidden: true })
  })
})

/** A server that sends each record as read by the reading it's set to, as the pull does. */
class Server implements Transport {
  seq = 0
  changes: PullResponse['changes'] = []
  reading: Reading = READS_EVERYTHING
  push = async (req: PushRequest): Promise<PushResponse> => ({ results: req.mutations.map((m) => ({ id: m.id, status: 'applied' as const, seq: ++this.seq })) })
  pull = async (after: number): Promise<PullResponse> => {
    const changes = this.changes
      .filter((c) => c.seq > after)
      .map((c) => (c.entity === 'person' ? { ...c, data: personAsRead(c.data as Person, this.reading) } : c.entity === 'crewCall' ? { ...c, data: callAsRead(c.data as CrewCall, this.reading) } : c))
    return { changes, cursor: Math.max(after, this.seq), more: false, ...(readsEverything(this.reading) ? {} : { reading: this.reading }) }
  }
  put(entity: PullResponse['changes'][number]['entity'], id: string, data: unknown) {
    this.changes.push({ seq: ++this.seq, entity, id, op: 'put', data })
  }
}

describe('a device whose reading changes', () => {
  it('reads its copy again, so a rate it held goes when its role loses it and comes back when given it', async () => {
    const server = new Server()
    server.put('person', 'p1', person('p1', { department: 'LX' }))
    server.put('crewCall', 'c1', call('c1'))
    const storage = new MemoryStorage()
    const phone = await new SyncClient({ storage, transport: server, clientId: 'phone' }).open()
    await phone.sync()
    expect(phone.view().crew.people[0]).toMatchObject({ dayRateCents: 25000, linkToken: 'token-p1-abcdefghijklmnop' })
    expect(phone.view().reading).toEqual(READS_EVERYTHING)

    server.reading = readingFor('head', { department: 'Audio' })
    await phone.sync()
    expect(phone.view().crew.people[0]).toMatchObject({ dayRateCents: null, rateHidden: true, linkToken: '', linkHidden: true })
    expect(phone.view().crew.calls[0]).toMatchObject({ dayRateCents: null, rateHidden: true })
    expect(phone.view().reading).toMatchObject({ rates: false, links: 'department' })
    // What's kept on the phone has nothing left out either.
    expect((await storage.load())?.entities.person?.p1).toMatchObject({ dayRateCents: null, linkToken: '' })

    server.reading = READS_EVERYTHING
    await phone.sync()
    expect(phone.view().crew.people[0]).toMatchObject({ dayRateCents: 25000, linkToken: 'token-p1-abcdefghijklmnop' })
    expect(phone.view().crew.people[0]?.rateHidden).toBeUndefined()
    expect(phone.view().reading).toEqual(READS_EVERYTHING)
  })
})

const pending = <N extends Mutation['name']>(name: N, args: Mutation<N>['args']): Mutation => ({ id: `m-${name}`, name, args, createdAt: '2026-10-01T09:00:00Z' }) as Mutation

/** A call asked for on the device, as the form sends it. */
const ask = { projectId: null, phaseId: null, project: 'Gala', phase: '', venue: '', role: 'Sound No.2', start: '2026-10-21', end: '2026-10-21', callTime: null, needed: 1, dayRateCents: null, details: '', replyBy: null }

describe('a department changed on the device', () => {
  it('gives a new call the department its role suggests, or the one sent', () => {
    const entities = { crewCall: { a: call('a', { role: 'Sound No.2', department: 'Audio' }) } }
    const guessed = crewView(entities, [pending('call.create', { ...ask, id: 'n1' })], 0)
    expect(guessed.calls.find((c) => c.id === 'n1')?.department).toBe('Audio')
    const sent = crewView(entities, [pending('call.create', { ...ask, id: 'n1', department: null })], 0)
    expect(sent.calls.find((c) => c.id === 'n1')?.department).toBeNull()
  })

  it('gives many calls one at once, and none back', () => {
    const entities = { crewCall: { a: call('a'), b: call('b'), c: call('c', { department: 'LX' }) } }
    const view = crewView(entities, [pending('call.department', { ids: ['a', 'b'], department: 'Production' })], 0)
    expect(view.calls.map((c) => [c.id, c.department])).toEqual([
      ['a', 'Production'],
      ['b', 'Production'],
      ['c', 'LX'],
    ])
    expect(crewView(entities, [pending('call.department', { ids: ['c'], department: null })], 0).calls.find((c) => c.id === 'c')?.department).toBeNull()
  })

  it('keeps a hidden rate hidden when a role without rates edits a person', () => {
    const hidden = { ...person('p1'), dayRateCents: null, rateHidden: true }
    const edit = pending('person.upsert', { id: 'p1', name: 'Aoife', kind: 'freelancer', email: null, phone: null, skills: [], notes: '' })
    expect(crewView({ person: { p1: hidden } }, [edit], 0).people[0]).toMatchObject({ name: 'Aoife', dayRateCents: null, rateHidden: true })
  })
})
