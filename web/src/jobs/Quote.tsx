import {
  dayLabel,
  daysWord,
  linesFor,
  MAX_LINES,
  money,
  newId,
  pctWord,
  QUOTE_STATUS_LABELS,
  spanLabel,
  type JobView,
  type QuoteLine,
  type QuoteTotals,
  type QuoteView,
  type View,
  depositCents,
  validUntil,
  versionChanges,
  lineCostOf,
  quoteMargin,
} from '@sh/shared'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Heading } from '../Icon.tsx'
import { useAccess } from '../role.ts'
import { client } from '../sync.ts'
import { JOBS } from '../Up.tsx'
import { useToday } from '../view.ts'
import { Top } from './common.tsx'
import { QuotePill } from './QuoteStatus.tsx'
import { MarginWords } from './QuoteLine.tsx'
import { Lines, QuoteSheet, Totals } from './QuoteSheet.tsx'
import { InCurrentRms, NewVersion, Records } from './QuoteRecords.tsx'
import { Draft } from './QuoteDraft.tsx'

export { InStep, QuotePill } from './QuoteStatus.tsx'

/**
 * A job's quote (ADR 0042), #jobs/<id>/quote, for the office and directors:
 * built from the job's kit and crew at the price list, every line open to
 * change while it's a draft, then kept as it went once it's gone to the
 * client, with a new version for any change after. It prints as an A4 page
 * to save as a PDF, as the call sheet does: nothing is sent from the app.
 * The client's answer, the invoice and the payment are records the office
 * keeps here of what happened outside it.
 */

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
