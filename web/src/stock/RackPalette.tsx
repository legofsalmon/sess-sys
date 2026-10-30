import { dayLabel, findProducts, newId, RACK_PART_LABELS, RACK_WIDTH_LABELS, type ModelView, type RackPart, type RackView, type View } from '@sh/shared'
import { useState, type DragEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Heading } from '../Icon.tsx'
import { client } from '../sync.ts'
import { DRAG_TYPE, heldOf, type Held } from './rack-drag.ts'

/**
 * The rack designer's stock list (ADR 0075): ours, with how many are free on
 * a day, dry hire, and the usual rack parts to add.
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

/** The stock list to build from: ours, with how many are free on the day chosen, and dry hire. */
export function Palette({
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
