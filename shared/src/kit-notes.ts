import { z } from 'zod'
import { needed, text, whole } from './plain.ts'
import { DEPARTMENTS, MAX_QTY, type Department, type Model } from './stock.ts'

/**
 * Kit lists in jobs' notes (ADR 0043). A job brought in from Google
 * Calendar (ADR 0011) keeps each event's description in its phase's notes,
 * or its own when every phase had the same one, and those often hold a kit
 * list in sections ("Audio", "Video", "Lighting", "Transport and labour")
 * written as "4 x d&b Y10P" or "1 x d20 amp", among a running order and the
 * venue's access notes. This reads the lines that look like kit, matches
 * each to a product in the stock list, and works out what would go on the
 * job, for a person to check before anything is added. The notes stay as
 * they were written.
 *
 * It all runs on the device, from what it already holds, so it works with
 * no signal; the server only keeps the rules of the one change that adds
 * the lines (`kit.fromNotes`).
 */

const id = z.string().min(1).max(64)

// --- Reading the notes -------------------------------------------------------

/** What a heading in a kit list says the lines under it are: a department, or transport and crew, which isn't kit. */
export type NoteSection = Department | 'labour'

/** Words a section's heading starts with, and what they mean. */
const HEADINGS: [RegExp, NoteSection][] = [
  [/^(audio|sound|pa|sound and audio)$/, 'audio'],
  [/^(video|vision|av|led|screens?|projection)$/, 'video'],
  [/^(lighting|lights|lx|lamps)$/, 'lighting'],
  [/^(staging|stage|stages|set|set and staging)$/, 'staging'],
  [/^(rigging|rig|truss|trussing)$/, 'rigging'],
  [/^(power|electrics|electrical|distro|generators?)$/, 'power'],
  [/^(other|misc|miscellaneous|extras|backline)$/, 'other'],
  [/^(transport|labou?r|crew|staff|vans?|trucks?|trucking|logistics|transport and labou?r|labou?r and transport|crew and transport|transport and crew)$/, 'labour'],
]

/** A heading that ends a kit list's section without starting another: the running order, the venue's notes. */
const OTHER_HEADING = /^(run of show|running order|schedule|timings?|times|access|venue|notes?|contacts?|parking|catering|info|information|details)$/

/** A line of a kit list, as the notes have it. */
export interface NoteKitLine {
  /** Its line in the notes, from 0. */
  at: number
  /** The line as written, trimmed. */
  text: string
  qty: number
  /** What it is, as written: "d&b Y10P", "d20 amp". */
  name: string
  /** What was in brackets after it, such as "2 spare", kept as the line's note. */
  note: string
  /** The heading it's under, if it's under one the app knows. */
  section: NoteSection | undefined
}

/** A section's heading, or undefined for a line that isn't one. `null` is a heading the app knows isn't kit. */
function headingOf(line: string): NoteSection | null | undefined {
  if (/\d/.test(line) || line.length > 40) return undefined
  const words = line
    .replace(/\(.*\)/g, '')
    .replace(/[:\-–—]+\s*$/, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!words) return undefined
  for (const [re, section] of HEADINGS) if (re.test(words)) return section
  return OTHER_HEADING.test(words) ? null : undefined
}

const BULLET = /^[\s\-–—•*·>]+/
/** "4 x d&b Y10P", "4x d&b Y10P", "4×Y10P", "4 X Y10P". The x is a word of its own or before a digit, so "4 XLR 10 m" isn't four "LR 10 m". */
const QTY_X_NAME = /^(\d{1,7})\s*[x×](?=[\s\d]|$)\s*(.+)$/i
/** "4 no. d20", "4 nos d20", "4 pcs XLR", "4 off Y10P". */
const QTY_NO_NAME = /^(\d{1,7})\s*(?:no\.?s?|pcs?\.?|off)\s+(.+)$/i
/** "x4 Shure ULXD". */
const X_QTY_NAME = /^[x×]\s*(\d{1,7})\s+(.+)$/i
/** "Shure ULXD x4", "d&b Y10P × 4"; not "Stage deck 2 x 1", whose name would end in a number. */
const NAME_X_QTY = /^(.*[^\d\s])\s*[x×]\s*(\d{1,7})$/i
/** "12 Robe Spiider": only under a kit heading, as "12 Oct - build" or "1 Grand Canal Square" look the same anywhere else. */
const QTY_NAME = /^(\d{1,7})\s+(.+)$/

/** One line of kit, or undefined for anything else: a running order's time, an address, a sentence. */
function kitLineOf(raw: string, section: NoteSection | undefined): Omit<NoteKitLine, 'at' | 'section'> | undefined {
  const t = raw.replace(BULLET, '').trim()
  // What's in brackets at the end is the line's note, wherever its number is: "Shure ULXD x 2 (spare in the van)".
  let note = ''
  let said = t
  const bracket = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(t)
  if (bracket && bracket[1]) [said, note] = [bracket[1], bracket[2]!]
  let m = QTY_X_NAME.exec(said) ?? QTY_NO_NAME.exec(said)
  let qty: string | undefined
  let name: string | undefined
  if (m) [, qty, name] = m
  else if ((m = X_QTY_NAME.exec(said))) [, qty, name] = m
  else if ((m = NAME_X_QTY.exec(said))) [, name, qty] = m
  else if (section && section !== 'labour' && (m = QTY_NAME.exec(said))) [, qty, name] = m
  if (qty === undefined || name === undefined) return undefined
  name = name.replace(/^[\s:\-–—]+|[\s,.;:\-–—]+$/g, '').trim()
  const n = Number(qty)
  // A time ("5.00pm"), a price or a sentence isn't a product: a name has a letter in it and isn't a run of words.
  if (!/\p{L}/u.test(name) || name.length > 120 || n < 1 || n > MAX_QTY) return undefined
  return { text: t, qty: n, name, note: note.trim().slice(0, 200) }
}

/** Notes read once are kept: the same notes are read again every time the view is built. */
const read = new Map<string, NoteKitLine[]>()

/** The lines of a job's or a phase's notes that look like kit, in order. */
export function readKitLines(notes: string): NoteKitLine[] {
  if (!notes.trim()) return []
  const kept = read.get(notes)
  if (kept) return kept
  const out: NoteKitLine[] = []
  let section: NoteSection | undefined
  notes.split(/\r?\n/).forEach((raw, at) => {
    const line = raw.trim()
    if (!line) return
    const heading = headingOf(line.replace(BULLET, ''))
    if (heading !== undefined) {
      section = heading ?? undefined
      return
    }
    const found = kitLineOf(line, section)
    if (found) out.push({ ...found, at, section })
  })
  if (read.size > 5000) read.clear()
  read.set(notes, out)
  return out
}

// --- Matching a line to a product ----------------------------------------------

/** A name as compared: capitals, accents, punctuation and spacing aside, × as x. */
export function kitKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/[^a-z0-9&+]+/g, ' ')
    .trim()
}
const squash = (key: string) => key.replace(/ /g, '')

/** A short hash of some text, the same on every device. */
function hash(text: string): string {
  // cyrb53: 53 bits, plenty for a few thousand names or one job's notes.
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** The id of a name as notes write it, from the name itself, so every device and the server agree on it. */
export const kitNameId = (written: string) => `kn-${hash(kitKey(written))}`

/**
 * A name the notes use, remembered against the product it means, or as not
 * kit (`modelId` null), once someone has said so: "d20 amp" is the d&b D20,
 * "Luton van" isn't kit. The next job's notes that say the same are matched
 * the same way.
 */
export const kitName = z.object({
  id,
  /** As first written. */
  text: needed(200, 'The name', 'The name'),
  modelId: id.nullable(),
})
export type KitName = z.infer<typeof kitName>

/** A job's notes, read and turned into kit: what they said then, so the list of jobs to work through leaves it out until they change. */
export interface NotesRead {
  /** The job's. */
  id: string
  /** `notesSum` of its notes and its phases' when they were read. */
  sum: string
}

/** A fingerprint of everything a job's notes and its phases' say, to tell when they change. */
export function notesSum(job: { notes: string }, phases: readonly { id: string; notes: string }[]): string {
  const parts = [job.notes, ...[...phases].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((p) => `${p.id}\u0001${p.notes}`)]
  return hash(parts.join('\u0002'))
}

/** How a line was matched to a product. */
export type MatchHow =
  /** Someone said so before, for this name. */
  | 'chosen'
  /** The product's name, capitals and spacing aside. */
  | 'name'
  /** The product's model ("Y10P" for d&b Y10P), or a code in its name that the line has ("d20 amp"). */
  | 'code'
  /** Near enough to be likely, not sure: to check. */
  | 'close'
  /** Nothing like it in the stock list. */
  | 'none'

export interface KitMatch {
  how: MatchHow
  /** The product it matched; undefined for none, or for one said before to be not kit. */
  modelId: string | undefined
  /** Said before to be not kit. */
  notKit: boolean
  /** The products most like it, best first, to choose from. */
  likely: string[]
}

/** A product as matched: its other names (ADR 0069) are matched as its name is. */
type Product = Pick<Model, 'id' | 'name' | 'department'> & { aliases?: readonly string[] }

/** Pairs of letters, for a forgiving comparison. */
function pairs(s: string): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const p = s.slice(i, i + 2)
    out.set(p, (out.get(p) ?? 0) + 1)
  }
  return out
}

/** How alike two names are, from 0 to 1, by the pairs of letters they share (Dice's coefficient). */
function alike(a: Map<string, number>, aSize: number, b: Map<string, number>, bSize: number): number {
  if (aSize + bSize === 0) return 0
  let shared = 0
  for (const [p, n] of a) shared += Math.min(n, b.get(p) ?? 0)
  return (2 * shared) / (aSize + bSize)
}

/** A product as compared: its name, its model (the name less its maker), and the codes in it. */
interface Indexed {
  p: Product
  key: string
  squashed: string
  /** The name less its first word: "y10p" for d&b Y10P, "spiider" for Robe Spiider. */
  model: string | undefined
  /** Words with both letters and digits: "y10p", "d20", "sm58". */
  codes: string[]
  pairs: Map<string, number>
  size: number
}

function indexOf(p: Product, other?: string): Indexed {
  const key = kitKey(other ?? p.name)
  const words = key.split(' ').filter(Boolean)
  const squashed = squash(key)
  return {
    p,
    key,
    squashed,
    // An other name is a name as a whole: "Beta 58" is no maker and a model.
    model: !other && words.length > 1 ? squash(words.slice(1).join(' ')) : undefined,
    codes: words.filter((w) => w.length >= 2 && /\d/.test(w) && /[a-z]/.test(w)),
    pairs: pairs(squashed),
    size: Math.max(0, squashed.length - 1),
  }
}

/** Close enough to suggest, and close enough to go with unless someone says otherwise. */
const SUGGEST = 0.35
const LIKELY = 0.6

/** The stock list, ready to match against: made once for each stock list, as it changes far less often than the view is built. */
export class KitMatcher {
  private readonly all: Indexed[]
  private readonly byKey = new Map<string, Indexed>()
  private readonly bySquashed = new Map<string, Indexed>()
  private readonly byModel = new Map<string, Indexed[]>()
  private readonly byCode = new Map<string, Indexed[]>()
  private readonly cache = new Map<string, Omit<KitMatch, 'notKit'>>()

  constructor(products: readonly Product[]) {
    // A product once for its name and once for each other name it goes by: every name before any other name, so another
    // product's other name never takes the place of a name.
    this.all = [...products.map((p) => indexOf(p)), ...products.flatMap((p) => (p.aliases ?? []).map((n) => indexOf(p, n)))]
    for (const x of this.all) {
      if (!this.byKey.has(x.key)) this.byKey.set(x.key, x)
      if (!this.bySquashed.has(x.squashed)) this.bySquashed.set(x.squashed, x)
      if (x.model) this.byModel.set(x.model, [...(this.byModel.get(x.model) ?? []), x])
      for (const c of x.codes) this.byCode.set(c, [...(this.byCode.get(c) ?? []), x])
    }
  }

  /** The product a written name means, as best the stock list can say, before anything said before is taken into account. */
  match(name: string, section?: NoteSection): Omit<KitMatch, 'notKit'> {
    const key = kitKey(name)
    const cacheKey = `${section ?? ''}|${key}`
    const kept = this.cache.get(cacheKey)
    if (kept) return kept
    const out = this.find(key, section)
    this.cache.set(cacheKey, out)
    return out
  }

  private find(key: string, section: NoteSection | undefined): Omit<KitMatch, 'notKit'> {
    const squashed = squash(key)
    const exact = this.byKey.get(key) ?? this.bySquashed.get(squashed)
    if (exact) return { how: 'name', modelId: exact.p.id, likely: [exact.p.id] }
    // Where there's a choice, the product in the department the line's heading names.
    const pick = (all: Indexed[]) => {
      // A product once, though it may be here by more than one of its names.
      const xs = all.filter((x, i) => all.findIndex((y) => y.p.id === x.p.id) === i)
      return xs.length === 1 ? xs[0] : xs.filter((x) => x.p.department === section).length === 1 ? xs.find((x) => x.p.department === section) : undefined
    }
    const model = this.byModel.get(squashed)
    const byModel = model && pick(model)
    if (byModel) return { how: 'code', modelId: byModel.p.id, likely: [byModel.p.id] }
    const words = key.split(' ')
    const coded = new Set(words.filter((w) => /\d/.test(w) && /[a-z]/.test(w)).flatMap((w) => this.byCode.get(w) ?? []))
    const byCode = coded.size ? pick([...coded]) : undefined
    // The ones most like it, by letters shared, with a word of the line's in the product's name, or the heading's department, counted for it.
    const own = pairs(squashed)
    const size = Math.max(0, squashed.length - 1)
    const best = new Map<string, { x: Indexed; score: number }>()
    for (const s of this.all
      .map((x) => {
        let score = alike(own, size, x.pairs, x.size)
        if (x.model && squashed.includes(x.model) && x.model.length >= 3) score = Math.max(score, 0.62)
        if (words.some((w) => w.length >= 3 && x.key.split(' ').includes(w))) score += 0.08
        if (section && x.p.department === section) score += 0.04
        return { x, score }
      })
      .filter((s) => s.score >= SUGGEST)) {
      // A product once, by whichever of its names is most like the line.
      const was = best.get(s.x.p.id)
      if (!was || s.score > was.score) best.set(s.x.p.id, s)
    }
    const scored = [...best.values()].sort((a, b) => b.score - a.score || a.x.p.name.localeCompare(b.x.p.name))
    const likely = [...new Set([...(byCode ? [byCode.p.id] : []), ...scored.slice(0, 4).map((s) => s.x.p.id)])].slice(0, 4)
    if (byCode) return { how: 'code', modelId: byCode.p.id, likely }
    const top = scored[0]
    // Two nearly as good is a choice to make, not a guess to go with.
    const clear = top && top.score >= LIKELY && !(scored[1] && scored[1].score > top.score - 0.05)
    if (clear) return { how: 'close', modelId: top.x.p.id, likely }
    return { how: 'none', modelId: undefined, likely }
  }
}

/** Matchers kept for the stock list they were made from: the last few, as a phone's stock list changes now and then. */
let matchers: { sig: string; matcher: KitMatcher }[] = []

/** The matcher for this stock list, made once. */
export function matcherFor(products: readonly Product[]): KitMatcher {
  const sig = products.map((p) => `${p.id}\u0001${p.name}\u0001${p.department}\u0001${(p.aliases ?? []).join('\u0003')}`).join('\u0002')
  const found = matchers.find((m) => m.sig === sig)
  if (found) return found.matcher
  const matcher = new KitMatcher(products)
  matchers = [{ sig, matcher }, ...matchers].slice(0, 3)
  return matcher
}

/** A line matched, with what was said before for its name laid over what the stock list says. */
export function matchLine(matcher: KitMatcher, line: Pick<NoteKitLine, 'name' | 'section'>, remembered: ReadonlyMap<string, Pick<KitName, 'modelId'>>, inStock: (modelId: string) => boolean): KitMatch {
  const said = remembered.get(kitNameId(line.name))
  const found = matcher.match(line.name, line.section)
  if (said && said.modelId === null) return { ...found, how: 'chosen', modelId: undefined, notKit: true }
  if (said && said.modelId && inStock(said.modelId)) return { how: 'chosen', modelId: said.modelId, notKit: false, likely: [said.modelId, ...found.likely.filter((x) => x !== said.modelId)].slice(0, 4) }
  return { ...found, notKit: false }
}

// --- What would go on the job ------------------------------------------------------

/** One line of a job's notes that looks like kit, read and matched, and where it would go. */
export interface NoteRow {
  /** Steady while the notes stay the same, for a screen to keep a choice against: the phase (or "job") and the line. */
  key: string
  /** Null: the job's own notes, so the whole job. */
  phaseId: string | null
  line: NoteKitLine
  match: KitMatch
}

/** What a person decided about a row; left out, the match stands. */
export interface NoteChoice {
  /** A product, or 'not-kit'. */
  pick?: string | 'not-kit'
  qty?: number
}

/** What a row will do once the choices are in. */
export type RowState =
  /** Goes on the job: `adds` of it. */
  | 'add'
  /** The job has all of it already, on these days. */
  | 'already'
  /** Not kit, so left out. */
  | 'not-kit'
  /** Needs a product chosen first, or to be said not kit; left out until then. */
  | 'choose'

export interface RowPlan {
  row: NoteRow
  /** The product it's for, as chosen or matched. */
  modelId: string | undefined
  qty: number
  state: RowState
  /** How many it adds; less than `qty` when the job has some already. */
  adds: number
  /** How many of it the job has on these days already, counted towards this row. */
  onJob: number
  /** The match was a guess, or nothing, and nobody has chosen yet: worth a look. */
  check: boolean
}

/** A line the notes put on the job: at least this many of a product for these days. */
export interface FromNotesLine {
  id: string
  phaseId: string | null
  modelId: string
  qty: number
  notes: string
}

export interface NotesPlan {
  rows: RowPlan[]
  /** For `kit.fromNotes`: each product for each phase (or the whole job) the notes want, as how many the job should then have for exactly those days. */
  lines: FromNotesLine[]
  /** How many lines of kit it adds, and how many of each they come to. */
  adding: number
  /** Rows still to choose a product for. */
  choosing: number
  /** Rows that were a guess or found nothing, not yet looked at. */
  checking: number
  /** Names to remember with the change: what the person chose where the match said otherwise, and what they said isn't kit. */
  names: { text: string; modelId: string | null }[]
}

/** The kit on a job as it stands, by phase (null for the whole job) and product. */
export interface KitOnJob {
  phaseId: string | null
  modelId: string
  qty: number
}

/** A job's notes, its phases' and what the stock list says, as the rows a person checks. */
export function noteRows(
  job: { id: string; notes: string },
  phases: readonly { id: string; notes: string }[],
  matcher: KitMatcher,
  remembered: ReadonlyMap<string, Pick<KitName, 'modelId'>>,
  inStock: (modelId: string) => boolean
): NoteRow[] {
  const rows: NoteRow[] = []
  const from = (phaseId: string | null, notes: string) => {
    for (const line of readKitLines(notes)) rows.push({ key: `${phaseId ?? 'job'}:${line.at}`, phaseId, line, match: matchLine(matcher, line, remembered, inStock) })
  }
  from(null, job.notes)
  for (const p of phases) from(p.id, p.notes)
  return rows
}

/**
 * What the rows would put on the job, with the choices made so far. The
 * same notes twice change nothing: each row counts what the job already
 * has on its days (for a phase, its own lines and the whole job's; for the
 * whole job, its own and the most on any one phase), and the change says
 * how many there should then be, not how many to add, so the server adds
 * only what's missing even if someone else did the same meanwhile.
 */
export function notesPlan(rows: readonly NoteRow[], kit: readonly KitOnJob[], choices: Readonly<Record<string, NoteChoice>> = {}, newId: () => string): NotesPlan {
  const sum = (phaseId: string | null, modelId: string) => kit.filter((k) => k.phaseId === phaseId && k.modelId === modelId).reduce((n, k) => n + k.qty, 0)
  const phaseIds = [...new Set(kit.map((k) => k.phaseId).filter((p): p is string => p !== null))]
  const covered = (phaseId: string | null, modelId: string) =>
    phaseId === null ? sum(null, modelId) + Math.max(0, ...phaseIds.map((p) => sum(p, modelId))) : sum(phaseId, modelId) + wholeJob(modelId)
  // What's on the job is used up by the rows in order, so two rows of one product share it. The whole job's rows come
  // first, and what they add covers each phase's days too.
  const left = new Map<string, number>()
  const wholeJob = (modelId: string) => want.get(`|${modelId}`)?.qty ?? sum(null, modelId)
  const want = new Map<string, FromNotesLine>()
  const names = new Map<string, { text: string; modelId: string | null }>()
  const plans = rows.map((row): RowPlan => {
    const choice = choices[row.key] ?? {}
    const qty = choice.qty ?? row.line.qty
    const said = choice.pick !== undefined
    const notKit = said ? choice.pick === 'not-kit' : row.match.notKit
    const modelId = notKit ? undefined : said ? (choice.pick as string) : row.match.modelId
    const check = !said && (row.match.how === 'close' || (row.match.how === 'none' && row.line.section !== 'labour') || row.match.how === 'code')
    // A line under transport and labour that's like nothing in the stock list is crew or a van: not kit, unless someone says so.
    const labour = !said && row.match.how === 'none' && row.line.section === 'labour'
    if (said) {
      const remembered = notKit ? null : modelId!
      // Remembered only where it says more than the stock list already does.
      if (!(row.match.how === 'name' && remembered === row.match.modelId) && !(row.match.how === 'chosen' && (row.match.notKit ? remembered === null : remembered === row.match.modelId)))
        names.set(kitNameId(row.line.name), { text: row.line.name, modelId: remembered })
    }
    if (notKit || labour) return { row, modelId: undefined, qty, state: 'not-kit', adds: 0, onJob: 0, check: false }
    if (!modelId) return { row, modelId: undefined, qty, state: 'choose', adds: 0, onJob: 0, check }
    // A guess taken as it is, by adding it, is remembered too, so the next job's notes match it for certain.
    if (!said && (row.match.how === 'close' || row.match.how === 'code')) names.set(kitNameId(row.line.name), { text: row.line.name, modelId })
    const at = `${row.phaseId ?? ''}|${modelId}`
    const has = left.get(at) ?? covered(row.phaseId, modelId)
    const onJob = Math.min(has, qty)
    left.set(at, has - onJob)
    const adds = qty - onJob
    if (adds > 0) {
      const line = want.get(at)
      if (line) line.qty += adds
      else want.set(at, { id: newId(), phaseId: row.phaseId, modelId, qty: sum(row.phaseId, modelId) + adds, notes: row.line.note })
    }
    return { row, modelId, qty, state: adds > 0 ? 'add' : 'already', adds, onJob, check }
  })
  const lines = [...want.values()]
  return {
    rows: plans,
    lines,
    adding: lines.length,
    choosing: plans.filter((p) => p.state === 'choose').length,
    checking: plans.filter((p) => p.check && p.state !== 'not-kit').length,
    names: [...names.values()],
  }
}

/** Departments in order, for a heading's department or a product's. */
export const sectionDepartment = (s: NoteSection | undefined): Department => (s && s !== 'labour' && DEPARTMENTS.includes(s) ? s : 'other')

// --- The change ---------------------------------------------------------------

/** The most jobs and lines in one change, so a long list goes in a call at a time (ADR 0011, 0026). */
export const FROM_NOTES_JOBS = 50
export const FROM_NOTES_LINES = 1000

const fromNotesLine = z.object({
  id,
  phaseId: id.nullable(),
  modelId: id,
  /** How many the job should have of it for exactly these days, once it's in: what it has, and what the notes add. */
  qty: whole(1, MAX_QTY, 'How many'),
  notes: text(500, 'The note'),
})

export const notesKitCommandSchemas = {
  /**
   * Kit read from jobs' notes (ADR 0043), for one job or many at once: for
   * each, the lines as how many there should then be (never added to
   * twice), what its notes were when read, and the names to remember.
   */
  'kit.fromNotes': z
    .object({
      jobs: z
        .array(
          z.object({
            projectId: id,
            sum: z.string().min(1).max(40),
            lines: z.array(fromNotesLine).max(FROM_NOTES_LINES),
          })
        )
        .min(1)
        .max(FROM_NOTES_JOBS, `Up to ${FROM_NOTES_JOBS} jobs at a time.`),
      names: z.array(kitName.omit({ id: true })).max(FROM_NOTES_LINES),
    })
    .refine((a) => a.jobs.reduce((n, j) => n + j.lines.length, 0) <= FROM_NOTES_LINES, { message: `Up to ${FROM_NOTES_LINES} lines at a time.` })
    .refine((a) => new Set(a.jobs.map((j) => j.projectId)).size === a.jobs.length, { message: 'Each job once, please.' })
    .refine((a) => a.jobs.every((j) => new Set(j.lines.map((l) => `${l.phaseId}|${l.modelId}`)).size === j.lines.length), {
      message: 'Each product once for each phase, please.',
    }),
} as const

export interface NotesKitEntities {
  kitName: KitName
  notesRead: NotesRead
}
export const NOTES_KIT_ENTITY_NAMES = ['kitName', 'notesRead'] as const
