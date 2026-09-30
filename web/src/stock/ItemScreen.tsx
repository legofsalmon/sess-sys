import {
  normaliseNumber,
  plural,
  RETIRED_LABELS,
  RETIRED_REASONS,
  type AssetView,
  type CommandInput,
  type RetiredReason,
  type View,
  type WarehouseView,
} from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { act } from '../crew/CrewScreen.tsx'
import { NotDone, Top } from '../jobs/common.tsx'
import { client } from '../sync.ts'
import {
  contentsLabel,
  CountHere,
  CountRow,
  itemNumbered,
  loopIn,
  numberLabel,
  Pending,
  STOCK_COMMANDS,
  whereLabel,
  WhereChoices,
  whereNamed,
} from './common.tsx'

/**
 * One numbered item: its label, its product, where it's kept, the labels
 * it had before, and for a case, what's in it. Retiring keeps it and its
 * number for the record; it can be brought back.
 */
export function ItemScreen({ view, id }: { view: View; id: string }) {
  const w = view.warehouse
  const a = w.assets.get(id)
  if (!a)
    return (
      <div className="app crew jobs warehouse">
        <Top view={view} title="Stock" />
        <a className="back" href="#stock">
          ‹ All stock
        </a>
        <section className="card">
          <p className="empty">This item isn't on this device. It may still be on its way: check again once it says “Up to date”.</p>
        </section>
      </div>
    )
  return (
    <div className="app crew jobs warehouse">
      <Top view={view} title="Stock" />
      <a className="back" href={a.model ? `#stock/product/${a.model.id}` : '#stock'}>
        ‹ {a.model?.name ?? 'All stock'}
      </a>
      <NotDone view={view} names={STOCK_COMMANDS} />
      <Summary a={a} w={w} />
      {a.model?.isCase && a.status === 'active' && <Inside c={a} w={w} />}
      <WhereChoices w={w} />
    </div>
  )
}

type Mode = 'move' | 'details' | 'label' | 'retire'

function Summary({ a, w }: { a: AssetView; w: WarehouseView }) {
  const [mode, setMode] = useState<Mode | undefined>()
  const retired = a.status === 'retired'
  const toggle = (m: Mode) => setMode(mode === m ? undefined : m)
  const done = () => setMode(undefined)
  const reinstate = () => void act(() => client.mutate('asset.reinstate', { id: a.id })).catch((err: Error) => alert(err.message))
  return (
    <section className="card">
      <header className="title">
        <h1 className="number">{numberLabel(a)}</h1>
        {a.pending ? <Pending pending /> : retired && <span className="pill cancelled">Retired</span>}
      </header>
      <dl className="facts">
        <div>
          <dt>Product</dt>
          <dd>{a.model ? <a href={`#stock/product/${a.model.id}`}>{a.model.name}</a> : 'Removed'}</dd>
        </div>
        <div>
          <dt>Serial</dt>
          <dd>{a.serial || 'None'}</dd>
        </div>
        {retired ? (
          <div className="wide">
            <dt>Retired</dt>
            <dd>
              {a.retiredReason ? RETIRED_LABELS[a.retiredReason] : 'Yes'}
              {a.retiredNote && `: ${a.retiredNote}`}
            </dd>
          </div>
        ) : (
          <div className="wide">
            <dt>Where</dt>
            <dd>{a.inCase ? <WhereLink a={a} /> : a.at ? <a href={`#stock/place/${a.at.id}`}>{a.at.name}</a> : whereLabel(a, w)}</dd>
          </div>
        )}
        {a.formerNumbers.length > 0 && (
          <div className="wide">
            <dt>Labels before</dt>
            <dd>{a.formerNumbers.join(', ')}</dd>
          </div>
        )}
      </dl>
      {a.notes && <p className="notes">{a.notes}</p>}
      {retired ? (
        <div className="actions">
          <button type="button" onClick={reinstate}>
            Bring back
          </button>
        </div>
      ) : (
        <div className="actions">
          {(['move', 'details', 'label', 'retire'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => toggle(m)}>
              {{ move: 'Move', details: 'Change details', label: 'New label', retire: 'Retire' }[m]}
            </button>
          ))}
        </div>
      )}
      {!retired && mode === 'move' && <Move a={a} w={w} onDone={done} />}
      {!retired && mode === 'details' && <Details a={a} w={w} onDone={done} />}
      {!retired && mode === 'label' && <Relabel a={a} w={w} onDone={done} />}
      {!retired && mode === 'retire' && <Retire a={a} onDone={done} />}
    </section>
  )
}

/** "In SH-000200 (Amp rack), Bay A3", with links to the case and the place. */
function WhereLink({ a }: { a: AssetView }) {
  const c = a.inCase!
  return (
    <>
      In <a href={`#stock/item/${c.id}`}>{numberLabel(c)}</a> ({c.model?.name ?? 'a case'})
      {c.at && (
        <>
          , <a href={`#stock/place/${c.at.id}`}>{c.at.name}</a>
        </>
      )}
    </>
  )
}

function Move({ a, w, onDone }: { a: AssetView; w: WarehouseView; onDone: () => void }) {
  const [to, setTo] = useState('')
  const [error, setError] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const typed = itemNumbered(to, w)
    if (typed?.model?.isCase && typed.status === 'active') {
      const loop = loopIn(a.id, typed.id, w)
      if (loop) return setError(loop)
    }
    void act(async () => {
      const dest = (await whereNamed(to, w)) ?? { placeId: null, caseId: null }
      if (dest.placeId === a.placeId && dest.caseId === a.caseId) return
      await client.mutate('asset.move', { id: a.id, ...dest })
    }).then(onDone, (err: Error) => setError(err.message))
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <label className="wide">
        Where to
        <input
          list="where-choices"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="A place, or a case's number; empty if not known"
          autoFocus
        />
      </label>
      {a.model?.isCase && (a.items.length > 0 || a.counted.length > 0) && <p className="hint wide">Everything in it goes too.</p>}
      {error && <p className="alert wide">{error}</p>}
      <div className="actions wide">
        <button type="submit" className="primary">
          Move {numberLabel(a)}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** Only what changed is sent, as for products and jobs. */
function Details({ a, w, onDone }: { a: AssetView; w: WarehouseView; onDone: () => void }) {
  const [f, setF] = useState({ modelId: a.modelId, serial: a.serial, notes: a.notes })
  const [error, setError] = useState('')
  // Another numbered product, when it was put down as the wrong one.
  const products = w.models.filter((m) => m.tracking === 'serialised')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const changes: CommandInput<'asset.update'> = { id: a.id }
    if (f.modelId !== a.modelId) {
      const next = products.find((m) => m.id === f.modelId)
      if (next && !next.isCase && (a.items.length > 0 || a.counted.length > 0))
        return setError(`${numberLabel(a)} has kit in it, and ${next.name} doesn't hold other kit. Empty it first.`)
      changes.modelId = f.modelId
    }
    if (f.serial.trim() !== a.serial) changes.serial = f.serial.trim()
    if (f.notes.trim() !== a.notes) changes.notes = f.notes.trim()
    if (Object.keys(changes).length === 1) return onDone()
    void act(() => client.mutate('asset.update', changes)).then(onDone, (err: Error) => setError(err.message))
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <label className="wide">
        Product
        <select value={f.modelId} onChange={(e) => setF({ ...f, modelId: e.target.value })}>
          {products.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="wide">
        Serial <input value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} autoComplete="off" />
      </label>
      <label className="wide">
        Notes <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </label>
      {error && <p className="alert wide">{error}</p>}
      <div className="actions wide">
        <button type="submit" className="primary">
          Save
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** For a label that's lost or worn out. The old number stays with the item and is never used again. */
function Relabel({ a, w, onDone }: { a: AssetView; w: WarehouseView; onDone: () => void }) {
  const [typed, setTyped] = useState('')
  const [error, setError] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const t = typed.trim()
    const number = (t && normaliseNumber(t)) || null
    if (t && !number) return setError(`“${t}” isn't a Session Hire number: they're SH- and six digits, such as SH-000123.`)
    if (number && number === a.number) return setError(`${number} is its label now.`)
    const other = number ? w.byNumber.get(number) : undefined
    if (number && other) {
      return setError(
        other.id === a.id
          ? `${number} was its label before, and a number is never used twice. Use another label.`
          : other.number === number
            ? `${number} is already in use (${other.model?.name ?? 'another item'}).`
            : `${number} was used before (${other.model?.name ?? 'another item'}, now ${numberLabel(other)}), and a number is never used twice. Use another label.`
      )
    }
    void act(() => client.mutate('asset.relabel', { id: a.id, number })).then(onDone, (err: Error) => setError(err.message))
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <p className="hint wide">For a label that's lost or worn out. {a.number ? `${a.number} stays in its history and is never used again.` : ''}</p>
      <label className="wide">
        New number
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="From the new label; empty for the next free one"
          autoComplete="off"
          autoCapitalize="characters"
          autoFocus
        />
      </label>
      {error && <p className="alert wide">{error}</p>}
      <div className="actions wide">
        <button type="submit" className="primary">
          Save new label
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function Retire({ a, onDone }: { a: AssetView; onDone: () => void }) {
  const [reason, setReason] = useState<RetiredReason>('scrapped')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const holding = [
    a.items.length > 0 && plural(a.items.length, 'item'),
    a.counted.length > 0 && `${a.counted.reduce((n, s) => n + s.qty, 0).toLocaleString('en-IE')} counted`,
  ].filter(Boolean)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (holding.length) return setError(`${numberLabel(a)} still holds ${holding.join(' and ')}. Empty it first.`)
    void act(() => client.mutate('asset.retire', { id: a.id, reason, note: note.trim() })).then(onDone, (err: Error) => setError(err.message))
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <p className="hint wide">It stops counting as stock. Its number and history are kept, and it can be brought back.</p>
      <fieldset className="wide reasons">
        <legend>Why</legend>
        {RETIRED_REASONS.map((r) => (
          <label key={r} className="tick">
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
            <span>{RETIRED_LABELS[r]}</span>
          </label>
        ))}
      </fieldset>
      <label className="wide">
        Note <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Dropped at the Point, cone torn" maxLength={500} />
      </label>
      {error && <p className="alert wide">{error}</p>}
      <div className="actions wide">
        <button type="submit" className="primary">
          Retire {numberLabel(a)}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** A case's contents: items in it, and what's counted in it. */
function Inside({ c, w }: { c: AssetView; w: WarehouseView }) {
  const [number, setNumber] = useState('')
  const [error, setError] = useState('')
  const put = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const t = number.trim()
    if (!t) return
    const item = itemNumbered(t, w)
    if (!item)
      return setError(
        normaliseNumber(t)
          ? `No item has the number ${normaliseNumber(t)}.`
          : `“${t}” isn't a Session Hire number: they're SH- and six digits, such as SH-000123.`
      )
    if (item.number !== normaliseNumber(t)) return setError(`${normaliseNumber(t)} was an old label. That item is ${numberLabel(item)} now.`)
    if (item.status !== 'active') return setError(`${item.number} (${item.model?.name ?? 'an item'}) is retired. Bring it back first.`)
    if (item.caseId === c.id) return setError(`${item.number} is in here already.`)
    const loop = loopIn(item.id, c.id, w)
    if (loop) return setError(loop)
    void act(() => client.mutate('asset.move', { id: item.id, placeId: null, caseId: c.id })).catch((err: Error) => setError(err.message))
    setNumber('')
  }
  const empty = c.items.length === 0 && c.counted.length === 0
  return (
    <section className="card" aria-label="In it">
      <h2>In it</h2>
      {empty && <p className="empty">Nothing yet.</p>}
      {c.items.length > 0 && (
        <ul className="item-list">
          {c.items.map((i) => (
            <li key={i.id}>
              <a className="item-row" href={`#stock/item/${i.id}`}>
                <div>
                  <b>{numberLabel(i)}</b> {i.model?.name}
                  {i.model?.isCase && (i.items.length > 0 || i.counted.length > 0) && <p>{contentsLabel(i)}</p>}
                </div>
                <Pending pending={i.pending} />
              </a>
            </li>
          ))}
        </ul>
      )}
      {c.counted.map((s) => (
        <CountRow key={s.id} s={s} w={w}>
          × {s.model ? <a href={`#stock/product/${s.model.id}`}>{s.model.name}</a> : 'a product since removed'}
          {s.model?.tracking === 'serialised' && <small>, not labelled yet</small>}
        </CountRow>
      ))}
      <form className="grid-form" onSubmit={put}>
        <h3 className="wide">Put an item in</h3>
        <label className="wide">
          Its number
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="e.g. SH-000123"
            autoComplete="off"
            autoCapitalize="characters"
            enterKeyHint="done"
          />
        </label>
        {error && <p className="alert wide">{error}</p>}
        <button type="submit" className="wide">
          Put it in {numberLabel(c)}
        </button>
      </form>
      <CountHere w={w} at={{ placeId: null, caseId: c.id }} title="Count what's in it" />
    </section>
  )
}
