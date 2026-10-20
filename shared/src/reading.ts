import type { CommandName } from './commands.ts'
import { sameDepartment, type CrewCall, type Offer, type Person } from './crew.ts'
import type { Document } from './documents.ts'
import type { Role } from './roles.ts'
import type { Timesheet } from './timesheets.ts'

/**
 * What each role reads of crew pay and private links (ADR 0046), the
 * reading half of roles (ADR 0034). Money came first (ADR 0042): its tables
 * aren't sent at all to a role without it. Pay and links sit on records
 * every role needs (who's booked, on which days, whose timesheet is
 * waiting), so here the record is sent and the field is left out:
 *
 * - **Rates**: the day rate on a person, a call, an offer or booking, and a
 *   timesheet's rate and extras. The office and directors read them; heads
 *   of department only when a director lets them; the warehouse and staff
 *   crew never.
 * - **Private links**: a freelancer's link is a key to act as them. The
 *   office and directors read every one; a head of department those of
 *   people in their own department, whose offers they send; the warehouse
 *   and staff crew none.
 * - **Their own**: everyone reads their own rate, link, offers and
 *   timesheets, whatever their role.
 *
 * And what staff crew and freelancers read of other people (ADR 0062):
 *
 * - **Rates by department**: a head of department a director lets see rates
 *   reads those of their own department's people and calls, not everyone's.
 * - **Contact details**: someone's email, the office's notes on them and
 *   their company are the office's and heads'. Staff crew keep phone numbers,
 *   as they ring each other on the day; a freelancer signed in reads none.
 * - **Documents**: certificates and insurance, and their files, are read by
 *   the person they belong to, the office, directors and heads only.
 * - **Notes on time off and answers**: what someone wrote asking for leave,
 *   saying they're away or running late, or answering an offer, and the
 *   reason they were given. The days and answers stay, so the planner and
 *   the crew screens show who's away and who's on.
 *
 * The server sends what's left out as nothing (a null rate, an empty link,
 * a 0 extra) with a flag saying it's hidden, so every screen can say so
 * rather than "rate to agree" or "no link yet", and nothing adds up to a
 * wrong figure. With roles off, or sign-in off, everyone reads everything.
 */

export interface Reading {
  /** Crew rates: day rates on people, calls, offers and bookings, and timesheets' amounts. */
  rates: boolean
  /** Freelancers' private links: everyone's, their own department's (a head of department), or their own only. */
  links: 'all' | 'department' | 'own'
  /** The person this account is on the Crew tab, whose own rate, link, offers and timesheets they always read. */
  personId?: string
  /** For links by department: the head's own department, from their profile. */
  department?: string | null
  /** For a head who reads rates: only their own department's (ADR 0062). Absent is every rate. */
  ratesBy?: 'department'
  /** Other people's email, notes and company, and phone unless 'phones' (ADR 0062). Absent is all. */
  details?: 'all' | 'phones' | 'own'
  /** Other people's documents, certificates and insurance, and their files (ADR 0062). Absent is all. */
  documents?: 'all' | 'own'
}

/** What a device reads with roles off, sign-in off, or for the office and directors. */
export const READS_EVERYTHING: Reading = { rates: true, links: 'all' }

/** Whether nothing is left out for this reader. */
export const readsEverything = (r: Reading | undefined) =>
  !r || (r.rates && !r.ratesBy && r.links === 'all' && (r.details ?? 'all') === 'all' && (r.documents ?? 'all') === 'all')

/** Who is reading, as far as reading goes: their person on the Crew tab, their department, and the director's choice for heads. */
export interface ReaderOf {
  personId?: string
  department?: string | null
  headsSeeRates?: boolean
}

/** What a role reads. None is held to nothing, so reads everything, as before roles. */
export function readingFor(role: Role | null | undefined, who: ReaderOf = {}): Reading {
  if (!role || role === 'director' || role === 'office') return READS_EVERYTHING
  const own = who.personId ? { personId: who.personId } : {}
  if (role === 'head') {
    const rates = who.headsSeeRates === true
    return { rates, ...(rates ? { ratesBy: 'department' as const } : {}), links: 'department', ...own, department: who.department?.trim() || null }
  }
  return { rates: false, links: 'own', ...own, details: role === 'crew' ? 'phones' : 'own', documents: 'own' }
}

/** Whether this reader reads the rates of a person or call in this department: every one, their own department's, or none. */
export function readsRatesIn(r: Reading, department: string | null | undefined): boolean {
  return r.rates && (r.ratesBy !== 'department' || sameDepartment(department, r.department))
}

/** Whether every rate there is reaches this reader, as the history and the notices need to tell figures. */
export const readsEveryRate = (r: Reading) => r.rates && r.ratesBy !== 'department'

/** Two readings the same, so a device knows when what it's sent has changed and reads its copy again (ADR 0046). */
export function sameReading(a: Reading | undefined, b: Reading | undefined): boolean {
  const key = (r: Reading | undefined) =>
    readsEverything(r)
      ? ''
      : JSON.stringify([
          r!.rates,
          r!.links,
          r!.personId ?? null,
          r!.links === 'department' || r!.ratesBy ? (r!.department ?? '').toLowerCase() : null,
          r!.ratesBy ?? null,
          r!.details ?? 'all',
          r!.documents ?? 'all',
        ])
  return key(a) === key(b)
}

/** A person as this reader is sent them: their rate, link and contact details left out where the reader doesn't read them. */
export function personAsRead(p: Person, r: Reading): Person {
  if (readsEverything(r) || p.id === r.personId) return p
  const out: Person = { ...p }
  if (!readsRatesIn(r, p.department)) Object.assign(out, { dayRateCents: null, rateHidden: true })
  if (!readsLinkOf(r, p)) Object.assign(out, { linkToken: '', linkHidden: true })
  const details = r.details ?? 'all'
  if (details !== 'all') {
    const { otherEmails: _, ...rest } = out
    Object.assign(rest, { email: null, notes: '', company: null, detailsHidden: true }, details === 'own' ? { phone: null } : {})
    // Their face goes with their phone (ADR 0063): staff crew see who they're ringing, a freelancer signed in neither.
    if (details === 'own') delete (rest as Person).photo
    return rest
  }
  return out
}

/** A call as this reader is sent it: its rate left out where they don't read rates, or not its department's. */
export function callAsRead(c: CrewCall, r: Reading): CrewCall {
  return readsRatesIn(r, c.department) ? c : { ...c, dayRateCents: null, rateHidden: true }
}

/** An offer or booking as this reader is sent it: both rates left out unless they read its call's, or it's their own. */
export function offerAsRead(o: Offer, r: Reading, callDepartment?: string | null): Offer {
  const read = notesAsRead(o, r)
  return readsRatesIn(r, callDepartment) || o.personId === r.personId ? read : { ...read, dayRateCents: null, counterRateCents: null, rateHidden: true }
}

/** A timesheet as this reader is sent it: the rate and the extras' amounts left out unless they read its call's rates, or it's their own. */
export function timesheetAsRead(t: Timesheet, mine: boolean, r: Reading, callDepartment?: string | null): Timesheet {
  if (readsRatesIn(r, callDepartment) || mine) return t
  const none = (extras: Timesheet['extras']) => extras.map((e) => ({ ...e, cents: 0 }))
  return { ...t, dayRateCents: null, extras: none(t.extras), sent: { ...t.sent, dayRateCents: null, extras: none(t.sent.extras) }, amountsHidden: true }
}

/** Whether this reader is sent someone's document: all of them, or their own only (ADR 0062). */
export const readsDocumentOf = (r: Reading, doc: Pick<Document, 'personId'>) => (r.documents ?? 'all') === 'all' || doc.personId === r.personId

/** Why someone can't open another person's document, and who can. */
export const DOCUMENTS_REFUSAL = "Only the office, directors and heads of department see other people's certificates and insurance. Your own are on your page."

/**
 * Someone's time off, running late or answer to an offer as this reader is
 * sent it: the days and the answer, without what they wrote about it or the
 * reason they were given, unless it's their own (ADR 0062).
 */
export function notesAsRead<T extends { personId: string; note: string; reason?: string }>(t: T, r: Reading): T {
  if ((r.details ?? 'all') === 'all' || t.personId === r.personId) return t
  return 'reason' in t ? { ...t, note: '', reason: '' } : { ...t, note: '' }
}

/**
 * Whether a change sets or agrees crew pay (ADR 0046), so it's for someone
 * who reads rates: a call made or changed with a rate, and a timesheet sent,
 * approved or reopened. Agreeing a counter-offer is too, which the server
 * sees from the offer itself. A person's usual rate isn't: an edit from a
 * role that doesn't read it keeps what the server has.
 */
export function setsRates(name: CommandName, args: unknown): boolean {
  const a = (args ?? {}) as Record<string, unknown>
  switch (name) {
    case 'call.create':
      return a.dayRateCents !== null && a.dayRateCents !== undefined
    case 'call.update':
      return a.dayRateCents !== undefined
    case 'timesheet.send':
    case 'timesheet.approve':
    case 'timesheet.reopen':
      return true
    default:
      return false
  }
}

/**
 * The person whose private link a change makes anew, so it's for someone
 * who reads that link (ADR 0046): a new link stops the old one, and one
 * this role isn't sent couldn't be sent on. None for any other change.
 */
export function changesLinkOf(name: CommandName, args: unknown): string | undefined {
  return name === 'person.newLink' ? ((args ?? {}) as { id?: string }).id : undefined
}

/** Whether this reader is sent the link of someone in this department, or it's their own. */
export function readsLinkOf(r: Reading, person: { id: string; department?: string | null }): boolean {
  return r.links === 'all' || person.id === r.personId || (r.links === 'department' && sameDepartment(person.department, r.department))
}

/** Why a role can't make a new link for someone whose link it isn't sent, and who can. */
export const LINKS_REFUSAL =
  "Only the office and directors see every freelancer's private link, and a head of department those of people in their own department, so a new link for this person is theirs to make and send."

/** Why a role that doesn't read rates can't set one, and who can. */
export const RATES_REFUSAL_DEPARTMENT =
  "You see the rates of your own department's people and calls, so a rate for anyone else's is the office's to set. Give the call your department, or ask the office."

export const RATES_REFUSAL =
  "Only the office and directors see crew rates, so setting a rate, agreeing one or deciding a timesheet is theirs. A director can let heads of department see rates in Admin."
