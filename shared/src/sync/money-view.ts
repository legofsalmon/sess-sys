import type { CommandArgs, Mutation } from '../commands.ts'
import { daysBetween, eachDay } from '../crew.ts'
import { irishToday } from '../day.ts'
import { STOPPED } from '../jobs.ts'
import {
  amount,
  csvText,
  DEFAULT_VALID_DAYS,
  QUOTE_SETTINGS_ID,
  moneyMonth,
  quoteTotals,
  roleKey,
  VAT_LABELS,
  VAT_RATES,
  vatPeriodOf,
  type ClientDiscount,
  type CostPaid,
  type CrewToQuote,
  type KitToQuote,
  type Package,
  type ProductPrice,
  type Quote,
  type QuoteEntities,
  type QuoteSettings,
  type RateRule,
  type QuoteTotals,
  type RolePrice,
  type VatRate,
} from '../quotes.ts'
import { DEPARTMENT_LABELS } from '../stock.ts'
import { timesheetTotal } from '../timesheets.ts'
import type { CrewView } from './crew-view.ts'
import type { JobsView, JobView } from './jobs-view.ts'
import type { KitView } from './kit-view.ts'
import type { TimesheetRow, TimesheetsView } from './timesheets-view.ts'

/**
 * Money on a device (ADR 0042): the price list, each job's quotes and the
 * one that counts, and what the director looks at: by month, what's
 * quoted, confirmed and invoiced; who still owes; what's owed to
 * freelancers; and each job's margin. Worked out from what the device
 * holds, with this person's own waiting changes laid over it, so it works
 * with no signal. A role that can't see money is sent none of it, so for
 * it all of this is empty.
 */

export interface QuoteView extends Quote {
  pending: boolean
  totals: QuoteTotals
  /** The job's newest version. An older one is kept to read, as it went to the client. */
  latest: boolean
}

/** A freelancer's approved timesheet as a cost, and whether they've been paid. */
export interface CostRow {
  row: TimesheetRow
  cents: number
  /** The day the office marked it paid. */
  paidOn: string | undefined
  pending: boolean
}

export interface JobMoney {
  job: JobView
  /** The quote that counts: the invoiced one, or else the newest that isn't a draft. */
  current: QuoteView | undefined
  /** Its net, before VAT; nothing for a quote turned down. */
  quoted: number
  /** Freelancers' approved timesheets on the job. */
  costs: number
  /** Freelancers booked on it whose timesheets aren't approved yet, at their booked days and rate. */
  toCome: number
  /** What's left of the quote once freelancers are paid: quoted less costs and those to come. Null with no quote. */
  margin: number | null
}

export interface MonthMoney {
  key: string
  label: string
  /** Quotes sent, accepted or invoiced, net, by the month the job starts. */
  quoted: number
  /** Of those, the ones the client accepted. */
  confirmed: number
  /** Of those, the ones invoiced. */
  invoiced: number
  /** Freelancers' approved timesheets, by the month of their last day. */
  costs: number
}

export interface OwedBy {
  client: string
  clientId: string | null
  /** Accepted, not paid: VAT included, as the invoice asks. */
  cents: number
  quotes: { job: JobView; quote: QuoteView }[]
}

export interface MoneyView {
  /** A job's versions, newest first. */
  quotesOf(jobId: string): QuoteView[]
  /** The job's draft, if it has one being put together. */
  draftOf(jobId: string): QuoteView | undefined
  currentOf(jobId: string): QuoteView | undefined
  quote(id: string): QuoteView | undefined
  /** A product's day price, a role's, a client's discount: undefined for none set. */
  productPrice(modelId: string): number | undefined
  /** A product's rate rule (ADR 0085): undefined for none set, which charges it by the day. */
  productRate(modelId: string): RateRule | undefined
  rolePrice(role: string): number | undefined
  discountOf(clientId: string | null | undefined): number | undefined
  /** The packages on the price list (ADR 0087), by name, each marked while this device's change is on its way. */
  packages: (Package & { pending: boolean })[]
  package(id: string): (Package & { pending: boolean }) | undefined
  /** Whether this device's own change to a price is still on its way. */
  pricePending(kind: 'product' | 'role' | 'client', key: string): boolean
  /** Every role with a price, and every role crew have been asked for, by name. */
  roles: { role: string; cents: number | undefined; booked: number | undefined }[]
  /** A job's kit and crew, as a new quote is built from them. */
  sourceOf(jobId: string): { kit: KitToQuote[]; crew: CrewToQuote[] }
  /** Each job with a quote or a freelancer's cost, soonest first. */
  jobs: JobMoney[]
  job(jobId: string): JobMoney | undefined
  months: MonthMoney[]
  /** Clients with accepted quotes not paid, most owed first. */
  owed: OwedBy[]
  /** Approved timesheets not marked paid, oldest first. */
  costsOwed: CostRow[]
  /** Paid lately, newest first. */
  costsPaid: CostRow[]
  /** Anything to show at all: a quote, a price or a cost. */
  any: boolean
  /** What every printed quote says (ADR 0084): the next number, the terms, the bank details. */
  quoting: QuoteSettings & { pending: boolean }
  /** The number the next quote sent will get, as the server will give it, unless another device's goes first. */
  nextNumber: number
}

type Tables = { [E in keyof QuoteEntities]: Record<string, QuoteEntities[E]> }

export function moneyView(
  entities: Partial<Tables>,
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number,
  jobs: JobsView,
  crew: CrewView,
  kit: KitView,
  timesheets: TimesheetsView
): MoneyView {
  // Snapshots saved before money, and a role sent none of it, have no tables for it.
  const quotes = new Map<string, Quote & { pending: boolean }>(Object.values(entities.quote ?? {}).map((q) => [q.id, { ...q, pending: false }]))
  const products = new Map<string, ProductPrice & { pending?: boolean }>(Object.values(entities.productPrice ?? {}).map((p) => [p.id, p]))
  const roles = new Map<string, RolePrice & { pending?: boolean }>(Object.values(entities.rolePrice ?? {}).map((r) => [r.id, r]))
  const discounts = new Map<string, ClientDiscount & { pending?: boolean }>(Object.values(entities.clientDiscount ?? {}).map((d) => [d.id, d]))
  const packages = new Map<string, Package & { pending: boolean }>(Object.values(entities.package ?? {}).map((p) => [p.id, { ...p, pending: false }]))
  const paid = new Map<string, CostPaid & { pending?: boolean }>(Object.values(entities.costPaid ?? {}).map((c) => [c.id, c]))
  let quoting: QuoteSettings & { pending: boolean } = {
    ...{ id: QUOTE_SETTINGS_ID, nextNumber: null, terms: '', bank: '' },
    ...entities.quoteSettings?.[QUOTE_SETTINGS_ID],
    pending: false,
  }
  const gone = { product: new Set<string>(), role: new Set<string>(), client: new Set<string>(), cost: new Set<string>() }

  // The number a quote going out now will have, worked out as the server does (ADR 0084): an earlier version's, or the
  // next, which moves on. Another device's quote sent first can take it, and then the server's number is shown once it's in.
  const numberOf = (q: Quote) => {
    const had = q.number ?? [...quotes.values()].find((v) => v.projectId === q.projectId && v.number)?.number
    if (had) return had
    const n = Math.max(quoting.nextNumber ?? 1, Math.max(0, ...[...quotes.values()].map((v) => v.number ?? 0)) + 1)
    quoting = { ...quoting, nextNumber: n + 1, pending: true }
    return n
  }

  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    switch (m.name) {
      case 'quote.save': {
        const a = m.args as CommandArgs<'quote.save'>
        const was = quotes.get(a.id)
        if (was && was.status !== 'draft') break
        if (!was && [...quotes.values()].some((q) => q.projectId === a.projectId && q.status === 'draft')) break
        const versions = [...quotes.values()].filter((q) => q.projectId === a.projectId)
        const version = was?.version ?? Math.max(0, ...versions.map((q) => q.version)) + 1
        const before = was ?? versions.sort((x, y) => y.version - x.version)[0]
        quotes.set(a.id, {
          id: a.id,
          projectId: was?.projectId ?? a.projectId,
          version,
          status: 'draft',
          lines: a.lines,
          discountPct: a.discountPct,
          notes: a.notes,
          madeAt: was?.madeAt ?? m.createdAt,
          savedAt: m.createdAt,
          sentOn: null,
          answeredOn: null,
          invoicedOn: null,
          invoiceRef: '',
          paidOn: null,
          // Kept from the draft, or the version before, when the save doesn't say them, as the server does.
          number: was?.number ?? null,
          validDays: a.validDays ?? before?.validDays ?? DEFAULT_VALID_DAYS,
          depositPct: a.depositPct !== undefined ? a.depositPct : (before?.depositPct ?? null),
          agreedCents: a.agreedCents !== undefined ? a.agreedCents : (was?.agreedCents ?? null),
          mealsProvided: a.mealsProvided ?? before?.mealsProvided ?? false,
          travelKm: a.travelKm !== undefined ? a.travelKm : (before?.travelKm ?? null),
          pending: true,
        })
        break
      }
      case 'quote.sent': {
        const a = m.args as CommandArgs<'quote.sent'>
        const was = quotes.get(a.id)
        if (was?.status === 'draft') quotes.set(a.id, { ...was, status: 'sent', sentOn: a.on, number: numberOf(was), pending: true })
        break
      }
      case 'quote.answer': {
        const a = m.args as CommandArgs<'quote.answer'>
        const was = quotes.get(a.id)
        if (!was || was.invoicedOn) break
        if (a.answer === 'none') quotes.set(a.id, { ...was, status: was.status === 'draft' ? 'draft' : 'sent', answeredOn: null, pending: true })
        else quotes.set(a.id, { ...was, status: a.answer, answeredOn: a.on, sentOn: was.sentOn ?? a.on, number: was.status === 'draft' ? numberOf(was) : (was.number ?? null), pending: true })
        break
      }
      case 'quote.invoiced': {
        const a = m.args as CommandArgs<'quote.invoiced'>
        const was = quotes.get(a.id)
        if (was?.status === 'accepted' && !(a.on === null && was.paidOn)) quotes.set(a.id, { ...was, invoicedOn: a.on, invoiceRef: a.on ? a.ref : '', pending: true })
        break
      }
      case 'quote.paid': {
        const a = m.args as CommandArgs<'quote.paid'>
        const was = quotes.get(a.id)
        if (was?.invoicedOn) quotes.set(a.id, { ...was, paidOn: a.on, pending: true })
        break
      }
      case 'price.product': {
        const a = m.args as CommandArgs<'price.product'>
        if (a.dayCents === null) products.delete(a.modelId)
        else {
          // A change that doesn't say the rule keeps it, as the server does (ADR 0085).
          const rate = a.rate ?? products.get(a.modelId)?.rate
          products.set(a.modelId, { id: a.modelId, dayCents: a.dayCents, ...(rate ? { rate } : {}), pending: true })
        }
        gone.product.add(a.modelId)
        break
      }
      case 'package.save': {
        const a = m.args as CommandArgs<'package.save'>
        packages.set(a.id, { ...a, name: a.name.trim(), notes: a.notes.trim(), pending: true })
        break
      }
      case 'package.remove': {
        const a = m.args as CommandArgs<'package.remove'>
        packages.delete(a.id)
        break
      }
      case 'price.role': {
        const a = m.args as CommandArgs<'price.role'>
        const key = roleKey(a.role)
        if (a.dayCents === null) roles.delete(key)
        else roles.set(key, { id: key, role: a.role.trim().replace(/\s+/g, ' '), dayCents: a.dayCents, pending: true })
        gone.role.add(key)
        break
      }
      case 'price.client': {
        const a = m.args as CommandArgs<'price.client'>
        if (a.pct === null) discounts.delete(a.clientId)
        else discounts.set(a.clientId, { id: a.clientId, pct: a.pct, pending: true })
        gone.client.add(a.clientId)
        break
      }
      case 'quoting.update': {
        const a = m.args as CommandArgs<'quoting.update'>
        quoting = { ...quoting, id: QUOTE_SETTINGS_ID, nextNumber: a.nextNumber, terms: a.terms, bank: a.bank, pending: true }
        break
      }
      case 'quoting.travel': {
        const a = m.args as CommandArgs<'quoting.travel'>
        // The day the fuel price was set moves only when the price does, as on the server.
        const fuelSetOn = a.fuelCentsPerLitre === (quoting.fuelCentsPerLitre ?? null) ? (quoting.fuelSetOn ?? null) : a.on
        quoting = {
          ...quoting,
          id: QUOTE_SETTINGS_ID,
          travelFromKm: a.travelFromKm,
          fuelCentsPerLitre: a.fuelCentsPerLitre,
          litresPer100Km: a.litresPer100Km,
          perDiemCents: a.perDiemCents,
          fuelSetOn,
          pending: true,
        }
        break
      }
      case 'cost.paid': {
        const a = m.args as CommandArgs<'cost.paid'>
        if (a.on === null) paid.delete(a.id)
        else paid.set(a.id, { id: a.id, paidOn: a.on, pending: true })
        gone.cost.add(a.id)
        break
      }
    }
  }

  // Each job's versions, newest first, with their sums.
  const byJob = new Map<string, QuoteView[]>()
  for (const q of quotes.values()) {
    const list = byJob.get(q.projectId) ?? []
    list.push({ ...q, totals: quoteTotals(q), latest: false })
    byJob.set(q.projectId, list)
  }
  const views = new Map<string, QuoteView>()
  for (const list of byJob.values()) {
    list.sort((a, b) => b.version - a.version || a.id.localeCompare(b.id))
    list[0]!.latest = true
    for (const q of list) views.set(q.id, q)
  }
  const currentOf = (jobId: string) => {
    const list = byJob.get(jobId) ?? []
    return list.find((q) => q.invoicedOn) ?? list.find((q) => q.status !== 'draft')
  }

  // Freelancers' costs, from their approved timesheets.
  const costOf = (row: TimesheetRow): CostRow => {
    const p = paid.get(row.offer.id)
    return { row, cents: row.total.total, paidOn: p?.paidOn, pending: !!p?.pending || gone.cost.has(row.offer.id) }
  }
  const approved = timesheets.approved.map(costOf)
  const lastDay = (r: TimesheetRow) => [...(r.timesheet?.days ?? r.offer.days)].sort().at(-1) ?? r.call.end

  // Each job's margin: the quote that counts, less what freelancers are paid and are still to be.
  const jobMoney = new Map<string, JobMoney>()
  const people = new Map(crew.people.map((p) => [p.id, p]))
  for (const job of jobs.jobs) {
    const current = currentOf(job.id)
    let costs = 0
    let toCome = 0
    for (const call of job.calls) {
      for (const o of call.offers) {
        const row = timesheets.row(o.id)
        if (row?.state === 'approved') costs += row.total.total
        else if (call.status === 'open' && o.status === 'confirmed' && people.get(o.personId)?.kind === 'freelancer')
          toCome += (row?.timesheet ? row.total : timesheetTotal({ days: o.days, dayRateCents: o.dayRateCents, extras: [] })).total
      }
    }
    if (!current && !costs && !toCome && !byJob.has(job.id)) continue
    const quoted = current && current.status !== 'declined' ? current.totals.net : 0
    jobMoney.set(job.id, { job, current, quoted, costs, toCome, margin: current && current.status !== 'declined' ? quoted - costs - toCome : null })
  }
  const jobList = [...jobMoney.values()].sort((a, b) => (a.job.span?.start ?? '9999').localeCompare(b.job.span?.start ?? '9999') || a.job.name.localeCompare(b.job.name))

  // By month: quotes by the month their job starts, costs by the month of the last day worked.
  const months = new Map<string, MonthMoney>()
  const monthFor = (d: string) => {
    const { key, label } = moneyMonth(d)
    let m = months.get(key)
    if (!m) months.set(key, (m = { key, label, quoted: 0, confirmed: 0, invoiced: 0, costs: 0 }))
    return m
  }
  for (const jm of jobList) {
    const q = jm.current
    if (!q || q.status === 'declined' || (STOPPED.includes(jm.job.status) && !q.invoicedOn)) continue
    const m = monthFor(jm.job.span?.start ?? q.sentOn ?? irishToday(new Date(q.madeAt)))
    m.quoted += q.totals.net
    if (q.status === 'accepted') m.confirmed += q.totals.net
    if (q.invoicedOn) m.invoiced += q.totals.net
  }
  for (const c of approved) monthFor(lastDay(c.row)).costs += c.cents

  // Who owes: accepted quotes not yet paid, VAT and all.
  const owed = new Map<string, OwedBy>()
  for (const jm of jobList) {
    const q = jm.current
    if (!q || q.status !== 'accepted' || q.paidOn) continue
    const key = jm.job.client?.id ?? ''
    let o = owed.get(key)
    if (!o) owed.set(key, (o = { client: jm.job.client?.name ?? 'No client', clientId: jm.job.client?.id ?? null, cents: 0, quotes: [] }))
    o.cents += q.totals.gross
    o.quotes.push({ job: jm.job, quote: q })
  }

  // Who's been asked for, so a role can be priced before anyone is booked at it.
  const roleList = new Map<string, { role: string; cents: number | undefined; booked: number | undefined }>()
  for (const r of roles.values()) roleList.set(r.id, { role: r.role, cents: r.dayCents, booked: undefined })
  for (const c of crew.calls) {
    const key = roleKey(c.role)
    const known = roleList.get(key)
    if (known) known.booked ??= c.dayRateCents ?? undefined
    else roleList.set(key, { role: c.role.trim(), cents: undefined, booked: c.dayRateCents ?? undefined })
  }

  const sourceOf = (jobId: string) => {
    const job = jobs.jobs.find((j) => j.id === jobId)
    if (!job) return { kit: [], crew: [] }
    const span = (s: { start: string; end: string } | undefined) => (s ? eachDay(s.start, s.end).length : 1)
    return {
      kit: (kit.byJob.get(jobId) ?? []).map(
        (l): KitToQuote => ({
          id: l.id,
          modelId: l.modelId,
          name: l.model?.name ?? 'A product',
          group: DEPARTMENT_LABELS[l.model?.department ?? 'other'],
          ...(l.phase ? { phase: l.phase.name } : {}),
          qty: l.qty,
          days: span(l.span),
        })
      ),
      crew: job.calls
        .filter((c) => c.status === 'open')
        .map(
          (c): CrewToQuote => ({
            id: c.id,
            role: c.role,
            ...(c.phase ? { phase: c.phase } : {}),
            needed: c.needed,
            days: c.days.length || 1,
            bookedCents: c.dayRateCents,
          })
        ),
    }
  }

  return {
    quotesOf: (jobId) => byJob.get(jobId) ?? [],
    draftOf: (jobId) => (byJob.get(jobId) ?? []).find((q) => q.status === 'draft'),
    currentOf,
    quote: (id) => views.get(id),
    productPrice: (modelId) => products.get(modelId)?.dayCents,
    productRate: (modelId) => products.get(modelId)?.rate,
    packages: [...packages.values()].sort((a, b) => a.name.localeCompare(b.name, 'en-IE')),
    package: (id) => packages.get(id),
    rolePrice: (role) => roles.get(roleKey(role))?.dayCents,
    discountOf: (clientId) => (clientId ? discounts.get(clientId)?.pct : undefined),
    pricePending: (kind, key) => (kind === 'product' ? gone.product.has(key) : kind === 'role' ? gone.role.has(roleKey(key)) : gone.client.has(key)),
    roles: [...roleList.values()].sort((a, b) => a.role.localeCompare(b.role, 'en-IE')),
    sourceOf,
    jobs: jobList,
    job: (jobId) => jobMoney.get(jobId),
    months: [...months.values()].sort((a, b) => a.key.localeCompare(b.key)),
    owed: [...owed.values()].sort((a, b) => b.cents - a.cents || a.client.localeCompare(b.client)),
    costsOwed: approved.filter((c) => !c.paidOn).sort((a, b) => (a.row.timesheet?.approvedAt ?? '').localeCompare(b.row.timesheet?.approvedAt ?? '')),
    costsPaid: approved.filter((c) => c.paidOn).sort((a, b) => b.paidOn!.localeCompare(a.paidOn!)),
    any: quotes.size > 0 || products.size > 0 || packages.size > 0 || roles.size > 0 || approved.length > 0,
    quoting,
    nextNumber: Math.max(quoting.nextNumber ?? 1, Math.max(0, ...[...quotes.values()].map((q) => q.number ?? 0)) + 1),
  }
}

// Quotes to follow up (ADR 0081): what's waiting on the office, so nothing quoted is forgotten.

/** A quote sent this many days ago with no answer is worth a call to the client. */
export const CHASE_AFTER_DAYS = 7

export interface QuoteToFollow {
  job: JobView
  quote: QuoteView
  /** Days since it was last saved (a draft), sent (waiting) or answered (out of step). */
  days: number
}

export interface QuotesToFollow {
  /** Being put together, not sent yet. */
  drafts: QuoteToFollow[]
  /** Sent, with no answer yet: the longest waiting first. */
  waiting: QuoteToFollow[]
  /** Answered, but the job doesn't say so yet: accepted and not confirmed, or turned down and not marked lost. */
  outOfStep: (QuoteToFollow & { want: 'confirmed' | 'lost' })[]
}

export function quotesToFollow(m: Pick<MoneyView, 'jobs' | 'draftOf'>, today: string): QuotesToFollow {
  const out: QuotesToFollow = { drafts: [], waiting: [], outOfStep: [] }
  const since = (d: string | null | undefined) => (d ? Math.max(0, daysBetween(d, today)) : 0)
  for (const { job, current } of m.jobs) {
    const stopped = STOPPED.includes(job.status)
    const draft = m.draftOf(job.id)
    if (draft && !stopped) out.drafts.push({ job, quote: draft, days: since(irishToday(new Date(draft.savedAt))) })
    if (!current) continue
    if (current.status === 'sent' && !stopped && !draft) out.waiting.push({ job, quote: current, days: since(current.sentOn) })
    if (current.status === 'accepted' && !stopped && job.status !== 'confirmed') out.outOfStep.push({ job, quote: current, days: since(current.answeredOn), want: 'confirmed' })
    if (current.status === 'declined' && !stopped && !draft) out.outOfStep.push({ job, quote: current, days: since(current.answeredOn), want: 'lost' })
  }
  const longest = (a: QuoteToFollow, b: QuoteToFollow) => b.days - a.days || a.job.name.localeCompare(b.job.name, 'en-IE')
  out.drafts.sort(longest)
  out.waiting.sort(longest)
  out.outOfStep.sort(longest)
  return out
}

// Every quote in one list (ADR 0088), for the Quotes page: a job's latest, found by its job, client, venue or number.

/** What the Quotes page can narrow to. An invoiced or paid quote is accepted. */
export type QuoteShow = 'all' | 'draft' | 'sent' | 'accepted' | 'declined'
export const QUOTE_SHOWS: [QuoteShow, string][] = [
  ['all', 'All'],
  ['draft', 'Not sent'],
  ['sent', 'Sent'],
  ['accepted', 'Accepted'],
  ['declined', 'Turned down'],
]

export interface QuoteRow {
  job: JobView
  /** The version being put together if there is one, or else the one that counts. */
  quote: QuoteView
  /** The one that counts, when a newer version is being drafted over it. */
  behind: QuoteView | undefined
  /** The last day anything happened to it: saved, sent, answered, invoiced or paid. */
  changed: string
}

/** Each job's quote, the last changed first. */
export function quoteRows(m: Pick<MoneyView, 'jobs' | 'draftOf'>): QuoteRow[] {
  const rows: QuoteRow[] = []
  for (const { job, current } of m.jobs) {
    const draft = m.draftOf(job.id)
    const quote = draft ?? current
    if (!quote) continue
    const days = [draft, current].flatMap((q) => (q ? [irishToday(new Date(q.savedAt)), q.sentOn, q.answeredOn, q.invoicedOn, q.paidOn] : []))
    const changed = days.filter((d): d is string => !!d).sort().at(-1) ?? ''
    rows.push({ job, quote, behind: draft && current ? current : undefined, changed })
  }
  return rows.sort((a, b) => b.changed.localeCompare(a.changed) || a.job.name.localeCompare(b.job.name, 'en-IE'))
}

/** Whether a row is one of those shown, and has every word typed somewhere in its job's name, client, venue, number or invoice. */
export function quoteRowShown(r: QuoteRow, show: QuoteShow, search: string): boolean {
  if (show !== 'all' && r.quote.status !== show) return false
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const q = r.behind ?? r.quote
  const text = [r.job.name, r.job.client?.name, r.job.venue?.name, q.number ? String(q.number) : '', q.invoiceRef].filter(Boolean).join(' ').toLowerCase()
  return words.every((w) => text.includes(w))
}

// The accountant's files (ADR 0042): made on the device from what it holds, for a period.

export interface Period {
  start: string
  end: string
  label: string
}

/** Invoiced quotes in a period, by the day of the invoice: one row for each VAT rate on it. */
export function invoiceRows(money: MoneyView, period: Period) {
  const rows: { date: string; invoice: string; client: string; job: string; version: number; rate: VatRate; net: number; vat: number; gross: number; paidOn: string }[] = []
  for (const jm of money.jobs) {
    const q = jm.current
    if (!q?.invoicedOn || q.invoicedOn < period.start || q.invoicedOn > period.end) continue
    for (const r of q.totals.rates)
      rows.push({ date: q.invoicedOn, invoice: q.invoiceRef, client: jm.job.client?.name ?? '', job: jm.job.name, version: q.version, rate: r.rate, net: r.net, vat: r.vat, gross: r.gross, paidOn: q.paidOn ?? '' })
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.invoice.localeCompare(b.invoice) || a.job.localeCompare(b.job))
}

export function invoicesCsv(money: MoneyView, period: Period): string {
  return csvText(
    ['Invoice date', 'Invoice number', 'Client', 'Job', 'Quote version', 'VAT rate', 'Net (EUR)', 'VAT (EUR)', 'Gross (EUR)', 'Paid on'],
    invoiceRows(money, period).map((r) => [r.date, r.invoice, r.client, r.job, String(r.version), VAT_LABELS[r.rate], amount(r.net), amount(r.vat), amount(r.gross), r.paidOn])
  )
}

/** Sales by Revenue's two-month VAT period and by rate, with a total for each period. */
export function vatSummaryCsv(money: MoneyView, period: Period): string {
  const sums = new Map<string, { label: string; rate: VatRate; net: number; vat: number; gross: number }>()
  for (const r of invoiceRows(money, period)) {
    const p = vatPeriodOf(r.date)
    const key = `${p.key} ${r.rate}`
    const s = sums.get(key) ?? { label: p.label, rate: r.rate, net: 0, vat: 0, gross: 0 }
    s.net += r.net
    s.vat += r.vat
    s.gross += r.gross
    sums.set(key, s)
  }
  const rows: string[][] = []
  // Each period in turn, its rates as a quote lists them: 23% first.
  const keys = [...sums.keys()].sort((a, b) => a.slice(0, 7).localeCompare(b.slice(0, 7)) || VAT_RATES.indexOf(sums.get(a)!.rate) - VAT_RATES.indexOf(sums.get(b)!.rate))
  for (const [i, key] of keys.entries()) {
    const s = sums.get(key)!
    rows.push([s.label, VAT_LABELS[s.rate], amount(s.net), amount(s.vat), amount(s.gross)])
    const next = keys[i + 1]
    if (!next || next.slice(0, 7) !== key.slice(0, 7)) {
      const all = keys.filter((k) => k.startsWith(key.slice(0, 7))).map((k) => sums.get(k)!)
      rows.push([`${s.label} in all`, '', amount(all.reduce((t, x) => t + x.net, 0)), amount(all.reduce((t, x) => t + x.vat, 0)), amount(all.reduce((t, x) => t + x.gross, 0))])
    }
  }
  return csvText(['VAT period', 'VAT rate', 'Net (EUR)', 'VAT (EUR)', 'Gross (EUR)'], rows)
}

/**
 * Freelancers' approved timesheets in a period, by the day each was
 * approved, with who they trade as: what they invoice the office for, before
 * any VAT a registered freelancer adds on their own invoice.
 */
export function costsCsv(money: MoneyView, period: Period): string {
  const all = [...money.costsOwed, ...money.costsPaid]
    .map((c) => ({ c, on: c.row.timesheet?.approvedAt ? irishToday(new Date(c.row.timesheet.approvedAt)) : '' }))
    .filter(({ on }) => on >= period.start && on <= period.end)
    .sort((a, b) => a.on.localeCompare(b.on) || (a.c.row.person?.name ?? '').localeCompare(b.c.row.person?.name ?? ''))
  return csvText(
    ['Approved on', 'Freelancer', 'Trading as', 'VAT number', 'Job', 'Role', 'Days', 'Day rate (EUR)', 'Fees (EUR)', 'Extras (EUR)', 'Total (EUR)', 'Paid on'],
    all.map(({ c, on }) => {
      const t = c.row.timesheet
      const p = c.row.person
      return [
        on,
        p?.name ?? '',
        p?.company?.name ?? '',
        p?.company?.vatNumber ?? '',
        c.row.call.project,
        c.row.call.role,
        String(t?.days.length ?? 0),
        t?.dayRateCents === null || t?.dayRateCents === undefined ? '' : amount(t.dayRateCents),
        amount(c.row.total.fees),
        amount(c.row.total.extras),
        amount(c.row.total.total),
        c.paidOn ?? '',
      ]
    })
  )
}
