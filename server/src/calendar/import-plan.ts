import {
  addDays,
  eachDay,
  MAX_PHASE_DAYS,
  nameKey,
  PHASE_NAMES,
  type GuestResponse,
  type ImportChanged,
  type ImportLeftOut,
  type LeftOutReason,
  type ProjectStatus,
} from '@sh/shared'

/**
 * Working out what the events on a calendar are as jobs (ADR 0011): titles
 * into jobs and phases, events into jobs, locations into venues, guests
 * into crew, and what is left out and why. Pure, so every guess can be
 * tested; import.ts reads the calendar and the app, and saves the result.
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

/** A phase's days in a row, and who is on them. */
export interface PlanRun {
  name: string
  days: string[]
  guessed: boolean
  /** Its own venue; null for the job's. */
  venue: VenueRef | null
  notes: string
  /** A phase of the job, just before or after these days, that they extend. */
  extend: { id: string; start: string; end: string } | null
  crew: { person: PersonRef; answers: Record<string, GuestResponse> }[]
  events: EventDay[]
}

export interface PlanJob {
  key: string
  name: string
  status: 'confirmed' | 'enquiry'
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

/** What the office chose on the import screen: names by job key, and the jobs to bring in. */
export interface Chosen {
  names: ReadonlyMap<string, string>
  include: ReadonlySet<string>
}

/** Events more than this many days apart are separate jobs, even with the same name. */
export const GAP_DAYS = 14
/** An all-day event longer than this is not a gig day. */
export const LONGEST_EVENT_DAYS = 31
/** Phase notes and job notes hold at most this much (ADR 0007). */
const PHASE_NOTES = 2000
const JOB_NOTES = 4000

export { nameKey }

/** Phase words and the app's name for each. Those marked `strict` are also safe to split off the end of a title with no " - " ("Fairview Build"). */
const PHASE_WORDS: { re: RegExp; name: string; strict: boolean }[] = [
  { re: /^(?:warehouse )?prep(?:aration)?$/, name: 'Prep', strict: true },
  { re: /^(?:load ?in|get ?in)$/, name: 'Load in', strict: true },
  { re: /^(?:deliver(?:y|ies)|drop ?off)$/, name: 'Load in', strict: false },
  { re: /^(?:build|set ?up)$/, name: 'Build', strict: true },
  { re: /^(?:install(?:ation)?|rig(?:ging)?)$/, name: 'Build', strict: false },
  { re: /^(?:rehearsals?|tech(?: rehearsals?)?|dress rehearsals?)$/, name: 'Rehearsal', strict: true },
  { re: /^(?:run ?through|sound ?check)$/, name: 'Rehearsal', strict: false },
  { re: /^show$/, name: 'Show', strict: true },
  { re: /^(?:event|live|performance|gig)$/, name: 'Show', strict: false },
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

/**
 * The phases a part of a title names: "Build 2/2" is Build, "Show Day 2/
 * Load Out" is Show and Load out. Undefined unless every part is a phase.
 */
export function phasesOf(text: string, strict = false): string[] | undefined {
  const parts = text
    .replace(NUMBERING, ' ')
    .split(/\s*(?:\/|&|\+|,|\band\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return undefined
  const names = parts.map((p) => phaseWord(p, strict))
  if (!names.every(Boolean)) return undefined
  return [...new Set(names as string[])]
}

export interface ParsedTitle {
  job: string
  phases: string[]
  /** No phase word in the title, so Show is a guess. */
  guessed: boolean
  /** TBC, pencil, hold or provisional in the title. */
  pencilled: boolean
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
 * "Fairview Build" is Fairview's Build, and "Christmas party" is all job,
 * with Show guessed.
 */
export function parseTitle(title: string): ParsedTitle {
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
    const phases = phasesOf(segments.at(-1)!)
    if (phases) return { job: job(segments.slice(0, -1).join(' - ')), phases, guessed: false, pencilled }
  }
  const whole = segments.join(' - ')
  const words = whole.split(' ')
  for (let n = Math.min(words.length - 1, 6); n >= 1; n--) {
    const phases = phasesOf(words.slice(-n).join(' '), true)
    if (phases) return { job: job(words.slice(0, -n).join(' ')), phases, guessed: false, pencilled }
  }
  return { job: job(whole), phases: ['Show'], guessed: true, pencilled }
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

/** "aoife.byrne92@gmail.com" → "Aoife Byrne", when Google has no name for a guest. */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  const words = local
    .split(/[._\-+]+/)
    .map((w) => w.replace(/\d+/g, ''))
    .filter(Boolean)
  return words.length ? words.map(capitalised).join(' ') : local
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
  guessed: boolean
  pencilled: boolean
}

interface Cluster {
  key: string
  name: string
  entries: Entry[]
  /** Its entries before those the job already has were dropped. */
  seen: Entry[]
  existing: AppData['jobs'][number] | null
}

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
}

/**
 * What the events are as jobs. Without `chosen`, what the import screen
 * shows first; with it, what the office ticked, under the names they gave,
 * with two jobs given the same new name brought in as one.
 */
export function planImport(events: readonly SourceEvent[], app: AppData, { account, calendarId, from, to }: PlanOptions, chosen?: Chosen): Plan {
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
    for (const day of eachDay(ev.days!.start, ev.days!.end)) entries.push({ day, event: ev, job: t.job, key, phases: t.phases, guessed: t.guessed, pencilled: t.pencilled })
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
    const next: Cluster = { key: `${e.key}|${e.day}`, name: e.job, entries: [e], seen: [], existing: null }
    clusters.push(next)
    open.set(e.key, next)
  }
  for (const c of clusters) {
    c.name = mostCommon(c.entries, (e) => e.job)!.job
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
      // Days the job already has, as the same phase, stay as they are.
      c.existing = job
      c.entries = c.entries
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

  // What the office chose: which jobs, and names that bring two in as one.
  let groups: { clusters: Cluster[]; name: string }[] = kept.map((c) => ({ clusters: [c], name: c.name }))
  if (chosen) {
    const renamed = (c: Cluster) => {
      const name = tidy(chosen.names.get(c.key) ?? '')
      return name && !c.existing ? name : c.name
    }
    groups = []
    const byName = new Map<string, { clusters: Cluster[]; name: string }>()
    for (const c of kept) {
      if (!chosen.include.has(c.key)) continue
      const name = renamed(c)
      const changed = name !== c.name
      const merge = changed ? byName.get(nameKey(name)) : undefined
      if (merge) {
        merge.clusters.push(c)
        continue
      }
      const g = { clusters: [c], name }
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

  // Guests: people in the app, or people to add.
  const byEmail = new Map(app.people.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p]))
  const byName = new Map(app.people.filter((p) => !p.email).map((p) => [nameKey(p.name), p]))
  const own = account.toLowerCase()
  const domain = own.split('@')[1] ?? ''
  const newPeople = new Map<string, NewPerson & { jobKeys: Set<string> }>()
  const personOf = (g: SourceGuest, jobKey: string): PersonRef | undefined => {
    const email = g.email.toLowerCase()
    if (g.notCrew || email === own || !email.includes('@')) return undefined
    const known = byEmail.get(email) ?? (g.name ? byName.get(nameKey(g.name)) : undefined)
    if (known) return { id: known.id }
    const at = email.split('@')[1]!
    const kind = at === domain ? 'staff' : 'freelancer'
    const person = newPeople.get(email) ?? {
      email,
      name: g.name?.trim() || nameFromEmail(email),
      kind,
      suggested: kind === 'staff' || OWN_EMAIL.has(at),
      jobs: 0,
      jobKeys: new Set<string>(),
    }
    person.jobKeys.add(jobKey)
    newPeople.set(email, person)
    return { email }
  }

  const jobs: PlanJob[] = groups.map((g) => {
    const lead = g.clusters[0]!
    const existing = lead.existing
    const all = g.clusters.flatMap((c) => c.entries).sort((a, b) => a.day.localeCompare(b.day) || a.event.id.localeCompare(b.event.id))
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
    const runs: PlanRun[] = []
    for (const [k, ph] of byPhase) {
      const days = [...ph.days.keys()].sort()
      let run: string[] = []
      const flush = () => {
        if (!run.length) return
        const es = run.flatMap((d) => ph.days.get(d)!)
        const vs = es.map((e) => venueOf(e.event.location)).filter((v) => v !== null)
        const venue = mostCommon(vs, venueKey) ?? null
        const sheets = [...new Set(es.map((e) => plainText(e.event.description)).filter(Boolean))]
        const crew = new Map<string, { person: PersonRef; answers: Record<string, GuestResponse> }>()
        for (const e of es)
          for (const guest of e.event.guests) {
            const person = personOf(guest, lead.key)
            if (!person) continue
            const pk = 'id' in person ? `id:${person.id}` : `new:${person.email}`
            const c = crew.get(pk) ?? { person, answers: {} }
            crew.set(pk, c)
            c.answers[e.day] = better(c.answers[e.day], guest.answer)
          }
        const first = run[0]!
        const last = run.at(-1)!
        const next = existing?.phases.find((p) => nameKey(p.name) === k && (p.end === addDays(first, -1) || p.start === addDays(last, 1)))
        runs.push({
          name: ph.name,
          days: run,
          guessed: es.every((e) => e.guessed),
          venue: venueKey(venue) === venueKey(jobVenue) ? null : venue,
          notes: fit(sheets.join('\n\n'), PHASE_NOTES),
          extend: next ? { id: next.id, start: next.start < first ? next.start : first, end: next.end > last ? next.end : last } : null,
          crew: [...crew.values()],
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
    if (!existing && runs.length > 0 && runs[0]!.notes && runs.every((r) => r.notes === runs[0]!.notes)) {
      notes = fit(g.clusters.flatMap((c) => c.entries.map((e) => plainText(e.event.description))).find(Boolean) ?? '', JOB_NOTES)
      for (const r of runs) r.notes = ''
    }
    return {
      key: lead.key,
      name: existing ? existing.name : g.name,
      // Pencilled in only when all of it is: one day marked TBC doesn't make the whole job a maybe.
      status: all.every((e) => e.pencilled) ? 'enquiry' : 'confirmed',
      existing: existing ? { id: existing.id, name: existing.name, venueId: existing.venueId } : null,
      venue: existing ? null : jobVenue,
      notes,
      runs,
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
    people: [...newPeople.values()].map(({ jobKeys: _, ...p }) => p).sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.name.localeCompare(b.name)),
    leftOut: leftOut.list(),
    changed,
  }
}
