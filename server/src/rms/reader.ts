import type { RmsLine, RmsOpportunity, RmsProgress, RmsRun, RmsStatus } from '@sh/shared'
import type { Db, Queryable } from '../db.ts'
import { RmsApi, RmsRefused } from './api.ts'

/**
 * Bringing Current RMS's opportunities in (ADR 0078): every one of them,
 * whatever its state, and the lines of each. A first read takes a while,
 * since Current RMS gives 25 opportunities a request and the lines one
 * opportunity a request, at a request a second; after that, only the
 * opportunities changed since they were last read have their lines read
 * again, so a second read is a few minutes. One runs at a time, in the
 * background, and says how far it's got; it can be stopped, and what was
 * read stays.
 */

type Log = { info(obj: object, msg: string): void; warn(obj: object, msg: string): void }

/** As Current RMS answers, as far as the app reads it. Numbers come as text: "15990.0". */
type Num = string | number | null | undefined
interface ApiOpportunity {
  id: number
  number?: string | null
  subject?: string | null
  state_name?: string | null
  status_name?: string | null
  starts_at?: string | null
  ends_at?: string | null
  charge_excluding_tax_total?: Num
  charge_including_tax_total?: Num
  rental_charge_total?: Num
  sale_charge_total?: Num
  service_charge_total?: Num
  surcharge_total?: Num
  tax_total?: Num
  original_rental_charge_total?: Num
  original_sale_charge_total?: Num
  original_service_charge_total?: Num
  original_surcharge_total?: Num
  use_chargeable_days?: boolean
  chargeable_days?: Num
  tag_list?: string[] | null
  created_at?: string | null
  updated_at?: string | null
  member?: { name?: string | null; membership?: { discount_category_name?: string | null; price_category_name?: string | null } | null } | null
  venue?: { name?: string | null } | null
}
interface ApiLine {
  id: number
  path?: string | null
  opportunity_item_type_name?: string | null
  transaction_type_name?: string | null
  item_type?: string | null
  item_id?: number | null
  name?: string | null
  description?: string | null
  quantity?: Num
  price?: Num
  discount_percent?: Num
  use_chargeable_days?: boolean
  chargeable_days?: Num
  rate_definition?: { name?: string | null } | null
  lead_charging_period_name?: string | null
  unit_charge?: Num
  charge_total?: Num
  tax_total?: Num
  sub_rent?: boolean
  starts_at?: string | null
  ends_at?: string | null
}
interface Meta {
  total_row_count?: number
  row_count?: number
  page?: number
  per_page?: number
}

/** Current RMS gives at most 25 opportunities a page, and 100 of most things. */
const OPPORTUNITIES_A_PAGE = 25
const LINES_A_PAGE = 100

const num = (v: Num): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
const cents = (v: Num) => Math.round(num(v) * 100)
const days = (v: Num) => (v == null || v === '' ? null : num(v))
const words = (v: string | null | undefined, max = 500) => (v ?? '').slice(0, max)
const when = (v: string | null | undefined) => (v && !Number.isNaN(Date.parse(v)) ? v : null)

export function opportunityOf(o: ApiOpportunity): RmsOpportunity {
  return {
    id: o.id,
    number: words(o.number, 60),
    subject: words(o.subject),
    client: words(o.member?.name, 200),
    venue: words(o.venue?.name, 200),
    state: words(o.state_name, 60),
    status: words(o.status_name, 60),
    startsAt: when(o.starts_at),
    endsAt: when(o.ends_at),
    netCents: cents(o.charge_excluding_tax_total),
    grossCents: cents(o.charge_including_tax_total),
    rentalCents: cents(o.rental_charge_total),
    saleCents: cents(o.sale_charge_total),
    serviceCents: cents(o.service_charge_total),
    surchargeCents: cents(o.surcharge_total),
    taxCents: cents(o.tax_total),
    undiscountedCents: cents(o.original_rental_charge_total) + cents(o.original_sale_charge_total) + cents(o.original_service_charge_total) + cents(o.original_surcharge_total),
    chargeableDays: days(o.chargeable_days),
    discountCategory: words(o.member?.membership?.discount_category_name, 100),
    priceCategory: words(o.member?.membership?.price_category_name, 100),
    tags: (o.tag_list ?? []).filter((t) => typeof t === 'string').map((t) => t.slice(0, 60)),
    createdAt: when(o.created_at),
    updatedAt: when(o.updated_at),
  }
}

export function lineOf(opportunityId: number, l: ApiLine): RmsLine {
  return {
    id: l.id,
    opportunityId,
    path: words(l.path, 200),
    kind: words(l.opportunity_item_type_name, 60),
    transaction: words(l.transaction_type_name, 60),
    itemType: words(l.item_type, 60),
    itemId: typeof l.item_id === 'number' ? l.item_id : null,
    name: words(l.name),
    description: words(l.description, 2000),
    quantity: num(l.quantity),
    priceCents: cents(l.price),
    discountPct: num(l.discount_percent),
    chargeableDays: days(l.chargeable_days),
    rateDefinition: words(l.rate_definition?.name, 100),
    period: words(l.lead_charging_period_name, 60),
    unitCents: cents(l.unit_charge),
    totalCents: cents(l.charge_total),
    taxCents: cents(l.tax_total),
    subRent: l.sub_rent === true,
    startsAt: when(l.starts_at),
    endsAt: when(l.ends_at),
  }
}

async function keepOpportunity(q: Queryable, o: RmsOpportunity) {
  await q.query(
    `INSERT INTO rms_opportunities (id, number, subject, client, venue, state, status, starts_at, ends_at, net_cents, gross_cents, rental_cents,
       sale_cents, service_cents, surcharge_cents, tax_cents, undiscounted_cents, chargeable_days, discount_category, price_category, tags, created_at, updated_at, read_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, now())
     ON CONFLICT (id) DO UPDATE SET number = $2, subject = $3, client = $4, venue = $5, state = $6, status = $7, starts_at = $8, ends_at = $9,
       net_cents = $10, gross_cents = $11, rental_cents = $12, sale_cents = $13, service_cents = $14, surcharge_cents = $15, tax_cents = $16,
       undiscounted_cents = $17, chargeable_days = $18, discount_category = $19, price_category = $20, tags = $21, created_at = $22, updated_at = $23, read_at = now()`,
    [o.id, o.number, o.subject, o.client, o.venue, o.state, o.status, o.startsAt, o.endsAt, o.netCents, o.grossCents, o.rentalCents, o.saleCents, o.serviceCents,
      o.surchargeCents, o.taxCents, o.undiscountedCents, o.chargeableDays, o.discountCategory, o.priceCategory, JSON.stringify(o.tags), o.createdAt, o.updatedAt]
  )
}

async function keepLines(db: Db, opportunityId: number, updatedAt: string | null, lines: RmsLine[]) {
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM rms_lines WHERE opportunity_id = $1', [opportunityId])
    for (const l of lines) {
      await tx.query(
        `INSERT INTO rms_lines (id, opportunity_id, path, kind, transaction_type, item_type, item_id, name, description, quantity, price_cents, discount_pct,
           chargeable_days, rate_definition, period, unit_cents, total_cents, tax_cents, sub_rent, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
         ON CONFLICT (id) DO UPDATE SET opportunity_id = $2, path = $3, kind = $4, transaction_type = $5, item_type = $6, item_id = $7, name = $8,
           description = $9, quantity = $10, price_cents = $11, discount_pct = $12, chargeable_days = $13, rate_definition = $14, period = $15,
           unit_cents = $16, total_cents = $17, tax_cents = $18, sub_rent = $19, starts_at = $20, ends_at = $21`,
        [l.id, l.opportunityId, l.path, l.kind, l.transaction, l.itemType, l.itemId, l.name, l.description, l.quantity, l.priceCents, l.discountPct,
          l.chargeableDays, l.rateDefinition, l.period, l.unitCents, l.totalCents, l.taxCents, l.subRent, l.startsAt, l.endsAt]
      )
    }
    // Read for this version of the opportunity: its lines aren't read again until Current RMS says it changed.
    await tx.query('UPDATE rms_opportunities SET lines_read_for = $2 WHERE id = $1', [opportunityId, updatedAt ?? new Date(0).toISOString()])
  })
}

class Stopped extends Error {}

export class RmsReader {
  private progress: RmsProgress | null = null
  private stopping = false
  /** The read under way, for tests and for closing the server. */
  done: Promise<void> | undefined

  constructor(
    private readonly db: Db,
    private readonly api: RmsApi | undefined,
    private readonly log?: Log
  ) {}

  get configured() {
    return this.api !== undefined
  }

  get running() {
    return this.progress
  }

  async status(): Promise<RmsStatus> {
    const { rows } = await this.db.reads.query<{ opportunities: string; lines: string }>(
      'SELECT (SELECT count(*) FROM rms_opportunities) AS opportunities, (SELECT count(*) FROM rms_lines) AS lines'
    )
    const { rows: last } = await this.db.reads.query<Record<string, any>>(
      'SELECT started_at, finished_at, opportunities, lines, error, stopped FROM rms_reads ORDER BY id DESC LIMIT 1'
    )
    const r = last[0]
    const run: RmsRun | null = r
      ? { startedAt: new Date(r.started_at).toISOString(), finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null, opportunities: r.opportunities, lines: r.lines, error: r.error, stopped: r.stopped }
      : null
    return {
      configured: this.configured,
      subdomain: this.api?.subdomain ?? null,
      running: this.progress && { ...this.progress },
      last: run,
      opportunities: Number(rows[0]?.opportunities ?? 0),
      lines: Number(rows[0]?.lines ?? 0),
    }
  }

  /** Whether the key and subdomain work: how many opportunities Current RMS holds. Throws RmsRefused in words if not. */
  async check(): Promise<number> {
    if (!this.api) throw new RmsRefused('Current RMS isn’t set up on the server yet.', 0)
    const page = await this.api.read<{ meta?: Meta }>('/opportunities', { page: 1, per_page: 1, filtermode: 'all' })
    return page.meta?.total_row_count ?? 0
  }

  /** Start a read in the background. False when one is already running. */
  start(): boolean {
    if (!this.api || this.progress) return false
    this.stopping = false
    this.progress = { stage: 'opportunities', done: 0, total: 0, startedAt: new Date().toISOString() }
    this.done = this.run(this.api, this.progress).finally(() => {
      this.progress = null
    })
    return true
  }

  /** Stop after the request in hand; what's been read stays. */
  stop(): boolean {
    if (!this.progress) return false
    this.stopping = true
    return true
  }

  private async run(api: RmsApi, progress: RmsProgress) {
    const { rows } = await this.db.query<{ id: string }>('INSERT INTO rms_reads (started_at) VALUES ($1) RETURNING id', [progress.startedAt])
    const runId = rows[0]!.id
    let opportunities = 0
    let lines = 0
    let error: string | null = null
    const check = () => {
      if (this.stopping) throw new Stopped()
    }
    try {
      // Every opportunity, in the order of their ids so none is missed as pages go by.
      const changed: { id: number; updatedAt: string | null }[] = []
      for (let page = 1; ; page++) {
        check()
        const got = await api.read<{ opportunities?: ApiOpportunity[]; meta?: Meta }>('/opportunities', {
          page,
          per_page: OPPORTUNITIES_A_PAGE,
          filtermode: 'all',
          'q[s][]': ['id asc'],
          'include[]': ['member', 'venue'],
        })
        const list = got.opportunities ?? []
        progress.total = got.meta?.total_row_count ?? Math.max(progress.total, opportunities + list.length)
        const ids = list.map((o) => o.id)
        const { rows: had } = ids.length
          ? await this.db.query<{ id: number; lines_read_for: Date | null }>('SELECT id, lines_read_for FROM rms_opportunities WHERE id = ANY($1::int[])', [ids])
          : { rows: [] }
        const readFor = new Map(had.map((h) => [h.id, h.lines_read_for ? new Date(h.lines_read_for).toISOString() : null]))
        for (const raw of list) {
          const o = opportunityOf(raw)
          await keepOpportunity(this.db, o)
          const before = readFor.get(o.id)
          const now = o.updatedAt ? new Date(o.updatedAt).toISOString() : new Date(0).toISOString()
          if (before !== now) changed.push({ id: o.id, updatedAt: o.updatedAt })
          opportunities++
          progress.done = opportunities
        }
        if (list.length < OPPORTUNITIES_A_PAGE || (got.meta?.total_row_count !== undefined && opportunities >= got.meta.total_row_count) || page >= 2_000) break
      }

      // The lines of each opportunity new or changed since its lines were read.
      progress.stage = 'lines'
      progress.done = 0
      progress.total = changed.length
      for (const { id, updatedAt } of changed) {
        const found: RmsLine[] = []
        for (let page = 1; ; page++) {
          check()
          const got = await api.read<{ opportunity_items?: ApiLine[]; meta?: Meta }>(`/opportunities/${id}/opportunity_items`, {
            page,
            per_page: LINES_A_PAGE,
            'include[]': ['rate_definition'],
          })
          // Should Current RMS give every line whatever the page, a page with nothing new ends it rather than going round.
          const list = (got.opportunity_items ?? []).filter((l) => !found.some((f) => f.id === l.id))
          found.push(...list.map((l) => lineOf(id, l)))
          const total = got.meta?.total_row_count
          if (list.length < LINES_A_PAGE || (total !== undefined && found.length >= total) || page >= 50) break
        }
        await keepLines(this.db, id, updatedAt, found)
        lines += found.length
        progress.done++
      }
      this.log?.info({ opportunities, lines }, 'Read Current RMS')
    } catch (err) {
      if (err instanceof Stopped) error = null
      else {
        error = err instanceof RmsRefused ? err.message : 'Something went wrong reading Current RMS; what was read so far is kept.'
        this.log?.warn({ err }, 'Reading Current RMS failed')
      }
    } finally {
      await this.db
        .query('UPDATE rms_reads SET finished_at = now(), opportunities = $2, lines = $3, error = $4, stopped = $5 WHERE id = $1', [runId, opportunities, lines, error, this.stopping])
        .catch(() => {})
    }
  }
}
