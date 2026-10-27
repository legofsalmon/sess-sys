import { money, plural, rmsDepth, type RmsLine, type RmsOpportunity, type RmsOpportunityPage, type RmsOpportunityWithLines, type View } from '@sh/shared'
import { useEffect, useState } from 'react'
import { markSignedOut } from '../auth.ts'
import { Empty } from '../Empty.tsx'
import { useAccess } from '../role.ts'
import { JOBS, MONEY, type Step } from '../Up.tsx'
import { Top } from './common.tsx'
import { NotYours } from './Money.tsx'

/**
 * Past quotes from Current RMS (ADR 0078), #jobs/money/current-rms, for
 * the office and directors: every opportunity read from Current RMS,
 * newest first, found by number, subject, client or venue, and each one's
 * lines as Current RMS had them. Read only: the server keeps the copy and
 * answers from it, since it is too big and too private to go on every
 * phone, so it needs signal.
 */

const base = import.meta.env.VITE_API_BASE ?? ''
const PAST: Step = { href: '#jobs/money/current-rms', label: 'Past quotes', up: 'All past quotes' }

type Loaded<T> = { state: 'loading' } | { state: 'offline' } | { state: 'gone'; error: string } | { state: 'ready'; data: T }

async function getJson<T>(url: string): Promise<Loaded<T>> {
  try {
    const res = await fetch(`${base}${url}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    if (res.status === 401) {
      markSignedOut()
      return { state: 'offline' }
    }
    if (!res.ok) return { state: 'gone', error: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `The server answered ${res.status}.` }
    return { state: 'ready', data: (await res.json()) as T }
  } catch {
    return { state: 'offline' }
  }
}

const dayOf = (at: string | null) => (at ? new Date(at).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Dublin' }) : '')
const span = (o: RmsOpportunity) => {
  const a = dayOf(o.startsAt)
  const b = dayOf(o.endsAt)
  return a && b && a !== b ? `${a} to ${b}` : a
}
const stateWords = (o: RmsOpportunity) => [o.state, o.status].filter(Boolean).join(', ')

export function PastQuotesScreen({ view }: { view: View }) {
  const [search, setSearch] = useState('')
  const [asked, setAsked] = useState('')
  const [page, setPage] = useState(1)
  const [loaded, setLoaded] = useState<Loaded<RmsOpportunityPage>>({ state: 'loading' })
  const can = useAccess().can('money')

  // Asked a moment after typing stops, so each letter isn't a request.
  useEffect(() => {
    const t = setTimeout(() => {
      setAsked(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])
  useEffect(() => {
    if (!can) return
    let live = true
    void getJson<RmsOpportunityPage>(`/api/rms/opportunities?q=${encodeURIComponent(asked)}&page=${page}`).then((l) => live && setLoaded(l))
    return () => {
      live = false
    }
  }, [asked, page, can])

  if (!can) return <NotYours view={view} here="Past quotes" />
  return (
    <div className="app crew jobs money past-quotes">
      <Top view={view} up={{ steps: [JOBS, MONEY], here: 'Past quotes' }} />
      <section className="card">
        <h1>Past quotes from Current RMS</h1>
        <p className="hint">
          Every opportunity read from Current RMS, as it was there: quotes, orders, lost and dead ones. Read only. To read them again, go to{' '}
          <a href="#admin">Admin</a>.
        </p>
        <input className="search" type="search" placeholder="Find by number, job, client or venue" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a past quote" />
      </section>
      <section className="card" aria-label="Past quotes" aria-busy={loaded.state === 'loading'}>
        {loaded.state === 'loading' && <p className="hint">Looking…</p>}
        {loaded.state === 'offline' && <p className="hint">Past quotes are kept on the server, so they need signal. Try again when you have it.</p>}
        {loaded.state === 'gone' && <p className="alert">{loaded.error}</p>}
        {loaded.state === 'ready' && (
          <>
            {loaded.data.total === 0 ? (
              <Empty>{asked ? `No past quote matches “${asked}”.` : 'Nothing has been read from Current RMS yet. Bring it in from Admin.'}</Empty>
            ) : (
              <p className="hint">
                {plural(loaded.data.total, 'past quote')}
                {asked ? ` matching “${asked}”` : ''}, newest first.
              </p>
            )}
            <ul className="job-list">
              {loaded.data.opportunities.map((o) => (
                <li key={o.id}>
                  <a className="job-row" href={`#jobs/money/current-rms/${o.id}`}>
                    <div>
                      <b>{o.subject || o.number}</b>
                      <p>{[o.number, o.client, span(o)].filter(Boolean).join(' · ')}</p>
                      <p className="hint">{stateWords(o)}</p>
                    </div>
                    <div className="side">
                      {money(o.netCents)}
                      <span aria-hidden="true"> ›</span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
            {loaded.data.total > 50 && (
              <div className="row">
                <button type="button" className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
                  Newer
                </button>
                <span className="hint">
                  Page {page} of {Math.ceil(loaded.data.total / 50)}
                </span>
                <button type="button" className="secondary" disabled={page * 50 >= loaded.data.total} onClick={() => setPage(page + 1)}>
                  Older
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function LineRow({ l }: { l: RmsLine }) {
  const depth = rmsDepth(l.path)
  if (l.kind === 'Group') {
    return (
      <li className="rms-group" style={{ paddingInlineStart: `${depth}rem` }}>
        <b>{l.name}</b>
      </li>
    )
  }
  const detail = [
    `${l.quantity.toLocaleString('en-IE')} × ${money(l.priceCents)}${l.period ? ` (${l.period.toLowerCase()})` : ''}`,
    l.chargeableDays != null ? `${l.chargeableDays.toLocaleString('en-IE')} chargeable day${l.chargeableDays === 1 ? '' : 's'}` : '',
    l.discountPct ? `${l.discountPct.toLocaleString('en-IE')}% off` : '',
    l.rateDefinition,
    l.subRent ? 'subhired' : '',
  ].filter(Boolean)
  return (
    <li className="job-row" style={{ paddingInlineStart: `${depth}rem` }}>
      <div>
        <span>{l.name}</span>
        <p className="hint">
          {[l.kind === 'Accessory' ? 'Accessory' : l.transaction, ...detail].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="side">{money(l.totalCents)}</div>
    </li>
  )
}

export function PastQuoteScreen({ view, id }: { view: View; id: string }) {
  const [loaded, setLoaded] = useState<Loaded<RmsOpportunityWithLines>>({ state: 'loading' })
  const can = useAccess().can('money')
  useEffect(() => {
    if (!can) return
    let live = true
    void getJson<RmsOpportunityWithLines>(`/api/rms/opportunities/${encodeURIComponent(id)}`).then((l) => live && setLoaded(l))
    return () => {
      live = false
    }
  }, [id, can])

  if (!can) return <NotYours view={view} here="Past quote" />
  const o = loaded.state === 'ready' ? loaded.data.opportunity : undefined
  const here = o ? o.subject || o.number : 'Past quote'
  return (
    <div className="app crew jobs money past-quote">
      <Top view={view} up={{ steps: [JOBS, MONEY, PAST], here }} />
      {loaded.state === 'loading' && (
        <section className="card">
          <p className="hint">Looking…</p>
        </section>
      )}
      {loaded.state === 'offline' && (
        <section className="card">
          <p className="hint">Past quotes are kept on the server, so they need signal. Try again when you have it.</p>
        </section>
      )}
      {loaded.state === 'gone' && (
        <section className="card">
          <p className="alert">{loaded.error}</p>
        </section>
      )}
      {loaded.state === 'ready' && o && (
        <>
          <section className="card">
            <h1>{here}</h1>
            <p>{[o.number, o.client, o.venue].filter(Boolean).join(' · ')}</p>
            <p className="hint">
              {[stateWords(o), span(o), o.chargeableDays != null ? `${o.chargeableDays.toLocaleString('en-IE')} chargeable days` : ''].filter(Boolean).join(' · ')}
            </p>
            <dl className="facts money-facts">
              <div>
                <dt>Before VAT</dt>
                <dd>{money(o.netCents)}</dd>
              </div>
              <div>
                <dt>VAT</dt>
                <dd>{money(o.taxCents)}</dd>
              </div>
              <div>
                <dt>With VAT</dt>
                <dd>{money(o.grossCents)}</dd>
              </div>
            </dl>
            <p className="hint">
              {[
                o.rentalCents ? `Hire ${money(o.rentalCents)}` : '',
                o.saleCents ? `Sales ${money(o.saleCents)}` : '',
                o.serviceCents ? `Services ${money(o.serviceCents)}` : '',
                o.surchargeCents ? `Surcharges ${money(o.surchargeCents)}` : '',
                o.discountCategory ? `Client discount: ${o.discountCategory}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </section>
          <section className="card" aria-label="Lines">
            <h2>Lines</h2>
            {loaded.data.lines.length === 0 ? (
              <Empty>No lines were read for this one.</Empty>
            ) : (
              <ul className="job-list rms-lines">
                {loaded.data.lines.map((l) => (
                  <LineRow key={l.id} l={l} />
                ))}
              </ul>
            )}
            <p className="hint">Prices before VAT, as Current RMS worked them out.</p>
          </section>
        </>
      )}
    </div>
  )
}
