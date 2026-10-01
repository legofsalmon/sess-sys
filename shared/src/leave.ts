import { z } from 'zod'
import { dayLabel, daysLabel, eachDay, type Person } from './crew.ts'
import { day } from './day.ts'
import { workingDays } from './holidays.ts'
import { text, whole } from './plain.ts'

/**
 * Staff leave and time in lieu (ADR 0024): annual leave applied for and
 * approved in whole days, and days in lieu earned by working a day off.
 * Staff only; freelancers mark days off on their link. The leave year is
 * the calendar year, and a request is counted in the weekdays it holds
 * that aren't Irish public holidays. Approved leave is days off: the
 * planner shows it and offers warn, as for any days off.
 */

const id = z.string().min(1).max(64)

/** Four working weeks: the statutory minimum, and the year's allowance until an approver sets one. */
export const DEFAULT_ALLOWANCE_DAYS = 20

export const LEAVE_TYPES = ['annual', 'lieu'] as const
export type LeaveType = (typeof LEAVE_TYPES)[number]

export const LEAVE_STATUSES = ['waiting', 'approved', 'declined', 'cancelled'] as const
export type LeaveStatus = (typeof LEAVE_STATUSES)[number]

export interface LeaveAllowance {
  /** `<personId>-<year>`, so there's only ever one for a person and a year. */
  id: string
  personId: string
  year: number
  days: number
  /** Days left over from the year before, written in by an approver. */
  carriedOver: number
  note: string
}

export interface LeaveRequest {
  id: string
  personId: string
  type: LeaveType
  start: string
  end: string
  /** The weekdays in the span that aren't public holidays, counted by the server. */
  days: number
  note: string
  status: LeaveStatus
  requestedAt: string
  /** Who approved or declined it, by person; null while it waits. */
  decidedBy: string | null
  decidedAt: string | null
  /** From whoever decided it, for the person. */
  reason: string
}

export interface LieuEntry {
  id: string
  personId: string
  /** The day worked. */
  day: string
  /** How many days in lieu it earns; a long show day can be worth more than one. */
  days: number
  note: string
  status: LeaveStatus
  loggedAt: string
  decidedBy: string | null
  decidedAt: string | null
  reason: string
}

export interface LeaveEntities {
  leaveAllowance: LeaveAllowance
  leaveRequest: LeaveRequest
  lieuEntry: LieuEntry
}
export const LEAVE_ENTITY_NAMES = ['leaveAllowance', 'leaveRequest', 'lieuEntry'] as const

export const allowanceId = (personId: string, year: number) => `${personId}-${year}`

/** The leave year a day belongs to. */
export const yearOf = (d: string) => Number(d.slice(0, 4))

const reason = text(500, 'The reason')
const note = text(500, 'The note')
/** Who is deciding, when sign-in is off and the device has asked "Who are you?"; ignored once sign-in is on. */
const by = id.optional()

export const leaveCommandSchemas = {
  /** Ask for annual leave or days in lieu, from the person's own device. */
  'leave.request': z
    .object({ id, personId: id, type: z.enum(LEAVE_TYPES, { message: 'Annual leave or days in lieu.' }), start: day, end: day, note })
    .refine((r) => r.start <= r.end, { message: 'The leave ends before it starts.' }),
  /** The requester takes it back, while it waits or before it starts. */
  'leave.cancel': z.object({ id, by }),
  /** Approve or decline, by someone who can approve time off. */
  'leave.decide': z.object({ id, approved: z.boolean(), reason, by }),
  /** A day worked that earns days in lieu. */
  'lieu.log': z.object({ id, personId: id, day, days: whole(1, 5, 'How many days'), note }),
  'lieu.cancel': z.object({ id, by }),
  'lieu.decide': z.object({ id, approved: z.boolean(), reason, by }),
  /** A person's allowance for a year, set by an approver. */
  'leave.allowance': z.object({
    personId: id,
    year: whole(2000, 2999, 'The year'),
    days: whole(0, 366, 'The allowance'),
    carriedOver: whole(0, 366, 'Carried over'),
    note,
    by,
  }),
} as const

/** How many days a span counts as: its weekdays that aren't public holidays. */
export function leaveDays(start: string, end: string): number {
  return workingDays(start, end).length
}

/** "5 days", "1 day", "no days". */
export function leaveDaysLabel(n: number): string {
  return n === 0 ? 'no days' : `${n} day${n === 1 ? '' : 's'}`
}

/** What the leave is, for the planner's note, the feed and the history. */
export function leaveLabel(type: LeaveType, days = 1): string {
  if (type === 'annual') return 'Annual leave'
  return days === 1 ? 'Day in lieu' : 'Days in lieu'
}

/** "Mon 6 to Fri 10 Oct", or "Mon 6 Oct" for one day. */
export function leaveSpanLabel(r: { start: string; end: string }): string {
  return r.start === r.end ? dayLabel(r.start) : daysLabel(eachDay(r.start, r.end))
}

/** Whether a request's days overlap another's. Only waiting and approved requests hold days. */
export function requestsOverlap(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return a.start <= b.end && b.start <= a.end
}

/** Requests still holding days: waiting on a decision, or approved. */
export const HOLDS_DAYS: readonly LeaveStatus[] = ['waiting', 'approved']

/** Why a request can't be cancelled, or null when it can. */
export function noCancelReason(r: Pick<LeaveRequest, 'status' | 'start'>, today: string): string | null {
  if (r.status === 'cancelled') return 'This request was already cancelled.'
  if (r.status === 'declined') return "This request was declined, so there's nothing to cancel."
  if (r.status === 'approved' && r.start <= today) return 'This leave has started, so it can no longer be cancelled. Talk to whoever approves time off.'
  return null
}

/** A person's annual leave and time in lieu for a year, in days. */
export interface LeaveBalance {
  personId: string
  year: number
  allowance: number
  carriedOver: number
  /** Whether an approver has set the year's allowance; otherwise the default stands. */
  allowanceSet: boolean
  annual: {
    /** Approved days on or before today. */
    taken: number
    /** Approved days after today. */
    booked: number
    waiting: number
    /** The allowance and the carry-over, less everything approved. */
    left: number
  }
  lieu: {
    /** Approved entries. */
    earned: number
    /** Entries not yet decided. */
    waitingToApprove: number
    taken: number
    booked: number
    waiting: number
    /** Earned, less everything approved. */
    left: number
  }
}

/**
 * The balance, from the year's allowance (or none), the person's requests
 * and lieu entries, and today. A request's days are split by day, so one
 * running over today counts partly as taken and partly as booked. The
 * server and the device's view work it out the same way.
 */
export function leaveBalance(
  personId: string,
  year: number,
  allowance: Pick<LeaveAllowance, 'days' | 'carriedOver'> | undefined,
  requests: readonly Pick<LeaveRequest, 'personId' | 'type' | 'start' | 'end' | 'status'>[],
  entries: readonly Pick<LieuEntry, 'personId' | 'day' | 'days' | 'status'>[],
  today: string
): LeaveBalance {
  const sum = (type: LeaveType) => {
    const out = { taken: 0, booked: 0, waiting: 0 }
    for (const r of requests) {
      if (r.personId !== personId || r.type !== type || yearOf(r.start) !== year) continue
      if (r.status === 'waiting') out.waiting += leaveDays(r.start, r.end)
      else if (r.status === 'approved') {
        for (const d of workingDays(r.start, r.end)) {
          if (d <= today) out.taken++
          else out.booked++
        }
      }
    }
    return out
  }
  const annual = sum('annual')
  const lieu = sum('lieu')
  let earned = 0
  let waitingToApprove = 0
  for (const e of entries) {
    if (e.personId !== personId || yearOf(e.day) !== year) continue
    if (e.status === 'approved') earned += e.days
    else if (e.status === 'waiting') waitingToApprove += e.days
  }
  const days = allowance?.days ?? DEFAULT_ALLOWANCE_DAYS
  const carriedOver = allowance?.carriedOver ?? 0
  return {
    personId,
    year,
    allowance: days,
    carriedOver,
    allowanceSet: allowance !== undefined,
    annual: { ...annual, left: days + carriedOver - annual.taken - annual.booked },
    lieu: { earned, waitingToApprove, ...lieu, left: earned - lieu.taken - lieu.booked },
  }
}

/** What a person has left to ask for of a type: for the refusals, on the server and before sending. */
export function daysLeft(b: LeaveBalance, type: LeaveType): number {
  return type === 'annual' ? b.annual.left : b.lieu.left
}

/** "Only 2 days of annual leave left this year", "Only 1 day in lieu to take", "No days in lieu to take". */
export function notEnoughLeft(type: LeaveType, left: number): string {
  const n = Math.max(0, left)
  if (type === 'annual') return n === 0 ? 'No annual leave left this year.' : `Only ${n} day${n === 1 ? '' : 's'} of annual leave left this year.`
  return n === 0 ? 'No days in lieu to take.' : `Only ${n} day${n === 1 ? '' : 's'} in lieu to take.`
}

/** Staff who can approve time off, by the flag on their person. */
export function canApproveLeave(p: Pick<Person, 'kind' | 'archived' | 'approvesLeave'> | undefined): boolean {
  return !!p && p.kind === 'staff' && !p.archived && p.approvesLeave === true
}

/** The person a signed-in account is, by email: the same match the Account tab's feed card makes. */
export function personByEmail<P extends Pick<Person, 'email' | 'archived'>>(people: readonly P[], email: string): P | undefined {
  const wanted = email.trim().toLowerCase()
  return wanted ? people.find((p) => !p.archived && p.email?.trim().toLowerCase() === wanted) : undefined
}
