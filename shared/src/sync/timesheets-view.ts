import type { CommandArgs, Mutation } from '../commands.ts'
import { noTimesheetReason, timesheetTotal, type Timesheet, type TimesheetEntities } from '../timesheets.ts'
import type { CallView, CrewView, OfferView, PersonView } from './crew-view.ts'

/**
 * Timesheets (ADR 0022) as the office sees them on a device: each
 * freelancer's confirmed booking that has started, with its timesheet once
 * sent, and this person's own waiting changes laid over them.
 */

export interface TimesheetView extends Timesheet {
  pending: boolean
}

export interface TimesheetRow {
  offer: OfferView
  call: CallView
  person: PersonView | undefined
  timesheet: TimesheetView | undefined
  /** Nothing sent yet; sent, for the office to check; or approved. */
  state: 'not-in' | 'sent' | 'approved'
  /** The booking's last day is over. */
  finished: boolean
  /** From the timesheet, or else the booking: its days at its rate. */
  total: ReturnType<typeof timesheetTotal>
}

export interface TimesheetsView {
  /** A booking's timesheet, by the booking's offer. */
  of(offerId: string): TimesheetView | undefined
  /** A booking and where its timesheet stands, whether or not it can have one. */
  row(offerId: string): TimesheetRow | undefined
  /** Sent, for the office to check: longest waiting first. */
  toApprove: TimesheetRow[]
  /** Bookings over with nothing sent yet: longest over first. */
  notIn: TimesheetRow[]
  /** Approved, most recently first. */
  approved: TimesheetRow[]
}

type Tables = { [E in keyof TimesheetEntities]: Record<string, TimesheetEntities[E]> }

export function timesheetsView(
  entities: Partial<Tables>,
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number,
  crew: CrewView,
  today: string
): TimesheetsView {
  const sheets = new Map<string, TimesheetView>()
  // Snapshots saved before timesheets have no table for them.
  for (const t of Object.values(entities.timesheet ?? {})) sheets.set(t.id, { ...t, pending: false })

  const offers = new Map<string, { offer: OfferView; call: CallView }>()
  for (const call of crew.calls) for (const offer of call.offers) offers.set(offer.id, { offer, call })

  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    switch (m.name) {
      case 'timesheet.send': {
        const a = m.args as CommandArgs<'timesheet.send'>
        const was = sheets.get(a.id)
        if (was?.status === 'approved') break
        const rate = was?.dayRateCents ?? offers.get(a.id)?.offer.dayRateCents ?? null
        const sent = { days: [...a.days].sort(), dayRateCents: rate, extras: a.extras }
        sheets.set(a.id, {
          id: a.id,
          status: 'sent',
          ...sent,
          sent,
          note: a.note,
          officeNote: was?.officeNote ?? '',
          sentAt: was?.sentAt ?? m.createdAt,
          sentVia: was?.sentVia ?? 'app',
          approvedAt: null,
          pending: true,
        })
        break
      }
      case 'timesheet.approve': {
        const a = m.args as CommandArgs<'timesheet.approve'>
        const was = sheets.get(a.id)
        if (!was || was.status === 'approved') break
        sheets.set(a.id, { ...was, status: 'approved', days: [...a.days].sort(), dayRateCents: a.dayRateCents, extras: a.extras, officeNote: a.officeNote, approvedAt: m.createdAt, pending: true })
        break
      }
      case 'timesheet.reopen': {
        const was = sheets.get((m.args as CommandArgs<'timesheet.reopen'>).id)
        if (was?.status === 'approved') sheets.set(was.id, { ...was, status: 'sent', approvedAt: null, pending: true })
        break
      }
    }
  }

  const people = new Map(crew.people.map((p) => [p.id, p]))
  const rows = new Map<string, TimesheetRow>()
  const rowOf = (offerId: string): TimesheetRow | undefined => {
    const known = rows.get(offerId)
    if (known) return known
    const found = offers.get(offerId)
    if (!found) return undefined
    const { offer, call } = found
    const timesheet = sheets.get(offer.id)
    const last = [...offer.days].sort().at(-1) ?? call.end
    const row: TimesheetRow = {
      offer,
      call,
      person: people.get(offer.personId),
      timesheet,
      state: timesheet ? (timesheet.status === 'approved' ? 'approved' : 'sent') : 'not-in',
      finished: last < today,
      total: timesheetTotal(timesheet ?? { days: offer.days, dayRateCents: offer.dayRateCents, extras: [] }),
    }
    rows.set(offerId, row)
    return row
  }

  // Every booking with a timesheet, whatever has happened to it since, and every one that could have one.
  const all: TimesheetRow[] = []
  for (const { offer, call } of offers.values()) {
    if (!sheets.has(offer.id) && noTimesheetReason(offer, call, people.get(offer.personId), today) !== null) continue
    all.push(rowOf(offer.id)!)
  }
  const lastDay = (r: TimesheetRow) => [...r.offer.days].sort().at(-1) ?? r.call.end
  return {
    of: (offerId) => sheets.get(offerId),
    row: rowOf,
    toApprove: all.filter((r) => r.state === 'sent').sort((a, b) => a.timesheet!.sentAt.localeCompare(b.timesheet!.sentAt)),
    notIn: all.filter((r) => r.state === 'not-in' && r.finished).sort((a, b) => lastDay(a).localeCompare(lastDay(b)) || byName(a, b)),
    approved: all
      .filter((r) => r.state === 'approved')
      .sort((a, b) => (b.timesheet!.approvedAt ?? '').localeCompare(a.timesheet!.approvedAt ?? '') || byName(a, b)),
  }
}

const byName = (a: TimesheetRow, b: TimesheetRow) => (a.person?.name ?? '').localeCompare(b.person?.name ?? '')
