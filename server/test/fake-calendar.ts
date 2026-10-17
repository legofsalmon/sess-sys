import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A pretend calendar host for reading freelancers' own calendars (ADR
 * 0044), on this machine, so no test reaches the network: each path
 * answers as a test sets it, with a calendar, a status, a redirect, a
 * slow answer or one too big. It keeps how many times each path was
 * asked for, and what each request sent.
 */

export type Answer =
  | { ics: string; type?: string }
  | { status: number }
  | { redirect: string }
  | { slowMs: number; ics: string }
  | { bytes: number }

export interface FakeCalendar {
  /** host:port, for `testHosts`. */
  host: string
  url(path: string): string
  set(path: string, answer: Answer): void
  asked(path: string): number
  /** Every request's method and headers, newest last. */
  requests: { method: string; path: string; headers: Record<string, string | string[] | undefined> }[]
  close(): Promise<void>
}

export async function fakeCalendar(port = 0): Promise<FakeCalendar> {
  const answers = new Map<string, Answer>()
  const counts = new Map<string, number>()
  const requests: FakeCalendar['requests'] = []
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!
    requests.push({ method: req.method ?? '', path, headers: req.headers })
    counts.set(path, (counts.get(path) ?? 0) + 1)
    const a = answers.get(path)
    if (!a) return res.writeHead(404).end('Not found')
    if ('status' in a) return res.writeHead(a.status).end()
    if ('redirect' in a) return res.writeHead(302, { location: a.redirect }).end()
    if ('bytes' in a) {
      res.writeHead(200, { 'content-type': 'text/calendar' })
      // Sent in pieces with no length said, so the limit has to count as it reads.
      const piece = Buffer.alloc(64 * 1024, 'x')
      let sent = 0
      const more = () => {
        while (sent < a.bytes) {
          sent += piece.length
          if (!res.write(piece)) return res.once('drain', more)
        }
        res.end()
      }
      return more()
    }
    if ('slowMs' in a) {
      const t = setTimeout(() => res.writeHead(200, { 'content-type': 'text/calendar' }).end(a.ics), a.slowMs)
      res.on('close', () => clearTimeout(t))
      return
    }
    res.writeHead(200, { 'content-type': a.type ?? 'text/calendar; charset=utf-8' }).end(a.ics)
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const { port: bound } = server.address() as AddressInfo
  const host = `127.0.0.1:${bound}`
  return {
    host,
    url: (path) => `http://${host}${path}`,
    set: (path, answer) => answers.set(path, answer),
    asked: (path) => counts.get(path) ?? 0,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/** iCal dates and times as calendars write them. */
const compact = (d: string) => d.replace(/-/g, '')

export interface FakeEvent {
  uid: string
  /** A day for all day, or `YYYY-MM-DDTHH:MM` in Irish time. */
  start: string
  end: string
  summary?: string
  location?: string
  description?: string
  rrule?: string
  exdate?: string
  recurrenceId?: string
  transp?: 'OPAQUE' | 'TRANSPARENT'
  status?: 'CONFIRMED' | 'CANCELLED' | 'TENTATIVE'
  /** Written in UTC, with a Z, rather than Irish time. */
  utc?: boolean
  attendees?: string[]
}

/** Europe/Dublin as Google writes it into every calendar. */
const DUBLIN = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Dublin',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0000',
  'TZNAME:GMT',
  'DTSTART:19701025T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0000',
  'TZOFFSETTO:+0100',
  'TZNAME:IST',
  'DTSTART:19700329T010000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
]

function when(name: string, v: string, utc?: boolean): string {
  if (!v.includes('T')) return `${name};VALUE=DATE:${compact(v)}`
  const t = `${compact(v.slice(0, 10))}T${v.slice(11, 13)}${v.slice(14, 16)}00`
  return utc ? `${name}:${t}Z` : `${name};TZID=Europe/Dublin:${t}`
}

/** A calendar as Google's secret iCal address gives it, holding these events. */
export function ics(events: FakeEvent[], prodid = '-//Google Inc//Google Calendar 70.9054//EN', more: string[] = []): string {
  const lines = ['BEGIN:VCALENDAR', `PRODID:${prodid}`, 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Aoife Byrne', ...DUBLIN]
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      when('DTSTART', e.start, e.utc),
      when('DTEND', e.end, e.utc),
      ...(e.rrule ? [`RRULE:${e.rrule}`] : []),
      ...(e.exdate ? [when('EXDATE', e.exdate, e.utc)] : []),
      ...(e.recurrenceId ? [when('RECURRENCE-ID', e.recurrenceId, e.utc)] : []),
      `UID:${e.uid}`,
      `SUMMARY:${e.summary ?? 'Something private'}`,
      ...(e.location ? [`LOCATION:${e.location}`] : []),
      ...(e.description ? [`DESCRIPTION:${e.description}`] : []),
      ...(e.attendees ?? []).map((a) => `ATTENDEE;CN=${a};PARTSTAT=ACCEPTED:mailto:${a}`),
      `TRANSP:${e.transp ?? 'OPAQUE'}`,
      `STATUS:${e.status ?? 'CONFIRMED'}`,
      'END:VEVENT'
    )
  }
  lines.push(...more, 'END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}
