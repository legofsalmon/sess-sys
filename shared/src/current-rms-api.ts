/**
 * Reading Current RMS through its API (ADR 0078). The office's quotes are
 * in Current RMS, and the quoting engine is shaped by them, so the server
 * reads them straight from it: every opportunity (enquiries, quotes,
 * orders, lost and dead ones) and the lines of each, kept here as a copy
 * to read, for the office and directors only, since it is all prices.
 *
 * It only ever reads. The API key would let it change anything in Current
 * RMS, so the server's client has no way to send anything but a read, and
 * the key stays on the server: no device is ever sent it.
 *
 * Money is in cents, as everywhere in the app, worked out from Current
 * RMS's own figures; a quantity or a number of days is kept as it gave it.
 */

/** Where a bring-in has got to. */
export type RmsStage = 'opportunities' | 'lines'

export interface RmsProgress {
  stage: RmsStage
  /** Opportunities read so far, and how many Current RMS said there are. */
  done: number
  total: number
  startedAt: string
}

export interface RmsRun {
  startedAt: string
  finishedAt: string | null
  /** Opportunities read, and the ones whose lines were read again because they had changed. */
  opportunities: number
  lines: number
  /** What went wrong, in words; null when it finished. */
  error: string | null
  /** Stopped by someone pressing Stop, not by a fault. */
  stopped: boolean
}

export interface RmsStatus {
  /** Whether the server has the subdomain and key (CURRENT_RMS_SUBDOMAIN, CURRENT_RMS_API_KEY). */
  configured: boolean
  /** "sessionhire", the first part of the Current RMS address. */
  subdomain: string | null
  /** While a bring-in runs. */
  running: RmsProgress | null
  last: RmsRun | null
  /** What's kept here now. */
  opportunities: number
  lines: number
}

/** An opportunity, as the list of past quotes shows it. */
export interface RmsOpportunity {
  id: number
  /** Current RMS's own number, such as "OP-10001" or "1042". */
  number: string
  subject: string
  client: string
  venue: string
  /** Draft, Quotation, Order and so on, and where it's at within that (Open, Provisional, Lost, Dead, Cancelled…). */
  state: string
  status: string
  startsAt: string | null
  endsAt: string | null
  /** Before VAT, after discounts, and with VAT. */
  netCents: number
  grossCents: number
  rentalCents: number
  saleCents: number
  serviceCents: number
  surchargeCents: number
  taxCents: number
  /** Before any discount or deal price, so the two show what was given off. */
  undiscountedCents: number
  chargeableDays: number | null
  /** The client's discount and price categories in Current RMS, if any. */
  discountCategory: string
  priceCategory: string
  tags: string[]
  createdAt: string | null
  updatedAt: string | null
}

/** A line of an opportunity, as Current RMS has it. */
export interface RmsLine {
  id: number
  opportunityId: number
  /** Current RMS orders and nests lines by this: a group, then the lines in it, then accessories under a line. */
  path: string
  /** Group, Principal, Accessory… */
  kind: string
  /** Rental, Sale, Service… */
  transaction: string
  /** Product, Service, TextItem, or blank for a group. */
  itemType: string
  itemId: number | null
  name: string
  description: string
  quantity: number
  /** The price for one for a charging period, before the line's discount. */
  priceCents: number
  discountPct: number
  chargeableDays: number | null
  /** The rate definition ("3 Day Week Rate", "Daily Rate") and the period it led with ("Weekly", "Daily"). */
  rateDefinition: string
  period: string
  /** The price for one after the discount, and the line's total before VAT, and its VAT. */
  unitCents: number
  totalCents: number
  taxCents: number
  subRent: boolean
  startsAt: string | null
  endsAt: string | null
}

export interface RmsOpportunityPage {
  opportunities: RmsOpportunity[]
  /** How many match, for "Showing 50 of 812". */
  total: number
}

export interface RmsOpportunityWithLines {
  opportunity: RmsOpportunity
  lines: RmsLine[]
}

/** Lines indented by how deep their path is: four digits a level. */
export const rmsDepth = (path: string) => Math.max(0, Math.floor(path.length / 4) - 1)
