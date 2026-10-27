import {
  CHECK_KINDS,
  CHECK_SOON_DAYS,
  checkLabel,
  checkLine,
  checkOf,
  checksNeeded,
  checkState,
  newId,
  offRoadLine,
  ROAD_CHECKS,
  spanLabel,
  VEHICLE_KIND_LABELS,
  VEHICLE_KINDS,
  vehicleName,
  type BookingView,
  type CheckKind,
  type VehicleChecks,
  type VehicleKind,
  type VehicleView,
  type View,
} from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Fold, ShowAll } from '../Fold.tsx'
import { Heading } from '../Icon.tsx'
import { Page, Top } from '../jobs/common.tsx'
import { useAccess } from '../role.ts'
import { Pending, StatusPill } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { STOCK, VEHICLES } from '../Up.tsx'
import { useToday } from '../view.ts'
import { StockViews } from '../Views.tsx'
import { Split } from '../Split.tsx'
import './vehicles.css'

/**
 * Vans and drivers (ADR 0047): the company's vehicles on a page along
 * Stock's row (#stock/vehicles), each with a page of its own
 * (#stock/vehicles/<id>): its checks and when each runs out, whether it's
 * off the road, and the jobs it's booked on. A vehicle is booked on the
 * job's page, where the kit and crew are. Everything works with no signal,
 * like the rest of the app.
 */

export const vehicleHref = (id: string) => `#stock/vehicles/${encodeURIComponent(id)}`

/** "Van · 3 seats · 1,200 kg". */
function aboutLine(v: VehicleView): string {
  return [VEHICLE_KIND_LABELS[v.kind], v.seats !== null && `${v.seats} seat${v.seats === 1 ? '' : 's'}`, v.payloadKg !== null && `${v.payloadKg.toLocaleString('en-IE')} kg`]
    .filter(Boolean)
    .join(' · ')
}

/** The road checks run out today: what keeps it from being booked, and what the Vehicles tab counts. */
export function ranOut(v: VehicleView, today: string): CheckKind[] {
  return ROAD_CHECKS.filter((k) => {
    const c = checkOf(v, k)
    return c.needed && c.expires !== null && c.expires < today
  })
}

export function VehiclesScreen({ view }: { view: View }) {
  const today = useToday()
  const mayChange = useAccess().can('stock')
  const retired = view.vehicles.all.filter((v) => v.archived)
  return (
    <div className="app warehouse">
      <Top view={view} title="Stock" views={<StockViews view={view} current="vehicles" />} heading="Vehicles" />
      <Split side={<VehicleReminders view={view} />}>
        <section className="card" aria-label="Vehicles">
          <Heading icon="van">Vans and the rest</Heading>
          {view.vehicles.vehicles.length === 0 && <Empty>Add the vans, so they can be booked on jobs with a driver.</Empty>}
          <ul className="vehicle-list">
            {view.vehicles.vehicles.map((v) => (
              <VehicleRow key={v.id} v={v} today={today} />
            ))}
          </ul>
          {mayChange && (
            <Fold label="Add vehicle">
              <VehicleForm onDone={(id) => (location.hash = vehicleHref(id))} />
            </Fold>
          )}
          {retired.length > 0 && (
            <details className="retired">
              <summary>Retired ({retired.length})</summary>
              <ul className="vehicle-list">
                {retired.map((v) => (
                  <VehicleRow key={v.id} v={v} today={today} />
                ))}
              </ul>
            </details>
          )}
        </section>
      </Split>
    </div>
  )
}

/** One vehicle in the list: its name and registration, what it is, and what stops it or comes next. */
function VehicleRow({ v, today }: { v: VehicleView; today: string }) {
  const lapsed = ranOut(v, today)
  const next = v.bookings.find((b) => b.end >= today)
  const off = v.outOfService && (v.outOfService.until === null || v.outOfService.until >= today)
  return (
    <li>
      <a className={`vehicle-row ${lapsed.length ? 'bad' : off ? 'warn' : ''}`} href={vehicleHref(v.id)}>
        <div>
          <b>{vehicleName(v)}</b> <Pending pending={v.pending} />
          <p>{aboutLine(v)}</p>
          {lapsed.length > 0 && <p className="van-state bad">{lapsed.map((k) => checkLabel(k, v.kind)).join(', ')} run out: it can't be booked until updated.</p>}
          {off && <p className="van-state warn">{offRoadLine(v)}</p>}
          {next && (
            <p>
              Next: {next.job?.name ?? 'a job'}, {spanLabel(next)}
              {next.driver ? `, ${next.driver.name} driving` : ''}
            </p>
          )}
        </div>
        {v.archived && <StatusPill tone="cancelled">Retired</StatusPill>}
      </a>
    </li>
  )
}

/**
 * Checks run out, or running out in the next 30 days, soonest first, as
 * certificates and documents are on the Crew tab (ADR 0028, ADR 0029),
 * and listed beside them there too (Crew › People), so whoever chases
 * renewals sees all of them. Nothing while there are none. The app asks
 * nobody for anything: the vehicle's page is where the new day goes.
 */
export function VehicleReminders({ view }: { view: View }) {
  const today = useToday()
  const reminders = view.vehicles.reminders
  if (!reminders.length) return null
  return (
    <section className="card reminders" aria-label="Vehicle checks running out">
      <Heading icon="certificate">Vehicle checks running out ({reminders.length})</Heading>
      <ShowAll items={reminders} limit={3} what="checks">
        {(rows) =>
          rows.map((r) => (
            <a className={`row reminder ${r.ranOut ? 'ran-out' : 'soon'}`} key={`${r.vehicle.id} ${r.kind}`} href={vehicleHref(r.vehicle.id)}>
              <div>
                <b>{vehicleName(r.vehicle)}</b>
                <p>{checkLine(r, today)}</p>
              </div>
            </a>
          ))
        }
      </ShowAll>
      <p className="hint">
        Checks past their day or due in the next {CHECK_SOON_DAYS} days. One leaves the list once the vehicle's page says the new day. A vehicle can't be booked for days after
        its NCT or CVRT, motor tax, insurance or tachograph runs out.
      </p>
    </section>
  )
}

/** Typed days, with the check's tick, as the form holds them. */
type CheckFields = Record<CheckKind, { needed: boolean; expires: string }>

const fieldsOf = (kind: VehicleKind, checks?: VehicleChecks): CheckFields =>
  Object.fromEntries(
    CHECK_KINDS.map((k) => {
      const c = checks?.[k] ?? { needed: checksNeeded(kind)[k], expires: null }
      return [k, { needed: c.needed, expires: c.expires ?? '' }]
    })
  ) as CheckFields

/** A vehicle's details and checks, added or changed: saved whole, as a client is. */
function VehicleForm({ vehicle, onDone }: { vehicle?: VehicleView; onDone: (id: string) => void }) {
  const [f, setF] = useState({
    name: vehicle?.name ?? '',
    registration: vehicle?.registration ?? '',
    kind: vehicle?.kind ?? ('van' as VehicleKind),
    seats: vehicle?.seats?.toString() ?? '',
    payload: vehicle?.payloadKg?.toString() ?? '',
    notes: vehicle?.notes ?? '',
  })
  const [checks, setChecks] = useState<CheckFields>(fieldsOf(vehicle?.kind ?? 'van', vehicle?.checks))
  // Until someone ticks or clears one, a new vehicle's checks follow its kind: a trailer has no CVRT, a truck a tachograph.
  const [touched, setTouched] = useState(!!vehicle)
  const { run, error, refuse } = useAct()
  const number = (s: string) => (s.trim() === '' ? null : Number(s.trim().replace(/[,\s]/g, '')))
  const save = (e: FormEvent) => {
    e.preventDefault()
    const seats = number(f.seats)
    const payloadKg = number(f.payload)
    if (seats !== null && !Number.isInteger(seats)) return refuse('The seats is a whole number from 0 to 60.')
    if (payloadKg !== null && !Number.isInteger(payloadKg)) return refuse('The payload in kg is a whole number from 0 to 50,000.')
    const id = vehicle?.id ?? newId()
    void run(() =>
      client.mutate('vehicle.save', {
        id,
        name: f.name.trim(),
        registration: f.registration.trim(),
        kind: f.kind,
        seats,
        payloadKg,
        notes: f.notes.trim(),
        checks: Object.fromEntries(CHECK_KINDS.map((k) => [k, { needed: checks[k].needed, expires: checks[k].needed && checks[k].expires ? checks[k].expires : null }])),
      })
    ).then((ok) => ok && onDone(id))
  }
  return (
    <form className="grid-form vehicle-form" onSubmit={save} aria-label={vehicle ? `Change ${vehicle.name}` : 'Add a vehicle'}>
      <label>
        Name <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Big Van" required />
      </label>
      <label>
        Registration <input value={f.registration} onChange={(e) => setF({ ...f, registration: e.target.value })} placeholder="e.g. 241-D-12345" autoCapitalize="characters" />
      </label>
      <label>
        Kind
        <select
          value={f.kind}
          onChange={(e) => {
            const kind = e.target.value as VehicleKind
            setF({ ...f, kind })
            if (!touched) setChecks(fieldsOf(kind))
          }}
        >
          {VEHICLE_KINDS.map((k) => (
            <option key={k} value={k}>
              {VEHICLE_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Seats <input inputMode="numeric" value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} placeholder="With the driver's" />
      </label>
      <label>
        Payload (kg) <input inputMode="numeric" value={f.payload} onChange={(e) => setF({ ...f, payload: e.target.value })} />
      </label>
      <label className="wide">
        Notes <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. Tail lift: 500 kg at most" />
      </label>
      <fieldset className="wide checks">
        <legend>Checks, and the day each runs out</legend>
        {CHECK_KINDS.map((k) => (
          <div className="check-field" key={k}>
            <label className="tick">
              <input
                type="checkbox"
                checked={checks[k].needed}
                onChange={(e) => {
                  setTouched(true)
                  setChecks({ ...checks, [k]: { ...checks[k], needed: e.target.checked } })
                }}
              />
              {checkLabel(k, f.kind)}
            </label>
            <input
              type="date"
              aria-label={`${checkLabel(k, f.kind)} ${k === 'service' ? 'due' : 'runs out'}`}
              value={checks[k].expires}
              disabled={!checks[k].needed}
              onChange={(e) => setChecks({ ...checks, [k]: { ...checks[k], expires: e.target.value } })}
            />
          </div>
        ))}
        <p className="hint">
          Untick what this vehicle doesn't need: a light trailer has no CVRT, and only a vehicle over 3.5 tonnes has a tachograph. A check left with no day is warned about, not
          refused.
        </p>
      </fieldset>
      <Refusal error={error} className="wide" />
      <div className="actions wide">
        <button type="submit" className="primary">
          {vehicle ? 'Save vehicle' : 'Add vehicle'}
        </button>
      </div>
    </form>
  )
}

export function VehicleScreen({ view, id, bare }: { view: View; id: string; bare?: boolean }) {
  const v = view.vehicles.get(id)
  const up = { steps: [STOCK, VEHICLES], here: v?.name }
  if (!v)
    return (
      <Page view={view} title="Stock" className="warehouse" up={up} bare={bare}>
        <section className="card">
          <p className="empty">This vehicle isn't on this device. It may still be on its way: check again once it says “Up to date”.</p>
        </section>
      </Page>
    )
  return (
    <Page view={view} title="Stock" className="warehouse" up={up} bare={bare}>
      <Summary v={v} />
      <Checks v={v} />
      <Bookings v={v} />
    </Page>
  )
}

function Summary({ v }: { v: VehicleView }) {
  const today = useToday()
  const mayChange = useAccess().can('stock')
  const [doing, setDoing] = useState<'edit' | 'off' | 'retire'>()
  const { run, error } = useAct()
  const off = v.outOfService && (v.outOfService.until === null || v.outOfService.until >= today) ? v.outOfService : null
  const set = (archived: boolean) => {
    setDoing(undefined)
    void run(() => client.mutate('vehicle.archive', { id: v.id, archived }))
  }
  return (
    <section className="card">
      <header className="title">
        <h1>{v.name}</h1>
        <Pending pending={v.pending} />
        {v.archived && <StatusPill tone="cancelled">Retired</StatusPill>}
        {off && <StatusPill tone="pending">Off the road</StatusPill>}
      </header>
      <dl className="facts">
        <div>
          <dt>Registration</dt>
          <dd>{v.registration || 'Not given'}</dd>
        </div>
        <div>
          <dt>Kind</dt>
          <dd>{VEHICLE_KIND_LABELS[v.kind]}</dd>
        </div>
        <div>
          <dt>Seats</dt>
          <dd>{v.seats ?? 'Not given'}</dd>
        </div>
        <div>
          <dt>Payload</dt>
          <dd>{v.payloadKg !== null ? `${v.payloadKg.toLocaleString('en-IE')} kg` : 'Not given'}</dd>
        </div>
      </dl>
      {v.notes && <p className="notes">{v.notes}</p>}
      {off && <p className="van-state warn">{offRoadLine(v)}</p>}
      <Refusal error={error} />
      {doing === 'edit' && <VehicleForm vehicle={v} onDone={() => setDoing(undefined)} />}
      {doing === 'off' && <OffRoadForm v={v} onDone={() => setDoing(undefined)} />}
      {doing === 'retire' && (
        <Confirm question={`Retire ${v.name}? It stays on the jobs it was booked on, and can't be booked again until it's brought back.`} yes="Retire it" onYes={() => set(true)} onNo={() => setDoing(undefined)} />
      )}
      {mayChange && !doing && (
        <div className="actions">
          <button type="button" onClick={() => setDoing('edit')}>
            Change details and checks
          </button>
          {off ? (
            <button type="button" onClick={() => void run(() => client.mutate('vehicle.offRoad', { id: v.id, out: null }))}>
              Back on the road
            </button>
          ) : (
            !v.archived && (
              <button type="button" onClick={() => setDoing('off')}>
                Off the road…
              </button>
            )
          )}
          {v.archived ? (
            <button type="button" className="link" onClick={() => set(false)}>
              Bring it back
            </button>
          ) : (
            <button type="button" className="link" onClick={() => setDoing('retire')}>
              Retire vehicle
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/** In for repair, or otherwise off the road: from a day, until a day or until someone says it's back. */
function OffRoadForm({ v, onDone }: { v: VehicleView; onDone: () => void }) {
  const today = useToday()
  const [f, setF] = useState({ since: today, until: '', note: '' })
  const { run, error, refuse } = useAct()
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (f.until && f.until < f.since) return refuse("It can't be back before it goes off the road.")
    void run(() => client.mutate('vehicle.offRoad', { id: v.id, out: { since: f.since, until: f.until || null, note: f.note.trim() } })).then((ok) => ok && onDone())
  }
  return (
    <form className="grid-form" onSubmit={save} aria-label={`Take ${v.name} off the road`}>
      <label>
        Off the road from <input type="date" value={f.since} onChange={(e) => setF({ ...f, since: e.target.value })} required />
      </label>
      <label>
        Back on <input type="date" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} />
      </label>
      <label className="wide">
        Why <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. In for a new clutch" />
      </label>
      <p className="hint wide">Leave the day it's back empty if nobody knows yet. Jobs it's booked on show it, and the planner flags it.</p>
      <Refusal error={error} className="wide" />
      <div className="actions wide">
        <button type="submit" className="primary">
          Take it off the road
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** Each check and when it runs out, in the stripes inspections use (ADR 0020). */
function Checks({ v }: { v: VehicleView }) {
  const today = useToday()
  return (
    <section className="card" aria-label="Checks">
      <Heading icon="inspection">Checks</Heading>
      <ul className="due-list">
        {CHECK_KINDS.map((k) => {
          const s = checkState(checkOf(v, k), k, today)
          return (
            <li key={k} className={`due ${s.tone === 'bad' ? 'overdue' : s.tone === 'warn' ? 'soon' : checkOf(v, k).needed ? '' : 'not-needed'}`}>
              <b>{checkLabel(k, v.kind)}</b>
              <span>{s.text}</span>
            </li>
          )
        })}
      </ul>
      <p className="hint">Its NCT or CVRT, motor tax, insurance and tachograph must be in date for every day it's booked. A service overdue is only a warning.</p>
    </section>
  )
}

/** The jobs it's on from today, and the ones before folded under them. */
function Bookings({ v }: { v: VehicleView }) {
  const today = useToday()
  const coming = v.bookings.filter((b) => b.end >= today)
  const gone = v.bookings.filter((b) => b.end < today).reverse()
  return (
    <section className="card" aria-label="Booked on">
      <Heading icon="calendar">Booked on</Heading>
      {coming.length === 0 && <p className="empty">Not booked on anything coming up. Vehicles are booked on the job's page.</p>}
      {coming.map((b) => (
        <BookingLine key={b.id} b={b} />
      ))}
      {gone.length > 0 && (
        <details>
          <summary>Earlier ({gone.length})</summary>
          {gone.map((b) => (
            <BookingLine key={b.id} b={b} />
          ))}
        </details>
      )}
    </section>
  )
}

function BookingLine({ b }: { b: BookingView }) {
  return (
    <article className="van-line">
      <div>
        <a href={`#jobs/${b.projectId}`}>
          <b>{b.job?.name ?? 'A job since removed'}</b>
        </a>{' '}
        <Pending pending={b.pending} />
        <p>
          {b.phase ? b.phase.name : 'Whole job'} · {spanLabel(b)}
          {b.driver ? ` · ${b.driver.name} driving` : ''}
          {b.hold === 'pencilled' ? ' · pencilled in' : ''}
        </p>
        {b.notes && <p>{b.notes}</p>}
      </div>
      {b.problems
        .filter((p) => p.tone !== 'quiet')
        .map((p) => (
          <p key={p.text} className={`van-state ${p.tone}`}>
            {p.text}
          </p>
        ))}
    </article>
  )
}

