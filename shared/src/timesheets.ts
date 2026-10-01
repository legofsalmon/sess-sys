import { z } from 'zod'
import { dayLabel, daysLabel, euro, type CrewCall, type Offer, type Person } from './crew.ts'
import { day } from './day.ts'

/**
 * Timesheets (ADR 0022): what a freelancer worked on a booking, so they're
 * paid for it. Freelancers bill a day rate, so a timesheet is the days they
 * worked at the booking's agreed rate, and any extras such as parking,
 * tolls or mileage, not hours. One for each booking: sent from their
 * private link, or put in by the office for them, then checked, changed if
 * need be, and approved by the office in one step. What was sent is kept
 * beside what was approved, so the freelancer sees any change. Staff are
 * paid through payroll, so their bookings have none.
 */

const id = z.string().min(1).max(64)
/** Euro cents, as everywhere else. */
const rate = z.number().int().min(0).max(100_000_00)

/** A timesheet has room for this many extras. */
export const MAX_EXTRAS = 10

export const timesheetExtra = z.object({
  what: z.string().trim().min(1, 'Say what each extra is for.').max(100),
  cents: z.number().int().min(1, 'An extra needs an amount.').max(10_000_00),
})
export type TimesheetExtra = z.infer<typeof timesheetExtra>

/** Sent, and waiting on the office; or approved, with the figures the office agreed. */
export type TimesheetStatus = 'sent' | 'approved'

export interface Timesheet {
  /** The booking's: a timesheet has its offer's id, so there's only ever one. */
  id: string
  status: TimesheetStatus
  /** The days worked: some or all of the booking's, or others of the job's if the office says so. */
  days: string[]
  /** For each day: the booking's agreed rate, unless the office changed it when approving. */
  dayRateCents: number | null
  extras: TimesheetExtra[]
  /** As it was sent, before any change by the office. */
  sent: { days: string[]; dayRateCents: number | null; extras: TimesheetExtra[] }
  /** From the freelancer, for the office. */
  note: string
  /** From the office when approving, for the freelancer: why something changed. */
  officeNote: string
  sentAt: string
  /** Sent by the freelancer on their link, or put in by the office in the app. */
  sentVia: 'link' | 'app'
  approvedAt: string | null
}

export interface TimesheetEntities {
  timesheet: Timesheet
}
export const TIMESHEET_ENTITY_NAMES = ['timesheet'] as const

const days = z.array(day).min(1, 'Tick at least one day worked.').max(400)
const extras = z.array(timesheetExtra).max(MAX_EXTRAS, `A timesheet has room for ${MAX_EXTRAS} extras.`)

export const timesheetCommandSchemas = {
  /** Send a booking's timesheet, or change what was sent while the office hasn't approved it. */
  'timesheet.send': z.object({ id, days, extras, note: z.string().max(1000) }),
  /** Approve it with the figures the office agrees, which may differ from what was sent. */
  'timesheet.approve': z.object({ id, days, dayRateCents: rate, extras, officeNote: z.string().max(1000) }),
  /** Take an approval back, to change it. */
  'timesheet.reopen': z.object({ id }),
} as const

/** The days at the rate, the extras, and both. */
export function timesheetTotal(t: { days: readonly string[]; dayRateCents: number | null; extras: readonly TimesheetExtra[] }) {
  const fees = t.days.length * (t.dayRateCents ?? 0)
  const extrasCents = t.extras.reduce((sum, e) => sum + e.cents, 0)
  return { fees, extras: extrasCents, total: fees + extrasCents }
}

/** "2 days at €320, and €43 of extras: €683". */
export function timesheetSummary(t: { days: readonly string[]; dayRateCents: number | null; extras: readonly TimesheetExtra[] }): string {
  const { extras, total } = timesheetTotal(t)
  const n = `${t.days.length} day${t.days.length === 1 ? '' : 's'}`
  const plus = extras ? `, and ${euro(extras)} of extras` : ''
  if (t.dayRateCents === null) return `${n}, rate to agree${plus}`
  return `${n} at ${euro(t.dayRateCents)}${plus}: ${euro(total)}`
}

/**
 * What the office changed from what was sent, in words for the freelancer:
 * "Fri 18 Sep only, not Fri 18 Sep to Sat 19 Sep", "Parking: €15, not €18",
 * "Left out: Mileage €40", "Added: Tolls €3.10".
 */
export function timesheetChanges(t: Pick<Timesheet, 'days' | 'dayRateCents' | 'extras' | 'sent'>): string[] {
  const out: string[] = []
  const sortedDays = (d: readonly string[]) => [...d].sort().join()
  if (sortedDays(t.days) !== sortedDays(t.sent.days)) out.push(`Days: ${daysLabel([...t.days])}, not ${daysLabel([...t.sent.days])}`)
  if (t.dayRateCents !== t.sent.dayRateCents) out.push(`Day rate: ${euro(t.dayRateCents)}, not ${euro(t.sent.dayRateCents)}`)
  const key = (e: TimesheetExtra) => e.what.trim().toLowerCase()
  const before = new Map(t.sent.extras.map((e) => [key(e), e]))
  const after = new Map(t.extras.map((e) => [key(e), e]))
  for (const [k, e] of before) {
    const now = after.get(k)
    if (!now) out.push(`Left out: ${e.what} ${euro(e.cents)}`)
    else if (now.cents !== e.cents) out.push(`${now.what}: ${euro(now.cents)}, not ${euro(e.cents)}`)
  }
  for (const [k, e] of after) if (!before.has(k)) out.push(`Added: ${e.what} ${euro(e.cents)}`)
  return out
}

/**
 * Why a booking can't have a timesheet (yet), or null when it can: it's a
 * freelancer's, confirmed, on a job going ahead, and its first day has come.
 * The server, the app and the freelancer's page all ask this, so they agree.
 */
export function noTimesheetReason(
  offer: Pick<Offer, 'status' | 'days'>,
  call: Pick<CrewCall, 'status'>,
  person: Pick<Person, 'kind'> | undefined,
  today: string
): string | null {
  if (person?.kind === 'staff') return "Staff are paid through payroll, so there's no timesheet for this."
  if (call.status !== 'open') return 'This job was cancelled, so there is no timesheet for it. Talk to the office about any cancellation fee.'
  if (offer.status !== 'confirmed') return 'Only a confirmed booking has a timesheet.'
  const first = [...offer.days].sort()[0]
  if (first && first > today) return `The timesheet opens on ${dayLabel(first)}, the first day of the booking.`
  return null
}

/** Asking for a timesheet, for WhatsApp, a text or an email. */
export function timesheetMessage(p: Pick<Person, 'name'>, c: Pick<CrewCall, 'project' | 'phase'>, link: string): { text: string; subject: string } {
  const first = p.name.split(' ')[0]
  const job = `${c.project}${c.phase ? ` (${c.phase})` : ''}`
  return {
    text: `Hi ${first}, could you send your timesheet for ${job}? Tick the days you worked and add any extras, such as parking or mileage, here: ${link}`,
    subject: `Timesheet: ${job}`,
  }
}
