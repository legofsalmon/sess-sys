import {
  addDays,
  daysLabel,
  departmentInWords,
  eachDay,
  MAX_PHASE_DAYS,
  nameKey,
  nameFromEmail,
  KIND_PHASE,
  PHASE_NAMES,
  type GuestResponse,
  type ImportChanged,
  type ImportLeftOut,
  type LeftOutReason,
  type ProjectKind,
  type ProjectStatus,
} from '@sh/shared'

/**
 * Working out what the events on a calendar are as jobs (ADR 0011): titles
 * into jobs and phases, events into jobs, locations into venues, guests
 * into crew, and what is left out and why. Pure, so every guess can be
 * tested; import.ts reads the calendar and the app, and saves the result.
 *
 * What the first real calendars taught it (ADR 0037): a title says what
 * kind of job it is (a hire, a collection, a meeting), a phase word can
 * have a note after it, and days gone are the record of who worked, not
 * offers still waiting.
 */

/** An event as the import reads it. */
export interface SourceEvent {
  id: string
  /** Google's iCalUID: the same on every calendar the event is on. */
  uid: string
  cancelled: boolean
  title: string
  /** First and last day of an all-day event; null for one with a start time. */
  days: { start: string; end: string } | null
  location: string
  /** As Google has it: plain text, or simple HTML. */
  description: string
  guests: SourceGuest[]
  repeating: boolean
  /** Out of office, focus time, working location, a birthday: not an ordinary event. */
  special: boolean
  /** Written by the app itself (ADR 0008). */
  ours: boolean
}

export interface SourceGuest {
  email: string
  name: string | null
  answer: GuestResponse
  /** The organiser, the calendar's own account, or a room: never crew. */
  notCrew: boolean
}

/** What the app already holds, to match against. */
export interface AppData {
  people: { id: string; name: string; email: string | null }[]
  venues: { id: string; name: string; address: string }[]
  jobs: {
    id: string
    name: string
    status: ProjectStatus
    kind: ProjectKind
    venueId: string | null
    sourceCalendar: string | null
    phases: { id: string; name: string; start: string; end: string }[]
  }[]
  /** Event-days brought in before, from any calendar. */
  imported: { uid: string; day: string; title: string; projectId: string; calendarId: string }[]
}

export type VenueRef = { id: string; name: string } | { key: string; name: string; address: string }
export type PersonRef = { id: string } | { email: string }

/** One event on one day, as brought in, to be remembered. */
export interface EventDay {
  uid: string
  eventId: string
  day: string
  title: string
}

/** Someone on an invite on days gone who isn't a booking: noted on the phase, not offered (ADR 0037). */
export interface Noted {
  name: string
  days: string[]
  answer: 'none' | 'declined'
}

/** A phase's days in a row, and who is on them. */
export interface PlanRun {
  name: string
  days: string[]
  guessed: boolean
  /** Its own venue; null for the job's. */
  venue: VenueRef | null
  /** What the titles said after the phase word, who was on the invites but isn't crew, and the job sheet. */
  notes: string
  /** A phase of the job, just before or after these days, that they extend. */
  extend: { id: string; start: string; end: string } | null
  /** Answers on days to come, and a Yes on days gone; the rest of days gone is in `noted`. Empty for anything but a gig. */
  crew: { person: PersonRef; answers: Record<string, GuestResponse> }[]
  noted: Noted[]
  events: EventDay[]
}

export interface PlanJob {
  key: string
  name: string
  status: 'confirmed' | 'enquiry'
  kind: ProjectKind
  /** A job brought in before that these days are added to. */
  existing: { id: string; name: string; venueId: string | null } | null
  venue: VenueRef | null
  notes: string
  runs: PlanRun[]
  /** The events it is made of. */
  events: number
  /** Every day of those events, the ones it already has included, to remember as brought in. */
  seen: EventDay[]
}

export interface NewPerson {
  email: string
  name: string
  kind: 'freelancer' | 'staff'
  suggested: boolean
  /** Google had no name for them, so the name is made from their address. */
  needsName: boolean
  /** How many of the jobs they are on. */
  jobs: number
}

export interface Plan {
  /** Events read, cancelled ones aside. */
  events: number
  jobs: PlanJob[]
  people: NewPerson[]
  leftOut: ImportLeftOut[]
  changed: ImportChanged[]
}

/** What the office chose on the import screen: names and kinds by job key, the jobs to bring in, and people's names by email. */
export interface Chosen {
  names: ReadonlyMap<string, string>
  kinds?: ReadonlyMap<string, ProjectKind>
  include: ReadonlySet<string>
  people?: ReadonlyMap<string, string>
}

/** Events more than this many days apart are separate jobs, even with the same name. */
export const GAP_DAYS = 14
/** An all-day event longer than this is not a gig day. */
export const LONGEST_EVENT_DAYS = 31
/** Phase notes and job notes hold at most this much (ADR 0007). */
const PHASE_NOTES = 2000
const JOB_NOTES = 4000

export { nameKey, nameFromEmail, KIND_PHASE }

/** Phase words and the app's name for each. Those marked `strict` are also safe to split off the end of a title with no " - " ("Fairview Build"). */
const PHASE_WORDS: { re: RegExp; name: string; strict: boolean }[] = [
  { re: /^(?:warehouse )?prep(?:aration)?$/, name: 'Prep', strict: true },
  { re: /^(?:load ?in|get ?in)$/, name: 'Load in', strict: true },
  { re: /^(?:deliver(?:y|ies)|drop ?off)$/, name: 'Load in', strict: false },
  { re: /^(?:build|set ?up)$/, name: 'Build', strict: true },
  { re: /^(?:install(?:ation)?)$/, name: 'Build', strict: true },
  { re: /^(?:rig(?:ging)?)$/, name: 'Build', strict: false },
  { re: /^(?:rehearsals?|tech(?: rehearsals?)?|dress rehearsals?)$/, name: 'Rehearsal', strict: true },
  { re: /^(?:run ?through|sound ?check)$/, name: 'Rehearsal', strict: false },
  { re: /^show$/, name: 'Show', strict: true },
  { re: /^(?:event|live|launch|performance|gig)$/, name: 'Show', strict: false },
  { re: /^(?:baby ?sit(?:ting)?)$/, name: 'Babysit', strict: true },
  { re: /^(?:stand ?by|on call)$/, name: 'Babysit', strict: false },
  { re: /^(?:load ?out|get ?out|de ?rig|strike)$/, name: 'Load out', strict: true },
  { re: /^(?:pack ?down|break ?down|collection|collect|pick ?up)$/, name: 'Load out', strict: false },
]
/** Other words that name a day of a job, kept as typed. */
const OTHER_PHASES = /^(?:recce|site visit|site survey|walk ?through|press(?: day)?|photo ?shoot)$/

/** "2/3", "(2 of 3)": the day's number, which the app works out itself. */
const NUMBERING = /\(?\b\d+\s*(?:\/|of)\s*\d+\b\)?/gi
/** "Day 2", "Day". */
const DAY_N = /\bday\s*\d*\b/gi
/** Numbering left at the end of a job's name: "Aviva 2/3", "Web Summit Day 2" (but not "Family Day"). */
const TRAILING_COUNT = /(?:\s*(?:\(?\b\d+\s*(?:\/|of)\s*\d+\b\)?|\bday\s*\d+\b))+\s*$/i

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The app's name for one phase word ("Show Day 2" → Show), or undefined when it isn't one. */
function phaseWord(part: string, strict: boolean): string | undefined {
  const key = nameKey(part.replace(NUMBERING, ' ').replace(DAY_N, ' '))
    .replace(/\s*\d+$/, '')
    .trim()
  if (!key) return undefined
  // A bare "Show" at the end of a title is more often its name (the Dublin Horse Show) than the phase; "Show Day 2" is the phase.
  if (strict && nameKey(part) === 'show') return undefined
  const known = PHASE_WORDS.find((w) => (w.strict || !strict) && w.re.test(key))
  if (known) return known.name
  if (strict || !OTHER_PHASES.test(key)) return undefined
  return capitalised(
    part
      .replace(NUMBERING, ' ')
      .replace(DAY_N, ' ')
      .replace(/[\s\d]+$/, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

const PARTS = /\s*(?:\/|&|\+|,|\band\b)\s*/i

/**
 * The phases a part of a title names: "Build 2/2" is Build, "Show Day 2/
 * Load Out" is Show and Load out. Undefined unless every part is a phase.
 */
export function phasesOf(text: string, strict = false): string[] | undefined {
  const parts = text
    .replace(NUMBERING, ' ')
    .split(PARTS)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return undefined
  const names = parts.map((p) => phaseWord(p, strict))
  if (!names.every(Boolean)) return undefined
  return [...new Set(names as string[])]
}

/** A note after a phase has at most this many words; more is the job's name. */
const NOTE_WORDS = 6

/**
 * The phases at the start of the part of a title after " - ", and what
 * follows them as a note: "Build 4/9 & Client Walk Through" is Build with
 * the note "Client Walk Through", "Load Out PA" is Load out with "PA",
 * "Launch Event" is Show. Undefined unless it starts with a phase word.
 */
export function phasesAndNote(text: string): { phases: string[]; note: string } | undefined {
  const parts = text
    .replace(NUMBERING, ' ')
    .split(PARTS)
    .map((p) => p.trim())
    .filter(Boolean)
  const phases: string[] = []
  const rest: string[] = []
  for (const part of parts) {
    if (rest.length) {
      rest.push(part)
      continue
    }
    const whole = phaseWord(part, false)
    if (whole) {
      phases.push(whole)
      continue
    }
    const words = part.split(' ')
    let found = false
    for (let n = Math.min(words.length - 1, 3); n >= 1 && !found; n--) {
      const lead = phaseWord(words.slice(0, n).join(' '), false)
      if (!lead) continue
      found = true
      phases.push(lead)
      const after = words.slice(n).join(' ')
      const again = phaseWord(after, false)
      if (again) phases.push(again)
      else rest.push(after)
    }
    if (!found) rest.push(part)
  }
  if (phases.length === 0) return undefined
  const note = rest.join(', ').replace(/\s+/g, ' ').trim()
  if (note.split(' ').length > NOTE_WORDS) return undefined
  return { phases: [...new Set(phases)], note }
}

/** The departments whose name after " - " makes a day of the job rather than a job of its own. */
const DAY_DEPARTMENTS: readonly string[] = ['Audio', 'LX', 'Video', 'Laser', 'LED Tech', 'Backline', 'SFX', 'Rigger']

/** "Smirnoff LX" → the day "Smirnoff LX": a few words naming a department, numbering dropped. Undefined for anything else. */
export function departmentDay(text: string): string | undefined {
  const words = text.replace(NUMBERING, ' ').replace(/\s+/g, ' ').trim()
  const department = departmentInWords(words)
  if (!words || !department || !DAY_DEPARTMENTS.includes(department) || words.split(' ').length > NOTE_WORDS) return undefined
  return capitalised(words).slice(0, 100)
}

/** Words in a job's name that say what kind of job it is (ADR 0037); the company's own name says nothing. */
const COMPANY_NAME = /\bsession hire\b/gi
const HIRE_WORDS = /\b(?:dry ?hire|hire|rental|rent)\b/i
const ERRAND_WORDS = /^(?:collect(?:ion)?|return(?:s|ing)?|drop(?: ?off)?|pick ?up|deliver(?:y|ies)?|bring back)\b/i
const MEETING_WORDS = /\b(?:meeting|site visit|recce|walk ?through|catch ?up)\b/i

/** What kind of job a name says it is: a collection or return at the start is an errand, a meeting or site visit a meeting, a hire or rental a dry hire; otherwise a gig. */
export function kindFromName(name: string): ProjectKind {
  const n = name.replace(COMPANY_NAME, ' ').replace(/\s+/g, ' ').trim()
  if (ERRAND_WORDS.test(n)) return 'errand'
  if (MEETING_WORDS.test(n)) return 'meeting'
  if (HIRE_WORDS.test(n)) return 'hire'
  return 'gig'
}


export interface ParsedTitle {
  job: string
  phases: string[]
  /** What the title said after the phase word. */
  note: string
  /** No phase word in the title, so the phase is a guess from the kind. */
  guessed: boolean
  /** TBC, pencil, hold or provisional in the title. */
  pencilled: boolean
  /** What the name says the job is. */
  kind: ProjectKind
}

const PENCIL = String.raw`tbc|t\.b\.c\.?|to be confirmed|pencil(?:led|ed)?|provisional|on hold|hold`
const PENCIL_ALONE = new RegExp(`^(?:${PENCIL})$`, 'i')
const PENCIL_BRACKETED = new RegExp(`[([]\\s*(?:${PENCIL})\\s*[)\\]]`, 'gi')
const PENCIL_WORD = /\b(?:tbc|pencil(?:led|ed)?|provisional)\b/gi

/** A job's name as it will show: no stray dashes, colons or spaces at either end. */
function tidy(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:|,.]+|[\s\-–—:|,/&+]+$/g, '')
    .trim()
}

/**
 * A title as a job and its phases: "Nissan - Build 2/2" is Nissan's Build,
 * "Tik Tok - Ploughing - Load In" is the Load in of Tik Tok - Ploughing,
 * "Fairview Build" is Fairview's Build, "WL - Malahide Build 4/9 & Client
 * Walk Through" is a Build with a note, and "Christmas party" is all job,
 * with Show guessed. "Murt lx hire" is a dry hire, with Hire guessed.
 */
export function parseTitle(title: string): ParsedTitle {
  const t = parseJobAndPhases(title)
  const kind = kindFromName(t.job)
  return { ...t, kind, phases: t.guessed ? [KIND_PHASE[kind]] : t.phases }
}

function parseJobAndPhases(title: string): Omit<ParsedTitle, 'kind'> {
  let pencilled = false
  const pencil = () => ((pencilled = true), ' ')
  let text = title.replace(/\s+/g, ' ').trim().replace(PENCIL_BRACKETED, pencil)
  if (/\?$/.test(text)) text = text.replace(/\s*\?+$/, pencil).trim()
  const segments = text
    .split(/\s+[-–—]\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !(PENCIL_ALONE.test(s) && pencil()))
    .map((s) => s.replace(PENCIL_WORD, pencil).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  // "Web Summit - Day 2": numbering on its own says nothing the app doesn't work out itself.
  while (segments.length > 1 && !segments.at(-1)!.replace(NUMBERING, ' ').replace(DAY_N, ' ').trim()) segments.pop()
  const job = (s: string) => {
    let name = tidy(s.replace(TRAILING_COUNT, ''))
    if (name.endsWith('?')) {
      pencilled = true
      name = tidy(name.replace(/\?+$/, ''))
    }
    return name || tidy(title) || 'Untitled'
  }
  if (segments.length >= 2) {
    const tail = phasesAndNote(segments.at(-1)!)
    if (tail) return { job: job(segments.slice(0, -1).join(' - ')), phases: tail.phases, note: tail.note, guessed: false, pencilled }
    // "EP - Smirnoff LX", "District X - Audio Main": a day for one department of the job, which is the day's name (ADR 0050).
    const day = departmentDay(segments.at(-1)!)
    if (day) return { job: job(segments.slice(0, -1).join(' - ')), phases: [day], note: '', guessed: false, pencilled }
  }
  const whole = segments.join(' - ')
  const words = whole.split(' ')
  for (let n = Math.min(words.length - 1, 6); n >= 1; n--) {
    const phases = phasesOf(words.slice(-n).join(' '), true)
    if (phases) return { job: job(words.slice(0, -n).join(' ')), phases, note: '', guessed: false, pencilled }
  }
  // "WL - Malahide Build 4/9 & Client Walk Through": a phase word in the middle, with the job before it and a note after.
  for (let i = 1; i < words.length; i++) {
    if (!phasesOf(words.slice(i, i + 2).join(' '), true) && !phasesOf(words[i]!, true)) continue
    const tail = phasesAndNote(words.slice(i).join(' '))
    if (tail) return { job: job(words.slice(0, i).join(' ')), phases: tail.phases, note: tail.note, guessed: false, pencilled }
    break
  }
  return { job: job(whole), phases: ['Show'], note: '', guessed: true, pencilled }
}

/** A job sheet as plain text: Google keeps descriptions written in its editor as simple HTML. */
export function plainText(description: string): string {
  if (!/<[a-z][\s\S]*>/i.test(description)) return description.replace(/\r\n?/g, '\n').trim()
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return description
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/?(?:p|div|li|ul|ol|h[1-6]|tr)(?:\s[^>]*)?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : m
      }
      return entities[e.toLowerCase()] ?? m
    })
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Cut to fit, saying so. */
function fit(text: string, max: number): string {
  if (text.length <= max) return text
  const note = '\n… (cut short: the rest is on the event in Google Calendar)'
  return text.slice(0, max - note.length).trimEnd() + note
}

/** Addresses of people's own email, rather than a company's: guests there are likely crew. */
const OWN_EMAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.ie',
  'outlook.com',
  'outlook.ie',
  'live.com',
  'live.ie',
  'live.co.uk',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.ie',
  'ymail.com',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'gmx.ie',
  'eircom.net',
  'proton.me',
  'protonmail.com',
  'aol.com',
])

/** A shared mailbox rather than a person, at any domain: never crew. */
const MAILBOXES = /^(?:info|accounts|office|hello|admin|bookings?|sales|support|hire|enquiries|contact|mail|team|noreply|no-reply)$/i

/** "info@sessionhire.com": a company's mailbox, not someone who can be on a crew. */
export function isMailbox(email: string): boolean {
  return MAILBOXES.test(email.split('@')[0] ?? '')
}

const RANK: Record<GuestResponse, number> = { declined: 0, needsAction: 1, tentative: 2, accepted: 3 }

/** A guest on one event, as a day's answer: a Yes on any event that day beats waiting, which beats a No. */
const better = (a: GuestResponse | undefined, b: GuestResponse): GuestResponse => (a && RANK[a] >= RANK[b] ? a : b)

interface Entry {
  day: string
  event: SourceEvent
  job: string
  key: string
  phases: string[]
  note: string
  guessed: boolean
  pencilled: boolean
  kind: ProjectKind
}

interface Cluster {
  key: string
  name: string
  kind: ProjectKind
  entries: Entry[]
  /** Its entries before those the job already has were dropped. */
  seen: Entry[]
  existing: AppData['jobs'][number] | null
}

/** The entries' guessed phases as the kind's own: a hire's day is Hire, not Show. */
const withKind = (entries: Entry[], kind: ProjectKind): Entry[] => entries.map((e) => (e.guessed ? { ...e, phases: [KIND_PHASE[kind]] } : e))

/** Each event's days once, in order. */
const uniqueDays = (entries: Entry[]): EventDay[] => {
  const out = new Map<string, EventDay>()
  for (const e of entries) out.set(`${e.event.uid}/${e.day}`, { uid: e.event.uid, eventId: e.event.id, day: e.day, title: e.event.title })
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day) || a.uid.localeCompare(b.uid))
}
const daysApart = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
const mostCommon = <T,>(items: T[], keyOf: (t: T) => string): T | undefined => {
  const counts = new Map<string, { item: T; n: number }>()
  for (const item of items) {
    const k = keyOf(item)
    const c = counts.get(k)
    if (c) c.n++
    else counts.set(k, { item, n: 1 })
  }
  let best: { item: T; n: number } | undefined
  for (const c of counts.values()) if (!best || c.n > best.n) best = c
  return best?.item
}
const phaseOrder = (name: string) => {
  const i = (PHASE_NAMES as readonly string[]).indexOf(name)
  return i < 0 ? PHASE_NAMES.length : i
}

class LeftOut {
  private readonly by = new Map<LeftOutReason, { count: number; examples: string[] }>()
  add(reason: LeftOutReason, title: string, n = 1) {
    const r = this.by.get(reason) ?? { count: 0, examples: [] }
    this.by.set(reason, r)
    r.count += n
    const t = title.trim()
    if (t && r.examples.length < 3 && !r.examples.includes(t)) r.examples.push(t)
  }
  list(): ImportLeftOut[] {
    return [...this.by].map(([reason, r]) => ({ reason, ...r }))
  }
}

export interface PlanOptions {
  /** The connected Google account: its address is never crew, and people at its domain are staff. */
  account: string
  /** The calendar read, and the days read from it: events brought in from it on those days and gone now have been deleted or moved. */
  calendarId: string
  from: string
  to: string
  /** Days before this are gone: a Yes on them is a booking, and anything else is noted rather than offered. */
  today: string
}

/**
 * What the events are as jobs. Without `chosen`, what the import screen
 * shows first; with it, what the office ticked, under the names they gave,
 * with two jobs given the same new name brought in as one.
 */
export function planImport(events: readonly SourceEvent[], app: AppData, { account, calendarId, from, to, today }: PlanOptions, chosen?: Chosen): Plan {
  const leftOut = new LeftOut()
  const imported = new Map<string, AppData['imported']>()
  for (const i of app.imported) imported.set(i.uid, [...(imported.get(i.uid) ?? []), i])

  // Events into days of jobs.
  const entries: Entry[] = []
  let read = 0
  for (const ev of events) {
    if (ev.cancelled) continue
    read++
    const reason: LeftOutReason | undefined = ev.ours
      ? 'ours'
      : ev.special
        ? 'special'
        : !ev.days
          ? 'timed'
          : ev.repeating
            ? 'repeating'
            : !ev.title.trim()
              ? 'untitled'
              : imported.has(ev.uid)
                ? 'before'
                : daysApart(ev.days.start, ev.days.end) + 1 > LONGEST_EVENT_DAYS
                  ? 'long'
                  : undefined
    if (reason) {
      leftOut.add(reason, ev.title)
      continue
    }
    const t = parseTitle(ev.title)
    const key = nameKey(t.job)
    for (const day of eachDay(ev.days!.start, ev.days!.end))
      entries.push({ day, event: ev, job: t.job, key, phases: t.phases, note: t.note, guessed: t.guessed, pencilled: t.pencilled, kind: t.kind })
  }
  entries.sort((a, b) => a.day.localeCompare(b.day) || a.event.id.localeCompare(b.event.id))

  // Days into jobs: the same name, unless far apart.
  const clusters: Cluster[] = []
  const open = new Map<string, Cluster>()
  for (const e of entries) {
    const c = open.get(e.key)
    if (c && daysApart(c.entries.at(-1)!.day, e.day) <= GAP_DAYS) {
      c.entries.push(e)
      continue
    }
    const next: Cluster = { key: `${e.key}|${e.day}`, name: e.job, kind: e.kind, entries: [e], seen: [], existing: null }
    clusters.push(next)
    open.set(e.key, next)
  }
  for (const c of clusters) {
    c.name = mostCommon(c.entries, (e) => e.job)!.job
    c.kind = mostCommon(c.entries, (e) => e.kind)!.kind
    c.seen = c.entries
  }

  // Jobs already in the app with that name, or brought in from events with it, near those days.
  const broughtIn = new Map<string, Set<string>>()
  for (const i of app.imported) {
    const key = nameKey(parseTitle(i.title).job)
    broughtIn.set(key, (broughtIn.get(key) ?? new Set()).add(i.projectId))
  }
  const kept: Cluster[] = []
  for (const c of clusters) {
    const first = c.entries[0]!.day
    const last = c.entries.at(-1)!.day
    const key = c.entries[0]!.key
    const near = app.jobs.filter(
      (j) =>
        (nameKey(j.name) === key || broughtIn.get(key)?.has(j.id)) &&
        j.phases.some((p) => p.end >= addDays(first, -GAP_DAYS) && p.start <= addDays(last, GAP_DAYS))
    )
    const job = near[0]
    if (job && (job.status === 'cancelled' || job.status === 'lost')) {
      for (const e of c.entries) leftOut.add('stopped', e.event.title, e.phases.length)
      continue
    }
    if (job && job.sourceCalendar === null) {
      for (const e of c.entries) leftOut.add('inApp', e.event.title, e.phases.length)
      continue
    }
    if (job) {
      // Days the job already has, as the same phase, stay as they are; new days are of the job's kind.
      c.existing = job
      c.kind = job.kind
      c.entries = withKind(c.entries, job.kind)
        .map((e) => {
          const has = e.phases.filter((p) => job.phases.some((jp) => nameKey(jp.name) === nameKey(p) && jp.start <= e.day && e.day <= jp.end))
          for (let i = 0; i < has.length; i++) leftOut.add('inApp', e.event.title)
          return { ...e, phases: e.phases.filter((p) => !has.includes(p)) }
        })
        .filter((e) => e.phases.length > 0)
      if (c.entries.length === 0) continue
    }
    kept.push(c)
  }

  // What the office chose: which jobs, what kind each is, and names that bring two in as one.
  let groups: { clusters: Cluster[]; name: string; kind: ProjectKind }[] = kept.map((c) => ({ clusters: [c], name: c.name, kind: c.kind }))
  if (chosen) {
    const renamed = (c: Cluster) => {
      const name = tidy(chosen.names.get(c.key) ?? '')
      return name && !c.existing ? name : c.name
    }
    const kindOf = (c: Cluster) => (c.existing ? c.kind : (chosen.kinds?.get(c.key) ?? c.kind))
    groups = []
    const byName = new Map<string, { clusters: Cluster[]; name: string; kind: ProjectKind }>()
    for (const c of kept) {
      if (!chosen.include.has(c.key)) continue
      const name = renamed(c)
      const changed = name !== c.name
      const merge = changed ? byName.get(nameKey(name)) : undefined
      if (merge) {
        merge.clusters.push(c)
        continue
      }
      const g = { clusters: [c], name, kind: kindOf(c) }
      groups.push(g)
      // Only a name the office gave brings jobs together; two found with the same name stay apart (next year's party).
      if (changed && !byName.has(nameKey(name))) byName.set(nameKey(name), g)
    }
    // A job that kept its name joins one renamed to it.
    for (const g of [...groups]) {
      if (g.clusters.length !== 1 || g.clusters[0]!.existing || renamed(g.clusters[0]!) !== g.clusters[0]!.name) continue
      const into = byName.get(nameKey(g.name))
      if (into && into !== g) {
        into.clusters.push(...g.clusters)
        groups.splice(groups.indexOf(g), 1)
      }
    }
  }

  // Venues: one per place, shared between jobs.
  const newVenues = new Map<string, VenueRef>()
  const venueOf = (location: string): VenueRef | null => {
    const place = location.replace(/\s+/g, ' ').trim()
    if (!place) return null
    const name = place.split(',')[0]!.trim() || place
    const key = nameKey(name)
    const known = app.venues.find((v) => nameKey(v.name) === key || (v.address && nameKey(v.address) === nameKey(place)))
    if (known) return { id: known.id, name: known.name }
    const made = newVenues.get(key) ?? { key, name, address: place === name ? '' : place }
    newVenues.set(key, made)
    return made
  }
  const venueKey = (v: VenueRef | null) => (v === null ? '' : 'id' in v ? `id:${v.id}` : `new:${v.key}`)

  // Guests: people in the app, or people to add. A company's mailbox is never crew. Matched as an account is, trimmed,
  // so nobody here is added again with their own email, which the server refuses (audit finding 12).
  const byEmail = new Map(app.people.filter((p) => p.email?.trim()).map((p) => [p.email!.trim().toLowerCase(), p]))
  const byName = new Map(app.people.filter((p) => !p.email).map((p) => [nameKey(p.name), p]))
  const byId = new Map(app.people.map((p) => [p.id, p]))
  const own = account.toLowerCase()
  const domain = own.split('@')[1] ?? ''
  const newPeople = new Map<string, NewPerson & { jobKeys: Set<string>; gigs: Set<string> }>()
  const personOf = (g: SourceGuest, jobKey: string, gig: boolean): PersonRef | undefined => {
    const email = g.email.trim().toLowerCase()
    if (g.notCrew || email === own || !email.includes('@') || isMailbox(email)) return undefined
    const known = byEmail.get(email) ?? (g.name ? byName.get(nameKey(g.name)) : undefined)
    if (known) return { id: known.id }
    const at = email.split('@')[1]!
    const kind = at === domain ? 'staff' : 'freelancer'
    const given = chosen?.people?.get(email)?.trim()
    const person = newPeople.get(email) ?? {
      email,
      name: given || g.name?.trim() || nameFromEmail(email),
      kind,
      suggested: false,
      needsName: !given && !g.name?.trim(),
      jobs: 0,
      jobKeys: new Set<string>(),
      gigs: new Set<string>(),
    }
    person.jobKeys.add(jobKey)
    if (gig) person.gigs.add(jobKey)
    // Staff are always crew; a person's own address is, once they're on a gig: a client at a meeting isn't.
    person.suggested = kind === 'staff' || (OWN_EMAIL.has(at) && person.gigs.size > 0)
    newPeople.set(email, person)
    return { email }
  }
  /** Who a guest is, for a note: their name in the app, the one Google has, or their address. */
  const guestLabel = (g: SourceGuest, person: PersonRef | undefined): string => {
    if (person && 'id' in person) return byId.get(person.id)?.name ?? g.email
    if (person) return newPeople.get(person.email)?.name ?? g.email
    return g.name?.trim() || g.email
  }

  const jobs: PlanJob[] = groups.map((g) => {
    const lead = g.clusters[0]!
    const existing = lead.existing
    const gig = g.kind === 'gig'
    const all = g.clusters
      .flatMap((c) => withKind(c.entries, g.kind))
      .sort((a, b) => a.day.localeCompare(b.day) || a.event.id.localeCompare(b.event.id))
    const venues = all.map((e) => venueOf(e.event.location))
    const jobVenue = existing
      ? existing.venueId
        ? { id: existing.venueId, name: '' }
        : null
      : (mostCommon(
          venues.filter((v) => v !== null),
          venueKey
        ) ?? null)

    // A phase's days in a row, whatever events they come from.
    const byPhase = new Map<string, { name: string; days: Map<string, Entry[]> }>()
    for (const e of all)
      for (const p of e.phases) {
        const k = nameKey(p)
        const ph = byPhase.get(k) ?? { name: p, days: new Map<string, Entry[]>() }
        byPhase.set(k, ph)
        ph.days.set(e.day, [...(ph.days.get(e.day) ?? []), e])
      }
    const runs: (PlanRun & { sheet: string; extra: string[] })[] = []
    for (const [k, ph] of byPhase) {
      const days = [...ph.days.keys()].sort()
      let run: string[] = []
      const flush = () => {
        if (!run.length) return
        const es = run.flatMap((d) => ph.days.get(d)!)
        const vs = es.map((e) => venueOf(e.event.location)).filter((v) => v !== null)
        const venue = mostCommon(vs, venueKey) ?? null
        const sheets = [...new Set(es.map((e) => plainText(e.event.description)).filter(Boolean))]
        const titleNotes = [...new Set(es.map((e) => e.note).filter(Boolean))]
        const crew = new Map<string, { person: PersonRef; answers: Record<string, GuestResponse>; name: string }>()
        const with_ = new Map<string, string>()
        for (const e of es)
          for (const guest of e.event.guests) {
            const person = personOf(guest, lead.key, gig)
            const label = guestLabel(guest, person)
            // A hire, an errand or a meeting has no crew: whoever was invited is noted. So is a mailbox, for anyone looking.
            if (!gig || !person) {
              if (!guest.notCrew && guest.email.toLowerCase() !== own) with_.set(guest.email.toLowerCase(), label)
              continue
            }
            // A day naming two phases ("Show Day 2/ Load Out") puts its crew on the first, not on both.
            if (nameKey(e.phases[0]!) !== k) continue
            const pk = 'id' in person ? `id:${person.id}` : `new:${person.email}`
            const c = crew.get(pk) ?? { person, answers: {}, name: label }
            crew.set(pk, c)
            c.answers[e.day] = better(c.answers[e.day], guest.answer)
          }
        // Days gone are the record of who worked: a Yes is a booking, anything else is noted rather than left waiting.
        const noted = new Map<string, Noted>()
        for (const c of crew.values())
          for (const [d, answer] of Object.entries(c.answers)) {
            if (d >= today || answer === 'accepted') continue
            delete c.answers[d]
            const key = `${c.name}|${answer === 'declined' ? 'declined' : 'none'}`
            const n = noted.get(key) ?? { name: c.name, days: [], answer: answer === 'declined' ? 'declined' : 'none' }
            n.days.push(d)
            noted.set(key, n)
          }
        const first = run[0]!
        const last = run.at(-1)!
        const next = existing?.phases.find((p) => nameKey(p.name) === k && (p.end === addDays(first, -1) || p.start === addDays(last, 1)))
        const notedList = [...noted.values()].sort((a, b) => a.name.localeCompare(b.name))
        const extra = [
          ...titleNotes,
          with_.size ? `${gig ? 'Also on the invite' : 'On the invite'}: ${[...with_.values()].sort().join(', ')}` : '',
          notedList.some((n) => n.answer === 'none') ? `No answer on the invite: ${notedList.filter((n) => n.answer === 'none').map((n) => `${n.name} (${daysLabel(n.days)})`).join(', ')}` : '',
          notedList.some((n) => n.answer === 'declined') ? `Said no: ${notedList.filter((n) => n.answer === 'declined').map((n) => `${n.name} (${daysLabel(n.days)})`).join(', ')}` : '',
        ].filter(Boolean)
        runs.push({
          name: ph.name,
          days: run,
          guessed: es.every((e) => e.guessed),
          venue: venueKey(venue) === venueKey(jobVenue) ? null : venue,
          notes: '',
          sheet: sheets.join('\n\n'),
          extra,
          extend: next ? { id: next.id, start: next.start < first ? next.start : first, end: next.end > last ? next.end : last } : null,
          crew: [...crew.values()].filter((c) => Object.keys(c.answers).length > 0).map(({ person, answers }) => ({ person, answers })),
          noted: notedList,
          events: uniqueDays(es),
        })
        run = []
      }
      for (const d of days) {
        if (run.length && (addDays(run.at(-1)!, 1) !== d || run.length === MAX_PHASE_DAYS)) flush()
        run.push(d)
      }
      flush()
    }
    runs.sort((a, b) => a.days[0]!.localeCompare(b.days[0]!) || phaseOrder(a.name) - phaseOrder(b.name) || a.name.localeCompare(b.name))

    // One job sheet for every phase goes on the job instead.
    let notes = ''
    if (!existing && runs.length > 0 && runs[0]!.sheet && runs.every((r) => r.sheet === runs[0]!.sheet)) {
      notes = fit(g.clusters.flatMap((c) => c.entries.map((e) => plainText(e.event.description))).find(Boolean) ?? '', JOB_NOTES)
      for (const r of runs) r.sheet = ''
    }
    for (const r of runs) r.notes = fit([...r.extra, r.sheet].filter(Boolean).join('\n\n'), PHASE_NOTES)
    return {
      key: lead.key,
      name: existing ? existing.name : g.name,
      // Pencilled in only when all of it is: one day marked TBC doesn't make the whole job a maybe.
      status: all.every((e) => e.pencilled) ? 'enquiry' : 'confirmed',
      kind: g.kind,
      existing: existing ? { id: existing.id, name: existing.name, venueId: existing.venueId } : null,
      venue: existing ? null : jobVenue,
      notes,
      runs: runs.map(({ sheet: _s, extra: _e, ...r }) => r),
      events: new Set(all.map((e) => e.event.uid)).size,
      seen: uniqueDays(g.clusters.flatMap((c) => c.seen)),
    }
  })

  // Events brought in from this calendar before, on these days, that have since been deleted or moved in Google.
  const now = new Map(events.map((e) => [e.uid, e]))
  const changed: ImportChanged[] = []
  for (const [uid, all] of imported) {
    const rows = all.filter((r) => r.calendarId === calendarId)
    if (!rows.some((r) => r.day >= from && r.day < to)) continue
    const job = app.jobs.find((j) => j.id === rows[0]!.projectId)
    if (!job || job.status === 'cancelled' || job.status === 'lost') continue
    const was = [...new Set(rows.map((r) => r.day))].sort()
    const ev = now.get(uid)
    const days = ev && !ev.cancelled && ev.days ? eachDay(ev.days.start, ev.days.end) : []
    if (days.join() === was.join()) continue
    changed.push({ jobId: job.id, job: job.name, title: rows[0]!.title, was, now: days })
  }
  changed.sort((a, b) => a.was[0]!.localeCompare(b.was[0]!) || a.job.localeCompare(b.job))

  for (const p of newPeople.values()) p.jobs = p.jobKeys.size
  return {
    events: read,
    jobs,
    people: [...newPeople.values()].map(({ jobKeys: _j, gigs: _g, ...p }) => p).sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.name.localeCompare(b.name)),
    leftOut: leftOut.list(),
    changed,
  }
}
