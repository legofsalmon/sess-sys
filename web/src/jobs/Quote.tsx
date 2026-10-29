import {
  changesFromJob,
  dayLabel,
  daysWord,
  DEPARTMENT_LABELS,
  eachDay,
  euroText,
  irishToday,
  lineCents,
  linesByGroup,
  linesFor,
  MAX_LINES,
  money,
  newId,
  parseEuro,
  pctWord,
  plural,
  QUOTE_STATUS_LABELS,
  quoteTotals,
  spanLabel,
  STOPPED,
  STANDARD_VAT,
  VAT_LABELS,
  VAT_RATES,
  venueLabel,
  type JobChanges,
  type JobView,
  type LinePer,
  type LineKind,
  type QuoteLine,
  type QuoteStatus,
  type QuoteTotals,
  type QuoteView,
  type VatRate,
  type View,
  DEFAULT_VALID_DAYS,
  chargedFor,
  RATE_UNIT,
  type RateRule,
  depositCents,
  letterDay,
  quoteNumberLabel,
  validUntil,
  versionChanges,
  type QuoteSettings,
  packageIncludes,
  PACKAGE_INCLUDES_LENGTH,
  type Package,
  extrasFor,
  travelSettingsOf,
  FUEL_PRICE_FRESH_DAYS,
  type Extras,
  type Pin,
  lineCostOf,
  quoteKit,
  quoteMargin,
  quoteWants,
  SUPPLIER_LENGTH,
  VEHICLE_KIND_LABELS,
  type QuoteKitCheck,
  suggestionLine,
  type AskedLine,
  type QuoteMargin,
  MOST_LAST_CHARGED_NAMES,
  type RmsCharge,
  type RmsLastCharged,
} from '@sh/shared'
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Heading } from '../Icon.tsx'
import { ProductPicker } from '../ProductPicker.tsx'
import { useAccess } from '../role.ts'
import { StatusPill, type PillTone } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { JOBS } from '../Up.tsx'
import { useLate } from '../useLate.ts'
import { useToday } from '../view.ts'
import { useUnderTop } from '../useUnderTop.ts'
import { MailOnQuote, useClaude, type Advice } from './Claude.tsx'
import { Top } from './common.tsx'
import { clientWords, getJson, useAsked, useLastCharged, type RmsJob } from './rms.ts'

/**
 * A job's quote (ADR 0042), #jobs/<id>/quote, for the office and directors:
 * built from the job's kit and crew at the price list, every line open to
 * change while it's a draft, then kept as it went once it's gone to the
 * client, with a new version for any change after. It prints as an A4 page
 * to save as a PDF, as the call sheet does: nothing is sent from the app.
 * The client's answer, the invoice and the payment are records the office
 * keeps here of what happened outside it.
 */

const TONE: Record<QuoteStatus, PillTone> = { draft: 'pending', sent: 'pending', accepted: 'confirmed', declined: 'cancelled' }
const KIND_WORDS: Record<LineKind, string> = { kit: 'Kit', crew: 'Crew', other: 'Other' }

export function QuotePill({ q }: { q: QuoteView }) {
  return (
    <StatusPill tone={q.paidOn ? 'confirmed' : TONE[q.status]} pending={q.pending}>
      {q.paidOn ? 'Paid' : q.invoicedOn ? 'Invoiced' : QUOTE_STATUS_LABELS[q.status]}
    </StatusPill>
  )
}

/**
 * Sent to the client, and so the job is quoted (ADR 0081): an enquiry moves on by itself, since that's all "quoted"
 * means. A job already confirmed, or stopped, stays as it is.
 */
async function markSent(id: string, job: JobView, on: string) {
  await client.mutate('quote.sent', { id, on })
  if (job.status === 'enquiry') await client.mutate('project.update', { id: job.id, status: 'quoted' })
}

/**
 * The client has answered, and the job doesn't say so yet (ADR 0081): confirm it, or mark it lost, with one press.
 * Offered, not done by itself: confirming puts the job on the calendar and holds its kit, and losing it cancels its
 * crew calls, which the office should see happen.
 */
export function InStep({ job, want, compact }: { job: JobView; want: 'confirmed' | 'lost'; compact?: boolean }) {
  const { run, error } = useAct()
  const go = () => void run(() => client.mutate('project.update', { id: job.id, status: want }))
  return (
    <div className="in-step">
      {!compact && (
        <p>
          {want === 'confirmed'
            ? `The client accepted, and the job is still ${job.status === 'enquiry' ? 'an enquiry' : 'quoted'}. Confirming it puts it on the jobs calendar and holds its kit.`
            : `The client turned it down, and the job is still ${job.status === 'enquiry' ? 'an enquiry' : 'quoted'}. Marking it lost cancels any crew calls on it.`}
        </p>
      )}
      <button type="button" className={want === 'confirmed' ? 'primary' : undefined} onClick={go} disabled={job.pending}>
        {want === 'confirmed' ? 'Confirm the job' : 'Mark the job lost'}
      </button>
      <Refusal error={error} />
    </div>
  )
}

/** "€1,250.00 before VAT": what a quote is talked about as. */
const netWords = (t: QuoteTotals) => `${money(t.net)} before VAT`

/** The job page's card: where its quote is, for the roles that see money. */
export function QuoteCard({ job, view }: { job: JobView; view: View }) {
  const m = view.money
  const versions = m.quotesOf(job.id)
  const shown = m.draftOf(job.id) ?? m.currentOf(job.id) ?? versions[0]
  const jm = m.job(job.id)
  return (
    <section className="card quote-card" aria-label="Quote">
      <Heading icon="document">Quote</Heading>
      {!shown ? (
        <p className="empty">No quote yet. Make one from the job's kit and crew, at the price list's prices.</p>
      ) : (
        <div className="row">
          <div>
            <b>
              Version {shown.version} · {netWords(shown.totals)}
            </b>
            <p>
              {shown.status === 'draft'
                ? 'Being put together.'
                : shown.paidOn
                  ? `Paid ${dayLabel(shown.paidOn)}.`
                  : shown.invoicedOn
                    ? `Invoiced ${dayLabel(shown.invoicedOn)}${shown.invoiceRef ? ` as ${shown.invoiceRef}` : ''}.`
                    : shown.answeredOn
                      ? `${QUOTE_STATUS_LABELS[shown.status]} ${dayLabel(shown.answeredOn)}.`
                      : shown.sentOn
                        ? `Sent ${dayLabel(shown.sentOn)}.`
                        : ''}
              {versions.length > 1 && ` ${versions.length} versions.`}
            </p>
          </div>
          <QuotePill q={shown} />
        </div>
      )}
      {jm && jm.margin !== null && <MarginLine margin={jm.margin} costs={jm.costs + jm.toCome} />}
      {jm?.setAside && (
        <p className="hint">
          The job is {jm.job.status}, so its quote is set aside: it isn't counted as quoted, owed or in the margin unless it's invoiced, as a cancellation fee would be.
        </p>
      )}
      <a className={`button${shown ? '' : ' primary'}`} href={`#jobs/${encodeURIComponent(job.id)}/quote`}>
        {shown ? 'Open the quote' : 'Make a quote'}
      </a>
    </section>
  )
}

function MarginLine({ margin, costs }: { margin: number; costs: number }) {
  return (
    <p className={`margin-line${margin < 0 ? ' bad' : ''}`}>
      Margin after freelancers: <b>{money(margin)}</b>
      {costs > 0 && <span className="muted"> ({money(costs)} of freelancers)</span>}
    </p>
  )
}

export function QuoteScreen({ view, jobId }: { view: View; jobId: string }) {
  const job = view.jobs.jobs.find((j) => j.id === jobId)
  const sees = useAccess().can('money')
  // What a quote makes (ADR 0089) is seen by all who see quotes: the office and directors.
  const boss = sees
  const m = view.money
  const versions = m.quotesOf(jobId)
  const [picked, setPicked] = useState<string>()
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(false)
    addEventListener('afterprint', done)
    const frame = requestAnimationFrame(() => print())
    return () => {
      cancelAnimationFrame(frame)
      removeEventListener('afterprint', done)
    }
  }, [printing])
  const today = useToday()
  const up = { steps: job ? [JOBS, { href: `#jobs/${encodeURIComponent(job.id)}`, label: job.name }] : [JOBS], here: 'Quote' }

  if (!job || !sees)
    return (
      <div className="app crew jobs quote-screen">
        <Top view={view} up={up} />
        <section className="card">
          <p className="empty">
            {!sees
              ? 'Quotes and prices are for the office and directors. A director can change your role on the Crew tab.'
              : "This job isn't on this device. It may still be on its way: check again once it says “Up to date”."}
          </p>
        </section>
      </div>
    )

  const q = versions.find((v) => v.id === picked) ?? m.draftOf(jobId) ?? m.currentOf(jobId) ?? versions[0]
  const current = m.currentOf(jobId)
  const settled = versions.some((v) => v.invoicedOn)
  const jm = m.job(jobId)

  return (
    <div className="app crew jobs quote-screen">
      <Top view={view} up={up} />
      <section className="card">
        <p className="kicker">Quote</p>
        <h1>{job.name}</h1>
        <p>{[job.client?.name ?? 'No client yet', job.span ? spanLabel(job.span) : 'No dates yet'].join(' · ')}</p>
        {versions.length > 1 && (
          <div className="filters" role="group" aria-label="Versions">
            {versions.map((v) => (
              <button key={v.id} type="button" aria-pressed={v.id === q?.id} onClick={() => setPicked(v.id)}>
                Version {v.version} · {v.paidOn ? 'Paid' : v.invoicedOn ? 'Invoiced' : QUOTE_STATUS_LABELS[v.status]}
              </button>
            ))}
          </div>
        )}
        {q && !q.latest && <p className="hint">An older version, kept as it went to the client. The newest is version {versions[0]!.version}.</p>}
        {jm && jm.margin !== null && q?.id === current?.id && <MarginLine margin={jm.margin} costs={jm.costs + jm.toCome} />}
      </section>

      {q && <SinceBefore q={q} versions={versions} />}

      {!q ? (
        <FirstQuote view={view} job={job} />
      ) : q.status === 'draft' ? (
        <Draft key={q.id} q={q} view={view} job={job} onPrint={() => setPrinting(true)} />
      ) : (
        <>
          <section className="card" aria-label={`Version ${q.version}`}>
            <header className="title">
              <h2>Version {q.version}</h2>
              <QuotePill q={q} />
            </header>
            <p className="quote-facts">
              {q.number ? `Quote ${q.number}` : 'Sent before quotes had numbers'} · Valid until {dayLabel(validUntil(q, today))}
              {q.depositPct ? ` · A deposit of ${pctWord(q.depositPct)}, ${money(depositCents(q.totals.gross, q.depositPct))}` : ''}
            </p>
            <Lines lines={q.lines} />
            <Totals totals={q.totals} agreed={q.agreedCents != null} />
            {boss && (
              <p className="quote-margin">
                <MarginWords margin={quoteMargin(q.totals.net, q.lines.map((l) => lineCostOf(l, l.kind === 'crew' ? m.bookedRate(job.id, l) : undefined)))} />
                <small> Not printed.</small>
              </p>
            )}
            {q.notes && <p className="notes">{q.notes}</p>}
            <div className="actions">
              <button type="button" className="primary" onClick={() => setPrinting(true)} disabled={printing}>
                Print or save as PDF
              </button>
              {q.latest && !settled && <NewVersion q={q} onMade={setPicked} />}
            </div>
            {settled && q.latest && <p className="hint">The quote is invoiced, so it's settled: no new version.</p>}
          </section>
          {q.id === current?.id && <Records q={q} job={job} />}
        </>
      )}

      <InCurrentRms jobId={job.id} />

      {printing &&
        q &&
        createPortal(
          <div className="print-sheet quote-sheet">
            <style>{'@page { size: A4; margin: 14mm; }'}</style>
            <QuoteSheet q={q} job={job} office={view.office} quoting={m.quoting} />
          </div>,
          document.body
        )}
    </div>
  )
}

/** What changed since the version before (ADR 0084), so the office can tell the client in a sentence. */
function SinceBefore({ q, versions }: { q: QuoteView; versions: QuoteView[] }) {
  const before = versions.find((v) => v.version < q.version)
  if (!before) return null
  const c = versionChanges(before, q)
  const gross = q.totals.gross - before.totals.gross
  const terms = (l: QuoteLine) => (l.per === 'once' ? `${l.qty} at ${money(l.unitCents)} once` : `${l.qty} for ${daysWord(l.days)} at ${money(l.unitCents)} a day`)
  const none = c.added.length + c.removed.length + c.changed.length === 0 && !c.discount && !c.agreed
  return (
    <section className="card version-changes" aria-label={`What changed since version ${before.version}`}>
      <h2>What changed since version {before.version}</h2>
      {none ? (
        <p>Nothing in the lines or the discount: the same {money(q.totals.gross)}.</p>
      ) : (
        <>
          <ul>
            {c.added.map((l) => (
              <li key={l.id}>
                Added {l.what}: {terms(l)}
              </li>
            ))}
            {c.removed.map((l) => (
              <li key={l.id}>Took off {l.what}</li>
            ))}
            {c.changed.map(({ line, was }) => (
              <li key={line.id}>
                {line.what}: {terms(line)}, was {terms(was)}
              </li>
            ))}
            {c.agreed && (
              <li>
                {c.agreed.now === null ? `No price agreed, was ${money(c.agreed.was!)}` : c.agreed.was === null ? `Price agreed at ${money(c.agreed.now)} before VAT` : `Price agreed ${money(c.agreed.now)}, was ${money(c.agreed.was)}`}
              </li>
            )}
            {c.discount && (
              <li>
                Discount {pctWord(c.discount.now)}, was {pctWord(c.discount.was)}
              </li>
            )}
          </ul>
          <p>
            The total is <b>{money(q.totals.gross)}</b>,{' '}
            {gross === 0 ? 'the same as before' : `${money(Math.abs(gross))} ${gross > 0 ? 'more' : 'less'} than version ${before.version}'s ${money(before.totals.gross)}`}.
          </p>
        </>
      )}
    </section>
  )
}

/** With no quote yet: one built from the job, which the office then changes. */
function FirstQuote({ view, job }: { view: View; job: JobView }) {
  const m = view.money
  const { run, error } = useAct()
  const source = m.sourceOf(job.id)
  const unpriced = source.kit.filter((k) => m.productPrice(k.modelId) === undefined).length
  const discount = m.discountOf(job.clientId)
  const build = (withLines: boolean) => {
    const lines = withLines ? linesFor(source.kit, source.crew, { product: m.productPrice, role: m.rolePrice, rate: m.productRate }, newId) : []
    void run(() => client.mutate('quote.save', { id: newId(), projectId: job.id, lines: lines.slice(0, MAX_LINES), discountPct: discount ?? 0, notes: '' }))
  }
  return (
    <section className="card" aria-label="Make a quote">
      <h2>Make a quote</h2>
      {source.kit.length + source.crew.length === 0 ? (
        <Empty>The job has no kit or crew yet, so a quote would start empty. Add them first, or start one empty and type the lines.</Empty>
      ) : (
        <p>
          {source.kit.length} kit line{source.kit.length === 1 ? '' : 's'} and {source.crew.length} crew call{source.crew.length === 1 ? '' : 's'}, each for the days
          it's out or worked, at the price list's day prices
          {discount ? `, with ${job.client?.name}'s ${pctWord(discount)} off` : ''}. You can change any of it before it goes.
        </p>
      )}
      {unpriced > 0 && (
        <p className="warn-line">
          {unpriced} product{unpriced === 1 ? " has" : 's have'} no day price yet, so {unpriced === 1 ? 'it goes' : 'they go'} in at nothing to price. Set prices on the{' '}
          <a href="#jobs/money/prices">price list</a> for next time.
        </p>
      )}
      <Refusal error={error} />
      <div className="actions">
        {source.kit.length + source.crew.length > 0 && (
          <button type="button" className="primary" onClick={() => build(true)}>
            Build it from the job
          </button>
        )}
        <button type="button" onClick={() => build(false)}>
          Start one empty
        </button>
      </div>
    </section>
  )
}

/** A line as it's being typed: the numbers as text until saved. */
interface LineDraft {
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
const toDraft = (l: QuoteLine): LineDraft => ({
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
const sameLine = (a: QuoteLine, b: QuoteLine) =>
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
const num = (s: string) => Number(s.trim().replace(',', '.'))

/** What a typed line comes to, or why it can't be saved. */
function readLine(d: LineDraft, n: number): QuoteLine | string {
  const price = parseEuro(d.price)
  const where = `Line ${n}${d.what.trim() ? ` (${d.what.trim()})` : ''}`
  if (!d.what.trim()) return `Line ${n}: say what it's for.`
  if (price.reason) return `${where}: ${price.reason}`
  const qty = num(d.qty)
  if (!Number.isInteger(qty) || qty < 1 || qty > 10_000) return `${where}: how many is a whole number from 1 to 10,000.`
  // Charged by a rule (ADR 0085), the days charged are what the rule makes of the days out.
  const ruled = d.per === 'day' && d.rate !== null
  const out = ruled ? num(d.out) : undefined
  if (out !== undefined && !(out >= 0.5 && out <= 365 && Number.isInteger(out * 2))) return `${where}: days out is a number of days, in halves, from 0.5 to 365.`
  // Charged once, a line keeps 1 for its days, so a device from before this reads the same amount.
  const days = d.per === 'once' ? 1 : out !== undefined ? chargedFor(d.rate!, out) : num(d.days)
  if (!(days >= 0.5 && days <= 365 && Number.isInteger(days * 2))) return `${where}: days charged is a number of days, in halves, from 0.5 to 365.`
  const off = d.discount.trim() ? num(d.discount.replace(/%$/, '')) : 0
  if (!(off >= 0 && off <= 100 && Number.isInteger(off * 10))) return `${where}: a line's discount is a percentage from 0 to 100, such as 30 or 12.5.`
  const hired = d.kind === 'kit' && d.subhire.trim() ? num(d.subhire) : 0
  if (!(Number.isInteger(hired) && hired >= 0 && hired <= qty)) return `${where}: how many are hired in is a whole number, no more than the ${qty} on the line.`
  const cost = d.cost.trim() ? parseEuro(d.cost) : undefined
  if (cost?.reason) return `${where}: what it costs us: ${cost.reason}`
  const supplier = hired ? d.supplier.trim().slice(0, SUPPLIER_LENGTH) : ''
  return {
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
  }
}

/** A tidy figure under the lines' total to offer as an agreed price: down to the nearest €50. */
const roundDown = (cents: number) => Math.floor(cents / 5000) * 5000

/** Puts one discount on every line of a department, which each line can still change on its own. */
function GroupDiscount({ group, onApply, refuse }: { group: string; onApply: (off: string) => void; refuse: (why: string) => void }) {
  const [off, setOff] = useState('')
  const apply = () => {
    const n = num(off.replace(/%$/, ''))
    if (!(n >= 0 && n <= 100 && Number.isInteger(n * 10))) return refuse('A discount is a percentage from 0 to 100, such as 30 or 12.5.')
    onApply(n ? String(n) : '')
    setOff('')
  }
  return (
    <div className="group-discount">
      <label>
        Discount on every {group || 'one'} line
        <input inputMode="decimal" value={off} onChange={(e) => setOff(e.target.value)} placeholder="%" aria-label={`Discount on every ${group} line, %`} />
      </label>
      <button type="button" onClick={apply} disabled={!off.trim()}>
        Apply
      </button>
    </div>
  )
}

/** How a line is charged, as one choice: by the day, by a rule, or once. */
type Charge = 'daily' | 'week3' | 'weekly' | 'once'
const chargeOf = (l: Pick<LineDraft, 'per' | 'rate'>): Charge => (l.per === 'once' ? 'once' : (l.rate ?? 'daily'))
const CHARGE_LABELS: Record<Charge, string> = { daily: 'a day', week3: '3 Day Week', weekly: 'a week', once: 'once' }

/** How long the draft waits after the last key before it saves itself. */
const SAVE_AFTER_MS = 1_200

/**
 * What's typed on a draft that can't save yet (a line with nothing to say what it's for, a price that isn't one) is kept on
 * this device for the tab's life, as places.ts keeps scroll places, so going to another screen and coming back doesn't
 * lose it (audit, 20 October 2026, finding 27). Kept against the draft as it's saved: once that changes, from here or
 * another device, what was typed over the older one is let go. What can save saves itself, so nothing is kept for it.
 */
const TYPED_STORE = 'session-hire-quote-typed'
interface Typed {
  base: string
  lines: LineDraft[]
  meals: boolean
  kmTyped: string
  discount: string
  agreed: string
  notes: string
  validFor: string
  deposit: string
}
const baseOf = (q: QuoteView) =>
  JSON.stringify([q.lines, q.discountPct, q.agreedCents ?? null, q.notes, q.validDays ?? null, q.depositPct ?? null, q.mealsProvided ?? false, q.travelKm ?? null])
function readTyped(): Record<string, Typed> {
  try {
    return JSON.parse(sessionStorage.getItem(TYPED_STORE) ?? '{}') as Record<string, Typed>
  } catch {
    return {}
  }
}
function typedOf(q: QuoteView): Typed | undefined {
  const t = readTyped()[q.id]
  return t && t.base === baseOf(q) && Array.isArray(t.lines) ? t : undefined
}
function keepTyped(id: string, t: Typed | undefined) {
  const all = readTyped()
  if (!t && !(id in all)) return
  if (t) all[id] = t
  else delete all[id]
  try {
    sessionStorage.setItem(TYPED_STORE, JSON.stringify(all))
  } catch {
    // Storage that's off or full keeps it for as long as the quote stays open.
  }
}

/** The job's days, which a line added on the quote is charged for until changed. */
const jobDays = (job: JobView) => (job.span ? Math.max(1, eachDay(job.span.start, job.span.end).length) : 1)

function Draft({ q, view, job, onPrint }: { q: QuoteView; view: View; job: JobView; onPrint: () => void }) {
  const today = useToday()
  const m = view.money
  const under = useUnderTop<HTMLFormElement>(true)
  // What was typed and couldn't save yet, when the quote was left (finding 27).
  const [kept] = useState(() => typedOf(q))
  // Travel and subsistence (ADR 0086) aren't typed: they're worked out below from the rest, so they're kept apart.
  const [lines, setLines] = useState<LineDraft[]>(() => kept?.lines ?? q.lines.filter((l) => !l.extra).map(toDraft))
  const [meals, setMeals] = useState(kept?.meals ?? q.mealsProvided ?? false)
  const [kmTyped, setKmTyped] = useState(kept?.kmTyped ?? (q.travelKm == null ? '' : String(q.travelKm)))
  const [discount, setDiscount] = useState(kept?.discount ?? String(q.discountPct))
  // A price agreed for the whole (ADR 0085) stands in for the discount percentage while it's there.
  const [agreed, setAgreed] = useState(kept?.agreed ?? (q.agreedCents == null ? '' : euroText(q.agreedCents)))
  const [notes, setNotes] = useState(kept?.notes ?? q.notes)
  const [validFor, setValidFor] = useState(kept?.validFor ?? String(q.validDays ?? DEFAULT_VALID_DAYS))
  const [deposit, setDeposit] = useState(kept?.deposit ?? (q.depositPct ? String(q.depositPct) : ''))
  const [kitDays, setKitDays] = useState('')
  const [sentOn, setSentOn] = useState(today)
  const [answering, setAnswering] = useState(false)
  // One line is open to change at a time; the rest read as a list, as they'll print.
  const [open, setOpen] = useState<string>()
  // The line just shut, which keeps the focus so the keyboard carries on from it.
  const [shut, setShut] = useState<string>()
  const [removed, setRemoved] = useState<{ line: LineDraft; at: number }>()
  const [adding, setAdding] = useState<'kit' | 'crew' | 'package' | 'transport'>()
  const { run, error, refuse } = useAct()
  const set = (id: string, changes: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...changes } : l)))

  // What it comes to as typed, with anything not yet a number left out.
  const read = lines.map((l, i) => readLine(l, i + 1))
  const pct = num(discount)
  const pctOk = pct >= 0 && pct <= 100 && Number.isInteger(pct * 10)
  const good = read.filter((l): l is QuoteLine => typeof l !== 'string')
  const agreedRead = agreed.trim() ? parseEuro(agreed) : undefined
  const agreedCents = agreedRead?.cents ?? null
  const kmRead = kmTyped.trim() ? num(kmTyped) : null
  const kmOk = kmRead === null || (Number.isInteger(kmRead) && kmRead >= 0 && kmRead <= 2000)
  const extras = extrasFor({
    lines: good,
    settings: travelSettingsOf(m.quoting),
    pin: pinOf(job),
    typedKm: kmOk ? kmRead : null,
    mealsProvided: meals,
    ids: Object.fromEntries(q.lines.filter((l) => l.extra).map((l) => [l.extra!, l.id])),
    newId: useStableIds(),
  })
  const all = [...good, ...extras.lines]
  const totals = quoteTotals({ lines: all, discountPct: pctOk ? pct : 0, agreedCents })
  const valid = num(validFor)
  const validOk = Number.isInteger(valid) && valid >= 1 && valid <= 365
  const dep = deposit.trim() ? num(deposit) : null
  const depOk = dep === null || (Number.isInteger(dep) && dep >= 1 && dep <= 100)
  const problem =
    read.find((l): l is string => typeof l === 'string') ??
    (agreedRead?.reason
      ? `The price agreed: ${agreedRead.reason}`
      : agreedCents !== null && agreedCents > totals.subtotal
        ? `The price agreed is more than the lines come to (${money(totals.subtotal)}). Agree a lower price, or change the lines.`
        : !kmOk
        ? 'The distance is a whole number of km from 0 to 2,000, or nothing to take it from the map.'
        : !pctOk
      ? 'A discount is a percentage from 0 to 100, such as 10 or 12.5.'
      : !validOk
        ? 'Prices hold for a whole number of days from 1 to 365.'
        : !depOk
          ? 'A deposit is a whole percentage from 1 to 100, such as 25 or 50, or nothing for none.'
          : undefined)
  // Saved: what's typed comes to what the draft holds.
  const saved =
    read.length + extras.lines.length === q.lines.length &&
    read.every((l) => typeof l !== 'string') &&
    all.every((l, i) => sameLine(l, q.lines[i]!)) &&
    meals === (q.mealsProvided ?? false) &&
    kmRead === (q.travelKm ?? null) &&
    pct === q.discountPct &&
    agreedCents === (q.agreedCents ?? null) &&
    q.notes.trim() === notes.trim() &&
    valid === (q.validDays ?? DEFAULT_VALID_DAYS) &&
    dep === (q.depositPct ?? null)
  const unpriced = good.filter((l) => l.unitCents === 0).length
  // Whether there's enough of each product on the job's days (ADR 0089), as the job's kit is checked.
  const checks = quoteKit(job, quoteWants(good, (id) => m.package(id)?.items), today, {
    kit: view.kit,
    models: (id) => view.warehouse.models.find((x) => x.id === id),
    unusable: view.faults.unusable,
    lateOut: view.moves.lateOut,
  })
  const shortLines = good.filter((l) => linesShort(l, checks, m.package(l.packageId ?? '')?.items).length > 0).length
  // What it makes (ADR 0089), for the office and directors, who see quotes at all.
  const boss = useAccess().can('money')
  const costOf = (l: QuoteLine) => lineCostOf(l, l.kind === 'crew' ? m.bookedRate(job.id, l) : undefined)
  const margin = quoteMargin(totals.net, all.map(costOf))
  // What each line was last charged in Current RMS (ADR 0092), by the names it goes by there.
  const namesOf = (l: LineDraft) => rmsNames(l, (id) => view.warehouse.models.find((x) => x.id === id))
  const last = useLastCharged(boss, job.id, lines.flatMap(namesOf).slice(0, MOST_LAST_CHARGED_NAMES))

  // The draft saves itself a moment after typing stops, once it reads as a quote: there's no Save to forget. Leaving
  // the page saves what's waiting at once. Saving goes through the device's queue, so it works with no signal.
  const payload =
    !saved && !problem
      ? { id: q.id, projectId: job.id, lines: all.slice(0, MAX_LINES), discountPct: pct, agreedCents, notes, validDays: valid, depositPct: dep, mealsProvided: meals, travelKm: kmRead }
      : undefined
  const waiting = useRef(payload)
  waiting.current = payload
  const flush = () => {
    const p = waiting.current
    if (!p) return
    waiting.current = undefined
    void run(() => client.mutate('quote.save', p))
  }
  const key = payload ? JSON.stringify(payload) : ''
  useEffect(() => {
    if (!key) return
    const t = setTimeout(flush, SAVE_AFTER_MS)
    return () => clearTimeout(t)
  }, [key])
  useEffect(() => () => flush(), [])
  const late = useLate(!!payload)
  // Kept on the device while it can't save (finding 27), and let go once it can.
  const typed = !saved && problem ? JSON.stringify({ base: baseOf(q), lines, meals, kmTyped, discount, agreed, notes, validFor, deposit } satisfies Typed) : ''
  useEffect(() => keepTyped(q.id, typed ? (JSON.parse(typed) as Typed) : undefined), [typed])

  const days = jobDays(job)
  const addLine = (
    l: Omit<LineDraft, 'id' | 'rate' | 'out' | 'discount' | 'packageId' | 'includes' | 'subhire' | 'supplier' | 'cost'> & Partial<Pick<LineDraft, 'rate' | 'packageId' | 'includes' | 'cost'>>
  ) => {
    const id = newId()
    setLines((ls) => [...ls, { rate: null, out: l.days, discount: '', packageId: null, includes: '', subhire: '', supplier: '', cost: '', id, ...l }])
    setOpen(id)
    setAdding(undefined)
  }
  const addKit = (modelId: string) => {
    const model = view.warehouse.models.find((x) => x.id === modelId)
    if (!model) return
    const cents = m.productPrice(modelId)
    // Charged by the product's rule (ADR 0085), for the job's days out.
    const rate = m.productRate(modelId)
    addLine({
      kind: 'kit',
      what: model.name,
      ref: null,
      modelId,
      group: DEPARTMENT_LABELS[model.department],
      qty: '1',
      days: String(days),
      price: cents === undefined ? '' : euroText(cents),
      vat: STANDARD_VAT,
      per: 'day',
      rate: rate && rate !== 'daily' ? rate : null,
    })
  }
  // A package (ADR 0087) goes on as one line at its price and rule, with what it holds now written on the line, so the
  // quote prints as it was made however the package changes after.
  const addPackage = (packageId: string) => {
    const p = m.package(packageId)
    if (!p) return
    addLine({
      kind: 'kit',
      what: p.name,
      ref: null,
      modelId: null,
      group: DEPARTMENT_LABELS[p.department],
      qty: '1',
      days: String(days),
      price: euroText(p.dayCents),
      vat: STANDARD_VAT,
      per: 'day',
      rate: p.rate && p.rate !== 'daily' ? p.rate : null,
      packageId: p.id,
      includes: packageIncludes(p, (id) => view.warehouse.models.find((x) => x.id === id)?.name),
    })
  }
  const addCrew = (role: string) => {
    const r = m.roles.find((x) => x.role === role)
    const cents = r?.cents ?? r?.booked
    addLine({ kind: 'crew', what: role, ref: null, modelId: null, group: 'Crew', qty: '1', days: String(days), price: cents === undefined ? '' : euroText(cents), vat: STANDARD_VAT, per: 'day' })
  }
  const addOther = () => addLine({ kind: 'other', what: '', ref: null, modelId: null, group: '', qty: '1', days: '1', price: '', vat: STANDARD_VAT, per: 'once' })
  // Transport (ADR 0089): charged once, with what it costs us beside it; named for a van booked on the job when there is one.
  const addTransport = (what: string, ref: string | null) =>
    addLine({ kind: 'other', what, ref, modelId: null, group: 'Transport', qty: '1', days: '1', price: '', vat: STANDARD_VAT, per: 'once' })
  const vans = view.vehicles.ofJob(job.id).filter((b) => b.vehicle && !lines.some((l) => l.ref === b.id))
  const remove = (l: LineDraft) => {
    setRemoved({ line: l, at: lines.indexOf(l) })
    setLines((ls) => ls.filter((x) => x.id !== l.id))
    if (open === l.id) setOpen(undefined)
  }
  // A short line hires in what it's short of (ADR 0089), then opens for who from and what it costs.
  const hireIn = (l: LineDraft, n: number) => {
    set(l.id, { subhire: String(Math.min(num(l.qty), (num(l.subhire) || 0) + n)) })
    setOpen(l.id)
  }
  const undoRemove = () => {
    if (!removed) return
    setLines((ls) => [...ls.slice(0, removed.at), removed.line, ...ls.slice(removed.at)])
    setRemoved(undefined)
  }
  const allKitDays = () => {
    const d = num(kitDays)
    if (!(d >= 0.5 && d <= 365 && Number.isInteger(d * 2))) return refuse('Days charged is a number of days, in halves, from 0.5 to 365.')
    // Lines charged by a rule work theirs out from their days out (ADR 0085), so this is for those charged by the day.
    setLines((ls) => ls.map((l) => (l.kind === 'kit' && l.per === 'day' && !l.rate ? { ...l, days: String(d) } : l)))
    setKitDays('')
  }
  // A department's discount (ADR 0085) is put on each of its lines, so each line still says what it's charged.
  const groupDiscount = (group: string, off: string) => setLines((ls) => ls.map((l) => (l.group === group ? { ...l, discount: off } : l)))
  const groups = linesByGroup(lines)
  const kitLines = lines.filter((l) => l.kind === 'kit' && l.per === 'day' && !l.rate).length
  const source = m.sourceOf(job.id)
  // Every line counts here, finished or not, so one being typed isn't offered again as new on the job.
  const asLines = lines.map((l): QuoteLine => ({ id: l.id, kind: l.kind, what: l.what, ref: l.ref, group: l.group, qty: num(l.qty), days: 1, unitCents: 0, vat: l.vat }))
  const changes = changesFromJob(asLines, source.kit, source.crew, { product: m.productPrice, role: m.rolePrice, rate: m.productRate }, newId)
  // What the mail asks for since the draft was changed (ADR 0098) is shown against the lines as they read, and taken here as if typed.
  const claude = useClaude(view)
  const asked: AskedLine[] = good.map((l) => ({ id: l.id, kind: l.kind, what: l.what, group: l.group, qty: l.qty, days: l.out ?? l.days, per: l.per ?? 'day', unitCents: l.unitCents, discountPct: l.discountPct ?? 0 }))
  const takeAdvice = (a: Advice) => {
    setLines((ls) => [
      ...ls
        .filter((l) => !a.remove[l.id])
        .map((l) => {
          const c = a.change[l.id] ? a.advice.change.find((x) => x.lineId === l.id) : undefined
          if (!c) return l
          return {
            ...l,
            ...(c.qty != null ? { qty: String(c.qty) } : {}),
            // A line charged by a rule (ADR 0085) is shown its days out, so those are what change.
            ...(c.days != null && l.per === 'day' ? (l.rate ? { out: String(c.days) } : { days: String(c.days) }) : {}),
            ...(c.discountPct != null ? { discount: c.discountPct ? String(c.discountPct) : '' } : {}),
            ...(c.priceCents != null ? { price: euroText(c.priceCents) } : {}),
          }
        }),
      ...a.add.filter((x) => x.take).map((x) => toDraft(suggestionLine(x.s, newId()))),
    ])
    if (a.discount && a.advice.discountPct !== null) setDiscount(String(a.advice.discountPct))
  }

  return (
    <form
      ref={under}
      className="card quote-draft"
      aria-label={`Version ${q.version}, a draft`}
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        flush()
      }}
    >
      <header className="title">
        <h2>Version {q.version}</h2>
        <QuotePill q={q} />
      </header>
      {/* What it comes to, in view while the lines are changed below. */}
      <div className="quote-summary" role="group" aria-label="What it comes to">
        <span>
          Before VAT <b>{money(totals.net)}</b>
        </span>
        <span>
          Total <b>{money(totals.gross)}</b>
        </span>
        {unpriced > 0 && <span className="warn">{plural(unpriced, 'line')} with no price</span>}
        {shortLines > 0 && <span className="warn">{plural(shortLines, 'line')} short of kit</span>}
        {boss && <MarginWords margin={margin} />}
        <span className="save-state" aria-live="polite">
          {problem ? 'Not saved yet' : payload ? (late ? 'Saving…' : '') : q.pending ? 'Saved on this device' : 'Saved'}
        </span>
      </div>

      <JobChangesCard changes={changes} quoteId={q.id} onTake={(next) => setLines((ls) => next(ls))} />
      {claude.offered && <MailOnQuote view={view} projectId={job.id} jobDays={days} lines={asked} discountPct={pctOk ? pct : 0} onTake={takeAdvice} />}

      {lines.length === 0 && <Empty>No lines yet. Add kit, crew or anything else the quote is for.</Empty>}
      {groups.map((g) => (
        <fieldset key={g.group} className="quote-group">
          <legend>{g.group}</legend>
          {g.lines.map((l) => {
            const n = lines.indexOf(l) + 1
            const r = read[n - 1]
            const done = r !== undefined && typeof r !== 'string' ? r : undefined
            const kit = done && <KitNote l={done} checks={checks} items={m.package(l.packageId ?? '')?.items} names={(id) => view.warehouse.models.find((x) => x.id === id)?.name} onHire={l.modelId ? (k) => hireIn(l, k) : undefined} full={open === l.id} />
            const cost = done ? costOf(done) : undefined
            return open !== l.id ? (
              <div key={l.id} className="quote-line-row">
                <LineSummary l={l} n={n} r={r} onOpen={() => setOpen(l.id)} focus={shut === l.id} margin={boss && done ? lineMargin(done, cost) : undefined} />
                {kit}
              </div>
            ) : (
              <LineEditor key={l.id} l={l} n={n} r={r} set={(c) => set(l.id, c)} onRemove={() => remove(l)} onDone={() => {
                  setShut(l.id)
                  setOpen(undefined)
                }}
                kit={kit}
                cost={<CostFields l={l} n={n} r={done} cost={cost} boss={boss} suppliers={view.kit.suppliers} set={(c) => set(l.id, c)} />}
                last={<LastCharged found={lastOf(last, namesOf(l))} n={n} price={l.price} onUse={(cents) => set(l.id, { price: euroText(cents) })} />}
              />
            )
          })}
          {g.lines.length > 1 && <GroupDiscount group={g.group} onApply={(off) => groupDiscount(g.group, off)} refuse={refuse} />}
        </fieldset>
      ))}
      <TravelAndSubsistence extras={extras} meals={meals} setMeals={setMeals} km={kmTyped} setKm={setKmTyped} fuelSetOn={m.quoting.fuelSetOn ?? null} today={today} />
      {removed && (
        <p className="undo-line" aria-live="polite">
          Removed “{removed.line.what || 'a line'}”.{' '}
          <button type="button" className="link" onClick={undoRemove}>
            Undo
          </button>
        </p>
      )}

      <div className="quote-add" role="group" aria-label="Add to the quote">
        {adding === 'kit' ? (
          <div className="adding">
            <ProductPicker label="Kit to add" products={view.warehouse.models} value="" onPick={addKit} hint="Priced from the price list, for the job's days." />
            <button type="button" className="link" onClick={() => setAdding(undefined)}>
              Cancel
            </button>
          </div>
        ) : adding === 'package' ? (
          <AddPackage packages={m.packages} onAdd={addPackage} onCancel={() => setAdding(undefined)} />
        ) : adding === 'transport' ? (
          <AddTransport
            vans={vans.map((b) => ({ id: b.id, what: transportWords(b.vehicle!.kind, !!b.driver), name: `${b.vehicle!.name}${b.driver ? `, ${b.driver.name} driving` : ''}` }))}
            onAdd={addTransport}
            onCancel={() => setAdding(undefined)}
          />
        ) : adding === 'crew' ? (
          <AddCrew roles={m.roles.map((r) => r.role)} onAdd={addCrew} onCancel={() => setAdding(undefined)} />
        ) : (
          <>
            <button type="button" onClick={() => setAdding('kit')} disabled={lines.length >= MAX_LINES}>
              Add kit
            </button>
            {m.packages.length > 0 && (
              <button type="button" onClick={() => setAdding('package')} disabled={lines.length >= MAX_LINES}>
                Add a package
              </button>
            )}
            <button type="button" onClick={() => setAdding('crew')} disabled={lines.length >= MAX_LINES}>
              Add crew
            </button>
            <button type="button" onClick={() => setAdding('transport')} disabled={lines.length >= MAX_LINES}>
              Add transport
            </button>
            <button type="button" onClick={addOther} disabled={lines.length >= MAX_LINES}>
              Add something else
            </button>
          </>
        )}
      </div>
      {kitLines > 0 && (
        <div className="kit-days-all">
          <label>
            Charge all kit for
            <input inputMode="decimal" value={kitDays} onChange={(e) => setKitDays(e.target.value)} placeholder="3" aria-label="Days charged for all kit" />
            days
          </label>
          <button type="button" onClick={allKitDays} disabled={!kitDays.trim()}>
            Apply
          </button>
          <p className="hint">A week's hire charged as three days, say. Each line's days can still be changed on its own.</p>
        </div>
      )}
      <div className="quote-terms quote-discount">
        {agreedCents === null ? (
          <label className="field">
            Discount, %
            <input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} aria-label="Discount, %" />
            {m.discountOf(job.clientId) !== undefined && <small>{job.client?.name} usually gets {pctWord(m.discountOf(job.clientId)!)} off.</small>}
          </label>
        ) : (
          <div className="field">
            Discount
            <p className="agreed-note">
              {money(totals.discount)} off, {pctWord(totals.discountPct)}, to come to the price agreed.
            </p>
          </div>
        )}
        <label className="field">
          Agree a total
          <span className="with-unit">
            €
            <input inputMode="decimal" value={agreed} onChange={(e) => setAgreed(e.target.value)} placeholder="None" aria-label="Agreed price before VAT, €" />
          </span>
          <small>{agreed.trim() ? 'Before VAT. Clear it to go back to a discount percentage.' : `The price agreed before VAT, say ${money(roundDown(totals.subtotal))}. The discount becomes whatever comes to it.`}</small>
        </label>
      </div>
      <label className="field">
        Notes for the client
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} placeholder="Load in from 8am. Prices include delivery to the venue." />
      </label>
      <div className="quote-terms">
        <label className="field">
          Prices hold for
          <span className="with-unit">
            <input inputMode="numeric" value={validFor} onChange={(e) => setValidFor(e.target.value)} aria-label="Prices hold for, days" />
            days
          </span>
          <small>Printed as “Valid until” {dayLabel(validUntil({ sentOn: null, validDays: validOk ? valid : DEFAULT_VALID_DAYS }, today))}, counted from the day it's sent.</small>
        </label>
        <label className="field">
          Deposit, %
          <input inputMode="numeric" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="None" aria-label="Deposit, %" />
          {dep !== null && depOk && <small>{money(depositCents(totals.gross, dep))} before the job, of {money(totals.gross)}.</small>}
        </label>
      </div>
      <Totals totals={totals} agreed={agreedCents !== null} />
      <Refusal error={error} />
      <div className="actions">
        <button type="button" onClick={onPrint} disabled={!saved}>
          Print a draft
        </button>
      </div>
      {!saved && problem && <p className="warn-line">{problem} It saves once that's put right.</p>}
      {saved && q.lines.length > 0 && (
        <div className="quote-send">
          <label>
            Sent to the client on
            <input type="date" value={sentOn} max={irishToday()} onChange={(e) => setSentOn(e.target.value)} />
          </label>
          <button type="button" className="primary" onClick={() => void run(() => markSent(q.id, job, sentOn || today))}>
            Mark as sent
          </button>
          {!answering ? (
            <button type="button" className="link" onClick={() => setAnswering(true)}>
              Accepted already, by phone?
            </button>
          ) : (
            <button type="button" onClick={() => void run(() => client.mutate('quote.answer', { id: q.id, answer: 'accepted', on: sentOn || today }))}>
              Record it as accepted
            </button>
          )}
          <p className="hint">
            Marked sent, it becomes quote {m.quotesOf(job.id).find((v) => v.number)?.number ?? m.nextNumber} and stays as it is. Then print it as a PDF and send it yourself: the app sends
            nothing.
          </p>
        </div>
      )}
    </form>
  )
}

/** Where a job is on the map: its venue's pin, or else the first of its phases' venues that has one. */
const pinOf = (job: JobView): Pin | null => job.venue?.pin ?? job.phases.find((p) => p.venue?.pin)?.venue?.pin ?? null

/** New ids that stay the same from one draw to the next, so a line worked out afresh isn't a change each time. */
function useStableIds() {
  const made = useRef<string[]>([])
  let n = 0
  return () => (made.current[n++] ??= newId())
}

/** Days since a day, for how old the fuel price is. */
const daysSince = (from: string, today: string) => Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)

/**
 * The crew's travel and subsistence (ADR 0086), worked out by the quote: the lines it comes to, or why there isn't one,
 * with the two things the office says about this job: the distance, if the map's is wrong, and whether the job gives
 * the crew their meals.
 */
function TravelAndSubsistence(p: { extras: Extras; meals: boolean; setMeals: (b: boolean) => void; km: string; setKm: (s: string) => void; fuelSetOn: string | null; today: string }) {
  const { travel, subsistence, lines } = p.extras
  const line = (extra: 'travel' | 'subsistence') => lines.find((l) => l.extra === extra)
  const t = line('travel')
  const s = line('subsistence')
  const old = t && p.fuelSetOn && daysSince(p.fuelSetOn, p.today) > FUEL_PRICE_FRESH_DAYS
  return (
    <fieldset className="quote-group quote-extras">
      <legend>Travel and subsistence</legend>
      <div className="quote-extra">
        <div className="extra-line">
          <span className="what">{t ? t.what : 'No travel'}</span>
          <span className="how">{t ? `${t.qty} × ${money(t.unitCents)}, a car's fuel there and back` : travel.none}</span>
          <span className="amount">{t ? money(lineCents(t)) : '–'}</span>
        </div>
        <label className="field extra-km">
          Distance each way
          <span className="with-unit">
            <input inputMode="numeric" value={p.km} onChange={(e) => p.setKm(e.target.value)} placeholder={travel.from === 'none' ? 'km' : String(travel.km)} aria-label="Distance each way from Dublin city centre, km" />
            km
          </span>
          <small>
            {p.km.trim()
              ? 'As typed. Clear it to take it from the map again.'
              : travel.from === 'map'
                ? "From the venue's pin, a fifth more than a straight line for the roads. Type the real distance if it's out."
                : 'From Dublin city centre to the venue.'}
          </small>
        </label>
        {old && <p className="warn-line">The fuel price was set {daysSince(p.fuelSetOn!, p.today)} days ago. Check it in Admin › Company.</p>}
      </div>
      <div className="quote-extra">
        <div className="extra-line">
          <span className="what">{s ? s.what : 'No subsistence'}</span>
          <span className="how">{s ? `${s.qty} × ${money(s.unitCents)} a day` : subsistence.none}</span>
          <span className="amount">{s ? money(lineCents(s)) : '–'}</span>
        </div>
        <label className="signal">
          <input type="checkbox" role="switch" checked={p.meals} onChange={(e) => p.setMeals(e.target.checked)} />
          <span>
            <b>Meals provided</b>
            <small>{p.meals ? 'The job gives the crew their meals, so no subsistence is charged.' : 'On if the job gives the crew their meals.'}</small>
          </span>
        </label>
      </div>
      <p className="hint">Worked out from the crew lines, the venue and Admin's rates, and kept up to date as they change.</p>
    </fieldset>
  )
}

/** "4 × €45.00 a day × 3 days", or "€150.00 once". */
function lineWords(l: LineDraft, r: QuoteLine | string | undefined) {
  if (r === undefined || typeof r === 'string') return 'Not finished'
  return chargeWords(r)
}

/** "4 × €45.00 a day × 3 days", "12 × €55.00 a week × 1 week", "€150.00 once", with a line's discount after. */
function chargeWords(r: QuoteLine) {
  const each = r.unitCents ? money(r.unitCents) : 'no price'
  const off = r.discountPct ? `, less ${pctWord(r.discountPct)}` : ''
  if (r.per === 'once') return `${r.qty === 1 ? '' : `${r.qty} × `}${each} once${off}`
  if (r.rate === 'weekly') return `${r.qty} × ${each} a week × ${r.days} week${r.days === 1 ? '' : 's'}${off}`
  const rule = r.rate === 'week3' && r.out !== undefined && r.out !== r.days ? ` (${daysWord(r.out)} out, 3 Day Week)` : ''
  return `${r.qty} × ${each} a day × ${daysWord(r.days)}${rule}${off}`
}

/** A line's margin (ADR 0089): what it's charged, after its own discount, less what it costs; undefined while its cost isn't known. */
const lineMargin = (l: QuoteLine, cost: number | undefined) => (cost === undefined ? undefined : lineCents(l) - cost)

/** "Margin €3,400.00, 62%", with the lines whose cost isn't known yet: on the screen only, never printed. */
function MarginWords({ margin }: { margin: QuoteMargin }) {
  return (
    <span className={`margin-words${margin.margin < 0 ? ' bad' : ''}`}>
      Margin <b>{money(margin.margin)}</b>
      {margin.pct !== null && `, ${pctWord(margin.pct)}`}
      {margin.unknown > 0 && <small> ({plural(margin.unknown, 'line')} with no cost yet)</small>}
    </span>
  )
}

/** What a line wants that there isn't enough of on the job's days: the product itself, or a package's pieces. */
function linesShort(l: QuoteLine, checks: ReadonlyMap<string, QuoteKitCheck>, items: readonly { modelId: string }[] | undefined): QuoteKitCheck[] {
  if (l.kind !== 'kit') return []
  const ids = l.modelId ? [l.modelId] : l.packageId ? (items ?? []).map((i) => i.modelId) : []
  return ids.map((id) => checks.get(id)).filter((c): c is QuoteKitCheck => !!c && c.short > 0)
}

/**
 * Whether there's enough of a kit line's product on the job's days (ADR 0089), under the line: said only when it's
 * short, or would be if pencilled jobs went ahead, unless the line is open. Short, it offers to hire in what's short.
 */
function KitNote(p: {
  l: QuoteLine
  checks: ReadonlyMap<string, QuoteKitCheck>
  items: readonly { modelId: string; qty: number }[] | undefined
  names: (modelId: string) => string | undefined
  onHire?: (n: number) => void
  full: boolean
}) {
  const { l, checks } = p
  if (l.kind !== 'kit') return null
  if (!l.modelId) {
    const short = linesShort(l, checks, p.items)
    if (!short.length) return null
    return (
      <p className="kit-note warn-line">
        Short on the job's days: {short.map((c) => `${c.short} × ${p.names(c.modelId) ?? 'a product'} on ${dayLabel(c.shortDay!)}`).join(', ')}. Hire them in, or quote fewer.
      </p>
    )
  }
  const c = checks.get(l.modelId)
  if (!c) return null
  const others = (o: QuoteKitCheck['others']) => o.slice(0, 2).map((x) => `${x.name} has ${x.qty}`).join(', ')
  if (c.short > 0) {
    const own = l.qty - (l.subhireQty ?? 0)
    return (
      <p className="kit-note warn-line">
        Short by {c.short} on {dayLabel(c.shortDay!)}
        {c.wanted > own ? `, across the quote's ${c.wanted}` : ''}
        {c.others.length ? `: ${others(c.others)} out` : ''}.{' '}
        {p.onHire && own > 0 && (
          <button type="button" className="link" onClick={() => p.onHire!(Math.min(c.short, own))}>
            Hire {Math.min(c.short, own)} in
          </button>
        )}
      </p>
    )
  }
  if (c.ifPencilled > 0)
    return (
      <p className="kit-note hint">
        Enough for now. If {c.others.filter((o) => !o.held).map((o) => o.name).slice(0, 2).join(' and ') || 'the jobs pencilled in'} went ahead, {c.ifPencilled} short on {dayLabel(c.pencilledDay!)}.
      </p>
    )
  return p.full ? <p className="kit-note hint">Enough on the job's days: {c.wanted} of the {c.owned} we have.</p> : null
}

/**
 * The cost side of a line (ADR 0089), never printed: how many are hired in and who from for kit, and what the line
 * costs us, set against its price.
 */
function CostFields({ l, n, r, cost, boss, suppliers, set }: { l: LineDraft; n: number; r: QuoteLine | undefined; cost: number | undefined; boss: boolean; suppliers: readonly string[]; set: (c: Partial<LineDraft>) => void }) {
  const listId = useId()
  const typed = l.cost.trim() !== ''
  const worked = r && !typed ? cost : undefined
  const hint =
    l.kind === 'crew'
      ? worked !== undefined
        ? `${money(worked)} at their booked rate`
        : "Nobody's booked at a rate for this role yet"
      : l.kind === 'kit'
        ? r?.subhireQty
          ? 'What the hire company charges us'
          : 'Nothing: our own kit'
        : 'What it costs us, a van and driver, say'
  const m = r && boss ? lineMargin(r, cost) : undefined
  return (
    <fieldset className="line-cost">
      <legend>Not printed</legend>
      {l.kind === 'kit' && (
        <>
          <label>
            Hired in
            <input inputMode="numeric" value={l.subhire} onChange={(e) => set({ subhire: e.target.value })} placeholder="None" aria-label={`Line ${n}: hired in`} />
          </label>
          {l.subhire.trim() !== '' && l.subhire.trim() !== '0' && (
            <label className="supplier">
              From
              <input list={listId} value={l.supplier} onChange={(e) => set({ supplier: e.target.value })} maxLength={SUPPLIER_LENGTH} placeholder="Who we hire them from" aria-label={`Line ${n}: supplier`} />
              <datalist id={listId}>
                {suppliers.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </label>
          )}
        </>
      )}
      <label>
        Costs us, €
        <input inputMode="decimal" value={l.cost} onChange={(e) => set({ cost: e.target.value })} placeholder={worked !== undefined ? euroText(worked) : ''} aria-label={`Line ${n}: costs us`} />
        <small>{typed ? 'As typed. Clear it to work it out again.' : hint}</small>
      </label>
      {boss && <p className={`line-margin${m !== undefined && m < 0 ? ' bad' : ''}`}>{m === undefined ? 'Margin: not known until it has a cost' : `Margin ${money(m)}`}</p>}
    </fieldset>
  )
}

/** A line, shut: what it is, how it's charged and what it comes to; pressing it opens it to change. */
function LineSummary({ l, n, r, onOpen, focus, margin }: { l: LineDraft; n: number; r: QuoteLine | string | undefined; onOpen: () => void; focus: boolean; margin?: number | undefined }) {
  const bad = r === undefined || typeof r === 'string'
  const unpriced = !bad && r.unitCents === 0
  return (
    <button type="button" className={`quote-line-shut${bad || unpriced ? ' needs' : ''}`} onClick={onOpen} autoFocus={focus} aria-label={`Line ${n}: ${l.what || 'not named yet'}, change it`}>
      <span className="what">
        {l.what || 'Not named yet'}
        {l.includes && <small className="includes">{l.includes}</small>}
      </span>
      <span className="how">
        {unpriced ? `${lineWords(l, r)}: needs a price` : lineWords(l, r)}
        {!bad && r.subhireQty ? `, ${r.subhireQty} hired in${r.supplier ? ` from ${r.supplier}` : ''}` : ''}
      </span>
      <span className="amount">
        {bad ? '–' : money(lineCents(r))}
        {margin !== undefined && <small className={`line-margin${margin < 0 ? ' bad' : ''}`}>makes {money(margin)}</small>}
      </span>
    </button>
  )
}

function LineEditor(p: {
  l: LineDraft
  n: number
  r: QuoteLine | string | undefined
  set: (c: Partial<LineDraft>) => void
  onRemove: () => void
  onDone: () => void
  kit: ReactNode
  cost: ReactNode
  last: ReactNode
}) {
  const { l, n, r, set, onRemove, onDone } = p
  const [vatOpen, setVatOpen] = useState(false)
  const unpriced = r !== undefined && typeof r !== 'string' && r.unitCents === 0
  return (
    <div className={`quote-line${unpriced ? ' unpriced' : ''}`}>
      <label className="what">
        What
        <input value={l.what} onChange={(e) => set({ what: e.target.value })} maxLength={200} aria-label={`Line ${n}: what`} autoFocus />
      </label>
      {l.packageId !== null && (
        <label className="what">
          It includes
          <input value={l.includes} onChange={(e) => set({ includes: e.target.value })} maxLength={PACKAGE_INCLUDES_LENGTH} aria-label={`Line ${n}: includes`} />
        </label>
      )}
      <label>
        How many
        <input inputMode="numeric" value={l.qty} onChange={(e) => set({ qty: e.target.value })} aria-label={`Line ${n}: how many`} />
      </label>
      <label>
        Price, €
        <input inputMode="decimal" value={l.price} onChange={(e) => set({ price: e.target.value })} aria-label={`Line ${n}: price`} placeholder="0" aria-invalid={unpriced || undefined} />
      </label>
      <label>
        Charged
        <select
          value={chargeOf(l)}
          onChange={(e) => {
            const c = e.target.value as Charge
            // Moving to a rule starts its days out from the days charged so far.
            set(c === 'once' ? { per: 'once' } : c === 'daily' ? { per: 'day', rate: null } : { per: 'day', rate: c, out: l.rate ? l.out : l.days })
          }}
          aria-label={`Line ${n}: charged`}
        >
          {(['daily', 'week3', 'weekly', 'once'] as const).map((c) => (
            <option key={c} value={c}>
              {CHARGE_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      {l.per === 'once' ? (
        <span className="no-days" aria-hidden="true" />
      ) : l.rate ? (
        <label>
          Days out
          <input inputMode="decimal" value={l.out} onChange={(e) => set({ out: e.target.value })} aria-label={`Line ${n}: days out`} />
        </label>
      ) : (
        <label>
          Days
          <input inputMode="decimal" value={l.days} onChange={(e) => set({ days: e.target.value })} aria-label={`Line ${n}: days charged`} />
        </label>
      )}
      <label className="line-discount">
        Discount, %
        <input inputMode="decimal" value={l.discount} onChange={(e) => set({ discount: e.target.value })} placeholder="None" aria-label={`Line ${n}: discount, %`} />
      </label>
      {vatOpen || l.vat !== STANDARD_VAT ? (
        <label className="vat-rate">
          VAT
          <select value={l.vat} onChange={(e) => set({ vat: e.target.value as VatRate })} aria-label={`Line ${n}: VAT`}>
            {VAT_RATES.map((v) => (
              <option key={v} value={v}>
                {VAT_LABELS[v]}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <button type="button" className="link vat" onClick={() => setVatOpen(true)} aria-label={`Line ${n}: VAT is 23%, change it`}>
          VAT 23%
        </button>
      )}
      <span className="amount">
        {r === undefined || typeof r === 'string' ? '–' : money(lineCents(r))}
        {unpriced && <small className="warn"> Needs a price</small>}
        {/* What the rule makes of the days out (ADR 0085), by what it comes to. */}
        {l.rate && l.per === 'day' && r !== undefined && typeof r !== 'string' && (
          <small>Charged {l.rate === 'weekly' ? `${r.days} week${r.days === 1 ? '' : 's'}` : daysWord(r.days)}</small>
        )}
      </span>
      {p.kit}
      {p.cost}
      {p.last}
      {typeof r === 'string' && l.what.trim() !== '' && <p className="line-problem">{r}</p>}
      <span className="line-actions">
        <button type="button" className="link" onClick={onRemove} aria-label={`Remove line ${n}`}>
          Remove
        </button>
        <button type="button" className="link" onClick={onDone}>
          Done
        </button>
      </span>
    </div>
  )
}

/** The names a line goes by in Current RMS (ADR 0092): a product's own and its other names, a crew role without the phase, or what it says. */
function rmsNames(l: Pick<LineDraft, 'kind' | 'what' | 'modelId'>, model: (id: string) => { name: string; aliases: readonly string[] } | undefined): string[] {
  const found = l.modelId ? model(l.modelId) : undefined
  if (found) return [found.name, ...found.aliases]
  const what = l.kind === 'crew' ? l.what.replace(/\s*\([^)]*\)\s*$/, '') : l.what
  return what.trim() ? [what] : []
}

const lastOf = (last: RmsLastCharged, names: readonly string[]) => {
  for (const n of names) {
    const hit = last[n.trim().toLowerCase()]
    if (hit) return hit
  }
  return undefined
}

/** A day in Current RMS's past, with its year, since it may be years back. */
const pastDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Dublin' })

const chargeLine = (c: RmsCharge) =>
  [
    `${money(c.priceCents)}${c.rate ? ` on the ${c.rate.toLowerCase()}` : ''}`,
    c.discountPct ? `${c.discountPct.toLocaleString('en-IE')}% off` : '',
    c.on ? pastDay(c.on) : '',
    `quote ${c.number}`,
  ]
    .filter(Boolean)
    .join(', ')

/** What a line was last charged in Current RMS (ADR 0092), to this client and to anyone, with a press to use the price. A hint only: nothing without signal. */
function LastCharged({ found, n, price, onUse }: { found: RmsLastCharged[string] | undefined; n: number; price: string; onUse: (cents: number) => void }) {
  if (!found || (!found.client && !found.any)) return null
  const use = found.client ?? found.any!
  const already = parseEuro(price).cents === use.priceCents
  return (
    <div className="last-charged" aria-label={`Line ${n}: last charged in Current RMS`}>
      {found.client && (
        <p>
          Last charged to {found.client.client}: {chargeLine(found.client)}.
        </p>
      )}
      {found.any && found.any.opportunityId !== found.client?.opportunityId && (
        <p className="hint">
          {found.client ? 'Last to anyone' : 'Last charged'}: {chargeLine(found.any)}, {found.any.client}.
        </p>
      )}
      {!already && (
        <button type="button" className="link" onClick={() => onUse(use.priceCents)}>
          Use {money(use.priceCents)}
        </button>
      )}
    </div>
  )
}

/** The job's past quotes in Current RMS, once linked (ADR 0092), and how its client's quotes went there. Needs signal; shows nothing without it. */
function InCurrentRms({ jobId }: { jobId: string }) {
  const loaded = useAsked<RmsJob>(useAccess().can('money'), jobId, () => getJson(`/api/rms/jobs/${encodeURIComponent(jobId)}`))
  if (loaded.state !== 'ready' || (!loaded.data.opportunities.length && !loaded.data.client)) return null
  const { opportunities, client } = loaded.data
  return (
    <section className="card" aria-label="In Current RMS">
      <h2>In Current RMS</h2>
      {client && (
        <p>
          {client.client}: {clientWords(client)}.
        </p>
      )}
      {opportunities.length ? (
        <ul className="job-list">
          {opportunities.map((o) => (
            <li key={o.id}>
              <a className="job-row" href={`#jobs/money/current-rms/${o.id}`}>
                <div>
                  <b>{o.subject || o.number}</b>
                  <p className="hint">{[o.number, [o.state, o.status].filter(Boolean).join(', '), o.startsAt ? pastDay(o.startsAt.slice(0, 10)) : ''].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="side">
                  {money(o.netCents)}
                  <span aria-hidden="true"> ›</span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">
          No past quote is linked to this job. <a href="#jobs/money/current-rms/match">Match past quotes to jobs</a>
        </p>
      )}
    </section>
  )
}

/** "Van and driver", "Luton": how a vehicle reads on a quote. */
const transportWords = (kind: keyof typeof VEHICLE_KIND_LABELS, driver: boolean) => `${kind === 'luton' ? 'Luton van' : VEHICLE_KIND_LABELS[kind]}${driver ? ' and driver' : ''}`

/** Transport to add (ADR 0089): one of the vans booked on the job, or transport typed. */
function AddTransport({ vans, onAdd, onCancel }: { vans: { id: string; what: string; name: string }[]; onAdd: (what: string, ref: string | null) => void; onCancel: () => void }) {
  const [chosen, setChosen] = useState(vans[0]?.id ?? '')
  const van = vans.find((v) => v.id === chosen)
  return (
    <div className="adding">
      <label className="field">
        Transport to add
        <select value={chosen} onChange={(e) => setChosen(e.target.value)} autoFocus>
          {vans.map((v) => (
            <option key={v.id} value={v.id}>
              {v.what}: {v.name}
            </option>
          ))}
          <option value="">Transport, typed</option>
        </select>
        <small>Charged once, with what it costs us beside it, which isn't printed.</small>
      </label>
      <button type="button" onClick={() => onAdd(van ? van.what : 'Transport', van ? van.id : null)}>
        Add
      </button>
      <button type="button" className="link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

/** A package from the price list to add (ADR 0087). */
function AddPackage({ packages, onAdd, onCancel }: { packages: readonly Package[]; onAdd: (id: string) => void; onCancel: () => void }) {
  const [chosen, setChosen] = useState(packages[0]?.id ?? '')
  return (
    <div className="adding">
      <label className="field">
        Package to add
        <select value={chosen} onChange={(e) => setChosen(e.target.value)} autoFocus>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}, {money(p.dayCents)} a {RATE_UNIT[p.rate ?? 'daily']}
            </option>
          ))}
        </select>
        <small>At its price on the price list, for the job's days, with what it holds printed under it.</small>
      </label>
      <button type="button" onClick={() => onAdd(chosen)} disabled={!chosen}>
        Add
      </button>
      <button type="button" className="link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

/** A crew role to add: one already priced or asked for, or one typed. */
function AddCrew({ roles, onAdd, onCancel }: { roles: readonly string[]; onAdd: (role: string) => void; onCancel: () => void }) {
  const [typed, setTyped] = useState('')
  const listId = useId()
  const add = () => typed.trim() && onAdd(typed.trim().replace(/\s+/g, ' '))
  return (
    <div className="adding">
      <label className="field">
        Crew role to add
        <input
          list={listId}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="Audio tech"
          maxLength={100}
          autoFocus
        />
        <small>Priced from the price list, for the job's days.</small>
      </label>
      <datalist id={listId}>
        {roles.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <button type="button" onClick={add} disabled={!typed.trim()}>
        Add
      </button>
      <button type="button" className="link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

/**
 * The job's kit and crew since the quote was built from them: what's new on the job, what's gone, and how many have
 * changed, to take in with one press. "Leave it as it is" hides these until the job changes again, on this device.
 */
function JobChangesCard({ changes, quoteId, onTake }: { changes: JobChanges; quoteId: string; onTake: (next: (ls: LineDraft[]) => LineDraft[]) => void }) {
  const { added, gone, changed } = changes
  const print = JSON.stringify([added.map((l) => l.ref), gone.map((l) => l.id), changed.map((c) => [c.line.id, c.qty])])
  const storeKey = `sh.quoteLeft.${quoteId}`
  const [left, setLeft] = useState(() => {
    try {
      return localStorage.getItem(storeKey)
    } catch {
      return null
    }
  })
  if (added.length + gone.length + changed.length === 0 || left === print) return null
  const take = () =>
    onTake((ls) => [
      ...ls
        .filter((l) => !gone.some((g) => g.id === l.id))
        .map((l) => {
          const c = changed.find((x) => x.line.id === l.id)
          return c ? { ...l, qty: String(c.qty) } : l
        }),
      ...added.map(toDraft),
    ])
  const leave = () => {
    setLeft(print)
    try {
      localStorage.setItem(storeKey, print)
    } catch {
      // Only for this visit, then.
    }
  }
  return (
    <section className="job-changes attention" aria-label="The job has changed">
      <p>
        <b>The job has changed since this quote was built.</b>
      </p>
      <ul>
        {added.map((l) => (
          <li key={l.id}>New on the job: {l.qty} × {l.what}</li>
        ))}
        {changed.map((c) => (
          <li key={c.line.id}>
            {c.line.what}: {c.qty} on the job, {c.line.qty} on the quote
          </li>
        ))}
        {gone.map((l) => (
          <li key={l.id}>No longer on the job: {l.what}</li>
        ))}
      </ul>
      <div className="actions">
        <button type="button" className="primary" onClick={take}>
          Update the quote
        </button>
        <button type="button" className="link" onClick={leave}>
          Leave it as it is
        </button>
      </div>
    </section>
  )
}

/** A copy of a version that's gone, as the next draft. */
function NewVersion({ q, onMade }: { q: QuoteView; onMade: (id: string) => void }) {
  const { run, error } = useAct()
  const make = () => {
    const id = newId()
    void run(() =>
      client.mutate('quote.save', { id, projectId: q.projectId, lines: q.lines.map((l) => ({ ...l, id: newId() })), discountPct: q.discountPct, agreedCents: q.agreedCents ?? null, notes: q.notes })
    ).then((ok) => ok && onMade(id))
  }
  return (
    <>
      <button type="button" onClick={make}>
        Start a new version
      </button>
      <Refusal error={error} />
    </>
  )
}

/** The office's records of what happened outside the app: the client's answer, the invoice, the payment. */
function Records({ q, job }: { q: QuoteView; job: JobView }) {
  const today = useToday()
  const [on, setOn] = useState(today)
  const [ref, setRef] = useState('')
  const [undo, setUndo] = useState<'answer' | 'invoice' | 'paid'>()
  const { run, error } = useAct()
  const go = (fn: () => Promise<unknown>) => void run(fn).then((ok) => ok && setUndo(undefined))
  const when = (
    <label>
      On
      <input type="date" value={on} max={irishToday()} onChange={(e) => setOn(e.target.value)} />
    </label>
  )
  return (
    <section className="card" aria-label="What happened">
      <h2>What happened</h2>
      <dl className="facts">
        <div>
          <dt>Sent</dt>
          <dd>{q.sentOn ? dayLabel(q.sentOn) : 'Not yet'}</dd>
        </div>
        <div>
          <dt>Client's answer</dt>
          <dd>{q.answeredOn ? `${QUOTE_STATUS_LABELS[q.status]}, ${dayLabel(q.answeredOn)}` : 'Not yet'}</dd>
        </div>
        {q.status === 'accepted' && (
          <div>
            <dt>Invoiced</dt>
            <dd>{q.invoicedOn ? `${dayLabel(q.invoicedOn)}${q.invoiceRef ? `, ${q.invoiceRef}` : ''}` : 'Not yet'}</dd>
          </div>
        )}
        {q.invoicedOn && (
          <div>
            <dt>Paid</dt>
            <dd>{q.paidOn ? dayLabel(q.paidOn) : `Not yet: ${money(q.totals.gross)} owed`}</dd>
          </div>
        )}
      </dl>
      <Refusal error={error} />
      {q.status === 'accepted' && !STOPPED.includes(job.status) && job.status !== 'confirmed' && <InStep job={job} want="confirmed" />}
      {q.status === 'declined' && !STOPPED.includes(job.status) && <InStep job={job} want="lost" />}
      {q.status === 'sent' && (
        <div className="quote-send">
          {when}
          <button type="button" className="primary" onClick={() => go(() => client.mutate('quote.answer', { id: q.id, answer: 'accepted', on: on || today }))}>
            Client accepted
          </button>
          <button type="button" onClick={() => go(() => client.mutate('quote.answer', { id: q.id, answer: 'declined', on: on || today }))}>
            Client turned it down
          </button>
        </div>
      )}
      {q.status === 'accepted' && !q.invoicedOn && (
        <div className="quote-send">
          {when}
          <label>
            Invoice number
            <input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={60} placeholder="SH-1043" />
          </label>
          <button type="button" className="primary" onClick={() => go(() => client.mutate('quote.invoiced', { id: q.id, on: on || today, ref }))}>
            Mark invoiced
          </button>
        </div>
      )}
      {q.invoicedOn && !q.paidOn && (
        <div className="quote-send">
          {when}
          <button type="button" className="primary" onClick={() => go(() => client.mutate('quote.paid', { id: q.id, on: on || today }))}>
            Mark paid
          </button>
        </div>
      )}
      {/* Taken back in the opposite order: the payment, then the invoice, then the answer. */}
      {(() => {
        const last = q.paidOn ? 'paid' : q.invoicedOn ? 'invoice' : q.answeredOn ? 'answer' : undefined
        if (!last) return null
        const words: [string, string] = { paid: ['Take the payment back', 'Take the payment back? The quote shows as owed again.'], invoice: ['Take the invoice back', 'Take the invoice back? It comes off the accountant’s files.'], answer: ["Take the client's answer back", "Take the client's answer back? The quote shows as sent, waiting on them."] }[last] as [string, string]
        return undo === last ? (
          <Confirm
            question={words[1]}
            yes={words[0]}
            onNo={() => setUndo(undefined)}
            onYes={() =>
              go(() =>
                last === 'paid'
                  ? client.mutate('quote.paid', { id: q.id, on: null })
                  : last === 'invoice'
                    ? client.mutate('quote.invoiced', { id: q.id, on: null, ref: '' })
                    : client.mutate('quote.answer', { id: q.id, answer: 'none', on: today })
              )
            }
          />
        ) : (
          <button type="button" className="link" onClick={() => setUndo(last)}>
            {words[0]}
          </button>
        )
      })()}
      <p className="hint">These are the office's records of what happened: the app sends nothing to the client.</p>
    </section>
  )
}

function Lines({ lines }: { lines: readonly QuoteLine[] }) {
  if (!lines.length) return <Empty>No lines.</Empty>
  return (
    <div className="quote-table-wrap">
      <table className="quote-table">
        <thead>
          <tr>
            <th scope="col">What</th>
            <th scope="col">How many</th>
            <th scope="col">Days</th>
            <th scope="col">Price</th>
            <th scope="col">VAT</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        {linesByGroup(lines).map((g) => (
          <tbody key={g.group}>
            <tr className="group">
              <th scope="rowgroup" colSpan={6}>
                {g.group || KIND_WORDS[g.lines[0]!.kind]}
              </th>
            </tr>
            {g.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.what}
                  {l.includes && <small className="includes">{l.includes}</small>}
                </td>
                <td className="n">{l.qty}</td>
                <td className="n">{l.per === 'once' ? '' : l.rate === 'weekly' ? `${l.days} wk` : l.days.toLocaleString('en-IE')}</td>
                <td className="n">
                  {money(l.unitCents)} {l.per === 'once' ? 'once' : `a ${RATE_UNIT[l.rate ?? 'daily']}`}
                </td>
                <td className="n">{VAT_LABELS[l.vat]}</td>
                <td className="n">
                  {money(lineCents(l))}
                  {l.discountPct ? <small className="less"> less {pctWord(l.discountPct)}</small> : null}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}

function Totals({ totals, agreed }: { totals: QuoteTotals; agreed: boolean }) {
  return (
    <dl className="quote-totals">
      {totals.discount > 0 && (
        <>
          <div>
            <dt>Subtotal</dt>
            <dd>{money(totals.subtotal)}</dd>
          </div>
          <div>
            <dt>{agreed ? `Agreed discount, ${pctWord(totals.discountPct)}` : `Discount, ${pctWord(totals.discountPct)}`}</dt>
            <dd>−{money(totals.discount)}</dd>
          </div>
        </>
      )}
      <div>
        <dt>Before VAT</dt>
        <dd>{money(totals.net)}</dd>
      </div>
      {totals.rates.map((r) => (
        <div key={r.rate}>
          <dt>
            VAT at {VAT_LABELS[r.rate]}
            {totals.rates.length > 1 && ` on ${money(r.net)}`}
          </dt>
          <dd>{money(r.vat)}</dd>
        </div>
      ))}
      <div className="total">
        <dt>Total</dt>
        <dd>{money(totals.gross)}</dd>
      </div>
    </dl>
  )
}

/** The A4 page: what the client is sent, as a PDF the office saves from the browser. */
function QuoteSheet({ q, job, office, quoting }: { q: QuoteView; job: JobView; office: View['office']; quoting: QuoteSettings }) {
  const today = irishToday()
  const made = q.sentOn ?? irishToday(new Date(q.savedAt))
  const reach = [office.details?.phone, office.details?.email].filter(Boolean).join(' · ')
  // Who it's from, once Admin's office details have them: the company's address, a line each as typed, and its VAT number.
  const address = office.details?.address?.trim()
  const vat = office.details?.vatNumber?.trim()
  const to = job.client
  const contact = to?.contacts[0]
  const number = quoteNumberLabel(q)
  const draft = q.status === 'draft'
  return (
    <>
      <header className="sheet-head">
        <div className="from">
          <p className="company">Session Hire</p>
          {address && <p className="lines">{address}</p>}
          {reach && <p>{reach}</p>}
          {vat && <p>VAT number {vat}</p>}
        </div>
        <dl className="sheet-facts">
          <div>
            <dt>{draft ? 'Draft quote' : 'Quote'}</dt>
            <dd>{number || (draft ? 'Not sent yet' : '')}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{letterDay(made)}</dd>
          </div>
          <div>
            <dt>Valid until</dt>
            <dd>{letterDay(validUntil(q, today))}</dd>
          </div>
        </dl>
      </header>
      <section className="sheet-to" aria-label="For">
        {to && (
          <div>
            <p className="muted">For</p>
            <p className="who">{to.name}</p>
            {contact && <p>{contact.name}</p>}
            {to.address?.trim() && <p className="lines">{to.address.trim()}</p>}
          </div>
        )}
        <div>
          <h1>{job.name}</h1>
          <p>{[job.span && spanLabel(job.span), job.venue && venueLabel(job.venue)].filter(Boolean).join(' · ')}</p>
        </div>
      </section>
      <Lines lines={q.lines} />
      <Totals totals={q.totals} agreed={q.agreedCents != null} />
      {q.depositPct ? (
        <p className="deposit">
          A deposit of {pctWord(q.depositPct)}, <b>{money(depositCents(q.totals.gross, q.depositPct))}</b>, confirms the booking.
        </p>
      ) : null}
      {q.notes && <p className="notes">{q.notes}</p>}
      {quoting.terms.trim() && (
        <section className="sheet-terms">
          <h2>Terms</h2>
          <p className="lines">{quoting.terms.trim()}</p>
        </section>
      )}
      {quoting.bank.trim() && (
        <section className="sheet-terms">
          <h2>Paying by bank transfer</h2>
          <p className="lines">{quoting.bank.trim()}</p>
          {q.number && <p>Please give quote {q.number} as the reference.</p>}
        </section>
      )}
      <footer>
        Prices are in euro: each line is how many, at its price, for the days charged or once.
        {reach && ` Questions: ${reach}.`}
      </footer>
    </>
  )
}
