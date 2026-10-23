import {
  CREW_DEPARTMENTS,
  dayLabel,
  irishToday,
  matchAsker,
  newId,
  plural,
  PURCHASE_STATUS_LABELS,
  PURCHASE_STATUS_LINES,
  PURCHASE_STATUSES,
  readPurchaseList,
  type BroughtInPurchase,
  type PurchaseListRow,
  type PurchaseStatus,
  type PurchaseView,
  type View,
} from '@sh/shared'
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Fold, ShowAll } from '../Fold.tsx'
import { Heading } from '../Icon.tsx'
import { Page, Top } from '../jobs/common.tsx'
import { useAccess } from '../role.ts'
import { Pending, StatusPill, type PillTone } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { BUY, STOCK } from '../Up.tsx'
import { useToday } from '../view.ts'
import { StockViews } from '../Views.tsx'
import './purchases.css'

/**
 * The purchase list (ADR 0077), along Stock's row at #stock/buy: kit the
 * crew ask to be bought, open to everyone signed in. Asked for and agreed
 * are ranked by votes, most first, so the office sees what the crew would
 * find most useful; ordered comes next, and what's arrived or not being
 * bought is folded away. Each request has a page (#stock/buy/<id>) with
 * who voted, where it's at, and the way to change it. A list from a
 * spreadsheet comes in at #stock/buy/bring-in. Works with no signal.
 */

export const purchaseHref = (id: string) => `#stock/buy/${encodeURIComponent(id)}`

/** "Wed 22 Apr", with the year when it isn't this one. */
function onDay(d: string, today: string): string {
  return d.slice(0, 4) === today.slice(0, 4) ? dayLabel(d) : `${dayLabel(d)} ${d.slice(0, 4)}`
}

/** Healthy is quiet: waiting for a decision is attention, agreed and ordered are on their way, arrived is settled, not buying is off. */
const TONES: Record<PurchaseStatus, PillTone> = { asked: 'pending', agreed: 'confirmed', ordered: 'confirmed', arrived: 'confirmed', no: 'cancelled' }

export function PurchasesScreen({ view }: { view: View }) {
  const access = useAccess()
  const today = useToday()
  const [department, setDepartment] = useState('')
  const list = view.purchases
  const departments = [...new Set(list.all.map((r) => r.department).filter((d): d is string => !!d))].sort()
  const shown = (rows: PurchaseView[]) => (department ? rows.filter((r) => (department === '-' ? !r.department : r.department === department)) : rows)
  const open = shown(list.open)
  const ordered = shown(list.ordered)
  const settled = shown(list.settled)
  return (
    <div className="app warehouse purchases">
      <Top view={view} title="Stock" />
      <StockViews view={view} current="buy" />
      <h1 className="area-title">Purchase list</h1>
      {access.can('ask') && (
        <section className="card" aria-label="Ask for something">
          <Fold label="Ask for something to be bought" className="primary">
            <AskForm />
          </Fold>
          <p className="hint">Everyone signed in sees the list and can vote for what they'd find most useful. Nothing is ordered until the office says so.</p>
        </section>
      )}
      {departments.length > 1 && (
        <label className="field purchase-filter">
          Department
          <select value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">Every department</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            <option value="-">No department</option>
          </select>
        </label>
      )}
      <section className="card" aria-labelledby="buy-open">
        <Heading icon="kit" id="buy-open">
          Asked for ({open.length})
        </Heading>
        {list.all.length === 0 ? (
          <Empty>Nothing asked for yet. Ask for something above{access.can('settings') ? ', or bring in a list from a spreadsheet' : ''}.</Empty>
        ) : open.length === 0 ? (
          <p className="empty">Nothing waiting{department ? ' in this department' : ''}.</p>
        ) : (
          <p className="hint">Most votes first.</p>
        )}
        <ShowAll items={open} limit={30} what="requests">
          {(rows) => (
            <ul className="purchase-list">
              {rows.map((r) => (
                <PurchaseRow key={r.id} r={r} today={today} />
              ))}
            </ul>
          )}
        </ShowAll>
      </section>
      {ordered.length > 0 && (
        <section className="card" aria-labelledby="buy-ordered">
          <Heading icon="van" id="buy-ordered">
            Ordered ({ordered.length})
          </Heading>
          <ul className="purchase-list">
            {ordered.map((r) => (
              <PurchaseRow key={r.id} r={r} today={today} />
            ))}
          </ul>
        </section>
      )}
      {settled.length > 0 && (
        <section className="card">
          <details className="retired">
            <summary>Arrived or not buying ({settled.length})</summary>
            <ul className="purchase-list">
              {settled.map((r) => (
                <PurchaseRow key={r.id} r={r} today={today} />
              ))}
            </ul>
          </details>
        </section>
      )}
      {access.can('settings') && (
        <p className="hint">
          <a href="#stock/buy/bring-in">Bring in a list</a> from a spreadsheet, such as the requests from a WhatsApp group.
        </p>
      )}
    </div>
  )
}

/** One request: the vote, then what it is, who asked and when, and where it's at. */
function PurchaseRow({ r, today }: { r: PurchaseView; today: string }) {
  return (
    <li className="purchase-row">
      <Vote r={r} />
      <a className="job-row" href={purchaseHref(r.id)}>
        <div>
          <b>{r.title}</b> <Pending pending={r.pending} />
          <p>
            {[r.details.split('\n')[0], r.department].filter(Boolean).join(' · ')}
          </p>
          <p className="meta">
            {r.askerName}, {onDay(r.askedOn, today)}
          </p>
        </div>
        <div className="side">
          {r.status !== 'asked' && <StatusPill tone={TONES[r.status]}>{PURCHASE_STATUS_LABELS[r.status]}</StatusPill>}
          <span aria-hidden="true">›</span>
        </div>
      </a>
    </li>
  )
}

/**
 * The vote: one each, pressed again to take it back. It keeps one name
 * ("Vote") and says whether it's on with aria-pressed, as the shared
 * button's toggle does; the count beside it is everyone's. Someone the app
 * can't tell (not on the Crew tab, or sign-in off) sees the count only.
 */
function Vote({ r }: { r: PurchaseView }) {
  const access = useAccess()
  const { run, error } = useAct()
  const me = access.personId
  const mine = !!me && r.voterIds.has(me)
  const count = r.voterIds.size
  const says = `${plural(count, 'vote')}${mine ? ', yours among them' : ''}`
  if (!me || !access.can('ask'))
    return (
      <span className="vote-count" title={says}>
        <b>{count}</b>
        <span className="sr-only"> {count === 1 ? 'vote' : 'votes'}</span>
      </span>
    )
  return (
    <span className="vote">
      <button
        type="button"
        className="vote-button"
        aria-pressed={mine}
        aria-label={`Vote for ${r.title}`}
        aria-describedby={`votes-${r.id}`}
        onClick={() => void run(() => client.mutate('purchase.vote', { requestId: r.id, vote: !mine, by: me }))}
      >
        <b>{count}</b>
        <span aria-hidden="true">{mine ? 'Voted' : 'Vote'}</span>
      </button>
      <span id={`votes-${r.id}`} className="sr-only">
        {says}
      </span>
      <Refusal error={error} />
    </span>
  )
}

/** What to buy, how many, a link and the department: the same form for asking and for changing it. */
function AskForm({ r, onDone }: { r?: PurchaseView; onDone?: () => void }) {
  const access = useAccess()
  const [f, setF] = useState({ title: r?.title ?? '', details: r?.details ?? '', link: r?.link ?? '', department: r?.department ?? '' })
  const [asked, setAsked] = useState('')
  const { run, error } = useAct()
  const save = (e: FormEvent) => {
    e.preventDefault()
    const fields = { title: f.title, details: f.details, link: f.link, department: f.department || null }
    if (r) {
      void run(() => client.mutate('purchase.update', { id: r.id, ...fields })).then((ok) => ok && onDone?.())
      return
    }
    const id = newId()
    void run(() => client.mutate('purchase.ask', { id, ...fields, by: access.personId ?? null })).then((ok) => {
      if (!ok) return
      setAsked(f.title.trim())
      setF({ title: '', details: '', link: '', department: f.department })
    })
  }
  return (
    <form className="grid-form purchase-form" onSubmit={save} aria-label={r ? `Change ${r.title}` : 'Ask for something to be bought'}>
      <label className="wide">
        What to buy <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. NL4T connectors" required maxLength={200} />
      </label>
      <label className="wide">
        How many, and anything else
        <textarea rows={3} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="e.g. 20, for the new amp racks" />
      </label>
      <label>
        Link to it <input type="url" inputMode="url" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="The shop's page" />
      </label>
      <label>
        Department
        <select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>
          <option value="">None in particular</option>
          {[...CREW_DEPARTMENTS, ...(f.department && !(CREW_DEPARTMENTS as readonly string[]).includes(f.department) ? [f.department] : [])].map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <Refusal error={error} className="wide" />
      {asked && !error && (
        <p className="hint wide" role="status">
          “{asked}” is on the list.
        </p>
      )}
      <div className="actions wide">
        <button type="submit" className="primary">
          {r ? 'Save the request' : 'Ask for it'}
        </button>
        {r && (
          <button type="button" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

export function PurchaseScreen({ view, id }: { view: View; id: string }) {
  const r = view.purchases.get(id)
  const up = { steps: [STOCK, BUY], here: r?.title }
  if (!r)
    return (
      <Page view={view} title="Stock" className="warehouse purchases" up={up}>
        <section className="card">
          <p className="empty">This request isn't on this device. It may have been taken off the list, or still be on its way: check again once it says “Up to date”.</p>
        </section>
      </Page>
    )
  return (
    <Page view={view} title="Stock" className="warehouse purchases" up={up}>
      <About r={r} />
      <WhereItsAt r={r} />
    </Page>
  )
}

function About({ r }: { r: PurchaseView }) {
  const access = useAccess()
  const today = useToday()
  const [doing, setDoing] = useState<'edit' | 'remove'>()
  const { run, error } = useAct()
  // Whoever asked changes their own; those who change stock, anyone's (the server says the same).
  const mayChange = access.can('ask') && (access.can('stock') || (!!access.personId && access.personId === r.askedBy))
  const remove = () => {
    setDoing(undefined)
    void run(() => client.mutate('purchase.remove', { id: r.id })).then((ok) => ok && (location.hash = '#stock/buy'))
  }
  return (
    <section className="card">
      <header className="title">
        <h1>{r.title}</h1>
        <Pending pending={r.pending} />
        <StatusPill tone={TONES[r.status]}>{PURCHASE_STATUS_LABELS[r.status]}</StatusPill>
      </header>
      {doing === 'edit' ? (
        <AskForm r={r} onDone={() => setDoing(undefined)} />
      ) : (
        <>
          <dl className="facts">
            <div>
              <dt>Asked for by</dt>
              <dd>
                {r.askerName}, {onDay(r.askedOn, today)}
              </dd>
            </div>
            <div>
              <dt>Department</dt>
              <dd>{r.department ?? 'None in particular'}</dd>
            </div>
            <div className="wide">
              <dt>How many, and anything else</dt>
              <dd className="said">{r.details || 'Nothing said.'}</dd>
            </div>
            <div className="wide">
              <dt>Link</dt>
              <dd>
                {r.link ? (
                  <a href={r.link} target="_blank" rel="noopener noreferrer" className="purchase-link">
                    {r.link.replace(/^https?:\/\/(www\.)?/, '')}
                  </a>
                ) : (
                  'None given'
                )}
              </dd>
            </div>
          </dl>
          <div className="purchase-votes">
            <Vote r={r} />
            <p>{r.voters.length ? `Voted for by ${r.voters.map((p) => p.name).join(', ')}.` : 'Nobody has voted for it yet.'}</p>
          </div>
          {mayChange && (
            <div className="actions">
              <button type="button" onClick={() => setDoing('edit')}>
                Change the request
              </button>
              {doing === 'remove' ? (
                <Confirm question={`Take “${r.title}” off the purchase list?`} yes="Take it off" onYes={remove} onNo={() => setDoing(undefined)}>
                  {r.voters.length ? <p>Its {plural(r.voters.length, 'vote')} go with it.</p> : null}
                </Confirm>
              ) : (
                <button type="button" onClick={() => setDoing('remove')}>
                  Take it off the list
                </button>
              )}
            </div>
          )}
        </>
      )}
      <Refusal error={error} />
    </section>
  )
}

/** Where it's at, and the office's notes on it: said by whoever changes stock, read by everyone. */
function WhereItsAt({ r }: { r: PurchaseView }) {
  const access = useAccess()
  const [status, setStatus] = useState<PurchaseStatus>(r.status)
  const [notes, setNotes] = useState(r.notes)
  const { run, error } = useAct()
  const [saved, setSaved] = useState(false)
  // Changed elsewhere, or once synced: the form follows, unless something has been typed here.
  useEffect(() => {
    setStatus(r.status)
    setNotes(r.notes)
  }, [r.status, r.notes])
  if (!access.can('stock'))
    return r.notes ? (
      <section className="card" aria-label="Where it's at">
        <Heading icon="info">Where it's at</Heading>
        <p className="said">{r.notes}</p>
      </section>
    ) : null
  const changed = status !== r.status || notes.trim() !== r.notes
  const save = (e: FormEvent) => {
    e.preventDefault()
    setSaved(false)
    void run(() => client.mutate('purchase.status', { id: r.id, status, notes })).then((ok) => ok && setSaved(true))
  }
  return (
    <section className="card" aria-labelledby="buy-at">
      <Heading icon="info" id="buy-at">
        Where it's at
      </Heading>
      <form className="grid-form" onSubmit={save}>
        <fieldset className="wide purchase-status">
          <legend>Status</legend>
          {PURCHASE_STATUSES.map((s) => (
            <label className="tick" key={s}>
              <input type="radio" name="status" value={s} checked={status === s} onChange={() => setStatus(s)} />
              <span>
                <b>{PURCHASE_STATUS_LABELS[s]}</b> <span className="hint">{PURCHASE_STATUS_LINES[s]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="wide">
          Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Ordered from Thomann, due Friday" />
        </label>
        <Refusal error={error} className="wide" />
        {saved && !changed && !error && (
          <p className="hint wide" role="status">
            Saved. {r.askedBy ? `${r.askerName} sees it in their notifications.` : ''}
          </p>
        )}
        <div className="actions wide">
          <button type="submit" className="primary" disabled={!changed}>
            Save where it's at
          </button>
        </div>
      </form>
    </section>
  )
}

// Bringing a list in --------------------------------------------------------

/** The file's text, read on the device. */
const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error("Couldn't read that file."))
    reader.readAsText(file)
  })

/** Who a name in the file is: a person on the Crew tab, or the name kept as written. */
type Who = Record<string, string>
const KEEP = ''

/**
 * Bringing in a purchase list (ADR 0077), from Stock's purchase list:
 * a spreadsheet saved as .csv with a What column, and any of Asked on,
 * Asked by, How many and details, Link, Department, Where it's at and
 * Notes. Each name under Asked by is matched to the one person on the Crew
 * tab it can be, and the office can choose another, or keep it as written.
 * A row already brought in is left as it is, so the same list twice adds
 * nothing. Rows that can't be read say why and stay out until the file is
 * fixed. Read on the device, and sent as one change.
 */
export function BringInPurchasesScreen({ view }: { view: View }) {
  const access = useAccess()
  const [rows, setRows] = useState<PurchaseListRow[]>()
  const [problem, setProblem] = useState('')
  const [who, setWho] = useState<Who>({})
  const [done, setDone] = useState<number>()
  const { run, error } = useAct()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [rows === undefined, done === undefined])
  const people = view.crew.people.filter((p) => !p.archived)

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setProblem('')
    if (file.size > 5_000_000) return setProblem('The file is bigger than 5 MB.')
    try {
      const read = readPurchaseList(await readFile(file))
      if (read.problem) return setProblem(read.problem)
      const names = [...new Set(read.rows.map((r) => r.askedBy.trim()).filter(Boolean))]
      setWho(Object.fromEntries(names.map((n) => [n, matchAsker(n, people)?.id ?? KEEP])))
      setRows(read.rows)
    } catch (err) {
      setProblem((err as Error).message)
    }
  }

  const up = { steps: [STOCK, BUY], here: 'Bring in a list' }
  if (!access.can('settings'))
    return (
      <Page view={view} title="Stock" className="warehouse purchases" up={up}>
        <section className="card">
          <p className="empty">Only the office and directors can bring a list in.</p>
        </section>
      </Page>
    )

  const today = irishToday()
  const already = new Set(view.purchases.all.map((r) => r.id))
  const usable = (rows ?? []).filter((r) => !r.problems.length)
  const fresh = usable.filter((r) => !already.has(r.id))
  const names = Object.keys(who)

  const bring = () => {
    const requests: BroughtInPurchase[] = fresh.map((r) => ({
      id: r.id,
      title: r.title,
      details: r.details,
      link: r.link,
      department: r.department || null,
      askedBy: who[r.askedBy.trim()] || null,
      askedByName: r.askedBy.trim(),
      askedOn: r.askedOn || today,
      status: r.status,
      notes: r.notes,
    }))
    void run(() => client.mutate('purchase.bringIn', { requests })).then((ok) => ok && setDone(requests.length))
  }

  return (
    <Page view={view} title="Stock" className="warehouse purchases" up={up}>
      {/* Where it's up to (rule 13): choosing the file, then checking every row before anything is saved. */}
      {done === undefined && <p className="kicker">{rows ? 'Step 2 of 2: check the rows and who asked' : 'Step 1 of 2: choose the file'}</p>}
      <h1 className="area-title" ref={heading} tabIndex={-1}>
        {done !== undefined ? 'Brought in' : 'Bring in a purchase list'}
      </h1>
      {done !== undefined ? (
        <section className="card">
          <p>
            {plural(done, 'request')} brought in. They're on the <a href="#stock/buy">purchase list</a>, ready for votes.
          </p>
        </section>
      ) : !rows ? (
        <section className="card" aria-label="Choose a file">
          <p>
            Save the list as a .csv file and choose it here. The first line names the columns: What, and any of Asked on, Asked by, How many and details, Link,
            Department, Where it's at and Notes, in any order. Nothing is saved until you've seen every row.
          </p>
          <label className="field">
            Purchase list file
            <input type="file" accept=".csv,text/csv" onChange={choose} />
          </label>
          {problem && (
            <p className="alert" role="alert">
              {problem}
            </p>
          )}
        </section>
      ) : (
        <>
          {names.length > 0 && (
            <section className="card" aria-labelledby="buy-who">
              <Heading icon="people" id="buy-who">
                Who asked ({names.length})
              </Heading>
              <p className="hint">Each name matched to the one person on the Crew tab it can be. Choose who it is, or keep the name as written.</p>
              <div className="grid-form">
                {names.map((n) => (
                  <label key={n}>
                    {n}
                    <select value={who[n]} onChange={(e) => setWho({ ...who, [n]: e.target.value })}>
                      <option value={KEEP}>Keep “{n}” as written</option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </section>
          )}
          <section className="card" aria-labelledby="buy-rows">
            <Heading icon="kit" id="buy-rows">
              The rows ({rows.length})
            </Heading>
            <p>
              {[
                plural(fresh.length, 'to bring in', 'to bring in'),
                usable.length > fresh.length && `${usable.length - fresh.length} already on the list, left as they are`,
                rows.length > usable.length && `${rows.length - usable.length} that can't be read, left out until the file is fixed`,
              ]
                .filter(Boolean)
                .join(', ')}
              .
            </p>
            <ul className="purchase-list bring-in">
              {rows.map((r) => (
                <li key={r.row} className={r.problems.length ? 'bad' : already.has(r.id) ? 'quiet' : ''}>
                  <div>
                    <b>
                      Row {r.row}: {r.title || 'nothing under What'}
                    </b>
                    {r.problems.length === 0 && already.has(r.id) && <StatusPill tone="cancelled">Already on the list</StatusPill>}
                    {r.problems.length === 0 && !already.has(r.id) && r.status !== 'asked' && (
                      <StatusPill tone={TONES[r.status]}>{PURCHASE_STATUS_LABELS[r.status]}</StatusPill>
                    )}
                    <p>{[r.details.split('\n')[0], r.department].filter(Boolean).join(' · ')}</p>
                    <p className="meta">
                      {r.askedBy ? (who[r.askedBy.trim()] ? (people.find((p) => p.id === who[r.askedBy.trim()])?.name ?? r.askedBy) : r.askedBy) : 'Nobody named'},{' '}
                      {r.askedOn ? onDay(r.askedOn, today) : 'today'}
                    </p>
                    {r.problems.map((p) => (
                      <p className="alert" key={p}>
                        {p}
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <Refusal error={error} />
            <div className="actions">
              <button type="button" className="primary" disabled={!fresh.length} onClick={bring}>
                Bring in {plural(fresh.length, 'request')}
              </button>
              <button type="button" onClick={() => setRows(undefined)}>
                Choose another file
              </button>
            </div>
          </section>
        </>
      )}
    </Page>
  )
}
