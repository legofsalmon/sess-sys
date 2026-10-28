import { QUOTE_SETTINGS_ID, type ClientDiscount, type CostPaid, type Department, type Package, type PackageItem, type ProductPrice, type Quote, type QuoteSettings, type RateRule, type RolePrice } from '@sh/shared'
import type { Queryable } from '../db.ts'

/** Reading money's records back as the entities devices see (ADR 0042). */

type Row = Record<string, any>

const QUOTE = `id, project_id, version, status, lines, discount_pct, notes, made_at, saved_at,
  sent_on::text AS sent_on, answered_on::text AS answered_on, invoiced_on::text AS invoiced_on, invoice_ref, paid_on::text AS paid_on, number, valid_days, deposit_pct, agreed_cents, meals_provided, travel_km`

const toQuote = (r: Row): Quote => ({
  id: r.id,
  projectId: r.project_id,
  version: r.version,
  status: r.status,
  lines: r.lines,
  discountPct: Number(r.discount_pct),
  notes: r.notes,
  madeAt: new Date(r.made_at).toISOString(),
  savedAt: new Date(r.saved_at).toISOString(),
  sentOn: r.sent_on,
  answeredOn: r.answered_on,
  invoicedOn: r.invoiced_on,
  invoiceRef: r.invoice_ref,
  paidOn: r.paid_on,
  number: r.number ?? null,
  validDays: r.valid_days,
  depositPct: r.deposit_pct ?? null,
  agreedCents: r.agreed_cents === null || r.agreed_cents === undefined ? null : Number(r.agreed_cents),
  mealsProvided: r.meals_provided,
  travelKm: r.travel_km ?? null,
})

export async function getQuote(q: Queryable, id: string, lock = false): Promise<Quote | undefined> {
  const { rows } = await q.query(`SELECT ${QUOTE} FROM quotes WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])
  return rows[0] ? toQuote(rows[0]) : undefined
}

/** A job's versions, newest first. */
export async function quotesOf(q: Queryable, projectId: string): Promise<Quote[]> {
  const { rows } = await q.query(`SELECT ${QUOTE} FROM quotes WHERE project_id = $1 ORDER BY version DESC`, [projectId])
  return rows.map(toQuote)
}

export async function getProductPrice(q: Queryable, modelId: string): Promise<ProductPrice | undefined> {
  const { rows } = await q.query<{ model_id: string; day_cents: number; rate: RateRule | null }>('SELECT model_id, day_cents, rate FROM product_prices WHERE model_id = $1', [modelId])
  // The rule only once set, so a device or a test that knows nothing of rules sees the price as before.
  return rows[0] ? { id: rows[0].model_id, dayCents: rows[0].day_cents, ...(rows[0].rate ? { rate: rows[0].rate } : {}) } : undefined
}

export async function getPackage(q: Queryable, id: string): Promise<Package | undefined> {
  const { rows } = await q.query<{ id: string; name: string; department: Department; day_cents: number; rate: RateRule; items: PackageItem[]; notes: string }>(
    'SELECT id, name, department, day_cents, rate, items, notes FROM packages WHERE id = $1',
    [id]
  )
  const r = rows[0]
  return r ? { id: r.id, name: r.name, department: r.department, dayCents: r.day_cents, rate: r.rate, items: r.items, notes: r.notes } : undefined
}

export async function getRolePrice(q: Queryable, id: string): Promise<RolePrice | undefined> {
  const { rows } = await q.query<{ id: string; role: string; day_cents: number }>('SELECT id, role, day_cents FROM role_prices WHERE id = $1', [id])
  return rows[0] ? { id: rows[0].id, role: rows[0].role, dayCents: rows[0].day_cents } : undefined
}

export async function getClientDiscount(q: Queryable, clientId: string): Promise<ClientDiscount | undefined> {
  const { rows } = await q.query<{ client_id: string; pct: string }>('SELECT client_id, pct FROM client_discounts WHERE client_id = $1', [clientId])
  return rows[0] ? { id: rows[0].client_id, pct: Number(rows[0].pct) } : undefined
}

export async function getCostPaid(q: Queryable, timesheetId: string): Promise<CostPaid | undefined> {
  const { rows } = await q.query<{ timesheet_id: string; paid_on: string }>('SELECT timesheet_id, paid_on::text AS paid_on FROM cost_payments WHERE timesheet_id = $1', [timesheetId])
  return rows[0] ? { id: rows[0].timesheet_id, paidOn: rows[0].paid_on } : undefined
}

/** What every printed quote says (ADR 0084), once anything about it is saved or a number given. */
export async function getQuoteSettings(q: Queryable): Promise<QuoteSettings | undefined> {
  const { rows } = await q.query<Row>(
    `SELECT id, next_number, terms, bank, travel_from_km, fuel_cents_per_litre, litres_per_100_km, per_diem_cents, fuel_set_on::text AS fuel_set_on
     FROM quote_settings WHERE id = $1`,
    [QUOTE_SETTINGS_ID]
  )
  const r = rows[0]
  if (!r) return undefined
  const settings: QuoteSettings = { id: r.id, nextNumber: r.next_number, terms: r.terms, bank: r.bank }
  // Travel and subsistence (ADR 0086) once they've been set, which sets them all: until then each takes its default.
  if (r.travel_from_km === null) return settings
  const n = (v: unknown) => (v === null ? null : Number(v))
  return {
    ...settings,
    travelFromKm: r.travel_from_km,
    fuelCentsPerLitre: n(r.fuel_cents_per_litre),
    litresPer100Km: Number(r.litres_per_100_km),
    perDiemCents: r.per_diem_cents,
    fuelSetOn: r.fuel_set_on,
  }
}

/** The highest quote number given so far, or 0. */
export async function highestNumber(q: Queryable): Promise<number> {
  const { rows } = await q.query<{ n: number | null }>('SELECT max(number) AS n FROM quotes')
  return Number(rows[0]?.n ?? 0)
}
