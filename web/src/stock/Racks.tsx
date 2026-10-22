import {
  DEPARTMENT_LABELS,
  DEPARTMENTS,
  MAX_SLOT_QTY,
  MAX_UNITS,
  newId,
  plural,
  RACK_SIDE_LABELS,
  unitsAt,
  type AssetView,
  type BuiltRack,
  type Department,
  type ModelView,
  type RackSide,
  type RackView,
  type SlotView,
  type View,
} from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Fold } from '../Fold.tsx'
import { Heading } from '../Icon.tsx'
import { Top } from '../jobs/common.tsx'
import { Thumb } from '../Picture.tsx'
import { ProductPicker } from '../ProductPicker.tsx'
import { useAccess } from '../role.ts'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { StockViews } from '../Views.tsx'
import { numberLabel } from './common.tsx'
import './racks.css'

/**
 * Racks (ADR 0074): kit built up in a rack case that travels as one. A
 * rack is a product with a stock code, a size and a layout of what goes
 * where; each one built of it is an item holding its kit, checked against
 * the layout. Stock's Racks page lists them; a rack's product page shows
 * its layout and the racks built of it; a built rack's item page says
 * what's missing from it.
 */

/** "12U, 450 mm deep". */
export function sizeLabel(m: Pick<ModelView, 'units' | 'depthMm'>): string {
  return [m.units !== null && `${m.units}U`, m.depthMm !== null && `${m.depthMm} mm deep`].filter(Boolean).join(', ')
}

/** "18.5 kg, 1,200 W". */
export function weightPowerLabel(m: Pick<ModelView, 'weightKg' | 'powerW'>): string {
  return [m.weightKg !== null && `${m.weightKg.toLocaleString('en-IE')} kg`, m.powerW !== null && `${m.powerW.toLocaleString('en-IE')} W`].filter(Boolean).join(', ')
}

/** A built rack against its layout, in a few words: "All there", "2 missing", "1 missing, 1 extra". */
export function checkLabel(b: BuiltRack): { text: string; tone: 'ok' | 'warn' } {
  const missing = b.check.missing.reduce((n, x) => n + x.qty, 0)
  const extra = b.check.extra.reduce((n, x) => n + x.qty, 0)
  if (!missing && !extra) return { text: 'All there', tone: 'ok' }
  return { text: [missing && `${missing.toLocaleString('en-IE')} missing`, extra && `${extra.toLocaleString('en-IE')} not in its layout`].filter(Boolean).join(', '), tone: 'warn' }
}

/** Stock › Racks: every rack, its size, and how the ones built of it stand. */
export function RacksScreen({ view }: { view: View }) {
  const mayChange = useAccess().can('stock')
  const racks = view.racks.racks
  return (
    <div className="app warehouse">
      <Top view={view} title="Stock" />
      <StockViews view={view} current="racks" />
      <h1 className="area-title">Racks</h1>
      <section className="card" aria-label="Racks">
        <Heading icon="case">Racks</Heading>
        {racks.length === 0 && <Empty>Add a rack, then lay out what goes in it. Each one built of it goes out and comes back as one.</Empty>}
        <ul className="job-list">
          {racks.map((r) => (
            <RackRow key={r.model.id} r={r} />
          ))}
        </ul>
        {mayChange && (
          <Fold label="Add rack">
            <NewRack view={view} />
          </Fold>
        )}
      </section>
    </div>
  )
}

function RackRow({ r }: { r: RackView }) {
  const m = r.model
  const short = r.built.filter((b) => checkLabel(b).tone === 'warn').length
  const things = r.slots.reduce((n, s) => n + s.qty, 0)
  return (
    <li>
      <a className="job-row" href={`#stock/product/${m.id}`}>
        <Thumb icon="case" />
        <div>
          <b>{m.name}</b>
          <p>{[m.code, sizeLabel(m), things ? plural(things, 'thing') + ' in its layout' : 'Nothing laid out yet'].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="side">
          <Pending pending={m.pending} />
          <small>{r.built.length ? `${plural(r.built.length, 'built')}` : 'None built'}</small>
          {short > 0 && <small className="flag warn">{short === r.built.length && short === 1 ? 'Not all there' : `${short} not all there`}</small>}
          {r.layout.problems.length > 0 && <small className="flag warn">Doesn't fit</small>}
        </div>
      </a>
    </li>
  )
}

/** Whole numbers as typed, or blank for not given; NaN for anything else. */
function wholeTyped(text: string, max: number): number | null {
  const t = text.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isInteger(n) && n >= 0 && n <= max ? n : NaN
}

function kilosTyped(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 && n <= 5000 ? Math.round(n * 10) / 10 : NaN
}

/** The size fields as typed. */
export interface SizeTyped {
  code: string
  units: string
  depth: string
  weight: string
  power: string
}

export const sizeTypedOf = (m?: Pick<ModelView, 'code' | 'units' | 'depthMm' | 'weightKg' | 'powerW'>): SizeTyped => ({
  code: m?.code ?? '',
  units: m?.units === null || m?.units === undefined ? '' : String(m.units),
  depth: m?.depthMm === null || m?.depthMm === undefined ? '' : String(m.depthMm),
  weight: m?.weightKg === null || m?.weightKg === undefined ? '' : String(m.weightKg),
  power: m?.powerW === null || m?.powerW === undefined ? '' : String(m.powerW),
})

/** What the size fields say, or why they can't be saved. */
export function sizeFrom(f: SizeTyped, models: readonly ModelView[], self?: string) {
  const code = f.code.trim()
  const coded = code && models.find((x) => x.id !== self && x.code.toLowerCase() === code.toLowerCase())
  if (coded) return { reason: `${coded.name} already has the stock code ${coded.code}.` }
  if (code.length > 30) return { reason: 'The stock code can be up to 30 characters.' }
  const units = wholeTyped(f.units, MAX_UNITS)
  if (Number.isNaN(units) || units === 0) return { reason: `Rack units are a whole number from 1 to ${MAX_UNITS}, or blank.` }
  const depthMm = wholeTyped(f.depth, 3000)
  if (Number.isNaN(depthMm) || depthMm === 0) return { reason: 'The depth is a whole number of millimetres, up to 3,000, or blank.' }
  const weightKg = kilosTyped(f.weight)
  if (Number.isNaN(weightKg)) return { reason: 'The weight is a number of kilos, such as 12.5, or blank.' }
  const powerW = wholeTyped(f.power, 100_000)
  if (Number.isNaN(powerW)) return { reason: 'The power is a whole number of watts, or blank.' }
  return { size: { code, units, depthMm, weightKg, powerW } }
}

/** A product's stock code and its size in a rack, for the product forms. */
export function SizeFields({ f, onChange, rack }: { f: SizeTyped; onChange: (f: SizeTyped) => void; rack: boolean }) {
  return (
    <fieldset className="wide size-fields">
      <legend>Stock code and size</legend>
      <label>
        Stock code <input value={f.code} onChange={(e) => onChange({ ...f, code: e.target.value })} placeholder={rack ? 'e.g. RK-MON-A' : 'Optional'} autoComplete="off" />
      </label>
      <label>
        {rack ? 'Room in it, in rack units' : 'Height in a rack, in units'}
        <input inputMode="numeric" value={f.units} onChange={(e) => onChange({ ...f, units: e.target.value })} placeholder={rack ? 'e.g. 12' : 'e.g. 2, or blank'} />
      </label>
      <label>
        {rack ? 'Depth it takes, in mm' : 'Depth, in mm'}
        <input inputMode="numeric" value={f.depth} onChange={(e) => onChange({ ...f, depth: e.target.value })} placeholder="e.g. 450" />
      </label>
      <label>
        {rack ? 'Weight empty, in kg' : 'Weight, in kg'}
        <input inputMode="decimal" value={f.weight} onChange={(e) => onChange({ ...f, weight: e.target.value })} placeholder="e.g. 12.5" />
      </label>
      {!rack && (
        <label>
          Power at most, in watts
          <input inputMode="numeric" value={f.power} onChange={(e) => onChange({ ...f, power: e.target.value })} placeholder="e.g. 1200" />
        </label>
      )}
      <p className="hint wide">{rack ? 'The room and depth are checked against what goes in it.' : 'Anything that goes in a rack: its height, depth, weight and power are added up in the racks it goes in.'}</p>
    </fieldset>
  )
}

function NewRack({ view }: { view: View }) {
  const w = view.warehouse
  const [name, setName] = useState('')
  const [department, setDepartment] = useState<Department>('audio')
  const [size, setSize] = useState<SizeTyped>({ code: '', units: '', depth: '', weight: '', power: '' })
  const { run, error, refuse } = useAct()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    const taken = w.models.find((m) => m.name.trim().toLowerCase() === n.toLowerCase())
    if (taken) return refuse(`There's already a product called ${taken.name}.`)
    const got = sizeFrom(size, w.models)
    if (!got.size) return refuse(got.reason)
    const id = newId()
    void run(() =>
      client.mutate('model.create', {
        id,
        name: n,
        department,
        category: 'Racks',
        tracking: 'serialised',
        isCase: true,
        isRack: true,
        valueCents: null,
        notes: '',
        ...got.size,
        powerW: null,
      })
    ).then((ok) => {
      if (ok) location.hash = `#stock/product/${id}`
    })
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <label className="wide">
        Name <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monitor rack A, Amp rack" required />
      </label>
      <label>
        Department
        <select value={department} onChange={(e) => setDepartment(e.target.value as Department)}>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {DEPARTMENT_LABELS[d]}
            </option>
          ))}
        </select>
      </label>
      <SizeFields f={size} onChange={setSize} rack />
      <Refusal error={error} className="wide" />
      <button type="submit" className="primary wide">
        Add rack
      </button>
    </form>
  )
}

/** On a rack's product page: its layout drawn and listed, what it comes to, what won't fit, and the racks built of it. */
export function RackCard({ view, r }: { view: View; r: RackView }) {
  const mayChange = useAccess().can('stock')
  const { run, error } = useAct()
  const m = r.model
  const l = r.layout
  const onRails = r.slots.filter((s) => s.top !== null)
  const loose = r.slots.filter((s) => s.top === null)
  const totals = [
    m.units !== null ? `Front ${l.frontUsed} of ${m.units}U, back ${l.rearUsed} of ${m.units}U` : `${l.frontUsed}U on the front, ${l.rearUsed}U on the back`,
    `${l.weightKg.toLocaleString('en-IE')} kg${l.weightMissing ? ` and ${plural(l.weightMissing, 'thing')} not weighed` : ''}`,
    `${l.powerW.toLocaleString('en-IE')} W${l.powerMissing ? ` and ${l.powerMissing} without a figure` : ''}`,
  ]
  const remove = (s: SlotView) => void run(() => client.mutate('rackSlot.remove', { id: s.id }))
  return (
    <section className="card rack-card" aria-labelledby="layout-title">
      <Heading icon="case" id="layout-title">
        Layout
      </Heading>
      {r.slots.length === 0 ? (
        <Empty>Nothing laid out yet. Add what goes in it below, at the rack unit it sits at.</Empty>
      ) : (
        <>
          <p className="rack-totals">{totals.join(' · ')}</p>
          {l.problems.length > 0 && (
            <ul className="rack-problems" aria-label="What won't fit">
              {l.problems.map((p, i) => (
                <li key={`${p.slotId}-${i}`}>{p.message}</li>
              ))}
            </ul>
          )}
          <div className="rack-sides">
            <Elevation r={r} side="front" />
            <Elevation r={r} side="rear" />
          </div>
          <ul className="item-list slot-list">
            {[...onRails, ...loose].map((s) => (
              <li key={s.id} className="item-row">
                <div>
                  <b>{s.top === null ? 'Loose' : `${unitsAt(s.top, s.model?.units ?? 1)} ${RACK_SIDE_LABELS[s.side].toLowerCase()}`}</b>
                  <p>
                    {s.qty > 1 && `${s.qty.toLocaleString('en-IE')} × `}
                    {s.model ? <a href={`#stock/product/${s.model.id}`}>{s.model.name}</a> : 'A product no longer listed'}
                    {s.notes && ` · ${s.notes}`}
                  </p>
                </div>
                <div className="side">
                  <Pending pending={s.pending} />
                  {mayChange && (
                    <button type="button" className="link" onClick={() => remove(s)} aria-label={`Take ${s.model?.name ?? 'it'} out of the layout`}>
                      Take out
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <Refusal error={error} />
      {mayChange && (
        <Fold label="Add to the layout">
          <AddSlot view={view} r={r} />
        </Fold>
      )}
      <Built r={r} />
    </section>
  )
}

/** One side of a rack drawn unit by unit, top to bottom, as a rack is numbered. */
function Elevation({ r, side }: { r: RackView; side: RackSide }) {
  const placed = r.slots.filter((s) => s.top !== null && s.side === side)
  const lowest = Math.max(r.model.units ?? 0, ...placed.map((s) => s.top! + (s.model?.units ?? 1) - 1), 1)
  const bad = new Set(r.layout.problems.map((p) => p.slotId))
  return (
    <figure className="rack-elevation" aria-label={`${RACK_SIDE_LABELS[side]} of ${r.model.name}`}>
      <figcaption>{RACK_SIDE_LABELS[side]}</figcaption>
      <div className="rack-units" style={{ gridTemplateRows: `repeat(${lowest}, var(--rack-u))` }}>
        {Array.from({ length: lowest }, (_, i) => (
          <span key={`u${i}`} className={`rack-u${r.model.units !== null && i >= r.model.units ? ' past' : ''}`} style={{ gridRow: i + 1 }}>
            {i + 1}
          </span>
        ))}
        {placed.map((s) => {
          const units = s.model?.units ?? 1
          return (
            <span
              key={s.id}
              className={`rack-thing${bad.has(s.id) ? ' bad' : ''}${s.pending ? ' is-pending' : ''}`}
              style={{ gridRow: `${s.top} / span ${units}` }}
              title={s.model?.name}
            >
              {s.model?.name ?? '?'}
            </span>
          )
        })}
      </div>
    </figure>
  )
}

function AddSlot({ view, r }: { view: View; r: RackView }) {
  const w = view.warehouse
  // Anything but a rack, which can't go in another.
  const products = w.models.filter((m) => !m.isRack)
  const [f, setF] = useState({ product: '', where: 'rails' as 'rails' | 'loose', top: '', side: 'front' as RackSide, qty: '1', notes: '' })
  const { run, error, refuse } = useAct()
  const chosen = products.find((p) => p.id === f.product)
  // The first free unit on that side, offered when the field is blank.
  const firstFree = (() => {
    const taken = new Set<number>()
    for (const s of r.slots) if (s.top !== null && s.side === f.side) for (let u = 0; u < (s.model?.units ?? 1); u++) taken.add(s.top + u)
    const need = chosen?.units ?? 1
    for (let u = 1; u <= MAX_UNITS - need + 1; u++) if (![...Array(need).keys()].some((k) => taken.has(u + k))) return u
    return 1
  })()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!chosen) return refuse('Choose what goes in it.')
    const onRails = f.where === 'rails'
    const top = onRails ? (f.top.trim() ? Number(f.top) : firstFree) : null
    if (top !== null && (!Number.isInteger(top) || top < 1 || top > MAX_UNITS)) return refuse(`The rack unit is a whole number from 1 to ${MAX_UNITS}.`)
    const qty = onRails ? 1 : Number(f.qty)
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_SLOT_QTY) return refuse(`How many is a whole number from 1 to ${MAX_SLOT_QTY}.`)
    const args = { id: newId(), rackId: r.model.id, modelId: chosen.id, top, side: f.side, qty, notes: f.notes.trim() }
    setF({ ...f, product: '', top: '', qty: '1', notes: '' })
    void run(() => client.mutate('rackSlot.set', args))
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <ProductPicker label="What goes in it" className="wide" products={products} value={f.product} onPick={(product) => setF((now) => ({ ...now, product }))} />
      <fieldset className="wide tracking">
        <legend>Where</legend>
        <label className="choice">
          <input type="radio" name="slot-where" checked={f.where === 'rails'} onChange={() => setF({ ...f, where: 'rails' })} />
          <span>
            <b>On the rails</b>
            <small>{chosen?.units ? `${chosen.units}U high` : 'Its height from the product, else 1U'}</small>
          </span>
        </label>
        <label className="choice">
          <input type="radio" name="slot-where" checked={f.where === 'loose'} onChange={() => setF({ ...f, where: 'loose' })} />
          <span>
            <b>Loose in it</b>
            <small>In a drawer or a pocket: cables, adaptors, spares.</small>
          </span>
        </label>
      </fieldset>
      {f.where === 'rails' ? (
        <>
          <label>
            Top at rack unit
            <input inputMode="numeric" value={f.top} onChange={(e) => setF({ ...f, top: e.target.value })} placeholder={`${firstFree}, the first free`} />
          </label>
          <label>
            Front or back
            <select value={f.side} onChange={(e) => setF({ ...f, side: e.target.value as RackSide })}>
              <option value="front">Front</option>
              <option value="rear">Back</option>
            </select>
          </label>
        </>
      ) : (
        <label>
          How many
          <input inputMode="numeric" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
        </label>
      )}
      <label className="wide">
        Note <input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Optional, e.g. Patched to the stage box" />
      </label>
      <Refusal error={error} className="wide" />
      <button type="submit" className="primary wide">
        Add to the layout
      </button>
    </form>
  )
}

/** The racks built of it, each against its layout. */
function Built({ r }: { r: RackView }) {
  return (
    <>
      <h3>Built</h3>
      {r.built.length === 0 ? (
        <p className="hint">None built yet. Label a rack case as {r.model.name} under Items below, then put the kit in it.</p>
      ) : (
        <ul className="item-list">
          {r.built.map((b) => {
            const c = checkLabel(b)
            return (
              <li key={b.item.id}>
                <a className="item-row" href={`#stock/item/${b.item.id}`}>
                  <div>
                    <b>{numberLabel(b.item)}</b>
                    <p>{b.item.at?.name ?? 'Nowhere said'}</p>
                  </div>
                  <span className={`flag ${c.tone}`}>{c.text}</span>
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

/** On a built rack's item page: what its layout has that it doesn't, and what it holds that its layout doesn't. */
export function BuiltRackCheck({ view, item }: { view: View; item: AssetView }) {
  const b = view.racks.built(item.id)
  const r = item.model && view.racks.of(item.model.id)
  if (!b || !r) return null
  const name = (id: string) => view.warehouse.models.find((m) => m.id === id)?.name ?? 'A product no longer listed'
  const c = checkLabel(b)
  return (
    <section className="card" aria-labelledby="built-check">
      <Heading icon="case" id="built-check">
        Against its layout
      </Heading>
      {r.slots.length === 0 ? (
        <p className="hint">
          <a href={`#stock/product/${r.model.id}`}>{r.model.name}</a> has nothing laid out yet, so there's nothing to check it against.
        </p>
      ) : c.tone === 'ok' ? (
        <p>Everything in its layout is in it.</p>
      ) : (
        <>
          {b.check.missing.length > 0 && (
            <>
              <h3>Missing</h3>
              <ul className="rack-check">
                {b.check.missing.map((x) => (
                  <li key={x.modelId}>
                    {x.qty.toLocaleString('en-IE')} × <a href={`#stock/product/${x.modelId}`}>{name(x.modelId)}</a>
                  </li>
                ))}
              </ul>
            </>
          )}
          {b.check.extra.length > 0 && (
            <>
              <h3>Not in its layout</h3>
              <ul className="rack-check">
                {b.check.extra.map((x) => (
                  <li key={x.modelId}>
                    {x.qty.toLocaleString('en-IE')} × <a href={`#stock/product/${x.modelId}`}>{name(x.modelId)}</a>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="hint">Put kit in it from the item's own page (Where it's kept), or by moving it here below.</p>
        </>
      )}
    </section>
  )
}
