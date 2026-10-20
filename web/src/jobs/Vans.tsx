import {
  driverRefusal,
  driverUnknowns,
  firstName,
  newId,
  offRoadOn,
  spanLabel,
  STOPPED,
  vehicleName,
  vehicleRefusal,
  type BookingView,
  type JobView,
  type PersonView,
  type VehicleView,
  type View,
} from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Fold } from '../Fold.tsx'
import { Heading } from '../Icon.tsx'
import { useAccess } from '../role.ts'
import { Pending } from '../StatusPill.tsx'
import { vehicleHref } from '../stock/Vehicles.tsx'
import '../stock/vehicles.css'
import { client } from '../sync.ts'
import { useToday } from '../view.ts'

/**
 * A job's vehicles (ADR 0047): which van goes, on which days, and who
 * drives it, for a gig or an errand alike. Each booking says what's wrong
 * with it in words, worst first: a check run out, another job on the same
 * van that day, the van off the road, a driver with no licence or one not
 * recorded. A road check run out or a driver who can't drive is refused
 * here before anything is sent, as the server would; a clash or a day off
 * the road asks first, and is booked anyway if the office says so.
 */

export function VansCard({ job, view }: { job: JobView; view: View }) {
  const bookings = view.vehicles.ofJob(job.id)
  const mayBook = useAccess().can('kit')
  const stopped = STOPPED.includes(job.status)
  return (
    <section className="card vans" aria-label="Vehicles">
      <Heading icon="van">Vehicles</Heading>
      {stopped && bookings.length > 0 && <p className="hint">This job is {job.status}, so its vehicles are free for other jobs.</p>}
      {bookings.length === 0 && <Empty>Book a van for the job, or for one phase of it, with a driver from the crew.</Empty>}
      {bookings.map((b) => (
        <Booking key={b.id} b={b} job={job} view={view} mayBook={mayBook} />
      ))}
      {mayBook &&
        !stopped &&
        (view.vehicles.vehicles.length === 0 ? (
          <p className="hint">
            No vehicles yet: add them on <a href="#stock/vehicles">Stock › Vehicles</a>.
          </p>
        ) : !job.span ? (
          <p className="empty">Add a phase first, so the van has days.</p>
        ) : (
          <Fold label="Book a vehicle">
            <BookingForm job={job} view={view} />
          </Fold>
        ))}
    </section>
  )
}

function Booking({ b, job, view, mayBook }: { b: BookingView; job: JobView; view: View; mayBook: boolean }) {
  const [doing, setDoing] = useState<'edit' | 'remove'>()
  const { run, error } = useAct()
  const name = b.vehicle ? vehicleName(b.vehicle) : 'A vehicle since removed'
  return (
    <article className="van-line">
      <div>
        {b.vehicle ? (
          <a href={vehicleHref(b.vehicle.id)}>
            <b>{name}</b>
          </a>
        ) : (
          <b>{name}</b>
        )}{' '}
        <Pending pending={b.pending} />
        <p>
          {b.phaseId ? (b.phase?.name ?? 'A phase since removed') : 'Whole job'} · {spanLabel(b)}
          {b.driver ? ` · ${b.driver.name} driving` : ''}
        </p>
        {b.notes && <p>{b.notes}</p>}
      </div>
      {b.problems.map((p) => (
        <p key={p.text} className={`van-state ${p.tone}`}>
          {p.text}
        </p>
      ))}
      <Refusal error={error} />
      {doing === 'edit' && <BookingForm job={job} view={view} booking={b} onDone={() => setDoing(undefined)} />}
      {doing === 'remove' && (
        <Confirm
          question={`Take ${b.vehicle?.name ?? 'this vehicle'} off ${job.name}? It's free for other jobs on those days again.`}
          yes="Take it off"
          onYes={() => {
            setDoing(undefined)
            void run(() => client.mutate('vehicleBooking.remove', { id: b.id }))
          }}
          onNo={() => setDoing(undefined)}
        />
      )}
      {mayBook && !doing && (
        <div className="actions">
          <button type="button" className="link" onClick={() => setDoing('edit')}>
            Change
          </button>
          <button type="button" className="link" onClick={() => setDoing('remove')}>
            Remove
          </button>
        </div>
      )}
    </article>
  )
}

/** "Big Van (241-XX-101): on Harbour Lights then" for a choice that clashes, so the clash is seen while choosing. */
function vehicleChoice(v: VehicleView, start: string, end: string, today: string, view: View, except?: string): { label: string; refused: string | null } {
  const refused = vehicleRefusal(v, start, end, today)
  if (refused) return { label: `${vehicleName(v)}: can't be booked then`, refused }
  const clash = view.vehicles.clashesWith(v.id, start, end, except).find((c) => c.booking.end >= today)
  if (clash) return { label: `${vehicleName(v)}: on ${clash.booking.job?.name ?? 'another job'} then`, refused: null }
  if (offRoadOn(v, start, end, today)) return { label: `${vehicleName(v)}: off the road then`, refused: null }
  return { label: vehicleName(v), refused: null }
}

/** Who can drive these days, grouped: licence in date, licence not recorded, and those who can't, shown but not chosen. */
function driverGroups(people: readonly PersonView[], start: string, end: string, today: string) {
  const ok: PersonView[] = []
  const unknown: PersonView[] = []
  const no: { p: PersonView; why: string }[] = []
  for (const p of people) {
    if (p.archived) continue
    const refused = driverRefusal(p, start, end, today)
    if (refused) no.push({ p, why: refused })
    else if (driverUnknowns(p, start, end, today).length) unknown.push(p)
    else ok.push(p)
  }
  return { ok, unknown, no }
}

/** Book a vehicle on the job, or change a booking: the whole job or a phase, its days, the driver and a note. */
function BookingForm({ job, view, booking, onDone }: { job: JobView; view: View; booking?: BookingView; onDone?: () => void }) {
  const today = useToday()
  const spanOf = (phaseId: string) => (phaseId ? job.phases.find((p) => p.id === phaseId) : job.span) ?? job.span ?? { start: today, end: today }
  const [f, setF] = useState(() => {
    const phaseId = booking?.phaseId ?? ''
    const span = spanOf(phaseId)
    return {
      vehicleId: booking?.vehicleId ?? '',
      phaseId,
      start: booking?.start ?? span.start,
      end: booking?.end ?? span.end,
      driverId: booking?.driverId ?? '',
      notes: booking?.notes ?? '',
    }
  })
  const [asking, setAsking] = useState('')
  const { run, error, refuse } = useAct()
  const vehicles = view.vehicles.vehicles
  const drivers = driverGroups(view.crew.people, f.start, f.end, today)
  const fitted = f.start && f.end && f.start <= f.end

  const send = (override: boolean) => {
    setAsking('')
    const fields = { vehicleId: f.vehicleId, phaseId: f.phaseId || null, start: f.start, end: f.end, driverId: f.driverId || null, notes: f.notes.trim() }
    const sent = booking
      ? run(() => {
          const changed = Object.fromEntries(Object.entries(fields).filter(([k, v]) => booking[k as keyof typeof fields] !== v))
          if (!Object.keys(changed).length) return Promise.resolve()
          return client.mutate('vehicleBooking.update', { id: booking.id, ...changed, ...(override ? { override } : {}) })
        })
      : run(() => client.mutate('vehicleBooking.add', { id: newId(), projectId: job.id, ...fields, override }))
    void sent.then((ok) => {
      if (!ok) return
      if (onDone) onDone()
      else setF({ ...f, vehicleId: '', driverId: '', notes: '' })
    })
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    const v = view.vehicles.get(f.vehicleId)
    if (!v) return refuse('Choose a vehicle.')
    if (!fitted) return refuse('The booking ends before it starts.')
    // The law first: refused here as the server would, with the fix.
    const moved = !booking || booking.vehicleId !== f.vehicleId || booking.start !== f.start || booking.end !== f.end
    const refused = moved ? vehicleRefusal(v, f.start, f.end, today) : null
    if (refused) return refuse(refused)
    const driver = f.driverId ? view.crew.people.find((p) => p.id === f.driverId) : undefined
    if (driver && (moved || booking?.driverId !== f.driverId)) {
      const no = driverRefusal(driver, f.start, f.end, today)
      if (no) return refuse(no)
    }
    // The office's judgement next: another job on it, or a day off the road, asks before booking anyway.
    if (moved) {
      const clash = view.vehicles.clashesWith(v.id, f.start, f.end, booking?.id).find((c) => c.booking.end >= today)
      if (clash)
        return setAsking(
          `${vehicleName(v)} is already on ${clash.booking.job?.name ?? 'another job'} on ${spanLabel({ start: clash.days[0]!, end: clash.days.at(-1)! })}. Book it anyway to have it on both?`
        )
      if (offRoadOn(v, f.start, f.end, today)) return setAsking(`${v.name} is off the road then. Book it anyway, if it will be back in time?`)
    }
    send(false)
  }

  return (
    <form className="grid-form" onSubmit={save} aria-label={booking ? `Change the booking of ${booking.vehicle?.name ?? 'this vehicle'}` : 'Book a vehicle'}>
      <label className="wide">
        Vehicle
        <select value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })} required>
          <option value="">Choose…</option>
          {vehicles.map((v) => {
            const c = fitted ? vehicleChoice(v, f.start, f.end, today, view, booking?.id) : { label: vehicleName(v), refused: null }
            return (
              <option key={v.id} value={v.id}>
                {c.label}
              </option>
            )
          })}
        </select>
      </label>
      <label className="wide">
        For
        <select
          value={f.phaseId}
          onChange={(e) => {
            const span = spanOf(e.target.value)
            setF({ ...f, phaseId: e.target.value, start: span.start, end: span.end })
          }}
        >
          <option value="">Whole job{job.span ? ` · ${spanLabel(job.span)}` : ''}</option>
          {job.phases.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {spanLabel(p)}
            </option>
          ))}
        </select>
      </label>
      <label>
        From <input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} required />
      </label>
      <label>
        To <input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} required />
      </label>
      <label className="wide">
        Driver
        <select value={f.driverId} onChange={(e) => setF({ ...f, driverId: e.target.value })}>
          <option value="">Not chosen yet</option>
          {drivers.ok.length > 0 && (
            <optgroup label="Driving licence in date">
              {drivers.ok.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          {drivers.unknown.length > 0 && (
            <optgroup label="Licence not recorded: check first">
              {drivers.unknown.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          {drivers.no.length > 0 && (
            <optgroup label="Can't drive then">
              {drivers.no.map(({ p }) => (
                <option key={p.id} value={p.id} disabled={p.id !== booking?.driverId}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <label className="wide">
        Notes <input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. Collect the decks from Murt's on the way" />
      </label>
      {f.driverId && drivers.unknown.some((p) => p.id === f.driverId) && (
        <p className="van-state warn wide">
          {firstName(drivers.unknown.find((p) => p.id === f.driverId)!)}'s driving licence isn't recorded: check it before the job.
        </p>
      )}
      <Refusal error={error} className="wide" />
      {asking ? (
        <Confirm className="wide" question={asking} yes="Book anyway" no="Don't book it" onYes={() => send(true)} onNo={() => setAsking('')} />
      ) : (
        <div className="actions wide">
          <button type="submit" className="primary">
            {booking ? 'Save booking' : 'Book vehicle'}
          </button>
          {onDone && (
            <button type="button" onClick={onDone}>
              Cancel
            </button>
          )}
        </div>
      )}
    </form>
  )
}
