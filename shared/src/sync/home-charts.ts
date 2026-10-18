import { sameDepartment, departmentOf } from '../crew.ts'
import { kindOf, STOPPED } from '../jobs.ts'
import type { CallView } from './crew-view.ts'
import type { JobView } from './jobs-view.ts'
import type { KitLineView } from './kit-view.ts'
import type { MonthMoney } from './money-view.ts'
import { addDays, mondayOf } from './plan.ts'

/**
 * The charts on Home (ADR 0054): how the weeks, days and months ahead
 * stand, worked out from this device's own copy so they draw with no
 * signal too. Each column is one week, day or month, cut into parts that
 * stack from the baseline: what's settled first, then what isn't yet, then
 * what's short. Home picks which to draw for whoever is looking.
 */

export interface Column {
  key: string
  /** Under the column: "20", "Oct". */
  tick: string
  /** What the column is, in full, for the line above the chart: "Week of 20 October". */
  name: string
  /** The parts, bottom up, in the chart's series order. */
  parts: number[]
  /** The column today is in. */
  now?: boolean
}

const short = (day: string, o: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-IE', { ...o, timeZone: 'UTC' })

/** Gigs and hires: the work. Errands and meetings fill a calendar, not a week. */
const isWork = (j: JobView) => !STOPPED.includes(j.status) && (kindOf(j) === 'gig' || kindOf(j) === 'hire')
const onBetween = (j: JobView, from: string, to: string) => j.phases.some((p) => p.start <= to && p.end >= from)

/** Jobs on in each week from this one on, confirmed and not yet decided: how busy the weeks ahead are. */
export function jobsByWeek(jobs: readonly JobView[], today: string, weeks = 8): Column[] {
  const first = mondayOf(today)
  return Array.from({ length: weeks }, (_, i) => {
    const from = addDays(first, i * 7)
    const to = addDays(from, 6)
    const on = jobs.filter((j) => isWork(j) && onBetween(j, from, to))
    const confirmed = on.filter((j) => j.status === 'confirmed').length
    return {
      key: from,
      tick: i === 0 || from.slice(8) <= '07' ? short(from, { day: 'numeric', month: 'short' }) : short(from, { day: 'numeric' }),
      name: i === 0 ? 'This week' : `Week of ${short(from, { day: 'numeric', month: 'long' })}`,
      parts: [confirmed, on.length - confirmed],
      now: i === 0,
    }
  })
}

/** The first of the month `n` months from the one `day` is in. */
function monthFrom(day: string, n: number): string {
  const d = new Date(`${day.slice(0, 7)}-01T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

/** Jobs on in each month around this one, confirmed and not: the shape of the season. */
export function jobsByMonth(jobs: readonly JobView[], today: string, back = 6, ahead = 5): Column[] {
  return Array.from({ length: back + 1 + ahead }, (_, i) => {
    const from = monthFrom(today, i - back)
    const to = addDays(monthFrom(from, 1), -1)
    const on = jobs.filter((j) => isWork(j) && onBetween(j, from, to))
    const confirmed = on.filter((j) => j.status === 'confirmed').length
    return {
      key: from.slice(0, 7),
      tick: short(from, { month: 'narrow' }),
      name: short(from, { month: 'long', year: 'numeric' }),
      parts: [confirmed, on.length - confirmed],
      now: i === back,
    }
  })
}

/**
 * Crew on each day from today: booked, said yes but not yet confirmed, and
 * still needed. One department's calls when it's given (ADR 0046).
 */
export function crewByDay(calls: readonly CallView[], today: string, days = 14, department?: string): Column[] {
  const open = calls.filter((c) => c.status === 'open' && c.end >= today && c.start <= addDays(today, days - 1) && (!department || sameDepartment(departmentOf(c), department)))
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(today, i)
    let booked = 0
    let waiting = 0
    let needed = 0
    for (const c of open) {
      if (!c.days.includes(day)) continue
      const held = Math.min(c.needed, c.heldByDay[day] ?? 0)
      const confirmed = Math.min(held, c.offers.filter((o) => o.status === 'confirmed' && o.days.includes(day)).length)
      booked += confirmed
      waiting += held - confirmed
      needed += c.needed - held
    }
    return { key: day, tick: short(day, { day: 'numeric' }), name: i === 0 ? 'Today' : short(day, { weekday: 'long', day: 'numeric', month: 'long' }), parts: [booked, waiting, needed], now: i === 0 }
  })
}

/** Kit held for jobs each day from today, by how many items: confirmed jobs, then pencilled ones. One department's when `keep` says. */
export function kitByDay(lines: readonly KitLineView[], today: string, days = 14, keep: (l: KitLineView) => boolean = () => true): Column[] {
  const held = lines.filter((l) => l.held && l.hold !== 'none' && l.own > 0 && l.held.end >= today && keep(l))
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(today, i)
    let confirmed = 0
    let pencilled = 0
    for (const l of held) {
      if (l.held!.start > day || l.held!.end < day) continue
      if (l.hold === 'held') confirmed += l.own
      else pencilled += l.own
    }
    return { key: day, tick: short(day, { day: 'numeric' }), name: i === 0 ? 'Today' : short(day, { weekday: 'long', day: 'numeric', month: 'long' }), parts: [confirmed, pencilled], now: i === 0 }
  })
}

/** Days someone is booked in each week from this one: confirmed, then said yes and not yet confirmed. */
export function myWeeks(calls: readonly CallView[], personId: string, today: string, weeks = 8): Column[] {
  const offers = calls.filter((c) => c.status === 'open' && c.end >= today).flatMap((c) => c.offers.filter((o) => o.personId === personId && (o.status === 'confirmed' || o.status === 'accepted')))
  const first = mondayOf(today)
  return Array.from({ length: weeks }, (_, i) => {
    const from = addDays(first, i * 7)
    const to = addDays(from, 6)
    const daysIn = (status: string) => new Set(offers.filter((o) => o.status === status).flatMap((o) => o.days.filter((d) => d >= from && d <= to && d >= today))).size
    return {
      key: from,
      tick: i === 0 || from.slice(8) <= '07' ? short(from, { day: 'numeric', month: 'short' }) : short(from, { day: 'numeric' }),
      name: i === 0 ? 'This week' : `Week of ${short(from, { day: 'numeric', month: 'long' })}`,
      parts: [daysIn('confirmed'), daysIn('accepted')],
      now: i === 0,
    }
  })
}

/** Money in each month around this one, in cents before VAT: confirmed, then quoted and not yet confirmed. */
export function moneyByMonth(months: readonly MonthMoney[], today: string, back = 3, ahead = 2): Column[] {
  const by = new Map(months.map((m) => [m.key, m]))
  return Array.from({ length: back + 1 + ahead }, (_, i) => {
    const from = monthFrom(today, i - back)
    const m = by.get(from.slice(0, 7))
    const confirmed = m?.confirmed ?? 0
    return {
      key: from.slice(0, 7),
      tick: short(from, { month: 'short' }),
      name: short(from, { month: 'long', year: 'numeric' }),
      parts: [confirmed, Math.max(0, (m?.quoted ?? 0) - confirmed)],
      now: i === back,
    }
  })
}
