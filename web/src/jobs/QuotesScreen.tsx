import { dayLabel, money, QUOTE_SHOWS, QUOTE_STATUS_LABELS, quoteNumberLabel, quoteRows, quoteRowShown, type QuoteRow, type QuoteShow, type QuoteView, type View } from '@sh/shared'
import { useMemo, useState } from 'react'
import { Empty } from '../Empty.tsx'
import { FromMailbox } from './Claude.tsx'
import { ShowAll } from '../Fold.tsx'
import { Heading } from '../Icon.tsx'
import { useAccess } from '../role.ts'
import { useView } from '../view.ts'
import { Top } from './common.tsx'
import { ToFollowUp } from './Money.tsx'
import { QuotePill } from './Quote.tsx'

/**
 * Quotes (#quotes, ADR 0088): every quote in one place, a place of its own in the sidebar on a desk and on the Menu on a
 * phone, for the office and directors. What's waiting on the office first, with a new quote a press away, then every
 * job's quote, the last changed first, to find by job, client, venue, number or invoice. Each opens on the job's quote,
 * where it's changed: this page only finds them.
 */
export function QuotesScreen() {
  const view = useView()
  if (!useAccess().can('money'))
    return (
      <div className="app crew jobs money quotes">
        <Top view={view} title="Quotes" root heading="Quotes" />
        <section className="card">
          <p className="empty">Quotes are for the office and directors. A director can change your role on the Crew tab.</p>
        </section>
      </div>
    )
  return (
    <div className="app crew jobs money quotes">
      <Top view={view} title="Quotes" root heading="Quotes" />
      <FromMailbox view={view} />
      <ToFollowUp view={view} />
      <AllQuotes view={view} />
    </div>
  )
}

function AllQuotes({ view }: { view: View }) {
  const [show, setShow] = useState<QuoteShow>('all')
  const [search, setSearch] = useState('')
  const rows = useMemo(() => quoteRows(view.money), [view.money])
  const count = (s: QuoteShow) => rows.filter((r) => quoteRowShown(r, s, '')).length
  const shown = rows.filter((r) => quoteRowShown(r, show, search))
  return (
    <section className="card quote-list" aria-label="All quotes">
      <Heading icon="document">All quotes</Heading>
      {rows.length > 0 && (
        <>
          <input className="search" type="search" placeholder="Find a job, client, venue or number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a quote" />
          <div className="filters" role="group" aria-label="Show">
            {QUOTE_SHOWS.map(([s, label]) => (
              <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)}>
                {label} ({count(s)})
              </button>
            ))}
          </div>
        </>
      )}
      {rows.length === 0 && <Empty>No quotes yet. Start one under New quote, or from a job's page.</Empty>}
      {rows.length > 0 && shown.length === 0 && <p className="hint">No quote matches that.</p>}
      {/* A search looks through them all; otherwise the last thirty changed, until Show all. */}
      <ShowAll key={`${show} ${search}`} items={shown} limit={search.trim() ? shown.length : 30} what="quotes">
        {(list) => (
          <ul className="plain">
            {list.map((r) => (
              <QuoteRowItem key={r.job.id} r={r} />
            ))}
          </ul>
        )}
      </ShowAll>
      <p className="hint">
        Invoiced and paid quotes count as accepted. <a href="#jobs/money/prices">Price list</a> · <a href="#jobs/money/current-rms">Past quotes from Current RMS</a> ·{' '}
        <a href="#jobs/money">Money</a>
      </p>
    </section>
  )
}

/** What last happened to a version, in a few words. */
function lastWord(q: QuoteView): string {
  if (q.status === 'draft') return 'Being put together'
  if (q.paidOn) return `Paid ${dayLabel(q.paidOn)}`
  if (q.invoicedOn) return `Invoiced ${dayLabel(q.invoicedOn)}${q.invoiceRef ? ` as ${q.invoiceRef}` : ''}`
  if (q.answeredOn) return `${QUOTE_STATUS_LABELS[q.status]} ${dayLabel(q.answeredOn)}`
  return q.sentOn ? `Sent ${dayLabel(q.sentOn)}` : QUOTE_STATUS_LABELS[q.status]
}

function QuoteRowItem({ r }: { r: QuoteRow }) {
  const { job, quote, behind } = r
  const number = quoteNumberLabel(behind ?? quote)
  const when = job.span ? (job.span.start === job.span.end ? dayLabel(job.span.start) : `${dayLabel(job.span.start)} to ${dayLabel(job.span.end)}`) : 'No dates yet'
  return (
    <li className="row">
      <div>
        <a href={`#jobs/${encodeURIComponent(job.id)}/quote`}>{job.name}</a>
        <p>
          {[job.client?.name, when, number && `No. ${number}`].filter(Boolean).join(' · ')}
          <br />
          {behind ? `Version ${quote.version} being put together over version ${behind.version}: ${lastWord(behind).toLowerCase()}` : lastWord(quote)} · {money(quote.totals.net)}
          {quote.lines.length === 0 && ' · No lines yet'}
        </p>
      </div>
      <QuotePill q={quote} />
    </li>
  )
}
