import {
  acrossAt,
  acrossFor,
  RACK_ACROSS_LABELS,
  RACK_SIDE_LABELS,
  spanAcross,
  TAPE_COLOUR_LABELS,
  TAPE_COLOUR_SWATCHES,
  unitsAt,
  type ModelView,
  type RackAcross,
  type RackSide,
  type RackView,
  type SlotView,
} from '@sh/shared'
import { useState, type CSSProperties, type DragEvent } from 'react'
import { DRAG_TYPE, heldOf, type Held } from './rack-drag.ts'
import { holderName, holdersIn, slotName, thingClass, thingStyle } from './rack-look.ts'

/**
 * The rack in the designer (ADR 0075): each side unit by unit, and what's
 * loose in it, to drop kit on or press.
 */

/** One side of the rack, unit by unit, to drop on or press. */
export function DropSide({
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
export function Loose({
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
