import type { CommandArgs, Mutation } from '../commands.ts'
import { HOLDING } from '../crew.ts'
import {
  allowanceId,
  canApproveLeave,
  leaveBalance,
  leaveDays,
  leaveLabel,
  leaveSpanLabel,
  requestsOverlap,
  type LeaveAllowance,
  type LeaveBalance,
  type LeaveEntities,
  type LeaveRequest,
  type LieuEntry,
} from '../leave.ts'
import type { CrewView, PersonView } from './crew-view.ts'

/**
 * Leave (ADR 0024) as a device sees it: what the server has said, with
 * this device's own waiting changes laid over it, the balances for each
 * staff person and a year, and the queue for whoever approves time off,
 * with what they should know before deciding.
 */

export interface LeaveRequestView extends LeaveRequest {
  pending: boolean
  person: PersonView | undefined
}
export interface LieuEntryView extends LieuEntry {
  pending: boolean
  person: PersonView | undefined
}
export interface LeaveAllowanceView extends LeaveAllowance {
  pending: boolean
}

/** Something waiting on an approver: a request or a lieu entry, with what to weigh up. */
export type LeaveQueueItem = { kind: 'request'; request: LeaveRequestView; person: PersonView | undefined; warnings: string[]; at: string } | {
  kind: 'entry'
  entry: LieuEntryView
  person: PersonView | undefined
  warnings: string[]
  at: string
}

export interface LeaveView {
  /** Every request this device knows of, by start day. */
  requests: LeaveRequestView[]
  /** Every lieu entry, by the day worked. */
  entries: LieuEntryView[]
  /** The allowance set for a person and a year, if any. */
  allowance(personId: string, year: number): LeaveAllowanceView | undefined
  balance(personId: string, year: number): LeaveBalance
  requestsFor(personId: string, year: number): LeaveRequestView[]
  entriesFor(personId: string, year: number): LieuEntryView[]
  /** Waiting on an approver, oldest first. */
  queue: LeaveQueueItem[]
  /** Staff, not archived, by name: everyone who has leave. */
  staff: PersonView[]
  /** Staff who can approve time off. */
  approvers: PersonView[]
}

type Tables = { [E in keyof LeaveEntities]: Record<string, LeaveEntities[E]> }

export function leaveView(entities: Partial<Tables>, outbox: readonly (Mutation & { appliedSeq?: number })[], cursor: number, crew: CrewView, today: string): LeaveView {
  const people = new Map(crew.people.map((p) => [p.id, p]))
  const requests = new Map<string, LeaveRequestView>()
  // Snapshots saved before leave existed have no tables for it.
  for (const r of Object.values(entities.leaveRequest ?? {})) requests.set(r.id, { ...r, pending: false, person: people.get(r.personId) })
  const entries = new Map<string, LieuEntryView>()
  for (const e of Object.values(entities.lieuEntry ?? {})) entries.set(e.id, { ...e, pending: false, person: people.get(e.personId) })
  const allowances = new Map<string, LeaveAllowanceView>()
  for (const a of Object.values(entities.leaveAllowance ?? {})) allowances.set(a.id, { ...a, pending: false })

  const decided = (status: 'approved' | 'declined', a: { reason: string; by?: string }, at: string) => ({
    status,
    reason: a.reason,
    decidedBy: a.by ?? null,
    decidedAt: at,
    pending: true,
  })

  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    switch (m.name) {
      case 'leave.request': {
        const a = m.args as CommandArgs<'leave.request'>
        // The server counts the days itself; the same rule here shows the person what to expect.
        if (!requests.has(a.id))
          requests.set(a.id, {
            ...a,
            days: leaveDays(a.start, a.end),
            status: 'waiting',
            requestedAt: m.createdAt,
            decidedBy: null,
            decidedAt: null,
            reason: '',
            pending: true,
            person: people.get(a.personId),
          })
        break
      }
      case 'leave.cancel': {
        const r = requests.get((m.args as CommandArgs<'leave.cancel'>).id)
        if (r && (r.status === 'waiting' || r.status === 'approved')) requests.set(r.id, { ...r, status: 'cancelled', pending: true })
        break
      }
      case 'leave.decide': {
        const a = m.args as CommandArgs<'leave.decide'>
        const r = requests.get(a.id)
        if (r?.status === 'waiting') requests.set(r.id, { ...r, ...decided(a.approved ? 'approved' : 'declined', a, m.createdAt) })
        break
      }
      case 'lieu.log': {
        const a = m.args as CommandArgs<'lieu.log'>
        if (!entries.has(a.id))
          entries.set(a.id, { ...a, status: 'waiting', loggedAt: m.createdAt, decidedBy: null, decidedAt: null, reason: '', pending: true, person: people.get(a.personId) })
        break
      }
      case 'lieu.cancel': {
        const e = entries.get((m.args as CommandArgs<'lieu.cancel'>).id)
        if (e && (e.status === 'waiting' || e.status === 'approved')) entries.set(e.id, { ...e, status: 'cancelled', pending: true })
        break
      }
      case 'lieu.decide': {
        const a = m.args as CommandArgs<'lieu.decide'>
        const e = entries.get(a.id)
        if (e?.status === 'waiting') entries.set(e.id, { ...e, ...decided(a.approved ? 'approved' : 'declined', a, m.createdAt) })
        break
      }
      case 'leave.allowance': {
        const a = m.args as CommandArgs<'leave.allowance'>
        const id = allowanceId(a.personId, a.year)
        allowances.set(id, { id, personId: a.personId, year: a.year, days: a.days, carriedOver: a.carriedOver, note: a.note, pending: true })
        break
      }
    }
  }

  const allRequests = [...requests.values()].sort((a, b) => a.start.localeCompare(b.start) || a.requestedAt.localeCompare(b.requestedAt))
  const allEntries = [...entries.values()].sort((a, b) => a.day.localeCompare(b.day) || a.loggedAt.localeCompare(b.loggedAt))
  const staff = crew.people.filter((p) => p.kind === 'staff' && !p.archived)
  const inYear = (d: string, year: number) => Number(d.slice(0, 4)) === year

  /** What an approver should know about a span of days before deciding. */
  const warningsFor = (personId: string, span: { start: string; end: string }, requestId?: string): string[] => {
    const out: string[] = []
    for (const c of crew.calls) {
      if (c.status !== 'open') continue
      for (const o of c.offers) {
        if (o.personId !== personId || !HOLDING.includes(o.status)) continue
        const hit = o.days.filter((d) => d >= span.start && d <= span.end).sort()
        if (hit.length) out.push(`Booked on ${c.project}${c.phase ? ` (${c.phase})` : ''}, ${leaveSpanLabel({ start: hit[0]!, end: hit.at(-1)! })}`)
      }
    }
    for (const u of crew.unavailability) {
      const who = people.get(u.personId)
      if (u.personId === personId || !who || who.kind !== 'staff' || who.archived || !requestsOverlap(u, span)) continue
      out.push(`${who.name} is off ${leaveSpanLabel(u)}${u.note ? ` (${u.note})` : ''}`)
    }
    for (const r of allRequests) {
      const who = people.get(r.personId)
      if (r.personId === personId || r.id === requestId || r.status !== 'waiting' || !who || !requestsOverlap(r, span)) continue
      out.push(`${who.name} has asked for ${leaveSpanLabel(r)} too`)
    }
    return out
  }

  const queue: LeaveQueueItem[] = [
    ...allRequests
      .filter((r) => r.status === 'waiting')
      .map((r): LeaveQueueItem => ({ kind: 'request', request: r, person: r.person, warnings: warningsFor(r.personId, r, r.id), at: r.requestedAt })),
    ...allEntries.filter((e) => e.status === 'waiting').map((e): LeaveQueueItem => ({ kind: 'entry', entry: e, person: e.person, warnings: workedOn(crew, e), at: e.loggedAt })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  return {
    requests: allRequests,
    entries: allEntries,
    allowance: (personId, year) => allowances.get(allowanceId(personId, year)),
    balance: (personId, year) => leaveBalance(personId, year, allowances.get(allowanceId(personId, year)), allRequests, allEntries, today),
    requestsFor: (personId, year) => allRequests.filter((r) => r.personId === personId && inYear(r.start, year)),
    entriesFor: (personId, year) => allEntries.filter((e) => e.personId === personId && inYear(e.day, year)),
    queue,
    staff,
    approvers: staff.filter(canApproveLeave),
  }
}

/** For a lieu entry: the job the person held that day, which says whether the day was worked for us. */
function workedOn(crew: CrewView, e: LieuEntry): string[] {
  const out: string[] = []
  for (const c of crew.calls) {
    if (c.status !== 'open') continue
    for (const o of c.offers) if (o.personId === e.personId && HOLDING.includes(o.status) && o.days.includes(e.day)) out.push(`Booked on ${c.project}${c.phase ? ` (${c.phase})` : ''} that day`)
  }
  if (!out.length) out.push('Not booked on any job that day')
  return out
}

/** The note a request's days off carry, for the planner and the feed. */
export const leaveNote = (r: Pick<LeaveRequest, 'type' | 'days'>) => leaveLabel(r.type, r.days)
