import {
  blanksFor,
  gapsOf,
  newId,
  type RackAcross,
  type RackSide,
  type RackView,
  type View,
} from '@sh/shared'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { lazyPart } from '../lazyPart.tsx'
import { Page } from '../jobs/common.tsx'
import { useAccess } from '../role.ts'
import { client } from '../sync.ts'
import { RACKS, STOCK } from '../Up.tsx'
import { useToday } from '../view.ts'
import type { Held } from './rack-drag.ts'
import { GUESS_KIT_DEPTH, RACK_U, rackSize } from './rack-size.ts'
import { LayoutTotals, sizeLabel } from './Racks.tsx'
import { PrintRackSheet } from './RackSheet.tsx'
import { contentsOf, Groups, NEW_SLOT, slotArgs, SlotDetails, type Op } from './RackSlots.tsx'
import { Palette } from './RackPalette.tsx'
import { DropSide, Loose } from './RackDrop.tsx'

export { Groups } from './RackSlots.tsx'

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

// The 3D drawing (ADR 0076) and three.js come down only when it's first shown, and are kept from then (lazyPart.tsx).
const Rack3D = lazyPart(() => import('./Rack3D.tsx'))

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
            <Rack3D
              r={r}
              held={held}
              heldModel={heldModel}
              mayChange={mayChange}
              bad={bad}
              onHold={setHeld}
              onPlace={place}
              waiting={<p className="hint">Drawing it in 3D…</p>}
              missing={<p className="hint">The 3D drawing comes with signal: it hasn't been opened on this phone before. Front and back, and From the side, work without.</p>}
            />
          )}
          {drawn === 'side' && <SideCut r={r} bad={bad} />}
          <Groups r={r} />
          <Loose r={r} held={held} mayChange={mayChange} onHold={setHeld} onPlace={place} />
        </section>
      </div>
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
