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
} from '@sh/shared'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
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
import { Top } from './common.tsx'

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
            <Lines lines={q.lines} />
            <Totals totals={q.totals} discountPct={q.discountPct} />
            {q.notes && <p className="notes">{q.notes}</p>}
            <div className="actions">
              <button type="button" className="primary" onClick={() => setPrinting(true)} disabled={printing}>
                Print or save as PDF
              </button>
              {q.latest && !settled && <NewVersion q={q} onMade={setPicked} />}
            </div>
            {settled && q.latest && <p className="hint">The quote is invoiced, so it's settled: no new version.</p>}
          </section>
          {q.id === current?.id && <Records q={q} />}
        </>
      )}

      {printing &&
        q &&
        createPortal(
          <div className="print-sheet quote-sheet">
            <style>{'@page { size: A4; margin: 14mm; }'}</style>
            <QuoteSheet q={q} job={job} office={view.office} />
          </div>,
          document.body
        )}
    </div>
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
    const lines = withLines ? linesFor(source.kit, source.crew, { product: m.productPrice, role: m.rolePrice }, newId) : []
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
  (a.modelId ?? null) === (b.modelId ?? null)
const num = (s: string) => Number(s.trim().replace(',', '.'))

/** What a typed line comes to, or why it can't be saved. */
function readLine(d: LineDraft, n: number): QuoteLine | string {
  const price = parseEuro(d.price)
  const where = `Line ${n}${d.what.trim() ? ` (${d.what.trim()})` : ''}`
  if (!d.what.trim()) return `Line ${n}: say what it's for.`
  if (price.reason) return `${where}: ${price.reason}`
  const qty = num(d.qty)
  // Charged once, a line keeps 1 for its days, so a device from before this reads the same amount.
  const days = d.per === 'once' ? 1 : num(d.days)
  if (!Number.isInteger(qty) || qty < 1 || qty > 10_000) return `${where}: how many is a whole number from 1 to 10,000.`
  if (!(days >= 0.5 && days <= 365 && Number.isInteger(days * 2))) return `${where}: days charged is a number of days, in halves, from 0.5 to 365.`
  return { id: d.id, kind: d.kind, what: d.what.trim(), ref: d.ref, group: d.group, qty, days, unitCents: price.cents ?? 0, vat: d.vat, per: d.per, modelId: d.modelId }
}

/** How long the draft waits after the last key before it saves itself. */
const SAVE_AFTER_MS = 1_200

/** The job's days, which a line added on the quote is charged for until changed. */
const jobDays = (job: JobView) => (job.span ? Math.max(1, eachDay(job.span.start, job.span.end).length) : 1)

function Draft({ q, view, job, onPrint }: { q: QuoteView; view: View; job: JobView; onPrint: () => void }) {
  const today = useToday()
  const m = view.money
  const under = useUnderTop<HTMLFormElement>(true)
  const [lines, setLines] = useState<LineDraft[]>(() => q.lines.map(toDraft))
  const [discount, setDiscount] = useState(String(q.discountPct))
  const [notes, setNotes] = useState(q.notes)
  const [kitDays, setKitDays] = useState('')
  const [sentOn, setSentOn] = useState(today)
  const [answering, setAnswering] = useState(false)
  // One line is open to change at a time; the rest read as a list, as they'll print.
  const [open, setOpen] = useState<string>()
  // The line just shut, which keeps the focus so the keyboard carries on from it.
  const [shut, setShut] = useState<string>()
  const [removed, setRemoved] = useState<{ line: LineDraft; at: number }>()
  const [adding, setAdding] = useState<'kit' | 'crew'>()
  const { run, error, refuse } = useAct()
  const set = (id: string, changes: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...changes } : l)))

  // What it comes to as typed, with anything not yet a number left out.
  const read = lines.map((l, i) => readLine(l, i + 1))
  const pct = num(discount)
  const pctOk = pct >= 0 && pct <= 100 && Number.isInteger(pct * 10)
  const good = read.filter((l): l is QuoteLine => typeof l !== 'string')
  const totals = quoteTotals({ lines: good, discountPct: pctOk ? pct : 0 })
  const problem = read.find((l): l is string => typeof l === 'string') ?? (pctOk ? undefined : 'A discount is a percentage from 0 to 100, such as 10 or 12.5.')
  // Saved: what's typed comes to what the draft holds.
  const saved = read.length === q.lines.length && read.every((l, i) => typeof l !== 'string' && sameLine(l, q.lines[i]!)) && pct === q.discountPct && q.notes.trim() === notes.trim()
  const unpriced = good.filter((l) => l.unitCents === 0).length

  // The draft saves itself a moment after typing stops, once it reads as a quote: there's no Save to forget. Leaving
  // the page saves what's waiting at once. Saving goes through the device's queue, so it works with no signal.
  const payload = !saved && !problem ? { id: q.id, projectId: job.id, lines: good, discountPct: pct, notes } : undefined
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

  const days = jobDays(job)
  const addLine = (l: Omit<LineDraft, 'id'>) => {
    const id = newId()
    setLines((ls) => [...ls, { id, ...l }])
    setOpen(id)
    setAdding(undefined)
  }
  const addKit = (modelId: string) => {
    const model = view.warehouse.models.find((x) => x.id === modelId)
    if (!model) return
    const cents = m.productPrice(modelId)
    addLine({ kind: 'kit', what: model.name, ref: null, modelId, group: DEPARTMENT_LABELS[model.department], qty: '1', days: String(days), price: cents === undefined ? '' : euroText(cents), vat: STANDARD_VAT, per: 'day' })
  }
  const addCrew = (role: string) => {
    const r = m.roles.find((x) => x.role === role)
    const cents = r?.cents ?? r?.booked
    addLine({ kind: 'crew', what: role, ref: null, modelId: null, group: 'Crew', qty: '1', days: String(days), price: cents === undefined ? '' : euroText(cents), vat: STANDARD_VAT, per: 'day' })
  }
  const addOther = () => addLine({ kind: 'other', what: '', ref: null, modelId: null, group: '', qty: '1', days: '1', price: '', vat: STANDARD_VAT, per: 'once' })
  const remove = (l: LineDraft) => {
    setRemoved({ line: l, at: lines.indexOf(l) })
    setLines((ls) => ls.filter((x) => x.id !== l.id))
    if (open === l.id) setOpen(undefined)
  }
  const undoRemove = () => {
    if (!removed) return
    setLines((ls) => [...ls.slice(0, removed.at), removed.line, ...ls.slice(removed.at)])
    setRemoved(undefined)
  }
  const allKitDays = () => {
    const d = num(kitDays)
    if (!(d >= 0.5 && d <= 365 && Number.isInteger(d * 2))) return refuse('Days charged is a number of days, in halves, from 0.5 to 365.')
    setLines((ls) => ls.map((l) => (l.kind === 'kit' && l.per === 'day' ? { ...l, days: String(d) } : l)))
    setKitDays('')
  }
  const groups = linesByGroup(lines)
  const kitLines = lines.filter((l) => l.kind === 'kit').length
  const source = m.sourceOf(job.id)
  // Every line counts here, finished or not, so one being typed isn't offered again as new on the job.
  const asLines = lines.map((l): QuoteLine => ({ id: l.id, kind: l.kind, what: l.what, ref: l.ref, group: l.group, qty: num(l.qty), days: 1, unitCents: 0, vat: l.vat }))
  const changes = changesFromJob(asLines, source.kit, source.crew, { product: m.productPrice, role: m.rolePrice }, newId)

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
        <span className="save-state" aria-live="polite">
          {problem ? 'Not saved yet' : payload ? (late ? 'Saving…' : '') : q.pending ? 'Saved on this device' : 'Saved'}
        </span>
      </div>

      <JobChangesCard changes={changes} quoteId={q.id} onTake={(next) => setLines((ls) => next(ls))} />

      {lines.length === 0 && <Empty>No lines yet. Add kit, crew or anything else the quote is for.</Empty>}
      {groups.map((g) => (
        <fieldset key={g.group} className="quote-group">
          <legend>{g.group}</legend>
          {g.lines.map((l) => {
            const n = lines.indexOf(l) + 1
            const r = read[n - 1]
            return open !== l.id ? (
              <LineSummary key={l.id} l={l} n={n} r={r} onOpen={() => setOpen(l.id)} focus={shut === l.id} />
            ) : (
              <LineEditor key={l.id} l={l} n={n} r={r} set={(c) => set(l.id, c)} onRemove={() => remove(l)} onDone={() => {
                  setShut(l.id)
                  setOpen(undefined)
                }}
              />
            )
          })}
        </fieldset>
      ))}
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
        ) : adding === 'crew' ? (
          <AddCrew roles={m.roles.map((r) => r.role)} onAdd={addCrew} onCancel={() => setAdding(undefined)} />
        ) : (
          <>
            <button type="button" onClick={() => setAdding('kit')} disabled={lines.length >= MAX_LINES}>
              Add kit
            </button>
            <button type="button" onClick={() => setAdding('crew')} disabled={lines.length >= MAX_LINES}>
              Add crew
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
      <label className="field">
        Discount, %
        <input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} aria-label="Discount, %" />
        {m.discountOf(job.clientId) !== undefined && <small>{job.client?.name} usually gets {pctWord(m.discountOf(job.clientId)!)} off.</small>}
      </label>
      <label className="field">
        Notes for the client
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} placeholder="Load in from 8am. Prices include delivery to the venue." />
      </label>
      <Totals totals={totals} discountPct={pctOk ? pct : 0} />
      <Refusal error={error} />
      <div className="actions">
        <button type="button" onClick={onPrint} disabled={!saved}>
          Print or save as PDF
        </button>
      </div>
      {!saved && problem && <p className="warn-line">{problem} It saves once that's put right.</p>}
      {saved && q.lines.length > 0 && (
        <div className="quote-send">
          <label>
            Sent to the client on
            <input type="date" value={sentOn} max={irishToday()} onChange={(e) => setSentOn(e.target.value)} />
          </label>
          <button type="button" className="primary" onClick={() => void run(() => client.mutate('quote.sent', { id: q.id, on: sentOn || today }))}>
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
          <p className="hint">The app sends nothing: print it as a PDF and send it yourself, then mark it as sent here.</p>
        </div>
      )}
    </form>
  )
}

/** "4 × €45.00 a day × 3 days", or "€150.00 once". */
function lineWords(l: LineDraft, r: QuoteLine | string | undefined) {
  if (r === undefined || typeof r === 'string') return 'Not finished'
  const each = r.unitCents ? money(r.unitCents) : 'no price'
  return r.per === 'once' ? `${r.qty === 1 ? '' : `${r.qty} × `}${each} once` : `${r.qty} × ${each} a day × ${daysWord(r.days)}`
}

/** A line, shut: what it is, how it's charged and what it comes to; pressing it opens it to change. */
function LineSummary({ l, n, r, onOpen, focus }: { l: LineDraft; n: number; r: QuoteLine | string | undefined; onOpen: () => void; focus: boolean }) {
  const bad = r === undefined || typeof r === 'string'
  const unpriced = !bad && r.unitCents === 0
  return (
    <button type="button" className={`quote-line-shut${bad || unpriced ? ' needs' : ''}`} onClick={onOpen} autoFocus={focus} aria-label={`Line ${n}: ${l.what || 'not named yet'}, change it`}>
      <span className="what">{l.what || 'Not named yet'}</span>
      <span className="how">{unpriced ? `${lineWords(l, r)}: needs a price` : lineWords(l, r)}</span>
      <span className="amount">{bad ? '–' : money(lineCents(r))}</span>
    </button>
  )
}

function LineEditor({ l, n, r, set, onRemove, onDone }: { l: LineDraft; n: number; r: QuoteLine | string | undefined; set: (c: Partial<LineDraft>) => void; onRemove: () => void; onDone: () => void }) {
  const [vatOpen, setVatOpen] = useState(false)
  const unpriced = r !== undefined && typeof r !== 'string' && r.unitCents === 0
  return (
    <div className={`quote-line${unpriced ? ' unpriced' : ''}`}>
      <label className="what">
        What
        <input value={l.what} onChange={(e) => set({ what: e.target.value })} maxLength={200} aria-label={`Line ${n}: what`} autoFocus />
      </label>
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
        <select value={l.per} onChange={(e) => set({ per: e.target.value as LinePer })} aria-label={`Line ${n}: charged`}>
          <option value="day">a day</option>
          <option value="once">once</option>
        </select>
      </label>
      {l.per === 'day' ? (
        <label>
          Days
          <input inputMode="decimal" value={l.days} onChange={(e) => set({ days: e.target.value })} aria-label={`Line ${n}: days charged`} />
        </label>
      ) : (
        <span className="no-days" aria-hidden="true" />
      )}
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
      </span>
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
      client.mutate('quote.save', { id, projectId: q.projectId, lines: q.lines.map((l) => ({ ...l, id: newId() })), discountPct: q.discountPct, notes: q.notes })
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
function Records({ q }: { q: QuoteView }) {
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
                <td>{l.what}</td>
                <td className="n">{l.qty}</td>
                <td className="n">{l.per === 'once' ? '' : l.days.toLocaleString('en-IE')}</td>
                <td className="n">
                  {money(l.unitCents)} {l.per === 'once' ? 'once' : 'a day'}
                </td>
                <td className="n">{VAT_LABELS[l.vat]}</td>
                <td className="n">{money(lineCents(l))}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}

function Totals({ totals, discountPct }: { totals: QuoteTotals; discountPct: number }) {
  return (
    <dl className="quote-totals">
      {totals.discount > 0 && (
        <>
          <div>
            <dt>Subtotal</dt>
            <dd>{money(totals.subtotal)}</dd>
          </div>
          <div>
            <dt>Discount, {pctWord(discountPct)}</dt>
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
function QuoteSheet({ q, job, office }: { q: QuoteView; job: JobView; office: View['office'] }) {
  const made = q.sentOn ?? irishToday(new Date(q.savedAt))
  const reach = [office.details?.phone, office.details?.email].filter(Boolean).join(' · ')
  // Who it's from, once Admin's office details have them: the company's address, a line each as typed, and its VAT number.
  const address = office.details?.address?.trim()
  const vat = office.details?.vatNumber?.trim()
  return (
    <>
      <header>
        <p className="kicker">Session Hire · quote</p>
        {(address || vat) && (
          <p className="from muted">
            {address && <span className="lines">{address}</span>}
            {vat && <span>VAT number {vat}</span>}
          </p>
        )}
        <h1>{job.name}</h1>
        <p>
          {[job.client && `For ${job.client.name}`, job.span && spanLabel(job.span), job.venue && venueLabel(job.venue)].filter(Boolean).join(' · ')}
        </p>
        <p className="muted">
          Version {q.version} · {dayLabel(made)}
        </p>
      </header>
      <Lines lines={q.lines} />
      <Totals totals={q.totals} discountPct={q.discountPct} />
      {q.notes && <p className="notes">{q.notes}</p>}
      <footer>
        Prices are in euro: each line is how many, at its price, for the days charged or once.
        {reach && ` Questions: ${reach}.`}
      </footer>
    </>
  )
}
