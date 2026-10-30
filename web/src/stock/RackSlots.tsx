import {
  acrossFor,
  RACK_ACROSS_LABELS,
  TAPE_COLOUR_LABELS,
  TAPE_COLOUR_SWATCHES,
  TAPE_COLOURS,
  type CommandArgs,
  type RackAcross,
  type RackView,
  type SlotView,
  type TapeColour,
} from '@sh/shared'
import { useState, type CSSProperties, type FormEvent } from 'react'
import { holderName, holdersIn, slotName } from './rack-look.ts'

/**
 * The things in a rack designer's layout (ADR 0075, ADR 0079): one change to
 * a slot and how it's taken back, a slot's details, and the key to its
 * groups.
 */

export type SlotArgs = CommandArgs<'rackSlot.set'>
/** One change to a layout, as the designer makes it and takes it back (ADR 0079). */
export type Op = { set: SlotArgs } | { remove: string }

/** What a new slot has unless it's said. */
export const NEW_SLOT = { qty: 1, notes: '', across: 'left', label: '', group: '', colour: null, inSlotId: null } as const

export const slotArgs = (s: SlotView): SlotArgs => ({
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
export const contentsOf = (r: RackView, holderId: string): Op[] => r.slots.filter((x) => x.inSlotId === holderId).map((x) => ({ set: slotArgs(x) }))

/** The shelves and drawers on a rack's rails, which loose kit can go in. */

/**
 * The details of one thing in the rack (ADR 0079), shown while it's picked
 * up: its label, group and tape colour, where it sits across the rails if
 * it's narrower than them, and for loose kit, how many and what it's in.
 */
export function SlotDetails({ r, s, onSave }: { r: RackView; s: SlotView; onSave: (next: SlotArgs) => void }) {
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
