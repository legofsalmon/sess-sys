import { z } from 'zod'
import { day } from './day.ts'
import { euroCents, needed, text } from './plain.ts'

/**
 * Light finance (ADR 0042): a price list, quotes built from a job's kit and
 * crew, and the money they come to. The app is somewhere to see the money
 * and hand it on, not a ledger: nothing is sent to a client and nothing is
 * invoiced here. The office prints a quote as a PDF and sends it
 * themselves, and records what happened after, as it happened: the
 * client's answer, the invoice they wrote elsewhere, the day it was paid,
 * and the day a freelancer was paid.
 *
 * - **Prices**: a day price for each product and each crew role, and a
 *   discount for a client. A role with no price is quoted at the rate its
 *   crew were booked at.
 * - **Quotes**: one job's, in versions. A draft is changed as often as
 *   need be; once it's marked sent (or the client's answer is recorded) it
 *   stays as it was, and a change is a new version, so what the client saw
 *   is always there to read.
 * - **Irish VAT**: each line at 23%, 13.5% or 0%, worked out per rate on
 *   the net after the discount, in whole cents.
 *
 * Money is in euro cents everywhere, as for rates, so sums never drift.
 */

const id = z.string().min(1).max(64)

export const VAT_RATES = ['23', '13.5', '0'] as const
export type VatRate = (typeof VAT_RATES)[number]
export const VAT_LABELS: Record<VatRate, string> = { '23': '23%', '13.5': '13.5%', '0': '0%' }
/** The standard rate, for anything not said otherwise. 13.5% is for the few things Revenue puts at the reduced rate. */
export const STANDARD_VAT: VatRate = '23'
const PERCENT: Record<VatRate, number> = { '23': 23, '13.5': 13.5, '0': 0 }

/** What a line is: kit from the job's kit lines, crew from its calls, or anything else typed in (transport, a delivery). */
export const LINE_KINDS = ['kit', 'crew', 'other'] as const
export type LineKind = (typeof LINE_KINDS)[number]

/** A quote has room for this many lines: more than any job's kit and crew. */
export const MAX_LINES = 300

const DAYS_HINT = 'Days charged is a number of days, in halves, from 0.5 to 365.'
const lineDays = z
  .number({ invalid_type_error: DAYS_HINT, required_error: DAYS_HINT })
  .min(0.5, DAYS_HINT)
  .max(365, DAYS_HINT)
  .refine((n) => Number.isInteger(n * 2), DAYS_HINT)
const QTY_HINT = 'How many is a whole number from 1 to 10,000.'
const lineQty = z.number({ invalid_type_error: QTY_HINT, required_error: QTY_HINT }).int(QTY_HINT).min(1, QTY_HINT).max(10_000, QTY_HINT)
const DISCOUNT_HINT = 'A discount is a percentage from 0 to 100, such as 10 or 12.5.'
export const discountPct = z
  .number({ invalid_type_error: DISCOUNT_HINT, required_error: DISCOUNT_HINT })
  .min(0, DISCOUNT_HINT)
  .max(100, DISCOUNT_HINT)
  .refine((n) => Number.isInteger(n * 10), DISCOUNT_HINT)
/** A day price, up to what any one thing could cost a day. */
const dayPrice = euroCents(100_000_00, 'A day price')

export const quoteLine = z.object({
  id,
  kind: z.enum(LINE_KINDS),
  /** What the client reads: "d&b Y10P", "Audio tech (Show)", "Van and driver". */
  what: needed(200, 'What a line is for', 'What each line is for'),
  /** The product or crew call it was built from; null for one typed in. */
  ref: id.nullable(),
  /** Where it's listed on the quote: the kit's department, "Crew", or "Other". */
  group: text(60, 'The group'),
  qty: lineQty,
  /** Days charged: the days it's out or worked, unless the office charges fewer (a week for three, say). */
  days: lineDays,
  /** The price for one, for a day. */
  unitCents: dayPrice,
  vat: z.enum(VAT_RATES),
})
export type QuoteLine = z.infer<typeof quoteLine>

/** A draft, still being put together; sent to the client; or answered by them. */
export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Turned down' }

export interface Quote {
  id: string
  projectId: string
  /** 1, 2, 3…: given by the server in the order they're started, one job's at a time. */
  version: number
  status: QuoteStatus
  lines: QuoteLine[]
  /** Off everything, as a percentage: the client's usual discount when the quote was started, unless changed. */
  discountPct: number
  /** For the client, printed under the lines: what's included, how long the prices hold. */
  notes: string
  /** When it was first saved, and last changed. */
  madeAt: string
  savedAt: string
  /** The day the office marked it sent: they send it themselves. */
  sentOn: string | null
  /** The day the client's answer was recorded. */
  answeredOn: string | null
  /** The invoice the office wrote for it, elsewhere: the day, and its number as they wrote it. */
  invoicedOn: string | null
  invoiceRef: string
  paidOn: string | null
}

/** A product's price for a day, by the product's id. */
export interface ProductPrice {
  id: string
  dayCents: number
}

/** A crew role's price for a day, by the role as `roleKey` writes it, with the role as it was typed. */
export interface RolePrice {
  id: string
  role: string
  dayCents: number
}

/** A client's usual discount, by the client's id. */
export interface ClientDiscount {
  id: string
  pct: number
}

/** When a freelancer was paid for an approved timesheet, by the timesheet's id (its booking's). */
export interface CostPaid {
  id: string
  paidOn: string
}

export interface QuoteEntities {
  quote: Quote
  productPrice: ProductPrice
  rolePrice: RolePrice
  clientDiscount: ClientDiscount
  costPaid: CostPaid
}
/**
 * Money's records. A role that can't see money (ADR 0042) is sent none of
 * them, so they never reach its phone: the server leaves them out of its
 * change feed.
 */
export const QUOTE_ENTITY_NAMES = ['quote', 'productPrice', 'rolePrice', 'clientDiscount', 'costPaid'] as const
export const MONEY_ENTITY_NAMES: readonly string[] = QUOTE_ENTITY_NAMES

/** The same role however it's typed: "Audio Tech " and "audio tech" are one price. */
export const roleKey = (role: string) => role.trim().replace(/\s+/g, ' ').toLowerCase()

const lines = z.array(quoteLine).max(MAX_LINES, `A quote has room for ${MAX_LINES} lines.`)
const answer = z.enum(['accepted', 'declined', 'none'])

export const quoteCommandSchemas = {
  /**
   * Start a new version of a job's quote, or change its draft: every line,
   * the discount and the notes at once, as the screen has them. The server
   * numbers a new one.
   */
  'quote.save': z.object({ id, projectId: id, lines, discountPct, notes: text(2000, 'The notes for the client') }),
  /** The office sent it to the client themselves (the app sends nothing): from now on it stays as it is. */
  'quote.sent': z.object({ id, on: day }),
  /** What the client said, as the office heard it, or "none" to take a mistaken answer back. */
  'quote.answer': z.object({ id, answer, on: day }),
  /** The invoice for an accepted quote, written outside the app: the day and its number, or null to take it back. */
  'quote.invoiced': z.object({ id, on: day.nullable(), ref: text(60, 'The invoice number') }),
  /** The day an invoiced quote was paid, or null to take it back. */
  'quote.paid': z.object({ id, on: day.nullable() }),
  /** A product's day price; null takes it off the price list. */
  'price.product': z.object({ modelId: id, dayCents: dayPrice.nullable() }),
  /** A crew role's day price; null quotes it at its booked rate again. */
  'price.role': z.object({ role: needed(100, 'The role', 'A role'), dayCents: dayPrice.nullable() }),
  /** A client's usual discount; null for none. */
  'price.client': z.object({ clientId: id, pct: discountPct.nullable() }),
  /** The day a freelancer was paid for an approved timesheet, or null to take it back. */
  'cost.paid': z.object({ id, on: day.nullable() }),
} as const

// The sums.

/** A line's amount: how many, for how many days, at the price for one a day, to the cent. */
export const lineCents = (l: Pick<QuoteLine, 'qty' | 'days' | 'unitCents'>) => Math.round(l.qty * l.days * l.unitCents)

export interface RateTotal {
  rate: VatRate
  /** The lines at this rate, before the discount. */
  before: number
  discount: number
  net: number
  vat: number
  gross: number
}

export interface QuoteTotals {
  /** Every line, before the discount. */
  subtotal: number
  discount: number
  net: number
  vat: number
  gross: number
  /** By VAT rate, in the order of VAT_RATES, only the rates that have lines. */
  rates: RateTotal[]
}

/**
 * What a quote comes to. The discount comes off each rate's lines, and the
 * VAT is worked out on what's left at that rate, each to the cent, as an
 * invoice has it; the totals are the sums of those, so they always add up.
 */
export function quoteTotals(q: { lines: readonly Pick<QuoteLine, 'qty' | 'days' | 'unitCents' | 'vat'>[]; discountPct: number }): QuoteTotals {
  const rates: RateTotal[] = []
  for (const rate of VAT_RATES) {
    const at = q.lines.filter((l) => l.vat === rate)
    if (!at.length) continue
    const before = at.reduce((sum, l) => sum + lineCents(l), 0)
    const discount = Math.round((before * q.discountPct) / 100)
    const net = before - discount
    const vat = Math.round((net * PERCENT[rate]) / 100)
    rates.push({ rate, before, discount, net, vat, gross: net + vat })
  }
  const sum = (k: keyof Omit<RateTotal, 'rate'>) => rates.reduce((s, r) => s + r[k], 0)
  return { subtotal: sum('before'), discount: sum('discount'), net: sum('net'), vat: sum('vat'), gross: sum('gross'), rates }
}

/** "€1,250.00": always to the cent, as a quote and an invoice write it. */
export function money(cents: number): string {
  const sign = cents < 0 ? '−' : ''
  return `${sign}€${(Math.abs(cents) / 100).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** "1 day", "1.5 days", "3 days". */
export const daysWord = (n: number) => `${n.toLocaleString('en-IE')} day${n === 1 ? '' : 's'}`

/** "12.5%". */
export const pctWord = (n: number) => `${n.toLocaleString('en-IE')}%`

// Building a quote from a job.

/** A kit line as a quote needs it. */
export interface KitToQuote {
  id: string
  modelId: string
  name: string
  /** The department's name, as the quote lists it: "Audio". */
  group: string
  /** The phase it's for, when it isn't the whole job. */
  phase?: string
  qty: number
  /** The days it's out on: its phase's, or the whole job's. */
  days: number
}

/** A crew call as a quote needs it. */
export interface CrewToQuote {
  id: string
  role: string
  phase?: string
  needed: number
  days: number
  /** The rate its crew were asked for at, which it's quoted at with no price for the role. */
  bookedCents: number | null
}

export interface PriceList {
  product(modelId: string): number | undefined
  role(role: string): number | undefined
}

/**
 * A job's kit and crew as quote lines, each at its price for a day and for
 * the days it's out or worked, at the standard rate. A product with no
 * price is put in at nothing, for the office to price: the quote shows it,
 * rather than leaving it out. A role with no price is at its booked rate.
 */
export function linesFor(kit: readonly KitToQuote[], crew: readonly CrewToQuote[], prices: PriceList, newId: () => string): QuoteLine[] {
  const what = (name: string, phase?: string) => (phase ? `${name} (${phase})` : name)
  return [
    ...kit.map(
      (k): QuoteLine => ({
        id: newId(),
        kind: 'kit',
        what: what(k.name, k.phase).slice(0, 200),
        ref: k.id,
        group: k.group,
        qty: k.qty,
        days: Math.max(1, k.days),
        unitCents: prices.product(k.modelId) ?? 0,
        vat: STANDARD_VAT,
      })
    ),
    ...crew.map(
      (c): QuoteLine => ({
        id: newId(),
        kind: 'crew',
        what: what(c.role, c.phase).slice(0, 200),
        ref: c.id,
        group: 'Crew',
        qty: c.needed,
        days: Math.max(1, c.days),
        unitCents: prices.role(c.role) ?? c.bookedCents ?? 0,
        vat: STANDARD_VAT,
      })
    ),
  ]
}

/** The groups a quote lists its lines under, in its order: kit by department first, then crew, then anything else. */
export function linesByGroup<L extends Pick<QuoteLine, 'kind' | 'group'>>(lines: readonly L[]): { group: string; lines: L[] }[] {
  const order = (l: L) => (l.kind === 'kit' ? 0 : l.kind === 'crew' ? 1 : 2)
  const out: { group: string; lines: L[]; at: number }[] = []
  for (const l of lines) {
    const group = l.group || (l.kind === 'crew' ? 'Crew' : l.kind === 'other' ? 'Other' : 'Kit')
    let g = out.find((x) => x.group === group)
    if (!g) out.push((g = { group, lines: [], at: order(l) }))
    g.lines.push(l)
  }
  return out.sort((a, b) => a.at - b.at).map(({ group, lines }) => ({ group, lines }))
}

// VAT periods and the accountant's files.

/**
 * Revenue's VAT periods are two months, January and February first. The
 * one a day falls in: "2026-09", for September and October 2026.
 */
export function vatPeriodOf(d: string): { key: string; start: string; end: string; label: string } {
  const y = Number(d.slice(0, 4))
  const m = Number(d.slice(5, 7))
  const first = m % 2 === 1 ? m : m - 1
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = new Date(Date.UTC(y, first + 1, 0)).getUTCDate()
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return {
    key: `${y}-${pad(first)}`,
    start: `${y}-${pad(first)}-01`,
    end: `${y}-${pad(first + 1)}-${pad(lastDay)}`,
    label: `${names[first - 1]}–${names[first]} ${y}`,
  }
}

/** The month a day is in, for the money view: "2026-10", "October 2026". */
export function moneyMonth(d: string): { key: string; label: string } {
  const date = new Date(`${d.slice(0, 7)}-01T12:00:00Z`)
  return { key: d.slice(0, 7), label: date.toLocaleDateString('en-IE', { month: 'long', year: 'numeric', timeZone: 'UTC' }) }
}

/**
 * Text a spreadsheet would run as a formula (=, +, -, @ first) gets a '
 * in front, as the download of everything does; a plain number, negative
 * or not, is left alone.
 */
function spreadsheetSafe(cell: string): string {
  if (/^[=@\t\r]/.test(cell) || (/^[+-]/.test(cell) && !/^[+-][\d\s().,+-]*$/.test(cell))) return `'${cell}`
  return cell
}

/** A CSV file as Excel opens it: UTF-8 with its mark, so Seán comes through, and lines ending CR LF. */
export function csvText(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) =>
    cells
      .map(spreadsheetSafe)
      .map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
      .join(',')
  return `﻿${[header, ...rows].map(line).join('\r\n')}\r\n`
}

/** Cents as an accountant's spreadsheet wants a sum: 1250.00, with no euro sign. */
export const amount = (cents: number) => (cents / 100).toFixed(2)
