import { createHash } from 'node:crypto'
import { calendarDayId, calendarTitles, dayLabel, eachDay } from '@sh/shared'
import type { Queryable } from '../db.ts'
import type { EventBody } from './google.ts'

/**
 * What the calendar should hold (ADR 0008): one all-day event for every day
 * of every phase of a confirmed job, from today on, in the shape crew know
 * from today's calendar, worked out afresh from the jobs each time. And who
 * would be invited to each (ADR 0009): everyone offered the day or booked on
 * it, who has an email address in the app.
 */

/** Someone to invite to a day's event, because of an offer. */
export interface WantedGuest {
  personId: string
  offerId: string
  email: string
}

export interface Wanted {
  /** `calendarDayId(phaseId, day)`. */
  key: string
  phaseId: string
  projectId: string
  day: string
  title: string
  body: EventBody
  /** Changes whenever anything in the event would, but its guests. */
  hash: string
  /** People offered the day or booked on it, with an address to invite, by person id. */
  guests: WantedGuest[]
  /** People offered the day or booked on it with no email address in the app, so never invited, by name. */
  noEmail: string[]
}

export interface CrewLine {
  role: string
  callTime: string | null
  confirmed: string[]
  /** Said yes, not yet confirmed by the office. */
  toConfirm: string[]
  /** Places nobody holds yet. */
  missing: number
}

export interface DayFacts {
  job: string
  client: string | null
  phase: string
  /** Where this day falls in the phase, from 1. */
  dayNumber: number
  phaseStart: string
  phaseEnd: string
  venue: { name: string; address: string; notes: string } | null
  jobNotes: string
  phaseNotes: string
  crew: CrewLine[]
  /** The job in the app, when the app knows its own address. */
  appLink: string | null
}

const DESCRIPTION_MAX = 8000

/** The venue and its address on one line, for Google's location (which links it to Maps). */
export function location(v: DayFacts['venue']): string {
  if (!v) return ''
  const address = v.address
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(', ')
  const text = !address ? v.name : address.toLowerCase().startsWith(v.name.toLowerCase()) ? address : `${v.name}, ${address}`
  return text.slice(0, 1000)
}

const names = (list: string[]) => (list.length < 2 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`)

function crewLine(c: CrewLine): string {
  const who = [...c.confirmed, ...c.toConfirm.map((n) => `${n} (to confirm)`)]
  if (c.missing > 0) who.push(`${c.missing} still to find`)
  return `${c.role}${c.callTime ? `, call ${c.callTime}` : ''}: ${names(who) || 'nobody yet'}`
}

/** The event's description: the day's job sheet, names only (never rates or phone numbers). */
export function description(f: DayFacts): string {
  const days = eachDay(f.phaseStart, f.phaseEnd).length
  const when = days > 1 ? `${f.phase}, day ${f.dayNumber} of ${days}: ${dayLabel(f.phaseStart)} to ${dayLabel(f.phaseEnd)}` : `${f.phase}, ${dayLabel(f.phaseStart)}`
  const blocks: string[] = [[f.client ? `Client: ${f.client}` : '', when].filter(Boolean).join('\n')]
  if (f.venue) {
    blocks.push(
      [`Venue: ${f.venue.name}`, f.venue.address.trim().replace(/\s*\r?\n\s*/g, ', '), f.venue.notes.trim() ? `At the venue: ${f.venue.notes.trim()}` : '']
        .filter(Boolean)
        .join('\n')
    )
  }
  if (f.crew.length) blocks.push(['Crew', ...f.crew.map(crewLine)].join('\n'))
  if (f.jobNotes.trim()) blocks.push(`Job notes\n${f.jobNotes.trim()}`)
  if (f.phaseNotes.trim()) blocks.push(`${f.phase} notes\n${f.phaseNotes.trim()}`)
  if (f.appLink) blocks.push(`The job in the Session Hire app: ${f.appLink}`)
  const footer = 'Written by the Session Hire app. Change the job in the app: changes made here are put back.'
  const text = blocks.join('\n\n')
  const room = DESCRIPTION_MAX - footer.length - 3
  return `${text.length > room ? `${text.slice(0, room - 1)}…` : text}\n\n${footer}`
}

const BASE32HEX = '0123456789abcdefghijklmnopqrstuv'

/**
 * The event's id, worked out rather than made up, so writing the same day
 * twice (after a crash, or from two servers during a deploy) finds the
 * first event instead of making a second. Google allows only the base32hex
 * letters a to v and digits. `generation` moves on when an event has gone
 * for good and a new one has to be made.
 */
export function eventId(appKey: string, calendarId: string, phaseId: string, day: string, generation: number): string {
  const digest = createHash('sha256').update([appKey, calendarId, phaseId, day, generation].join('|')).digest()
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of digest) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32HEX[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
    value &= 0xff
  }
  return out.slice(0, 40)
}

interface PhaseRow {
  phase_id: string
  phase: string
  start_day: string
  end_day: string
  phase_notes: string
  project_id: string
  job: string
  job_notes: string
  client: string | null
  venue_name: string | null
  venue_address: string | null
  venue_notes: string | null
}

interface CallRow {
  id: string
  project_id: string
  phase_id: string | null
  role: string
  call_time: string | null
  needed: number
  start_day: string
  end_day: string
  offers: { id: string; status: string; days: string[]; personId: string; name: string; email: string | null }[]
}

/** Which offer a person is invited by when two cover the same day: the one that holds it, then the one furthest on. */
const RANK: Record<string, number> = { confirmed: 0, accepted: 1, countered: 2, offered: 3 }

/** Everything that should be on the calendar from `today` on, by `calendarDayId`. */
export async function wantedEvents(q: Queryable, { today, appKey, appUrl }: { today: string; appKey: string; appUrl: string | null }): Promise<Map<string, Wanted>> {
  const { rows: phases } = await q.query<PhaseRow>(
    `SELECT ph.id AS phase_id, ph.name AS phase, ph.start_day::text, ph.end_day::text, ph.notes AS phase_notes,
            p.id AS project_id, p.name AS job, p.notes AS job_notes, c.name AS client,
            v.name AS venue_name, v.address AS venue_address, v.notes AS venue_notes
       FROM phases ph
       JOIN projects p ON p.id = ph.project_id
       LEFT JOIN clients c ON c.id = p.client_id
       LEFT JOIN venues v ON v.id = coalesce(ph.venue_id, p.venue_id)
      WHERE p.status = 'confirmed' AND p.source_calendar IS NULL AND ph.end_day >= $1::date
      ORDER BY ph.start_day, ph.id`,
    [today]
  )
  const projectIds = [...new Set(phases.map((p) => p.project_id))]
  const { rows: calls } = projectIds.length
    ? await q.query<CallRow>(
        `SELECT cc.id, cc.project_id, cc.phase_id, cc.role, cc.call_time, cc.needed, cc.start_day::text, cc.end_day::text,
                coalesce(json_agg(json_build_object('id', o.id, 'status', o.status, 'days', o.days, 'personId', pe.id, 'name', pe.name, 'email', pe.email)
                                  ORDER BY pe.name, o.id)
                         FILTER (WHERE o.id IS NOT NULL), '[]') AS offers
           FROM crew_calls cc
           LEFT JOIN offers o ON o.call_id = cc.id AND o.status IN ('offered', 'countered', 'accepted', 'confirmed')
           LEFT JOIN people pe ON pe.id = o.person_id
          WHERE cc.status = 'open' AND cc.project_id = ANY($1::text[]) AND cc.end_day >= $2::date
          GROUP BY cc.id
          ORDER BY cc.role, cc.call_time NULLS LAST, cc.id`,
        [projectIds, today]
      )
    : { rows: [] as CallRow[] }

  const out = new Map<string, Wanted>()
  for (const p of phases) {
    const days = eachDay(p.start_day, p.end_day)
    const titles = calendarTitles(p.job, { name: p.phase, start: p.start_day, end: p.end_day })
    days.forEach((day, i) => {
      if (day < today) return
      const covering = calls.filter(
        (c) => c.project_id === p.project_id && (c.phase_id === p.phase_id || c.phase_id === null) && c.start_day <= day && day <= c.end_day
      )
      const crew = covering.map((c): CrewLine => {
        const on = c.offers.filter((o) => (o.status === 'accepted' || o.status === 'confirmed') && o.days.includes(day))
        return {
          role: c.role,
          callTime: c.call_time,
          confirmed: on.filter((o) => o.status === 'confirmed').map((o) => o.name),
          toConfirm: on.filter((o) => o.status === 'accepted').map((o) => o.name),
          missing: Math.max(0, c.needed - on.length),
        }
      })
      const invited = new Map<string, WantedGuest & { rank: number }>()
      const noEmail = new Set<string>()
      for (const o of covering.flatMap((c) => c.offers)) {
        if (!o.days.includes(day)) continue
        const email = o.email?.trim()
        if (!email) {
          noEmail.add(o.name)
          continue
        }
        const had = invited.get(o.personId)
        const rank = RANK[o.status] ?? 9
        if (!had || rank < had.rank || (rank === had.rank && o.id < had.offerId)) invited.set(o.personId, { personId: o.personId, offerId: o.id, email, rank })
      }
      const guests = [...invited.values()]
        .map(({ personId, offerId, email }) => ({ personId, offerId, email }))
        .sort((a, b) => a.personId.localeCompare(b.personId))
      const facts: DayFacts = {
        job: p.job,
        client: p.client,
        phase: p.phase,
        dayNumber: i + 1,
        phaseStart: p.start_day,
        phaseEnd: p.end_day,
        venue: p.venue_name !== null ? { name: p.venue_name, address: p.venue_address ?? '', notes: p.venue_notes ?? '' } : null,
        jobNotes: p.job_notes,
        phaseNotes: p.phase_notes,
        crew,
        appLink: appUrl ? `${appUrl}/#jobs/${p.project_id}` : null,
      }
      const next = new Date(`${day}T12:00:00Z`)
      next.setUTCDate(next.getUTCDate() + 1)
      const body: EventBody = {
        summary: titles[i]!,
        location: location(facts.venue),
        description: description(facts),
        start: { date: day },
        end: { date: next.toISOString().slice(0, 10) },
        status: 'confirmed',
        extendedProperties: { private: { sh: appKey, shJob: p.project_id, shPhase: p.phase_id, shDay: day } },
        guestsCanSeeOtherGuests: false,
        guestsCanInviteOthers: false,
      }
      const key = calendarDayId(p.phase_id, day)
      out.set(key, {
        key,
        phaseId: p.phase_id,
        projectId: p.project_id,
        day,
        title: titles[i]!,
        body,
        hash: createHash('sha256').update(JSON.stringify(body)).digest('base64url').slice(0, 32),
        guests,
        noEmail: [...noEmail].sort(),
      })
    })
  }
  return out
}
