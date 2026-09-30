import {
  CATEGORY_IDEAS,
  DEPARTMENT_LABELS,
  DEPARTMENTS,
  irishToday,
  MAX_QTY,
  newId,
  normaliseNumber,
  plural,
  RETIRED_LABELS,
  stockId,
  valueLabel,
  type CommandInput,
  type Department,
  type KitLineView,
  type ModelView,
  type View,
  type WarehouseView,
} from '@sh/shared'
import { useRef, useState, type FormEvent } from 'react'
import { act, euroToCents } from '../crew/CrewScreen.tsx'
import { NotDone, StatusPill, Top } from '../jobs/common.tsx'
import { forLabel, kitState } from '../jobs/Kit.tsx'
import { client } from '../sync.ts'
import {
  amountLabel,
  atLabel,
  CountRow,
  findWhere,
  numberLabel,
  Pending,
  STOCK_COMMANDS,
  TrackingChoice,
  whereLabel,
  WhereChoices,
  whereNamed,
  whereProblem,
  whereText,
} from './common.tsx'

/**
 * One product: what it is, the jobs it's on (ADR 0014), its numbered items,
 * and where it's counted. Items are added one after another while
 * labelling: the number field is ready for the next label as soon as one is
 * added, and where stays put.
 */
export function ProductScreen({ view, id }: { view: View; id: string }) {
  const w = view.warehouse
  const m = w.models.find((x) => x.id === id)
  if (!m)
    return (
      <div className="app crew jobs warehouse">
        <Top view={view} title="Stock" />
        <a className="back" href="#stock">
          ‹ All stock
        </a>
        <section className="card">
          <p className="empty">This product isn't on this device. It may still be on its way, or it was removed: check again once it says “Up to date”.</p>
        </section>
      </div>
    )
  return (
    <div className="app crew jobs warehouse">
      <Top view={view} title="Stock" />
      <a className="back" href="#stock">
        ‹ All stock
      </a>
      <NotDone view={view} names={STOCK_COMMANDS} />
      <Summary m={m} w={w} onKit={view.kit.lines.some((l) => l.modelId === m.id)} />
      <OnJobs m={m} lines={view.kit.byModel.get(m.id) ?? []} />
      {m.tracking === 'serialised' && <Items m={m} w={w} />}
      <Counted m={m} w={w} />
      <WhereChoices w={w} />
    </div>
  )
}

function Summary({ m, w, onKit }: { m: ModelView; w: WarehouseView; onKit: boolean }) {
  const [editing, setEditing] = useState(false)
  const removable = m.items.length === 0 && m.retired.length === 0 && m.countedTotal === 0 && !onKit
  const remove = () => {
    if (!confirm(`Remove ${m.name} from the stock list?`)) return
    void act(() => client.mutate('model.remove', { id: m.id })).then(
      () => {
        location.hash = '#stock'
      },
      (err: Error) => alert(err.message)
    )
  }
  return (
    <section className="card">
      <header className="title">
        <h1>{m.name}</h1>
        <Pending pending={m.pending} />
      </header>
      <dl className="facts">
        <div>
          <dt>Department</dt>
          <dd>{DEPARTMENT_LABELS[m.department]}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{m.category || 'None'}</dd>
        </div>
        <div>
          <dt>Kept track of</dt>
          <dd>{m.tracking === 'bulk' ? 'Counted' : m.isCase ? 'Numbered; holds other kit' : 'Numbered'}</dd>
        </div>
        <div>
          <dt>Value of one</dt>
          <dd>{m.valueCents === null ? 'Not given' : valueLabel(m.valueCents)}</dd>
        </div>
        <div className="wide">
          <dt>In all</dt>
          <dd>
            {m.total.toLocaleString('en-IE')}
            {m.tracking === 'serialised' &&
              m.countedTotal > 0 &&
              `: ${m.items.length.toLocaleString('en-IE')} labelled, ${m.countedTotal.toLocaleString('en-IE')} not yet`}
          </dd>
        </div>
      </dl>
      {m.notes && <p className="notes">{m.notes}</p>}
      {editing ? (
        <EditProduct m={m} w={w} onDone={() => setEditing(false)} />
      ) : (
        <div className="actions">
          <button type="button" onClick={() => setEditing(true)}>
            Change details
          </button>
          {removable && (
            <button type="button" className="link" onClick={remove}>
              Remove product
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/** The jobs it's on from today on, soonest first, each with whether there's enough; the first few, then the rest on request. */
function OnJobs({ m, lines }: { m: ModelView; lines: readonly KitLineView[] }) {
  const today = irishToday()
  const row = (l: KitLineView) => {
    const state = kitState(l, today)
    return (
      <li key={l.id}>
        <a className="job-row" href={`#jobs/${l.projectId}`}>
          <div>
            <b>{l.job?.name ?? 'A job'}</b>
            <p>{forLabel(l)}</p>
            {state && <p className={`kit-note ${state.tone}`}>{state.text}</p>}
          </div>
          <div className="side">
            {l.job && <StatusPill status={l.job.status} pending={l.pending} />}
            <small>{l.qty.toLocaleString('en-IE')} needed</small>
          </div>
        </a>
      </li>
    )
  }
  return (
    <section className="card" aria-label="On jobs">
      <h2>On jobs</h2>
      <p className="hint">{m.total.toLocaleString('en-IE')} owned. Confirmed jobs hold them; enquiries and quotes are pencilled in.</p>
      {lines.length === 0 && <p className="empty">Not on any job coming up.</p>}
      <ul className="job-list">{lines.slice(0, 5).map(row)}</ul>
      {lines.length > 5 && (
        <details>
          <summary>{lines.length - 5} more</summary>
          <ul className="job-list">{lines.slice(5).map(row)}</ul>
        </details>
      )}
    </section>
  )
}

function EditProduct({ m, w, onDone }: { m: ModelView; w: WarehouseView; onDone: () => void }) {
  const [f, setF] = useState({
    name: m.name,
    department: m.department,
    category: m.category,
    tracking: m.tracking,
    isCase: m.isCase,
    value: m.valueCents === null ? '' : String(m.valueCents / 100),
    notes: m.notes,
  })
  const [error, setError] = useState('')
  const save = (e: FormEvent) => {
    e.preventDefault()
    const name = f.name.trim()
    if (!name) return
    const taken = w.models.find((x) => x.id !== m.id && x.name.trim().toLowerCase() === name.toLowerCase())
    if (taken) return setError(`There's already a product called ${taken.name}.`)
    const valueCents = euroToCents(f.value)
    if (valueCents !== null && !(valueCents >= 0)) return setError('The value is a number of euro, such as 350 or 12.50.')
    // What the server would turn down, said now.
    if (f.tracking === 'bulk' && m.tracking === 'serialised' && m.items.length > 0)
      return setError(`${m.name} has ${plural(m.items.length, 'numbered item')}, so it can't be counted only. Retire them first.`)
    const holding = m.items.filter((a) => a.items.length > 0 || a.counted.length > 0).length
    if (!f.isCase && m.isCase && holding > 0)
      return setError(`${plural(holding, 'case')} of ${m.name} ${holding === 1 ? 'has' : 'have'} kit in ${holding === 1 ? 'it' : 'them'}. Empty them first.`)
    // Only what changed, so two people changing different things both keep theirs.
    const next = { name, department: f.department, category: f.category.trim(), tracking: f.tracking, isCase: f.isCase, valueCents, notes: f.notes.trim() }
    const changes: Partial<CommandInput<'model.update'>> = {}
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] !== m[k]) (changes as Record<string, unknown>)[k] = next[k]
    if (Object.keys(changes).length === 0) return onDone()
    void act(() => client.mutate('model.update', { id: m.id, ...changes })).then(onDone, (err: Error) => setError(err.message))
  }
  const categories = [...new Set([...w.categories, ...CATEGORY_IDEAS])]
  return (
    <form className="grid-form" onSubmit={save}>
      <label className="wide">
        Name <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
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
        Category <input list="edit-category-names" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
      </label>
      <TrackingChoice tracking={f.tracking} isCase={f.isCase} onChange={(t) => setF({ ...f, ...t })} />
      <label className="wide">
        Value of one, in euro <input inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
      </label>
      <label className="wide">
        Notes <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </label>
      {error && <p className="alert wide">{error}</p>}
      <div className="actions wide">
        <button type="submit" className="primary">
          Save product
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
      <datalist id="edit-category-names">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </form>
  )
}

function Items({ m, w }: { m: ModelView; w: WarehouseView }) {
  return (
    <section className="card" aria-label="Items">
      <h2>Items</h2>
      {m.items.length === 0 && <p className="empty">None labelled yet.</p>}
      <ul className="item-list">
        {m.items.map((a) => (
          <li key={a.id}>
            <a className="item-row" href={`#stock/item/${a.id}`}>
              <div>
                <b>{numberLabel(a)}</b>
                <p>
                  {whereLabel(a, w)}
                  {a.serial && ` · Serial ${a.serial}`}
                </p>
              </div>
              <Pending pending={a.pending} />
            </a>
          </li>
        ))}
      </ul>
      {m.retired.length > 0 && (
        <details>
          <summary>Retired ({m.retired.length})</summary>
          <ul className="item-list">
            {m.retired.map((a) => (
              <li key={a.id}>
                <a className="item-row" href={`#stock/item/${a.id}`}>
                  <div>
                    <b>{numberLabel(a)}</b>
                    <p>{a.retiredReason ? RETIRED_LABELS[a.retiredReason] : 'Retired'}</p>
                  </div>
                  <Pending pending={a.pending} />
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      <AddItem m={m} w={w} />
    </section>
  )
}

function AddItem({ m, w }: { m: ModelView; w: WarehouseView }) {
  const [f, setF] = useState({ number: '', serial: '', where: m.counted.length === 1 ? whereText(m.counted[0]!, w) : '' })
  const [fromCount, setFromCount] = useState(true)
  const [error, setError] = useState('')
  const [lastId, setLastId] = useState('')
  const numberField = useRef<HTMLInputElement>(null)
  const known = findWhere(f.where, w)
  const countedThere = known ? (m.counted.find((s) => s.id === stockId(m.id, known))?.qty ?? 0) : 0
  // The number it got, once the server has given it one.
  const last = lastId ? w.assets.get(lastId) : undefined

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const typed = f.number.trim()
    const number = (typed && normaliseNumber(typed)) || null
    if (typed && !number) return setError(`“${typed}” isn't a Session Hire number: they're SH- and six digits, such as SH-000123.`)
    const other = number ? w.byNumber.get(number) : undefined
    if (number && other) {
      return setError(
        other.number === number
          ? `${number} is already in use (${other.model?.name ?? 'another item'}).`
          : `${number} was used before (${other.model?.name ?? 'another item'}, now ${numberLabel(other)}), and a number is never used twice. Use another label.`
      )
    }
    const problem = whereProblem(f.where, w)
    if (problem) return setError(problem)
    const id = newId()
    const one = countedThere > 0 && fromCount
    void act(async () => {
      const where = (await whereNamed(f.where, w)) ?? { placeId: null, caseId: null }
      await client.mutate('asset.add', { id, modelId: m.id, number, serial: f.serial.trim(), ...where, notes: '', fromCount: one })
    }).then(
      () => setLastId(id),
      (err: Error) => setError(err.message)
    )
    // Ready for the next label, in the same place.
    setF({ ...f, number: '', serial: '' })
    numberField.current?.focus()
  }

  return (
    <form className="grid-form add-item" onSubmit={submit}>
      <h3 className="wide">Add an item</h3>
      <label className="wide">
        Number
        <input
          ref={numberField}
          value={f.number}
          onChange={(e) => setF({ ...f, number: e.target.value })}
          placeholder="From its label; empty for the next free one"
          autoComplete="off"
          autoCapitalize="characters"
          enterKeyHint="done"
        />
      </label>
      <label>
        Serial <input value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} placeholder="The maker's, if any" autoComplete="off" />
      </label>
      <label>
        Where it's kept{' '}
        <input list="where-choices" value={f.where} onChange={(e) => setF({ ...f, where: e.target.value })} placeholder="A place, or a case's number" />
      </label>
      {countedThere > 0 && known && (
        <label className="wide tick">
          <input type="checkbox" checked={fromCount} onChange={(e) => setFromCount(e.target.checked)} />
          <span>
            One of the {countedThere.toLocaleString('en-IE')} counted {atLabel(known, w)}, not labelled until now
          </span>
        </label>
      )}
      {error && <p className="alert wide">{error}</p>}
      {last && !error && (
        <p className="added wide" role="status">
          {last.number ? (
            <>
              Added <a href={`#stock/item/${last.id}`}>{last.number}</a>.
            </>
          ) : (
            'Added. It gets the next free number when it syncs.'
          )}
        </p>
      )}
      <button type="submit" className="primary wide">
        Add item
      </button>
    </form>
  )
}

function Counted({ m, w }: { m: ModelView; w: WarehouseView }) {
  const numbered = m.tracking === 'serialised'
  return (
    <section className="card" aria-label={numbered ? 'Not labelled yet' : 'Counted'}>
      <h2>{numbered ? 'Not labelled yet' : 'Counted'}</h2>
      {numbered && <p className="hint">How many are here but not labelled yet. Adding an item where some are counted takes one off.</p>}
      {m.counted.length === 0 && <p className="empty">{numbered ? 'None counted.' : 'None counted yet.'}</p>}
      {m.counted.map((s) => (
        <CountRow key={s.id} s={s} w={w}>
          {whereLabel(s, w)}
        </CountRow>
      ))}
      <NewCount m={m} w={w} />
      <p className="hint">In all: {amountLabel(m)}.</p>
    </section>
  )
}

/** A count somewhere not counted before. */
function NewCount({ m, w }: { m: ModelView; w: WarehouseView }) {
  const [where, setWhere] = useState('')
  const [qty, setQty] = useState('')
  const [error, setError] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const n = Number(qty)
    if (!Number.isInteger(n) || n < 1 || n > MAX_QTY) return setError('How many are there? A whole number, please.')
    const known = findWhere(where, w)
    const already = known && m.counted.find((s) => s.id === stockId(m.id, known))
    if (already && !confirm(`${already.qty.toLocaleString('en-IE')} are counted ${atLabel(known, w)} already. Make it ${n.toLocaleString('en-IE')}?`)) return
    void act(async () => {
      const at = await whereNamed(where, w)
      if (!at) throw new Error('Where are they?')
      await client.mutate('stock.set', { modelId: m.id, ...at, qty: n })
    }).then(
      () => {
        setWhere('')
        setQty('')
      },
      (err: Error) => setError(err.message)
    )
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <h3 className="wide">Add a count</h3>
      <label>
        Counted at <input list="where-choices" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="A place, or a case's number" required />
      </label>
      <label>
        How many <input type="number" inputMode="numeric" min={1} max={MAX_QTY} value={qty} onChange={(e) => setQty(e.target.value)} required />
      </label>
      {error && <p className="alert wide">{error}</p>}
      <button type="submit" className="wide">
        Save count
      </button>
    </form>
  )
}
