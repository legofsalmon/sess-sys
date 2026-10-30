/**
 * Crew's days: every day of a call, how far apart two days are, how calls
 * and offers move with their phase, and days and rates in words.
 */

/** Every day from start to end, inclusive. */
export function eachDay(start: string, end: string): string[] {
  const out: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  for (let i = 0; i < 400; i++) {
    const s = d.toISOString().slice(0, 10)
    if (s > end) break
    out.push(s)
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

const dayMs = 86_400_000
const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * dayMs).toISOString().slice(0, 10)

/** How many days `to` is after `from`; negative when before. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / dayMs)
}

/**
 * The day to ask for an answer by, offered when a call is made (audit
 * finding 21): two days before the first day, or the day before when the
 * job is close, so an answer comes before the job does; none for a job
 * that's over, which a reply-by can't come after. The office can clear it
 * or pick another.
 */
export function suggestedReplyBy(start: string, end: string, today: string): string | null {
  if (end < today) return null
  // Two days before only while that leaves a day to answer in; a job that starts today, or has started, wants its answers today.
  const twoBefore = shiftDay(start, -2)
  const day = twoBefore > today ? twoBefore : shiftDay(start, -1)
  return day > today ? day : today
}

/**
 * Whether a phase's new span holds the whole of its old one: it got longer
 * at one end or both, but didn't move, so nothing on it needs to.
 */
export function phaseOnlyGrew(from: { start: string; end: string }, to: { start: string; end: string }): boolean {
  return to.start <= from.start && to.end >= from.end
}

/**
 * Where a call lands when its phase moves: shifted by the same number of
 * days as the phase's start. A call that was inside the phase stays inside
 * it, cut to the phase's new span, or given the phase's days when none of
 * its own fit; a call that was already outside its phase just moves with
 * it. A phase that only grows hasn't moved, so its calls stay where they
 * are: the crew keep the days they agreed. The server and the device's
 * view work it out the same way.
 */
export function movedCallSpan(
  call: { start: string; end: string },
  from: { start: string; end: string },
  to: { start: string; end: string }
): { start: string; end: string } {
  if (phaseOnlyGrew(from, to)) return { start: call.start, end: call.end }
  const shift = daysBetween(from.start, to.start)
  let start = shiftDay(call.start, shift)
  let end = shiftDay(call.end, shift)
  if (call.start < from.start || call.end > from.end) return { start, end }
  if (start < to.start) start = to.start
  if (end > to.end) end = to.end
  return start > end ? { start: to.start, end: to.end } : { start, end }
}

/**
 * An offer's days once its call's days change: all the new days when it
 * held all the old ones, otherwise the days the person chose that are
 * still in range. When the whole job has moved, `shift` moves the chosen
 * days with it first, so the second day's person is still on the second
 * day. Empty means the person would be left with nothing, which the server
 * refuses for anyone booked rather than quietly un-booking them.
 */
export function offerDaysAfter(held: readonly string[], oldDays: readonly string[], newDays: readonly string[], shift = 0): string[] {
  if (oldDays.every((d) => held.includes(d))) return [...newDays]
  return held.map((d) => (shift ? shiftDay(d, shift) : d)).filter((d) => newDays.includes(d))
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "Fri 3 Oct", the way crew write dates. Built by hand so it reads the same on every phone. Given today, a day outside
 * this calendar year or more than six months from today carries its year, "Sun 25 Jan 2026", so a page that runs from
 * April to March, or a timesheet approved last year, says which year it means (audit, 20 October 2026, finding 89).
 */
export function dayLabel(d: string, today?: string): string {
  const date = new Date(`${d}T12:00:00Z`)
  const label = `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
  return today && (d.slice(0, 4) !== today.slice(0, 4) || Math.abs(daysBetween(today, d)) > HALF_A_YEAR) ? `${label} ${d.slice(0, 4)}` : label
}

/** More than this many days from today, a date says its year. */
const HALF_A_YEAR = 183

export function daysLabel(days: string[], today?: string): string {
  if (days.length === 0) return ''
  const sorted = [...days].sort()
  const all = eachDay(sorted[0]!, sorted[sorted.length - 1]!)
  const label = (d: string) => dayLabel(d, today)
  if (all.length === sorted.length && sorted.length > 1) return `${label(sorted[0]!)} to ${label(sorted[sorted.length - 1]!)}`
  return sorted.map(label).join(', ')
}

export function euro(c: number | null | undefined): string {
  if (c === null || c === undefined) return 'rate to agree'
  return `€${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`
}
