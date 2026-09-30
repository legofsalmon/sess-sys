import { eachDay, euro, type CrewCall, type Offer, type Person } from '@sh/shared'

/**
 * A person's private calendar feed: every job they hold, as all-day events
 * in the same "<Project> - <Phase>" shape as the Session Hire Gigs calendar.
 * Works in Google, Apple and Outlook calendars, so a freelancer sees our
 * bookings next to everyone else's without another app.
 *
 * Read-only by design (ADR 0012): people add feeds to calendars they share,
 * so nothing in it opens their private link.
 */

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** RFC 5545 lines are at most 75 octets; longer ones continue after CRLF + space. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let start = 0
  let limit = 75
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    // Never split a UTF-8 character.
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--
    parts.push(bytes.subarray(start, end).toString('utf8'))
    start = end
    limit = 74
  }
  return parts.join('\r\n ')
}

const compact = (d: string) => d.replace(/-/g, '')
const nextDay = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`)
  x.setUTCDate(x.getUTCDate() + 1)
  return x.toISOString().slice(0, 10)
}

/** Split days into runs of consecutive dates, so a part-accepted job shows as its real blocks. */
export function runs(days: string[]): string[][] {
  const out: string[][] = []
  for (const d of [...days].sort()) {
    const last = out[out.length - 1]
    if (last && nextDay(last[last.length - 1]!) === d) last.push(d)
    else out.push([d])
  }
  return out
}

export function calendarFeed(person: Person, jobs: { offer: Offer; call: CrewCall }[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Session Hire//Crew//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`Session Hire: ${person.name}`)}`,
    'X-WR-TIMEZONE:Europe/Dublin',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ]
  for (const { offer, call } of jobs) {
    if (call.status !== 'open' || (offer.status !== 'accepted' && offer.status !== 'confirmed')) continue
    const all = eachDay(call.start, call.end)
    const blocks = runs(offer.days)
    blocks.forEach((block, i) => {
      const title = `${call.project}${call.phase ? ` - ${call.phase}` : ''}${blocks.length > 1 ? ` ${i + 1}/${blocks.length}` : ''}`
      const desc = [
        `${call.role}${offer.status === 'accepted' ? ' (accepted, waiting for the office to confirm)' : ''}`,
        call.callTime ? `Call time ${call.callTime}` : '',
        `${euro(offer.dayRateCents)}${offer.dayRateCents !== null ? ' a day' : ''}`,
        block.length < all.length || blocks.length > 1 ? `Your days: ${block.join(', ')}` : '',
        call.details,
        'Full details and any changes are on your Session Hire page, from the link the office sent you.',
      ]
        .filter(Boolean)
        .join('\n')
      lines.push(
        'BEGIN:VEVENT',
        `UID:${offer.id}-${i}@crew.sessionhire.com`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${compact(block[0]!)}`,
        `DTEND;VALUE=DATE:${compact(nextDay(block[block.length - 1]!))}`,
        `SUMMARY:${esc(title)}`,
        call.venue ? `LOCATION:${esc(call.venue)}` : '',
        `DESCRIPTION:${esc(desc)}`,
        `STATUS:${offer.status === 'confirmed' ? 'CONFIRMED' : 'TENTATIVE'}`,
        'TRANSP:OPAQUE',
        'END:VEVENT'
      )
    })
  }
  lines.push('END:VCALENDAR')
  return lines.filter(Boolean).map(fold).join('\r\n') + '\r\n'
}
