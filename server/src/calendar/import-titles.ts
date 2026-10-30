import { departmentInWords, nameKey, KIND_PHASE, type ProjectKind } from '@sh/shared'

/**
 * Reading an event's title as a job, its phases and what kind of job it is
 * (ADR 0011, ADR 0037), and its description as plain text.
 */

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
export function tidy(name: string): string {
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
export function fit(text: string, max: number): string {
  if (text.length <= max) return text
  const note = '\n… (cut short: the rest is on the event in Google Calendar)'
  return text.slice(0, max - note.length).trimEnd() + note
}
