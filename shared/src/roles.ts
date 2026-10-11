import type { CommandName } from './commands.ts'

/**
 * Roles and what each may change (ADR 0034). The six personas in
 * docs/personas.md, less the freelancer, who has a private link and no
 * account: a role says what a signed-in member of staff can change, on the
 * server, where it counts, and on the device, so a button that can't work
 * isn't offered. Everyone signed in still reads everything.
 *
 * A role belongs to a staff person on the Crew tab, found by the email
 * their Google account signs in with, as leave already finds "me" (ADR
 * 0024). Roles start off: until someone is made a director, everyone
 * signed in can do everything, as before. Naming the first director
 * switches them on, and there is always at least one after that.
 */

export const ROLES = ['director', 'office', 'head', 'warehouse', 'crew'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  director: 'Director',
  office: 'Office and production',
  head: 'Head of department',
  warehouse: 'Warehouse',
  crew: 'Staff crew',
}

/** What each role is for, in a line, where a role is chosen. */
export const ROLE_LINES: Record<Role, string> = {
  director: 'Everything, and the things only a director does: roles, erasing a person, starting fresh.',
  office: 'Jobs, crew, kit and stock, and the settings: calendar, office details, bringing lists in, downloads.',
  head: 'Crew and their bookings, kit on jobs, stock and the warehouse. Not jobs themselves, nor settings.',
  warehouse: 'Stock and the warehouse, and kit on jobs. Not jobs, crew or settings.',
  crew: 'Their own leave and days in lieu, and reporting a fault. Everything else they can look at.',
}

/** The kinds of change a role can make. Each command needs exactly one. */
export const ABILITIES = ['jobs', 'crew', 'kit', 'stock', 'fault', 'leave', 'settings', 'company'] as const
export type Ability = (typeof ABILITIES)[number]

/** Each kind of change, as "Only … can ___". */
const ABILITY_WORDS: Record<Ability, string> = {
  jobs: 'change jobs, clients and venues',
  crew: 'change crew and their bookings',
  kit: 'change the kit on a job',
  stock: 'change stock and the warehouse',
  fault: 'report a fault',
  leave: 'ask for leave',
  settings: 'change settings, bring lists in or download everything',
  company: 'change roles, erase a person or start fresh',
}

/** What each role can change. A director can change everything. */
export const ROLE_CAN: Record<Role, readonly Ability[]> = {
  director: ABILITIES,
  office: ['jobs', 'crew', 'kit', 'stock', 'fault', 'leave', 'settings'],
  head: ['crew', 'kit', 'stock', 'fault', 'leave'],
  warehouse: ['kit', 'stock', 'fault', 'leave'],
  crew: ['fault', 'leave'],
}

/**
 * The ability each command needs. Typed against every command, so a new
 * one doesn't compile until it says which. Deciding leave stays with
 * "Can approve time off" (ADR 0024), checked by the leave handlers on top.
 */
export const COMMAND_NEEDS: Record<CommandName, Ability> = {
  'project.create': 'jobs',
  'project.update': 'jobs',
  'phase.add': 'jobs',
  'phase.update': 'jobs',
  'phase.remove': 'jobs',
  'venue.upsert': 'jobs',
  'client.upsert': 'jobs',
  'attachment.save': 'jobs',
  'attachment.remove': 'jobs',

  'person.upsert': 'crew',
  'person.level': 'crew',
  'person.newLink': 'crew',
  'person.archive': 'crew',
  'person.contact': 'crew',
  'unavailability.add': 'crew',
  'unavailability.remove': 'crew',
  'call.create': 'crew',
  'call.update': 'crew',
  'call.cancel': 'crew',
  'offer.send': 'crew',
  'offer.respond': 'crew',
  'offer.confirm': 'crew',
  'offer.cancel': 'crew',
  'offer.seen': 'crew',
  'timesheet.send': 'crew',
  'timesheet.approve': 'crew',
  'timesheet.reopen': 'crew',
  'late.say': 'crew',
  'late.arrived': 'crew',
  'late.seen': 'crew',
  'document.save': 'crew',
  'document.check': 'crew',
  'document.remove': 'crew',

  'kit.add': 'kit',
  'kit.update': 'kit',
  'kit.remove': 'kit',

  'model.create': 'stock',
  'model.update': 'stock',
  'model.remove': 'stock',
  'model.mistake': 'stock',
  'asset.add': 'stock',
  'asset.update': 'stock',
  'asset.move': 'stock',
  'asset.relabel': 'stock',
  'asset.retire': 'stock',
  'asset.reinstate': 'stock',
  'stock.set': 'stock',
  'stock.move': 'stock',
  'move.record': 'stock',
  'labels.reserve': 'stock',
  'labels.update': 'stock',
  'labels.cancel': 'stock',
  'place.upsert': 'stock',
  'place.remove': 'stock',
  'fault.update': 'stock',
  'fault.close': 'stock',
  'inspection.record': 'stock',
  'count.record': 'stock',

  'fault.report': 'fault',

  'leave.request': 'leave',
  'leave.cancel': 'leave',
  'leave.decide': 'leave',
  'leave.allowance': 'leave',
  'leave.open': 'leave',
  'lieu.log': 'leave',
  'lieu.cancel': 'leave',
  'lieu.decide': 'leave',

  'office.update': 'settings',

  'person.role': 'company',
  'person.erase': 'company',
}

export const roleCan = (role: Role, ability: Ability) => ROLE_CAN[role].includes(ability)
export const roleMayRun = (role: Role, name: CommandName) => {
  const needs = COMMAND_NEEDS[name]
  return needs !== undefined && roleCan(role, needs)
}

/** "the office and directors", the roles that can, in the order of the list. */
function whoCan(ability: Ability): string {
  const names = ROLES.filter((r) => roleCan(r, ability)).map((r) => (r === 'director' ? 'directors' : r === 'crew' ? 'staff crew' : r === 'office' ? 'the office' : r === 'head' ? 'heads of department' : 'the warehouse'))
  // Directors last: "the office and directors".
  const ordered = [...names.filter((n) => n !== 'directors'), ...names.filter((n) => n === 'directors')]
  return ordered.length < 2 ? (ordered[0] ?? 'directors') : `${ordered.slice(0, -1).join(', ')} and ${ordered.at(-1)}`
}

/** Why a role can't do something, and what to do about it, in a sentence a person can act on. */
export function refusalFor(role: Role, ability: Ability): string {
  return `Only ${whoCan(ability)} can ${ABILITY_WORDS[ability]}. Your role is ${ROLE_LABELS[role]}; a director can change it on your person on the Crew tab.`
}

/** A person as far as roles need them; a device's copy and the server's rows both fit. */
export interface RolePerson {
  id: string
  kind: 'staff' | 'freelancer'
  email: string | null
  archived: boolean
  role: Role | null
}

/** A staff person's role as it stands: none set is staff crew. A freelancer has none. */
export const roleOfPerson = (p: Pick<RolePerson, 'kind' | 'role'>): Role | null => (p.kind === 'staff' ? (p.role ?? 'crew') : null)

/** Whether roles are on: someone, not archived, is a director. */
export const rolesOn = (people: readonly Pick<RolePerson, 'kind' | 'archived' | 'role'>[]) =>
  people.some((p) => !p.archived && p.kind === 'staff' && p.role === 'director')

/** Who an account is on the Crew tab: the first, by id, not archived, with its email (as the server's personByEmail). */
export function personForEmail<P extends RolePerson>(people: readonly P[], email: string): P | undefined {
  const wanted = email.trim().toLowerCase()
  if (!wanted) return undefined
  return people.filter((p) => !p.archived && (p.email ?? '').trim().toLowerCase() === wanted).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
}

/**
 * The role a signed-in account acts with. While roles are off, everyone is
 * treated as a director. An account matched to nobody, or to a freelancer,
 * is staff crew: it can look, report a fault, and nothing that needs a
 * person of its own.
 */
export function roleForEmail(people: readonly RolePerson[], email: string): { role: Role; on: boolean; personId?: string } {
  if (!rolesOn(people)) return { role: 'director', on: false }
  const me = personForEmail(people, email)
  return { role: (me && roleOfPerson(me)) ?? 'crew', on: true, ...(me ? { personId: me.id } : {}) }
}
