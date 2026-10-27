import {
  acrossAt,
  acrossFor,
  blanksFor,
  dayLabel,
  findProducts,
  gapsOf,
  newId,
  RACK_ACROSS_LABELS,
  RACK_PART_LABELS,
  RACK_SIDE_LABELS,
  RACK_WIDTH_LABELS,
  spanAcross,
  TAPE_COLOUR_LABELS,
  TAPE_COLOUR_SWATCHES,
  TAPE_COLOURS,
  unitsAt,
  type CommandArgs,
  type ModelView,
  type RackAcross,
  type RackPart,
  type RackSide,
  type RackView,
  type SlotView,
  type TapeColour,
  type View,
} from '@sh/shared'
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Heading } from '../Icon.tsx'
import { Page } from '../jobs/common.tsx'
import { useAccess } from '../role.ts'
import { client } from '../sync.ts'
import { RACKS, STOCK } from '../Up.tsx'
import { useToday } from '../view.ts'
import { DRAG_TYPE, heldOf, type Held } from './rack-drag.ts'
import { GUESS_KIT_DEPTH, RACK_U, rackSize } from './rack-size.ts'
import { holderName, holdersIn, slotName, thingClass, thingStyle } from './rack-look.ts'
import { LayoutTotals, sizeLabel } from './Racks.tsx'
import { PrintRackSheet } from './RackSheet.tsx'

/**
 * The rack designer (ADR 0075), after stagerack.com: a rack drawn front and
 * back, unit by unit, with the stock list beside it to drag kit in from,
 * ours with how many are free on a day, and dry hire. Something dragged
 * over the rack shows where it would go, amber where it won't fit; dropped,
 * it's in the layout at once. A thing in the rack is dragged to move it, or
 * back to the list to take it out. On a phone, or with a keyboard, the same
 * is done by picking a thing up (a press) and pressing where it goes.
 *
 * It changes the rack's layout itself (ADR 0074), so what the designer
 * shows is what the rack's page and the built racks are checked against;
 * the checks and totals are the same ones.
 */

/**
 * How many of a product are free to build into a rack on a day: what we
 * have that isn't already in a rack or unfit, less what jobs going ahead
 * hold that day. Dry hire is hired in, so it's undefined.
 */
function freeOn(view: View, m: ModelView, day: string): number | undefined {
  if (m.dryHire) return undefined
  const held = (view.kit.byModel.get(m.id) ?? []).filter((l) => l.hold === 'held' && l.held && l.held.start <= day && l.held.end >= day).reduce((n, l) => n + l.own, 0)
  return Math.max(0, m.total - m.racked - view.faults.unusable(m.id) - held)
}

export function RackDesigner({ view, id, bare }: { view: View; id: string; bare?: boolean }) {
  const r = view.racks.of(id)
  const up = { steps: [STOCK, RACKS, ...(r ? [{ href: `#stock/product/${r.model.id}`, label: r.model.name }] : [])], here: 'Design' }
  if (!r)
    return (
      <Page view={view} title="Stock" className="warehouse" up={up} bare={bare}>
        <section className="card">
          <Empty>This rack isn't on this device. It may still be on its way, or it isn't a rack any more.</Empty>
        </section>
      </Page>
    )
  return (
    <Page view={view} title="Stock" className="warehouse" up={up} bare={bare}>
      <Designer key={r.model.id} view={view} r={r} />
    </Page>
  )
}

// The 3D drawing (ADR 0076) and three.js come down only when it's shown.
const Rack3D = lazy(() => import('./Rack3D.tsx'))

type Drawn = 'flat' | '3d' | 'side'
const VIEWS: [Drawn, string][] = [
  ['3d', 'In 3D'],
  ['flat', 'Front and back'],
  ['side', 'From the side'],
]
/** How the rack was last drawn on this device; a convenience, so it's kept only here. */
const DRAWN_KEY = 'sh.rackDrawn'
/** As last drawn here, or in 3D on a desk and flat on a phone. */
function drawnAtFirst(): Drawn {
  try {
    const kept = localStorage.getItem(DRAWN_KEY)
    if (kept === 'flat' || kept === '3d' || kept === 'side') return kept
  } catch {
    // Storage may be off; fall through.
  }
  return matchMedia('(min-width: 900px)').matches ? '3d' : 'flat'
}

/**
 * The rack cut through from the side (ADR 0076): the front rails on the
 * left, the back on the right, each thing on them as deep as it is, so the
 * room left behind it for cables and air is seen, and front and back kit
 * that meet in the middle.
 */
function SideCut({ r, bad }: { r: RackView; bad: ReadonlySet<string | undefined> }) {
  const size = rackSize(r)
  const placed = r.slots.filter((s) => s.top !== null)
  const pad = 30
  const width = size.depth + pad * 2
  const height = size.height + pad * 2
  return (
    <figure className="rack-side-cut">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="side-cut-title">
        <title id="side-cut-title">{`${r.model.name} from the side, ${size.depth} mm rail to rail${size.depthGuessed ? ' (no depth given, drawn at 500 mm)' : ''}`}</title>
        <rect className="cut-case" x={pad} y={pad} width={size.depth} height={size.height} />
        {Array.from({ length: size.units + 1 }, (_, i) => (
          <line key={i} className="cut-unit" x1={pad} x2={pad + size.depth} y1={pad + i * RACK_U} y2={pad + i * RACK_U} />
        ))}
        <line className="cut-rail" x1={pad} x2={pad} y1={pad} y2={pad + size.height} />
        <line className="cut-rail" x1={pad + size.depth} x2={pad + size.depth} y1={pad} y2={pad + size.height} />
        {placed.map((s) => {
          const units = s.model?.units ?? 1
          const deep = Math.min(s.model?.depthMm ?? GUESS_KIT_DEPTH, size.depth)
          const x = s.side === 'front' ? pad : pad + size.depth - deep
          return (
            <g key={s.id} className={`cut-thing${bad.has(s.id) ? ' bad' : ''}${s.model?.dryHire ? ' hired' : ''}${s.model?.depthMm === null ? ' guessed' : ''}`}>
              <rect x={x} y={pad + (s.top! - 1) * RACK_U + 1} width={deep} height={units * RACK_U - 2} />
              <text x={x + 8} y={pad + (s.top! - 1) * RACK_U + (units * RACK_U) / 2} dominantBaseline="middle">
                {s.model?.name ?? '?'}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className="hint">
        Front on the left, back on the right, {size.depth.toLocaleString('en-IE')} mm rail to rail. Each thing is drawn as deep as it is
        {placed.some((s) => s.model?.depthMm === null) ? '; dashed ones have no depth given' : ''}.
      </figcaption>
    </figure>
  )
}

type SlotArgs = CommandArgs<'rackSlot.set'>
/** One change to a layout, as the designer makes it and takes it back (ADR 0079). */
type Op = { set: SlotArgs } | { remove: string }
/** A step made in the designer: the changes it made, and the ones that take it back. */
interface Step {
  did: Op[]
  undo: Op[]
}
/** As many steps back as anyone would want: it's this visit's, not kept. */
const MOST_STEPS = 50

function Designer({ view, r }: { view: View; r: RackView }) {
  const mayChange = useAccess().can('stock')
  const today = useToday()
  const [day, setDay] = useState(today)
  const [held, setHeld] = useState<Held>()
  const { run, error, refuse } = useAct()
  const models = new Map(view.warehouse.models.map((m) => [m.id, m]))
  const heldModel = held ? (held.kind === 'new' ? models.get(held.modelId) : r.slots.find((s) => s.id === held.slotId)?.model) : undefined
  const heldSlot = held?.kind === 'slot' ? r.slots.find((s) => s.id === held.slotId) : undefined
  const [steps, setSteps] = useState<{ back: Step[]; on: Step[] }>({ back: [], on: [] })

  /** Makes the changes, one after another, as the outbox keeps them. */
  const apply = (ops: Op[]) => run(async () => {
    for (const op of ops) await ('set' in op ? client.mutate('rackSlot.set', op.set) : client.mutate('rackSlot.remove', { id: op.remove }))
  })
  /** A change that can be taken back with Undo. */
  const change = (did: Op[], undo: Op[]) => {
    setSteps((now) => ({ back: [...now.back, { did, undo }].slice(-MOST_STEPS), on: [] }))
    return apply(did)
  }
  const undo = () => {
    const step = steps.back.at(-1)
    if (!step) return
    setHeld(undefined)
    setSteps((now) => ({ back: now.back.slice(0, -1), on: [...now.on, step] }))
    void apply(step.undo)
  }
  const redo = () => {
    const step = steps.on.at(-1)
    if (!step) return
    setHeld(undefined)
    setSteps((now) => ({ back: [...now.back, step], on: now.on.slice(0, -1) }))
    void apply(step.did)
  }
  // Kept current for the keys, set up once.
  const keys = useRef({ undo, redo, held })
  keys.current = { undo, redo, held }

  // Escape puts down what's picked up; Ctrl or ⌘ Z undoes, with Shift (or Y) redoes, unless typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && keys.current.held) return setHeld(undefined)
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')
      if (typing || !(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) keys.current.undo()
      else if ((k === 'z' && e.shiftKey) || k === 'y') keys.current.redo()
      else return
      e.preventDefault()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const place = (h: Held, top: number | null, side: RackSide, across?: RackAcross) => {
    setHeld(undefined)
    if (h.kind === 'new') {
      const m = models.get(h.modelId)
      if (!m) return refuse('That product is no longer in the stock list.')
      const id = newId()
      void change([{ set: { ...NEW_SLOT, id, rackId: r.model.id, modelId: m.id, top, side, across: across ?? 'left' } }], [{ remove: id }])
      return
    }
    const s = r.slots.find((x) => x.id === h.slotId)
    if (!s) return
    const was = slotArgs(s)
    // Loose kit put on the rails goes one at a time; the rest stay loose.
    if (top !== null && s.top === null && s.qty > 1) {
      const id = newId()
      void change(
        [{ set: { ...was, qty: s.qty - 1 } }, { set: { ...NEW_SLOT, id, rackId: r.model.id, modelId: s.modelId, top, side, across: across ?? 'left', label: s.label, group: s.group, colour: s.colour } }],
        [{ remove: id }, { set: was }]
      )
      return
    }
    const next = { ...was, top, side, across: across ?? s.across, inSlotId: top === null ? s.inSlotId : null }
    if (s.top === top && s.side === side && next.across === s.across) return
    void change([{ set: next }], [{ set: was }, ...contentsOf(r, s.id)])
  }
  const takeOut = (slotId: string) => {
    setHeld(undefined)
    const s = r.slots.find((x) => x.id === slotId)
    if (!s) return
    // Taken back, a shelf or drawer gets back what was in it.
    void change([{ remove: slotId }], [{ set: slotArgs(s) }, ...contentsOf(r, s.id)])
  }
  const [drawn, setDrawnState] = useState<Drawn>(drawnAtFirst)
  const setDrawn = (d: Drawn) => {
    setDrawnState(d)
    try {
      localStorage.setItem(DRAWN_KEY, d)
    } catch {
      // Not kept, which only means it opens as it would anyway next time.
    }
  }
  const bad = useMemo(() => new Set(r.layout.problems.map((p) => p.slotId)), [r.layout])

  // The blanks there are, for Fill the gaps (ADR 0079).
  const blanks = view.warehouse.models.filter((m) => m.rackPart === 'blank' && m.units !== null && m.rackWidth === 'full')
  const gaps = r.model.units === null ? [] : gapsOf(r.model.units, r.slots, models, 'front')
  const fillGaps = () => {
    const { put, left } = blanksFor(gaps, blanks.map((b) => ({ id: b.id, units: b.units! })))
    if (!put.length) return refuse(blanks.length ? 'No blank is short enough for the gaps left.' : 'There are no blank panels in the stock list yet: add them under Rack parts.')
    const sets = put.map((p) => ({ ...NEW_SLOT, id: newId(), rackId: r.model.id, modelId: p.modelId, top: p.top, side: 'front' as const }))
    void change(
      sets.map((set) => ({ set })),
      sets.map((s) => ({ remove: s.id }))
    ).then((ok) => ok && left > 0 && refuse(`${left === 1 ? '1 unit is' : `${left} units are`} left open: no blank is short enough.`))
  }

  return (
    <div className="rack-designer">
      <section className="card designer-head" aria-labelledby="designer-title">
        <h1 id="designer-title">{r.model.name}</h1>
        <p className="rack-totals">{[r.model.code, sizeLabel(r.model) || 'No size given yet: give its rack units on its page'].filter(Boolean).join(' · ')}</p>
        <LayoutTotals r={r} />
        {mayChange && (
          <div className="designer-tools" role="group" aria-label="Change the layout">
            <button type="button" onClick={undo} disabled={!steps.back.length} aria-keyshortcuts="Control+Z Meta+Z">
              Undo
            </button>
            <button type="button" onClick={redo} disabled={!steps.on.length} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z">
              Redo
            </button>
            {gaps.length > 0 && (
              <button type="button" onClick={fillGaps}>
                Fill the gaps with blanks
              </button>
            )}
            <CopyRack view={view} r={r} />
            <PrintRackSheet r={r} />
          </div>
        )}
        {!mayChange && (
          <div className="designer-tools">
            <PrintRackSheet r={r} />
          </div>
        )}
        <Refusal error={error} />
        {/* Not while dragging: the line coming in would move the rack out from under the pointer. */}
        {held && heldModel && !held.drag && (
          <p className="holding" role="status">
            Holding {heldSlot?.label || heldModel.name}. Press where it goes{held.kind === 'slot' ? ', or Take out' : ''}.{' '}
            {held.kind === 'slot' && (
              <button type="button" className="link" onClick={() => takeOut(held.slotId)}>
                Take out
              </button>
            )}{' '}
            <button type="button" className="link" onClick={() => setHeld(undefined)}>
              Put down
            </button>
          </p>
        )}
        {heldSlot && !held?.drag && mayChange && (
          <SlotDetails
            key={heldSlot.id}
            r={r}
            s={heldSlot}
            onSave={(next) => {
              setHeld(undefined)
              void change([{ set: next }], [{ set: slotArgs(heldSlot) }])
            }}
          />
        )}
      </section>
      <div className="designer-body">
        {mayChange && <Palette view={view} r={r} day={day} onDay={setDay} today={today} held={held} onHold={setHeld} onTakeOut={takeOut} />}
        <section className="card designer-rack" aria-label="The rack">
          <div className="filters rack-views" role="group" aria-label="How it's drawn">
            {VIEWS.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={drawn === k} onClick={() => setDrawn(k)}>
                {label}
              </button>
            ))}
          </div>
          {drawn === 'flat' && (
            <div className="rack-sides">
              <DropSide r={r} side="front" held={held} heldModel={heldModel} mayChange={mayChange} onHold={setHeld} onPlace={place} />
              <DropSide r={r} side="rear" held={held} heldModel={heldModel} mayChange={mayChange} onHold={setHeld} onPlace={place} />
            </div>
          )}
          {drawn === '3d' && (
            <Suspense fallback={<p className="hint">Drawing it in 3D…</p>}>
              <Rack3D r={r} held={held} heldModel={heldModel} mayChange={mayChange} bad={bad} onHold={setHeld} onPlace={place} />
            </Suspense>
          )}
          {drawn === 'side' && <SideCut r={r} bad={bad} />}
          <Groups r={r} />
          <Loose r={r} held={held} mayChange={mayChange} onHold={setHeld} onPlace={place} />
        </section>
      </div>
    </div>
  )
}

/** What a new slot has unless it's said. */
const NEW_SLOT = { qty: 1, notes: '', across: 'left', label: '', group: '', colour: null, inSlotId: null } as const

const slotArgs = (s: SlotView): SlotArgs => ({
  id: s.id,
  rackId: s.rackId,
  modelId: s.modelId,
  top: s.top,
  side: s.side,
  qty: s.qty,
  notes: s.notes,
  across: s.across,
  label: s.label,
  group: s.group,
  colour: s.colour,
  inSlotId: s.inSlotId,
})

/** What's in a shelf or drawer, put back in it: taking it off the rails empties it (ADR 0079). */
const contentsOf = (r: RackView, holderId: string): Op[] => r.slots.filter((x) => x.inSlotId === holderId).map((x) => ({ set: slotArgs(x) }))

/** The shelves and drawers on a rack's rails, which loose kit can go in. */

/**
 * The details of one thing in the rack (ADR 0079), shown while it's picked
 * up: its label, group and tape colour, where it sits across the rails if
 * it's narrower than them, and for loose kit, how many and what it's in.
 */
function SlotDetails({ r, s, onSave }: { r: RackView; s: SlotView; onSave: (next: SlotArgs) => void }) {
  const [f, setF] = useState({ label: s.label, group: s.group, colour: s.colour ?? '', across: s.across, notes: s.notes, qty: String(s.qty), inSlotId: s.inSlotId ?? '' })
  const [why, setWhy] = useState('')
  const narrow = s.top !== null && acrossFor(s.model?.rackWidth).length > 0
  const holders = holdersIn(r)
  const groups = [...new Set(r.slots.map((x) => x.group).filter(Boolean))].sort()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const qty = s.top === null ? Number(f.qty) : 1
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) return setWhy('How many is a whole number from 1 to 999.')
    onSave({
      ...slotArgs(s),
      label: f.label.trim(),
      group: f.group.trim(),
      colour: (f.colour || null) as TapeColour | null,
      across: f.across,
      notes: f.notes.trim(),
      qty,
      inSlotId: s.top === null && f.inSlotId ? f.inSlotId : null,
    })
  }
  return (
    <form className="grid-form slot-details" onSubmit={submit} aria-label={`${slotName(s)} in this rack`}>
      <label>
        Label <input value={f.label} maxLength={40} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder={s.model?.name ?? 'As written on it'} />
      </label>
      <label>
        Group
        <input value={f.group} maxLength={40} list="rack-groups" onChange={(e) => setF({ ...f, group: e.target.value })} placeholder="e.g. RF, Playback" />
        <datalist id="rack-groups">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </label>
      <label>
        Tape colour
        <span className="tape-pick">
          <select value={f.colour} onChange={(e) => setF({ ...f, colour: e.target.value as TapeColour | '' })}>
            <option value="">None</option>
            {TAPE_COLOURS.map((c) => (
              <option key={c} value={c}>
                {TAPE_COLOUR_LABELS[c]}
              </option>
            ))}
          </select>
          {f.colour && <span className="tape-swatch" style={{ '--tape': TAPE_COLOUR_SWATCHES[f.colour as TapeColour] } as CSSProperties} aria-hidden="true" />}
        </span>
      </label>
      {narrow && (
        <label>
          Across the rails
          <select value={f.across} onChange={(e) => setF({ ...f, across: e.target.value as RackAcross })}>
            {acrossFor(s.model?.rackWidth).map((a) => (
              <option key={a} value={a}>
                {RACK_ACROSS_LABELS[a]}
              </option>
            ))}
          </select>
        </label>
      )}
      {s.top === null && (
        <>
          <label>
            How many <input inputMode="numeric" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
          </label>
          {holders.length > 0 && (
            <label>
              In
              <select value={f.inSlotId} onChange={(e) => setF({ ...f, inSlotId: e.target.value })}>
                <option value="">Loose in the rack</option>
                {holders.map((h) => (
                  <option key={h.id} value={h.id}>
                    {holderName(h)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      <label className="wide">
        Note <input value={f.notes} maxLength={200} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Optional, e.g. Patched to the stage box" />
      </label>
      {why && (
        <p className="alert wide" role="alert">
          {why}
        </p>
      )}
      <button type="submit" className="wide">
        Save {slotName(s)}
      </button>
    </form>
  )
}

/** The groups in the rack and their tape (ADR 0079): a key to what the colours on the panels are. */
export function Groups({ r }: { r: RackView }) {
  const groups = new Map<string, { count: number; colours: Set<TapeColour> }>()
  for (const s of r.slots) {
    if (!s.group) continue
    const g = groups.get(s.group) ?? { count: 0, colours: new Set() }
    g.count += s.qty
    if (s.colour) g.colours.add(s.colour)
    groups.set(s.group, g)
  }
  if (!groups.size) return null
  return (
    <div className="rack-groups">
      <h3>Groups</h3>
      <ul>
        {[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, g]) => (
          <li key={name}>
            {[...g.colours].map((c) => (
              <span key={c} className="tape-swatch" style={{ '--tape': TAPE_COLOUR_SWATCHES[c] } as CSSProperties} aria-hidden="true" />
            ))}
            <b>{name}</b> · {g.count === 1 ? '1 thing' : `${g.count} things`}
            {g.colours.size > 0 && `, ${[...g.colours].map((c) => TAPE_COLOUR_LABELS[c].toLowerCase()).join(' and ')} tape`}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Copy a rack (ADR 0079): a new rack product, the same size, with the same
 * layout, to build a second like it or start a variation from. Its stock
 * code is left for the new one to be given.
 */
function CopyRack({ view, r }: { view: View; r: RackView }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(`${r.model.name} (copy)`)
  const { run, error, refuse } = useAct()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    const taken = view.warehouse.models.find((m) => m.name.trim().toLowerCase() === n.toLowerCase())
    if (taken) return refuse(`There's already a product called ${taken.name}.`)
    const m = r.model
    const id = newId()
    const ids = new Map(r.slots.map((s) => [s.id, newId()]))
    void run(async () => {
      await client.mutate('model.create', {
        id,
        name: n,
        department: m.department,
        category: m.category,
        tracking: 'serialised',
        isCase: true,
        isRack: true,
        valueCents: m.valueCents,
        notes: m.notes,
        code: '',
        units: m.units,
        depthMm: m.depthMm,
        weightKg: m.weightKg,
        powerW: null,
        caseWidthMm: m.caseWidthMm,
        caseHeightMm: m.caseHeightMm,
        caseDepthMm: m.caseDepthMm,
        castors: m.castors,
        powerLimitA: m.powerLimitA,
      })
      // What's on the rails first, so a shelf or drawer is there before what goes in it.
      for (const s of r.slots)
        await client.mutate('rackSlot.set', { ...slotArgs(s), id: ids.get(s.id)!, rackId: id, inSlotId: s.inSlotId ? (ids.get(s.inSlotId) ?? null) : null })
    }).then((ok) => {
      if (ok) location.hash = `#stock/racks/${id}`
    })
  }
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Copy this rack
      </button>
    )
  return (
    <form className="copy-rack" onSubmit={submit}>
      <label>
        Name of the copy <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </label>
      <button type="submit" className="primary">
        Copy it
      </button>
      <button type="button" className="link" onClick={() => setOpen(false)}>
        Cancel
      </button>
      <Refusal error={error} />
    </form>
  )
}

/** The stock list to build from: ours, with how many are free on the day chosen, and dry hire. */
function Palette({
  view,
  r,
  day,
  onDay,
  today,
  held,
  onHold,
  onTakeOut,
}: {
  view: View
  r: RackView
  day: string
  onDay: (d: string) => void
  today: string
  held: Held | undefined
  onHold: (h: Held | undefined) => void
  onTakeOut: (slotId: string) => void
}) {
  const [typed, setTyped] = useState('')
  const [whose, setWhose] = useState<'all' | 'ours' | 'dryHire'>('all')
  // Rack-mount kit (ADR 0076) is what goes on the rails; everything else can go loose in it.
  const [mounted, setMounted] = useState(true)
  const [over, setOver] = useState(false)
  const all = view.warehouse.models.filter(
    (m) => !m.isRack && m.id !== r.model.id && (!mounted || m.rackMount) && (whose === 'all' || (whose === 'dryHire') === m.dryHire)
  )
  // Rack parts (ADR 0079) after the kit, as they're what's put in last.
  const found = typed.trim()
    ? findProducts(all, typed).map((f) => f.product)
    : [...all].sort((a, b) => (a.rackMount ? 0 : 1) - (b.rackMount ? 0 : 1) || (a.rackPart ? 1 : 0) - (b.rackPart ? 1 : 0))
  const shown = found.slice(0, 40)
  const hasParts = view.warehouse.models.some((m) => m.rackPart)
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const h = heldOf(e)
    if (h?.kind === 'slot') onTakeOut(h.slotId)
  }
  return (
    <section
      className={`card designer-palette${over ? ' over' : ''}`}
      aria-labelledby="palette-title"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE)) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <Heading icon="kit" id="palette-title">
        Kit to build with
      </Heading>
      <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Find a product or stock code" aria-label="Find kit" />
      <div className="filters" role="group" aria-label="Whose">
        {(
          [
            ['all', 'All'],
            ['ours', 'Ours'],
            ['dryHire', 'Dry hire'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={whose === k} onClick={() => setWhose(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="filters" role="group" aria-label="Which kit">
        <button type="button" aria-pressed={mounted} onClick={() => setMounted(true)}>
          Rack-mount
        </button>
        <button type="button" aria-pressed={!mounted} onClick={() => setMounted(false)}>
          Everything, to go loose
        </button>
      </div>
      <label className="free-on">
        Free on <input type="date" value={day} min={today} onChange={(e) => onDay(e.target.value || today)} />
      </label>
      <ul className="palette-list">
        {shown.map((m) => {
          const free = freeOn(view, m, day)
          const picked = held?.kind === 'new' && held.modelId === m.id
          return (
            <li key={m.id}>
              <button
                type="button"
                className="palette-item"
                draggable
                aria-pressed={picked}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, `new:${m.id}`)
                  e.dataTransfer.effectAllowed = 'copy'
                  // Held once the drag is under way, so the rack shows its size; changing the page as it starts would stop it.
                  setTimeout(() => onHold({ kind: 'new', modelId: m.id, drag: true }))
                }}
                onDragEnd={() => onHold(undefined)}
                onClick={() => onHold({ kind: 'new', modelId: m.id })}
                aria-label={`Pick up ${m.name}`}
              >
                <b>{m.name}</b>
                <small>
                  {m.rackMount
                    ? [m.rackPart && RACK_PART_LABELS[m.rackPart], m.units ? `${m.units}U` : 'No height', m.rackWidth !== 'full' && RACK_WIDTH_LABELS[m.rackWidth].toLowerCase(), m.depthMm && `${m.depthMm} mm`].filter(Boolean).join(', ')
                    : 'Goes loose'}{' '}
                  ·{' '}
                  {free === undefined ? (
                    `Dry hire${m.supplier ? ` from ${m.supplier}` : ''}`
                  ) : (
                    <span className={free === 0 ? 'none-free' : undefined}>
                      {free} free {day === today ? 'today' : `on ${dayLabel(day)}`}
                    </span>
                  )}
                </small>
              </button>
            </li>
          )
        })}
      </ul>
      {found.length > shown.length && <p className="hint">{found.length - shown.length} more: type to narrow them down.</p>}
      {found.length === 0 && (
        <p className="hint">{mounted ? 'No rack-mount kit found. Tick Rack-mount on a product to lay it out here, or show everything to put it loose.' : 'Nothing found. Add a product to the stock list first, as ours or dry hire.'}</p>
      )}
      {!hasParts && <UsualParts view={view} r={r} />}
      <p className="hint">Drag kit onto the rack, or press it and then press where it goes. Drag something out of the rack back here to take it out.</p>
    </section>
  )
}

/** The rack parts most racks are built with, to add to the stock list in one go (ADR 0079). */
const USUAL_PARTS: { name: string; part: RackPart; units: number; depthMm: number | null }[] = [
  { name: '1U blank panel', part: 'blank', units: 1, depthMm: null },
  { name: '2U blank panel', part: 'blank', units: 2, depthMm: null },
  { name: '1U vent panel', part: 'vent', units: 1, depthMm: null },
  { name: '1U rack shelf', part: 'shelf', units: 1, depthMm: 350 },
  { name: '1U rack drawer', part: 'drawer', units: 1, depthMm: 350 },
  { name: '2U rack drawer', part: 'drawer', units: 2, depthMm: 350 },
]

/**
 * Before there are any rack parts in the stock list: a press adds the
 * usual blanks, vent, shelf and drawers, counted, none in stock yet, so
 * they can be laid out and counted in when they're on the shelf.
 */
function UsualParts({ view, r }: { view: View; r: RackView }) {
  const { run, error } = useAct()
  const names = new Set(view.warehouse.models.map((m) => m.name.trim().toLowerCase()))
  const add = () =>
    void run(async () => {
      for (const p of USUAL_PARTS) {
        if (names.has(p.name.toLowerCase())) continue
        await client.mutate('model.create', {
          id: newId(),
          name: p.name,
          department: r.model.department,
          category: 'Rack parts',
          tracking: 'bulk',
          isCase: false,
          valueCents: null,
          notes: '',
          rackMount: true,
          units: p.units,
          depthMm: p.depthMm,
          rackPart: p.part,
        })
      }
    })
  return (
    <div className="usual-parts">
      <p className="hint">No blanks, vents, shelves or drawers in the stock list yet. Mark a product as one on its page, or add the usual ones.</p>
      <button type="button" onClick={add}>
        Add the usual rack parts
      </button>
      <Refusal error={error} />
    </div>
  )
}

/** One side of the rack, unit by unit, to drop on or press. */
function DropSide({
  r,
  side,
  held,
  heldModel,
  mayChange,
  onHold,
  onPlace,
}: {
  r: RackView
  side: RackSide
  held: Held | undefined
  heldModel: ModelView | undefined
  mayChange: boolean
  onHold: (h: Held | undefined) => void
  onPlace: (h: Held, top: number | null, side: RackSide, across?: RackAcross) => void
}) {
  const [hover, setHover] = useState<{ top: number; units: number; across: RackAcross }>()
  const placed = r.slots.filter((s) => s.top !== null && s.side === side)
  const size = r.model.units ?? Math.max(4, ...placed.map((s) => s.top! + (s.model?.units ?? 1) - 1))
  const bad = new Set(r.layout.problems.map((p) => p.slotId))
  // What's taken on this side, leaving out what's being moved: narrower kit only takes its part across (ADR 0079).
  const movingId = held?.kind === 'slot' ? held.slotId : undefined
  const others = placed.filter((s) => s.id !== movingId)
  const width = heldModel?.rackWidth
  const fits = (top: number, units: number, across: RackAcross) => {
    if (top + units - 1 > size) return false
    const [a, b] = spanAcross(width, across)
    return !others.some((s) => {
      const [c, d] = spanAcross(s.model?.rackWidth, s.across)
      return s.top! <= top + units - 1 && top <= s.top! + (s.model?.units ?? 1) - 1 && a < d - 1e-9 && c < b - 1e-9
    })
  }
  const unitsOf = () => heldModel?.units ?? 1
  // Where across the rails the pointer is, for kit narrower than them; the unit's number takes the first 2.2em.
  const acrossOf = (e: { clientX: number; currentTarget: HTMLElement }): RackAcross => {
    if (!acrossFor(width).length) return 'left'
    const box = e.currentTarget.getBoundingClientRect()
    const numbers = box.width * 0.12
    return e.clientX ? acrossAt((e.clientX - box.left - numbers) / (box.width - numbers), width) : 'left'
  }
  const drop = (e: DragEvent<HTMLElement>, top: number) => {
    e.preventDefault()
    setHover(undefined)
    const h = heldOf(e)
    if (h) onPlace(h, top, side, acrossOf(e))
  }
  const lit = (u: number) => hover && u >= hover.top && u < hover.top + hover.units
  return (
    <figure className={`rack-elevation designer-side${held ? ' holding-one' : ''}`} aria-label={`${RACK_SIDE_LABELS[side]} of ${r.model.name}`}>
      <figcaption>{RACK_SIDE_LABELS[side]}</figcaption>
      <div className="rack-units" style={{ gridTemplateRows: `repeat(${size}, var(--rack-u))` }} onDragLeave={() => setHover(undefined)}>
        {Array.from({ length: size }, (_, i) => {
          const u = i + 1
          return (
            <button
              key={`u${u}`}
              type="button"
              className={`rack-slot${lit(u) ? (fits(hover!.top, hover!.units, hover!.across) ? ' lit' : ' lit no-fit') : ''}`}
              style={{ gridRow: u }}
              disabled={!mayChange}
              // The same name whatever's held, which the line above the rack says, so it doesn't change under a drag.
              aria-label={`U${u} ${RACK_SIDE_LABELS[side].toLowerCase()}`}
              onClick={(e) => held && onPlace(held, u, side, acrossOf(e))}
              onMouseMove={(e) => {
                if (!held) return
                const across = acrossOf(e)
                if (hover?.top !== u || hover.across !== across) setHover({ top: u, units: unitsOf(), across })
              }}
              onMouseLeave={() => setHover(undefined)}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                e.preventDefault()
                // The size of what's dragged isn't readable until it's dropped, so a held product or one unit is shown.
                const across = acrossOf(e)
                if (hover?.top !== u || hover.across !== across) setHover({ top: u, units: unitsOf(), across })
              }}
              onDrop={(e) => drop(e, u)}
            >
              <span className="rack-u-n">{u}</span>
            </button>
          )
        })}
        {hover && acrossFor(width).length > 0 && (
          // Where narrower kit would go across, over the lit units.
          <span
            className={`rack-ghost${fits(hover.top, hover.units, hover.across) ? '' : ' no-fit'}`}
            style={thingStyle({ top: hover.top, across: hover.across, model: heldModel } as SlotView, hover.units)}
            aria-hidden="true"
          />
        )}
        {placed.map((s) => {
          const units = s.model?.units ?? 1
          const picked = movingId === s.id
          return (
            <button
              key={s.id}
              type="button"
              draggable={mayChange}
              disabled={!mayChange}
              className={`rack-thing ${thingClass(s)}${bad.has(s.id) ? ' bad' : ''}${s.pending ? ' is-pending' : ''}${s.model?.dryHire ? ' hired' : ''}${picked ? ' picked' : ''}`}
              style={thingStyle(s, units)}
              aria-pressed={picked}
              aria-label={`${slotName(s)}${s.label && s.model ? ` (${s.model.name})` : ''}, ${unitsAt(s.top!, units)}${acrossFor(s.model?.rackWidth).length ? ` ${RACK_ACROSS_LABELS[s.across].toLowerCase()}` : ''} on the ${RACK_SIDE_LABELS[side].toLowerCase()}${s.group ? `, ${s.group}` : ''}${s.colour ? `, ${TAPE_COLOUR_LABELS[s.colour].toLowerCase()} tape` : ''}${picked ? ', picked up' : ''}`}
              title={[s.model?.name, s.group, s.notes].filter(Boolean).join(' · ')}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, `slot:${s.id}`)
                e.dataTransfer.effectAllowed = 'move'
                setTimeout(() => onHold({ kind: 'slot', slotId: s.id, drag: true }))
              }}
              onDragEnd={() => onHold(undefined)}
              onClick={() => onHold({ kind: 'slot', slotId: s.id })}
            >
              {s.model?.rackPart === 'blank' && !s.label ? '' : <span className="thing-name">{slotName(s)}</span>}
              {s.model?.dryHire && <small>· dry hire</small>}
            </button>
          )
        })}
      </div>
    </figure>
  )
}

/** What's loose in the rack: cables, adaptors, spares. */
function Loose({
  r,
  held,
  mayChange,
  onHold,
  onPlace,
}: {
  r: RackView
  held: Held | undefined
  mayChange: boolean
  onHold: (h: Held | undefined) => void
  onPlace: (h: Held, top: number | null, side: RackSide) => void
}) {
  const [over, setOver] = useState(false)
  const loose = r.slots.filter((s) => s.top === null)
  // What's in each shelf and drawer (ADR 0079), then what's loose in the rack itself.
  const holders = holdersIn(r)
  const inHolder = new Set(holders.map((h) => h.id))
  const lots = (
    [
      ...holders.map((h): [string, SlotView[]] => [`In the ${holderName(h)}`, loose.filter((s) => s.inSlotId === h.id)]),
      ['Loose in the rack', loose.filter((s) => !s.inSlotId || !inHolder.has(s.inSlotId))],
    ] as [string, SlotView[]][]
  ).filter(([, list]) => list.length > 0)
  const item = (s: SlotView) => (
    <li key={s.id}>
      <button
        type="button"
        className={`palette-item ${thingClass(s)}`}
        style={s.colour ? ({ '--tape': TAPE_COLOUR_SWATCHES[s.colour] } as CSSProperties) : undefined}
        draggable={mayChange}
        disabled={!mayChange}
        aria-pressed={held?.kind === 'slot' && held.slotId === s.id}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, `slot:${s.id}`)
          setTimeout(() => onHold({ kind: 'slot', slotId: s.id, drag: true }))
        }}
        onDragEnd={() => onHold(undefined)}
        onClick={() => onHold({ kind: 'slot', slotId: s.id })}
      >
        <b>
          {s.qty > 1 && `${s.qty} × `}
          {slotName(s)}
        </b>
        {(s.model?.dryHire || s.group || (s.label && s.model)) && (
          <small>{[s.label && s.model?.name, s.group, s.model?.dryHire && 'Dry hire'].filter(Boolean).join(' · ')}</small>
        )}
      </button>
    </li>
  )
  return (
    <div
      className={`designer-loose${over ? ' over' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const h = heldOf(e)
        if (h) onPlace(h, null, 'front')
      }}
    >
      <h3>Loose in it</h3>
      {loose.length === 0 && <p className="hint">Cables, adaptors and spares that travel in it: drop them here.{holders.length ? ' Pick one up to put it in a shelf or drawer.' : ''}</p>}
      {lots.map(([title, list]) => (
        <div key={title} className="loose-lot">
          {(holders.length > 0 || lots.length > 1) && <h4>{title}</h4>}
          <ul className="palette-list">{list.map(item)}</ul>
        </div>
      ))}
      {held && mayChange && (
        <button type="button" onClick={() => onPlace(held, null, 'front')}>
          Put it loose in the rack
        </button>
      )}
    </div>
  )
}

