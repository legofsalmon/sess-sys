import {
  CATEGORY_IDEAS,
  dayLabel,
  DEPARTMENT_LABELS,
  DEPARTMENTS,
  itemByCode,
  newId,
  normaliseNumber,
  parseEuro,
  plural,
  RETIRED_LABELS,
  spanLabel,
  type Department,
  type ModelView,
  type PickList,
  type Tracking,
  type View,
} from '@sh/shared'
import { useRef, useState, type FormEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Fold, ShowAll } from '../Fold.tsx'
import { Beside, JobStatusPill, Top, useHash } from '../jobs/common.tsx'
import { productName } from '../jobs/Kit.tsx'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { useView, useWide } from '../view.ts'
import { amountLabel, atLabel, mistakeLabel, numberLabel, ScanResult, TrackingChoice, whereLabel } from './common.tsx'
import { CountPage, CountsCard, CountScreen } from './Counts.tsx'
import { ItemScreen } from './ItemScreen.tsx'
import { RepairList } from './Faults.tsx'
import { InspectionsDue, TestingScreen } from './Inspections.tsx'
import { ClaimLabel, LabelsCard, LabelsScreen, RunScreen, type ClaimMemory } from './Labels.tsx'
import { PlaceScreen } from './PlaceScreen.tsx'
import { CameraScanner, primeSound } from './Scanner.tsx'
import { ProductScreen } from './ProductScreen.tsx'
import './stock.css'

/**
 * Stock (ADR 0013): the catalogue of products, the numbered items of each,
 * where everything is kept, and what's counted; the kit on jobs that's
 * short (ADR 0014); labels (ADR 0015); the camera, to scan them (ADR 0016);
 * the pick lists going out and still out (ADR 0017); and faults and
 * missing kit waiting to be sorted out (ADR 0018); and inspections due
 * (ADR 0020). A product, item or place opens on its own page
 * (#stock/product/<id>, #stock/item/<id>, #stock/place/<id>), labels on
 * theirs (#stock/labels, #stock/labels/<id>), and testing a batch on
 * #stock/testing. Counting a place or a case is #stock/count, and a count's
 * page #stock/count/<id> (ADR 0030).
 * Everything works with no signal and syncs later, like the rest of the app.
 */
export function StockScreen() {
  const view = useView()
  const hash = useHash()
  const wide = useWide()
  if (hash === '#stock/labels') return <LabelsScreen view={view} />
  if (hash === '#stock/testing') return <TestingScreen view={view} />
  if (hash === '#stock/count') return <CountScreen view={view} />
  const [, count] = /^#stock\/count\/(.+)$/.exec(hash) ?? []
  if (count) return <CountPage key={count} view={view} id={decodeURIComponent(count)} />
  const [, run] = /^#stock\/labels\/(.+)$/.exec(hash) ?? []
  if (run) return <RunScreen key={run} view={view} id={decodeURIComponent(run)} />
  const [, kind, id] = /^#stock\/(product|item|place)\/(.+)$/.exec(hash) ?? []
  const open = id ? decodeURIComponent(id) : ''
  // Keyed by the record, so a form left open on one page isn't still open on the next.
  const record =
    kind === 'product' ? (
      <ProductScreen key={open} view={view} id={open} bare={wide} />
    ) : kind === 'item' ? (
      <ItemScreen key={open} view={view} id={open} bare={wide} />
    ) : kind === 'place' ? (
      <PlaceScreen key={open} view={view} id={open} bare={wide} />
    ) : undefined
  // On a laptop the catalogue keeps a column of its own (audit finding 25), with its search, beside the open record or the rest of the tab; on a phone the record is a page of its own.
  if (wide) {
    const product = kind === 'product' ? open : kind === 'item' ? view.warehouse.assets.get(open)?.modelId : undefined
    return (
      <Beside view={view} title="Stock" className="warehouse" list={<StockCard view={view} current={product} />} open={kind && `${kind}/${open}`}>
        {record ?? <StockRest view={view} />}
      </Beside>
    )
  }
  return record ?? <Catalogue view={view} />
}

function Catalogue({ view }: { view: View }) {
  return (
    <div className="app warehouse">
      <Top view={view} title="Stock" />

      <StockCard view={view} />

      <StockRest view={view} />
    </div>
  )
}

/** What the warehouse has to do, the labels and the places: under the catalogue on a phone, beside it on a laptop. */
function StockRest({ view }: { view: View }) {
  return (
    <>
      <PickLists view={view} />

      <RepairList view={view} />

      <InspectionsDue view={view} />

      <CountsCard view={view} />

      <ShortKit view={view} />

      <LabelsCard labels={view.labels} />

      <Places view={view} />
    </>
  )
}

/** The catalogue: the search, the camera, the department filters, the products and adding one; `current` marks the one open beside it. */
function StockCard({ view, current }: { view: View; current?: string }) {
  const w = view.warehouse
  const [department, setDepartment] = useState<Department | 'all'>('all')
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const words = q.split(/\s+/).filter(Boolean)
  const number = normaliseNumber(search)
  // An old tag from before Session Hire's labels first, as a scan reads it (ADR 0026).
  const exact = w.byOldNumber.get(q) ?? (number ? w.byNumber.get(number) : undefined)
  // A label that isn't on anything yet (ADR 0015): one from a run, or anything typed as a label rather than a bare number.
  const unclaimed = number && !exact && (view.labels.runOf(number) || /^\s*sh|\/a\//i.test(search)) ? number : undefined
  const searchField = useRef<HTMLInputElement>(null)
  const claimField = useRef<HTMLInputElement>(null)
  const memory = useRef<ClaimMemory>({ product: '', where: '' })
  const [claimed, setClaimed] = useState('')
  const [camera, setCamera] = useState(false)
  // The item the camera last read, shown under it while it stays on for the next (audit finding 18).
  const [scanned, setScanned] = useState('')
  const lastRead = camera && scanned ? w.assets.get(scanned) : undefined
  const justClaimed = claimed && !search.trim() ? w.assets.get(claimed) : undefined
  // Items by number or serial, once there's enough typed to mean something; one added by mistake only by its exact number.
  const items =
    q.length >= 3
      ? [...w.assets.values()]
          .filter((a) => a !== exact && a.retiredReason !== 'mistake' && [a.number, a.serial, a.oldNumber, ...a.formerNumbers].some((t) => t.toLowerCase().includes(q)))
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

  // A scanner types a label's number and Enter: straight to the item, or to saying what a new label is on.
  const go = (e: FormEvent) => {
    e.preventDefault()
    if (exact) location.hash = `#stock/item/${exact.id}`
    else if (unclaimed) claimField.current?.focus()
    else if (items.length === 1) location.hash = `#stock/item/${items[0]!.id}`
    else if (shown.length === 1) location.hash = `#stock/product/${shown[0]!.id}`
  }
  // Ready for the next label: the camera's still on, or the search is, for a scanner that types.
  const onClaimed = (id: string) => {
    setClaimed(id)
    setSearch('')
    if (!camera) searchField.current?.focus()
  }
  // Read by the camera: an item's label or its maker's serial shows it under the camera, which stays on; a label on nothing yet asks what it's on.
  const onRead = (code: string) => {
    const found = itemByCode(w, code)
    if (found) {
      setScanned(found.id)
      setSearch('')
    } else {
      setScanned('')
      setSearch(code)
    }
  }
  const closeCamera = () => {
    setCamera(false)
    setScanned('')
  }

  return (
    <section className="card" aria-label="Stock">
      <h2>Stock</h2>
      <form role="search" className="scan-row" onSubmit={go}>
        <input
          ref={searchField}
          className="search"
          type="search"
          enterKeyHint="go"
          placeholder="Find a product, number or serial"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Find"
        />
        <button
          type="button"
          aria-pressed={camera}
          onClick={() => {
            if (!camera) primeSound()
            setCamera(!camera)
          }}
        >
          Scan
        </button>
      </form>
      {camera && <CameraScanner onRead={onRead} onStop={closeCamera} small={!!unclaimed} />}
      {lastRead && (
        <ScanResult onClose={closeCamera}>
          {lastRead.retiredReason === 'mistake' ? (
            mistakeLabel(lastRead)
          ) : (
            <>
              <a href={`#stock/item/${lastRead.id}`}>{numberLabel(lastRead)}</a> {lastRead.model?.name ?? 'an item'} ·{' '}
              {lastRead.status === 'retired' ? `Retired${lastRead.retiredReason ? `: ${RETIRED_LABELS[lastRead.retiredReason].toLowerCase()}` : ''}` : whereLabel(lastRead, w)}
              {lastRead.serial && ` · Serial ${lastRead.serial}`}. Scan the next label.
            </>
          )}
        </ScanResult>
      )}
      {justClaimed && (
        <p className="added" role="status">
          Added <a href={`#stock/item/${justClaimed.id}`}>{justClaimed.number}</a> ({justClaimed.model?.name ?? 'an item'})
          {(justClaimed.placeId || justClaimed.caseId) && ` ${atLabel(justClaimed, w)}`}. Scan the next label.
        </p>
      )}
      {unclaimed && <ClaimLabel key={unclaimed} number={unclaimed} view={view} memory={memory} productField={claimField} onClaimed={onClaimed} />}
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
                    {a.retiredReason === 'mistake' ? 'Added by mistake' : a.status === 'retired' ? 'Retired' : whereLabel(a, w)}
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
      {shown.length === 0 && !exact && !unclaimed && items.length === 0 && (
        <Empty>
          {w.models.length === 0 && (
            <>
              Add the first product below, or <a href="#account/import-stock">bring in the stock list</a>.
            </>
          )}
        </Empty>
      )}
      <ShowAll items={shown} limit={5} what="products" keep={(m) => m.id === current}>
        {(rows) => (
          <ul className="job-list">
            {rows.map((m) => (
              <li key={m.id}>
                <a className="job-row" href={`#stock/product/${m.id}`} aria-current={m.id === current ? 'page' : undefined}>
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
        )}
      </ShowAll>
      {/* A new product starts in the department the list is narrowed to. */}
      <Fold label="Add product">
        <NewProduct view={view} department={department === 'all' ? 'audio' : department} />
      </Fold>
    </section>
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
        <div className="side">{l.job && <JobStatusPill status={l.job.status} pending={l.pending} />}</div>
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

/** Jobs over with kit still out, and jobs going out in the next two weeks or on now, each opening its pick list (ADR 0017). */
function PickLists({ view }: { view: View }) {
  const { soon, stillOut } = view.moves
  if (soon.length === 0 && stillOut.length === 0) return null
  const row = (p: PickList, said: string, tone: string) => (
    <li key={p.job.id}>
      <a className="job-row" href={`#jobs/${p.job.id}/pick`}>
        <div>
          <b>{p.job.name}</b>
          <p>{p.job.span ? spanLabel(p.job.span) : 'No dates yet'}</p>
        </div>
        <div className="side">
          <small className={`flag ${tone}`}>{said}</small>
        </div>
      </a>
    </li>
  )
  return (
    <section className="card pick-lists" aria-label="Pick lists">
      <h2>Pick lists</h2>
      {stillOut.length > 0 && (
        <>
          <h3>Still out after the job</h3>
          <ul className="job-list">{stillOut.map((p) => row(p, `${p.stillOut} still out`, 'bad'))}</ul>
        </>
      )}
      {soon.length > 0 && (
        <>
          <h3>Going out in the next two weeks</h3>
          <ul className="job-list">{soon.map((p) => row(p, `${p.out} of ${p.need} out`, p.out >= p.need ? 'ok' : ''))}</ul>
        </>
      )}
    </section>
  )
}

function NewProduct({ view, department }: { view: View; department: Department }) {
  const w = view.warehouse
  const blank = { name: '', department, category: '', tracking: 'serialised' as Tracking, isCase: false, value: '' }
  const [f, setF] = useState(blank)
  const { run, error, refuse } = useAct()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const name = f.name.trim()
    if (!name) return
    const taken = w.models.find((m) => m.name.trim().toLowerCase() === name.toLowerCase())
    if (taken) return refuse(`There's already a product called ${taken.name}.`)
    const value = parseEuro(f.value)
    if (value.reason !== undefined) return refuse(value.reason)
    const valueCents = value.cents
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
    // A refusal brings what was typed back, unless the next thing has been typed since.
    const cleared = { ...blank, department: f.department }
    setF(cleared)
    void run(() => client.mutate('model.create', args)).then((ok) => {
      if (ok) location.hash = `#stock/product/${id}`
      else setF((now) => (now === cleared ? f : now))
    })
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
      <Refusal error={error} className="wide" />
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
  // Said in a green line, with the way to it, as the list may be folded past it.
  const [added, setAdded] = useState<{ id: string; name: string }>()
  const { run, error, refuse } = useAct()
  const add = (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    const taken = w.places.find((p) => p.name.trim().toLowerCase() === n.toLowerCase())
    if (taken) return refuse(`There's already a place called ${taken.name}.`)
    const id = newId()
    setAdded(undefined)
    void run(() => client.mutate('place.upsert', { id, name: n, notes: '' })).then((ok) => ok && setAdded({ id, name: n }))
    setName('')
  }
  return (
    <section className="card">
      <h2>Places</h2>
      {w.places.length === 0 && <Empty>Where kit is kept: the warehouse, its bays and shelves, the vans. Places are also added as you type them in.</Empty>}
      <ShowAll items={w.places} limit={5} what="places">
        {(rows) => (
          <ul className="job-list">
            {rows.map((p) => (
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
        )}
      </ShowAll>
      <Fold label="Add place">
        <form className="inline-add" onSubmit={add}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bay A3, Van 1" aria-label="New place" />
          <button type="submit">Add place</button>
        </form>
        {added && (
          <p className="added" role="status">
            Added <a href={`#stock/place/${added.id}`}>{added.name}</a>.
          </p>
        )}
        <Refusal error={error} />
      </Fold>
    </section>
  )
}
