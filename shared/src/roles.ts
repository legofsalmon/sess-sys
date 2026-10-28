import type { CommandName } from './commands.ts'

/**
 * Roles and what each may change (ADR 0034). A role says what someone
 * signed in can change, on the
 * server, where it counts, and on the device, so a button that can't work
 * isn't offered. Everyone signed in reads the company's work, but money:
 * prices, quotes and what's owed reach only the roles that can see them
 * (ADR 0042), crew rates and private links only the roles that need
 * them (ADR 0046, reading.ts), and other people's details, documents and
 * notes on their time off the office's and heads' (ADR 0062).
 *
 * A role belongs to a staff person on the Crew tab, found by the email
 * their Google account signs in with, as leave already finds "me" (ADR
 * 0024). Roles start off: until someone is made a director, everyone
 * signed in can do everything, as before. Naming the first director
 * switches them on, and there is always at least one after that.
 */

/**
 * The freelancer took the warehouse's place in the list (ADR 0051): the
 * warehouse is a department, run by its head, and a freelancer is who the
 * company books most. A freelancer's own offers, bookings, timesheets and
 * days off go through their private link; signed in, they can look and
 * report a fault, and read nobody's pay or link but their own.
 */
export const ROLES = ['director', 'office', 'head', 'crew', 'freelancer'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  director: 'Director',
  office: 'Office and production',
  head: 'Head of department',
  crew: 'Staff crew',
  freelancer: 'Freelancer',
}

/** What each role is for, in a line, where a role is chosen. */
export const ROLE_LINES: Record<Role, string> = {
  director: 'Everything, and the things only a director does: roles, erasing a person, starting fresh.',
  office: 'Jobs, crew, kit and stock, money, and the settings: calendar, office details, bringing lists in, downloads.',
  head: "Crew and their bookings, kit on jobs, stock and the warehouse, the purchase list, and jobs' steps. Not jobs themselves, nor settings.",
  crew: "Their own leave and days in lieu, the job steps given to them, asking for kit to be bought and voting for it, and reporting a fault. They can look at the rest, but nobody else's pay, link, email, notes or documents.",
  freelancer: "Reporting a fault, and asking for kit to be bought and voting for it. Their offers, bookings, timesheets and days off go through their private link; they can look at the rest, but nobody else's pay, link, phone, email, notes or documents.",
}

/** The kinds of change a role can make. Each command needs exactly one. */
export const ABILITIES = ['jobs', 'crew', 'kit', 'stock', 'fault', 'leave', 'steps', 'ask', 'money', 'settings', 'company'] as const
export type Ability = (typeof ABILITIES)[number]

/** Each kind of change, as "Only … can ___". */
const ABILITY_WORDS: Record<Ability, string> = {
  jobs: 'change jobs, clients and venues',
  crew: 'change crew and their bookings',
  kit: 'change the kit on a job',
  stock: 'change stock and the warehouse',
  fault: 'report a fault',
  leave: 'ask for leave',
  steps: "tick off and give out a job's steps",
  ask: 'ask for kit to be bought, or vote for it',
  money: 'see and change prices, quotes and what is owed',
  settings: 'change settings, bring lists in or download everything',
  company: 'change roles, erase a person or start fresh',
}

/** What each role can change. A director can change everything. */
export const ROLE_CAN: Record<Role, readonly Ability[]> = {
  director: ABILITIES,
  office: ['jobs', 'crew', 'kit', 'stock', 'fault', 'leave', 'steps', 'ask', 'money', 'settings'],
  head: ['crew', 'kit', 'stock', 'fault', 'leave', 'steps', 'ask'],
  // Staff crew tick or hand on their own steps only (ADR 0073), which the step's handler checks on top.
  crew: ['fault', 'leave', 'steps', 'ask'],
  // Anyone signed in can ask for kit to be bought and vote for it (ADR 0077); changing someone else's request needs stock, checked by the handler.
  freelancer: ['fault', 'ask'],
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
  'project.merge': 'jobs',
  'venue.upsert': 'jobs',
  'venue.pin': 'jobs',
  'client.upsert': 'jobs',
  'attachment.save': 'jobs',
  'attachment.remove': 'jobs',

  'person.upsert': 'crew',
  'person.level': 'crew',
  'person.newLink': 'crew',
  'person.archive': 'crew',
  'person.contact': 'crew',
  // Combining people brought in twice (ADR 0055): the crew's records, like an edit. One who signs in with a role needs settings too, on the server.
  'person.merge': 'crew',
  // Which of their addresses is the main one (ADR 0064): an edit of their details. For someone with a role, settings too, on the server.
  'person.mainEmail': 'crew',
  'unavailability.add': 'crew',
  'unavailability.remove': 'crew',
  // Their own calendar (ADR 0044): stopping it is the office's, like their days off. Adding one is a server route that needs crew too.
  'ownCalendar.stop': 'crew',
  'call.create': 'crew',
  'call.update': 'crew',
  'call.cancel': 'crew',
  'call.department': 'crew',
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
  // Kit read from jobs' notes (ADR 0043): kit on jobs, with the names it remembers for the next job's notes.
  'kit.fromNotes': 'kit',
  // A vehicle on a job, and who drives it (ADR 0047): kit on a job's people, as vans go out with the kit.
  'vehicleBooking.add': 'kit',
  'vehicleBooking.update': 'kit',
  'vehicleBooking.remove': 'kit',

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
  // Racks' layouts (ADR 0074) are the stock list's.
  'rackSlot.set': 'stock',
  'rackSlot.remove': 'stock',
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
  // The vehicles themselves and their checks (ADR 0047), kept by whoever keeps the stock.
  'vehicle.save': 'stock',
  'vehicle.offRoad': 'stock',
  'vehicle.archive': 'stock',

  'fault.report': 'fault',

  'leave.request': 'leave',
  'leave.cancel': 'leave',
  'leave.decide': 'leave',
  'leave.allowance': 'leave',
  'leave.open': 'leave',
  'lieu.log': 'leave',
  'lieu.cancel': 'leave',
  'lieu.decide': 'leave',

  // A job's steps (ADR 0073): every member of staff ticks their own; staff crew only theirs, checked by the handler.
  'jobStep.set': 'steps',

  // The purchase list (ADR 0077): anyone asks and votes, and changes or takes back their own (the handler checks whose);
  // saying where a request is at is stock's, and bringing a list in is settings', like every list.
  'purchase.ask': 'ask',
  'purchase.update': 'ask',
  'purchase.remove': 'ask',
  'purchase.vote': 'ask',
  'purchase.status': 'stock',
  'purchase.bringIn': 'settings',

  // Money (ADR 0042): prices, quotes and what's owed are the office's and the directors'. A role without it isn't sent them either.
  'quote.save': 'money',
  'quote.sent': 'money',
  'quote.answer': 'money',
  'quote.invoiced': 'money',
  'quote.paid': 'money',
  'quoting.update': 'money',
  'quoting.travel': 'money',
  'price.product': 'money',
  'price.rulesFromRms': 'money',
  'package.save': 'money',
  'package.remove': 'money',
  'price.role': 'money',
  'price.client': 'money',
  'cost.paid': 'money',

  'office.update': 'settings',
  // Whether heads of department see crew rates (ADR 0046): what a role reads is a director's to decide, like the role.
  'reading.heads': 'company',
  // Whether the app prompts messages to crew (ADR 0048): a setting, so the office's as much as a director's.
  'messages.prompt': 'settings',

  'person.role': 'company',
  'person.erase': 'company',
}

export const roleCan = (role: Role, ability: Ability) => ROLE_CAN[role].includes(ability)

/** Whether a role sees money at all (ADR 0042): without it, its devices are sent no prices or quotes. None is held to nothing. */
export const roleSeesMoney = (role: Role | null | undefined) => !role || roleCan(role, 'money')
export const roleMayRun = (role: Role, name: CommandName) => {
  const needs = COMMAND_NEEDS[name]
  return needs !== undefined && roleCan(role, needs)
}

/** "the office and directors", the roles that can, in the order of the list. */
function whoCan(ability: Ability): string {
  const names = ROLES.filter((r) => roleCan(r, ability)).map((r) => (r === 'director' ? 'directors' : r === 'crew' ? 'staff crew' : r === 'office' ? 'the office' : r === 'head' ? 'heads of department' : 'freelancers'))
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
  /** The addresses they had as someone they were combined with (ADR 0055), which find them too. Missing on older copies. */
  otherEmails?: readonly string[]
  archived: boolean
  role: Role | null
}

/** Whether an account's address is one of this person's: their own, or one they had as someone they were combined with. */
export const hasEmail = (p: Pick<RolePerson, 'email' | 'otherEmails'>, email: string | null | undefined) => {
  const wanted = (email ?? '').trim().toLowerCase()
  return !!wanted && ((p.email ?? '').trim().toLowerCase() === wanted || (p.otherEmails ?? []).includes(wanted))
}

/** A staff person's role as it stands, as picked on their page: none set is staff crew. A freelancer has none to pick. */
export const roleOfPerson = (p: Pick<RolePerson, 'kind' | 'role'>): Role | null => (p.kind === 'staff' ? (p.role ?? 'crew') : null)

/** Whether roles are on: someone, not archived, is a director. */
export const rolesOn = (people: readonly Pick<RolePerson, 'kind' | 'archived' | 'role'>[]) =>
  people.some((p) => !p.archived && p.kind === 'staff' && p.role === 'director')

/** Who an account is on the Crew tab: the first, by id, not archived, with its email (as the server's personByEmail). */
export function personForEmail<P extends RolePerson>(people: readonly P[], email: string): P | undefined {
  const wanted = email.trim().toLowerCase()
  if (!wanted) return undefined
  return people.filter((p) => !p.archived && hasEmail(p, wanted)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
}

/**
 * The role a signed-in account acts with. While roles are off, everyone is
 * treated as a director. An account matched to a freelancer is a freelancer
 * (ADR 0051); one matched to nobody is staff crew: it can look, report a
 * fault, and nothing that needs a person of its own.
 */
export function roleForEmail(people: readonly RolePerson[], email: string, admin = false): { role: Role; on: boolean; personId?: string } {
  if (!rolesOn(people)) return { role: 'director', on: false }
  const me = personForEmail(people, email)
  const role: Role = admin ? 'director' : !me ? 'crew' : me.kind === 'freelancer' ? 'freelancer' : (roleOfPerson(me) ?? 'crew')
  return { role, on: true, ...(me ? { personId: me.id } : {}) }
}

/**
 * A system admin (ADR 0060) is an account the
 * server's settings name, not anyone on the Crew tab: whoever builds and
 * sets the app up. They act as a director whatever their person's role says,
 * but aren't one: they don't switch roles on, and don't count as the
 * director who must always be left.
 */
export const isSystemAdmin = (admins: readonly string[] | undefined, email: string | null | undefined) => {
  const wanted = (email ?? '').trim().toLowerCase()
  return !!wanted && (admins ?? []).includes(wanted)
}

/** Two emails as an account is matched to a person: trimmed, in any case. */
export const sameEmail = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

/**
 * Whether a person's email and kind decide a role above staff crew (audit
 * finding 12): the email is how their account finds them, and a freelancer
 * has none. Read from the role as kept, so a freelancer who was one counts.
 */
export const holdsARole = (p: Pick<RolePerson, 'role'>) => p.role !== null && p.role !== 'crew' && p.role !== 'freelancer'

/** Who can change the email or kind of someone who holds a role: a role that changes settings, or anyone while roles are off. */
export const mayChangeWhoSignsIn = (role: Role | null | undefined) => !role || roleCan(role, 'settings')

/** Why someone can't change the email or kind of a person who holds a role. */
export function whoSignsInRefusal(name: string, held: Role, role?: Role): string {
  return `Only ${whoCan('settings')} can change ${name}'s email or type: it's how they sign in as ${ROLE_LABELS[held]}.${role ? ` Your role is ${ROLE_LABELS[role]}.` : ''}`
}

/** Why an email someone else on the Crew tab has can't be given to another person: the account would find the wrong one. */
export const emailInUseRefusal = (other: string) => `${other} already has that email. Each person needs their own, as it's how the app knows who signs in.`
export const emailBackRefusal = (name: string, other: string) =>
  `${other} now has ${name}'s email, so ${name} can't be brought back until one of them has another. Each person needs their own, as it's how the app knows who signs in.`

/** Someone else, not archived, with this email, as the server checks it before keeping one. */
export function emailTakenBy<P extends Pick<RolePerson, 'id' | 'email' | 'otherEmails' | 'archived'>>(people: readonly P[], id: string, email: string | null | undefined): P | undefined {
  if (!email?.trim()) return undefined
  return people.find((p) => p.id !== id && !p.archived && hasEmail(p, email))
}
