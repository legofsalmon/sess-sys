import {
  dayLabel,
  findProducts,
  newId,
  RACK_SIDE_LABELS,
  unitsAt,
  type ModelView,
  type RackSide,
  type RackView,
  type SlotView,
  type View,
} from '@sh/shared'
import { useEffect, useState, type DragEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Heading } from '../Icon.tsx'
import { Page } from '../jobs/common.tsx'
import { useAccess } from '../role.ts'
import { client } from '../sync.ts'
import { RACKS, STOCK } from '../Up.tsx'
import { useToday } from '../view.ts'
import { LayoutTotals, sizeLabel } from './Racks.tsx'

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

/** What's picked up: a product from the list, or a thing already in the rack. */
type Held = ({ kind: 'new'; modelId: string } | { kind: 'slot'; slotId: string }) & {
  /** Picked up by dragging, which needs no line telling how to put it down. */
  drag?: true
}

const DRAG_TYPE = 'application/x-sh-rack'
const heldOf = (e: DragEvent): Held | undefined => {
  const raw = e.dataTransfer.getData(DRAG_TYPE)
  if (!raw) return undefined
  const [kind, id] = raw.split(':')
  return kind === 'new' ? { kind, modelId: id! } : kind === 'slot' ? { kind, slotId: id! } : undefined
}

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

function Designer({ view, r }: { view: View; r: RackView }) {
  const mayChange = useAccess().can('stock')
  const today = useToday()
  const [day, setDay] = useState(today)
  const [held, setHeld] = useState<Held>()
  const { run, error, refuse } = useAct()
  const models = new Map(view.warehouse.models.map((m) => [m.id, m]))
  const heldModel = held ? (held.kind === 'new' ? models.get(held.modelId) : r.slots.find((s) => s.id === held.slotId)?.model) : undefined

  // Escape puts down what's picked up.
  useEffect(() => {
    if (!held) return
    const off = (e: KeyboardEvent) => e.key === 'Escape' && setHeld(undefined)
    addEventListener('keydown', off)
    return () => removeEventListener('keydown', off)
  }, [held])

  const place = (h: Held, top: number | null, side: RackSide) => {
    setHeld(undefined)
    if (h.kind === 'new') {
      const m = models.get(h.modelId)
      if (!m) return refuse('That product is no longer in the stock list.')
      void run(() => client.mutate('rackSlot.set', { id: newId(), rackId: r.model.id, modelId: m.id, top, side, qty: 1, notes: '' }))
      return
    }
    const s = r.slots.find((x) => x.id === h.slotId)
    if (!s) return
    // Loose kit put on the rails goes one at a time; the rest stay loose.
    if (top !== null && s.top === null && s.qty > 1) {
      void run(async () => {
        await client.mutate('rackSlot.set', { ...slotArgs(s), qty: s.qty - 1 })
        await client.mutate('rackSlot.set', { id: newId(), rackId: r.model.id, modelId: s.modelId, top, side, qty: 1, notes: '' })
      })
      return
    }
    if (s.top === top && s.side === side) return
    void run(() => client.mutate('rackSlot.set', { ...slotArgs(s), top, side }))
  }
  const takeOut = (slotId: string) => {
    setHeld(undefined)
    void run(() => client.mutate('rackSlot.remove', { id: slotId }))
  }

  return (
    <div className="rack-designer">
      <section className="card designer-head" aria-labelledby="designer-title">
        <h1 id="designer-title">{r.model.name}</h1>
        <p className="rack-totals">{[r.model.code, sizeLabel(r.model) || 'No size given yet: give its rack units on its page'].filter(Boolean).join(' · ')}</p>
        <LayoutTotals r={r} />
        <Refusal error={error} />
        {/* Not while dragging: the line coming in would move the rack out from under the pointer. */}
        {held && heldModel && !held.drag && (
          <p className="holding" role="status">
            Holding {heldModel.name}. Press where it goes{held.kind === 'slot' ? ', or Take out' : ''}.{' '}
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
      </section>
      <div className="designer-body">
        {mayChange && <Palette view={view} r={r} day={day} onDay={setDay} today={today} held={held} onHold={setHeld} onTakeOut={takeOut} />}
        <section className="card designer-rack" aria-label="The rack">
          <div className="rack-sides">
            <DropSide r={r} side="front" held={held} heldModel={heldModel} mayChange={mayChange} onHold={setHeld} onPlace={place} />
            <DropSide r={r} side="rear" held={held} heldModel={heldModel} mayChange={mayChange} onHold={setHeld} onPlace={place} />
          </div>
          <Loose r={r} held={held} mayChange={mayChange} onHold={setHeld} onPlace={place} />
        </section>
      </div>
    </div>
  )
}

const slotArgs = (s: SlotView) => ({ id: s.id, rackId: s.rackId, modelId: s.modelId, top: s.top, side: s.side, qty: s.qty, notes: s.notes })

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
  const [over, setOver] = useState(false)
  // Anything but a rack; what has a height in a rack first, as that's what goes on the rails.
  const all = view.warehouse.models.filter((m) => !m.isRack && m.id !== r.model.id && (whose === 'all' || (whose === 'dryHire') === m.dryHire))
  const found = typed.trim() ? findProducts(all, typed).map((f) => f.product) : [...all].sort((a, b) => (a.units === null ? 1 : 0) - (b.units === null ? 1 : 0))
  const shown = found.slice(0, 40)
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
                  {[m.units ? `${m.units}U` : 'No height', m.depthMm && `${m.depthMm} mm`].filter(Boolean).join(', ')} ·{' '}
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
      {found.length === 0 && <p className="hint">Nothing found. Add a product to the stock list first, as ours or dry hire.</p>}
      <p className="hint">Drag kit onto the rack, or press it and then press where it goes. Drag something out of the rack back here to take it out.</p>
    </section>
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
  onPlace: (h: Held, top: number | null, side: RackSide) => void
}) {
  const [hover, setHover] = useState<{ top: number; units: number }>()
  const placed = r.slots.filter((s) => s.top !== null && s.side === side)
  const size = r.model.units ?? Math.max(4, ...placed.map((s) => s.top! + (s.model?.units ?? 1) - 1))
  const bad = new Set(r.layout.problems.map((p) => p.slotId))
  // What a unit is taken by on this side, leaving out what's being moved.
  const movingId = held?.kind === 'slot' ? held.slotId : undefined
  const takenBy = new Map<number, SlotView>()
  for (const s of placed) if (s.id !== movingId) for (let u = 0; u < (s.model?.units ?? 1); u++) takenBy.set(s.top! + u, s)
  const fits = (top: number, units: number) => top + units - 1 <= size && ![...Array(units).keys()].some((k) => takenBy.has(top + k))
  const unitsOf = (h: Held | undefined) => (h?.kind === 'new' ? heldModel?.units : heldModel?.units) ?? 1
  const drop = (e: DragEvent, top: number) => {
    e.preventDefault()
    setHover(undefined)
    const h = heldOf(e)
    if (h) onPlace(h, top, side)
  }
  return (
    <figure className={`rack-elevation designer-side${held ? ' holding-one' : ''}`} aria-label={`${RACK_SIDE_LABELS[side]} of ${r.model.name}`}>
      <figcaption>{RACK_SIDE_LABELS[side]}</figcaption>
      <div className="rack-units" style={{ gridTemplateRows: `repeat(${size}, var(--rack-u))` }} onDragLeave={() => setHover(undefined)}>
        {Array.from({ length: size }, (_, i) => {
          const u = i + 1
          const lit = hover && u >= hover.top && u < hover.top + hover.units
          return (
            <button
              key={`u${u}`}
              type="button"
              className={`rack-slot${lit ? (fits(hover.top, hover.units) ? ' lit' : ' lit no-fit') : ''}`}
              style={{ gridRow: u }}
              disabled={!mayChange}
              // The same name whatever's held, which the line above the rack says, so it doesn't change under a drag.
              aria-label={`U${u} ${RACK_SIDE_LABELS[side].toLowerCase()}`}
              onClick={() => held && onPlace(held, u, side)}
              onMouseEnter={() => held && setHover({ top: u, units: unitsOf(held) })}
              onMouseLeave={() => setHover(undefined)}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                e.preventDefault()
                // The size of what's dragged isn't readable until it's dropped, so a held product or one unit is shown.
                if (hover?.top !== u) setHover({ top: u, units: unitsOf(held) })
              }}
              onDrop={(e) => drop(e, u)}
            >
              <span className="rack-u-n">{u}</span>
            </button>
          )
        })}
        {placed.map((s) => {
          const units = s.model?.units ?? 1
          const picked = movingId === s.id
          return (
            <button
              key={s.id}
              type="button"
              draggable={mayChange}
              disabled={!mayChange}
              className={`rack-thing${bad.has(s.id) ? ' bad' : ''}${s.pending ? ' is-pending' : ''}${s.model?.dryHire ? ' hired' : ''}${picked ? ' picked' : ''}`}
              style={{ gridRow: `${s.top} / span ${units}` }}
              aria-pressed={picked}
              aria-label={`${s.model?.name ?? 'Something'}, ${unitsAt(s.top!, units)} on the ${RACK_SIDE_LABELS[side].toLowerCase()}${picked ? ', picked up' : ''}`}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, `slot:${s.id}`)
                e.dataTransfer.effectAllowed = 'move'
                setTimeout(() => onHold({ kind: 'slot', slotId: s.id, drag: true }))
              }}
              onDragEnd={() => onHold(undefined)}
              onClick={() => onHold({ kind: 'slot', slotId: s.id })}
            >
              {s.model?.name ?? '?'}
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
      {loose.length === 0 && <p className="hint">Cables, adaptors and spares that travel in it: drop them here.</p>}
      <ul className="palette-list">
        {loose.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className="palette-item"
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
                {s.model?.name ?? '?'}
              </b>
              {s.model?.dryHire && <small>Dry hire</small>}
            </button>
          </li>
        ))}
      </ul>
      {held && mayChange && (
        <button type="button" onClick={() => onPlace(held, null, 'front')}>
          Put it loose in the rack
        </button>
      )}
    </div>
  )
}

