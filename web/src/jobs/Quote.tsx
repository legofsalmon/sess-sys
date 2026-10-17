import {
  dayLabel,
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
  QUOTE_STATUS_LABELS,
  quoteTotals,
  spanLabel,
  VAT_LABELS,
  VAT_RATES,
  venueLabel,
  type JobView,
  type LineKind,
  type QuoteLine,
  type QuoteStatus,
  type QuoteTotals,
  type QuoteView,
  type VatRate,
  type View,
} from '@sh/shared'
import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Heading } from '../Icon.tsx'
import { useAccess } from '../role.ts'
import { StatusPill, type PillTone } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { JOBS } from '../Up.tsx'
import { useToday } from '../view.ts'
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
  group: string
  qty: string
  days: string
  price: string
  vat: VatRate
}
const toDraft = (l: QuoteLine): LineDraft => ({ id: l.id, kind: l.kind, what: l.what, ref: l.ref, group: l.group, qty: String(l.qty), days: String(l.days), price: euroText(l.unitCents), vat: l.vat })
const sameLine = (a: QuoteLine, b: QuoteLine) => (Object.keys(a) as (keyof QuoteLine)[]).every((k) => a[k] === b[k])
const num = (s: string) => Number(s.trim().replace(',', '.'))

/** What a typed line comes to, or why it can't be saved. */
function readLine(d: LineDraft, n: number): QuoteLine | string {
  const price = parseEuro(d.price)
  const where = `Line ${n}${d.what.trim() ? ` (${d.what.trim()})` : ''}`
  if (!d.what.trim()) return `Line ${n}: say what it's for.`
  if (price.reason) return `${where}: ${price.reason}`
  const qty = num(d.qty)
  const days = num(d.days)
  if (!Number.isInteger(qty) || qty < 1 || qty > 10_000) return `${where}: how many is a whole number from 1 to 10,000.`
  if (!(days >= 0.5 && days <= 365 && Number.isInteger(days * 2))) return `${where}: days charged is a number of days, in halves, from 0.5 to 365.`
  return { id: d.id, kind: d.kind, what: d.what.trim(), ref: d.ref, group: d.group, qty, days, unitCents: price.cents ?? 0, vat: d.vat }
}

function Draft({ q, view, job, onPrint }: { q: QuoteView; view: View; job: JobView; onPrint: () => void }) {
  const today = useToday()
  const [lines, setLines] = useState<LineDraft[]>(() => q.lines.map(toDraft))
  const [discount, setDiscount] = useState(String(q.discountPct))
  const [notes, setNotes] = useState(q.notes)
  const [kitDays, setKitDays] = useState('')
  const [sentOn, setSentOn] = useState(today)
  const [answering, setAnswering] = useState(false)
  const { run, error, refuse } = useAct()
  const set = (id: string, changes: Partial<LineDraft>) => setLines(lines.map((l) => (l.id === id ? { ...l, ...changes } : l)))

  // What it comes to as typed, with anything not yet a number left out.
  const read = lines.map((l, i) => readLine(l, i + 1))
  const pct = num(discount)
  const totals = quoteTotals({ lines: read.filter((l): l is QuoteLine => typeof l !== 'string'), discountPct: pct >= 0 && pct <= 100 ? pct : 0 })
  // Saved: what's typed comes to what the draft holds.
  const saved = read.length === q.lines.length && read.every((l, i) => typeof l !== 'string' && sameLine(l, q.lines[i]!)) && pct === q.discountPct && q.notes.trim() === notes.trim()

  const save = (e?: FormEvent) => {
    e?.preventDefault()
    const bad = read.find((l): l is string => typeof l === 'string')
    if (bad) return refuse(bad)
    if (!(pct >= 0 && pct <= 100 && Number.isInteger(pct * 10))) return refuse('A discount is a percentage from 0 to 100, such as 10 or 12.5.')
    void run(() => client.mutate('quote.save', { id: q.id, projectId: job.id, lines: read as QuoteLine[], discountPct: pct, notes }))
  }
  const add = () => setLines([...lines, { id: newId(), kind: 'other', what: '', ref: null, group: '', qty: '1', days: '1', price: '', vat: '23' }])
  const allKitDays = () => {
    const d = num(kitDays)
    if (!(d >= 0.5 && d <= 365 && Number.isInteger(d * 2))) return refuse('Days charged is a number of days, in halves, from 0.5 to 365.')
    setLines(lines.map((l) => (l.kind === 'kit' ? { ...l, days: String(d) } : l)))
    setKitDays('')
  }
  const groups = linesByGroup(lines)
  const kitLines = lines.filter((l) => l.kind === 'kit').length

  return (
    <form className="card quote-draft" aria-label={`Version ${q.version}, a draft`} onSubmit={save}>
      <header className="title">
        <h2>Version {q.version}</h2>
        <QuotePill q={q} />
      </header>
      <p className="hint">A draft: change anything, then save it. Once it's marked as sent it stays as it went, and any change after is a new version.</p>
      {lines.length === 0 && <Empty>No lines yet. Add what the quote is for.</Empty>}
      {groups.map((g) => (
        <fieldset key={g.group} className="quote-group">
          <legend>{g.group}</legend>
          {g.lines.map((l) => {
            const n = lines.indexOf(l) + 1
            const r = read[n - 1]
            return (
              <div key={l.id} className="quote-line">
                <label className="what">
                  What
                  <input value={l.what} onChange={(e) => set(l.id, { what: e.target.value })} maxLength={200} aria-label={`Line ${n}: what`} />
                </label>
                <label>
                  How many
                  <input inputMode="numeric" value={l.qty} onChange={(e) => set(l.id, { qty: e.target.value })} aria-label={`Line ${n}: how many`} />
                </label>
                <label>
                  Days
                  <input inputMode="decimal" value={l.days} onChange={(e) => set(l.id, { days: e.target.value })} aria-label={`Line ${n}: days charged`} />
                </label>
                <label>
                  € a day
                  <input inputMode="decimal" value={l.price} onChange={(e) => set(l.id, { price: e.target.value })} aria-label={`Line ${n}: price a day`} placeholder="0" />
                </label>
                <label>
                  VAT
                  <select value={l.vat} onChange={(e) => set(l.id, { vat: e.target.value as VatRate })} aria-label={`Line ${n}: VAT`}>
                    {VAT_RATES.map((v) => (
                      <option key={v} value={v}>
                        {VAT_LABELS[v]}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="amount">{r === undefined || typeof r === 'string' ? '–' : money(lineCents(r))}</span>
                <button type="button" className="link" onClick={() => setLines(lines.filter((x) => x.id !== l.id))} aria-label={`Remove line ${n}`}>
                  Remove
                </button>
              </div>
            )
          })}
        </fieldset>
      ))}
      <div className="actions">
        <button type="button" onClick={add} disabled={lines.length >= MAX_LINES}>
          Add a line
        </button>
        {kitLines > 0 && (
          <span className="kit-days-all">
            <label>
              Charge all kit for
              <input inputMode="decimal" value={kitDays} onChange={(e) => setKitDays(e.target.value)} placeholder="3" aria-label="Days charged for all kit" />
              days
            </label>
            <button type="button" onClick={allKitDays} disabled={!kitDays.trim()}>
              Apply
            </button>
          </span>
        )}
      </div>
      <p className="hint">A week's hire charged as three days, say: set the days on each line, or on all the kit at once.</p>
      <label className="field">
        Discount, %
        <input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} aria-label="Discount, %" />
        {view.money.discountOf(job.clientId) !== undefined && <small>{job.client?.name} usually gets {pctWord(view.money.discountOf(job.clientId)!)} off.</small>}
      </label>
      <label className="field">
        Notes for the client
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} placeholder="Load in from 8am. Prices include delivery to the venue." />
      </label>
      <Totals totals={totals} discountPct={pct >= 0 && pct <= 100 ? pct : 0} />
      <Refusal error={error} />
      <div className="actions">
        <button type="submit" className={saved ? '' : 'primary'} disabled={saved}>
          {saved ? 'Saved' : 'Save draft'}
        </button>
        <button type="button" onClick={onPrint} disabled={!saved}>
          Print or save as PDF
        </button>
      </div>
      {!saved && <p className="warn-line">Not saved yet. Save it to print it or send it.</p>}
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
            <th scope="col">A day</th>
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
                <td className="n">{l.days.toLocaleString('en-IE')}</td>
                <td className="n">{money(l.unitCents)}</td>
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
  return (
    <>
      <header>
        <p className="kicker">Session Hire · quote</p>
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
        Prices are in euro: each line is how many, for the days charged, at the price a day.
        {reach && ` Questions: ${reach}.`}
      </footer>
    </>
  )
}
