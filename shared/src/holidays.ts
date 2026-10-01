/**
 * Irish public holidays, worked out by rule for any year (ADR 0024), so
 * leave never counts one and the planner can mark them. The rules are the
 * ones in the Organisation of Working Time Act and the orders since:
 * New Year's Day; St Brigid's Day (the first Monday in February, or
 * 1 February when that is a Friday); St Patrick's Day; Easter Monday; the
 * first Mondays of May, June and August; the last Monday of October;
 * Christmas Day; St Stephen's Day. A holiday that falls on a weekend is
 * listed on its own day, as the published lists do; the day off in lieu an
 * employer gives for it is their choice, not a date.
 */

export interface PublicHoliday {
  day: string
  name: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

/** 0 for Sunday to 6 for Saturday, the way JavaScript counts. */
export function weekday(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay()
}

/** Monday to Friday. */
export function isWeekday(day: string): boolean {
  const w = weekday(day)
  return w >= 1 && w <= 5
}

/** The first Monday of a month, or the nth. */
function nthMonday(y: number, m: number, n: number): string {
  const first = weekday(ymd(y, m, 1))
  const day = 1 + ((8 - first) % 7) + 7 * (n - 1)
  return ymd(y, m, day)
}

function lastMonday(y: number, m: number): string {
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const last = weekday(ymd(y, m, daysInMonth))
  return ymd(y, m, daysInMonth - ((last + 6) % 7))
}

/** Easter Sunday by the Gregorian computus. */
function easterSunday(y: number): string {
  const a = y % 19
  const b = Math.floor(y / 100)
  const c = y % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return ymd(y, month, day)
}

function dayAfter(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

const known = new Map<number, PublicHoliday[]>()

/** The year's public holidays, in date order. */
export function publicHolidays(year: number): PublicHoliday[] {
  const found = known.get(year)
  if (found) return found
  // St Brigid's Day, since 2023: the first Monday in February, unless 1 February is itself a Friday.
  const brigid = weekday(ymd(year, 2, 1)) === 5 ? ymd(year, 2, 1) : nthMonday(year, 2, 1)
  const list: PublicHoliday[] = [
    { day: ymd(year, 1, 1), name: "New Year's Day" },
    { day: brigid, name: "St Brigid's Day" },
    { day: ymd(year, 3, 17), name: "St Patrick's Day" },
    { day: dayAfter(easterSunday(year)), name: 'Easter Monday' },
    { day: nthMonday(year, 5, 1), name: 'May bank holiday' },
    { day: nthMonday(year, 6, 1), name: 'June bank holiday' },
    { day: nthMonday(year, 8, 1), name: 'August bank holiday' },
    { day: lastMonday(year, 10), name: 'October bank holiday' },
    { day: ymd(year, 12, 25), name: 'Christmas Day' },
    { day: ymd(year, 12, 26), name: "St Stephen's Day" },
  ].sort((a, b) => a.day.localeCompare(b.day))
  known.set(year, list)
  return list
}

/** The holiday's name when the day is one, else undefined. */
export function publicHolidayName(day: string): string | undefined {
  return publicHolidays(Number(day.slice(0, 4))).find((h) => h.day === day)?.name
}

export function isPublicHoliday(day: string): boolean {
  return publicHolidayName(day) !== undefined
}

/** The public holidays among some days, by day, for the planner's band. */
export function publicHolidaysAmong(days: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const d of days) {
    const name = publicHolidayName(d)
    if (name) out[d] = name
  }
  return out
}

/** The weekdays from start to end, inclusive, that aren't public holidays: the days leave is counted in. */
export function workingDays(start: string, end: string): string[] {
  const out: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  // More days than one leave year holds, which is the most a request can span; the cap keeps a bad end date from looping for ever.
  for (let i = 0; i < 400; i++) {
    const s = d.toISOString().slice(0, 10)
    if (s > end) break
    if (isWeekday(s) && !isPublicHoliday(s)) out.push(s)
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
