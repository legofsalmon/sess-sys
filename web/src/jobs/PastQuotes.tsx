import {
  irishToday,
  money,
  newId,
  plural,
  rmsDepth,
  rmsJobDraft,
  rmsSuggestions,
  STATUS_LABELS,
  suggestionLine,
  type RmsClientStats,
  type RmsLine,
  type RmsMatches,
  type RmsMatchRow,
  type RmsOffered,
  type RmsOpportunity,
  type RmsOpportunityPage,
  type RmsOpportunityWithLines,
  type View,
} from '@sh/shared'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { useAccess } from '../role.ts'
import { client } from '../sync.ts'
import { JOBS, MONEY, type Step } from '../Up.tsx'
import { pricingOf, Suggestions, takingWords } from './Claude.tsx'
import { Choices, clientNamed, Top, venueNamed } from './common.tsx'
import { NotYours } from './Money.tsx'
import { clientWords, getJson, postJson, useAsked, type Loaded } from './rms.ts'

/**
 * Past quotes from Current RMS (ADR 0078), #jobs/money/current-rms, for
 * the office and directors: every opportunity read from Current RMS,
 * newest first, found by number, subject, client or venue, and each one's
 * lines as Current RMS had them. Read only: the server keeps the copy and
 * answers from it, since it is too big and too private to go on every
 * phone, so it needs signal. Each can be linked to the job it was for
 * (ADR 0092), and how each client's quotes went is in a card of its own.
 */

const PAST: Step = { href: '#jobs/money/current-rms', label: 'Past quotes', up: 'All past quotes' }

const dayOf = (at: string | null) => (at ? new Date(at).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Dublin' }) : '')
const span = (o: Pick<RmsOpportunity, 'startsAt' | 'endsAt'>) => {
  const a = dayOf(o.startsAt)
  const b = dayOf(o.endsAt)
  return a && b && a !== b ? `${a} to ${b}` : a
}
const stateWords = (o: Pick<RmsOpportunity, 'state' | 'status'>) => [o.state, o.status].filter(Boolean).join(', ')

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
          <a href="#admin/connections">Admin › Connections</a>.
        </p>
        <input className="search" type="search" placeholder="Find by number, job, client or venue" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a past quote" />
        <p>
          <a href="#jobs/money/current-rms/match">Match them to our jobs ›</a>
        </p>
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
      <ByClient />
    </div>
  )
}

const CLIENTS_SHOWN = 12

/** How each client's quotes went in Current RMS (ADR 0092): how many went ahead, the usual discount, and when last. */
function ByClient() {
  const loaded = useAsked<RmsClientStats[]>(true, 'clients', () => getJson('/api/rms/clients'))
  const [all, setAll] = useState(false)
  if (loaded.state !== 'ready' || loaded.data.length === 0) return null
  const shown = all ? loaded.data : loaded.data.slice(0, CLIENTS_SHOWN)
  return (
    <section className="card" aria-label="By client">
      <h2>By client</h2>
      <p className="hint">
        Went ahead means it became an order that wasn't cancelled. A quote whose days are past with no order didn't. Ones still to come aren't counted either way. The
        discount is off what the lines came to, on those that went ahead.
      </p>
      <ul className="job-list">
        {shown.map((c) => (
          <li key={c.client} className="job-row">
            <div>
              <b>{c.client}</b>
              <p className="hint">{clientWords(c)}</p>
            </div>
            <div className="side">{plural(c.quotes, 'quote')}</div>
          </li>
        ))}
      </ul>
      {!all && loaded.data.length > CLIENTS_SHOWN && (
        <button type="button" className="link" onClick={() => setAll(true)}>
          Show all {loaded.data.length} clients
        </button>
      )}
    </section>
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

export function PastQuoteScreen({ view, id: asked }: { view: View; id: string }) {
  const can = useAccess().can('money')
  // #jobs/money/current-rms/<id>/job opens it with the job being made (ADR 0102), as the Quotes page's "Make a job" does.
  const id = asked.replace(/\/job$/, '')
  const [making, setMaking] = useState(asked !== id)
  const loaded = useAsked<RmsOpportunityWithLines>(can, id, () => getJson(`/api/rms/opportunities/${encodeURIComponent(id)}`))

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
            <p>
              {loaded.data.job ? (
                <>
                  For <a href={`#jobs/${encodeURIComponent(loaded.data.job.id)}`}>{loaded.data.job.name}</a>.{' '}
                </>
              ) : (
                'Not linked to one of our jobs. '
              )}
              <a href="#jobs/money/current-rms/match">Match to jobs</a>
            </p>
            {!making && (
              <div className="actions">
                <button type="button" className={loaded.data.job ? 'secondary' : 'primary'} onClick={() => setMaking(true)}>
                  {loaded.data.job ? 'Make another job from this' : 'Make a job from this'}
                </button>
              </div>
            )}
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
          {making && <MakeJob view={view} past={loaded.data} onCancel={() => setMaking(false)} />}
        </>
      )}
    </div>
  )
}

/**
 * A job made from a past quote (ADR 0102): the job as Current RMS had it, made here as an enquiry or a confirmed job
 * with its days as one Show, and its first draft quote with the lines ticked, each matched to the stock list where it's
 * plainly the same product and charged as it was there. Nothing is made until the office presses it, and nothing in
 * Current RMS changes. A past quote not linked to a job yet is linked to this one, so the quote shows what was charged.
 */
function MakeJob({ view, past, onCancel }: { view: View; past: RmsOpportunityWithLines; onCancel: () => void }) {
  const o = past.opportunity
  const { clients, venues } = view.jobs
  const today = irishToday()
  const first = useMemo(() => rmsJobDraft(o, past.lines, clients.map((c) => c.name), today), [o, past.lines, clients, today])
  const [f, setF] = useState(first)
  const [agree, setAgree] = useState(first.agreedCents !== null)
  const pricing = pricingOf(view)
  // Matched once, when the form opens, so the choices made on each line stay as the stock list syncs.
  const [lines, setLines] = useState<RmsOffered[]>(() => rmsSuggestions(past.lines, pricing))
  const { run, error } = useAct()
  // Brought into view as it opens, below the past quote's lines.
  const here = useRef<HTMLElement>(null)
  useEffect(() => {
    here.current?.scrollIntoView({ block: 'start' })
  }, [])
  const taking = lines.filter((x) => x.take)
  const matched = taking.filter((x) => x.s.modelId).length
  const kit = taking.filter((x) => x.s.kind === 'kit').length
  const left = lines.length - taking.length
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return
    const id = newId()
    void run(async () => {
      const clientId = await clientNamed(f.client, clients)
      const venueId = await venueNamed(f.venue, venues)
      const notes = `Made from ${o.number ? `quote ${o.number}` : 'a quote'} in Current RMS.`
      await client.mutate('project.create', { id, name: f.name.trim(), clientId, venueId, status: f.status, kind: 'gig', notes })
      await client.mutate('phase.add', { id: newId(), projectId: id, name: 'Show', start: f.start, end: f.end < f.start ? f.start : f.end, venueId: null, notes: '' })
      await client.mutate('quote.save', {
        id: newId(),
        projectId: id,
        lines: taking.map((x) => suggestionLine(x.s, newId())),
        discountPct: 0,
        notes: '',
        ...(agree && f.agreedCents !== null ? { agreedCents: f.agreedCents } : {}),
      })
      // Linked once the job is on the server, so the quote shows what Current RMS charged; Match to jobs can do it after if not.
      if (!past.job) {
        await client.sync().catch(() => undefined)
        await postJson('/api/rms/matches', { links: [{ opportunityId: o.id, projectId: id }] })
      }
    }).then((ok) => ok && (location.hash = `#jobs/${encodeURIComponent(id)}/quote`))
  }
  return (
    <section className="card" aria-label="Make a job from this" ref={here}>
      <h2>Make a job from this</h2>
      <p className="hint">
        The job and a draft quote, as Current RMS had them. Check each before you make it.
        {f.end < today && ' The days are past: change them for a job still to come.'}
      </p>
      <form className="grid-form new-quote" onSubmit={submit}>
        <label className="wide">
          What's the job? <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </label>
        <label>
          Client <input list="rms-job-clients" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} placeholder="Pick or add one" />
        </label>
        <label>
          Venue <input list="rms-job-venues" value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} placeholder="Pick or add one" />
        </label>
        <label>
          From <input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value, end: f.end < e.target.value ? e.target.value : f.end })} required />
        </label>
        <label>
          To <input type="date" value={f.end} min={f.start} onChange={(e) => setF({ ...f, end: e.target.value })} required />
        </label>
        <label>
          Make it
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as 'enquiry' | 'confirmed' })}>
            <option value="enquiry">{STATUS_LABELS.enquiry}</option>
            <option value="confirmed">{STATUS_LABELS.confirmed}</option>
          </select>
        </label>
        {lines.length > 0 ? (
          <section className="wide" aria-label="Lines for the quote">
            <h3>Lines for the quote</h3>
            <p className="hint">
              {matched} of {plural(kit, 'kit line')} found in the stock list; the rest go on as written. Each is charged as it was in
              Current RMS: the same price, rate, days and discount.
              {left > 0 && ` ${left} charged nothing there ${left === 1 ? 'is' : 'are'} left unticked.`}
            </p>
            <Suggestions view={view} items={lines} onChange={(next) => setLines(next as RmsOffered[])} />
          </section>
        ) : (
          <p className="hint wide">No lines were read for this one, so the quote starts empty.</p>
        )}
        {f.agreedCents !== null && (
          <label className="wide tick">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> Agree the same total, {money(f.agreedCents)} before VAT, as was agreed in Current RMS
          </label>
        )}
        <p className="hint wide">
          Added to Jobs as {f.status === 'confirmed' ? 'a confirmed job' : 'an enquiry'}, with the quote as a draft to change and send. Nothing changes in Current RMS.
        </p>
        <Refusal error={error} className="wide" />
        <div className="actions wide">
          <button type="submit" className="primary">
            {taking.length ? `Make the job, with ${takingWords(lines)} on the quote` : 'Make the job'}
          </button>
          <button type="button" className="link" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <Choices id="rms-job-clients" names={clients} />
        <Choices id="rms-job-venues" names={venues} />
      </form>
    </section>
  )
}

type Showing = 'check' | 'linked' | 'none'
const SHOWING_LABELS: Record<Showing, string> = { check: 'To check', linked: 'Linked', none: 'No job found' }
const MATCH_PAGE = 50
const daysOf = (j: { start: string; end: string }) => span({ startsAt: `${j.start}T12:00:00Z`, endsAt: `${j.end}T12:00:00Z` })

/**
 * Matching past quotes to our jobs (ADR 0092), #jobs/money/current-rms/match: each opportunity's likeliest job, from
 * the days, the client and the words of its name, for the office to link with a press, all the sure ones at once.
 * Linking only records which job it was for here; nothing in Current RMS or on the job changes, and Unlink takes it off.
 */
export function MatchScreen({ view }: { view: View }) {
  const can = useAccess().can('money')
  const [again, setAgain] = useState(0)
  const loaded = useAsked<RmsMatches>(can, 'matches', () => getJson('/api/rms/matches'), again)
  const [showing, setShowing] = useState<Showing>('check')
  const [shown, setShown] = useState(MATCH_PAGE)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')

  if (!can) return <NotYours view={view} here="Match to jobs" />
  const rows = loaded.state === 'ready' ? loaded.data.rows : []
  const of = (r: RmsMatchRow): Showing => (r.linked ? 'linked' : r.suggested.candidates.length ? 'check' : 'none')
  const counts = { check: 0, linked: 0, none: 0 }
  for (const r of rows) counts[of(r)]++
  const sure = rows.filter((r) => !r.linked && r.suggested.sure && r.suggested.projectId)
  const list = rows.filter((r) => of(r) === showing)

  const link = async (links: { opportunityId: number; projectId: string | null }[], done: string) => {
    setBusy(true)
    const l = await postJson<{ linked: number }>('/api/rms/matches', { links })
    setBusy(false)
    setSaid(l.state === 'ready' ? done : l.state === 'gone' ? l.error : 'Not saved: linking needs signal. Try again when you have it.')
    setAgain((n) => n + 1)
  }

  return (
    <div className="app crew jobs money past-quotes rms-match">
      <Top view={view} up={{ steps: [JOBS, MONEY, PAST], here: 'Match to jobs' }} />
      <section className="card">
        <h1>Match past quotes to our jobs</h1>
        <p className="hint">
          Each past quote from Current RMS beside the job of ours it looks like, from its days, its client and its name. Link the ones that are right, and the job's
          quote shows what was quoted and charged before. Nothing changes in Current RMS or on the job.
        </p>
        {loaded.state === 'ready' && (
          <>
            <p>
              {counts.linked} linked, {counts.check} to check, {counts.none} with no job of ours on those days.
            </p>
            {sure.length > 0 && (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void link(sure.map((r) => ({ opportunityId: r.opportunity.id, projectId: r.suggested.projectId })), `Linked ${plural(sure.length, 'sure one')}.`)}
              >
                Link the {plural(sure.length, 'sure one')}
              </button>
            )}
            {sure.length > 0 && <p className="hint">Sure means the same days and the client or most of the name, with no other job close. Each one can be unlinked after.</p>}
          </>
        )}
        {said && (
          <p className="hint" role="status">
            {said}
          </p>
        )}
      </section>
      <section className="card" aria-label="Past quotes to match" aria-busy={loaded.state === 'loading'}>
        {loaded.state === 'loading' && <p className="hint">Looking…</p>}
        {loaded.state === 'offline' && <p className="hint">Past quotes are kept on the server, so they need signal. Try again when you have it.</p>}
        {loaded.state === 'gone' && <p className="alert">{loaded.error}</p>}
        {loaded.state === 'ready' && (
          <>
            <div className="filters" role="group" aria-label="Showing">
              {(['check', 'linked', 'none'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={showing === k}
                  onClick={() => {
                    setShowing(k)
                    setShown(MATCH_PAGE)
                  }}
                >
                  {SHOWING_LABELS[k]} · {counts[k]}
                </button>
              ))}
            </div>
            {list.length === 0 ? (
              <Empty>
                {rows.length === 0
                  ? 'Nothing has been read from Current RMS yet. Bring it in from Admin.'
                  : showing === 'check'
                    ? 'Nothing left to check.'
                    : showing === 'linked'
                      ? 'None linked yet.'
                      : 'Every past quote has a job of ours on its days.'}
              </Empty>
            ) : (
              <ul className="job-list">
                {list.slice(0, shown).map((r) => (
                  <MatchRow key={r.opportunity.id} r={r} jobs={loaded.data.jobs} busy={busy} onLink={link} />
                ))}
              </ul>
            )}
            {list.length > shown && (
              <button type="button" className="link" onClick={() => setShown(shown + MATCH_PAGE)}>
                Show {Math.min(MATCH_PAGE, list.length - shown)} more of {list.length}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function MatchRow({ r, jobs, busy, onLink }: { r: RmsMatchRow; jobs: RmsMatches['jobs']; busy: boolean; onLink: (links: { opportunityId: number; projectId: string | null }[], done: string) => Promise<void> }) {
  const o = r.opportunity
  const [pick, setPick] = useState(r.suggested.projectId ?? r.suggested.candidates[0]?.projectId ?? '')
  const linked = r.linked ? jobs[r.linked] : undefined
  const name = o.subject || o.number
  return (
    <li className="job-row match-row">
      <div>
        <a href={`#jobs/money/current-rms/${o.id}`}>
          <b>{name}</b>
        </a>
        <p>{[o.number, o.client, span(o)].filter(Boolean).join(' · ')}</p>
        <p className="hint">
          {stateWords(o)} · {money(o.netCents)}
        </p>
        {r.linked ? (
          <p>
            For <a href={`#jobs/${encodeURIComponent(r.linked)}`}>{linked?.name ?? 'a job'}</a>
            {linked ? ` · ${daysOf(linked)}` : ''}{' '}
            <button type="button" className="link" disabled={busy} onClick={() => void onLink([{ opportunityId: o.id, projectId: null }], `Unlinked ${name}.`)}>
              Unlink
            </button>
          </p>
        ) : r.suggested.candidates.length > 0 ? (
          <div className="row">
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label={`Job for ${name}`}>
              {r.suggested.candidates.map((c) => {
                const j = jobs[c.projectId]
                return (
                  <option key={c.projectId} value={c.projectId}>
                    {j ? [j.name, j.client, daysOf(j)].filter(Boolean).join(' · ') : c.projectId}
                  </option>
                )
              })}
            </select>
            <button type="button" className="secondary" disabled={busy || !pick} onClick={() => void onLink([{ opportunityId: o.id, projectId: pick }], `Linked ${name}.`)}>
              Link
            </button>
            {r.suggested.sure && pick === r.suggested.projectId && <span className="hint">Sure</span>}
          </div>
        ) : (
          <p className="hint">No job of ours on those days.</p>
        )}
      </div>
    </li>
  )
}
