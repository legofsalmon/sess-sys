import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addDays,
  dayLabel,
  daysLabel,
  eachDay,
  ERASED_NAME,
  ERASED_REFUSAL,
  feedCodeFor,
  irishToday,
  leaveDays,
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
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.ts'
import { restoreFrom } from '../src/backup/service.ts'
import { dirStore, type BackupStore } from '../src/backup/store.ts'
import { pgliteDb, type Db } from '../src/db.ts'
import { describe as inWords, ERASED_AGAIN_ACTION, ERASED_WHEN_DUE_ACTION } from '../src/history.ts'
import { DueErasures, eraseWhatIsDue } from '../src/erasure/due.ts'
import { LIST_KEY } from '../src/erasure/list.ts'
import { flashOf, IPHONE, server as signedIn, staff, typedOnly, WINDOWS } from './people.ts'

/**
 * Erasing a person's details on request (ADR 0027): everywhere they live
 * on the server goes, what Revenue and the Working Time Act need is kept
 * for as long as they need it, nothing about them can be put on record
 * again, and no restore from a backup brings them back.
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

/**
 * Years opened for leave in a test's setup, straight into the table as the migration opens a year with leave in it:
 * these tests keep leave from years long gone, and in 2031, which no approver can open today (ADR 0024).
 */
const openYears = (db: Db, ...years: number[]) => db.query(`INSERT INTO leave_years (year) SELECT unnest($1::int[]) ON CONFLICT DO NOTHING`, [years])

/** Run as on a day in a year long gone, for an allowance set then: one can be set only for this year or next. */
async function back<T>(to: number, fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${to}-06-15T12:00:00Z`))
  try {
    return await fn()
  } finally {
    vi.useRealTimers()
  }
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
  late: 'Stuck in traffic on the M50',
}
/** None of these may be left anywhere once she's erased. */
const TRACES = ['Ciara', 'Mhurch', '555 01', '555 02', 'ciara.nm', 'Allergic', 'Kiki B', 'IE9988776Q', '7654321', 'Rope access', 'Red Cross', 'IPAF 3b', 'wedding', 'harness', 'M50']

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
  // Every kind, the three that came with ADR 0028 among them.
  certificates: {
    'first-aid': { held: true, expires: '2027-05-01', note: 'Red Cross' },
    'safe-pass': { held: true, expires: '2027-06-01', note: '' },
    'working-at-height': { held: true, expires: '2027-07-01', note: '' },
    ipaf: { held: true, expires: '2027-08-01', note: 'IPAF 3b' },
  },
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

/** Every row of a table as text, to search for anything left of what was typed. */
async function everything(db: Db, table: string): Promise<string> {
  const { rows } = await db.query(`SELECT row_to_json(t)::text AS j FROM ${table} t`)
  return typedOnly(rows.map((r) => r.j as string).join('\n'))
}

function noTraces(text: string, where: string) {
  const left = typedOnly(text).toLowerCase()
  for (const t of TRACES) expect(left, `${where} still holds "${t}"`).not.toContain(t.toLowerCase())
}

/**
 * Ciara, a freelancer: her details, changed once so the feed holds an
 * older phone; days off with a note; an answer on her link with a note; a
 * note on her link that she's running late today, which the office
 * noted; a refusal that names her; then archived. The job she worked is
 * over, and she was let go from today's.
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
  // Booked today, she says on her link she's running late (ADR 0028), and the office notes it.
  await ok(app, call('today', 0, 0), m('offer.send', { id: 'o-today', callId: 'today', personId: 'p7', override: false }))
  await ok(app, m('offer.respond', { id: 'o-today', answer: 'accept', days: null, note: '' }), m('offer.confirm', { id: 'o-today' }))
  const late = await app.inject({
    method: 'POST',
    url: `/f/${token}/late`,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': IPHONE },
    payload: new URLSearchParams({ offer: 'o-today', day: day(0), by: '30', at: '', note: CIARA.late }).toString(),
  })
  expect(late.statusCode).toBe(303)
  const said = (await app.inject({ url: '/api/sync/pull?after=0' })).json().changes.findLast((c: { entity: string }) => c.entity === 'runningLate').data
  expect(said).toMatchObject({ personId: 'p7', offerId: 'o-today', note: CIARA.late })
  await ok(app, m('late.seen', { id: said.id }))
  // A future offer stops the archive, in words that name her; withdrawn, it doesn't. Today's booking is let go too.
  await ok(app, call('next', 30, 31), m('offer.send', { id: 'o-next', callId: 'next', personId: 'p7', override: false }))
  expect(await refusal(app, m('person.archive', { id: 'p7', archived: true }))).toContain(CIARA.name)
  await ok(app, m('offer.cancel', { id: 'o-next' }), m('offer.cancel', { id: 'o-today' }), m('person.archive', { id: 'p7', archived: true }))
  return { token: token as string, late: said.id as string }
}

describe('erasing someone with no paid work', () => {
  it('takes their details from their row, the feed, the history, the export and a new device, and their link and feed stop', async () => {
    // Proves: every place the search found that held Ciara's details holds none of them once she is erased, and her link and feed answer "gone".
    const { app, db } = await server()
    const { token, late } = await ciaraOnRecord(app)
    const feed = await feedCodeFor(token)
    // Every trace is found before, by the same search, so finding none after means each went from where it was.
    const before = typedOnly(JSON.stringify(await (await app.inject({ url: '/api/export' })).json())).toLowerCase()
    for (const t of TRACES) expect(before, `the export holds "${t}"`).toContain(t.toLowerCase())

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
      { id: 'o-today', status: 'cancelled', note: '' },
    ])
    // What she said about running late goes, so the office's queue and the contact's call sheet lose it, and every earlier copy in the feed is a deletion.
    expect((await db.query(`SELECT * FROM running_late`)).rows).toEqual([])
    expect((await db.query(`SELECT op FROM changes WHERE entity = 'runningLate'`)).rows.map((r) => r.op)).toEqual(['delete', 'delete', 'delete'])

    for (const table of ['people', 'unavailability', 'offers', 'running_late', 'changes', 'mutations']) noTraces(await everything(db, table), table)
    noTraces(JSON.stringify(await (await app.inject({ url: '/api/export' })).json()), 'the export')

    const history: HistoryPage = (await app.inject({ url: '/api/history?limit=200' })).json()
    noTraces(JSON.stringify(history), 'the history')
    expect(history.entries[0]!.what).toBe("Erased a person's details on request")
    expect(history.entries.map((e) => e.what)).toContain(`Saved ${ERASED_NAME}'s details`)
    expect(history.entries.map((e) => e.what)).toContain(`Marked ${ERASED_NAME} away on dates since removed`)
    // Running late keeps its booking and day, for the words, without what she wrote.
    expect(history.entries.map((e) => e.what)).toContain(`${ERASED_NAME} said they'll be about 30 minutes late for Body & Soul (Build), ${dayLabel(day(0))}`)
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

    // Saying she's there, or noting it, sent late from a phone: they carry only the record's id, which went with her, so
    // they're turned down as not found, in words that don't name her, and keep nothing of hers.
    const [there, noted] = [m('late.arrived', { id: late }), m('late.seen', { id: late })]
    // Sent from the app, it's the office marking her there (ADR 0028, amended), so it's said to the office.
    expect(await refusal(app, there)).toBe('That running late is no longer there.')
    expect(await refusal(app, noted)).toBe('That running late is no longer there.')
    const { rows: stored } = await db.query(`SELECT args FROM mutations WHERE id = ANY($1::text[]) ORDER BY name`, [[there.id, noted.id]])
    expect(stored.map((r) => r.args)).toEqual([{ id: late }, { id: late }])
    noTraces(await everything(db, 'mutations'), 'the history after a late Noted')
    // From this version of the app they carry her booking and the day too, which name her: turned down as erased, keeping
    // only those, as running late itself keeps them, so they hold nothing of hers either.
    const booking = { id: 'noted-on-a-phone', offerId: 'o-today', day: day(0) }
    const [there2, noted2] = [m('late.arrived', booking), m('late.seen', booking)]
    expect(await refusal(app, there2)).toBe(ERASED_REFUSAL)
    expect(await refusal(app, noted2)).toBe(ERASED_REFUSAL)
    const { rows: stored2 } = await db.query(`SELECT args FROM mutations WHERE id = ANY($1::text[])`, [[there2.id, noted2.id]])
    expect(stored2.map((r) => r.args)).toEqual([booking, booking])
    noTraces(await everything(db, 'mutations'), 'the history after a late Noted from this app')
  })

  it('reaches a device that held her before, and what it was still holding about her', async () => {
    // Proves: a device that synced her details, and holds a change about her it hasn't sent, ends with nothing older once the erasure arrives.
    const { app } = await server()
    await ciaraOnRecord(app)
    const office = await device(app)
    await office.client.sync()
    for (const held of [CIARA.notes, CIARA.late]) expect(JSON.stringify(await office.storage.load())).toContain(held)
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
    expect(client.view().late.current).toEqual([])
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
    // From the version before ADR 0028, an edit sends only the three kinds it knows, and one with none keeps them all: refused,
    // so nothing lays the later kinds back over a record that holds none.
    const { certificates, ...before } = ciara()
    expect(await refusal(app, m('person.upsert', { ...before, certificates: { 'first-aid': certificates!['first-aid']! } }))).toBe(said)
    expect(await refusal(app, m('person.upsert', before))).toBe(said)
    expect((await db.query(`SELECT certificates FROM people WHERE id = 'p7'`)).rows).toEqual([{ certificates: {} }])
    // Running late again, on the booking she was let go from: refused, and stored without her words.
    const late = m('late.say', { id: 'late2', offerId: 'o-today', day: day(0), by: '60', arriveAt: null, note: CIARA.late })
    expect(await refusal(app, late)).toBe(said)
    expect((await db.query(`SELECT args->>'note' AS note FROM mutations WHERE id = $1`, [late.id])).rows).toEqual([{ note: '' }])
    for (const table of ['people', 'running_late', 'changes', 'mutations']) noTraces(await everything(db, table), table)
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
    expect(await refusal(app, m('person.erase', { id: 'p7' }))).toMatch(new RegExp(`^${CIARA.name}'s name is kept for Revenue's records until .* ${until.slice(0, 4)}, and the app erases it that day\\.$`))
  })
})

const year = Number(today.slice(0, 4))
/** What anyone wrote in Aoife's leave, and her own details: none of it may be left once she's erased. */
const AOIFE = {
  note: 'Family wedding in Kerry',
  reason: 'Covered by Cian',
  oldNote: 'Lanzarote with the girls',
  oldReason: 'Too many away for the stocktake',
  lieuNote: 'Worked the Saturday get-out',
  lieuReason: 'Thanks for staying late',
  allowance: 'Agreed at interview',
}
const AOIFE_TRACES = ['Kerry', 'Covered by', 'Lanzarote', 'stocktake', 'get-out', 'staying late', 'interview', 'aoife@example.ie', '555 0303']
/** Her week this year, and the one four years ago, whose three years after its year are up. */
const NOW = { start: `${year}-02-09`, end: `${year}-02-13` }
const OLD = { start: `${year - 4}-02-09`, end: `${year - 4}-02-13` }
/** Three whole years after the end of this year: the day her name and this year's leave can go. */
const LEAVE_UNTIL = `${year + 4}-01-01`

const staffer = (id: string, name: string, approvesLeave: boolean) =>
  m('person.upsert', { id, name, kind: 'staff', email: `${id}@example.ie`, phone: approvesLeave ? null : '+353 87 555 0303', skills: [], dayRateCents: null, notes: '', approvesLeave })

/**
 * Aoife, on the staff, and Colly, who approves time off and says who he is
 * (sign-in is off). Aoife had a week's leave approved this year and one
 * declined four years ago, a day in lieu today, and allowances for both
 * years, each with a note or a reason, and no timesheets. Then she left.
 */
async function aoifeOnRecord(app: FastifyInstance, data: Db) {
  await openYears(data, year, year - 4)
  await ok(app, staffer('colly', 'Colly Hewson', true), staffer('aoife', 'Aoife Byrne', false))
  await ok(app, m('leave.allowance', { personId: 'aoife', year, days: 22, carriedOver: 2, note: AOIFE.allowance, by: 'colly' }))
  await back(year - 4, () => ok(app, m('leave.allowance', { personId: 'aoife', year: year - 4, days: 20, carriedOver: 0, note: AOIFE.allowance, by: 'colly' })))
  await ok(
    app,
    m('leave.request', { id: 'now', personId: 'aoife', type: 'annual', ...NOW, note: AOIFE.note }),
    m('leave.decide', { id: 'now', approved: true, reason: AOIFE.reason, by: 'colly' }),
    m('leave.request', { id: 'old', personId: 'aoife', type: 'annual', ...OLD, note: AOIFE.oldNote }),
    m('leave.decide', { id: 'old', approved: false, reason: AOIFE.oldReason, by: 'colly' }),
    m('lieu.log', { id: 'sat', personId: 'aoife', day: today, days: 1, note: AOIFE.lieuNote }),
    m('lieu.decide', { id: 'sat', approved: true, reason: AOIFE.lieuReason, by: 'colly' }),
    m('person.archive', { id: 'aoife', archived: true })
  )
  // Approving the week put it in the planner as days off.
  expect((await data.query(`SELECT id FROM unavailability WHERE person_id = 'aoife'`)).rows).toEqual([{ id: 'now' }])
}

/** What is left of Aoife in a copy of the data, to compare two copies. */
async function leftOfAoife(q: Db) {
  const rows = async (sql: string) => (await q.query(sql)).rows
  return {
    person: await rows(`SELECT name, email, phone, notes, archived FROM people WHERE id = 'aoife'`),
    erasure: await rows(`SELECT erased_at, name_kept_until::text AS until FROM erasures`),
    requests: await rows(`SELECT * FROM leave_requests ORDER BY id`),
    entries: await rows(`SELECT * FROM lieu_entries ORDER BY id`),
    allowances: await rows(`SELECT * FROM leave_allowances ORDER BY id`),
    away: await rows(`SELECT * FROM unavailability WHERE person_id = 'aoife'`),
    feed: await rows(`SELECT entity, entity_id, op, data FROM changes WHERE entity IN ('leaveRequest', 'lieuEntry', 'leaveAllowance', 'unavailability') ORDER BY seq`),
  }
}

describe('erasing a member of staff with leave on record', () => {
  it("keeps this year's leave for three years without what anyone wrote in it, takes the older, and keeps her name until the last can go", async () => {
    // Proves: Colly's decision (2 October 2026): her leave records stay for the Working Time Act's three years after the end
    // of their year, with whose, what, when, how many days and who decided, but not her note, the approver's reason or the
    // allowance's note, in the rows, every earlier copy in the feed and the stored commands; leave four years old goes, as
    // do the approved leave's days off; her name stays until 1 January three years on from next, and the office laptop
    // works out that day before it sends, as the server does.
    const { app, db: data } = await server()
    await aoifeOnRecord(app, data)
    const office = await device(app)
    await office.client.sync()
    const away = await new SyncClient({ storage: office.storage, transport: offline }).open()
    await away.mutate('person.erase', { id: 'aoife' })
    expect(away.view().erasures.aoife).toMatchObject({ nameKeptUntil: LEAVE_UNTIL, pending: true })
    const laidOver = away.view().leave
    const { client } = await device(app, office.storage)
    await client.sync()
    expect(client.view().pendingCount).toBe(0)

    expect((await data.query(`SELECT name_kept_until::text AS until FROM erasures WHERE person_id = 'aoife'`)).rows).toEqual([{ until: LEAVE_UNTIL }])
    expect((await data.query(`SELECT name, email, phone FROM people WHERE id = 'aoife'`)).rows).toEqual([{ name: 'Aoife Byrne', email: null, phone: null }])
    expect(
      (await data.query(`SELECT id, type, start_day::text AS start, end_day::text AS end, days, status, decided_by, decided_at IS NOT NULL AS decided, note, reason FROM leave_requests`)).rows
    ).toEqual([{ id: 'now', type: 'annual', ...NOW, days: leaveDays(NOW.start, NOW.end), status: 'approved', decided_by: 'colly', decided: true, note: '', reason: '' }])
    expect((await data.query(`SELECT id, day::text AS day, days, status, decided_by, note, reason FROM lieu_entries`)).rows).toEqual([
      { id: 'sat', day: today, days: 1, status: 'approved', decided_by: 'colly', note: '', reason: '' },
    ])
    expect((await data.query(`SELECT id, year, days, carried_over, note FROM leave_allowances`)).rows).toEqual([{ id: `aoife-${year}`, year, days: 22, carried_over: 2, note: '' }])
    expect((await data.query(`SELECT * FROM unavailability WHERE person_id = 'aoife'`)).rows).toEqual([])

    // The device laid it over just as the server did it.
    expect(laidOver.requests.map((r) => [r.id, r.note, r.reason])).toEqual([['now', '', '']])
    expect(laidOver.entries.map((e) => [e.id, e.note, e.reason])).toEqual([['sat', '', '']])
    expect(client.view().leave.requests.map((r) => [r.id, r.start, r.end, r.days, r.status, r.note, r.reason])).toEqual([
      ['now', NOW.start, NOW.end, leaveDays(NOW.start, NOW.end), 'approved', '', ''],
    ])

    // In the feed, every copy of what stays has lost its words, and every copy of what went is a deletion.
    const feed = (await data.query<{ entity: string; id: string; op: string }>(`SELECT entity, entity_id AS id, op FROM changes WHERE entity IN ('leaveRequest', 'lieuEntry', 'leaveAllowance', 'unavailability')`)).rows
    const ops = (entity: string, id: string) => [...new Set(feed.filter((c) => c.entity === entity && c.id === id).map((c) => c.op))]
    expect([ops('leaveRequest', 'now'), ops('lieuEntry', 'sat'), ops('leaveAllowance', `aoife-${year}`)]).toEqual([['put'], ['put'], ['put']])
    expect([ops('leaveRequest', 'old'), ops('leaveAllowance', `aoife-${year - 4}`), ops('unavailability', 'now')]).toEqual([['delete'], ['delete'], ['delete']])
    for (const table of ['people', 'leave_requests', 'lieu_entries', 'leave_allowances', 'changes', 'mutations']) {
      const text = await everything(data, table)
      for (const t of AOIFE_TRACES) expect(text, `${table} still holds "${t}"`).not.toContain(t)
    }
    const laptop = typedOnly(JSON.stringify(await office.storage.load()))
    for (const t of AOIFE_TRACES) expect(laptop, `the office laptop still holds "${t}"`).not.toContain(t)

    // The history's stored commands keep only what erasing keeps of them: no dates, notes, reasons or figures.
    const { rows: stored } = await data.query<{ name: string; args: unknown }>(`SELECT name, args FROM mutations WHERE name LIKE 'leave.%' OR name LIKE 'lieu.%'`)
    expect(stored).toHaveLength(8)
    expect(stored).toEqual(
      expect.arrayContaining([
        { name: 'leave.allowance', args: { personId: 'aoife', year, by: 'colly' } },
        { name: 'leave.allowance', args: { personId: 'aoife', year: year - 4, by: 'colly' } },
        { name: 'leave.request', args: { id: 'now', personId: 'aoife', type: 'annual' } },
        { name: 'leave.decide', args: { id: 'now', approved: true, reason: '', by: 'colly' } },
        { name: 'leave.request', args: { id: 'old', personId: 'aoife', type: 'annual' } },
        { name: 'leave.decide', args: { id: 'old', approved: false, reason: '', by: 'colly' } },
        { name: 'lieu.log', args: { id: 'sat', personId: 'aoife' } },
        { name: 'lieu.decide', args: { id: 'sat', approved: true, reason: '', by: 'colly' } },
      ])
    )
    // Its words read the dates from the record while it's kept, and have none once it has gone.
    const history: HistoryPage = (await app.inject({ url: '/api/history?limit=200' })).json()
    const words = history.entries.map((e) => e.what)
    const n = leaveDays(NOW.start, NOW.end)
    expect(words).toContain(`Aoife Byrne asked for annual leave, ${daysLabel(eachDay(NOW.start, NOW.end))} (${n} day${n === 1 ? '' : 's'})`)
    expect(words).toContain('Aoife Byrne asked for annual leave, on dates since removed')
    expect(words).toContain(`Aoife Byrne logged a day in lieu for ${dayLabel(today)}`)

    // The name can't be taken before its day.
    expect(await refusal(app, m('person.erase', { id: 'aoife' }))).toBe(
      `Aoife Byrne's name is kept for their leave records under the Working Time Act until ${dayLabel(LEAVE_UNTIL)} ${year + 4}, and the app erases it that day.`
    )
  })

  it('takes her name, and the leave kept with it, on the day the last of it can go, and not the day before', async () => {
    // Proves: the erasure sent again (a device sending it again after a restore, say) is refused on the eve of the day and
    // takes the name and every leave record left on the day, as Ireland's clock has it, with their earlier copies in the
    // feed and the refusal that named her.
    const { app, db: data } = await server()
    await aoifeOnRecord(app, data)
    await ok(app, m('person.erase', { id: 'aoife' }))
    vi.useFakeTimers({ toFake: ['Date'] })
    cleanup.push(() => {
      vi.useRealTimers()
    })

    vi.setSystemTime(new Date(`${year + 3}-12-31T23:30:00Z`))
    expect(await refusal(app, m('person.erase', { id: 'aoife' }))).toBe(
      `Aoife Byrne's name is kept for their leave records under the Working Time Act until ${dayLabel(LEAVE_UNTIL)} ${year + 4}, and the app erases it that day.`
    )
    expect((await data.query(`SELECT count(*)::int AS n FROM leave_requests`)).rows).toEqual([{ n: 1 }])

    vi.setSystemTime(new Date(`${LEAVE_UNTIL}T00:30:00Z`))
    await ok(app, m('person.erase', { id: 'aoife' }))
    expect((await data.query(`SELECT name FROM people WHERE id = 'aoife'`)).rows).toEqual([{ name: ERASED_NAME }])
    expect((await data.query(`SELECT name_kept_until FROM erasures`)).rows).toEqual([{ name_kept_until: null }])
    for (const table of ['leave_requests', 'lieu_entries', 'leave_allowances', 'unavailability']) expect((await data.query(`SELECT id FROM ${table}`)).rows, table).toEqual([])
    const ops = (await data.query<{ op: string }>(`SELECT DISTINCT op FROM changes WHERE entity IN ('leaveRequest', 'lieuEntry', 'leaveAllowance', 'unavailability')`)).rows
    expect(ops).toEqual([{ op: 'delete' }])
    for (const table of ['people', 'changes', 'mutations']) expect(await everything(data, table), table).not.toContain('Aoife')
    const history: HistoryPage = (await app.inject({ url: '/api/history?limit=200' })).json()
    expect(history.entries.map((e) => e.what)).toContain(`${ERASED_NAME} asked for annual leave, on dates since removed`)
  })

  it('ends the same after a restore of a backup taken before the erasure', async () => {
    // Proves: the backup still holds her leave with every note and reason, and the leave whose three years are up; a
    // restore applies her erasure again before anyone uses the copy, and leaves exactly what the erasure left.
    const store = dirStore(folder())
    const { app, db: data } = await server(undefined, store)
    await aoifeOnRecord(app, data)
    expect((await app.backups.run('manual')).status).toBe('ok')
    await ok(app, m('person.erase', { id: 'aoife' }))
    await app.erasures!.keep()

    const fresh = await database()
    expect(await restoreFrom(fresh, store, 'latest')).toMatchObject({ erasedAgain: 1 })
    expect(await leftOfAoife(fresh)).toEqual(await leftOfAoife(data))
    for (const table of ['people', 'leave_requests', 'lieu_entries', 'leave_allowances', 'changes', 'mutations']) {
      const text = await everything(fresh, table)
      for (const t of AOIFE_TRACES) expect(text, `${table} after the restore still holds "${t}"`).not.toContain(t)
    }
  })
})

describe('a restore from a backup taken while her leave waited for a decision', () => {
  it('brings back nothing waiting that can no longer be decided', async () => {
    // Proves: the backup holds her request and day in lieu still waiting, decided and erased since. Applied again after the
    // restore, the erasure keeps no leave that waits: nothing more can be decided for her, so it would sit in the approvers'
    // queue for good, and it records no leave. A device starting on the restored copy has nothing to approve.
    const store = dirStore(folder())
    const { app, db } = await server(undefined, store)
    await openYears(db, year)
    await ok(app, staffer('colly', 'Colly Hewson', true), staffer('aoife', 'Aoife Byrne', false))
    await ok(
      app,
      m('leave.request', { id: 'now', personId: 'aoife', type: 'annual', ...NOW, note: AOIFE.note }),
      m('lieu.log', { id: 'sat', personId: 'aoife', day: today, days: 1, note: AOIFE.lieuNote }),
      m('person.archive', { id: 'aoife', archived: true })
    )
    expect((await app.backups.run('manual')).status).toBe('ok')
    await ok(
      app,
      m('leave.decide', { id: 'now', approved: false, reason: AOIFE.reason, by: 'colly' }),
      m('lieu.decide', { id: 'sat', approved: false, reason: AOIFE.lieuReason, by: 'colly' }),
      m('person.erase', { id: 'aoife' })
    )
    await app.erasures!.keep()

    const fresh = await database()
    expect(await restoreFrom(fresh, store, 'latest')).toMatchObject({ erasedAgain: 1 })
    for (const table of ['leave_requests', 'lieu_entries']) expect((await fresh.query(`SELECT id, status FROM ${table}`)).rows, table).toEqual([])
    const again = await server(fresh, store)
    const { client } = await device(again.app)
    await client.sync()
    expect(client.view().leave.queue).toEqual([])
    for (const table of ['changes', 'mutations']) {
      const text = await everything(fresh, table)
      for (const t of AOIFE_TRACES) expect(text, `${table} after the restore still holds "${t}"`).not.toContain(t)
    }
  })
})

/** Two years ago's week: its three years are up on 1 January two years from now, before this year's. */
const THEN = { start: `${year - 2}-03-02`, end: `${year - 2}-03-06` }
const THEN_UNTIL = `${year + 2}-01-01`

/**
 * Aoife's leave from two years ago and this year, each with a note and a
 * reason, and an allowance for two years ago with its note; then she
 * leaves and asks to be erased. Niamh, still at work, has leave as old
 * and older, which nothing here may touch.
 */
async function aoifeErasedWithTwoYears(app: FastifyInstance, data: Db) {
  const niamh = m('person.upsert', { id: 'niamh', name: 'Niamh Walsh', kind: 'staff', email: null, phone: null, skills: [], dayRateCents: null, notes: '', approvesLeave: false })
  await openYears(data, year, year - 2, year - 4)
  await ok(app, staffer('colly', 'Colly Hewson', true), staffer('aoife', 'Aoife Byrne', false), niamh)
  await back(year - 2, () => ok(app, m('leave.allowance', { personId: 'aoife', year: year - 2, days: 20, carriedOver: 0, note: AOIFE.allowance, by: 'colly' })))
  await ok(
    app,
    m('leave.request', { id: 'then', personId: 'aoife', type: 'annual', ...THEN, note: AOIFE.oldNote }),
    m('leave.decide', { id: 'then', approved: true, reason: AOIFE.oldReason, by: 'colly' }),
    m('leave.request', { id: 'now', personId: 'aoife', type: 'annual', ...NOW, note: AOIFE.note }),
    m('leave.decide', { id: 'now', approved: true, reason: AOIFE.reason, by: 'colly' }),
    m('leave.request', { id: 'niamh-then', personId: 'niamh', type: 'annual', ...THEN, note: 'Lisbon for the week' }),
    m('leave.decide', { id: 'niamh-then', approved: true, reason: '', by: 'colly' }),
    m('leave.request', { id: 'niamh-old', personId: 'niamh', type: 'annual', ...OLD, note: 'Gran Canaria again' }),
    m('leave.decide', { id: 'niamh-old', approved: true, reason: '', by: 'colly' }),
    m('person.archive', { id: 'aoife', archived: true }),
    m('person.erase', { id: 'aoife' })
  )
}

/** Each leave record still on the server, and how many history entries the daily run has made. */
async function leaveLeft(q: Db) {
  const ids = async (table: string) => (await q.query<{ id: string }>(`SELECT id FROM ${table} ORDER BY id`)).rows.map((r) => r.id)
  const { rows } = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM mutations WHERE name = $1`, [ERASED_WHEN_DUE_ACTION])
  return { requests: await ids('leave_requests'), allowances: await ids('leave_allowances'), runs: rows[0]!.n }
}

describe('what an erasure kept goes on its day, with nobody to remember', () => {
  it('takes each leave record the day its three years are up, and the name the day the last can go, and nothing of anyone not erased', async () => {
    // Proves: the server's daily run (as started at start-up) takes two years ago's leave at the first moment of the day
    // its three years are up in Ireland, and not a minute before: the rows, every earlier copy in the feed, and from a
    // device that held them, in one history entry with no name. This year's leave and the name stay to their own day,
    // when both go. Niamh, never erased, keeps all of hers, whatever its age.
    const { app, db: data } = await server()
    await aoifeErasedWithTwoYears(app, data)
    const office = await device(app)
    await office.client.sync()
    let told = 0
    const daily = new DueErasures(data, { changed: () => told++ })
    vi.useFakeTimers({ toFake: ['Date'] })
    cleanup.push(() => {
      vi.useRealTimers()
    })
    const before = { requests: ['niamh-old', 'niamh-then', 'now', 'then'], allowances: [`aoife-${year - 2}`], runs: 0 }
    expect(await leaveLeft(data)).toEqual(before)

    // A minute before midnight on New Year's Eve in Ireland: nothing is due.
    vi.setSystemTime(new Date(`${year + 1}-12-31T23:59:00Z`))
    expect(await daily.run()).toBe(0)
    expect(await leaveLeft(data)).toEqual(before)

    vi.setSystemTime(new Date(`${THEN_UNTIL}T00:01:00Z`))
    expect(await daily.run()).toBe(1)
    expect(await leaveLeft(data)).toEqual({ requests: ['niamh-old', 'niamh-then', 'now'], allowances: [], runs: 1 })
    expect(told).toBe(1)
    expect((await data.query(`SELECT p.name, e.name_kept_until::text AS until FROM people p JOIN erasures e ON e.person_id = p.id`)).rows).toEqual([
      { name: 'Aoife Byrne', until: LEAVE_UNTIL },
    ])
    const ops = async (entity: string, id: string) =>
      [...new Set((await data.query<{ op: string }>(`SELECT op FROM changes WHERE entity = $1 AND entity_id = $2`, [entity, id])).rows.map((r) => r.op))]
    expect([await ops('leaveRequest', 'then'), await ops('leaveAllowance', `aoife-${year - 2}`), await ops('leaveRequest', 'now'), await ops('leaveRequest', 'niamh-then')]).toEqual([
      ['delete'],
      ['delete'],
      ['put'],
      ['put'],
    ])
    await office.client.sync()
    expect(office.client.view().leave.requests.map((r) => r.id)).toEqual(['niamh-old', 'niamh-then', 'now'])
    const history: HistoryPage = (await app.inject({ url: '/api/history?limit=5' })).json()
    expect(history.entries[0]).toMatchObject({ what: "Deleted an erased person's leave records whose three years were up", outcome: 'done' })

    // Again that day, from the timer or by hand: nothing more.
    expect(await daily.run()).toBeUndefined()
    expect(await eraseWhatIsDue(data)).toBe(0)
    expect((await leaveLeft(data)).runs).toBe(1)

    // The day the last of her leave can go, her name goes with it.
    vi.setSystemTime(new Date(`${LEAVE_UNTIL}T00:01:00Z`))
    expect(await daily.run()).toBe(1)
    expect(await leaveLeft(data)).toEqual({ requests: ['niamh-old', 'niamh-then'], allowances: [], runs: 2 })
    expect((await data.query(`SELECT p.name, e.name_kept_until FROM people p JOIN erasures e ON e.person_id = p.id`)).rows).toEqual([{ name: ERASED_NAME, name_kept_until: null }])
    expect((await app.inject({ url: '/api/history?limit=1' })).json().entries[0].what).toBe("Erased the name kept with a person's records, as the law no longer asks for it")
    for (const table of ['people', 'leave_requests', 'changes', 'mutations']) {
      const text = await everything(data, table)
      for (const t of ['Aoife', ...AOIFE_TRACES]) expect(text, `${table} still holds "${t}"`).not.toContain(t)
    }
    expect((await data.query(`SELECT id, note FROM leave_requests ORDER BY id`)).rows).toEqual([
      { id: 'niamh-old', note: 'Gran Canaria again' },
      { id: 'niamh-then', note: 'Lisbon for the week' },
    ])
    expect(await eraseWhatIsDue(data)).toBe(0)
  })

  it('takes a name kept for Revenue alone on its day too, as the server starts, and keeps the list beside the backups', async () => {
    // Proves: a freelancer's name kept with an approved timesheet goes the first day after Revenue's six years, not the day
    // before, with nobody pressing anything, when the server starts as on any day; the list beside the backups says so,
    // so a restore takes it too; the timesheet stays, with its figures, under "Erased person".
    const store = dirStore(folder())
    const { app, db } = await server(undefined, store)
    await ciaraOnRecord(app)
    await ok(app, m('timesheet.send', { id: 'o-past', days: [day(-10)], extras: [], note: '' }))
    await ok(app, m('timesheet.approve', { id: 'o-past', days: [day(-10)], dayRateCents: 30000, extras: [], officeNote: '' }), m('person.erase', { id: 'p7' }))
    expect(await eraseWhatIsDue(db, `${year + 6}-12-31`)).toBe(0)
    expect((await db.query(`SELECT name FROM people WHERE id = 'p7'`)).rows).toEqual([{ name: CIARA.name }])
    vi.useFakeTimers({ toFake: ['Date'] })
    cleanup.push(() => {
      vi.useRealTimers()
    })
    vi.setSystemTime(new Date(`${year + 7}-01-01T00:01:00Z`))
    expect(await app.dueErasures.start()).toBe(1)
    await app.erasures!.keep()
    expect((await db.query(`SELECT p.name, e.name_kept_until FROM people p JOIN erasures e ON e.person_id = p.id`)).rows).toEqual([{ name: ERASED_NAME, name_kept_until: null }])
    expect(JSON.parse((await store.get(LIST_KEY)).toString('utf8')).erasures).toEqual([{ id: 'p7', erasedAt: expect.any(String), nameKeptUntil: null }])
    expect((await db.query(`SELECT status, day_rate_cents FROM timesheets WHERE id = 'o-past'`)).rows).toEqual([{ status: 'approved', day_rate_cents: 30000 }])
    for (const table of ['people', 'changes', 'mutations']) noTraces(await everything(db, table), table)
  })

  it('looks once each day in Ireland, and two runs at once, here or on two copies of the server, take what is due once', async () => {
    // Proves: the run goes to the database once per Irish day, so a new day starts at midnight in Ireland, even an hour
    // before midnight by the server's clock in summer; and two runs at the same moment (each looks again under the lock
    // every change takes) delete once, in one history entry. Postgres proves it for two servers (postgres.test.ts).
    const { app, db: data } = await server()
    await aoifeErasedWithTwoYears(app, data)
    vi.useFakeTimers({ toFake: ['Date'] })
    cleanup.push(() => {
      vi.useRealTimers()
    })
    vi.setSystemTime(new Date(`${THEN_UNTIL}T00:01:00Z`))
    expect((await Promise.all([eraseWhatIsDue(data), eraseWhatIsDue(data)])).sort()).toEqual([0, 1])
    expect(await leaveLeft(data)).toEqual({ requests: ['niamh-old', 'niamh-then', 'now'], allowances: [], runs: 1 })
    const sent = await data.query(`SELECT c.entity, c.entity_id AS id, c.op FROM changes c JOIN mutations m ON m.id = c.mutation_id WHERE m.name = $1 AND c.entity LIKE 'leave%'`, [
      ERASED_WHEN_DUE_ACTION,
    ])
    expect(sent.rows).toEqual([
      { entity: 'leaveRequest', id: 'then', op: 'delete' },
      { entity: 'leaveAllowance', id: `aoife-${year - 2}`, op: 'delete' },
    ])

    const daily = new DueErasures(data, { changed: () => {} })
    vi.setSystemTime(new Date(`${year + 2}-06-30T22:30:00Z`))
    expect(await daily.run()).toBe(0)
    expect(await daily.run()).toBeUndefined()
    // 12.30am on 1 July in Ireland, still 30 June by the server's clock.
    vi.setSystemTime(new Date(`${year + 2}-06-30T23:30:00Z`))
    expect(await daily.run()).toBe(0)
    expect(await daily.run()).toBeUndefined()
  })
})

describe('erasing a freelancer with only days off', () => {
  it('takes their days off at once, and their name with them', async () => {
    // Proves: no law asks for a freelancer's own days off, so they go at once, every copy in the feed with them, and with
    // nothing else on record nothing keeps the name.
    const { app, db: data } = await server()
    await ok(
      app,
      m('person.upsert', { id: 'dara', name: 'Dara Quinn', kind: 'freelancer', email: null, phone: '+353 85 555 0404', skills: ['lighting'], dayRateCents: 28000, notes: '' }),
      m('unavailability.add', { id: 'fleadh', personId: 'dara', start: day(10), end: day(12), note: 'The Fleadh in Wexford' }),
      m('person.archive', { id: 'dara', archived: true })
    )
    await ok(app, m('person.erase', { id: 'dara' }))
    expect((await data.query(`SELECT * FROM unavailability`)).rows).toEqual([])
    expect((await data.query(`SELECT DISTINCT op FROM changes WHERE entity = 'unavailability'`)).rows).toEqual([{ op: 'delete' }])
    expect((await data.query(`SELECT p.name, e.name_kept_until FROM people p JOIN erasures e ON e.person_id = p.id`)).rows).toEqual([{ name: ERASED_NAME, name_kept_until: null }])
    for (const table of ['people', 'changes', 'mutations']) {
      const text = await everything(data, table)
      for (const t of ['Dara', 'Fleadh', '555 0404']) expect(text, `${table} still holds "${t}"`).not.toContain(t)
    }
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

  it('while leave or a day in lieu of theirs waits for a decision, so the leave records kept say how it ended', async () => {
    // Proves: leave stays once they're erased and nothing more can be decided for them, so anything still waiting would sit
    // in the approvers' queue for good: it stops the erasure, a request named before a day in lieu, in the device's words
    // (shared/test/erasure.test.ts). Declined, as anything for someone archived can be, it no longer does.
    const { app, db } = await server()
    await openYears(db, year)
    await ok(app, staffer('colly', 'Colly Hewson', true), staffer('aoife', 'Aoife Byrne', false))
    await ok(
      app,
      m('lieu.log', { id: 'sat', personId: 'aoife', day: today, days: 1, note: '' }),
      m('leave.request', { id: 'now', personId: 'aoife', type: 'annual', ...NOW, note: '' }),
      m('person.archive', { id: 'aoife', archived: true })
    )
    const words = (what: string) => `Aoife Byrne has ${what} waiting for a decision: decide it on the Leave screen first, so their leave records say how it ended.`
    expect(await refusal(app, m('person.erase', { id: 'aoife' }))).toBe(words('leave'))
    await ok(app, m('leave.decide', { id: 'now', approved: false, reason: '', by: 'colly' }))
    expect(await refusal(app, m('person.erase', { id: 'aoife' }))).toBe(words('a day in lieu'))
    await ok(app, m('lieu.decide', { id: 'sat', approved: false, reason: '', by: 'colly' }))
    await ok(app, m('person.erase', { id: 'aoife' }))
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
    // Proves: an erased person's sign-in record goes with them: signed out at once, no name or email left, switched off. Their
    // leave stays, without what they wrote, for the Working Time Act's three years (Colly's decision, 2 October 2026), and the
    // name on their person stays with it, but never on the account.
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
    await openYears(db, 2031)
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
    // The days off that approving it put in the planner go; the request is the record, kept until 1 January 2035 without its note.
    expect((await db.query(`SELECT * FROM unavailability WHERE person_id = 's2'`)).rows).toEqual([])
    expect((await db.query(`SELECT id, status, start_day::text AS start, end_day::text AS end, days, note, decided_by FROM leave_requests WHERE person_id = 's2'`)).rows).toEqual([
      { id: 'ski', status: 'approved', start: '2031-03-03', end: '2031-03-07', days: 5, note: '', decided_by: 'colly' },
    ])
    expect((await db.query(`SELECT p.name, e.name_kept_until::text AS until FROM people p JOIN erasures e ON e.person_id = p.id WHERE p.id = 's2'`)).rows).toEqual([
      { name: 'Cian Murphy', until: '2035-01-01' },
    ])
    expect(await everything(db, 'users')).not.toContain('Cian')
    for (const table of ['people', 'users', 'changes', 'mutations']) {
      const text = await everything(db, table)
      for (const t of ['cian@', 'Andorra', '444 0909']) expect(text, `${table} still holds "${t}"`).not.toContain(t)
    }
    const history = await colly.history('?limit=200')
    const made = history.entries.find((e) => e.command === 'leave.request')!
    expect(made.who).toMatchObject({ kind: 'staff', name: ERASED_NAME })
    // The command keeps no dates, but the record it made still has them.
    expect(made.what).toBe('Cian Murphy asked for annual leave, Mon 3 Mar to Fri 7 Mar (5 days)')
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
    // Proves: leave whose three years are up goes with an erasure, but a decision on it sent late from a device (another
    // approver's phone, say, that decided it with no signal) is still known to be about them by the request that made it.
    // The leave is from four years ago, as leave since then is now kept, and so is the name with it (Colly's decision,
    // 2 October 2026); and it is decided first, as leave still waiting now stops an erasure.
    const { app, db } = await signedIn()
    const colly = await staff(app, db, 'Colly Hewson', WINDOWS, 'office-c0ffee')
    const cian = await staff(app, db, 'Cian Murphy', IPHONE, 'phone-c1an00')
    await colly.send('person.upsert', person('colly', 'Colly Hewson', colly.email))
    await colly.send('person.upsert', person('cian', 'Cian Murphy', cian.email))
    const old = Number(today.slice(0, 4)) - 4
    await openYears(db, old)
    expect(await cian.send('leave.request', { id: 'r1', personId: 'cian', type: 'annual', start: `${old}-03-02`, end: `${old}-03-06`, note: '' })).toMatchObject({ status: 'applied' })
    expect(await cian.send('lieu.log', { id: 'l1', personId: 'cian', day: `${old}-06-06`, days: 1, note: '' })).toMatchObject({ status: 'applied' })
    expect(await colly.send('leave.decide', { id: 'r1', approved: true, reason: '' })).toMatchObject({ status: 'applied' })
    expect(await colly.send('lieu.decide', { id: 'l1', approved: true, reason: '' })).toMatchObject({ status: 'applied' })
    await colly.send('person.archive', { id: 'cian', archived: true })
    expect(await colly.send('person.erase', { id: 'cian' })).toMatchObject({ status: 'applied' })
    for (const table of ['leave_requests', 'lieu_entries']) expect((await db.query(`SELECT id FROM ${table}`)).rows, table).toEqual([])

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
    for (const table of ['people', 'unavailability', 'offers', 'running_late', 'changes', 'mutations']) noTraces(await everything(fresh, table), `${table} after the restore`)

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

describe('the search for what was typed', () => {
  it('finds a trace in words, and never in an id that holds one by chance', () => {
    // Proves: the checks here can't fail by chance, as one did when a random mutation id held "m50": an id holding a
    // trace isn't taken for what was typed, and a note beside it still is.
    const id = `${newId().slice(0, 12)}m50${newId().slice(-6)}`
    expect(() => noTraces(JSON.stringify({ id }), 'an id')).not.toThrow()
    expect(() => noTraces(JSON.stringify({ id, note: CIARA.late }), 'a note')).toThrow('a note still holds "M50"')
  })
})

describe('the history', () => {
  it('has words for an erasure applied again after a restore, with no name', () => {
    // Proves: what the server records itself after a restore reads as words, like every command.
    const nothing = () => undefined
    expect(inWords(ERASED_AGAIN_ACTION, { id: 'p7' }, nothing)).toBe("Erased a person's details again, after the data was put back from a backup")
    expect(inWords('person.erase', { id: 'p7' }, nothing)).toBe("Erased a person's details on request")
  })

  it('has words for what an erasure kept going on its day, with no name', () => {
    // Proves: the daily run's two kinds of entry say what went, and why, without naming anyone.
    const nothing = () => undefined
    expect(inWords(ERASED_WHEN_DUE_ACTION, { id: 'aoife' }, nothing)).toBe("Deleted an erased person's leave records whose three years were up")
    expect(inWords(ERASED_WHEN_DUE_ACTION, { id: 'aoife', name: true }, nothing)).toBe("Erased the name kept with a person's records, as the law no longer asks for it")
  })
})
