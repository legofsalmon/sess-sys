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

/** How a line is charged: so much a day for the days charged, or once. */
export const LINE_PER = ['day', 'once'] as const
export type LinePer = (typeof LINE_PER)[number]

/**
 * How a product's price turns the days it's out into what's charged (ADR 0085), as Current RMS's three rate
 * definitions do: by the day; a "3 Day Week", where a week out is charged as three days at most; or by the week,
 * where the price is for a week and anything up to seven days is charged once.
 */
export const RATE_RULES = ['daily', 'week3', 'weekly'] as const
export type RateRule = (typeof RATE_RULES)[number]
export const RATE_LABELS: Record<RateRule, string> = { daily: 'Daily', week3: '3 Day Week', weekly: 'Weekly' }
/** What the price is for, as a line says it: "€55.00 a day", "€120.00 a week". */
export const RATE_UNIT: Record<RateRule, 'day' | 'week'> = { daily: 'day', week3: 'day', weekly: 'week' }

/** What's charged for so many days out under a rule: days for Daily and 3 Day Week, weeks for Weekly. */
export function chargedFor(rule: RateRule, out: number): number {
  const days = Math.max(0.5, out)
  if (rule === 'weekly') return Math.ceil(days / 7)
  if (rule === 'week3') return 3 * Math.floor(days / 7) + Math.min(3, Math.ceil(days % 7))
  return days
}

/** The lines a quote works out for itself (ADR 0086). */
export const LINE_EXTRAS = ['travel', 'subsistence'] as const
export type LineExtra = (typeof LINE_EXTRAS)[number]

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
const LINE_DISCOUNT_HINT = 'A line’s discount is a percentage from 0 to 100, such as 30 or 12.5.'
const lineDiscount = z
  .number({ invalid_type_error: LINE_DISCOUNT_HINT })
  .min(0, LINE_DISCOUNT_HINT)
  .max(100, LINE_DISCOUNT_HINT)
  .refine((n) => Number.isInteger(n * 10), LINE_DISCOUNT_HINT)
const OUT_HINT = 'Days out is a number of days, in halves, from 0.5 to 365.'
const lineOut = z
  .number({ invalid_type_error: OUT_HINT })
  .min(0.5, OUT_HINT)
  .max(365, OUT_HINT)
  .refine((n) => Number.isInteger(n * 2), OUT_HINT)

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
  /** The price for one, for a day, or for the whole job when it's charged once. */
  unitCents: dayPrice,
  vat: z.enum(VAT_RATES),
  /**
   * Charged by the day (kit, crew), or once (delivery, transport, things sold). Left out by the app before it, which
   * meant by the day. A line charged once keeps 1 for its days, so a device from before reads the same amount.
   */
  per: z.enum(LINE_PER).optional(),
  /** The product a kit line is for, when it's one from the stock list: built from the job or picked on the quote. */
  modelId: id.nullable().optional(),
  /**
   * The product's rate rule (ADR 0085), for a line charged by it: `days` is then what the rule makes of `out`, the days
   * it's out, unless changed by hand. Under Weekly, `days` counts weeks and the price is for a week.
   */
  rate: z.enum(RATE_RULES).optional(),
  out: lineOut.optional(),
  /** Off this line alone, as a percentage, before any discount off the whole quote. */
  discountPct: lineDiscount.optional(),
  /**
   * A line the quote works out for itself (ADR 0086): the crew's travel to a venue far from Dublin, or their
   * subsistence. Worked out again on a draft whenever what it comes from changes, so it's never typed.
   */
  extra: z.enum(LINE_EXTRAS).optional(),
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
  /**
   * The quote's number (ADR 0084): the job's own, the same on every version, given by the server when the first version is
   * marked sent. None while it's only ever been a draft, and none on a quote sent before numbers.
   */
  number?: number | null
  /** How many days the prices hold from the day it's sent: 30 unless changed. */
  validDays?: number
  /** A deposit asked for before the job, as a percentage of the total with VAT; none unless set. */
  depositPct?: number | null
  /**
   * The price agreed before VAT, in cents (ADR 0085), in place of a discount percentage: the discount off the whole is
   * then whatever brings the lines to it. None unless agreed.
   */
  agreedCents?: number | null
  /** The job gives the crew their meals (ADR 0086), so no subsistence is charged. */
  mealsProvided?: boolean
  /** How far the venue is from Dublin city centre by road, each way, in km, as the office typed it; none takes it from the map. */
  travelKm?: number | null
}

/** Prices hold this long unless the quote says otherwise. */
export const DEFAULT_VALID_DAYS = 30

/**
 * What every printed quote says that isn't about the job (ADR 0084): the number the next one gets, the company's terms
 * and its bank details. One record, with the id "quoting". Money's, so only those who see money are sent it.
 */
export interface QuoteSettings {
  id: string
  /** The number the next quote gets; none set means one more than the highest given, or 1. */
  nextNumber: number | null
  terms: string
  bank: string
  /**
   * Travel and subsistence (ADR 0086): travel is charged on a job further than `travelFromKm` from Dublin city centre,
   * at the fuel a vehicle uses there and back; subsistence is so much a day for each of the crew. Left out by a
   * server from before them; a price not set yet is null, and that line isn't charged until it is.
   */
  travelFromKm?: number
  fuelCentsPerLitre?: number | null
  litresPer100Km?: number
  perDiemCents?: number | null
  /** The day the fuel price was last set, so the office can see when it wants checking. */
  fuelSetOn?: string | null
  /** Whether the server takes each new month's price from the AA's survey by itself; on unless turned off. */
  fuelAuto?: boolean
  /** The AA survey the fuel price came from, "October 2026"; null for one typed in. */
  fuelMonth?: string | null
  /** How many of the crew share a car to a job (ADR 0086): each car load is a trip. One unless set. */
  crewPerCar?: number
}
export const QUOTE_SETTINGS_ID = 'quoting'

/** A product's price for a day, by the product's id. */
export interface ProductPrice {
  id: string
  dayCents: number
  /** How the price is charged (ADR 0085); Daily unless set. Under Weekly, `dayCents` is the price for a week. */
  rate?: RateRule
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
  quoteSettings: QuoteSettings
}
/**
 * Money's records. A role that can't see money (ADR 0042) is sent none of
 * them, so they never reach its phone: the server leaves them out of its
 * change feed.
 */
export const QUOTE_ENTITY_NAMES = ['quote', 'productPrice', 'rolePrice', 'clientDiscount', 'costPaid', 'quoteSettings'] as const
export const MONEY_ENTITY_NAMES: readonly string[] = QUOTE_ENTITY_NAMES

/** The same role however it's typed: "Audio Tech " and "audio tech" are one price. */
export const roleKey = (role: string) => role.trim().replace(/\s+/g, ' ').toLowerCase()

const lines = z.array(quoteLine).max(MAX_LINES, `A quote has room for ${MAX_LINES} lines.`)
const answer = z.enum(['accepted', 'declined', 'none'])
const VALID_HINT = 'Prices hold for a whole number of days from 1 to 365.'
const validDays = z.number({ invalid_type_error: VALID_HINT }).int(VALID_HINT).min(1, VALID_HINT).max(365, VALID_HINT)
const DEPOSIT_HINT = 'A deposit is a whole percentage from 1 to 100, such as 25 or 50.'
const depositPct = z.number({ invalid_type_error: DEPOSIT_HINT }).int(DEPOSIT_HINT).min(1, DEPOSIT_HINT).max(100, DEPOSIT_HINT)
/** Up to eight figures, as Current RMS's are padded to ten. */
export const MAX_QUOTE_NUMBER = 99_999_999
const NUMBER_HINT = `A quote number is a whole number from 1 to ${MAX_QUOTE_NUMBER.toLocaleString('en-IE')}.`
const quoteNumber = z.number({ invalid_type_error: NUMBER_HINT }).int(NUMBER_HINT).min(1, NUMBER_HINT).max(MAX_QUOTE_NUMBER, NUMBER_HINT)
/** A price agreed for the whole quote, before VAT. */
const agreedCents = euroCents(10_000_000_00, 'The price agreed')
const CAR_HINT = 'How many share a car is a whole number from 1 to 8.'
const KM_HINT = 'The distance is a whole number of km from 0 to 2,000.'
const travelKm = z.number({ invalid_type_error: KM_HINT }).int(KM_HINT).min(0, KM_HINT).max(2000, KM_HINT)
const FROM_HINT = 'Travel starts at a whole number of km from 0 to 1,000.'
const FUEL_HINT = 'The fuel price is in cent a litre, from 50 to 500, such as 174.9.'
const fuelPrice = z.number({ invalid_type_error: FUEL_HINT }).min(50, FUEL_HINT).max(500, FUEL_HINT).refine((n) => Number.isInteger(Math.round(n * 1000) / 100), FUEL_HINT)
const USE_HINT = 'What a vehicle uses is in litres for 100 km, from 1 to 40, such as 9.5.'
const fuelUse = z.number({ invalid_type_error: USE_HINT }).min(1, USE_HINT).max(40, USE_HINT).refine((n) => Number.isInteger(Math.round(n * 1000) / 100), USE_HINT)
/** The company's terms, printed under every quote. */
export const TERMS_LENGTH = 4000

export const quoteCommandSchemas = {
  /**
   * Start a new version of a job's quote, or change its draft: every line,
   * the discount and the notes at once, as the screen has them. The server
   * numbers a new one.
   */
  'quote.save': z.object({
    id,
    projectId: id,
    lines,
    discountPct,
    notes: text(2000, 'The notes for the client'),
    // Optional, so a save from an app older than them leaves them as they were (ADR 0084).
    validDays: validDays.optional(),
    depositPct: depositPct.nullable().optional(),
    agreedCents: agreedCents.nullable().optional(),
    // Travel and subsistence (ADR 0086), left as they were by a save from an app older than them.
    mealsProvided: z.boolean().optional(),
    travelKm: travelKm.nullable().optional(),
  }),
  /** The office sent it to the client themselves (the app sends nothing): from now on it stays as it is. */
  'quote.sent': z.object({ id, on: day }),
  /** What the client said, as the office heard it, or "none" to take a mistaken answer back. */
  'quote.answer': z.object({ id, answer, on: day }),
  /** The invoice for an accepted quote, written outside the app: the day and its number, or null to take it back. */
  'quote.invoiced': z.object({ id, on: day.nullable(), ref: text(60, 'The invoice number') }),
  /** The day an invoiced quote was paid, or null to take it back. */
  'quote.paid': z.object({ id, on: day.nullable() }),
  /**
   * What every printed quote says (ADR 0084): the number the next quote gets (null to carry on from the highest given),
   * the company's terms and its bank details.
   */
  'quoting.update': z.object({ nextNumber: quoteNumber.nullable(), terms: text(TERMS_LENGTH, 'The terms'), bank: text(500, 'The bank details') }),
  /**
   * How travel and subsistence are charged (ADR 0086): how far from Dublin city centre before travel is, the fuel
   * price and what a vehicle uses, and the per diem for each of the crew a day. Null for a price not set.
   */
  'quoting.travel': z.object({
    travelFromKm: z.number({ invalid_type_error: FROM_HINT }).int(FROM_HINT).min(0, FROM_HINT).max(1000, FROM_HINT),
    fuelCentsPerLitre: fuelPrice.nullable(),
    litresPer100Km: fuelUse,
    perDiemCents: euroCents(1000_00, 'A per diem').nullable(),
    on: day,
    // Left as they were by a save from an app older than them.
    fuelAuto: z.boolean().optional(),
    /** The AA survey a price read with "Read the AA's price" came from; null for one typed in. */
    fuelMonth: text(40, "The survey's month").nullable().optional(),
    crewPerCar: z.number({ invalid_type_error: CAR_HINT }).int(CAR_HINT).min(1, CAR_HINT).max(8, CAR_HINT).optional(),
  }),
  /** A product's day price; null takes it off the price list. */
  'price.product': z.object({ modelId: id, dayCents: dayPrice.nullable(), rate: z.enum(RATE_RULES).optional() }),
  /**
   * Give each product on the price list the rate rule Current RMS charged it by most (ADR 0085), from the quotes read
   * from it. Products with a rule already set keep it unless `all`.
   */
  'price.rulesFromRms': z.object({ all: z.boolean() }),
  /** A crew role's day price; null quotes it at its booked rate again. */
  'price.role': z.object({ role: needed(100, 'The role', 'A role'), dayCents: dayPrice.nullable() }),
  /** A client's usual discount; null for none. */
  'price.client': z.object({ clientId: id, pct: discountPct.nullable() }),
  /** The day a freelancer was paid for an approved timesheet, or null to take it back. */
  'cost.paid': z.object({ id, on: day.nullable() }),
} as const

// The sums.

/** A line's amount: how many, for how many days, at the price for one a day, to the cent. */
export const lineCents = (l: Pick<QuoteLine, 'qty' | 'days' | 'unitCents' | 'per' | 'discountPct'>) =>
  Math.round(l.qty * (l.per === 'once' ? 1 : l.days) * l.unitCents * (1 - (l.discountPct ?? 0) / 100))

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
  /** Every line, after its own discount and before the discount off the whole. */
  subtotal: number
  discount: number
  /** The discount off the whole as a percentage: the one set, or what an agreed price comes to, to one place. */
  discountPct: number
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
export function quoteTotals(q: {
  lines: readonly Pick<QuoteLine, 'qty' | 'days' | 'unitCents' | 'vat' | 'per' | 'discountPct'>[]
  discountPct: number
  agreedCents?: number | null
}): QuoteTotals {
  const at = VAT_RATES.map((rate) => ({ rate, lines: q.lines.filter((l) => l.vat === rate) })).filter((r) => r.lines.length)
  const befores = at.map((r) => r.lines.reduce((sum, l) => sum + lineCents(l), 0))
  const subtotal = befores.reduce((a, b) => a + b, 0)
  // An agreed price (ADR 0085) is a discount of whatever brings the lines to it, shared across the rates by their part
  // of the whole, the last taking what rounding leaves so it comes to the cent.
  const agreed = q.agreedCents ?? null
  const off = agreed === null ? null : Math.max(0, subtotal - agreed)
  let left = off ?? 0
  const rates: RateTotal[] = at.map((r, i) => {
    const before = befores[i]!
    let discount: number
    if (off === null) discount = Math.round((before * q.discountPct) / 100)
    else {
      discount = i === at.length - 1 ? left : subtotal ? Math.round((off * before) / subtotal) : 0
      left -= discount
    }
    const net = before - discount
    const vat = Math.round((net * PERCENT[r.rate]) / 100)
    return { rate: r.rate, before, discount, net, vat, gross: net + vat }
  })
  const sum = (k: keyof Omit<RateTotal, 'rate'>) => rates.reduce((s, r) => s + r[k], 0)
  const discount = sum('discount')
  const discountPct = off === null ? q.discountPct : subtotal ? Math.round((discount / subtotal) * 1000) / 10 : 0
  return { subtotal, discount, discountPct, net: sum('net'), vat: sum('vat'), gross: sum('gross'), rates }
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
  /** A product's rate rule (ADR 0085); Daily when none is set. */
  rate?(modelId: string): RateRule | undefined
}

/**
 * A job's kit and crew as quote lines, each at its price for a day and for
 * the days it's out or worked, at the standard rate. A product with no
 * price is put in at nothing, for the office to price: the quote shows it,
 * rather than leaving it out. A role with no price is at its booked rate.
 */
/** The days a kit line is charged for so many days out: by its product's rule when it has one (ADR 0085). */
export function daysBy(rule: RateRule | undefined, out: number): Pick<QuoteLine, 'days' | 'rate' | 'out'> {
  const days = Math.max(1, out)
  return rule && rule !== 'daily' ? { days: chargedFor(rule, days), rate: rule, out: days } : { days }
}

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
        ...daysBy(prices.rate?.(k.modelId), k.days),
        unitCents: prices.product(k.modelId) ?? 0,
        vat: STANDARD_VAT,
        per: 'day',
        modelId: k.modelId,
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
        per: 'day',
      })
    ),
  ]
}

/** What the job has that its quote doesn't, what the quote has that the job no longer does, and how many have changed. */
export interface JobChanges {
  /** The job's kit and crew not on the quote, as lines to add. */
  added: QuoteLine[]
  /** Lines built from the job's kit or crew that the job no longer has. */
  gone: QuoteLine[]
  /** Lines built from the job whose how many is no longer the job's. */
  changed: { line: QuoteLine; qty: number }[]
}

/**
 * How a quote's lines stand against the job's kit and crew now, matched by
 * the kit line or crew call each was built from. Only how many is compared:
 * the days and prices on a quote are the office's to change, and a job's
 * dates moving says nothing about what the client is charged for.
 */
export function changesFromJob(lines: readonly QuoteLine[], kit: readonly KitToQuote[], crew: readonly CrewToQuote[], prices: PriceList, newId: () => string): JobChanges {
  const refs = new Map(lines.filter((l) => l.ref && l.kind !== 'other').map((l) => [l.ref!, l]))
  const fresh = linesFor(
    kit.filter((k) => !refs.has(k.id)),
    crew.filter((c) => !refs.has(c.id)),
    prices,
    newId
  )
  const now = new Map<string, number>([...kit.map((k) => [k.id, k.qty] as const), ...crew.map((c) => [c.id, c.needed] as const)])
  const gone: QuoteLine[] = []
  const changed: JobChanges['changed'] = []
  for (const l of refs.values()) {
    const qty = now.get(l.ref!)
    if (qty === undefined) gone.push(l)
    else if (qty !== l.qty && qty >= 1) changed.push({ line: l, qty })
  }
  return { added: fresh, gone, changed }
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

// The printed quote (ADR 0084).

/** "1115", or "1115 · version 2" once there's more than one; nothing for a quote with no number. */
export function quoteNumberLabel(q: Pick<Quote, 'number' | 'version'>): string {
  if (!q.number) return ''
  return q.version > 1 ? `${q.number} · version ${q.version}` : String(q.number)
}

/** The day after `d` by `n` days, as YYYY-MM-DD. */
const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** The last day the prices hold: so many days from the day it went (or, for a draft, from `today`). */
export const validUntil = (q: Pick<Quote, 'sentOn' | 'validDays'>, today: string) => plusDays(q.sentOn ?? today, q.validDays ?? DEFAULT_VALID_DAYS)

/** "28 October 2026": a day as a letter gives it, for the printed quote. */
export const letterDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** The deposit on a total with VAT, to the cent. */
export const depositCents = (grossCents: number, pct: number) => Math.round((grossCents * pct) / 100)

/** One line of a version as it compares with the version before. */
export interface LineChange {
  line: QuoteLine
  /** The same line in the version before. */
  was: QuoteLine
}

export interface VersionChanges {
  added: QuoteLine[]
  removed: QuoteLine[]
  /** In how many, the days, the price, how it's charged or its VAT. */
  changed: LineChange[]
  /** The discount off the whole, before and now, when it changed. */
  discount: { was: number; now: number } | null
  /** The price agreed before VAT, before and now (null for none), when it changed. */
  agreed: { was: number | null; now: number | null } | null
}

/** Which line of one version is which of the next: its product, else what it was built from, else its words. */
const lineKey = (l: QuoteLine) => (l.extra ? `x:${l.extra}` : l.modelId ? `m:${l.modelId}` : l.ref ? `r:${l.ref}` : `w:${l.kind}:${l.what.trim().toLowerCase()}`)
const sameTerms = (a: QuoteLine, b: QuoteLine) =>
  a.qty === b.qty &&
  a.unitCents === b.unitCents &&
  a.vat === b.vat &&
  (a.discountPct ?? 0) === (b.discountPct ?? 0) &&
  (a.per ?? 'day') === (b.per ?? 'day') &&
  ((a.per ?? 'day') === 'once' || a.days === b.days)

/**
 * What changed from one version to the next, for "What changed since version 1". A new version's lines get new ids, so
 * lines are matched by what they are; two of the same are matched in order.
 */
export function versionChanges(was: Pick<Quote, 'lines' | 'discountPct' | 'agreedCents'>, now: Pick<Quote, 'lines' | 'discountPct' | 'agreedCents'>): VersionChanges {
  const left = new Map<string, QuoteLine[]>()
  for (const l of was.lines) left.set(lineKey(l), [...(left.get(lineKey(l)) ?? []), l])
  const added: QuoteLine[] = []
  const changed: LineChange[] = []
  for (const l of now.lines) {
    const before = left.get(lineKey(l))?.shift()
    if (!before) added.push(l)
    else if (!sameTerms(before, l)) changed.push({ line: l, was: before })
  }
  const removed = [...left.values()].flat()
  const agreedWas = was.agreedCents ?? null
  const agreedNow = now.agreedCents ?? null
  const agreed = agreedWas === agreedNow ? null : { was: agreedWas, now: agreedNow }
  // With a price agreed on either, the percentage is only what it came to, so the agreed price says the change.
  const discount = agreed || was.discountPct === now.discountPct ? null : { was: was.discountPct, now: now.discountPct }
  return { added, removed, changed, discount, agreed }
}
