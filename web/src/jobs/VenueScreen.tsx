import { mapLink, type JobView, type VenueView, type View } from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { Attachments, JobsCard } from './Attachments.tsx'
import { Page } from './common.tsx'

/**
 * One venue on a page of its own (ADR 0032, #venues/<id>): where it is,
 * what to know getting in, the documents kept for it (its tech spec, floor
 * plan, health and safety pack…), and the jobs there.
 */

/** The jobs at a venue: the job's own, or one of its phases'. */
export const jobsAt = (jobs: readonly JobView[], venueId: string) => jobs.filter((j) => j.venueId === venueId || j.phases.some((p) => p.venueId === venueId))

export function VenueScreen({ view, id }: { view: View; id: string }) {
  const venue = view.jobs.venues.find((v) => v.id === id)
  const back = (
    <a className="back" href="#jobs">
      ‹ All jobs
    </a>
  )
  if (!venue)
    return (
      <Page view={view} title="Venue" className="crew jobs" back={back}>
        <section className="card">
          <p className="empty">This venue isn't on this device. It may still be on its way: check again once it says “Up to date”.</p>
        </section>
      </Page>
    )
  return (
    <Page view={view} title="Venue" className="crew jobs" back={back}>
      <VenueSummary venue={venue} />
      <Attachments owner={{ owner: 'venue', id: venue.id, name: venue.name }} />
      <JobsCard jobs={jobsAt(view.jobs.jobs, venue.id)} title="Jobs here" client />
    </Page>
  )
}

function VenueSummary({ venue }: { venue: VenueView }) {
  const [editing, setEditing] = useState(false)
  return (
    <section className="card">
      <header className="title">
        <h1>{venue.name}</h1>
        <Pending pending={venue.pending} />
      </header>
      <dl className="facts">
        <div>
          <dt>Address</dt>
          <dd>
            {venue.address ? <span className="lines">{venue.address}</span> : 'None yet'}{' '}
            <a href={mapLink(venue)} target="_blank" rel="noreferrer">
              Map
            </a>
          </dd>
        </div>
      </dl>
      {venue.notes && <p className="notes">{venue.notes}</p>}
      {editing ? (
        <EditVenue venue={venue} onDone={() => setEditing(false)} />
      ) : (
        <button type="button" onClick={() => setEditing(true)}>
          Change details
        </button>
      )}
    </section>
  )
}

function EditVenue({ venue, onDone }: { venue: VenueView; onDone: () => void }) {
  const [f, setF] = useState({ name: venue.name, address: venue.address, notes: venue.notes })
  const { run, error } = useAct()
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return
    void run(() => client.mutate('venue.upsert', { id: venue.id, name: f.name.trim(), address: f.address.trim(), notes: f.notes.trim() })).then((ok) => ok && onDone())
  }
  return (
    <form className="grid-form" onSubmit={save} aria-label={`Change ${venue.name}`}>
      <label className="wide">
        Name <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      </label>
      <label className="wide">
        Address <textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="With the Eircode, the map link goes straight there" />
      </label>
      <label className="wide">
        Notes <textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Access, load-in, power, parking" />
      </label>
      <Refusal error={error} className="wide" />
      <button type="submit" className="primary">
        Save venue
      </button>
      <button type="button" onClick={onDone}>
        Cancel
      </button>
    </form>
  )
}
