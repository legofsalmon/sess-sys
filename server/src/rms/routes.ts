import { csvText, irishToday, type RmsLine, type RmsOutcome, type RmsOpportunity, type RmsOpportunityPage, type RmsOpportunityWithLines, type RmsStatus } from '@sh/shared'
import type { FastifyInstance } from 'fastify'
import type { Db, Queryable } from '../db.ts'
import { RmsRefused } from './api.ts'
import { registerRmsHistoryRoutes } from './history.ts'
import type { RmsReader } from './reader.ts'

/**
 * Current RMS for Admin and the money pages (ADR 0078). Reading what came
 * in is money, so it's for the office and directors; starting or stopping
 * a read is bringing a list in, a setting. Nothing here writes to Current
 * RMS: the reader can only ask.
 */

const PAGE = 50

type Row = Record<string, any>
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
const numOrNull = (v: unknown) => (v == null ? null : Number(v))

const OPPORTUNITY = `id, number, subject, client, venue, state, status, starts_at, ends_at, net_cents, gross_cents, rental_cents, sale_cents, service_cents,
  surcharge_cents, tax_cents, undiscounted_cents, chargeable_days, discount_category, price_category, tags, created_at, updated_at`

const toOpportunity = (r: Row): RmsOpportunity => ({
  id: r.id,
  number: r.number,
  subject: r.subject,
  client: r.client,
  venue: r.venue,
  state: r.state,
  status: r.status,
  startsAt: iso(r.starts_at),
  endsAt: iso(r.ends_at),
  netCents: Number(r.net_cents),
  grossCents: Number(r.gross_cents),
  rentalCents: Number(r.rental_cents),
  saleCents: Number(r.sale_cents),
  serviceCents: Number(r.service_cents),
  surchargeCents: Number(r.surcharge_cents),
  taxCents: Number(r.tax_cents),
  undiscountedCents: Number(r.undiscounted_cents),
  chargeableDays: numOrNull(r.chargeable_days),
  discountCategory: r.discount_category,
  priceCategory: r.price_category,
  tags: Array.isArray(r.tags) ? r.tags : [],
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
})

const LINE = `id, opportunity_id, path, kind, transaction_type, item_type, item_id, name, description, quantity, price_cents, discount_pct, chargeable_days,
  rate_definition, period, unit_cents, total_cents, tax_cents, sub_rent, starts_at, ends_at`

const toLine = (r: Row): RmsLine => ({
  id: r.id,
  opportunityId: r.opportunity_id,
  path: r.path,
  kind: r.kind,
  transaction: r.transaction_type,
  itemType: r.item_type,
  itemId: r.item_id,
  name: r.name,
  description: r.description,
  quantity: Number(r.quantity),
  priceCents: Number(r.price_cents),
  discountPct: Number(r.discount_pct),
  chargeableDays: numOrNull(r.chargeable_days),
  rateDefinition: r.rate_definition,
  period: r.period,
  unitCents: Number(r.unit_cents),
  totalCents: Number(r.total_cents),
  taxCents: Number(r.tax_cents),
  subRent: r.sub_rent,
  startsAt: iso(r.starts_at),
  endsAt: iso(r.ends_at),
})

const euro = (cents: number) => (cents / 100).toFixed(2)
const day = (at: string | null) => (at ? at.slice(0, 10) : '')

// Whether each went ahead (ADR 0092), as rmsOutcome in shared/src/rms-history.ts says it, for asking by it.
const STOPPED = `lower(status) IN ('lost', 'dead', 'cancelled')`
const OUTCOME: Record<RmsOutcome, string> = {
  not: `(${STOPPED} OR (lower(state) <> 'order' AND COALESCE(ends_at, starts_at) IS NOT NULL AND (COALESCE(ends_at, starts_at) AT TIME ZONE 'Europe/Dublin')::date < $2::date))`,
  ahead: `(NOT ${STOPPED} AND lower(state) = 'order')`,
  open: `(NOT ${STOPPED} AND lower(state) <> 'order' AND (COALESCE(ends_at, starts_at) IS NULL OR (COALESCE(ends_at, starts_at) AT TIME ZONE 'Europe/Dublin')::date >= $2::date))`,
}

/** Opportunities matching a search over number, subject, client and venue, and whether they went ahead, newest first. */
export async function findOpportunities(q: Queryable, search: string, page: number, outcome?: RmsOutcome): Promise<RmsOpportunityPage> {
  const like = `%${search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const where = `WHERE ($1 = '%%' OR number ILIKE $1 OR subject ILIKE $1 OR client ILIKE $1 OR venue ILIKE $1)${outcome ? ` AND ${OUTCOME[outcome]}` : ''}`
  // Only those asked by their days need today.
  const params = outcome && outcome !== 'ahead' ? [like, irishToday()] : [like]
  const { rows } = await q.query<Row>(
    `SELECT ${OPPORTUNITY} FROM rms_opportunities ${where} ORDER BY starts_at DESC NULLS LAST, id DESC LIMIT ${PAGE} OFFSET $${params.length + 1}`,
    [...params, (page - 1) * PAGE]
  )
  const { rows: count } = await q.query<{ n: string }>(`SELECT count(*) AS n FROM rms_opportunities ${where}`, params)
  const ids = rows.map((r) => r.id as number)
  const { rows: linked } = ids.length
    ? await q.query<Row>('SELECT m.opportunity_id, m.project_id FROM rms_matches m JOIN projects p ON p.id = m.project_id WHERE m.opportunity_id = ANY($1)', [ids])
    : { rows: [] as Row[] }
  return { opportunities: rows.map(toOpportunity), total: Number(count[0]?.n ?? 0), links: Object.fromEntries(linked.map((r) => [r.opportunity_id, r.project_id])) }
}

export function registerRmsRoutes(app: FastifyInstance, { db, reader }: { db: Db; reader: RmsReader }) {
  registerRmsHistoryRoutes(app, { db })

  app.get('/api/rms', { config: { needs: 'money' } }, async (_req, reply): Promise<RmsStatus> => {
    reply.header('cache-control', 'no-store')
    return reader.status()
  })

  app.post('/api/rms/check', { config: { needs: 'settings' } }, async (_req, reply) => {
    try {
      return { opportunities: await reader.check() }
    } catch (err) {
      if (err instanceof RmsRefused) return reply.code(err.status === 0 ? 409 : 502).send({ error: err.message })
      throw err
    }
  })

  app.post('/api/rms/read', { config: { needs: 'settings' } }, async (_req, reply) => {
    if (!reader.configured) return reply.code(409).send({ error: 'Current RMS isn’t set up on the server yet.' })
    if (!reader.start()) return reply.code(409).send({ error: 'Current RMS is already being read. It says how far it’s got below.' })
    return reply.code(202).send(await reader.status())
  })

  app.post('/api/rms/stop', { config: { needs: 'settings' } }, async (_req, reply) => {
    reader.stop()
    return reply.send(await reader.status())
  })

  app.get<{ Querystring: { q?: string; page?: string; went?: string } }>('/api/rms/opportunities', { config: { needs: 'money' } }, async (req, reply) => {
    reply.header('cache-control', 'no-store')
    const page = Math.max(1, Math.min(10_000, Number.parseInt(req.query.page ?? '1', 10) || 1))
    const went = req.query.went === 'ahead' || req.query.went === 'not' || req.query.went === 'open' ? req.query.went : undefined
    return findOpportunities(db.reads, (req.query.q ?? '').slice(0, 100), page, went)
  })

  app.get<{ Params: { id: string } }>('/api/rms/opportunities/:id', { config: { needs: 'money' } }, async (req, reply): Promise<RmsOpportunityWithLines | void> => {
    reply.header('cache-control', 'no-store')
    const id = Number.parseInt(req.params.id, 10)
    if (!Number.isSafeInteger(id)) return reply.code(404).send({ error: 'There’s no such opportunity.' })
    const { rows } = await db.reads.query<Row>(`SELECT ${OPPORTUNITY} FROM rms_opportunities WHERE id = $1`, [id])
    if (!rows[0]) return reply.code(404).send({ error: 'There’s no such opportunity. It may not have been read from Current RMS yet.' })
    const { rows: lines } = await db.reads.query<Row>(`SELECT ${LINE} FROM rms_lines WHERE opportunity_id = $1 ORDER BY path COLLATE "C", id`, [id])
    const { rows: job } = await db.reads.query<Row>('SELECT p.id, p.name FROM rms_matches m JOIN projects p ON p.id = m.project_id WHERE m.opportunity_id = $1', [id])
    return { opportunity: toOpportunity(rows[0]), lines: lines.map(toLine), job: job[0] ? { id: job[0].id, name: job[0].name } : null }
  })

  /** What came in, as two spreadsheets: one row an opportunity, and one row a line. */
  app.get<{ Params: { which: string } }>('/api/rms/download/:which', { config: { needs: 'money' } }, async (req, reply) => {
    const today = new Date().toISOString().slice(0, 10)
    if (req.params.which === 'opportunities.csv') {
      const { rows } = await db.reads.query<Row>(`SELECT ${OPPORTUNITY} FROM rms_opportunities ORDER BY id`)
      const header = ['Id', 'Number', 'Subject', 'Client', 'Venue', 'State', 'Status', 'Starts', 'Ends', 'Chargeable days', 'Rental', 'Sale', 'Service', 'Surcharge', 'Before VAT', 'VAT', 'With VAT', 'Original before deal', 'Discount category', 'Price category', 'Tags', 'Created', 'Updated']
      const body = rows.map(toOpportunity).map((o) => [
        String(o.id), o.number, o.subject, o.client, o.venue, o.state, o.status, day(o.startsAt), day(o.endsAt), o.chargeableDays == null ? '' : String(o.chargeableDays),
        euro(o.rentalCents), euro(o.saleCents), euro(o.serviceCents), euro(o.surchargeCents), euro(o.netCents), euro(o.taxCents), euro(o.grossCents), euro(o.undiscountedCents),
        o.discountCategory, o.priceCategory, o.tags.join('; '), day(o.createdAt), day(o.updatedAt),
      ])
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="current-rms-opportunities-${today}.csv"`)
        .send(csvText(header, body))
    }
    if (req.params.which === 'lines.csv') {
      const { rows } = await db.reads.query<Row>(`SELECT ${LINE} FROM rms_lines ORDER BY opportunity_id, path COLLATE "C", id`)
      const header = ['Opportunity id', 'Line id', 'Path', 'Kind', 'Transaction', 'Item type', 'Item id', 'Name', 'Description', 'Quantity', 'Price', 'Discount %', 'Chargeable days', 'Rate definition', 'Period', 'Unit charge', 'Total before VAT', 'VAT', 'Subhired', 'Starts', 'Ends']
      const body = rows.map(toLine).map((l) => [
        String(l.opportunityId), String(l.id), l.path, l.kind, l.transaction, l.itemType, l.itemId == null ? '' : String(l.itemId), l.name, l.description, String(l.quantity),
        euro(l.priceCents), String(l.discountPct), l.chargeableDays == null ? '' : String(l.chargeableDays), l.rateDefinition, l.period, euro(l.unitCents), euro(l.totalCents),
        euro(l.taxCents), l.subRent ? 'Yes' : 'No', day(l.startsAt), day(l.endsAt),
      ])
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="current-rms-lines-${today}.csv"`)
        .send(csvText(header, body))
    }
    return reply.code(404).send({ error: 'There’s no such download.' })
  })
}
