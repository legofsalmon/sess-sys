import { z } from 'zod'
import type { CommandName } from './commands.ts'
import { DEFAULT_LEVEL, type Person } from './crew.ts'
import { irishToday } from './day.ts'
import { DOCUMENT_ACTIONS, type DocumentAction } from './documents.ts'
import { yearOf, type LeaveAllowance, type LeaveRequest, type LeaveStatus, type LieuEntry } from './leave.ts'

/**
 * Erasing a person's details on request (ADR 0027): GDPR's right to
 * erasure. What goes, what is kept, and which commands carry a person's
 * details, shared by the server and every device so both strip the same
 * things. The server's own list of the tables a person lives in is
 * `server/src/erasure/places.ts`; anything new that holds a person's
 * details goes there or here.
 */

/** What an erased person is called, wherever their name was. */
export const ERASED_NAME = 'Erased person'

/**
 * Revenue expects a business to keep its records for six years from the
 * end of the year they belong to (Taxes Consolidation Act 1997, section
 * 886), and erasure gives way to a legal obligation (Article 17(3)(b)):
 * someone paid in that time keeps their name, beside the timesheets that
 * show the pay.
 */
export const PAID_WORK_YEARS = 6

/**
 * The Organisation of Working Time Act 1997 (section 25), with the
 * Organisation of Working Time (Records) (Prescribed Form and Exemptions)
 * Regulations 2001, asks an employer to keep records of annual leave and
 * public holidays for three years. So erasing a member of staff keeps
 * their leave records that long, and their name with them, since a record
 * has to say whose it is.
 */
export const LEAVE_RECORD_YEARS = 3

/** The record that someone was erased: their id and dates, nothing else about them. */
export interface Erasure {
  /** The person's id. */
  id: string
  erasedAt: string
  /** Their name is kept until this day, for their pay or leave records, and can go from it; null once it has gone. */
  nameKeptUntil: string | null
}

export interface ErasureEntities {
  erasure: Erasure
}
export const ERASURE_ENTITY_NAMES = ['erasure'] as const

const id = z.string().min(1).max(64)

export const erasureCommandSchemas = {
  /**
   * Erase an archived person's details. Only their id travels, so the
   * history holds nothing about them. Sent again once a kept name's day
   * has come, it takes the name, and the leave records kept with it.
   */
  'person.erase': z.object({ id }),
} as const

/** Why a change about an erased person is turned down, on the server or on a device. */
export const ERASED_REFUSAL = "This person's details were erased on request, so nothing more can be recorded for them."

/**
 * The first day after some whole years from the end of a year. Records
 * are counted from the end of the year they belong to, as Revenue counts
 * from the end of the tax year, which errs on the safe side of "from when
 * it was made".
 */
const yearsAfter = (year: number, years: number) => `${year + years + 1}-01-01`

/**
 * A staff leave record (ADR 0024), by what says which year it belongs to:
 * a request by its last day, a day in lieu by the day worked, an allowance
 * by its own year; and, for a request or a day in lieu, its status.
 */
export type LeaveRecord = (Pick<LeaveRequest, 'end'> | Pick<LieuEntry, 'day'> | Pick<LeaveAllowance, 'year'>) & { status?: LeaveStatus }

export function leaveRecordYear(r: LeaveRecord): number {
  if ('year' in r) return r.year
  return yearOf('end' in r ? r.end : r.day)
}

/** The day a leave record can go: three whole years after the end of its year, so leave in 2026 is kept until 1 January 2030. */
export function leaveRecordKeptUntil(r: LeaveRecord): string {
  return yearsAfter(leaveRecordYear(r), LEAVE_RECORD_YEARS)
}

/**
 * Whether a leave record stays when its person is erased: still in its
 * three years, and decided. One still waiting records no leave, and
 * nothing more can be decided for them, so it would sit in the approvers'
 * queue for good. Erasing is refused while one waits, but a restore can
 * bring one back from before it was decided.
 */
export function leaveRecordKept(r: LeaveRecord, today: string): boolean {
  return r.status !== 'waiting' && leaveRecordKeptUntil(r) > today
}

/**
 * What a person has on record that the law asks the business to keep:
 * when each of their timesheets was approved, and their staff leave. The
 * server reads it from its tables and a device from its copy, and both
 * decide with `nameKept`, so they come to the same day.
 */
export interface KeptRecords {
  approvedAt: readonly (string | null | undefined)[]
  leave: readonly LeaveRecord[]
}

/** What keeps an erased person's name, each as the day it can go: null for nothing still to come. */
export interface NameKept {
  /** Their pay records, for Revenue: six whole years after the year of the latest approved timesheet. */
  pay: string | null
  /** Their leave records, under the Working Time Act: the day the last of them can go. */
  leave: string | null
  /** Their name: the later of the two, since every record kept has to say whose it is. */
  until: string | null
}

export function nameKept(records: KeptRecords, today: string): NameKept {
  let paid: number | undefined
  for (const at of records.approvedAt) {
    if (!at) continue
    // By Ireland's day: an approval late on New Year's Eve belongs to the old year.
    const year = yearOf(irishToday(new Date(at)))
    if (paid === undefined || year > paid) paid = year
  }
  let leave: string | undefined
  for (const r of records.leave) {
    if (!leaveRecordKept(r, today)) continue
    const until = leaveRecordKeptUntil(r)
    if (!leave || until > leave) leave = until
  }
  const still = (d: string | undefined) => (d && d > today ? d : null)
  const pay = still(paid === undefined ? undefined : yearsAfter(paid, PAID_WORK_YEARS))
  const kept = still(leave)
  return { pay, leave: kept, until: pay && kept ? (pay > kept ? pay : kept) : (pay ?? kept) }
}

/**
 * The day a person's name can go, while that is still to come: the later
 * of the day their pay records can go (an approval in June 2026 keeps it
 * until 1 January 2033) and the day their leave records can (leave in
 * 2026, until 1 January 2030). Null when nothing on record needs it.
 */
export function nameKeptUntil(records: KeptRecords, today: string): string | null {
  return nameKept(records, today).until
}

/**
 * A person as erasing leaves them. Every field is named, not copied, so a
 * field added to a person later fails to compile here until someone says
 * whether it goes. Kept: the id and whether they're staff, which says
 * nothing about them but how they were paid, and the name while their pay
 * or leave records need it. The level goes back to the default, which
 * says nothing about them either. The link secret goes: the server gives
 * the row a new random one that matches nothing, and devices are sent
 * none.
 */
export function erasedPerson(p: Pick<Person, 'id' | 'kind' | 'name'>, keepName: boolean): Person {
  return {
    id: p.id,
    kind: p.kind,
    name: keepName ? p.name : ERASED_NAME,
    email: null,
    phone: null,
    skills: [],
    dayRateCents: null,
    notes: '',
    linkToken: '',
    archived: true,
    approvesLeave: false,
    department: null,
    level: DEFAULT_LEVEL,
    knownAs: null,
    certificates: {},
    company: null,
  }
}

type Args = Record<string, unknown>

/** The records a command can name a person through: one of theirs, whose own `personId` is them. */
export type PersonRecord = 'offer' | 'leaveRequest' | 'lieuEntry' | 'document'

/** A command that is about a person, and what erasing them does to it. */
export interface PersonCommand {
  /** Where its arguments name the person: their id, or one of their records. */
  names: { field: string; via?: PersonRecord }
  /** Turned down once they're erased: it would put something about them on record again. */
  refused: boolean
  /** What of its arguments is kept once they're erased, in the history and on devices. `name` is theirs as it now is. */
  keep: (a: Args, name: string) => Args
}

const as = (a: Args) => a
/** Some fields kept, by name; the rest go. */
const only =
  (...fields: string[]) =>
  (a: Args): Args =>
    Object.fromEntries(fields.filter((f) => a[f] !== undefined).map((f) => [f, a[f]]))

/**
 * Every command that carries a person's details or puts something about
 * them on record. A new one goes here, or the device and the history keep
 * what it carried after the person is erased. The test beside this file
 * checks every command naming a person is listed.
 */
export const PERSON_COMMANDS: Partial<Record<CommandName | DocumentAction, PersonCommand>> = {
  // The name is the one they have now: "Erased person", or the name kept with their pay or leave records.
  'person.upsert': { names: { field: 'id' }, refused: true, keep: (a, name) => ({ ...only('id', 'kind')(a), name }) },
  // Which details changed, never what to: the history's words need only that.
  'person.contact': {
    names: { field: 'id' },
    refused: true,
    keep: (a) => ({ id: a.id, ...(a.email !== undefined ? { email: null } : {}), ...(a.phone !== undefined ? { phone: null } : {}) }),
  },
  'person.level': { names: { field: 'id' }, refused: true, keep: only('id') },
  'person.newLink': { names: { field: 'id' }, refused: true, keep: as },
  'person.archive': { names: { field: 'id' }, refused: true, keep: as },
  'unavailability.add': { names: { field: 'personId' }, refused: true, keep: only('id', 'personId') },
  'offer.send': { names: { field: 'personId' }, refused: true, keep: as },
  // Their answer stays as a record of work; what they wrote with it goes.
  'offer.respond': { names: { field: 'id', via: 'offer' }, refused: true, keep: (a) => ({ ...a, note: '' }) },
  'timesheet.send': { names: { field: 'id', via: 'offer' }, refused: true, keep: (a) => ({ ...a, note: '' }) },
  // Leave keeps no dates, notes or reasons here. A record kept under the Working Time Act holds its own dates, days and
  // decision, which the history reads from it; once its three years are up it goes, and nothing here names a day.
  'leave.request': { names: { field: 'personId' }, refused: true, keep: only('id', 'personId', 'type') },
  'leave.cancel': { names: { field: 'id', via: 'leaveRequest' }, refused: true, keep: as },
  'leave.decide': { names: { field: 'id', via: 'leaveRequest' }, refused: true, keep: (a) => ({ ...a, reason: '' }) },
  'lieu.log': { names: { field: 'personId' }, refused: true, keep: only('id', 'personId') },
  'lieu.cancel': { names: { field: 'id', via: 'lieuEntry' }, refused: true, keep: as },
  'lieu.decide': { names: { field: 'id', via: 'lieuEntry' }, refused: true, keep: (a) => ({ ...a, reason: '' }) },
  'leave.allowance': { names: { field: 'personId' }, refused: true, keep: only('personId', 'year', 'by') },
  // Running late (ADR 0028): the booking and the day stay, for the history's words; what they wrote goes. Saying they're
  // there, and the office noting it, carry only the record's id, and the record is deleted, so those are refused as not found.
  'late.say': { names: { field: 'offerId', via: 'offer' }, refused: true, keep: (a) => ({ ...a, note: '' }) },
  // Their documents (ADR 0029) go at once, so only what says which document and of what kind is kept: never its title,
  // the day it runs out, or its file. A file put on one, or sent from their link, is a server action, kept the same way.
  'document.save': { names: { field: 'personId' }, refused: true, keep: only('id', 'personId', 'kind') },
  'document.check': { names: { field: 'id', via: 'document' }, refused: true, keep: only('id') },
  [DOCUMENT_ACTIONS.file]: { names: { field: 'personId' }, refused: true, keep: only('id', 'personId', 'kind', 'type', 'bytes', 'added', 'replaced') },
  [DOCUMENT_ACTIONS.send]: { names: { field: 'personId' }, refused: true, keep: only('id', 'personId', 'kind', 'type', 'bytes', 'renews') },
}

/**
 * Whom a command is about, if it's one in the list: the id in its
 * arguments, or the person whose record it names, looked up in whatever
 * the caller holds (the server's tables, or a device's copy).
 */
export function personNamedBy(name: string, args: unknown, personOf: (record: PersonRecord, id: string) => string | undefined): string | undefined {
  const rule = PERSON_COMMANDS[name as CommandName | DocumentAction]
  if (!rule || !args || typeof args !== 'object') return undefined
  const value = (args as Args)[rule.names.field]
  if (typeof value !== 'string') return undefined
  return rule.names.via ? personOf(rule.names.via, value) : value
}

/** A command's arguments with only what erasing keeps, or as they are when it isn't about a person. */
export function keptArgs(name: string, args: unknown, personName: string): unknown {
  const rule = PERSON_COMMANDS[name as CommandName | DocumentAction]
  if (!rule || !args || typeof args !== 'object') return args
  return rule.keep(args as Args, personName)
}
