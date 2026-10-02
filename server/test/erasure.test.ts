import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addDays,
  ERASED_NAME,
  feedCodeFor,
  irishToday,
  MemoryStorage,
  newId,
  SyncClient,
  type CommandInput,
  type CommandName,
  type HistoryPage,
  type Mutation,
  type MutationResult,
  type Transport,
} from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { restoreFrom } from '../src/backup/service.ts'
import { dirStore, type BackupStore } from '../src/backup/store.ts'
import { pgliteDb, type Db } from '../src/db.ts'
import { describe as inWords, ERASED_AGAIN_ACTION } from '../src/history.ts'
import { LIST_KEY } from '../src/erasure/list.ts'
import { flashOf, IPHONE, server as signedIn, staff, WINDOWS } from './people.ts'

/**
 * Erasing a person's details on request (ADR 0027): everywhere they live
 * on the server goes, what Revenue needs is kept, nothing about them can
 * be put on record again, and no restore from a backup brings them back.
 */

let cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

const today = irishToday()
const day = (n: number) => addDays(today, n)

async function database() {
  const db = await pgliteDb()
  cleanup.push(() => db.close())
  return db
}

async function server(db?: Db, backupStore?: BackupStore) {
  const data = db ?? (await database())
  const app = await buildApp({ db: data, backupStore })
  cleanup.push(() => app.close())
  return { app, db: data }
}

function folder() {
  const dir = mkdtempSync(join(tmpdir(), 'sh-erasure-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

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

const refusal = async (app: FastifyInstance, mutation: Mutation) => {
  const [r] = await send(app, mutation)
  return r?.status === 'rejected' ? r.reason.message : `applied`
}

/** Everything about Ciara that must go, as it was typed. */
const CIARA = {
  name: 'Ciara Ní Mhurchú',
  phone: '+353 86 555 0101',
  newPhone: '+353 86 555 0202',
  email: 'ciara.nm@example.ie',
  notes: 'Allergic to nuts',
  knownAs: 'Kiki B',
  company: { name: 'Mhurchú Rigging Ltd', vatNumber: 'IE9988776Q', croNumber: '7654321' },
  dayOff: 'At a wedding in Galway',
  answer: 'Bringing my own harness',
}
/** None of these may be left anywhere once she's erased. */
const TRACES = ['Ciara', 'Mhurch', '555 01', '555 02', 'ciara.nm', 'Allergic', 'Kiki B', 'IE9988776Q', '7654321', 'Rope access', 'Red Cross', 'wedding', 'harness']

const ciara = (over: Partial<CommandInput<'person.upsert'>> = {}): CommandInput<'person.upsert'> => ({
  id: 'p7',
  name: CIARA.name,
  kind: 'freelancer',
  email: CIARA.email,
  phone: CIARA.phone,
  skills: ['rigging', 'climbing'],
  dayRateCents: 30000,
  notes: CIARA.notes,
  department: 'Rope access',
  level: 3,
  knownAs: CIARA.knownAs,
  certificates: { 'first-aid': { held: true, expires: '2027-05-01', note: 'Red Cross' } },
  company: CIARA.company,
  ...over,
})

const call = (id: string, from: number, to: number, over: Partial<CommandInput<'call.create'>> = {}) =>
  m('call.create', {
    id,
    project: 'Body & Soul',
    phase: 'Build',
    venue: 'Ballinlough Castle',
    role: 'Rigger',
    start: day(from),
    end: day(to),
    callTime: '08:00',
    needed: 1,
    dayRateCents: 30000,
    details: '',
    replyBy: null,
    ...over,
  })

/** The in-process app as a device reaches it. */
const link = (app: FastifyInstance): Transport => ({
  async push(req) {
    return (await app.inject({ method: 'POST', url: '/api/sync/push', payload: req })).json()
  },
  async pull(after) {
    return (await app.inject({ method: 'GET', url: `/api/sync/pull?after=${after}` })).json()
  },
})
const offline: Transport = { push: () => Promise.reject(new Error('offline')), pull: () => Promise.reject(new Error('offline')) }

/** A device: a new laptop on its first sync, or one opening the copy it saved. */
async function device(app: FastifyInstance, storage = new MemoryStorage()) {
  const client = await new SyncClient({ storage, transport: link(app) }).open()
  return { client, storage }
}

/** Every row of a table as text, to search for anything left. */
async function everything(db: Db, table: string): Promise<string> {
  const { rows } = await db.query(`SELECT row_to_json(t)::text AS j FROM ${table} t`)
  return rows.map((r) => r.j as string).join('\n')
}

function noTraces(text: string, where: string) {
  for (const t of TRACES) expect(text.toLowerCase(), `${where} still holds "${t}"`).not.toContain(t.toLowerCase())
}

/**
 * Ciara, a freelancer: her details, changed once so the feed holds an
 * older phone; days off with a note; an answer on her link with a note; a
 * refusal that names her; then archived. The job she worked is over.
 */
async function ciaraOnRecord(app: FastifyInstance) {
  await ok(app, m('person.upsert', ciara()), m('person.contact', { id: 'p7', phone: CIARA.newPhone }))
  await ok(app, m('unavailability.add', { id: 'away1', personId: 'p7', start: day(20), end: day(21), note: CIARA.dayOff }))
  await ok(app, call('past', -10, -8), m('offer.send', { id: 'o-past', callId: 'past', personId: 'p7', override: false }))
  const token = (await app.inject({ url: '/api/sync/pull?after=0' })).json().changes.findLast((c: { entity: string; id: string }) => c.entity === 'person' && c.id === 'p7').data.linkToken
  const answered = await app.inject({
    method: 'POST',
    url: `/f/${token}/offers/o-past`,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': IPHONE },
    payload: new URLSearchParams({ answer: 'accept', note: CIARA.answer }).toString(),
  })
  expect(answered.statusCode).toBe(303)
  await ok(app, m('offer.confirm', { id: 'o-past' }))
  // A future offer stops the archive, in words that name her; withdrawn, it doesn't.
  await ok(app, call('next', 30, 31), m('offer.send', { id: 'o-next', callId: 'next', personId: 'p7', override: false }))
  expect(await refusal(app, m('person.archive', { id: 'p7', archived: true }))).toContain(CIARA.name)
  await ok(app, m('offer.cancel', { id: 'o-next' }), m('person.archive', { id: 'p7', archived: true }))
  return token as string
}

describe('erasing someone with no paid work', () => {
  it('takes their details from their row, the feed, the history, the export and a new device, and their link and feed stop', async () => {
    // Proves: every place the search found that held Ciara's details holds none of them once she is erased, and her link and feed answer "gone".
    const { app, db } = await server()
    const token = await ciaraOnRecord(app)
    const feed = await feedCodeFor(token)
    const before = await (await app.inject({ url: '/api/export' })).json()
    expect(JSON.stringify(before)).toContain('Allergic to nuts')

    await ok(app, m('person.erase', { id: 'p7' }))

    const { rows } = await db.query(`SELECT * FROM people WHERE id = 'p7'`)
    expect(rows[0]).toMatchObject({
      name: ERASED_NAME,
      email: null,
      phone: null,
      notes: '',
      skills: [],
      day_rate_cents: null,
      department: null,
      level: 1,
      known_as: null,
      certificates: {},
      company_name: null,
      company_vat_number: null,
      company_cro_number: null,
      archived: true,
      approves_leave: false,
    })
    expect(rows[0]!.link_token).not.toBe(token)
    // Her days off go; her offers stay, as records of work, without what she wrote.
    expect((await db.query(`SELECT * FROM unavailability WHERE person_id = 'p7'`)).rows).toEqual([])
    expect((await db.query(`SELECT id, status, note FROM offers WHERE person_id = 'p7' ORDER BY id`)).rows).toEqual([
      { id: 'o-next', status: 'cancelled', note: '' },
      { id: 'o-past', status: 'confirmed', note: '' },
    ])

    for (const table of ['people', 'unavailability', 'offers', 'changes', 'mutations']) noTraces(await everything(db, table), table)
    noTraces(JSON.stringify(await (await app.inject({ url: '/api/export' })).json()), 'the export')

    const history: HistoryPage = (await app.inject({ url: '/api/history?limit=200' })).json()
    noTraces(JSON.stringify(history), 'the history')
    expect(history.entries[0]!.what).toBe("Erased a person's details on request")
    expect(history.entries.map((e) => e.what)).toContain(`Saved ${ERASED_NAME}'s details`)
    expect(history.entries.map((e) => e.what)).toContain(`Marked ${ERASED_NAME} away on dates since removed`)
    // The answer on her link is still hers, by the name she now has, but not from her phone.
    const onLink = history.entries.find((e) => e.who.kind === 'link')!
    expect(onLink).toMatchObject({ who: { name: ERASED_NAME } })
    expect(onLink.device).toBeUndefined()

    // A laptop starting today pulls the whole feed, older copies included, and finds nothing older.
    const laptop = await device(app)
    await laptop.client.sync()
    noTraces(JSON.stringify(await laptop.storage.load()), 'a new device')
    const shown = laptop.client.view().crew.people.find((p) => p.id === 'p7')!
    expect(shown).toMatchObject({ name: ERASED_NAME, archived: true, email: null, phone: null, linkToken: '' })
    expect(laptop.client.view().erasures.p7).toMatchObject({ id: 'p7', nameKeptUntil: null, pending: false })

    // The old link says it doesn't work any more; both feed addresses answer as gone.
    const page = await app.inject({ url: `/f/${token}` })
    expect(page.statusCode).toBe(404)
    expect(flashOf(page.body).message).toBe("This link doesn't work any more. Ask the office to send you a new one.")
    expect((await app.inject({ url: `/cal/${feed}.ics` })).statusCode).toBe(404)
    expect((await app.inject({ url: `/f/${token}/calendar.ics` })).statusCode).toBe(404)
    expect((await app.inject({ url: `/f/${token}/data.json` })).statusCode).toBe(404)
  })

  it('reaches a device that held her before, and what it was still holding about her', async () => {
    // Proves: a device that synced her details, and holds a change about her it hasn't sent, ends with nothing older once the erasure arrives.
    const { app } = await server()
    await ciaraOnRecord(app)
    const office = await device(app)
    await office.client.sync()
    expect(JSON.stringify(await office.storage.load())).toContain(CIARA.notes)
    // An edit made with no signal, still waiting, and the erasure from another laptop meanwhile.
    const storage = office.storage
    const away = await new SyncClient({ storage, transport: offline }).open()
    await away.mutate('person.upsert', ciara({ notes: 'Allergic to nuts and shellfish' }))
    await ok(app, m('person.erase', { id: 'p7' }))

    const { client } = await device(app, storage)
    await client.sync()
    const kept = await storage.load()
    noTraces(JSON.stringify(kept), 'the device that held her')
    expect(kept!.outbox).toEqual([])
    expect(kept!.problems.map((p) => p.reason.message)).toEqual(["This person's details were erased on request, so nothing more can be recorded for them."])
    expect(client.view().crew.people.find((p) => p.id === 'p7')!.name).toBe(ERASED_NAME)
  })

  it('records nothing more about her, and keeps only what erasing keeps of a change that arrives late', async () => {
    // Proves: once erased, an edit, contact details, days off or being brought back are refused in plain words, and none of what they carried is stored.
    const { app, db } = await server()
    await ciaraOnRecord(app)
    await ok(app, m('person.erase', { id: 'p7' }))
    const said = "This person's details were erased on request, so nothing more can be recorded for them."
    expect(await refusal(app, m('person.upsert', ciara()))).toBe(said)
    expect(await refusal(app, m('person.contact', { id: 'p7', phone: CIARA.phone }))).toBe(said)
    expect(await refusal(app, m('unavailability.add', { id: 'away2', personId: 'p7', start: day(40), end: day(40), note: CIARA.dayOff }))).toBe(said)
    expect(await refusal(app, m('person.archive', { id: 'p7', archived: false }))).toBe(said)
    for (const table of ['people', 'changes', 'mutations']) noTraces(await everything(db, table), table)
    // Sent again, it changes nothing and says nothing more.
    expect(await refusal(app, m('person.erase', { id: 'p7' }))).toBe('applied')
  })
})

describe('erasing someone with paid work in the last six years', () => {
  it('keeps their name and timesheets, with their figures, for Revenue, and everything else goes', async () => {
    // Proves: an approved timesheet keeps the name and the pay for six whole years after the year it was approved in; the rest goes as for anyone, and the name can't be taken early.
    const { app, db } = await server()
    await ciaraOnRecord(app)
    await ok(app, m('timesheet.send', { id: 'o-past', days: [day(-10), day(-9)], extras: [{ what: 'Parking', cents: 1200 }], note: 'Parking at the castle, near my mam' }))
    await ok(app, m('timesheet.approve', { id: 'o-past', days: [day(-10), day(-9)], dayRateCents: 30000, extras: [{ what: 'Parking', cents: 1200 }], officeNote: 'Paid with the September run' }))
    await ok(app, m('person.erase', { id: 'p7' }))

    // Six whole years after the year it was approved in, as Revenue counts.
    const until = `${Number(today.slice(0, 4)) + 7}-01-01`
    const { rows } = await db.query(`SELECT name, phone, email, notes, known_as, company_name FROM people WHERE id = 'p7'`)
    expect(rows[0]).toEqual({ name: CIARA.name, phone: null, email: null, notes: '', known_as: null, company_name: null })
    expect((await db.query(`SELECT person_id, name_kept_until::text AS until FROM erasures`)).rows).toEqual([{ person_id: 'p7', until }])
    const sheet = (await db.query(`SELECT status, days, day_rate_cents, extras, note, office_note FROM timesheets WHERE id = 'o-past'`)).rows[0]
    expect(sheet).toEqual({ status: 'approved', days: [day(-10), day(-9)], day_rate_cents: 30000, extras: [{ what: 'Parking', cents: 1200 }], note: '', office_note: 'Paid with the September run' })
    const changes = await everything(db, 'changes')
    expect(changes).not.toContain('my mam')
    expect(changes).not.toContain(CIARA.phone)
    expect(changes).not.toContain(CIARA.notes)

    const history: HistoryPage = (await app.inject({ url: '/api/history?limit=200' })).json()
    expect(history.entries.map((e) => e.what)).toContain(`Approved ${CIARA.name}'s timesheet for Rigger on Body & Soul: 2 days at €300, and €12 of extras: €612`)
    expect(await refusal(app, m('person.erase', { id: 'p7' }))).toMatch(new RegExp(`^${CIARA.name}'s name is kept for Revenue's records until .* ${until.slice(0, 4)}, and can be erased from then\\.$`))
  })
})

describe('erasing is refused', () => {
  it('until someone is archived, and while they are booked on a job that has not ended', async () => {
    // Proves: two deliberate steps (archive, then erase), and nothing unsettled is erased away; each refusal says what to do.
    const { app } = await server()
    await ok(app, m('person.upsert', ciara()))
    expect(await refusal(app, m('person.erase', { id: 'p7' }))).toBe(`${CIARA.name} isn't archived. Archive them first, then erase their details.`)
    // Booked for yesterday on a job that runs to tomorrow: archived, as her days are over, but the job isn't.
    await ok(app, call('now', -1, 1), m('offer.send', { id: 'o-now', callId: 'now', personId: 'p7', override: false }))
    await ok(app, m('offer.respond', { id: 'o-now', answer: 'accept', days: [day(-1)], note: '' }), m('offer.confirm', { id: 'o-now' }))
    await ok(app, m('person.archive', { id: 'p7', archived: true }))
    expect(await refusal(app, m('person.erase', { id: 'p7' }))).toBe(
      `${CIARA.name} is booked on Body & Soul (Build), which hasn't ended. Erase their details once it has, or release them first.`
    )
  })

  it('while a timesheet of theirs waits for approval, so their pay is on record under their name', async () => {
    // Proves: a timesheet sent but not approved stops the erasure, naming the job.
    const { app } = await server()
    await ok(app, m('person.upsert', ciara()), call('past', -10, -8), m('offer.send', { id: 'o-past', callId: 'past', personId: 'p7', override: false }))
    await ok(app, m('offer.respond', { id: 'o-past', answer: 'accept', days: null, note: '' }), m('offer.confirm', { id: 'o-past' }))
    await ok(app, m('timesheet.send', { id: 'o-past', days: [day(-10)], extras: [], note: '' }), m('person.archive', { id: 'p7', archived: true }))
    expect(await refusal(app, m('person.erase', { id: 'p7' }))).toBe(`${CIARA.name} has a timesheet waiting on Body & Soul: approve it first, so their pay is on record.`)
  })
})

describe('erasing is refused, naming the first thing unsettled', () => {
  it('by its first day, in the words the device uses', async () => {
    // Proves: with two phases still to come, the server names the one that starts first, as the device does (shared/test/erasure.test.ts), whatever order the jobs come in.
    const { app } = await server()
    const job = (id: string, name: string) => m('project.create', { id, name, clientId: null, venueId: null, status: 'confirmed', notes: '' })
    const phase = (id: string, projectId: string, name: string, from: number, to: number) =>
      m('phase.add', { id, projectId, name, start: day(from), end: day(to), venueId: null, notes: '', contactId: 'p7' })
    await ok(app, m('person.upsert', ciara()), job('ep', 'Electric Picnic'), job('bs', 'Body & Soul'))
    await ok(app, phase('ep-prep', 'ep', 'Prep', -30, -30), phase('ep-show', 'ep', 'Show', 60, 61), phase('bs-build', 'bs', 'Build', 10, 11))
    await ok(app, m('person.archive', { id: 'p7', archived: true }))
    expect(await refusal(app, m('person.erase', { id: 'p7' }))).toBe(`${CIARA.name} is the contact on the day for Body & Soul (Build), which hasn't ended. Choose someone else first.`)
  })
})

describe('erasing a member of staff who signs in', () => {
  it('ends their sessions and takes their name and email off their account, so the history calls them Erased person', async () => {
    // Proves: an erased person's sign-in record goes with them: signed out at once, no name or email left, switched off; their leave goes too.
    const { app, db } = await signedIn()
    const colly = await staff(app, db, 'Colly Hewson', WINDOWS, 'office-c0ffee')
    const cian = await staff(app, db, 'Cian Murphy', IPHONE, 'phone-c1an00')
    const person = (id: string, name: string, email: string, approvesLeave: boolean, phone: string | null): CommandInput<'person.upsert'> => ({
      id,
      name,
      kind: 'staff',
      email,
      phone,
      skills: [],
      dayRateCents: null,
      notes: '',
      approvesLeave,
    })
    expect(await colly.send('person.upsert', person('colly', 'Colly Hewson', colly.email, true, null))).toMatchObject({ status: 'applied' })
    expect(await colly.send('person.upsert', person('s2', 'Cian Murphy', cian.email, false, '+353 87 444 0909'))).toMatchObject({ status: 'applied' })
    expect(await cian.send('leave.request', { id: 'ski', personId: 's2', type: 'annual', start: '2031-03-03', end: '2031-03-07', note: 'Skiing in Andorra' })).toMatchObject({
      status: 'applied',
    })
    expect(await colly.send('leave.decide', { id: 'ski', approved: true, reason: '' })).toMatchObject({ status: 'applied' })
    expect((await app.inject({ url: '/api/me', cookies: cian.cookies })).statusCode).toBe(200)

    expect(await colly.send('person.archive', { id: 's2', archived: true })).toMatchObject({ status: 'applied' })
    expect(await colly.send('person.erase', { id: 's2' })).toMatchObject({ status: 'applied' })

    expect((await app.inject({ url: '/api/me', cookies: cian.cookies })).statusCode).toBe(401)
    expect((await db.query(`SELECT count(*)::int AS n FROM sessions WHERE user_id = $1`, [cian.id])).rows[0]).toEqual({ n: 0 })
    expect((await db.query(`SELECT name, email, picture, disabled, google_sub LIKE 'erased:%' AS gone FROM users WHERE id = $1`, [cian.id])).rows[0]).toEqual({
      name: ERASED_NAME,
      email: '',
      picture: null,
      disabled: true,
      gone: true,
    })
    for (const table of ['leave_requests', 'unavailability']) expect((await db.query(`SELECT * FROM ${table} WHERE person_id = 's2'`)).rows).toEqual([])
    for (const table of ['people', 'users', 'changes', 'mutations']) {
      const text = await everything(db, table)
      for (const t of ['Cian', 'cian@', 'Andorra', '444 0909']) expect(text, `${table} still holds "${t}"`).not.toContain(t)
    }
    const history = await colly.history('?limit=200')
    const made = history.entries.find((e) => e.command === 'leave.request')!
    expect(made.who).toMatchObject({ kind: 'staff', name: ERASED_NAME })
    expect(made.what).toBe(`${ERASED_NAME} asked for annual leave, on dates since removed`)
    expect(history.people?.map((p) => p.name)).toEqual(['Colly Hewson', ERASED_NAME])
  })
})

describe('their staff account, found by their addresses', () => {
  const person = (id: string, name: string, email: string | null, kind: 'staff' | 'freelancer' = 'staff'): CommandInput<'person.upsert'> => ({
    id,
    name,
    kind,
    email,
    phone: null,
    skills: [],
    dayRateCents: null,
    notes: '',
    approvesLeave: id === 'colly',
  })

  it('reaches an account made with an address they had before, and leaves alone one someone else in the app still has', async () => {
    // Proves: the account is found by every address on their record, now or before, and an address on another person's record (a second record for the same person, or one shared) keeps its account and its history.
    const { app, db } = await signedIn()
    const colly = await staff(app, db, 'Colly Hewson', WINDOWS, 'office-c0ffee')
    const cian = await staff(app, db, 'Cian Murphy', IPHONE, 'phone-c1an00')
    const aoife = await staff(app, db, 'Aoife Byrne', IPHONE, 'phone-a0f1e0')
    await colly.send('person.upsert', person('colly', 'Colly Hewson', colly.email))
    // Cian changed his address on his card after he first signed in.
    await colly.send('person.upsert', person('cian', 'Cian Murphy', cian.email))
    await colly.send('person.contact', { id: 'cian', email: 'cian.murphy@example.ie' })
    // Aoife freelanced before she joined: her old card, archived, has her work address too.
    await colly.send('person.upsert', person('aoife', 'Aoife Byrne', aoife.email))
    await colly.send('person.upsert', person('aoife-old', 'Aoife Byrne (freelance)', aoife.email, 'freelancer'))
    for (const id of ['cian', 'aoife-old']) {
      expect(await colly.send('person.archive', { id, archived: true })).toMatchObject({ status: 'applied' })
      expect(await colly.send('person.erase', { id })).toMatchObject({ status: 'applied' })
    }

    expect((await app.inject({ url: '/api/me', cookies: cian.cookies })).statusCode).toBe(401)
    expect((await db.query(`SELECT name, email, disabled FROM users WHERE id = $1`, [cian.id])).rows[0]).toEqual({ name: ERASED_NAME, email: '', disabled: true })
    for (const t of ['Cian Murphy', cian.email, 'cian.murphy@example.ie']) expect(await everything(db, 'mutations'), t).not.toContain(t)
    // Aoife is still at work: signed in, by her name, with her address in her own history.
    expect((await app.inject({ url: '/api/me', cookies: aoife.cookies })).statusCode).toBe(200)
    expect((await db.query(`SELECT name, email, disabled FROM users WHERE id = $1`, [aoife.id])).rows[0]).toEqual({ name: 'Aoife Byrne', email: aoife.email, disabled: false })
    expect((await db.query(`SELECT args->>'email' AS email FROM mutations WHERE name = 'person.upsert' AND args->>'id' = 'aoife'`)).rows).toEqual([{ email: aoife.email }])
  })

  it('turns down a decision on their leave that arrives after the erasure, and keeps none of its reason', async () => {
    // Proves: leave goes with an erasure, but a decision on it sent late from a device is still known to be about them by the request that made it.
    const { app, db } = await signedIn()
    const colly = await staff(app, db, 'Colly Hewson', WINDOWS, 'office-c0ffee')
    const cian = await staff(app, db, 'Cian Murphy', IPHONE, 'phone-c1an00')
    await colly.send('person.upsert', person('colly', 'Colly Hewson', colly.email))
    await colly.send('person.upsert', person('cian', 'Cian Murphy', cian.email))
    expect(await cian.send('leave.request', { id: 'r1', personId: 'cian', type: 'annual', start: '2031-03-03', end: '2031-03-04', note: '' })).toMatchObject({ status: 'applied' })
    expect(await cian.send('lieu.log', { id: 'l1', personId: 'cian', day: day(-3), days: 1, note: '' })).toMatchObject({ status: 'applied' })
    await colly.send('person.archive', { id: 'cian', archived: true })
    await colly.send('person.erase', { id: 'cian' })

    const late = await colly.send('leave.decide', { id: 'r1', approved: false, reason: 'Cian, the Body & Soul build needs you that week' })
    expect(late).toMatchObject({ status: 'rejected', reason: { message: "This person's details were erased on request, so nothing more can be recorded for them." } })
    expect(await colly.send('lieu.decide', { id: 'l1', approved: false, reason: 'Cian worked a half day' })).toMatchObject({ status: 'rejected' })
    expect(await everything(db, 'mutations')).not.toContain('Cian')
  })
})

describe('what other people have', () => {
  it('stays as it was: an address inside a longer one, a number inside an amount, a name inside a longer name', async () => {
    // Proves: the history loses the erased person's address, number and name as whole words only, so nobody else's record is changed.
    const { app, db } = await server()
    const person = (id: string, name: string, over: Partial<CommandInput<'person.upsert'>> = {}) =>
      m('person.upsert', { id, name, kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '', ...over })
    await ok(
      app,
      person('dan', 'Dan Byrne', { email: 'dan@gmail.com', phone: '000000' }),
      person('jordan', 'Jordan Kelly', { email: 'jordan@gmail.com' }),
      person('rate', 'Ríona Walsh', { dayRateCents: 1000000 }),
      person('mk', 'Mary Kelly', { email: 'mary.k@example.ie' }),
      person('mkb', 'Mary Kelly-Byrne'),
      person('bs', 'Brien Smith'),
      person('obs', "Seán Ó'Brien Smith")
    )
    for (const id of ['dan', 'mk', 'mkb', 'bs', 'obs']) await ok(app, m('person.archive', { id, archived: true }))
    // Refusals that name each of them, as the history keeps them.
    for (const id of ['mk', 'mkb', 'bs', 'obs']) await send(app, m('person.level', { id, level: 2 }))
    // "Mary Kelly's": her Google account wrote the jobs to the calendar, until it was disconnected.
    await db.query(`INSERT INTO calendar_link (id, state, app_key, account_email) VALUES ('main', 'on', 'key', 'mary.k@example.ie')`)
    await send(app, m('person.erase', { id: 'mk' }))
    await db.query(`UPDATE calendar_link SET state = 'off', account_email = NULL`)
    for (const id of ['dan', 'mk', 'bs']) await ok(app, m('person.erase', { id }))

    const stored = (id: string) => db.query(`SELECT args->>'email' AS email, (args->>'dayRateCents')::int AS rate FROM mutations WHERE name = 'person.upsert' AND args->>'id' = $1`, [id])
    expect((await stored('jordan')).rows).toEqual([{ email: 'jordan@gmail.com', rate: null }])
    expect((await stored('rate')).rows).toEqual([{ email: null, rate: 1000000 }])
    const { rows } = await db.query<{ said: string }>(`SELECT result->'reason'->>'message' AS said FROM mutations WHERE status = 'rejected' ORDER BY received_at, id`)
    expect(rows.map((r) => r.said)).toEqual([
      `${ERASED_NAME} has been archived. Bring them back on the Crew tab to change their level.`,
      'Mary Kelly-Byrne has been archived. Bring them back on the Crew tab to change their level.',
      `${ERASED_NAME} has been archived. Bring them back on the Crew tab to change their level.`,
      "Seán Ó'Brien Smith has been archived. Bring them back on the Crew tab to change their level.",
      `${ERASED_NAME}'s Google account writes the jobs to Google Calendar: connect another account on the Account tab first.`,
    ])
  })
})

describe('a restore from a backup taken before an erasure', () => {
  it('leaves them erased: the list beside the backups is applied again before anyone can use the copy', async () => {
    // Proves: the backup still holds her details, but a restore of it puts nobody back, and a device sending her old details again is turned away.
    const dir = folder()
    const store = dirStore(dir)
    const { app } = await server(undefined, store)
    await ciaraOnRecord(app)
    const backup = await app.backups.run('manual')
    expect(backup.status).toBe('ok')
    await ok(app, m('person.erase', { id: 'p7' }))
    await app.erasures!.keep()
    // Ids and dates only beside the backups.
    const list = (await store.get(LIST_KEY)).toString('utf8')
    expect(JSON.parse(list).erasures).toEqual([{ id: 'p7', erasedAt: expect.any(String), nameKeptUntil: null }])
    noTraces(list, 'the list of erasures')

    const fresh = await database()
    const restored = await restoreFrom(fresh, store, 'latest')
    expect(restored).toMatchObject({ key: backup.key, erasedAgain: 1 })
    expect((await fresh.query(`SELECT name, phone FROM people WHERE id = 'p7'`)).rows[0]).toEqual({ name: ERASED_NAME, phone: null })
    for (const table of ['people', 'unavailability', 'offers', 'changes', 'mutations']) noTraces(await everything(fresh, table), `${table} after the restore`)

    const again = await server(fresh, store)
    const history: HistoryPage = (await again.app.inject({ url: '/api/history?limit=5' })).json()
    expect(history.entries[0]!.what).toBe("Erased a person's details again, after the data was put back from a backup")
    // A laptop sending again what it sent before the backup: her details are refused, and not stored.
    expect(await refusal(again.app, m('person.upsert', ciara()))).toBe("This person's details were erased on request, so nothing more can be recorded for them.")
    noTraces(await everything(fresh, 'mutations'), 'the history after a resend')
  })

  it('keeps someone erased whom the backup had never heard of, so a resend after it can not add them', async () => {
    // Proves: the list holds people added after the backup too, and a restore keeps them on it.
    const store = dirStore(folder())
    const { app } = await server(undefined, store)
    await ok(app, m('person.upsert', { id: 'dara', name: 'Dara Quinn', kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '' }))
    expect((await app.backups.run('manual')).status).toBe('ok')
    await ciaraOnRecord(app)
    await ok(app, m('person.erase', { id: 'p7' }))
    await app.erasures!.keep()

    const fresh = await database()
    expect(await restoreFrom(fresh, store, 'latest')).toMatchObject({ erasedAgain: 0 })
    const again = await server(fresh, store)
    expect(await refusal(again.app, m('person.upsert', ciara()))).toBe("This person's details were erased on request, so nothing more can be recorded for them.")
    expect((await fresh.query(`SELECT * FROM people WHERE id = 'p7'`)).rows).toEqual([])
  })
})

describe('the history', () => {
  it('has words for an erasure applied again after a restore, with no name', () => {
    // Proves: what the server records itself after a restore reads as words, like every command.
    const nothing = () => undefined
    expect(inWords(ERASED_AGAIN_ACTION, { id: 'p7' }, nothing)).toBe("Erased a person's details again, after the data was put back from a backup")
    expect(inWords('person.erase', { id: 'p7' }, nothing)).toBe("Erased a person's details on request")
  })
})
