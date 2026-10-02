import { z } from 'zod'
import type { CommandName } from './commands.ts'
import { DEFAULT_LEVEL, type Person } from './crew.ts'
import { irishToday } from './day.ts'

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
 * end of the year they belong to, and erasure gives way to a legal
 * obligation (Article 17(3)(b)): someone paid in that time keeps their
 * name, beside the timesheets that show the pay.
 */
export const PAID_WORK_YEARS = 6

/** The record that someone was erased: their id and dates, nothing else about them. */
export interface Erasure {
  /** The person's id. */
  id: string
  erasedAt: string
  /** Their name is kept until this day, for Revenue's six years, and can go from it; null once it has gone. */
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
   * history holds nothing about them. Sent again once a kept name's six
   * years are up, it takes the name.
   */
  'person.erase': z.object({ id }),
} as const

/** Why a change about an erased person is turned down, on the server or on a device. */
export const ERASED_REFUSAL = "This person's details were erased on request, so nothing more can be recorded for them."

/**
 * The day a person's name can go, from when each of their timesheets was
 * approved: six whole years after the end of the year of the latest, as
 * Revenue counts from the end of the tax year (an approval in June 2026
 * keeps it until 1 January 2033), while that is still to come. Null when
 * they have no paid work on record in that time.
 */
export function nameKeptUntil(approvedAt: readonly (string | null | undefined)[], today: string): string | null {
  let latest: string | undefined
  for (const at of approvedAt) {
    if (!at) continue
    const day = irishToday(new Date(at))
    if (!latest || day > latest) latest = day
  }
  if (!latest) return null
  const until = `${Number(latest.slice(0, 4)) + PAID_WORK_YEARS + 1}-01-01`
  return until > today ? until : null
}

/**
 * A person as erasing leaves them. Every field is named, not copied, so a
 * field added to a person later fails to compile here until someone says
 * whether it goes. Kept: the id and whether they're staff, which says
 * nothing about them but how they were paid, and the name while Revenue
 * needs it. The level goes back to the default, which says nothing about
 * them either. The link secret goes: the server gives the row a new
 * random one that matches nothing, and devices are sent none.
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
export type PersonRecord = 'offer' | 'leaveRequest' | 'lieuEntry'

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
export const PERSON_COMMANDS: Partial<Record<CommandName, PersonCommand>> = {
  // The name is the one they have now: "Erased person", or the name Revenue's six years keep.
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
  'leave.request': { names: { field: 'personId' }, refused: true, keep: only('id', 'personId', 'type') },
  'leave.cancel': { names: { field: 'id', via: 'leaveRequest' }, refused: true, keep: as },
  'leave.decide': { names: { field: 'id', via: 'leaveRequest' }, refused: true, keep: (a) => ({ ...a, reason: '' }) },
  'lieu.log': { names: { field: 'personId' }, refused: true, keep: only('id', 'personId') },
  'lieu.cancel': { names: { field: 'id', via: 'lieuEntry' }, refused: true, keep: as },
  'lieu.decide': { names: { field: 'id', via: 'lieuEntry' }, refused: true, keep: (a) => ({ ...a, reason: '' }) },
  'leave.allowance': { names: { field: 'personId' }, refused: true, keep: only('personId', 'year', 'by') },
}

/**
 * Whom a command is about, if it's one in the list: the id in its
 * arguments, or the person whose record it names, looked up in whatever
 * the caller holds (the server's tables, or a device's copy).
 */
export function personNamedBy(name: string, args: unknown, personOf: (record: PersonRecord, id: string) => string | undefined): string | undefined {
  const rule = PERSON_COMMANDS[name as CommandName]
  if (!rule || !args || typeof args !== 'object') return undefined
  const value = (args as Args)[rule.names.field]
  if (typeof value !== 'string') return undefined
  return rule.names.via ? personOf(rule.names.via, value) : value
}

/** A command's arguments with only what erasing keeps, or as they are when it isn't about a person. */
export function keptArgs(name: string, args: unknown, personName: string): unknown {
  const rule = PERSON_COMMANDS[name as CommandName]
  if (!rule || !args || typeof args !== 'object') return args
  return rule.keep(args as Args, personName)
}
