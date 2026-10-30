import { lineCents, money, type JobChanges, RATE_UNIT, type Package, FUEL_PRICE_FRESH_DAYS, type Extras, VEHICLE_KIND_LABELS } from '@sh/shared'
import { useId, useState } from 'react'
import { toDraft, type LineDraft } from './lineDraft.ts'

/**
 * What's added to a draft quote beside its kit and crew (ADR 0042, ADR
 * 0086): the crew's travel and subsistence, transport, a package, crew, and
 * what's changed on the job since.
 */

/** Days since a day, for how old the fuel price is. */
const daysSince = (from: string, today: string) => Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)

/**
 * The crew's travel and subsistence (ADR 0086), worked out by the quote: the lines it comes to, or why there isn't one,
 * with the two things the office says about this job: the distance, if the map's is wrong, and whether the job gives
 * the crew their meals.
 */
export function TravelAndSubsistence(p: { extras: Extras; meals: boolean; setMeals: (b: boolean) => void; km: string; setKm: (s: string) => void; fuelSetOn: string | null; today: string }) {
  const { travel, subsistence, lines } = p.extras
  const line = (extra: 'travel' | 'subsistence') => lines.find((l) => l.extra === extra)
  const t = line('travel')
  const s = line('subsistence')
  const old = t && p.fuelSetOn && daysSince(p.fuelSetOn, p.today) > FUEL_PRICE_FRESH_DAYS
  return (
    <fieldset className="quote-group quote-extras">
      <legend>Travel and subsistence</legend>
      <div className="quote-extra">
        <div className="extra-line">
          <span className="what">{t ? t.what : 'No travel'}</span>
          <span className="how">{t ? `${t.qty} × ${money(t.unitCents)}, a car's fuel there and back` : travel.none}</span>
          <span className="amount">{t ? money(lineCents(t)) : '–'}</span>
        </div>
        <label className="field extra-km">
          Distance each way
          <span className="with-unit">
            <input inputMode="numeric" value={p.km} onChange={(e) => p.setKm(e.target.value)} placeholder={travel.from === 'none' ? 'km' : String(travel.km)} aria-label="Distance each way from Dublin city centre, km" />
            km
          </span>
          <small>
            {p.km.trim()
              ? 'As typed. Clear it to take it from the map again.'
              : travel.from === 'map'
                ? "From the venue's pin, a fifth more than a straight line for the roads. Type the real distance if it's out."
                : 'From Dublin city centre to the venue.'}
          </small>
        </label>
        {old && <p className="warn-line">The fuel price was set {daysSince(p.fuelSetOn!, p.today)} days ago. Check it in Admin › Company.</p>}
      </div>
      <div className="quote-extra">
        <div className="extra-line">
          <span className="what">{s ? s.what : 'No subsistence'}</span>
          <span className="how">{s ? `${s.qty} × ${money(s.unitCents)} a day` : subsistence.none}</span>
          <span className="amount">{s ? money(lineCents(s)) : '–'}</span>
        </div>
        <label className="signal">
          <input type="checkbox" role="switch" checked={p.meals} onChange={(e) => p.setMeals(e.target.checked)} />
          <span>
            <b>Meals provided</b>
            <small>{p.meals ? 'The job gives the crew their meals, so no subsistence is charged.' : 'On if the job gives the crew their meals.'}</small>
          </span>
        </label>
      </div>
      <p className="hint">Worked out from the crew lines, the venue and Admin's rates, and kept up to date as they change.</p>
    </fieldset>
  )
}

/** "Van and driver", "Luton": how a vehicle reads on a quote. */
export const transportWords = (kind: keyof typeof VEHICLE_KIND_LABELS, driver: boolean) => `${kind === 'luton' ? 'Luton van' : VEHICLE_KIND_LABELS[kind]}${driver ? ' and driver' : ''}`

/** Transport to add (ADR 0089): one of the vans booked on the job, or transport typed. */
export function AddTransport({ vans, onAdd, onCancel }: { vans: { id: string; what: string; name: string }[]; onAdd: (what: string, ref: string | null) => void; onCancel: () => void }) {
  const [chosen, setChosen] = useState(vans[0]?.id ?? '')
  const van = vans.find((v) => v.id === chosen)
  return (
    <div className="adding">
      <label className="field">
        Transport to add
        <select value={chosen} onChange={(e) => setChosen(e.target.value)} autoFocus>
          {vans.map((v) => (
            <option key={v.id} value={v.id}>
              {v.what}: {v.name}
            </option>
          ))}
          <option value="">Transport, typed</option>
        </select>
        <small>Charged once, with what it costs us beside it, which isn't printed.</small>
      </label>
      <button type="button" onClick={() => onAdd(van ? van.what : 'Transport', van ? van.id : null)}>
        Add
      </button>
      <button type="button" className="link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

/** A package from the price list to add (ADR 0087). */
export function AddPackage({ packages, onAdd, onCancel }: { packages: readonly Package[]; onAdd: (id: string) => void; onCancel: () => void }) {
  const [chosen, setChosen] = useState(packages[0]?.id ?? '')
  return (
    <div className="adding">
      <label className="field">
        Package to add
        <select value={chosen} onChange={(e) => setChosen(e.target.value)} autoFocus>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}, {money(p.dayCents)} a {RATE_UNIT[p.rate ?? 'daily']}
            </option>
          ))}
        </select>
        <small>At its price on the price list, for the job's days, with what it holds printed under it.</small>
      </label>
      <button type="button" onClick={() => onAdd(chosen)} disabled={!chosen}>
        Add
      </button>
      <button type="button" className="link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

/** A crew role to add: one already priced or asked for, or one typed. */
export function AddCrew({ roles, onAdd, onCancel }: { roles: readonly string[]; onAdd: (role: string) => void; onCancel: () => void }) {
  const [typed, setTyped] = useState('')
  const listId = useId()
  const add = () => typed.trim() && onAdd(typed.trim().replace(/\s+/g, ' '))
  return (
    <div className="adding">
      <label className="field">
        Crew role to add
        <input
          list={listId}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="Audio tech"
          maxLength={100}
          autoFocus
        />
        <small>Priced from the price list, for the job's days.</small>
      </label>
      <datalist id={listId}>
        {roles.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <button type="button" onClick={add} disabled={!typed.trim()}>
        Add
      </button>
      <button type="button" className="link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

/**
 * The job's kit and crew since the quote was built from them: what's new on the job, what's gone, and how many have
 * changed, to take in with one press. "Leave it as it is" hides these until the job changes again, on this device.
 */
export function JobChangesCard({ changes, quoteId, onTake }: { changes: JobChanges; quoteId: string; onTake: (next: (ls: LineDraft[]) => LineDraft[]) => void }) {
  const { added, gone, changed } = changes
  const print = JSON.stringify([added.map((l) => l.ref), gone.map((l) => l.id), changed.map((c) => [c.line.id, c.qty])])
  const storeKey = `sh.quoteLeft.${quoteId}`
  const [left, setLeft] = useState(() => {
    try {
      return localStorage.getItem(storeKey)
    } catch {
      return null
    }
  })
  if (added.length + gone.length + changed.length === 0 || left === print) return null
  const take = () =>
    onTake((ls) => [
      ...ls
        .filter((l) => !gone.some((g) => g.id === l.id))
        .map((l) => {
          const c = changed.find((x) => x.line.id === l.id)
          return c ? { ...l, qty: String(c.qty) } : l
        }),
      ...added.map(toDraft),
    ])
  const leave = () => {
    setLeft(print)
    try {
      localStorage.setItem(storeKey, print)
    } catch {
      // Only for this visit, then.
    }
  }
  return (
    <section className="job-changes attention" aria-label="The job has changed">
      <p>
        <b>The job has changed since this quote was built.</b>
      </p>
      <ul>
        {added.map((l) => (
          <li key={l.id}>New on the job: {l.qty} × {l.what}</li>
        ))}
        {changed.map((c) => (
          <li key={c.line.id}>
            {c.line.what}: {c.qty} on the job, {c.line.qty} on the quote
          </li>
        ))}
        {gone.map((l) => (
          <li key={l.id}>No longer on the job: {l.what}</li>
        ))}
      </ul>
      <div className="actions">
        <button type="button" className="primary" onClick={take}>
          Update the quote
        </button>
        <button type="button" className="link" onClick={leave}>
          Leave it as it is
        </button>
      </div>
    </section>
  )
}
