import { euroText, parseEuro, type LinePer, type LineKind, type QuoteLine, type VatRate, chargedFor, type RateRule, SUPPLIER_LENGTH, RATE_LABELS } from '@sh/shared'

/**
 * A quote's line as it's being typed (ADR 0042): the numbers as text until
 * saved, read back into a line, and how it's charged.
 */

/** A line as it's being typed: the numbers as text until saved. */
export interface LineDraft {
  id: string
  kind: LineKind
  what: string
  ref: string | null
  modelId: string | null
  group: string
  qty: string
  days: string
  price: string
  vat: VatRate
  per: LinePer
  /** The product's rate rule (ADR 0085) when it's charged by one other than Daily, with the days it's out. */
  rate: RateRule | null
  out: string
  discount: string
  /** The package it was added from (ADR 0087), and what it held then. */
  packageId: string | null
  includes: string
  /** The cost side (ADR 0089): how many are hired in and who from, and what the line costs us, as typed. */
  subhire: string
  supplier: string
  cost: string
}
export const toDraft = (l: QuoteLine): LineDraft => ({
  id: l.id,
  kind: l.kind,
  what: l.what,
  ref: l.ref,
  modelId: l.modelId ?? null,
  group: l.group,
  qty: String(l.qty),
  days: String(l.days),
  price: euroText(l.unitCents),
  vat: l.vat,
  per: l.per ?? 'day',
  rate: l.rate && l.rate !== 'daily' ? l.rate : null,
  out: String(l.out ?? l.days),
  discount: l.discountPct ? String(l.discountPct) : '',
  packageId: l.packageId ?? null,
  includes: l.includes ?? '',
  subhire: l.subhireQty ? String(l.subhireQty) : '',
  supplier: l.supplier ?? '',
  cost: l.costCents === undefined ? '' : euroText(l.costCents),
})
/** The same line, saved as what's typed reads: a field the app before this didn't write counts as its default. */
export const sameLine = (a: QuoteLine, b: QuoteLine) =>
  a.id === b.id &&
  a.kind === b.kind &&
  a.what === b.what &&
  a.ref === b.ref &&
  a.group === b.group &&
  a.qty === b.qty &&
  a.days === b.days &&
  a.unitCents === b.unitCents &&
  a.vat === b.vat &&
  (a.per ?? 'day') === (b.per ?? 'day') &&
  (a.modelId ?? null) === (b.modelId ?? null) &&
  (a.rate ?? null) === (b.rate ?? null) &&
  (a.out ?? null) === (b.out ?? null) &&
  (a.discountPct ?? 0) === (b.discountPct ?? 0) &&
  (a.packageId ?? null) === (b.packageId ?? null) &&
  (a.includes ?? '') === (b.includes ?? '') &&
  (a.subhireQty ?? 0) === (b.subhireQty ?? 0) &&
  (a.supplier ?? '') === (b.supplier ?? '') &&
  (a.costCents ?? null) === (b.costCents ?? null) &&
  (a.extra ?? null) === (b.extra ?? null)
export const num = (s: string) => Number(s.trim().replace(',', '.'))

/** The field of a typed line that stops it saving, so the error can sit by its cause (design system rule 18). */
export type LineField = 'what' | 'price' | 'qty' | 'out' | 'days' | 'discount' | 'subhire' | 'cost'
export interface LineFault {
  field: LineField
  why: string
}

/** What a typed line comes to, or the field that stops it and why. */
export function checkLine(d: LineDraft, n: number): { line: QuoteLine; fault?: undefined } | { line?: undefined; fault: LineFault } {
  const price = parseEuro(d.price)
  const where = `Line ${n}${d.what.trim() ? ` (${d.what.trim()})` : ''}`
  const fault = (field: LineField, why: string) => ({ fault: { field, why } })
  if (!d.what.trim()) return fault('what', `Line ${n}: say what it's for.`)
  if (price.reason) return fault('price', `${where}: ${price.reason}`)
  const qty = num(d.qty)
  if (!Number.isInteger(qty) || qty < 1 || qty > 10_000) return fault('qty', `${where}: how many is a whole number from 1 to 10,000.`)
  // Charged by a rule (ADR 0085), the days charged are what the rule makes of the days out.
  const ruled = d.per === 'day' && d.rate !== null
  const out = ruled ? num(d.out) : undefined
  if (out !== undefined && !(out >= 0.5 && out <= 365 && Number.isInteger(out * 2))) return fault('out', `${where}: days out is a number of days, in halves, from 0.5 to 365.`)
  // Charged once, a line keeps 1 for its days, so a device from before this reads the same amount.
  const days = d.per === 'once' ? 1 : out !== undefined ? chargedFor(d.rate!, out) : num(d.days)
  if (!(days >= 0.5 && days <= 365 && Number.isInteger(days * 2))) return fault('days', `${where}: days charged is a number of days, in halves, from 0.5 to 365.`)
  const off = d.discount.trim() ? num(d.discount.replace(/%$/, '')) : 0
  if (!(off >= 0 && off <= 100 && Number.isInteger(off * 10))) return fault('discount', `${where}: a line's discount is a percentage from 0 to 100, such as 30 or 12.5.`)
  const hired = d.kind === 'kit' && d.subhire.trim() ? num(d.subhire) : 0
  if (!(Number.isInteger(hired) && hired >= 0 && hired <= qty)) return fault('subhire', `${where}: how many are hired in is a whole number, no more than the ${qty} on the line.`)
  const cost = d.cost.trim() ? parseEuro(d.cost) : undefined
  if (cost?.reason) return fault('cost', `${where}: what it costs us: ${cost.reason}`)
  const supplier = hired ? d.supplier.trim().slice(0, SUPPLIER_LENGTH) : ''
  return {
    line: {
      id: d.id,
      kind: d.kind,
      what: d.what.trim(),
      ref: d.ref,
      group: d.group,
      qty,
      days,
      unitCents: price.cents ?? 0,
      vat: d.vat,
      per: d.per,
      modelId: d.modelId,
      ...(ruled ? { rate: d.rate!, out } : {}),
      ...(off ? { discountPct: off } : {}),
      ...(d.packageId ? { packageId: d.packageId } : {}),
      ...(d.includes ? { includes: d.includes } : {}),
      ...(hired ? { subhireQty: hired } : {}),
      ...(supplier ? { supplier } : {}),
      ...(cost?.cents != null ? { costCents: cost.cents } : {}),
    },
  }
}

/** What a typed line comes to, or why it can't be saved. */
export function readLine(d: LineDraft, n: number): QuoteLine | string {
  const c = checkLine(d, n)
  return c.fault ? c.fault.why : c.line
}

/** How a line is charged, as one choice: by the day, by a rule, or once. */
export type Charge = 'daily' | 'week3' | 'weekly' | 'once'
export const chargeOf = (l: Pick<LineDraft, 'per' | 'rate'>): Charge => (l.per === 'once' ? 'once' : (l.rate ?? 'daily'))
/** Named as the price list names its rules, so the two read the same. */
export const CHARGE_LABELS: Record<Charge, string> = { ...RATE_LABELS, once: 'Once' }
