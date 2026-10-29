import { plural, type AssetView, type PlaceView, type View, type WarehouseView } from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Page } from '../jobs/common.tsx'
import { useAccess } from '../role.ts'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { contentsLabel, CountHere, CountRow, numberLabel, PutByNumber, SavedLine, WhereChoices } from './common.tsx'
import { CountsOf } from './Counts.tsx'
import { PLACES, STOCK } from '../Up.tsx'

/**
 * One place: what's kept there, cases and what's in them, and what's
 * counted there. Walking round with a phone, items are put here by their
 * number, scanned with the camera or typed, and counts taken as they're
 * found. Counting the whole place against the record, and when it was last
 * counted, is its Counts card (ADR 0030).
 */
export function PlaceScreen({ view, id, bare }: { view: View; id: string; bare?: boolean }) {
  const w = view.warehouse
  const p = w.places.find((x) => x.id === id)
  const up = { steps: [STOCK, PLACES], here: p?.name }
  if (!p)
    return (
      <Page view={view} title="Stock" className="warehouse" up={up} bare={bare}>
        <section className="card">
          <p className="empty">This place isn't on this device. It may still be on its way, or it was removed: check again once it says “Up to date”.</p>
        </section>
      </Page>
    )
  return (
    <Page view={view} title="Stock" className="warehouse" up={up} bare={bare}>
      <Summary p={p} w={w} />
      <CountsOf view={view} where={{ placeId: p.id, caseId: null }} />
      <Here p={p} w={w} />
      <WhereChoices w={w} />
    </Page>
  )
}

function Summary({ p, w }: { p: PlaceView; w: WarehouseView }) {
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [f, setF] = useState({ name: p.name, notes: p.notes })
  const { run, error, refuse } = useAct()
  // Changing places is stock's (audit finding 9): a role without it reads them.
  const mayChange = useAccess().can('stock')
  const empty = p.items.length === 0 && p.counted.length === 0
  const save = (e: FormEvent) => {
    e.preventDefault()
    const name = f.name.trim()
    if (!name) return
    const taken = w.places.find((x) => x.id !== p.id && x.name.trim().toLowerCase() === name.toLowerCase())
    if (taken) return refuse(`There's already a place called ${taken.name}.`)
    if (name === p.name && f.notes.trim() === p.notes) return setEditing(false)
    void run(() => client.mutate('place.upsert', { id: p.id, name, notes: f.notes.trim() })).then((ok) => ok && setEditing(false))
  }
  const remove = () => {
    setRemoving(false)
    void run(() => client.mutate('place.remove', { id: p.id })).then((ok) => {
      if (ok) location.hash = '#stock'
    })
  }
  return (
    <section className="card">
      <header className="title">
        <h1>{p.name}</h1>
        <Pending pending={p.pending} />
      </header>
      <dl className="facts">
        <div>
          <dt>Items</dt>
          <dd>{p.itemTotal.toLocaleString('en-IE')}</dd>
        </div>
        <div>
          <dt>Counted</dt>
          <dd>{p.countedTotal.toLocaleString('en-IE')}</dd>
        </div>
      </dl>
      {p.notes && <p className="notes">{p.notes}</p>}
      {!mayChange ? null : editing ? (
        <form className="grid-form" onSubmit={save}>
          <label className="wide">
            Name <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          </label>
          <label className="wide">
            Notes <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. Top shelf is for spares" />
          </label>
          <Refusal error={error} className="wide" />
          <div className="actions wide">
            <button type="submit" className="primary">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : removing ? (
        <Confirm question={`Remove ${p.name}? Nothing is kept there, so nothing moves.`} yes="Remove it" onYes={remove} onNo={() => setRemoving(false)} />
      ) : (
        <>
          <Refusal error={error} />
          <div className="actions">
            <button type="button" onClick={() => (setF({ name: p.name, notes: p.notes }), setEditing(true))}>
              Change details
            </button>
            {empty && (
              <button type="button" className="link" onClick={() => setRemoving(true)}>
                Remove place
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}

/** Items here grouped by product, cases first, then what's counted here. */
function Here({ p, w }: { p: PlaceView; w: WarehouseView }) {
  const cases = p.items.filter((a) => a.model?.isCase)
  const groups = new Map<string, AssetView[]>()
  for (const a of p.items) {
    if (a.model?.isCase) continue
    groups.set(a.modelId, [...(groups.get(a.modelId) ?? []), a])
  }
  const byName = [...groups.values()].sort((a, b) => (a[0]!.model?.name ?? '').localeCompare(b[0]!.model?.name ?? ''))
  const empty = p.items.length === 0 && p.counted.length === 0
  // What a count or a move of what's counted here just did.
  const [said, setSaid] = useState('')
  const mayPut = useAccess().can('stock')
  return (
    <section className="card" aria-label="Here">
      <h2>Here</h2>
      {empty && <Empty />}
      {cases.length > 0 && (
        <ul className="item-list">
          {cases.map((c) => (
            <li key={c.id}>
              <a className="item-row" href={`#stock/item/${c.id}`}>
                <div>
                  <b>{numberLabel(c)}</b> {c.model?.name}
                  <p>{c.items.length > 0 || c.counted.length > 0 ? contentsLabel(c) : 'Empty'}</p>
                </div>
                <Pending pending={c.pending} />
              </a>
            </li>
          ))}
        </ul>
      )}
      {byName.map((items) => {
        const m = items[0]!.model
        return (
          <div className="group" key={items[0]!.modelId}>
            <p className="group-name">
              {m ? <a href={`#stock/product/${m.id}`}>{m.name}</a> : 'A product since removed'} <small>{plural(items.length, 'item')}</small>
            </p>
            <ul className="numbers">
              {items.map((a) => (
                <li key={a.id}>
                  <a href={`#stock/item/${a.id}`} className={a.pending ? 'is-pending' : undefined}>
                    {numberLabel(a)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      {p.counted.map((s) => (
        <CountRow key={s.id} s={s} w={w} onSaid={setSaid}>
          × {s.model ? <a href={`#stock/product/${s.model.id}`}>{s.model.name}</a> : 'a product since removed'}
          {s.model?.tracking === 'serialised' && <small>, not labelled yet</small>}
        </CountRow>
      ))}
      <SavedLine text={said} />
      {mayPut && <PutHere p={p} w={w} />}
      <CountHere w={w} at={{ placeId: p.id, caseId: null }} title="Count something here" onSaid={setSaid} />
    </section>
  )
}

/** Scan or type an item's number to say it's kept here. */
function PutHere({ p, w }: { p: PlaceView; w: WarehouseView }) {
  return (
    <PutByNumber
      w={w}
      heading="Put an item here"
      label="Put here"
      button="Put it here"
      why={(item) => (item.placeId === p.id ? `${item.number} is here already.` : undefined)}
      to={{ placeId: p.id, caseId: null }}
      done={(item) => `${item.number} (${item.model?.name ?? 'an item'}) is here now.`}
    />
  )
}
