import { z } from 'zod'
import { blankRecord, parseCsv } from './csv.ts'
import { tidyDepartment } from './crew.ts'
import { day, isDay } from './day.ts'
import { needed, text } from './plain.ts'

/**
 * The purchase list (ADR 0077): kit the crew ask the company to buy, open
 * to everyone signed in, each with the votes of those who'd find it most
 * useful. Anyone with an account can ask for something and vote; the
 * office, heads of department and directors say where each one is at
 * (agreed, ordered, arrived, or not buying), and those who asked can
 * change or take back their own. It took the place of the crew's WhatsApp
 * group, whose requests came in as a list (purchase.bringIn).
 *
 * Nothing here orders anything, or tells anyone outside the app: who asked
 * hears where it's at in their Notifications, in the app only (ADR 0048).
 */

/** Where a request is at, in the order it goes. */
export const PURCHASE_STATUSES = ['asked', 'agreed', 'ordered', 'arrived', 'no'] as const
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number]

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  asked: 'Asked for',
  agreed: 'Agreed',
  ordered: 'Ordered',
  arrived: 'Arrived',
  no: 'Not buying',
}

/** What each means, where it's chosen. */
export const PURCHASE_STATUS_LINES: Record<PurchaseStatus, string> = {
  asked: 'Waiting for someone to decide.',
  agreed: "We'll buy it: not ordered yet.",
  ordered: 'Ordered, on its way.',
  arrived: "It's here, or we had it already.",
  no: "We won't buy it, for now.",
}

/** Still to decide or to buy: what the list is ranked by votes for. */
export const PURCHASE_OPEN: readonly PurchaseStatus[] = ['asked', 'agreed']
/** Settled: arrived or not buying. */
export const PURCHASE_SETTLED: readonly PurchaseStatus[] = ['arrived', 'no']

export const PURCHASE_TITLE_LENGTH = 200
export const PURCHASE_DETAILS_LENGTH = 2000
export const PURCHASE_NOTES_LENGTH = 2000
export const PURCHASE_LINK_LENGTH = 2000

/** A request, as devices keep it. */
export interface PurchaseRequest {
  id: string
  /** What to buy, in a few words: "NL4T connectors". */
  title: string
  /** How many, and anything else whoever asked said about it. */
  details: string
  /** A link to the product, or empty. */
  link: string
  /** The department it's for, as the Crew tab spells them, or null. */
  department: string | null
  /** Who asked, when they're on the Crew tab; null otherwise. */
  askedBy: string | null
  /** Their name as it was given, for someone brought in who isn't on the Crew tab; empty when askedBy says who. */
  askedByName: string
  /** The day it was asked for. */
  askedOn: string
  status: PurchaseStatus
  /** The office's notes on where it's at: "Ordered from Thomann, due Friday". */
  notes: string
}

/** One person's vote for a request: one each, kept by both ids together. */
export interface PurchaseVote {
  id: string
  requestId: string
  personId: string
}

export interface PurchaseEntities {
  purchaseRequest: PurchaseRequest
  purchaseVote: PurchaseVote
}
export const PURCHASE_ENTITY_NAMES = ['purchaseRequest', 'purchaseVote'] as const

/** One record a vote, so a vote from two devices, or twice from one, is the same vote. */
export const voteId = (requestId: string, personId: string) => `${requestId}.${personId}`

const id = z.string().min(1).max(64)

/** A link as typed: empty, or a web address. "thomann.de/…" gets its https:// put in front. */
export function cleanLink(s: string): string {
  const t = s.trim()
  if (!t) return ''
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}

const link = z
  .string()
  .transform((s) => cleanLink(s))
  .pipe(
    z
      .string()
      .max(PURCHASE_LINK_LENGTH, `The link can be up to ${PURCHASE_LINK_LENGTH.toLocaleString('en-IE')} characters.`)
      .refine((s) => s === '' || /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(s), "The link isn't a web address. Copy it from the shop's page.")
  )

/** A department as typed, tidied as the Crew tab tidies them (null for none). */
const department = z
  .string()
  .max(100, 'A department can be up to 100 characters.')
  .nullable()
  .transform((s) => (s === null ? null : tidyDepartment(s)))

const title = z
  .string()
  .transform((s) => s.trim())
  .pipe(needed(PURCHASE_TITLE_LENGTH, 'What to buy', 'What to buy'))
const details = text(PURCHASE_DETAILS_LENGTH, 'How many and details').transform((s) => s.trim())
const notes = text(PURCHASE_NOTES_LENGTH, 'The notes').transform((s) => s.trim())

/** A request as a list brings it in: who asked, on which day, and where it's at already. */
const broughtIn = z.object({
  id,
  title,
  details,
  link,
  department,
  askedBy: id.nullable(),
  askedByName: text(200, 'A name').transform((s) => s.trim()),
  askedOn: day,
  status: z.enum(PURCHASE_STATUSES),
  notes,
})
export type BroughtInPurchase = z.output<typeof broughtIn>

export const purchaseCommandSchemas = {
  /** Ask for something to be bought. `by` is who asks, as the device knows them, for a copy with sign-in off; signed in, the server knows. */
  'purchase.ask': z.object({ id, title, details, link, department, by: id.nullable().optional() }),
  /** Change what was asked for: whoever asked, or anyone who can change stock. Only what's said changes. */
  'purchase.update': z
    .object({ id, title: title.optional(), details: details.optional(), link: link.optional(), department: department.optional() })
    .refine((a) => a.title !== undefined || a.details !== undefined || a.link !== undefined || a.department !== undefined, { message: 'Nothing to change.' }),
  /** Say where it's at, with a note: the office's, heads' and directors'. */
  'purchase.status': z.object({ id, status: z.enum(PURCHASE_STATUSES), notes }),
  /** Take a request off the list, and its votes with it. */
  'purchase.remove': z.object({ id }),
  /** Vote for a request, or take the vote back. `by` as for asking. */
  'purchase.vote': z.object({ requestId: id, vote: z.boolean(), by: id.nullable().optional() }),
  /** A list of requests brought in at once, from a spreadsheet: one already in the app is left as it is. */
  'purchase.bringIn': z.object({ requests: z.array(broughtIn).min(1, 'There is nothing to bring in.').max(1000, 'Up to 1,000 requests can come in at once.') }),
} as const

/** Whoever asked may change or take back their own; changing someone else's is for those who change stock. */
export const PURCHASE_NOT_YOURS = 'You can change only a request you made. Ask the office or a head of department to change this one.'
/** A vote needs to know who is voting. */
export const PURCHASE_WHO = "Your account isn't on the Crew tab, so the app can't tell whose vote it is. Ask the office to add you."

// Bringing a list in --------------------------------------------------------

/** The headings a list can have, each in a few spellings, lower case. */
const HEADINGS: Record<keyof PurchaseListFields, readonly string[]> = {
  askedOn: ['asked on', 'date', 'day', 'when'],
  askedBy: ['asked by', 'who', 'name', 'requested by', 'from'],
  title: ['what', 'item', 'title', 'request', 'what to buy'],
  details: ['how many and details', 'details', 'how many', 'quantity', 'qty'],
  link: ['link', 'url', 'web'],
  department: ['department', 'dept'],
  status: ["where it's at", 'where it’s at', 'status', 'state'],
  notes: ['notes', 'note', 'replies'],
}

interface PurchaseListFields {
  askedOn: string
  askedBy: string
  title: string
  details: string
  link: string
  department: string
  status: string
  notes: string
}

/** A row of a list as the app read it, with anything it couldn't read said in words. */
export interface PurchaseListRow extends PurchaseListFields {
  /** The line in the file, counting the headings as 1. */
  row: number
  /** The id it comes in with: the same each time the same row is brought in, so a second time adds nothing. */
  id: string
  status: PurchaseStatus
  problems: string[]
}

/** "22/04/2026", "2026-04-22" or "22.4.26", as a day; undefined when it isn't one. */
export function readDay(s: string): string | undefined {
  const t = s.trim().replace(/[ ,T].*$/, '')
  if (isDay(t)) return t
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t)
  if (!m) return undefined
  const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!
  const d = `${year}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
  return isDay(d) ? d : undefined
}

/** A status as a list says it, in its label or its own word; undefined when it's none of them. */
export function readStatus(s: string): PurchaseStatus | undefined {
  const t = s.trim().toLowerCase().replace(/’/g, "'")
  if (!t) return 'asked'
  for (const st of PURCHASE_STATUSES) if (t === st || t === PURCHASE_STATUS_LABELS[st].toLowerCase()) return st
  if (/^(requested|asked|open|new|to buy)$/.test(t)) return 'asked'
  if (/^(approved|yes|agreed|to order)$/.test(t)) return 'agreed'
  if (/^(bought|on order|ordered)$/.test(t)) return 'ordered'
  if (/^(in|here|received|done|arrived|have it)$/.test(t)) return 'arrived'
  if (/^(no|not buying|declined|rejected|not needed)$/.test(t)) return 'no'
  return undefined
}

/** A short hash of the row's day, name and what, in base 36: the same row always has the same id. */
function rowHash(s: string): string {
  // FNV-1a, twice over with different seeds, for 2 × 32 bits.
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x9e3779b9
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x01000193 + 2) >>> 0
  }
  return a.toString(36).padStart(7, '0') + b.toString(36).padStart(7, '0')
}

/** The id a row of a list comes in with. */
export const broughtInId = (askedOn: string, askedBy: string, title: string) =>
  `buy-${rowHash([askedOn, askedBy.trim().toLowerCase(), title.trim().toLowerCase()].join('\n'))}`

/**
 * A purchase list from a spreadsheet saved as .csv, with headings in its
 * first line: What, and any of Asked on, Asked by, How many and details,
 * Link, Department, Where it's at and Notes. Each row is read, and what
 * can't be read said beside it; nothing is refused here but a file with
 * no What column.
 */
export function readPurchaseList(textOfFile: string): { rows: PurchaseListRow[]; problem?: string } {
  const commas = parseCsv(textOfFile)
  const semicolons = parseCsv(textOfFile, ';')
  // A spreadsheet saved where a comma is the decimal mark splits by semicolons.
  const records = (semicolons[0]?.length ?? 0) > (commas[0]?.length ?? 0) ? semicolons : commas
  const head = (records[0] ?? []).map((h) => h.trim().toLowerCase().replace(/’/g, "'"))
  const at = Object.fromEntries(
    (Object.keys(HEADINGS) as (keyof PurchaseListFields)[]).map((k) => [k, head.findIndex((h) => HEADINGS[k].some((w) => w.replace(/’/g, "'") === h))])
  ) as Record<keyof PurchaseListFields, number>
  if (at.title < 0) return { rows: [], problem: 'The first line needs a heading “What”, over the column saying what to buy.' }
  const rows: PurchaseListRow[] = []
  records.slice(1).forEach((record, i) => {
    if (blankRecord(record)) return
    const cell = (k: keyof PurchaseListFields) => (at[k] >= 0 ? (record[at[k]] ?? '').trim() : '')
    const problems: string[] = []
    const fields = Object.fromEntries((Object.keys(HEADINGS) as (keyof PurchaseListFields)[]).map((k) => [k, cell(k)])) as unknown as PurchaseListFields
    if (!fields.title) problems.push('It says nothing under What.')
    else if (fields.title.length > PURCHASE_TITLE_LENGTH) problems.push(`What to buy can be up to ${PURCHASE_TITLE_LENGTH} characters.`)
    if (fields.details.length > PURCHASE_DETAILS_LENGTH) problems.push(`How many and details can be up to ${PURCHASE_DETAILS_LENGTH.toLocaleString('en-IE')} characters.`)
    if (fields.notes.length > PURCHASE_NOTES_LENGTH) problems.push(`The notes can be up to ${PURCHASE_NOTES_LENGTH.toLocaleString('en-IE')} characters.`)
    const askedOn = fields.askedOn ? readDay(fields.askedOn) : undefined
    if (fields.askedOn && !askedOn) problems.push(`“${fields.askedOn}” isn't a date: write it as 22/04/2026.`)
    const status = readStatus(fields.status)
    if (!status) problems.push(`“${fields.status}” isn't one of ${PURCHASE_STATUSES.map((s) => PURCHASE_STATUS_LABELS[s]).join(', ')}.`)
    const linked = link.safeParse(fields.link)
    if (!linked.success) problems.push(linked.error.issues[0]!.message)
    const row = i + 2
    rows.push({
      ...fields,
      askedOn: askedOn ?? '',
      link: linked.success ? linked.data : fields.link,
      row,
      id: broughtInId(askedOn ?? '', fields.askedBy, fields.title),
      status: status ?? 'asked',
      problems,
    })
  })
  if (rows.length === 0) return { rows, problem: 'The file has headings but no rows under them.' }
  return { rows }
}

/** Someone a name could be: the Crew tab's people, as the bring-in matches them. */
export interface AskerCandidate {
  id: string
  name: string
  knownAs?: string | null
  firstName?: string | null
  archived?: boolean
}

/**
 * Who on the Crew tab a name from a list is, when only one person fits:
 * their whole name, the name they're known as, or a first name only one
 * person has. "Smokie" is whoever is known as Smokie, and "Glenn" the
 * only Glenn; "Glenn Stankard" is never Glenn Byrne. Undefined when nobody,
 * or more than one, fits: the office chooses.
 */
export function matchAsker<P extends AskerCandidate>(name: string, people: readonly P[]): P | undefined {
  const said = name.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!said) return undefined
  const live = people.filter((p) => !p.archived)
  const only = (fits: (p: P) => boolean) => {
    const found = live.filter(fits)
    return found.length === 1 ? found[0] : undefined
  }
  const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const first = (p: P) => lower(p.firstName) || lower(p.name).split(' ')[0]!
  return (
    only((p) => lower(p.name) === said) ??
    only((p) => !!lower(p.knownAs) && lower(p.knownAs) === said) ??
    (said.includes(' ') ? undefined : only((p) => first(p) === said))
  )
}
