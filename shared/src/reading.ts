import type { CommandName } from './commands.ts'
import { sameDepartment, type CrewCall, type Offer, type Person } from './crew.ts'
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
}

/** What a device reads with roles off, sign-in off, or for the office and directors. */
export const READS_EVERYTHING: Reading = { rates: true, links: 'all' }

/** Whether nothing is left out for this reader. */
export const readsEverything = (r: Reading | undefined) => !r || (r.rates && r.links === 'all')

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
  if (role === 'head') return { rates: who.headsSeeRates === true, links: 'department', ...own, department: who.department?.trim() || null }
  return { rates: false, links: 'own', ...own }
}

/** Two readings the same, so a device knows when what it's sent has changed and reads its copy again (ADR 0046). */
export function sameReading(a: Reading | undefined, b: Reading | undefined): boolean {
  const key = (r: Reading | undefined) =>
    readsEverything(r) ? '' : JSON.stringify([r!.rates, r!.links, r!.personId ?? null, r!.links === 'department' ? (r!.department ?? '').toLowerCase() : null])
  return key(a) === key(b)
}

/** A person as this reader is sent them: their rate and link left out where the reader doesn't read them. */
export function personAsRead(p: Person, r: Reading): Person {
  if (readsEverything(r) || p.id === r.personId) return p
  const out: Person = { ...p }
  if (!r.rates) Object.assign(out, { dayRateCents: null, rateHidden: true })
  const link = r.links === 'all' || (r.links === 'department' && sameDepartment(p.department, r.department))
  if (!link) Object.assign(out, { linkToken: '', linkHidden: true })
  return out
}

/** A call as this reader is sent it: its rate left out where they don't read rates. */
export function callAsRead(c: CrewCall, r: Reading): CrewCall {
  return r.rates ? c : { ...c, dayRateCents: null, rateHidden: true }
}

/** An offer or booking as this reader is sent it: both rates left out unless they read rates, or it's their own. */
export function offerAsRead(o: Offer, r: Reading): Offer {
  return r.rates || o.personId === r.personId ? o : { ...o, dayRateCents: null, counterRateCents: null, rateHidden: true }
}

/** A timesheet as this reader is sent it: the rate and the extras' amounts left out unless they read rates, or it's their own. */
export function timesheetAsRead(t: Timesheet, mine: boolean, r: Reading): Timesheet {
  if (r.rates || mine) return t
  const none = (extras: Timesheet['extras']) => extras.map((e) => ({ ...e, cents: 0 }))
  return { ...t, dayRateCents: null, extras: none(t.extras), sent: { ...t.sent, dayRateCents: null, extras: none(t.sent.extras) }, amountsHidden: true }
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

/** Why a role that doesn't read rates can't set one, and who can. */
export const RATES_REFUSAL =
  "Only the office and directors see crew rates, so setting a rate, agreeing one or deciding a timesheet is theirs. A director can let heads of department see rates in Admin."
