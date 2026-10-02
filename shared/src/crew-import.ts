import { APPLICANT_LEVEL, DEFAULT_LEVEL, NOTES_LENGTH, tidyDepartment, type Certificates, type Company, type Person } from './crew.ts'
import { blankRecord, parseCsv } from './csv.ts'
import { parseEuro } from './money.ts'

/**
 * Bringing in the crew list (ADR 0025): a spreadsheet of staff, freelancers
 * and applicants, read into people for the office to check before any of
 * it is saved. Columns are found by their header names, so a file with
 * them in another order reads the same. Anything the reader isn't sure of
 * is marked as a problem and kept as typed, never guessed at: the office
 * fixes it in place or skips the row. The same checks and the same
 * matching run on the server for the preview, on the device as a row is
 * fixed, and on the server again as the rows go in.
 */

/** A person as the file gives them, before anything is saved. */
export interface CrewListPerson extends Pick<Person, 'name' | 'kind' | 'email' | 'phone' | 'department' | 'level' | 'knownAs' | 'skills' | 'notes'> {
  certificates: Certificates
  company: Company | null
  /** The day rate as the file has it, read into cents when the person goes in; kept as text so a cell that can't be read is shown as it is. */
  dayRate: string
}

export interface CrewListRow extends CrewListPerson {
  /** The row's line in the file, counting the header as 1, so the office can find it in the spreadsheet. */
  row: number
  /** What the reader couldn't make of the row, in plain words; empty when it read cleanly. */
  problems: string[]
}

/** Someone on the Crew tab a row could match. Archived people are known too, so a leaver is never revived from the file without a word. */
export interface KnownPerson {
  id: string
  name: string
  email: string | null
  phone: string | null
  archived: boolean
}

/** Someone already on the Crew tab that a row would update. */
export interface CrewListMatch {
  id: string
  name: string
  by: 'email' | 'phone'
}

export interface CrewListPreviewRow extends CrewListRow {
  matched: CrewListMatch | null
}

export interface CrewListCounts {
  rows: number
  /** Rows that would add a person. */
  new: number
  /** Rows that would update someone. */
  updates: number
  skipped: number
  /** Rows not skipped that still have a problem. */
  problems: number
}

/** What the preview answers with. */
export interface CrewListPreview {
  rows: CrewListPreviewRow[]
  counts: CrewListCounts
  /** The office email's domain, which makes a row staff; null while no office email is set, when everyone comes in as a freelancer. */
  officeDomain: string | null
}

/** A row as the office sends it back: fixed where it needed fixing, or skipped, with who the preview said it updates, so the server can tell when that has changed under them. */
export interface CrewListChoice extends CrewListPreviewRow {
  skip: boolean
}

export interface CrewListResult {
  added: number
  updated: number
  /** Matched people the file would change nothing about, so nothing was sent for them. */
  unchanged: number
  skipped: number
}

// Phones.

/** Country codes a bare foreign number may start with; Ireland's is handled on its own. */
const COUNTRY_CODES = ['44', '34', '385', '55', '86', '1', '33', '49', '39', '31', '48']

export const PHONE_HINT = "Couldn't read this phone number. Put it in international form, like +353 87 123 4567."

/** A phone in international form, or as typed with why it couldn't be read; null for nothing typed. */
export type PhoneRead = { phone: string | null; problem?: undefined } | { phone: string; problem: string }

/**
 * A phone number as the file or the office typed it, in international form:
 * spaces, dashes, brackets and dots go; "00" becomes "+"; a leading "+" is
 * kept; "0" and eight or nine digits is Irish, as is nine digits starting
 * with 8 where a spreadsheet ate the 0, and "353…" without its plus; a
 * bare foreign number of ten or more digits starting with a country code
 * from the short list gets its "+". Anything else is marked, never guessed:
 * a UK number typed locally (0 and ten digits), a 0 after the "+", or a
 * trunk 0 after the Irish or UK code, which no number has.
 */
export function normalisePhone(typed: string): PhoneRead {
  const kept = typed.trim()
  // "(0)" after a country code isn't dialled.
  const bare = kept.replace(/\(0\)/g, '').replace(/[\s\-().]/g, '')
  if (!bare) return { phone: null }
  let digits: string
  if (bare.startsWith('00')) digits = bare.slice(2)
  else if (bare.startsWith('+')) digits = bare.slice(1)
  else if (/^0\d{8,9}$/.test(bare)) digits = `353${bare.slice(1)}`
  else if (/^8\d{8}$/.test(bare)) digits = `353${bare}`
  else if (/^353\d{7,}$/.test(bare)) digits = bare
  else if (/^\d{10,}$/.test(bare) && COUNTRY_CODES.some((c) => bare.startsWith(c))) digits = bare
  else return { phone: kept, problem: PHONE_HINT }
  if (!/^\d{7,15}$/.test(digits) || /^(0|3530|440)/.test(digits)) return { phone: kept, problem: PHONE_HINT }
  return { phone: `+${digits}` }
}

/** The digits two phones are compared by: in international form where that can be read, else as typed. */
export function phoneDigits(typed: string | null | undefined): string {
  if (!typed) return ''
  const read = normalisePhone(typed)
  return (read.problem === undefined && read.phone ? read.phone : typed).replace(/\D/g, '')
}

// Emails.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const EMAIL_HINT = "That email address doesn't look right."

/** The domain of an email, lower-cased; null for none. */
export function domainOf(email: string | null | undefined): string | null {
  const at = email?.trim().toLowerCase().split('@')[1]
  return at || null
}

// The rest of a row's problems, said the same way everywhere.

export const NAME_HINT = 'The name can be up to 200 characters.'
export const NO_CONTACT_HINT = 'No email or phone, so there is no way to reach them.'
export const BAD_LETTERS_HINT = "Some letters didn't come through. Save the file as CSV UTF-8 and choose it again."
/** "Old Timer is archived. Skip this row, or bring them back on the Crew tab and choose the file again." */
export const archivedHint = (name: string) => `${name} is archived. Skip this row, or bring them back on the Crew tab and choose the file again.`

// The file.

/** What each field is headed in the file, lower-cased; the first found wins. */
const HEADERS = {
  firstName: ['first name', 'first', 'forename'],
  lastName: ['last name', 'last', 'surname'],
  name: ['name', 'full name'],
  department: ['department', 'dept'],
  phone: ['phone', 'mobile', 'phone number', 'mobile number'],
  email: ['email', 'email address', 'e-mail'],
  preferred: ['preferred'],
  onboarded: ['onboarded'],
  firstAid: ['first aider', 'first aid'],
  manualHandling: ['manual handling cert', 'manual handling'],
  drivingLicence: ['driving licence', 'driving license'],
  // Safe Pass, working at height and IPAF (ADR 0028), under the names a spreadsheet might give them.
  safePass: ['safe pass', 'safepass', 'safe-pass', 'safe pass card'],
  workingAtHeight: ['working at height', 'working at heights', 'wah'],
  ipaf: ['ipaf', 'ipaf card', 'pal card', 'ipaf pal card'],
  dayRate: ['day rate (eur)', 'day rate', 'rate'],
  companyName: ['company name', 'company'],
  vatNumber: ['vat number', 'vat'],
  croNumber: ['cro number', 'cro'],
  notes: ['notes', 'note'],
  skills: ['skillsets / tags', 'skillsets', 'skills', 'tags'],
  knownAs: ['known as', 'goes by'],
} as const
type Field = keyof typeof HEADERS

const MOST_SKILLS = 30
const SKILL_LENGTH = 60

const tidy = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Which column holds each field, by the header row. */
function columnsOf(header: readonly string[]): Partial<Record<Field, number>> {
  const at = new Map<string, number>()
  header.forEach((h, i) => {
    if (!at.has(tidy(h))) at.set(tidy(h), i)
  })
  const out: Partial<Record<Field, number>> = {}
  for (const field of Object.keys(HEADERS) as Field[]) {
    const i = HEADERS[field].map((name) => at.get(name)).find((n) => n !== undefined)
    if (i !== undefined) out[field] = i
  }
  return out
}

/** Yes or no as a spreadsheet says it; null for blank or anything else. */
export function yesNo(cell: string): boolean | null {
  const s = tidy(cell)
  if (['yes', 'y', 'true', '1'].includes(s)) return true
  if (['no', 'n', 'false', '0'].includes(s)) return false
  return null
}

/** The level the file's flags make: preferred 3, onboarded 2, an applicant 0, else known. */
export function levelFrom(f: { preferred: boolean | null; onboarded: boolean | null; notes: string }): number {
  if (f.preferred) return 3
  if (f.onboarded) return 2
  if (/applicant/i.test(f.notes)) return APPLICANT_LEVEL
  return DEFAULT_LEVEL
}

/** Tags split on commas or semicolons, trimmed, each once, up to 30. */
export function readSkills(cell: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of cell.split(/[,;]/)) {
    const skill = raw.trim().slice(0, SKILL_LENGTH)
    if (!skill || seen.has(skill.toLowerCase())) continue
    seen.add(skill.toLowerCase())
    out.push(skill)
    if (out.length === MOST_SKILLS) break
  }
  return out
}

/**
 * The rows of the file as people, with each row's problems, or why the file
 * can't be read at all. `officeDomain` is the office email's domain, which
 * makes a row staff.
 */
export function readCrewList(text: string, officeDomain: string | null): { rows: CrewListRow[]; problem?: string } {
  // A spreadsheet saved as plain CSV on Windows isn't UTF-8, and its accented letters arrive as the replacement mark.
  if (text.includes('�')) return { rows: [], problem: BAD_LETTERS_HINT }
  const lines = parseCsv(text)
  const header = lines[0]
  if (!header || blankRecord(header)) return { rows: [], problem: 'The file is empty.' }
  const col = columnsOf(header)
  if (col.firstName === undefined && col.lastName === undefined && col.name === undefined)
    return { rows: [], problem: 'No name column was found. The first row needs First Name and Last Name, or Name.' }
  const rows: CrewListRow[] = []
  lines.forEach((line, i) => {
    if (i === 0 || blankRecord(line)) return
    const cell = (f: Field) => (col[f] === undefined ? '' : (line[col[f]] ?? '').trim())
    const notes = cell('notes')
    const held = (f: Field) => yesNo(cell(f))
    const certificates: Certificates = {}
    for (const [kind, f] of [
      ['first-aid', 'firstAid'],
      ['manual-handling', 'manualHandling'],
      ['driving-licence', 'drivingLicence'],
      ['safe-pass', 'safePass'],
      ['working-at-height', 'workingAtHeight'],
      ['ipaf', 'ipaf'],
    ] as const) {
      const h = held(f)
      if (h !== null) certificates[kind] = { held: h, expires: null, note: '' }
    }
    const companyName = cell('companyName')
    const vatNumber = cell('vatNumber')
    const croNumber = cell('croNumber')
    const company: Company | null =
      companyName || vatNumber || croNumber ? { name: companyName.slice(0, 200), vatNumber: vatNumber.slice(0, 40) || null, croNumber: croNumber.slice(0, 40) || null } : null
    rows.push({
      // The line in the file, so "row 4" is line 4 of the spreadsheet even after a blank line.
      row: i + 1,
      name: [cell('firstName'), cell('lastName')].filter(Boolean).join(' ') || cell('name'),
      kind: 'freelancer',
      email: cell('email') || null,
      phone: cell('phone') || null,
      department: tidyDepartment(cell('department').slice(0, 60)),
      level: levelFrom({ preferred: held('preferred'), onboarded: held('onboarded'), notes }),
      knownAs: cell('knownAs').slice(0, 100) || null,
      skills: readSkills(cell('skills')),
      certificates,
      company,
      dayRate: cell('dayRate'),
      notes: notes.slice(0, NOTES_LENGTH),
      problems: [],
    })
  })
  return { rows: checkRows(rows, officeDomain) }
}

/**
 * Every row checked again from its fields, as the reader does and as the
 * office fixes a row in place: the name and email tidied, the phone put in
 * international form or kept as typed with its problem, the day rate read,
 * the kind by the email's domain, and a row that repeats an earlier row's
 * email or phone marked, so nobody comes in twice from one file. Skipped
 * rows are out of the running, so a skipped double blocks nothing.
 */
export function checkRows<R extends CrewListRow & { skip?: boolean }>(rows: readonly R[], officeDomain: string | null): R[] {
  const emails = new Map<string, number>()
  const phones = new Map<string, number>()
  return rows.map((r) => {
    const problems: string[] = []
    const name = r.name.trim().replace(/\s+/g, ' ')
    if (!name) problems.push('No name.')
    else if (name.length > 200) problems.push(NAME_HINT)
    const email = r.email?.trim().toLowerCase() || null
    if (email && !EMAIL.test(email)) problems.push(EMAIL_HINT)
    const read = normalisePhone(r.phone ?? '')
    if (read.problem) problems.push(read.problem)
    if (!email && !read.phone) problems.push(NO_CONTACT_HINT)
    const rate = parseEuro(r.dayRate)
    if (rate.reason !== undefined) problems.push(`Couldn't read the day rate "${r.dayRate.trim()}". ${rate.reason} Fix it in the file, or skip the row.`)
    if (!r.skip) {
      if (email && EMAIL.test(email)) {
        const first = emails.get(email)
        if (first !== undefined) problems.push(`The same email as row ${first}.`)
        else emails.set(email, r.row)
      }
      const digits = read.problem === undefined ? phoneDigits(read.phone) : ''
      if (digits) {
        const first = phones.get(digits)
        if (first !== undefined) problems.push(`The same phone as row ${first}.`)
        else phones.set(digits, r.row)
      }
    }
    const kind = officeDomain !== null && domainOf(email) === officeDomain ? 'staff' : 'freelancer'
    return { ...r, name, email, phone: read.phone, kind, problems }
  })
}

/**
 * Who each row would update: by email first, case aside, then by phone,
 * digits compared after both are normalised. What the office must decide
 * is marked, never guessed at: a row whose email is one person's and
 * whose phone is another's, two rows that would update one person, and a
 * row for someone archived, who is never changed or brought back from the
 * file. Skipped rows don't count against the others.
 */
export function matchRows<R extends CrewListRow & { skip?: boolean }>(rows: readonly R[], known: readonly KnownPerson[]): (R & { matched: CrewListMatch | null })[] {
  const byEmail = new Map<string, KnownPerson>()
  const byPhone = new Map<string, KnownPerson>()
  for (const k of known) {
    const email = k.email?.trim().toLowerCase()
    if (email && !byEmail.has(email)) byEmail.set(email, k)
    const digits = phoneDigits(k.phone)
    if (digits && !byPhone.has(digits)) byPhone.set(digits, k)
  }
  // Who each person is updated by, so a second row for them is marked.
  const taken = new Map<string, number>()
  return rows.map((r) => {
    const problems = [...r.problems]
    const byMail = r.email ? byEmail.get(r.email.trim().toLowerCase()) : undefined
    const byCall = r.phone ? byPhone.get(phoneDigits(r.phone)) : undefined
    const hit = byMail ?? byCall
    let matched: CrewListMatch | null = null
    if (hit?.archived) problems.push(archivedHint(hit.name))
    else if (hit) {
      matched = { id: hit.id, name: hit.name, by: byMail ? 'email' : 'phone' }
      if (byMail && byCall && byCall.id !== byMail.id) problems.push(`This phone is ${byCall.name}'s.`)
      if (!r.skip) {
        const first = taken.get(hit.id)
        if (first !== undefined) problems.push(`Row ${first} also updates ${hit.name}.`)
        else taken.set(hit.id, r.row)
      }
    }
    return { ...r, matched, problems }
  })
}

/** The rows as the preview shows them: checked, then matched. The device runs this again as the office fixes or skips a row, with the people it holds. */
export const previewRows = <R extends CrewListRow & { skip?: boolean }>(rows: readonly R[], officeDomain: string | null, known: readonly KnownPerson[]) =>
  matchRows(checkRows(rows, officeDomain), known)

/** The counts at the top of the preview, as the office fixes and skips rows. */
export function importCounts(rows: readonly (CrewListPreviewRow & { skip?: boolean })[]): CrewListCounts {
  const live = rows.filter((r) => !r.skip)
  return {
    rows: rows.length,
    new: live.filter((r) => !r.matched).length,
    updates: live.filter((r) => r.matched).length,
    skipped: rows.length - live.length,
    problems: live.filter((r) => r.problems.length > 0).length,
  }
}

/** "Bring in 24 people", "Bring in 1 person", or why not yet. */
export function bringInLabel(counts: CrewListCounts): string {
  const n = counts.rows - counts.skipped
  if (n === 0) return 'Nothing to bring in'
  return `Bring in ${n} ${n === 1 ? 'person' : 'people'}`
}
