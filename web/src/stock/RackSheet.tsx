import { acrossFor, RACK_ACROSS_LABELS, RACK_SIDE_LABELS, TAPE_COLOUR_LABELS, TAPE_COLOUR_SWATCHES, unitsAt, type RackView, type SlotView } from '@sh/shared'
import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Groups } from './RackDesigner.tsx'
import { holderName, holdersIn } from './rack-look.ts'
import { caseLabel, Elevation, LayoutTotals, sizeLabel } from './Racks.tsx'

/**
 * A rack's sheet on paper (ADR 0083): to build it from in the warehouse and
 * to tape inside its lid. The rack front and back as it's laid out, then
 * what goes where in words, top to bottom (label, product, group, tape and
 * notes), what's loose in it and in which drawer, and its weight, power and
 * what won't fit. Black on white whatever the screen's theme; the tape
 * colours and photos print as they show, being what crew match against.
 */

const today = () => new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' })

/** Where a thing sits, in words: "U3–4 front, left". */
const placeOf = (s: SlotView) =>
  `${unitsAt(s.top!, s.model?.units ?? 1)} ${RACK_SIDE_LABELS[s.side].toLowerCase()}${acrossFor(s.model?.rackWidth).length ? `, ${RACK_ACROSS_LABELS[s.across].toLowerCase()}` : ''}`

function Tape({ s }: { s: SlotView }) {
  if (!s.colour) return null
  return (
    <>
      <span className="tape-swatch" style={{ '--tape': TAPE_COLOUR_SWATCHES[s.colour] } as CSSProperties} aria-hidden="true" />
      {TAPE_COLOUR_LABELS[s.colour]}
    </>
  )
}

function What({ s }: { s: SlotView }) {
  const name = s.model?.name ?? 'A product no longer listed'
  return (
    <>
      {s.label ? (
        <>
          <b>{s.label}</b> ({name})
        </>
      ) : (
        <b>{name}</b>
      )}
      {s.model?.dryHire && ` · dry hire${s.model.supplier ? ` from ${s.model.supplier}` : ''}`}
    </>
  )
}

export function RackSheet({ r }: { r: RackView }) {
  const onRails = r.slots.filter((s) => s.top !== null).sort((a, b) => a.top! - b.top! || a.side.localeCompare(b.side) || a.across.localeCompare(b.across))
  const loose = r.slots.filter((s) => s.top === null)
  const holders = holdersIn(r)
  const inHolder = new Set(holders.map((h) => h.id))
  const lots = [
    ...holders.map((h): [string, SlotView[]] => [`In the ${holderName(h)}`, loose.filter((s) => s.inSlotId === h.id)]),
    ['Loose in the rack', loose.filter((s) => !s.inSlotId || !inHolder.has(s.inSlotId))] as [string, SlotView[]],
  ].filter(([, list]) => list.length > 0)
  const facts = [r.model.code, sizeLabel(r.model), caseLabel(r.model)].filter(Boolean)
  return (
    <div className="print-sheet rack-sheet warehouse">
      <header>
        <p className="kicker">Rack sheet · printed {today()}</p>
        <h1>{r.model.name}</h1>
        {facts.length > 0 && <p>{facts.join(' · ')}</p>}
        <LayoutTotals r={r} />
      </header>
      <div className="rack-sides">
        <Elevation r={r} side="front" />
        <Elevation r={r} side="rear" />
      </div>
      <Groups r={r} />
      {onRails.length > 0 && (
        <section>
          <h2>On the rails, top to bottom</h2>
          <table className="rack-sheet-table">
            <thead>
              <tr>
                <th scope="col">Where</th>
                <th scope="col">What</th>
                <th scope="col">Group</th>
                <th scope="col">Tape</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {onRails.map((s) => (
                <tr key={s.id}>
                  <td className="nowrap">{placeOf(s)}</td>
                  <td>
                    <What s={s} />
                  </td>
                  <td>{s.group}</td>
                  <td>
                    <Tape s={s} />
                  </td>
                  <td>{s.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {lots.map(([title, list]) => (
        <section key={title}>
          <h2>{title}</h2>
          <table className="rack-sheet-table">
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td className="nowrap">{s.qty.toLocaleString('en-IE')} ×</td>
                  <td>
                    <What s={s} />
                  </td>
                  <td>{s.group}</td>
                  <td>
                    <Tape s={s} />
                  </td>
                  <td>{s.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {r.model.notes && <p className="notes">{r.model.notes}</p>}
    </div>
  )
}

/** The button that prints it, with the sheet put on the page only while it prints. */
export function PrintRackSheet({ r }: { r: RackView }) {
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(false)
    addEventListener('afterprint', done)
    // Once the sheet is on the page.
    const frame = requestAnimationFrame(() => print())
    return () => {
      cancelAnimationFrame(frame)
      removeEventListener('afterprint', done)
    }
  }, [printing])
  return (
    <>
      <button type="button" onClick={() => setPrinting(true)} disabled={printing || r.slots.length === 0}>
        Print the rack sheet
      </button>
      {printing && createPortal(<RackSheet r={r} />, document.body)}
    </>
  )
}
