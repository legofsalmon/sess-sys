import { dayLabel } from './crew.ts'
import type { HistoryEntry } from './protocol.ts'
import { plural } from './stock.ts'

/**
 * Shared by the History tab and the exported history (ADR 0006).
 */

/** A change that waited on its device this long or longer was made offline (or with the app closed before it could send). */
export const OFFLINE_AFTER_SECONDS = 60

/** "under a minute", "25 min", "2 h 10 min", "3 days 4 h". */
export function waitLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'}${hours % 24 ? ` ${hours % 24} h` : ''}`
}

/**
 * The History tab's days and runs (ADR 0006, amended 2 October 2026), so a
 * busy morning reads as a few lines. They're worked out afresh from every
 * page loaded so far, so a day or a run that one page cut in two joins up
 * again when the next page comes, rather than showing twice.
 *
 * - A day is the Irish day the server took its changes on. The history is
 *   in that order, so a day never comes round twice, even when a change
 *   made offline late at night arrives the next morning.
 * - A run is one person's changes one after another that day, with nobody
 *   else's between and no gap of more than an hour. While there are no
 *   names (sign-in off, when every change is "Someone"), it's a device's.
 */
export interface HistoryDay {
  /** 2026-10-02. */
  day: string
  /** "Today", "Yesterday", or "Thursday 1 October", with the year when it isn't this one. */
  label: string
  runs: HistoryRun[]
}

export interface HistoryRun {
  /** Its newest change's id, which older pages joining on never alter: what keeps it open. */
  id: string
  /** The person's name, or the device's code while there are no names. */
  who: string
  byDevice: boolean
  /** Newest first. */
  entries: HistoryEntry[]
  /** The devices it came from, in words, each once. */
  devices: string[]
  /** When its first and last changes were made: "09:12", or "Thu 1 Oct, 23:50" when that was another day. */
  from: string
  to: string
  turnedDown: number
}

/** A run's changes that were this far apart are two runs. */
const RUN_GAP_MS = 3_600_000

export function historyDays(entries: readonly HistoryEntry[], now = new Date()): HistoryDay[] {
  const today = irishDay(now)
  const days: HistoryDay[] = []
  let lastKey = ''
  for (const e of entries) {
    const day = irishDay(new Date(e.arrivedAt))
    let current = days.at(-1)
    if (current?.day !== day) {
      current = { day, label: dayName(day, today), runs: [] }
      days.push(current)
      lastKey = ''
    }
    const w = whose(e)
    const run = current.runs.at(-1)
    const newer = run?.entries.at(-1)
    if (run && newer && w.key === lastKey && Math.abs(Date.parse(newer.madeAt) - Date.parse(e.madeAt)) <= RUN_GAP_MS) run.entries.push(e)
    else current.runs.push({ id: e.id, who: w.name, byDevice: w.byDevice, entries: [e], devices: [], from: '', to: '', turnedDown: 0 })
    lastKey = w.key
  }
  for (const d of days) {
    for (const r of d.runs) {
      r.devices = [...new Set(r.entries.map(deviceWords).filter(Boolean))]
      const made = r.entries.map((e) => e.madeAt).sort()
      r.from = historyTime(made[0]!, d.day)
      r.to = historyTime(made.at(-1)!, d.day)
      r.turnedDown = r.entries.filter((e) => e.outcome === 'turned-down').length
    }
  }
  return days
}

/** "Colly Hewson, 14 changes, 09:12 to 09:40". */
export function runLabel(r: HistoryRun): string {
  return `${r.who}, ${plural(r.entries.length, 'change')}, ${r.from === r.to ? r.from : `${r.from} to ${r.to}`}`
}

/** "Safari on iPhone, device c0ffee", or as much of it as is known. */
export function deviceWords(e: HistoryEntry): string {
  return [e.device, e.deviceCode && `device ${e.deviceCode}`].filter(Boolean).join(', ')
}

/** The time of day in Ireland, with the day too when it isn't `day`: "09:12", or "Thu 1 Oct, 23:50". */
export function historyTime(iso: string, day: string): string {
  const at = new Date(iso)
  const time = IRISH_TIME.format(at)
  const on = irishDay(at)
  return on === day ? time : `${dayLabel(on)}, ${time}`
}

// Made once: a formatter made for every change, as toLocaleDateString makes one, was most of what grouping a long history cost.
const IRISH_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Dublin' })
const IRISH_TIME = new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** As irishToday, 2026-10-05. */
const irishDay = (at: Date) => IRISH_DAY.format(at)

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function dayName(day: string, today: string): string {
  if (day === today) return 'Today'
  const noon = Date.parse(`${day}T12:00:00Z`)
  if (new Date(noon + 86_400_000).toISOString().slice(0, 10) === today) return 'Yesterday'
  const d = new Date(noon)
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${day.slice(0, 4) === today.slice(0, 4) ? '' : ` ${day.slice(0, 4)}`}`
}

/** Whose run a change belongs to: the person's, or while there are no names, the device's. */
function whose(e: HistoryEntry): { key: string; name: string; byDevice: boolean } {
  if (e.who.kind !== 'unknown') return { key: e.who.key ?? `name:${e.who.name}`, name: e.who.name, byDevice: false }
  const name = e.deviceCode ? `Device ${e.deviceCode}` : (e.device ?? 'An unknown device')
  return { key: `device:${name}`, name, byDevice: true }
}
