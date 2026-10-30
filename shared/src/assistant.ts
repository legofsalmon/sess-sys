import { z } from 'zod'
import { isDay } from './day.ts'
import type { KitMatcher, MatchHow } from './kit-notes.ts'
import { chargedFor, LINE_KINDS, LINE_PER, MAX_LINES, roleKey, STANDARD_VAT, type LineKind, type LinePer, type QuoteLine, type RateRule } from './quotes.ts'
import { DEPARTMENT_LABELS, DEPARTMENTS, type Department } from './stock.ts'

/**
 * Claude inside the app (ADR 0096): it only suggests, and a person takes
 * what it suggests with the same presses and commands as typing it in.
 * Claude reads an enquiry pasted into New quote into a job and the lines
 * of its quote, and changes an open quote when asked in words. Nothing
 * goes outside the app but the words sent to Claude, and nobody is
 * contacted. The company turns it on under Admin; the server holds the
 * key and a monthly limit on what it spends.
 *
 * What Claude answers is read leniently: anything too long is cut, too
 * many is shortened and a number out of range is brought into it, so an
 * answer that strays a little still helps instead of failing.
 */

/** The longest enquiry read: a long email thread pasted whole. */
export const ENQUIRY_LENGTH = 20_000
/** At most this many lines are suggested from one enquiry. */
export const MOST_SUGGESTED = 120

/** Whether Claude can be asked, and what it has cost this month, for Admin and the screens that offer it. */
export interface AssistantStatus {
  /** The server has a key for Claude. */
  configured: boolean
  /** The company turned it on under Admin. */
  on: boolean
  model: string
  /** The month counted, YYYY-MM, in Ireland. */
  month: string
  /** What it has cost this month and what it may, in US cents (Anthropic charges in dollars). */
  spentCents: number
  limitCents: number
  /** How many times it was asked this month. */
  uses: number
}

/** Why Claude can't be asked now, in the office's words; null when it can. */
export function assistantBlocked(s: AssistantStatus | undefined): string | null {
  if (!s) return 'Claude needs signal.'
  if (!s.configured) return 'Claude isn’t set up on the server yet.'
  if (!s.on) return 'Claude is turned off under Admin › Company.'
  if (s.spentCents >= s.limitCents) return 'Claude has used this month’s limit. It starts again on the 1st.'
  return null
}

// --- Reading leniently ------------------------------------------------------

const words = (n: number) => z.preprocess((v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : ''), z.string())
const text = (n: number) => z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, n) : ''), z.string())
const clamp = (lo: number, hi: number, step: number) => (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v / step) * step)) : v)
const count = z.preprocess(clamp(1, 10_000, 1), z.number())
const days = z.preprocess((v) => (v == null ? null : clamp(0.5, 365, 0.5)(v)), z.number().nullable())
const pct = z.preprocess((v) => (v == null ? null : clamp(0, 100, 0.1)(v)), z.number().nullable())
const cents = z.preprocess((v) => (v == null ? null : clamp(0, 100_000_000, 1)(v)), z.number().int().nullable())
const dayOrNone = z.preprocess((v) => (typeof v === 'string' && isDay(v) ? v : ''), z.string())
const some = <T extends z.ZodTypeAny>(item: T, most: number) => z.preprocess((v) => (Array.isArray(v) ? v.slice(0, most) : []), z.array(item))
const department = z.preprocess((v) => (DEPARTMENTS.includes(v as Department) ? v : 'other'), z.enum(DEPARTMENTS))

// --- An enquiry -------------------------------------------------------------

export const enquiryAsk = z.object({
  text: z.string().trim().min(20, 'Paste the enquiry in: a few words at least.').max(ENQUIRY_LENGTH, `An enquiry can be up to ${ENQUIRY_LENGTH.toLocaleString('en-IE')} characters.`),
})

/** An enquiry as Claude read it. Anything it wasn't told is left empty, and asked about in `questions`. */
export const enquiryReading = z.object({
  /** What the job is called, such as "Nissan launch". */
  name: words(200),
  client: words(200),
  venue: words(200),
  start: dayOrNone,
  end: dayOrNone,
  /** The days the enquiry gives for each part, when it gives them apart: a build, the show, a derig. */
  phases: some(z.object({ name: words(100), start: dayOrNone, end: dayOrNone }), 10),
  kit: some(z.object({ qty: count, what: words(200), department }), MOST_SUGGESTED),
  crew: some(z.object({ qty: count, role: words(100), days }), 40),
  other: some(z.object({ qty: count, what: words(200) }), 30),
  /** What the office needs to ask the client before quoting. */
  questions: some(words(300), 8),
  summary: text(1000),
})
export type EnquiryReading = z.infer<typeof enquiryReading>

// --- Changing a quote -------------------------------------------------------

/** A quote's line as Claude is shown it: what it is and how it's charged, nothing about costs or suppliers. */
export const askedLine = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(LINE_KINDS),
  what: z.string().max(500),
  group: z.string().max(100),
  qty: z.number(),
  days: z.number(),
  per: z.enum(LINE_PER),
  unitCents: z.number().int(),
  discountPct: z.number(),
})
export type AskedLine = z.infer<typeof askedLine>


/** What Claude suggests doing to a quote: lines to add, lines to take off, and changes to lines already there. */
export const quoteAdvice = z.object({
  /** A sentence or two on what it suggests, or why it can't do what was asked. */
  note: text(600),
  add: some(
    z.object({
      kind: z.preprocess((v) => (LINE_KINDS.includes(v as LineKind) ? v : 'other'), z.enum(LINE_KINDS)),
      what: words(200),
      department,
      qty: count,
      days,
      per: z.preprocess((v) => (v === 'once' ? 'once' : 'day'), z.enum(LINE_PER)),
      /** Only when the person said a price. */
      priceCents: cents,
    }),
    60
  ),
  remove: some(z.string().max(64), MAX_LINES),
  change: some(z.object({ lineId: z.string().max(64), qty: z.preprocess((v) => (v == null ? null : clamp(1, 10_000, 1)(v)), z.number().nullable()), days, discountPct: pct, priceCents: cents }), MAX_LINES),
  /** The discount on the whole quote, when asked to change it. */
  discountPct: pct,
})
export type QuoteAdvice = z.infer<typeof quoteAdvice>

// --- The JSON schemas Claude answers in ---------------------------------------
// Written out by hand: structured outputs take no lengths or ranges, so those are kept above and applied on reading.

const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const str = { type: 'string' }
const int = { type: 'integer' }
const numOrNull = { anyOf: [{ type: 'number' }, { type: 'null' }] }
const intOrNull = { anyOf: [{ type: 'integer' }, { type: 'null' }] }
const date = { type: 'string', description: 'YYYY-MM-DD, or "" when not said' }
const list = (items: unknown) => ({ type: 'array', items })
const departments = { type: 'string', enum: [...DEPARTMENTS] }

export const ENQUIRY_SCHEMA = obj({
  name: str,
  client: str,
  venue: str,
  start: date,
  end: date,
  phases: list(obj({ name: str, start: date, end: date })),
  kit: list(obj({ qty: int, what: str, department: departments })),
  crew: list(obj({ qty: int, role: str, days: numOrNull })),
  other: list(obj({ qty: int, what: str })),
  questions: list(str),
  summary: str,
})

export const ADVICE_SCHEMA = obj({
  note: str,
  add: list(obj({ kind: { type: 'string', enum: [...LINE_KINDS] }, what: str, department: departments, qty: int, days: numOrNull, per: { type: 'string', enum: [...LINE_PER] }, priceCents: intOrNull })),
  remove: list(str),
  change: list(obj({ lineId: str, qty: intOrNull, days: numOrNull, discountPct: numOrNull, priceCents: intOrNull })),
  discountPct: numOrNull,
})

// --- Suggested lines, matched and priced on the device -----------------------

/** What the device knows to match and price a suggested line: the stock list's matcher and the price list. */
export interface Pricing {
  matcher: KitMatcher
  model(id: string): { name: string; department: Department } | undefined
  productPrice(modelId: string): number | undefined
  productRate(modelId: string): RateRule | undefined
  rolePrice(role: string): number | undefined
  /** The crew roles the company has priced or booked, as written. */
  roles: readonly string[]
}

/** A line Claude suggested, as it would go on the quote, with how sure the match to the stock list is. */
export interface Suggestion {
  /** Steady for one answer, for a screen to keep choices against. */
  key: string
  kind: LineKind
  /** As Claude wrote it, from the enquiry or what was asked. */
  said: string
  what: string
  group: string
  qty: number
  /** Days charged, or the days out for a line charged by a rule. */
  days: number
  per: LinePer
  modelId: string | null
  /** How the product was found: 'name' and 'code' are sure; 'close' wants a look; 'none' isn't in the stock list. */
  how: MatchHow | 'role' | 'typed'
  /** The products most like it, best first, to choose from. */
  likely: string[]
  /** From the price list, or as the person said; undefined when there's no price yet. */
  cents: number | undefined
  rate: RateRule | null
  /** What it was charged before, on a past quote from Current RMS (ADR 0102): kept whichever product is chosen for it. */
  charged?: number
  /** Off this line alone, as that past quote had it. */
  discountPct?: number
}

/** A kit line: matched to the stock list, named and priced as the product is when it's found. */
export function kitSuggestion(p: Pricing, key: string, said: string, dept: Department, qty: number, days: number, cents?: number | null): Suggestion {
  const found = p.matcher.match(said, dept)
  const sure = found.how === 'name' || found.how === 'code' || found.how === 'chosen'
  return withModel(p, { key, kind: 'kit', said, what: said, group: DEPARTMENT_LABELS[dept], qty, days, per: 'day', modelId: null, how: found.how, likely: found.likely, cents: cents ?? undefined, rate: null }, sure ? (found.modelId ?? null) : null, cents)
}

/** The same suggestion with a product chosen for it, or none: its name, department and price follow the product. */
export function withModel(p: Pricing, s: Suggestion, modelId: string | null, said?: number | null): Suggestion {
  const m = modelId ? p.model(modelId) : undefined
  if (!m) return { ...s, modelId: null, what: s.said, cents: said ?? s.charged ?? (s.modelId ? undefined : s.cents), rate: s.charged === undefined ? null : s.rate }
  // A price charged before keeps the rule it was charged by; one from the price list takes the product's.
  if (s.charged !== undefined) return { ...s, modelId, what: m.name, group: DEPARTMENT_LABELS[m.department], cents: said ?? s.charged }
  const rate = p.productRate(modelId!)
  return { ...s, modelId, what: m.name, group: DEPARTMENT_LABELS[m.department], cents: said ?? p.productPrice(modelId!), rate: rate && rate !== 'daily' ? rate : null }
}

/** A crew line, under the company's own name for the role when it's plainly the same one. */
export function crewSuggestion(p: Pricing, key: string, said: string, qty: number, days: number, cents?: number | null): Suggestion {
  const own = p.roles.find((r) => roleKey(r) === roleKey(said)) ?? p.roles.find((r) => roleKey(r) === roleKey(said).replace(/s$/, ''))
  const role = own ?? said
  return { key, kind: 'crew', said, what: role, group: 'Crew', qty, days, per: 'day', modelId: null, how: own ? 'role' : 'typed', likely: [], cents: cents ?? p.rolePrice(role), rate: null }
}

/** Anything else, charged once unless said. */
export function otherSuggestion(key: string, said: string, qty: number, per: LinePer = 'once', days = 1, cents?: number | null): Suggestion {
  return { key, kind: 'other', said, what: said, group: '', qty, days: per === 'once' ? 1 : days, per, modelId: null, how: 'typed', likely: [], cents: cents ?? undefined, rate: null }
}

/** Every line an enquiry suggests, for the job's days unless it said otherwise. */
export function enquirySuggestions(r: EnquiryReading, p: Pricing, jobDays: number): Suggestion[] {
  return [
    ...r.kit.map((k, i) => kitSuggestion(p, `kit-${i}`, k.what, k.department, k.qty, jobDays)),
    ...r.crew.map((c, i) => crewSuggestion(p, `crew-${i}`, c.role, c.qty, c.days ?? jobDays)),
    ...r.other.map((o, i) => otherSuggestion(`other-${i}`, o.what, o.qty)),
  ].slice(0, MOST_SUGGESTED)
}

/** The lines Claude suggested adding to a quote. */
export function adviceSuggestions(a: QuoteAdvice, p: Pricing, jobDays: number): Suggestion[] {
  return a.add.map((l, i) => {
    const key = `add-${i}`
    const d = l.days ?? jobDays
    if (l.kind === 'kit') return kitSuggestion(p, key, l.what, l.department, l.qty, d, l.priceCents)
    if (l.kind === 'crew') return crewSuggestion(p, key, l.what, l.qty, d, l.priceCents)
    return otherSuggestion(key, l.what, l.qty, l.per, d, l.priceCents)
  })
}

/** A suggestion as a quote's line. One with no price goes on at nothing, where the quote counts it as a line with no price. */
export function suggestionLine(s: Suggestion, id: string): QuoteLine {
  const days = s.per === 'once' ? 1 : s.rate ? chargedFor(s.rate, s.days) : s.days
  return {
    id,
    kind: s.kind,
    what: s.what,
    ref: null,
    group: s.group,
    qty: s.qty,
    days,
    unitCents: s.cents ?? 0,
    vat: STANDARD_VAT,
    per: s.per,
    modelId: s.modelId,
    ...(s.rate && s.per === 'day' ? { rate: s.rate, out: s.days } : {}),
    ...(s.discountPct ? { discountPct: s.discountPct } : {}),
  }
}

/** The phases an enquiry gives, or one "Show" across its days; none without dates. */
export function enquiryPhases(r: EnquiryReading): { name: string; start: string; end: string }[] {
  const given = r.phases.filter((ph) => ph.start).map((ph) => ({ name: ph.name || 'Show', start: ph.start, end: ph.end && ph.end >= ph.start ? ph.end : ph.start }))
  if (given.length) return given
  if (!r.start) return []
  return [{ name: 'Show', start: r.start, end: r.end && r.end >= r.start ? r.end : r.start }]
}

/** What a change suggested to a line says, in a few words, for the card that offers it. */
export function changeWords(c: QuoteAdvice['change'][number], l: Pick<AskedLine, 'qty' | 'days' | 'discountPct' | 'unitCents'>, euro: (cents: number) => string): string {
  return [
    c.qty != null && c.qty !== l.qty ? `${l.qty} to ${c.qty}` : '',
    c.days != null && c.days !== l.days ? `${l.days} to ${c.days} days` : '',
    c.discountPct != null && c.discountPct !== l.discountPct ? `${c.discountPct}% off` : '',
    c.priceCents != null && c.priceCents !== l.unitCents ? `${euro(l.unitCents)} to ${euro(c.priceCents)}` : '',
  ]
    .filter(Boolean)
    .join(', ')
}

/** Lines Claude named that are on the quote, so a made-up id is left out; changes that change nothing are dropped too. */
export function adviceFor(a: QuoteAdvice, lines: readonly AskedLine[]): QuoteAdvice {
  const by = new Map(lines.map((l) => [l.id, l]))
  return {
    ...a,
    remove: [...new Set(a.remove.filter((id) => by.has(id)))],
    change: a.change.filter((c) => {
      const l = by.get(c.lineId)
      return !!l && !a.remove.includes(c.lineId) && changeWords(c, l, String) !== ''
    }),
  }
}

// --- Spend ---------------------------------------------------------------------

/** US dollars a million tokens in and out, by model; one not listed is counted at Opus's, the dearest here. */
export const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
}
export const DEFAULT_MODEL = 'claude-opus-5-5'

/** What one ask cost, in US cents, rounded up so the limit is never passed by rounding. */
export function costCents(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model] ?? PRICES[DEFAULT_MODEL]!
  return Math.ceil((inputTokens * p.input + outputTokens * p.output) / 10_000)
}

// --- Claude's to-do list (ADR 0097) ------------------------------------------------

/** Where an item on the to-do list opens: the job, its quote, its crew or its kit. */
export const TODO_WHERE = ['job', 'quote', 'crew', 'kit'] as const
export type TodoWhere = (typeof TODO_WHERE)[number]
/** At most this many things on one list: a morning's work, not everything there is. */
export const MOST_TODO = 12

export interface TodoItem {
  /** Steady within the list, for ticking it done. */
  key: string
  title: string
  why: string
  /** The job it's about, when it's about one the app has. */
  jobId: string | null
  where: TodoWhere
  /** When someone ticked it done, or null. */
  doneAt: string | null
}

/** One list Claude wrote: each weekday morning, or when someone asked. */
export interface TodoList {
  id: number
  madeAt: string
  how: 'morning' | 'asked'
  summary: string
  items: TodoItem[]
}

/** Where an item opens in the app. */
export function todoHref(i: Pick<TodoItem, 'jobId' | 'where'>): string {
  if (!i.jobId) return '#quotes'
  const job = `#jobs/${encodeURIComponent(i.jobId)}`
  return i.where === 'job' ? job : `${job}/${i.where}`
}

/** The list as Claude wrote it, read leniently like the rest. */
export const todoAnswer = z.object({
  summary: text(400),
  items: some(
    z.object({
      jobId: z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, 64) : ''), z.string()),
      where: z.preprocess((v) => (TODO_WHERE.includes(v as TodoWhere) ? v : 'job'), z.enum(TODO_WHERE)),
      title: words(160),
      why: words(400),
    }),
    MOST_TODO
  ),
})
export type TodoAnswer = z.infer<typeof todoAnswer>

export const TODO_SCHEMA = obj({
  summary: str,
  items: list(obj({ jobId: { type: 'string', description: 'the id of the job it is about, from the facts, or ""' }, where: { type: 'string', enum: [...TODO_WHERE] }, title: str, why: str })),
})

// --- The operations mailbox (ADR 0098) --------------------------------------------

/**
 * What a thread of email cc'd to operations@ is about, as Claude read it: a new enquiry, a job already in the app, or
 * nothing to quote. Mail not cc'd there is never seen, so leaving the address off keeps a conversation private.
 */
export const MAIL_KINDS = ['enquiry', 'job', 'other'] as const
/** The history's name for the changes Claude makes from the mailbox, where a device's code would be. */
export const CLAUDE_CLIENT = 'claude'
export type MailKind = (typeof MAIL_KINDS)[number]

/** Claude's reading of a whole thread: what it is, the job it's about, what the client wants now, and what that changes on a quote a person has changed. */
export const mailReading = z.object({
  kind: z.preprocess((v) => (MAIL_KINDS.includes(v as MailKind) ? v : 'other'), z.enum(MAIL_KINDS)),
  /** The job it's about, from those it was shown, or "". */
  jobId: z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, 64) : ''), z.string()),
  /** Everything the thread asks for so far, read as one enquiry: the later mail wins where it changes the earlier. */
  enquiry: enquiryReading,
  /** Only when the quote's lines were given: what the latest mail changes on them. */
  advice: quoteAdvice,
})
export type MailReading = z.infer<typeof mailReading>

export const MAIL_SCHEMA = obj({
  kind: { type: 'string', enum: [...MAIL_KINDS] },
  jobId: { type: 'string', description: 'the id of the job it is about, from the jobs given, or ""' },
  enquiry: ENQUIRY_SCHEMA,
  advice: ADVICE_SCHEMA,
})

/** A thread from the mailbox as the screens show it. */
export interface MailThread {
  /** Gmail's id for the thread. */
  id: string
  subject: string
  /** Who started it, as their name or address. */
  from: string
  /** When its latest mail came. */
  lastAt: string
  messages: number
  /** What Claude read it as; 'waiting' until it has. */
  kind: MailKind | 'waiting'
  projectId: string | null
  summary: string
  questions: string[]
  /** Claude made the job's draft quote from it and nobody has changed it since, so Claude keeps it up to date. */
  drafting: boolean
  /** What the latest mail changes on a quote a person has changed, to take or leave; null when there's nothing. */
  advice: QuoteAdvice | null
}

/** The operations mailbox's connection, for Admin. */
export interface MailboxStatus {
  /** The server has the Google key, so the mailbox can be connected. */
  available: boolean
  state: 'off' | 'on' | 'reconnect'
  account: string | null
  /** Why it stopped, in words, when it did. */
  problem: string | null
  connectedAt: string | null
  lookedAt: string | null
  threads: number
}
