import {
  CATEGORY_IDEAS,
  dayLabel,
  DEPARTMENT_LABELS,
  DEPARTMENTS,
  newId,
  normaliseNumber,
  plural,
  type Department,
  type ModelView,
  type Tracking,
  type View,
} from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { App } from '../App.tsx'
import { act, euroToCents } from '../crew/CrewScreen.tsx'
import { NotDone, StatusPill, Top, useHash, useView } from '../jobs/common.tsx'
import { productName } from '../jobs/Kit.tsx'
import { client } from '../sync.ts'
import { amountLabel, numberLabel, Pending, STOCK_COMMANDS, TrackingChoice, whereLabel } from './common.tsx'
import { ItemScreen } from './ItemScreen.tsx'
import { PlaceScreen } from './PlaceScreen.tsx'
import { ProductScreen } from './ProductScreen.tsx'
import './stock.css'

/**
 * Stock (ADR 0013): the catalogue of products, the numbered items of each,
 * where everything is kept, and what's counted; and the kit on jobs that's
 * short (ADR 0014). A product, item or place opens on its own page
 * (#stock/product/<id>, #stock/item/<id>, #stock/place/<id>). The Phase 0
 * sync test lives at #stock/sync-test until the phone field test is done.
 * Everything works with no signal and syncs later, like the rest of the app.
 */
export function StockScreen() {
  const view = useView()
  const hash = useHash()
  if (hash === '#stock/sync-test') return <App />
  const [, kind, id] = /^#stock\/(product|item|place)\/(.+)$/.exec(hash) ?? []
  const open = id ? decodeURIComponent(id) : ''
  // Keyed by the record, so a form left open on one page isn't still open on the next.
  if (kind === 'product') return <ProductScreen key={open} view={view} id={open} />
  if (kind === 'item') return <ItemScreen key={open} view={view} id={open} />
  if (kind === 'place') return <PlaceScreen key={open} view={view} id={open} />
  return <Catalogue view={view} />
}

function Catalogue({ view }: { view: View }) {
  const w = view.warehouse
  const [department, setDepartment] = useState<Department | 'all'>('all')
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const words = q.split(/\s+/).filter(Boolean)
  const number = normaliseNumber(search)
  const exact = number ? w.byNumber.get(number) : undefined
  // Items by number or serial, once there's enough typed to mean something.
  const items =
    q.length >= 3
      ? [...w.assets.values()]
          .filter((a) => a !== exact && [a.number, a.serial, ...a.formerNumbers].some((t) => t.toLowerCase().includes(q)))
          .sort((a, b) => a.number.localeCompare(b.number))
          .slice(0, 20)
      : []
  const inDepartment = (m: ModelView) => department === 'all' || m.department === department
  const matches = (m: ModelView) => {
    const text = `${m.name} ${m.category} ${DEPARTMENT_LABELS[m.department]}`.toLowerCase()
    return words.every((x) => text.includes(x))
  }
  const shown = w.models.filter((m) => inDepartment(m) && matches(m))
  const count = (d: Department) => w.models.filter((m) => m.department === d).length

  // A scanner types a label's number and Enter: straight to the item.
  const go = (e: FormEvent) => {
    e.preventDefault()
    if (exact) location.hash = `#stock/item/${exact.id}`
    else if (items.length === 1) location.hash = `#stock/item/${items[0]!.id}`
    else if (shown.length === 1) location.hash = `#stock/product/${shown[0]!.id}`
  }

  return (
    <div className="app crew jobs warehouse">
      <Top view={view} title="Stock" />
      <NotDone view={view} names={STOCK_COMMANDS} />

      <section className="card">
        <h2>Stock</h2>
        <form role="search" onSubmit={go}>
          <input
            className="search"
            type="search"
            enterKeyHint="go"
            placeholder="Find a product, number or serial"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Find"
          />
        </form>
        <div className="filters" role="group" aria-label="Department">
          <button type="button" aria-pressed={department === 'all'} onClick={() => setDepartment('all')}>
            All ({w.models.length})
          </button>
          {DEPARTMENTS.filter((d) => count(d) > 0).map((d) => (
            <button key={d} type="button" aria-pressed={department === d} onClick={() => setDepartment(d)}>
              {DEPARTMENT_LABELS[d]} ({count(d)})
            </button>
          ))}
        </div>
        {(exact || items.length > 0) && (
          <ul className="item-list" aria-label="Items found">
            {[...(exact ? [exact] : []), ...items].map((a) => (
              <li key={a.id}>
                <a className="item-row" href={`#stock/item/${a.id}`}>
                  <div>
                    <b>{numberLabel(a)}</b> {a.model?.name}
                    <p>
                      {a.status === 'retired' ? 'Retired' : whereLabel(a, w)}
                      {a.serial && ` · Serial ${a.serial}`}
                      {a.number !== number && number && a.formerNumbers.includes(number) && ` · Had ${number} before`}
                    </p>
                  </div>
                  <Pending pending={a.pending} />
                </a>
              </li>
            ))}
          </ul>
        )}
        {shown.length === 0 && !exact && items.length === 0 && (
          <p className="empty">{w.models.length === 0 ? 'No products yet. Add the first one below.' : 'Nothing here.'}</p>
        )}
        <ul className="job-list">
          {shown.map((m) => (
            <li key={m.id}>
              <a className="job-row" href={`#stock/product/${m.id}`}>
                <div>
                  <b>{m.name}</b>
                  <p>{[m.category, DEPARTMENT_LABELS[m.department]].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="side">
                  <Pending pending={m.pending} />
                  <small>{amountLabel(m)}</small>
                </div>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <ShortKit view={view} />

      <section className="card">
        <h2>New product</h2>
        <NewProduct view={view} department={department === 'all' ? 'audio' : department} />
      </section>

      <Places view={view} />

      <section className="card">
        <h2>Sync test</h2>
        <p className="hint">The Phase 0 phone field test: book speakers with no signal and watch the server sort it out.</p>
        <a className="button" href="#stock/sync-test">
          Open the sync test
        </a>
      </section>
    </div>
  )
}

/** Every line of kit short on a day from today on, soonest first; the first few, then the rest on request. */
function ShortKit({ view }: { view: View }) {
  const short = view.kit.short
  if (short.length === 0) return null
  const row = (l: (typeof short)[number]) => (
    <li key={l.id}>
      <a className="job-row" href={`#jobs/${l.projectId}`}>
        <div>
          <b>
            {productName(l)}: short {l.short}
          </b>
          <p>
            {l.job?.name ?? 'A job'} · {dayLabel(l.shortDay!)}
            {l.shortDays > 1 && ` and ${plural(l.shortDays - 1, 'more day')}`}
          </p>
        </div>
        <div className="side">{l.job && <StatusPill status={l.job.status} pending={l.pending} />}</div>
      </a>
    </li>
  )
  return (
    <section className="card kit-short" aria-label="Kit short">
      <h2>Kit short</h2>
      <p className="hint">
        On jobs from today on, once the confirmed jobs on the same days have theirs. Quotes and enquiries show what they'd need if they go ahead.
      </p>
      <ul className="job-list">{short.slice(0, 5).map(row)}</ul>
      {short.length > 5 && (
        <details>
          <summary>{short.length - 5} more</summary>
          <ul className="job-list">{short.slice(5).map(row)}</ul>
        </details>
      )}
    </section>
  )
}

function NewProduct({ view, department }: { view: View; department: Department }) {
  const w = view.warehouse
  const blank = { name: '', department, category: '', tracking: 'serialised' as Tracking, isCase: false, value: '' }
  const [f, setF] = useState(blank)
  const [error, setError] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const name = f.name.trim()
    if (!name) return
    const taken = w.models.find((m) => m.name.trim().toLowerCase() === name.toLowerCase())
    if (taken) return setError(`There's already a product called ${taken.name}.`)
    const valueCents = euroToCents(f.value)
    if (valueCents !== null && !(valueCents >= 0)) return setError('The value is a number of euro, such as 350 or 12.50.')
    const id = newId()
    const args = {
      id,
      name,
      department: f.department,
      category: f.category.trim(),
      tracking: f.tracking,
      isCase: f.isCase && f.tracking === 'serialised',
      valueCents,
      notes: '',
    }
    void act(() => client.mutate('model.create', args)).then(
      () => {
        location.hash = `#stock/product/${id}`
      },
      (err: Error) => setError(err.message)
    )
    setF({ ...blank, department: f.department })
    setError('')
  }
  const categories = [...new Set([...w.categories, ...CATEGORY_IDEAS])]
  return (
    <form className="grid-form" onSubmit={submit}>
      <label className="wide">
        Name <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. d&b Y10P, XLR 10 m, Amp rack" required />
      </label>
      <label>
        Department
        <select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value as Department })}>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {DEPARTMENT_LABELS[d]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Category <input list="category-names" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="e.g. Speakers" />
      </label>
      <TrackingChoice tracking={f.tracking} isCase={f.isCase} onChange={(t) => setF({ ...f, ...t })} />
      <label className="wide">
        Value of one, in euro{' '}
        <input
          inputMode="decimal"
          value={f.value}
          onChange={(e) => setF({ ...f, value: e.target.value })}
          placeholder="What it would cost to replace; optional"
        />
      </label>
      {error && <p className="alert wide">{error}</p>}
      <button type="submit" className="primary wide">
        Add product
      </button>
      <datalist id="category-names">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </form>
  )
}

function Places({ view }: { view: View }) {
  const w = view.warehouse
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const add = (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    const taken = w.places.find((p) => p.name.trim().toLowerCase() === n.toLowerCase())
    if (taken) return setError(`There's already a place called ${taken.name}.`)
    void act(() => client.mutate('place.upsert', { id: newId(), name: n, notes: '' })).catch((err: Error) => setError(err.message))
    setName('')
    setError('')
  }
  return (
    <section className="card">
      <h2>Places</h2>
      {w.places.length === 0 && (
        <p className="empty">Where kit is kept: the warehouse, its bays and shelves, the vans. Places are also added as you type them in.</p>
      )}
      <ul className="job-list">
        {w.places.map((p) => (
          <li key={p.id}>
            <a className="job-row" href={`#stock/place/${p.id}`}>
              <div>
                <b>{p.name}</b>
                <p>
                  {[p.itemTotal > 0 && plural(p.itemTotal, 'item'), p.countedTotal > 0 && `${p.countedTotal.toLocaleString('en-IE')} counted`]
                    .filter(Boolean)
                    .join(' · ') || 'Nothing here yet'}
                </p>
              </div>
              <div className="side">
                <Pending pending={p.pending} />
              </div>
            </a>
          </li>
        ))}
      </ul>
      <form className="inline-add" onSubmit={add}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bay A3, Van 1" aria-label="New place" />
        <button type="submit">Add place</button>
      </form>
      {error && <p className="alert">{error}</p>}
    </section>
  )
}
