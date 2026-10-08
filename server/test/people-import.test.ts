import { archivedHint, readCrewList, type CrewListPreview, type CrewListResult, type MutationResult, type Person } from '@sh/shared'
import { unzipSync } from 'fflate'
import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { IPHONE, server, staff } from './people.ts'

/**
 * Crew profiles and bringing in the crew list (ADR 0025): the preview
 * matches rows by email then phone and marks a row for someone archived;
 * bringing in adds and updates as the rules say, through person.upsert, in
 * one transaction or none, keeping what the file can't hold; the same file
 * twice changes nothing and sends nothing; a match the preview didn't show
 * is refused; the level has a command of its own with plain refusals; and
 * the history and the export say what happened.
 */

const refused = (r: MutationResult) => (r.status === 'rejected' ? r.reason.message : `applied (${r.seq})`)

const HEADER = 'First Name,Last Name,Department,Phone,Email,Preferred,Onboarded,First Aider,Manual Handling Cert,Driving Licence,Day Rate (EUR),Company Name,VAT Number,CRO Number,Events Worked,Notes,Skillsets / Tags'

/** The crew list as a small made-up spreadsheet: one match by email, one by phone, one whose only match is archived, one new. */
const FILE = [
  HEADER,
  'Dara,Quinn,Audio,353877000001,DARA@example.ie,Yes,Yes,Yes,,,,Quinn Audio Ltd,IE0000001A,,,Prefers in-ears,"Audio: Monitors, Audio"',
  'Eimear,Nolan,Audio,087 700 0002,,No,Yes,,,,,,,,,,Audio: FOH',
  'Old,Timer,Video,,old@example.ie,,,,,,,,,,,,',
  'Niamh,Walsh,Production,+353 87 700 0004,niamh@sessionhire.com,Yes,,,,Yes,,,,,,,Production: Crew chief',
  'Rory,Breen,LX,0877000005,,,,,,,,,,,,"new applicant, CV received, not yet vetted",',
].join('\r\n')

/** Colly signed in, the office email set, and the Crew tab holding Dara (by email), Eimear (by phone) and an archived Old Timer. */
async function company() {
  const { app, db } = await server()
  const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
  expect(await colly.send('office.update', { name: 'Session Hire office', phone: null, email: 'office@sessionhire.com' })).toMatchObject({ status: 'applied' })
  const person = (id: string, name: string, email: string | null, phone: string | null, more = {}) =>
    colly.send('person.upsert', { id, name, kind: 'freelancer', email, phone, skills: ['Audio'], dayRateCents: 32000, notes: 'Has a van', level: 4, ...more })
  expect(await person('dara', 'Dara Quinn', 'dara@example.ie', '+353871111111')).toMatchObject({ status: 'applied' })
  expect(await person('eimear', 'Eimear Nolan', null, '+353 87 700 0002', { skills: [] })).toMatchObject({ status: 'applied' })
  expect(await person('old', 'Old Timer', 'old@example.ie', null)).toMatchObject({ status: 'applied' })
  expect(await colly.send('person.archive', { id: 'old', archived: true })).toMatchObject({ status: 'applied' })
  return { app, db, colly, person }
}

async function preview(app: FastifyInstance, cookies: Record<string, string>, text = FILE) {
  const res = await app.inject({ method: 'POST', url: '/api/people/import/preview', cookies, payload: { text } })
  expect(res.statusCode).toBe(200)
  return res.json() as CrewListPreview
}

async function bringIn(app: FastifyInstance, cookies: Record<string, string>, rows: unknown[]) {
  return app.inject({ method: 'POST', url: '/api/people/import?client=phonec0ffee', cookies, headers: { 'user-agent': IPHONE }, payload: { rows } })
}

/** The rows as the office would send them, Old Timer's skipped as the preview asks. */
const choices = (p: CrewListPreview) => p.rows.map((r) => ({ ...r, skip: r.name === 'Old Timer' }))

const peopleNamed = async (db: { query: (sql: string) => Promise<{ rows: { name: string }[] }> }) => (await db.query('SELECT name FROM people ORDER BY name')).rows.map((r) => r.name)

describe('the preview', () => {
  it('matches rows by email, then by phone, and marks a row for someone archived rather than reviving them', async () => {
    const { app, colly } = await company()
    const p = await preview(app, colly.cookies)
    expect(p.officeDomain).toBe('sessionhire.com')
    expect(p.rows.map((r) => [r.name, r.kind, r.level, r.phone, r.matched, r.problems])).toEqual([
      ['Dara Quinn', 'freelancer', 3, '+353877000001', { id: 'dara', name: 'Dara Quinn', by: 'email' }, []],
      ['Eimear Nolan', 'freelancer', 2, '+353877000002', { id: 'eimear', name: 'Eimear Nolan', by: 'phone' }, []],
      ['Old Timer', 'freelancer', 1, null, null, [archivedHint('Old Timer')]],
      ['Niamh Walsh', 'staff', 3, '+353877000004', null, []],
      ['Rory Breen', 'freelancer', 0, '+353877000005', null, []],
    ])
    expect(p.counts).toEqual({ rows: 5, new: 3, updates: 2, skipped: 0, problems: 1 })
    expect(p.rows[0]).toMatchObject({ company: { name: 'Quinn Audio Ltd', vatNumber: 'IE0000001A', croNumber: null }, certificates: { 'first-aid': { held: true } } })
  })

  it('says why a file cannot be read, and reads everyone as a freelancer until the office email is set', async () => {
    const { app, db } = await server()
    const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
    const bad = await app.inject({ method: 'POST', url: '/api/people/import/preview', cookies: colly.cookies, payload: { text: 'Phone\n0871234567' } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toBe('No name column was found. The first row needs First Name and Last Name, or Name.')
    const empty = await app.inject({ method: 'POST', url: '/api/people/import/preview', cookies: colly.cookies, payload: { text: '' } })
    expect(empty.json().error).toBe('The file is empty.')
    const p = await preview(app, colly.cookies)
    expect(p.officeDomain).toBeNull()
    expect(p.rows.find((r) => r.name === 'Niamh Walsh')?.kind).toBe('freelancer')
    // Like the rest of the office's routes: signed in, or not at all.
    expect((await app.inject({ method: 'POST', url: '/api/people/import/preview', payload: { text: FILE } })).statusCode).toBe(401)
  })
})

describe('bringing the list in', () => {
  it('takes cells with control characters in them, as copied from Word or a PDF, cleaned, and the same file again changes nothing', async () => {
    // Proves: a NUL, which the database can't hold, DEL and a vertical tab (Word's line break) in a name and the notes don't fail
    // the import: the preview shows the person as they'll be kept, they go in so, with the notes' line break kept, and the same
    // file again finds them unchanged rather than different.
    const { app, db, colly } = await company()
    const file = [HEADER, 'Siobhán\u0000,Ní Bhriain\u007f,Video,0877000006,,,,,,,,,,,,"Own camera\u000bdrone ticket",Video: Camera'].join('\r\n')
    const p = await preview(app, colly.cookies, file)
    expect(p.rows.map((r) => [r.name, r.notes, r.problems])).toEqual([['Siobhán Ní Bhriain', 'Own camera\ndrone ticket', []]])
    const res = await bringIn(app, colly.cookies, choices(p))
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ added: 1, updated: 0, unchanged: 0, skipped: 0 } satisfies CrewListResult)
    expect((await db.query(`SELECT name, notes FROM people WHERE phone = '+353877000006'`)).rows).toEqual([{ name: 'Siobhán Ní Bhriain', notes: 'Own camera\ndrone ticket' }])
    const second = await bringIn(app, colly.cookies, choices(await preview(app, colly.cookies, file)))
    expect(second.json()).toEqual({ added: 0, updated: 0, unchanged: 1, skipped: 0 })
  })

  it('adds and updates as the rules say, and the same file again changes nothing and sends nothing', async () => {
    const { app, db, colly } = await company()
    const p = await preview(app, colly.cookies)
    const res = await bringIn(app, colly.cookies, choices(p))
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ added: 2, updated: 2, unchanged: 0, skipped: 1 } satisfies CrewListResult)

    // Dara, matched by email: the file's phone, department, certificates and company; skills as the union; the notes
    // added to; and the office's level and day rate kept.
    const dara = await colly.record<Person>('person', 'dara')
    expect(dara).toMatchObject({
      name: 'Dara Quinn',
      email: 'dara@example.ie',
      phone: '+353877000001',
      department: 'Audio',
      level: 4,
      dayRateCents: 32000,
      skills: ['Audio', 'Audio: Monitors'],
      notes: 'Has a van\nPrefers in-ears',
      certificates: { 'first-aid': { held: true, expires: null, note: '' } },
      company: { name: 'Quinn Audio Ltd', vatNumber: 'IE0000001A', croNumber: null },
      archived: false,
    })
    // Eimear, matched by phone: no email in the file, so hers stays as it was (none); the phone takes the file's international form, and the file's skill is added.
    expect(await colly.record<Person>('person', 'eimear')).toMatchObject({ email: null, phone: '+353877000002', skills: ['Audio: FOH'], level: 4 })
    // Niamh is new: staff by the office's domain, Level 3 from Preferred, with a link of her own.
    const names = await peopleNamed(db)
    expect(names).toEqual(['Dara Quinn', 'Eimear Nolan', 'Niamh Walsh', 'Old Timer', 'Rory Breen'])
    const { rows: added } = await db.query<{ id: string; kind: string; level: number; link_token: string; department: string; certificates: unknown; notes: string }>(
      `SELECT id, kind, level, link_token, department, certificates, notes FROM people WHERE name IN ('Niamh Walsh', 'Rory Breen') ORDER BY name`
    )
    expect(added[0]).toMatchObject({ kind: 'staff', level: 3, department: 'Production', certificates: { 'driving-licence': { held: true } } })
    expect(added[0]!.link_token.length).toBeGreaterThanOrEqual(24)
    expect(added[1]).toMatchObject({ kind: 'freelancer', level: 0, notes: 'new applicant, CV received, not yet vetted' })

    // The history: one line per person, and one for the import, all Colly's from her phone.
    const history = await colly.history()
    expect(history.entries.slice(0, 5).map((e) => [e.who.name, e.deviceCode, e.what])).toEqual([
      ['Colly Hewson', 'c0ffee', 'Brought in the crew list: 2 added, 2 updated, 1 skipped'],
      ['Colly Hewson', 'c0ffee', "Saved Rory Breen's details"],
      ['Colly Hewson', 'c0ffee', "Saved Niamh Walsh's details"],
      ['Colly Hewson', 'c0ffee', "Saved Eimear Nolan's details"],
      ['Colly Hewson', 'c0ffee', "Saved Dara Quinn's details"],
    ])

    // The same file again: everyone matches now, nobody is added, the notes aren't added to twice, and since the
    // file would change nothing about anyone, no command is sent for them: the history gains one line, not five.
    const again = await preview(app, colly.cookies)
    expect(again.rows.map((r) => r.matched?.by ?? null)).toEqual(['email', 'phone', null, 'email', 'phone'])
    const second = await bringIn(app, colly.cookies, choices(again))
    expect(second.json()).toEqual({ added: 0, updated: 0, unchanged: 4, skipped: 1 })
    expect(await peopleNamed(db)).toEqual(['Dara Quinn', 'Eimear Nolan', 'Niamh Walsh', 'Old Timer', 'Rory Breen'])
    expect((await colly.record<Person>('person', 'dara')).notes).toBe('Has a van\nPrefers in-ears')
    const after = await colly.history()
    expect(after.entries).toHaveLength(history.entries.length + 1)
    expect(after.entries[0]!.what).toBe('Brought in the crew list: 0 added, 0 updated, 4 unchanged, 1 skipped')
  })

  it('keeps what the file cannot hold: a certificate\'s expiry and note, the VAT and CRO numbers, and notes that would overflow', async () => {
    const { app, colly, person } = await company()
    expect(
      await person('dara', 'Dara Quinn', 'dara@example.ie', '+353871111111', {
        notes: 'x'.repeat(1990),
        certificates: { 'first-aid': { held: true, expires: '2027-03-01', note: 'Card in the office' }, 'driving-licence': { held: true, expires: '2030-01-01', note: 'Full licence' } },
        company: { name: 'Quinn Audio Ltd', vatNumber: 'IE0000001A', croNumber: '123456' },
      })
    ).toMatchObject({ status: 'applied' })
    // The updated file: First Aider still Yes, Driving Licence now No, the company name alone, and a note to add.
    const file = [HEADER, 'Dara,Quinn,Audio,353871111111,dara@example.ie,,,Yes,,No,,Quinn Audio Ltd,,,,Prefers in-ears,'].join('\n')
    const p = await preview(app, colly.cookies, file)
    expect(p.rows[0]).toMatchObject({ matched: { id: 'dara' }, problems: [] })
    const res = await bringIn(app, colly.cookies, choices(p))
    expect(res.json()).toEqual({ added: 0, updated: 1, unchanged: 0, skipped: 0 })
    const dara = await colly.record<Person>('person', 'dara')
    // Only "held" comes from the file; the expiry and the note the office typed stay, even where the file says No.
    expect(dara.certificates).toEqual({
      'first-aid': { held: true, expires: '2027-03-01', note: 'Card in the office' },
      'driving-licence': { held: false, expires: '2030-01-01', note: 'Full licence' },
    })
    // The blank VAT and CRO cells erase nothing.
    expect(dara.company).toEqual({ name: 'Quinn Audio Ltd', vatNumber: 'IE0000001A', croNumber: '123456' })
    // The file's note is cut to what the notes have room for, never the office's own notes.
    expect(dara.notes).toHaveLength(2000)
    expect(dara.notes.endsWith('\nPrefers i')).toBe(true)
    // And with no room left, the next time changes nothing.
    const again = await bringIn(app, colly.cookies, choices(await preview(app, colly.cookies, file)))
    expect(again.json()).toEqual({ added: 0, updated: 0, unchanged: 1, skipped: 0 })
  })

  it('refuses the whole import on one bad row, naming it, with nothing applied', async () => {
    const { app, db, colly } = await company()
    const p = await preview(app, colly.cookies)
    const before = await colly.history()
    // A problem left in a row that isn't skipped.
    const left = await bringIn(app, colly.cookies, choices(p).map((r) => ({ ...r, phone: r.name === 'Niamh Walsh' ? 'ext 4512' : r.phone })))
    expect(left.statusCode).toBe(400)
    expect(left.json().error).toBe("Row 5 (Niamh Walsh): Couldn't read this phone number. Put it in international form, like +353 87 123 4567. Nothing was brought in.")
    // The archived person's row not skipped: never updated or brought back from the file.
    const old = await bringIn(app, colly.cookies, p.rows.map((r) => ({ ...r, skip: false })))
    expect(old.statusCode).toBe(400)
    expect(old.json().error).toBe(`Row 4 (Old Timer): ${archivedHint('Old Timer')} Nothing was brought in.`)
    // Something only person.upsert's own schema catches, in the last row: the earlier rows aren't kept either.
    const crafted = await bringIn(app, colly.cookies, choices(p).map((r) => ({ ...r, notes: r.name === 'Rory Breen' ? 'x'.repeat(2001) : r.notes })))
    expect(crafted.statusCode).toBe(400)
    expect(crafted.json().error).toBe('Row 6 (Rory Breen): The notes can be up to 2,000 characters. Nothing was brought in.')
    expect(await peopleNamed(db)).toEqual(['Dara Quinn', 'Eimear Nolan', 'Old Timer'])
    expect((await colly.record<Person>('person', 'dara')).phone).toBe('+353871111111')
    expect((await colly.history()).entries).toHaveLength(before.entries.length)
    // Nothing to do is said too.
    const none = await bringIn(app, colly.cookies, p.rows.map((r) => ({ ...r, skip: true })))
    expect(none.statusCode).toBe(400)
    expect(none.json().error).toBe('Every row is skipped, so there is nothing to bring in.')
  })

  it('refuses a row whose match is not what the preview showed, so a phone fixed to someone else never overwrites them unseen', async () => {
    const { app, colly } = await company()
    const p = await preview(app, colly.cookies)
    // Niamh's row previewed as new. The office types Dara's phone into it; sent with the preview's match still none, it's refused.
    const fixed = (matched: unknown) =>
      choices(p).map((r) => (r.name === 'Niamh Walsh' ? { ...r, phone: '087 111 1111', matched } : r.name === 'Dara Quinn' ? { ...r, skip: true } : r))
    const unseen = await bringIn(app, colly.cookies, fixed(null))
    expect(unseen.statusCode).toBe(400)
    expect(unseen.json().error).toBe("Row 5 (Niamh Walsh) now matches Dara Quinn by phone, which the preview didn't show. Choose the file again to see it. Nothing was brought in.")
    expect((await colly.record<Person>('person', 'dara')).name).toBe('Dara Quinn')
    // The other way round: a match the preview showed that has gone.
    const gone = await bringIn(app, colly.cookies, choices(p).map((r) => (r.name === 'Rory Breen' ? { ...r, matched: { id: 'dara', name: 'Dara Quinn', by: 'email' } } : r)))
    expect(gone.statusCode).toBe(400)
    expect(gone.json().error).toBe("Row 6 (Rory Breen) matched Dara Quinn in the preview, but doesn't now. Choose the file again to see it. Nothing was brought in.")
    // Once the device has matched the fixed row again and shows "Updates Dara Quinn", it's the office's choice, and goes in.
    const seen = await bringIn(app, colly.cookies, fixed({ id: 'dara', name: 'Dara Quinn', by: 'phone' }))
    expect(seen.statusCode).toBe(200)
    expect(seen.json()).toEqual({ added: 1, updated: 2, unchanged: 0, skipped: 2 })
    expect(await colly.record<Person>('person', 'dara')).toMatchObject({ name: 'Niamh Walsh', phone: '+353871111111', level: 4 })
  })
})

describe('the profile', () => {
  it('keeps what an older app leaves out, moves a level with a command of its own, and refuses a level outside 0 to 5 in plain words', async () => {
    const { app, db } = await server()
    const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
    expect(
      await colly.send('person.upsert', {
        id: 'p1',
        name: 'Dara Quinn',
        kind: 'freelancer',
        email: null,
        phone: '+353871234567',
        skills: [],
        dayRateCents: null,
        notes: '',
        department: 'Audio',
        level: 3,
        knownAs: 'Dar',
        certificates: { 'manual-handling': { held: true, expires: '2027-03-01', note: 'Card in the office' } },
        company: { name: 'Quinn Audio Ltd', vatNumber: 'IE0000001A', croNumber: null },
      })
    ).toMatchObject({ status: 'applied' })
    // An edit from before the profile existed says nothing about it, and keeps it.
    expect(await colly.send('person.upsert', { id: 'p1', name: 'Dara Quinn', kind: 'freelancer', email: null, phone: '+353871234567', skills: ['Audio'], dayRateCents: 30000, notes: '' })).toMatchObject({ status: 'applied' })
    const dara = await colly.record<Person>('person', 'p1')
    expect(dara).toMatchObject({ department: 'Audio', level: 3, knownAs: 'Dar', certificates: { 'manual-handling': { held: true, expires: '2027-03-01', note: 'Card in the office' } }, company: { name: 'Quinn Audio Ltd' }, skills: ['Audio'] })
    // The greeting on their link uses the name they go by.
    expect((await app.inject({ url: `/f/${dara.linkToken}` })).body).toContain('Hi Dar.')

    expect(await colly.send('person.level', { id: 'p1', level: 5 })).toMatchObject({ status: 'applied' })
    expect((await colly.record<Person>('person', 'p1')).level).toBe(5)
    expect(refused(await colly.send('person.level', { id: 'p1', level: 6 }))).toBe('The level is a whole number from 0 to 5.')
    expect(refused(await colly.send('person.level', { id: 'p1', level: -1 }))).toBe('The level is a whole number from 0 to 5.')
    expect(refused(await colly.send('person.level', { id: 'nobody', level: 2 }))).toBe('That person no longer exists.')
    expect((await colly.history()).entries.map((e) => e.what)).toContain('Moved Dara Quinn to Level 5')
    // The archived list stays as it was.
    expect(await colly.send('person.archive', { id: 'p1', archived: true })).toMatchObject({ status: 'applied' })
    expect(refused(await colly.send('person.level', { id: 'p1', level: 2 }))).toBe('Dara Quinn has been archived. Bring them back on the Crew tab to change their level.')
    // A person added by hand, with nothing said, is Level 1.
    expect(await colly.send('person.upsert', { id: 'p2', name: 'Eimear Nolan', kind: 'freelancer', email: null, phone: '+353871234568', skills: [], dayRateCents: null, notes: '' })).toMatchObject({ status: 'applied' })
    expect(await colly.record<Person>('person', 'p2')).toMatchObject({ level: 1, department: null, knownAs: null, certificates: {}, company: null })
  })

  it('is in the export, with the people table saying what the new columns hold', async () => {
    const { app, colly } = await company()
    const res = await app.inject({ url: '/api/export.zip', cookies: colly.cookies })
    expect(res.statusCode).toBe(200)
    const text = new TextDecoder('utf-8', { ignoreBOM: true })
    const files = Object.fromEntries(Object.entries(unzipSync(new Uint8Array(res.rawPayload))).map(([name, data]) => [name, text.decode(data)]))
    expect(files['README.txt']).toMatch(/people +3 rows +Staff and freelancers on the crew list: contact details, department, level, the name they go by, certificates, the company and VAT and CRO numbers/)
    const header = files['tables/people.csv']!.split('\r\n')[0]!
    for (const column of ['department', 'level', 'known_as', 'certificates', 'company_name', 'company_vat_number', 'company_cro_number']) expect(header).toContain(column)
    const json = JSON.parse(files['everything.json']!) as { people: { name: string; level: number; department: string | null }[] }
    expect(json.people.find((p) => p.name === 'Dara Quinn')).toMatchObject({ level: 4, department: null })
  })

  it('reads the file the same way the app does, so the preview and the device agree', () => {
    // The shared reader is what the server uses; a row's shape here is the row's shape there.
    const { rows } = readCrewList(FILE, 'sessionhire.com')
    expect(rows.map((r) => r.level)).toEqual([3, 2, 1, 3, 0])
  })
})
