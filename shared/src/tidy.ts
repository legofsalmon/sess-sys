import type { Person } from './crew.ts'
import { addDays } from './sync/plan.ts'
import { nameFromEmail, nameKey } from './import.ts'
import { KIND_PHASE, STOPPED, type ProjectKind, type ProjectStatus, type Venue } from './jobs.ts'

/**
 * Tidying what came in from the calendars (ADR 0050): what a bring-in
 * couldn't tell, found in the jobs and people already in the app and offered
 * to the office to put right, a few at a time. Nothing here changes
 * anything; the Tidy up page sends the ordinary changes (a job merged,
 * renamed or given a venue or client, a person named) once the office has
 * ticked them.
 */

/** What tidying reads of a job. */
export interface TidyJob {
  id: string
  name: string
  status: ProjectStatus
  kind?: ProjectKind
  clientId: string | null
  venueId: string | null
  /** Brought in from this calendar; jobs made in the app have none. */
  sourceCalendar?: string
  span: { start: string; end: string } | undefined
  /** The venues its phases have of their own. */
  phaseVenues?: readonly (string | null)[]
}

/** Two jobs this close (days between the end of one and the start of the next) can be one job. */
export const NEAR_DAYS = 2

/** "EP - Smirnoff LX" → "EP": a title's head, before its first " - ". */
export function headOf(name: string): string {
  return name.split(/\s+[-–—]\s+/)[0]!.trim()
}

const near = (a: { start: string; end: string }, b: { start: string; end: string }) =>
  b.start <= addDays(a.end, NEAR_DAYS + 1) && a.start <= addDays(b.end, NEAR_DAYS + 1)

/** Whether one name's words begin the other's: "Addison Rae" and "Addison Rae Show", "Fuel" and "Fuel Cupra Floor Package". */
function wordPrefix(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 4 && (long === short || long.startsWith(`${short} `))
}

export interface SameJob {
  /** Stable while the same jobs are in it: the first job's id. */
  key: string
  /** What the one job would be called: the head they share. */
  name: string
  /** In the order they happen. */
  jobs: TidyJob[]
  /**
   * Every job's name starts with the same head ("EP - LX", "EP - Audio"),
   * so they're ticked to start with; joined only by one name starting
   * another ("Addison Rae", "Addison Rae Show"), they're left for the
   * office to tick.
   */
  sure: boolean
}

/**
 * Jobs that look like one job brought in as several (audit of 16 October,
 * finding 5): the same kind, near in days, and either the same head before
 * " - " ("EP - Smirnoff LX", "EP - Audio") or one name the start of the
 * other ("Addison Rae", "Addison Rae Show"). Jobs made in the app and jobs
 * brought in aren't put together, and nor are jobs not going ahead. Days
 * chain: the build of a festival joins its first show day, which joins the
 * next.
 */
export function sameJobs(all: readonly TidyJob[]): SameJob[] {
  const jobs = all
    .filter((j) => j.span && !STOPPED.includes(j.status))
    .sort((a, b) => a.span!.start.localeCompare(b.span!.start) || a.id.localeCompare(b.id))
  const parent = jobs.map((_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)))
  const heads = jobs.map((j) => nameKey(headOf(j.name)))
  const fulls = jobs.map((j) => nameKey(j.name))
  for (let i = 0; i < jobs.length; i++)
    for (let k = i + 1; k < jobs.length; k++) {
      const [a, b] = [jobs[i]!, jobs[k]!]
      if ((a.kind ?? 'gig') !== (b.kind ?? 'gig') || !a.sourceCalendar !== !b.sourceCalendar || !near(a.span!, b.span!)) continue
      const head = !!heads[i] && heads[i] === heads[k]
      if (!head && !wordPrefix(fulls[i]!, fulls[k]!)) continue
      parent[root(k)] = root(i)
    }
  const groups = new Map<number, number[]>()
  for (let i = 0; i < jobs.length; i++) groups.set(root(i), [...(groups.get(root(i)) ?? []), i])
  const out: SameJob[] = []
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const group = members.map((i) => jobs[i]!)
    const sure = members.every((i) => heads[i] === heads[members[0]!])
    // The shortest head names the job, in the casing most of them use, a capital first if any has one.
    const shortest = Math.min(...members.map((i) => heads[i]!.length))
    const named = group.map((j) => headOf(j.name)).filter((h) => nameKey(h).length === shortest)
    const name = named.find((h) => /^[A-Z0-9]/.test(h)) ?? named[0]!
    out.push({ key: group[0]!.id, name, jobs: group, sure })
  }
  return out.sort((a, b) => a.jobs[0]!.span!.start.localeCompare(b.jobs[0]!.span!.start))
}

/**
 * Someone a bring-in named from their address (audit finding 7):
 * "Craicaudio" from craicaudio@gmail.com. Their name is still exactly what
 * the address gave, so nobody has given them theirs yet.
 */
export function namedFromAddress(p: Pick<Person, 'name' | 'email' | 'archived'>): boolean {
  if (!p.email || p.archived) return false
  return nameKey(p.name) === nameKey(nameFromEmail(p.email))
}

/** A venue's name as it's looked for in a job's: no "The", no punctuation. */
function venueKeys(v: Pick<Venue, 'name'>): string[] {
  const keys: string[] = []
  const whole = nameKey(v.name).replace(/^the /, '')
  if (whole.includes(' ') || whole.replace(/ /g, '').length >= 6) keys.push(whole)
  // "Royal Dublin Society (RDS)": the letters people write.
  for (const [, short] of v.name.matchAll(/\(([A-Za-z]{2,6})\)/g)) keys.push(nameKey(short!))
  return keys
}

export interface VenueGuess {
  job: TidyJob
  venue: Venue
  /** Why: the venue's name is in the job's, or other jobs of that name are there. */
  why: 'name' | 'before'
}

/**
 * Venues for jobs that have none (audit finding 8): a venue the app has
 * whose name is in the job's ("Real events Button factory" is at Button
 * Factory, "3 arena" is 3Arena, "RDS" is the Royal Dublin Society), or the
 * venue other jobs of the same name are at. Only jobs whose phases have no
 * venue of their own either.
 */
export function venueGuesses(jobs: readonly TidyJob[], venues: readonly Venue[]): VenueGuess[] {
  const keyed = venues.map((v) => ({ v, keys: venueKeys(v) })).filter((k) => k.keys.length)
  const byName = new Map<string, Map<string, number>>()
  for (const j of jobs) {
    if (!j.venueId) continue
    const at = byName.get(nameKey(j.name)) ?? new Map<string, number>()
    at.set(j.venueId, (at.get(j.venueId) ?? 0) + 1)
    byName.set(nameKey(j.name), at)
  }
  const out: VenueGuess[] = []
  for (const j of jobs) {
    if (j.venueId || STOPPED.includes(j.status) || j.phaseVenues?.some(Boolean)) continue
    const name = nameKey(j.name)
    const padded = ` ${name} `
    const compact = name.replace(/ /g, '')
    // The longest name that fits: "RDS Simmonscourt" over "RDS".
    const found = keyed
      .flatMap(({ v, keys }) => keys.filter((k) => padded.includes(` ${k} `) || (k.length >= 6 && compact.includes(k.replace(/ /g, '')))).map((k) => ({ v, k })))
      .sort((a, b) => b.k.length - a.k.length)[0]
    if (found) {
      out.push({ job: j, venue: found.v, why: 'name' })
      continue
    }
    const before = [...(byName.get(name)?.entries() ?? [])].sort((a, b) => b[1] - a[1])[0]
    const venue = before && venues.find((v) => v.id === before[0])
    if (venue) out.push({ job: j, venue, why: 'before' })
  }
  return out
}

/** Words that say nothing about who a job is for. */
const NOT_A_CLIENT = new Set(
  (
    'the and for with from into at in on of to a an x vs ' +
    'show shows gig event events party launch live day days night prep build load in out install rehearsal rehearsals de rig ' +
    'hire dry rental rent collect collection return returns drop pick up deliver delivery meeting site visit recce ' +
    'lx audio video laser led sound lighting lights stage main pa truss tech crew rigging travel warehouse ' +
    'jan feb mar apr may jun jul aug sep sept oct nov dec christmas summer halloween ' +
    'session dublin cork galway belfast ' +
    'job jobs kit sale street grand back extra extras package packages corporate corporates plus lounge series ' +
    'screen screens projector generator system processor tubes drape pipe booth staging desk power cable cables ' +
    'uplighter uplighters mic mics ma ma3 lite floor wrap additional'
  ).split(' ')
)

/**
 * Words in many jobs' names that could be a client (audit finding 8):
 * "Verve" in nine titles is plainly one. Words that name a phase, a kind,
 * a department, a month or a venue the app has are left out; so are words
 * already a client's name. The most used first.
 */
export function clientWords(jobs: readonly TidyJob[], known: { clients: readonly { name: string }[]; venues: readonly Venue[] }, atLeast = 3): { word: string; jobs: number }[] {
  const skip = new Set(NOT_A_CLIENT)
  for (const n of [...known.clients.map((c) => c.name), ...known.venues.map((v) => v.name)]) for (const w of nameKey(n).split(' ')) skip.add(w)
  const counts = new Map<string, { shown: string; ids: Set<string> }>()
  for (const j of jobs) {
    if (j.clientId || STOPPED.includes(j.status)) continue
    for (const shown of j.name.split(/[^\p{L}\p{N}']+/u)) {
      const w = nameKey(shown)
      if (w.length < 3 || /^\d+$/.test(w) || skip.has(w)) continue
      const c = counts.get(w) ?? { shown, ids: new Set<string>() }
      // A capital where someone wrote one: "Verve" over "verve".
      if (/^[A-Z]/.test(shown) && !/^[A-Z]/.test(c.shown)) c.shown = shown
      c.ids.add(j.id)
      counts.set(w, c)
    }
  }
  return [...counts.values()]
    .filter((c) => c.ids.size >= atLeast)
    .map((c) => ({ word: c.shown, jobs: c.ids.size }))
    .sort((a, b) => b.jobs - a.jobs || a.word.localeCompare(b.word))
}

/** Jobs with no client yet whose names have these words in them, as whole words. */
export function jobsNaming(jobs: readonly TidyJob[], words: string): TidyJob[] {
  const key = nameKey(words)
  if (!key) return []
  return jobs.filter((j) => !j.clientId && !STOPPED.includes(j.status) && ` ${nameKey(j.name)} `.includes(` ${key} `))
}

/** "cms uplighter shop hire" → "Cms uplighter shop hire" (finding 15): only the first letter, so "iPhone launch" would stay as typed. */
export function withCapital(name: string): string {
  const t = name.trimStart()
  return /^\p{Ll}\p{Ll}/u.test(t) ? t.charAt(0).toUpperCase() + t.slice(1) : name
}

/**
 * What a job's name says beyond the name of the job it joins: "EP - Smirnoff
 * LX" joining EP says "Smirnoff LX", "Addison Rae Show" joining Addison Rae
 * says "Show". Nothing when the names are the same. A job whose name doesn't
 * start with the one it joins says what's after its own " - ", or all of it.
 */
export function tailOf(jobName: string, joining: string): string {
  const key = nameKey(joining)
  if (nameKey(jobName) === key) return ''
  const clean = (s: string) => s.replace(/^[\s\-–—:|,.+&/]+/, '').trim()
  for (let i = 1; i <= jobName.length; i++)
    if (nameKey(jobName.slice(0, i)) === key && !/[\p{L}\p{N}]/u.test(jobName.charAt(i))) return clean(jobName.slice(i))
  const head = headOf(jobName)
  return head === jobName.trim() ? jobName.trim() : clean(jobName.trim().slice(head.length))
}

/** Phase names hold at most this much (ADR 0007). */
const PHASE_NAME = 100

/**
 * A phase's name once its job has joined another (ADR 0050), so the days
 * still say what they were for: a day nothing named (a gig's Show, a
 * hire's Hire) takes what the job's name said ("Smirnoff LX"), as does one
 * the name already holds ("FLY Show"); any other keeps its name with it
 * after, "Load out (LX)".
 */
export function joinedPhaseName(phase: string, tail: string, kind: ProjectKind | undefined): string {
  if (!tail) return phase
  const fit = (s: string) => (s.length > PHASE_NAME ? `${s.slice(0, PHASE_NAME - 1)}…` : s)
  const said = ` ${nameKey(tail)} `.includes(` ${nameKey(phase)} `)
  if (said || phase === KIND_PHASE[kind ?? 'gig']) return fit(tail)
  return fit(`${phase} (${tail})`)
}
