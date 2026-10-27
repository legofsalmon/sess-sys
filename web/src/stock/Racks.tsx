import {
  DEPARTMENT_LABELS,
  DEPARTMENTS,
  euroText,
  MAX_SLOT_QTY,
  MAX_UNITS,
  newId,
  parseEuro,
  plural,
  RACK_SIDE_LABELS,
  RACK_PART_LABELS,
  RACK_PARTS,
  RACK_WIDTH_LABELS,
  RACK_WIDTHS,
  type RackPart,
  type RackWidth,
  valueLabel,
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
import { productPhotoOf, Thumb } from '../Picture.tsx'
import { ProductPicker } from '../ProductPicker.tsx'
import { useAccess } from '../role.ts'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { StockViews } from '../Views.tsx'
import { numberLabel } from './common.tsx'
import { slotName, thingClass, thingStyle } from './rack-look.ts'
import { PrintRackSheet } from './RackSheet.tsx'
import './racks.css'

/**
 * Racks (ADR 0074): kit built up in a rack case that travels as one. A
 * rack is a product with a stock code, a size and a layout of what goes
 * where; each one built of it is an item holding its kit, checked against
 * the layout. Stock's Racks page lists them; a rack's product page shows
 * its layout and the racks built of it; a built rack's item page says
 * what's missing from it.
 */

/** "12U, 450 mm deep"; kit as "rack-mount, 1U, half width, 300 mm deep" (ADR 0076). */
export function sizeLabel(m: Pick<ModelView, 'units' | 'depthMm'> & Partial<Pick<ModelView, 'isRack' | 'rackMount' | 'rackWidth' | 'rackPart'>>): string {
  return [
    m.rackMount && (m.rackPart ? RACK_PART_LABELS[m.rackPart].replace(/^An? /, '').toLowerCase() : 'rack-mount'),
    m.units !== null && `${m.units}U`,
    m.rackMount && m.rackWidth && m.rackWidth !== 'full' && RACK_WIDTH_LABELS[m.rackWidth].toLowerCase(),
    m.depthMm !== null && `${m.depthMm} mm deep`,
  ]
    .filter(Boolean)
    .join(', ')
}

/** A rack's case: "600 × 750 × 650 mm outside, on castors, 16 A power". */
export function caseLabel(m: Pick<ModelView, 'caseWidthMm' | 'caseHeightMm' | 'caseDepthMm' | 'castors' | 'powerLimitA'>): string {
  const outside = [m.caseWidthMm, m.caseHeightMm, m.caseDepthMm]
  return [
    outside.some((n) => n !== null) && `${outside.map((n) => (n === null ? '?' : n.toLocaleString('en-IE'))).join(' × ')} mm outside (wide × high × deep)`,
    m.castors && 'on castors',
    m.powerLimitA !== null && `${m.powerLimitA} A power`,
  ]
    .filter(Boolean)
    .join(', ')
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
        <Thumb icon="case" src={productPhotoOf(r.model)} />
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
  /** Goes on a rack's rails (ADR 0076): shows its height, width and depth. */
  rackMount: boolean
  units: string
  width: RackWidth
  depth: string
  weight: string
  power: string
  /** A rack case's outside, castors and power (ADR 0076). */
  caseWidth: string
  caseHeight: string
  caseDepth: string
  castors: boolean
  amps: string
  /** A rack part rather than kit (ADR 0079); empty for kit. */
  part: RackPart | ''
}

const typed = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))

type Sizes = Pick<ModelView, 'code' | 'units' | 'depthMm' | 'weightKg' | 'powerW' | 'rackMount' | 'rackWidth' | 'caseWidthMm' | 'caseHeightMm' | 'caseDepthMm' | 'castors' | 'powerLimitA' | 'rackPart'>

export const sizeTypedOf = (m?: Sizes): SizeTyped => ({
  code: m?.code ?? '',
  rackMount: m?.rackMount ?? false,
  units: typed(m?.units),
  width: m?.rackWidth ?? 'full',
  depth: typed(m?.depthMm),
  weight: typed(m?.weightKg),
  power: typed(m?.powerW),
  caseWidth: typed(m?.caseWidthMm),
  caseHeight: typed(m?.caseHeightMm),
  caseDepth: typed(m?.caseDepthMm),
  castors: m?.castors ?? false,
  amps: typed(m?.powerLimitA),
  part: m?.rackPart ?? '',
})

/**
 * What the size fields say, or why they can't be saved. Kit that isn't
 * rack-mount keeps no height or depth, as nothing shows them; a rack keeps
 * no power of its own, only what its power can take.
 */
export function sizeFrom(f: SizeTyped, models: readonly ModelView[], self?: string, rack = false) {
  const code = f.code.trim()
  const coded = code && models.find((x) => x.id !== self && x.code.toLowerCase() === code.toLowerCase())
  if (coded) return { reason: `${coded.name} already has the stock code ${coded.code}.` }
  if (code.length > 30) return { reason: 'The stock code can be up to 30 characters.' }
  const sized = rack || f.rackMount
  const units = sized ? wholeTyped(f.units, MAX_UNITS) : null
  if (Number.isNaN(units) || units === 0) return { reason: `Rack units are a whole number from 1 to ${MAX_UNITS}, or blank.` }
  const depthMm = sized ? wholeTyped(f.depth, 3000) : null
  if (Number.isNaN(depthMm) || depthMm === 0) return { reason: 'The depth is a whole number of millimetres, up to 3,000, or blank.' }
  const weightKg = kilosTyped(f.weight)
  if (Number.isNaN(weightKg)) return { reason: 'The weight is a number of kilos, such as 12.5, or blank.' }
  const powerW = rack ? null : wholeTyped(f.power, 100_000)
  if (Number.isNaN(powerW)) return { reason: 'The power is a whole number of watts, or blank.' }
  const outside = rack ? [f.caseWidth, f.caseHeight, f.caseDepth].map((t) => wholeTyped(t, 3000)) : [null, null, null]
  if (outside.some((n) => Number.isNaN(n) || n === 0)) return { reason: 'The outside sizes are whole numbers of millimetres, up to 3,000, or blank.' }
  const powerLimitA = rack ? wholeTyped(f.amps, 125) : null
  if (Number.isNaN(powerLimitA) || powerLimitA === 0) return { reason: 'What its power can take is a whole number of amps, up to 125, or blank.' }
  const [caseWidthMm, caseHeightMm, caseDepthMm] = outside as (number | null)[]
  return {
    size: {
      code,
      rackMount: !rack && f.rackMount,
      units,
      rackWidth: !rack && f.rackMount ? f.width : ('full' as RackWidth),
      depthMm,
      weightKg,
      powerW,
      caseWidthMm: caseWidthMm ?? null,
      caseHeightMm: caseHeightMm ?? null,
      caseDepthMm: caseDepthMm ?? null,
      castors: rack && f.castors,
      powerLimitA,
      rackPart: !rack && f.rackMount && f.part ? f.part : null,
    },
  }
}

/**
 * A product's stock code, size and weight, for the product forms. Kit is
 * ticked as rack-mount to give its size in a rack (ADR 0076); a rack gives
 * the room in it and its case from the outside.
 */
export function SizeFields({ f, onChange, rack }: { f: SizeTyped; onChange: (f: SizeTyped) => void; rack: boolean }) {
  const field = (key: keyof SizeTyped, label: string, placeholder: string, mode: 'numeric' | 'decimal' = 'numeric') => (
    <label>
      {label}
      <input inputMode={mode} value={f[key] as string} onChange={(e) => onChange({ ...f, [key]: e.target.value })} placeholder={placeholder} />
    </label>
  )
  return (
    <fieldset className="wide size-fields">
      <legend>{rack ? 'Stock code and size' : 'Stock code, size and weight'}</legend>
      <label>
        Stock code <input value={f.code} onChange={(e) => onChange({ ...f, code: e.target.value })} placeholder={rack ? 'e.g. RK-MON-A' : 'Optional'} autoComplete="off" />
      </label>
      {rack ? (
        <>
          {field('units', 'Room in it, in rack units', 'e.g. 12')}
          {field('depth', 'Rail to rail depth, in mm', 'e.g. 450')}
          {field('weight', 'Weight empty, in kg', 'e.g. 28', 'decimal')}
          {field('caseWidth', 'Outside width, in mm', 'e.g. 600')}
          {field('caseHeight', 'Outside height, in mm', 'e.g. 750')}
          {field('caseDepth', 'Outside depth, in mm', 'e.g. 650')}
          {field('amps', 'Its power takes, in amps', 'e.g. 16')}
          <label className="choice wide">
            <input type="checkbox" checked={f.castors} onChange={(e) => onChange({ ...f, castors: e.target.checked })} />
            <span>
              <b>On castors</b>
              <small>Wheeled rather than lifted, so a heavy one isn't flagged as too heavy to lift.</small>
            </span>
          </label>
          <p className="hint wide">The room and depth are checked against what goes in it; the outside size is for the truck.</p>
        </>
      ) : (
        <>
          {field('weight', 'Weight, in kg', 'e.g. 12.5', 'decimal')}
          {field('power', 'Power at most, in watts', 'e.g. 1200')}
          <label className="choice wide">
            <input type="checkbox" checked={f.rackMount} onChange={(e) => onChange({ ...f, rackMount: e.target.checked })} />
            <span>
              <b>Rack-mount</b>
              <small>Made to go on a rack's rails. Give its size in a rack and it can be laid out in racks.</small>
            </span>
          </label>
          {f.rackMount && (
            <>
              {field('units', 'Height, in rack units', 'e.g. 2')}
              <label>
                Width
                <select value={f.width} onChange={(e) => onChange({ ...f, width: e.target.value as RackWidth })}>
                  {RACK_WIDTHS.map((w) => (
                    <option key={w} value={w}>
                      {RACK_WIDTH_LABELS[w]}
                    </option>
                  ))}
                </select>
              </label>
              {field('depth', 'Depth, in mm', 'e.g. 450')}
              <label>
                What it is
                <select value={f.part} onChange={(e) => onChange({ ...f, part: e.target.value as RackPart | '' })}>
                  <option value="">Kit</option>
                  {RACK_PARTS.map((p) => (
                    <option key={p} value={p}>
                      {RACK_PART_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </>
      )}
    </fieldset>
  )
}

function NewRack({ view }: { view: View }) {
  const w = view.warehouse
  const [name, setName] = useState('')
  const [department, setDepartment] = useState<Department>('audio')
  const [size, setSize] = useState<SizeTyped>(sizeTypedOf())
  const { run, error, refuse } = useAct()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    const taken = w.models.find((m) => m.name.trim().toLowerCase() === n.toLowerCase())
    if (taken) return refuse(`There's already a product called ${taken.name}.`)
    const got = sizeFrom(size, w.models, undefined, true)
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
      })
    ).then((ok) => {
      // Straight to laying it out (ADR 0075).
      if (ok) location.hash = `#stock/racks/${id}`
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
  const onRails = r.slots.filter((s) => s.top !== null)
  const loose = r.slots.filter((s) => s.top === null)
  const remove = (s: SlotView) => void run(() => client.mutate('rackSlot.remove', { id: s.id }))
  return (
    <section className="card rack-card" aria-labelledby="layout-title">
      <Heading icon="case" id="layout-title">
        Layout
      </Heading>
      {r.slots.length === 0 ? (
        <Empty>
          Nothing laid out yet. <a href={`#stock/racks/${r.model.id}`}>Design it</a>, dragging kit in, or add what goes in it below.
        </Empty>
      ) : (
        <>
          <LayoutTotals r={r} />
          <div className="actions">
            <a className="button" href={`#stock/racks/${r.model.id}`}>
              Design it
            </a>
            <PrintRackSheet r={r} />
          </div>
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
                    {s.label && `${s.label}: `}
                    {s.model ? <a href={`#stock/product/${s.model.id}`}>{s.model.name}</a> : 'A product no longer listed'}
                    {s.group && ` · ${s.group}`}
                    {s.model?.dryHire && ` · Dry hire${s.model.supplier ? ` from ${s.model.supplier}` : ''}`}
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
export function Elevation({ r, side }: { r: RackView; side: RackSide }) {
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
              className={`rack-thing ${thingClass(s)}${bad.has(s.id) ? ' bad' : ''}${s.pending ? ' is-pending' : ''}${s.model?.dryHire ? ' hired' : ''}`}
              style={thingStyle(s, units)}
              title={[s.model?.name, s.group].filter(Boolean).join(' · ')}
            >
              {s.model?.rackPart === 'blank' && !s.label ? '' : <span className="thing-name">{slotName(s)}</span>}
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
        <>
          <p>Everything in its layout is in it.</p>
          <HireIn b={b} name={name} />
        </>
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
          <HireIn b={b} name={name} />
          <p className="hint">Put kit in it from the item's own page (Where it's kept), or by moving it here below.</p>
        </>
      )}
    </section>
  )
}

/** Ours or dry hire, as typed (ADR 0075). */
export interface WhoseTyped {
  dryHire: boolean
  supplier: string
  hire: string
}

export const whoseTypedOf = (m?: Pick<ModelView, 'dryHire' | 'supplier' | 'hireDayCents'>): WhoseTyped => ({
  dryHire: m?.dryHire ?? false,
  supplier: m?.supplier ?? '',
  hire: m?.hireDayCents === null || m?.hireDayCents === undefined ? '' : euroText(m.hireDayCents),
})

/** What the ours-or-dry-hire fields say, or why they can't be saved. */
export function whoseFrom(f: WhoseTyped) {
  if (!f.dryHire) return { whose: { dryHire: false } }
  const hire = parseEuro(f.hire)
  if (hire.reason !== undefined) return { reason: hire.reason }
  if (f.supplier.trim().length > 200) return { reason: 'The supplier can be up to 200 characters.' }
  return { whose: { dryHire: true, supplier: f.supplier.trim(), hireDayCents: hire.cents } }
}

/**
 * Whose it is (ADR 0075): ours, labelled and counted here, or dry hired in
 * from a supplier whenever a job or a rack needs it.
 */
export function WhoseFields({ f, onChange, suppliers }: { f: WhoseTyped; onChange: (f: WhoseTyped) => void; suppliers: readonly string[] }) {
  return (
    <fieldset className="wide tracking">
      <legend>Whose it is</legend>
      <label className="choice">
        <input type="radio" name="whose" checked={!f.dryHire} onChange={() => onChange({ ...f, dryHire: false })} />
        <span>
          <b>Ours</b>
          <small>Labelled or counted here, and checked for what's free.</small>
        </span>
      </label>
      <label className="choice">
        <input type="radio" name="whose" checked={f.dryHire} onChange={() => onChange({ ...f, dryHire: true })} />
        <span>
          <b>Dry hire</b>
          <small>Not ours: hired in from a supplier when a job or a rack needs it, so it's never short.</small>
        </span>
      </label>
      {f.dryHire && (
        <div className="size-fields">
          <label>
            Hired from <input list="dry-hire-suppliers" value={f.supplier} onChange={(e) => onChange({ ...f, supplier: e.target.value })} placeholder="e.g. PRG" />
          </label>
          <label>
            Their price a day, in euro <input inputMode="decimal" value={f.hire} onChange={(e) => onChange({ ...f, hire: e.target.value })} placeholder="Optional" />
          </label>
          <datalist id="dry-hire-suppliers">
            {suppliers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
      )}
    </fieldset>
  )
}

/** Suppliers already in use, on products and on jobs' subhired kit, alphabetically. */
export function suppliersOf(view: View): string[] {
  const all = new Map<string, string>()
  for (const s of [...view.warehouse.models.map((m) => m.supplier), ...view.kit.suppliers]) if (s.trim()) all.set(s.trim().toLowerCase(), s.trim())
  return [...all.values()].sort((a, b) => a.localeCompare(b))
}

/** The dry hire kit in a built rack's layout (ADR 0075): hired in for each job it goes out on, so never missing. */
function HireIn({ b, name }: { b: BuiltRack; name: (id: string) => string }) {
  if (!b.check.hireIn.length) return null
  return (
    <>
      <h3>Hired in for each job</h3>
      <ul className="rack-check">
        {b.check.hireIn.map((x) => (
          <li key={x.modelId}>
            {x.qty.toLocaleString('en-IE')} × <a href={`#stock/product/${x.modelId}`}>{name(x.modelId)}</a>
          </li>
        ))}
      </ul>
    </>
  )
}

/** What a layout comes to: units each side, weight, power, the dry hire kit's cost, and what won't fit. */
export function LayoutTotals({ r }: { r: RackView }) {
  const m = r.model
  const l = r.layout
  const totals = [
    m.units !== null ? `Front ${l.frontUsed} of ${m.units}U, back ${l.rearUsed} of ${m.units}U` : `${l.frontUsed}U on the front, ${l.rearUsed}U on the back`,
    `${l.weightKg.toLocaleString('en-IE')} kg${l.weightMissing ? ` and ${plural(l.weightMissing, 'thing')} not weighed` : ''}`,
    `${l.powerW.toLocaleString('en-IE')} W${l.powerMissing ? ` and ${l.powerMissing} without a figure` : ''}${l.powerW ? `, ${l.amps.toLocaleString('en-IE')} A at 230 V, ${l.heatBtu.toLocaleString('en-IE')} BTU an hour of heat` : ''}`,
  ]
  const h = l.hire
  // Dry hire kit in it (ADR 0075): hired in each time it goes out, or bought.
  const hireLine = h.count
    ? `${plural(h.count, 'thing')} dry hired: ${valueLabel(h.dayCents)} a day to hire in${h.dayMissing ? ` (${h.dayMissing} with no price)` : ''}, ${valueLabel(h.buyCents)} to buy${h.buyMissing ? ` (${h.buyMissing} with no price)` : ''}`
    : ''
  return (
    <>
      <p className="rack-totals">{totals.join(' · ')}</p>
      {hireLine && <p className="rack-totals">{hireLine}</p>}
      {l.problems.length > 0 && (
        <ul className="rack-problems" aria-label="What won't work">
          {l.problems.map((p, i) => (
            <li key={`${p.slotId}-${i}`}>{p.message}</li>
          ))}
        </ul>
      )}
    </>
  )
}
