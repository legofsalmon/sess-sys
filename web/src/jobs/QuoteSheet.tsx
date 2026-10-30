import {
  irishToday,
  lineCents,
  linesByGroup,
  money,
  pctWord,
  spanLabel,
  VAT_LABELS,
  venueLabel,
  type JobView,
  type LineKind,
  type QuoteLine,
  type QuoteTotals,
  type QuoteView,
  type View,
  RATE_UNIT,
  depositCents,
  letterDay,
  quoteNumberLabel,
  validUntil,
  type QuoteSettings,
} from '@sh/shared'
import { Empty } from '../Empty.tsx'
import { Sideways } from '../more.tsx'

/**
 * The quote as the client is sent it (ADR 0042): the A4 page, its lines and
 * its totals.
 */

const KIND_WORDS: Record<LineKind, string> = { kit: 'Kit', crew: 'Crew', other: 'Other' }

export function Lines({ lines }: { lines: readonly QuoteLine[] }) {
  if (!lines.length) return <Empty>No lines.</Empty>
  return (
    <Sideways className="quote-table-wrap">
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
    </Sideways>
  )
}

export function Totals({ totals, agreed }: { totals: QuoteTotals; agreed: boolean }) {
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
export function QuoteSheet({ q, job, office, quoting }: { q: QuoteView; job: JobView; office: View['office']; quoting: QuoteSettings }) {
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
