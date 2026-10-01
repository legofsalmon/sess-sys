import { describe, expect, it } from 'vitest'
import {
  archivedHint,
  bringInLabel,
  checkRows,
  EMAIL_HINT,
  importCounts,
  matchRows,
  NAME_HINT,
  normalisePhone,
  PHONE_HINT,
  phoneDigits,
  readCrewList,
  type CrewListPreviewRow,
  type CrewListRow,
  type KnownPerson,
} from '../src/crew-import.ts'

/**
 * Reading the crew list (ADR 0025): every shape of phone number the file
 * holds put into international form, and the ones that can't be marked
 * rather than guessed; a row read end to end into a person, with the level
 * from its flags, the kind from the email's domain, certificates, the
 * company and the skills; a row with problems, fixed in place; and who
 * each row would update, with what the office must decide marked.
 */

/** The file's own header row, exactly. */
const HEADER = 'First Name,Last Name,Department,Phone,Email,Preferred,Onboarded,First Aider,Manual Handling Cert,Driving Licence,Day Rate (EUR),Company Name,VAT Number,CRO Number,Events Worked,Notes,Skillsets / Tags'

describe('a phone number as the file has it', () => {
  it('reads every shape into international form', () => {
    const read = (typed: string) => normalisePhone(typed).phone
    // 353… with no plus; nine digits starting with 8 where a spreadsheet ate the 0; Irish with a leading 0.
    expect(read('353871234567')).toBe('+353871234567')
    expect(read('871234567')).toBe('+353871234567')
    expect(read('0871234567')).toBe('+353871234567')
    expect(read('01 234 5678')).toBe('+35312345678')
    // 00 and + are kept as they mean.
    expect(read('00353871234567')).toBe('+353871234567')
    expect(read('+353 87 123 4567')).toBe('+353871234567')
    expect(read('+44 (0)7700 900123')).toBe('+447700900123')
    // Foreign numbers with no plus: the UK, Croatia, Spain, Brazil, China.
    expect(read('447700900123')).toBe('+447700900123')
    expect(read('385911234567')).toBe('+385911234567')
    expect(read('34612345678')).toBe('+34612345678')
    expect(read('5511987654321')).toBe('+5511987654321')
    expect(read('8613812345678')).toBe('+8613812345678')
    // Spaces, dashes, brackets and dots go.
    expect(read('087-123-4567')).toBe('+353871234567')
    expect(read('(087) 123 4567')).toBe('+353871234567')
    expect(read('087.123.4567')).toBe('+353871234567')
    expect(read('')).toBeNull()
    expect(read('   ')).toBeNull()
  })

  it('marks what it cannot make international, keeping it as typed', () => {
    for (const typed of [
      'ext 4512',
      '12345',
      "Dara's mobile",
      '0871234567 or 0861234567',
      '+353',
      '123456789012345678',
      '9871234567',
      // A UK number typed locally: 0 and ten digits is no Irish number, so it isn't made one.
      '07700 900123',
      // No country code starts with 0, and no Irish or UK number has a trunk 0 after its code.
      '+0871234567',
      '+353 0 87 123 4567',
      '+44 0 7700 900123',
    ]) {
      expect(normalisePhone(typed), typed).toEqual({ phone: typed, problem: PHONE_HINT })
    }
  })

  it('compares two phones by their digits once normalised, or as typed when it can’t be', () => {
    expect(phoneDigits('087 123 4567')).toBe('353871234567')
    expect(phoneDigits('+353 (0)87 123 4567')).toBe('353871234567')
    expect(phoneDigits('ext 4512')).toBe('4512')
    expect(phoneDigits(null)).toBe('')
  })
})

describe('a row of the crew list', () => {
  it('reads end to end: level from the flags, kind from the domain, certificates, company, skills and the rate', () => {
    const file = [
      HEADER,
      'Dara,Quinn,Audio,353871234567,Dara.Quinn@Example.com,Yes,Yes,Yes,No,,250,Quinn Audio Ltd,IE0000001A,awaiting,"Festival A, Festival B","Also seen with dara@other.example","Audio: Front of House; Audio: Monitors, Audio: Front of House, Audio"',
      'Niamh,Walsh,Production,087 700 0002,niamh@sessionhire.com,No,Yes,,,Yes,,,,,,,',
      'Rory,Breen,lx,+353877000003,rory@example.com,,,,,,,,,,,"New applicant, CV received, not yet vetted",',
      'Sorcha,Daly,,00353877000004,sorcha@example.com,,,,,,,,,,,,',
    ].join('\r\n')
    const { rows, problem } = readCrewList(file, 'sessionhire.com')
    expect(problem).toBeUndefined()
    expect(rows).toHaveLength(4)
    const [dara, niamh, rory, sorcha] = rows
    expect(dara).toEqual({
      row: 2,
      name: 'Dara Quinn',
      kind: 'freelancer',
      email: 'dara.quinn@example.com',
      phone: '+353871234567',
      department: 'Audio',
      level: 3,
      knownAs: null,
      // Split on commas or semicolons, each once, the two-level shape kept; Events Worked is ignored.
      skills: ['Audio: Front of House', 'Audio: Monitors', 'Audio'],
      certificates: { 'first-aid': { held: true, expires: null, note: '' }, 'manual-handling': { held: false, expires: null, note: '' } },
      company: { name: 'Quinn Audio Ltd', vatNumber: 'IE0000001A', croNumber: 'awaiting' },
      // Kept as the file has it, read into cents when the person goes in.
      dayRate: '250',
      notes: 'Also seen with dara@other.example',
      problems: [],
    })
    // Onboarded but not preferred is Level 2; the office's own domain makes staff; a blank certificate is unknown, so it isn't there.
    expect(niamh).toMatchObject({ name: 'Niamh Walsh', kind: 'staff', level: 2, phone: '+353877000002', certificates: { 'driving-licence': { held: true } }, company: null, dayRate: '', problems: [] })
    expect(niamh!.certificates).not.toHaveProperty('first-aid')
    // The notes say applicant: Level 0. A known department typed in another case takes the known spelling.
    expect(rory).toMatchObject({ level: 0, department: 'LX', skills: [], problems: [] })
    // Nothing known: Level 1, no department.
    expect(sorcha).toMatchObject({ level: 1, department: null, phone: '+353877000004', problems: [] })
  })

  it('finds the columns by name whatever their order or case, and reads everyone as a freelancer until the office email is set', () => {
    const file = ['EMAIL , phone,  Last Name,First name,department', 'aoife@sessionhire.com,0871234567,Byrne,Aoife,Video'].join('\n')
    const withDomain = readCrewList(file, 'sessionhire.com').rows[0]
    expect(withDomain).toMatchObject({ name: 'Aoife Byrne', kind: 'staff', department: 'Video', phone: '+353871234567', level: 1 })
    expect(readCrewList(file, null).rows[0]).toMatchObject({ kind: 'freelancer' })
    // A file with just a Name column works too; one with no name column at all doesn't.
    expect(readCrewList('Name,Phone\nAoife Byrne,0871234567', null).rows[0]).toMatchObject({ name: 'Aoife Byrne' })
    expect(readCrewList('Phone,Email\n0871234567,a@example.com', null).problem).toBe('No name column was found. The first row needs First Name and Last Name, or Name.')
    expect(readCrewList('', null).problem).toBe('The file is empty.')
    expect(readCrewList('\r\n\r\n', null).problem).toBe('The file is empty.')
    // A file saved as plain CSV on Windows loses its fadas on the way; it's said, not brought in with the marks.
    expect(readCrewList('Name,Phone\nP�draig,0871234567', null).problem).toBe("Some letters didn't come through. Save the file as CSV UTF-8 and choose it again.")
  })

  it('numbers rows by their line in the file, past a blank line, and keeps a line break in a field as one line feed', () => {
    const file = ['Name,Phone,Notes', 'Aoife Byrne,0871234567,', '', ',,', 'Brid Walsh,0871234568,"Line one\r\nLine two"'].join('\r\n')
    const { rows } = readCrewList(file, null)
    expect(rows.map((r) => [r.row, r.name])).toEqual([
      [2, 'Aoife Byrne'],
      [5, 'Brid Walsh'],
    ])
    expect(rows[1]!.notes).toBe('Line one\nLine two')
  })

  it('marks problems in plain words, and clears them as the row is fixed', () => {
    const file = [
      HEADER,
      ',,Audio,0871234567,,,,,,,,,,,,,',
      'Dara,Quinn,Audio,ext 4512,dara@gmailcom,,,,,,,,,,,,',
      'Eimear,Nolan,Audio,,,,,,,,,,,,,,',
      'Dara,Quinn,Audio,087 123 4567,DARA@gmailcom,,,,,,,,,,,,',
      `${'Ab'.repeat(101)},Long,Audio,0871234569,,,,,,,TBC,,,,,,`,
    ].join('\n')
    const { rows } = readCrewList(file, null)
    expect(rows.map((r) => r.problems)).toEqual([
      ['No name.'],
      [EMAIL_HINT, PHONE_HINT],
      ['No email or phone, so there is no way to reach them.'],
      // Same phone as the first row; the email is still wrong, so it isn't compared.
      [EMAIL_HINT, 'The same phone as row 2.'],
      // A name too long for the form, and a day rate the money parser can't read, are said, not cut or dropped.
      [NAME_HINT, 'Couldn\'t read the day rate "TBC". Put in a price like 250 or 1,250.50. Fix it in the file, or skip the row.'],
    ])
    expect(rows[1]).toMatchObject({ email: 'dara@gmailcom', phone: 'ext 4512' })
    expect(rows[4]!.name).toHaveLength(207)

    // The office fixes the second row in place: the phone goes international and the problems go.
    const fixed = checkRows(
      rows.map((r) => (r.row === 3 ? { ...r, email: 'dara@gmail.com', phone: '087 123 4568' } : r)),
      null
    )
    expect(fixed[1]).toMatchObject({ email: 'dara@gmail.com', phone: '+353871234568', problems: [] })
    // Two rows with one email are marked, not brought in twice; a skipped row is out of the running, so it blocks nobody.
    const same = rows.slice(0, 3).map((r) => ({ ...r, email: 'same@example.com', phone: null }))
    expect(checkRows(same, null).map((r) => r.problems)).toEqual([['No name.'], ['The same email as row 2.'], ['The same email as row 2.']])
    expect(checkRows(same.map((r, i) => ({ ...r, skip: i === 0 })), null).map((r) => r.problems)).toEqual([['No name.'], [], ['The same email as row 3.']])
  })

  it('says who each row would update, and marks what the office must decide rather than guessing', () => {
    const known: KnownPerson[] = [
      { id: 'aoife', name: 'Aoife Byrne', email: 'aoife@example.com', phone: '+353871000001', archived: false },
      { id: 'brid', name: 'Brid Walsh', email: null, phone: '+353871000002', archived: false },
      { id: 'old', name: 'Old Timer', email: 'old@example.ie', phone: '+353871000009', archived: true },
    ]
    const row = (n: number, email: string | null, phone: string | null, skip = false): CrewListRow & { skip: boolean } => ({
      row: n,
      name: `Person ${n}`,
      kind: 'freelancer',
      email,
      phone,
      department: null,
      level: 1,
      knownAs: null,
      skills: [],
      certificates: {},
      company: null,
      dayRate: '',
      notes: '',
      problems: [],
      skip,
    })
    const rows = matchRows(
      [
        row(2, 'AOIFE@example.com', null),
        row(3, null, '087 100 0002'),
        row(4, 'old@example.ie', null),
        row(5, 'aoife@example.com', '0871000002'),
        row(6, 'new@example.com', '0871000003'),
        row(7, null, '+353871000002', true),
      ],
      known
    )
    expect(rows.map((r) => [r.matched, r.problems])).toEqual([
      // By email, case aside; then by phone, digits compared once both are in international form.
      [{ id: 'aoife', name: 'Aoife Byrne', by: 'email' }, []],
      [{ id: 'brid', name: 'Brid Walsh', by: 'phone' }, []],
      // Someone archived is never changed or brought back from the file.
      [null, [archivedHint('Old Timer')]],
      // An email that is one person's with a phone that is another's, and a second row for someone an earlier row updates.
      [{ id: 'aoife', name: 'Aoife Byrne', by: 'email' }, ["This phone is Brid Walsh's.", 'Row 2 also updates Aoife Byrne.']],
      [null, []],
      // Skipped, so it isn't a second row for Brid.
      [{ id: 'brid', name: 'Brid Walsh', by: 'phone' }, []],
    ])
  })

  it('counts what the preview will do, as rows are skipped and fixed', () => {
    const row = (n: number, more: Partial<CrewListPreviewRow & { skip: boolean }>): CrewListPreviewRow & { skip: boolean } => ({
      row: n,
      name: `Person ${n}`,
      kind: 'freelancer',
      email: null,
      phone: '+353871234567',
      department: null,
      level: 1,
      knownAs: null,
      skills: [],
      certificates: {},
      company: null,
      dayRate: '',
      notes: '',
      problems: [],
      matched: null,
      skip: false,
      ...more,
    })
    const rows = [row(2, {}), row(3, { matched: { id: 'p1', name: 'Dara Quinn', by: 'email' } }), row(4, { problems: [PHONE_HINT] }), row(5, { problems: [PHONE_HINT], skip: true })]
    expect(importCounts(rows)).toEqual({ rows: 4, new: 2, updates: 1, skipped: 1, problems: 1 })
    expect(bringInLabel(importCounts(rows))).toBe('Bring in 3 people')
    expect(bringInLabel(importCounts(rows.map((r) => ({ ...r, skip: r.row !== 2 }))))).toBe('Bring in 1 person')
    expect(bringInLabel(importCounts(rows.map((r) => ({ ...r, skip: true }))))).toBe('Nothing to bring in')
  })
})
