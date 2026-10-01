import {
  crewFill,
  mapLink,
  newId,
  PHASE_NAMES,
  PROJECT_STATUSES,
  STATUS_LABELS,
  STOPPED,
  spanLabel,
  type ClientView,
  type Contact,
  type JobView,
  type KitLineView,
  type ProjectStatus,
  type VenueView,
  type View,
} from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { act } from '../crew/CrewScreen.tsx'
import { client } from '../sync.ts'
import { Choices, clientNamed, NotDone, StatusPill, today, Top, useHash, useView, venueNamed } from './common.tsx'
import { ImportScreen } from './ImportScreen.tsx'
import { JobScreen } from './JobScreen.tsx'
import { kitShort } from './Kit.tsx'
import { PickScreen } from './PickScreen.tsx'
import { SheetScreen } from './SheetScreen.tsx'
import { JobViews, PlanScreen } from './PlanScreen.tsx'

/**
 * Jobs (ADR 0007): every job, who it's for, where and when, made of phases.
 * A job opens on its own page (#jobs/<id>) with its phases, kit and crew,
 * its pick list on another (#jobs/<id>/pick, ADR 0017), each phase's call
 * sheet on another (#jobs/<id>/sheet/<phase>, ADR 0021), the
 * planner (#plan, ADR 0010) shows them by week or month, and jobs already
 * on Google Calendar can be brought in (#import, ADR 0011).
 * Everything works with no signal and syncs later, like the rest of the app.
 */

type Filter = 'coming' | 'past' | 'stopped'
const FILTERS: [Filter, string][] = [
  ['coming', 'Coming up'],
  ['past', 'Past'],
  ['stopped', 'Not going ahead'],
]

function filterOf(j: JobView, day: string): Filter {
  if (STOPPED.includes(j.status)) return 'stopped'
  return j.span && j.span.end < day ? 'past' : 'coming'
}

export function JobsScreen() {
  const view = useView()
  const hash = useHash()
  if (hash === '#plan' || hash.startsWith('#plan/')) return <PlanScreen view={view} hash={hash} />
  if (hash === '#import') return <ImportScreen view={view} />
  const [, pick] = /^#jobs\/(.+)\/pick$/.exec(hash) ?? []
  if (pick) return <PickScreen view={view} id={decodeURIComponent(pick)} />
  const [, sheetJob, sheetPhase] = /^#jobs\/([^/]+)\/sheet\/([^/]+)$/.exec(hash) ?? []
  if (sheetJob && sheetPhase) return <SheetScreen view={view} jobId={decodeURIComponent(sheetJob)} phaseId={decodeURIComponent(sheetPhase)} />
  const open = hash.startsWith('#jobs/') ? decodeURIComponent(hash.slice('#jobs/'.length)) : undefined
  if (open) return <JobScreen view={view} id={open} />
  return <JobList view={view} />
}

function JobList({ view }: { view: View }) {
  const { jobs, clients, venues } = view.jobs
  const [filter, setFilter] = useState<Filter>('coming')
  const [search, setSearch] = useState('')
  const day = today()
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (j: JobView) => {
    const text = [j.name, j.client?.name, j.venue?.name, ...j.phases.map((p) => p.venue?.name)].filter(Boolean).join(' ').toLowerCase()
    return words.every((w) => text.includes(w))
  }
  const shown = jobs.filter((j) => filterOf(j, day) === filter && matches(j))
  // Past jobs newest first; everything else soonest first.
  if (filter === 'past') shown.reverse()
  const count = (f: Filter) => jobs.filter((j) => filterOf(j, day) === f).length

  return (
    <div className="app crew jobs">
      <Top view={view} />
      <JobViews />
      <NotDone view={view} />

      <section className="card">
        <h2>Jobs</h2>
        <input className="search" type="search" placeholder="Find a job, client or venue" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find" />
        <div className="filters" role="group" aria-label="Show">
          {FILTERS.map(([f, label]) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {label} ({count(f)})
            </button>
          ))}
        </div>
        {shown.length === 0 && <p className="empty">{jobs.length === 0 ? 'No jobs yet. Add the first one below.' : 'Nothing here.'}</p>}
        <ul className="job-list">
          {shown.map((j) => (
            <li key={j.id}>
              <JobRow job={j} kit={view.kit.byJob.get(j.id)} />
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>New job</h2>
        <NewJob view={view} />
        {(view.calendar.link?.state === 'on' || view.calendar.link?.state === 'choosing') && (
          <p className="hint">
            Jobs already on a Google calendar? <a href="#import">Bring them in</a> rather than typing them again.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Clients</h2>
        {clients.length === 0 && <p className="empty">Clients are added as you type them into a job.</p>}
        {clients.map((c) => (
          <ClientRow key={c.id} c={c} jobs={jobs.filter((j) => j.clientId === c.id).length} />
        ))}
      </section>

      <section className="card">
        <h2>Venues</h2>
        {venues.length === 0 && <p className="empty">Venues are added as you type them into a job.</p>}
        {venues.map((v) => (
          <VenueRow key={v.id} v={v} jobs={jobs.filter((j) => j.venueId === v.id || j.phases.some((p) => p.venueId === v.id)).length} />
        ))}
      </section>
    </div>
  )
}

function JobRow({ job, kit }: { job: JobView; kit: readonly KitLineView[] | undefined }) {
  const crew = crewFill(job.calls)
  const short = kitShort(kit)
  return (
    <a className="job-row" href={`#jobs/${job.id}`}>
      <div>
        <b>{job.name}</b>
        <p>{[job.client?.name, job.venue?.name].filter(Boolean).join(' · ') || 'No client or venue yet'}</p>
        <p>
          {job.span ? spanLabel(job.span) : 'No dates yet'}
          {job.phases.length > 0 && ` · ${job.phases.map((p) => p.name).join(', ')}`}
        </p>
      </div>
      <div className="side">
        <StatusPill status={job.status} pending={job.pending} />
        {crew.needed > 0 && (
          <small>
            Crew {crew.booked} of {crew.needed}
            {crew.toConfirm > 0 && `, ${crew.toConfirm} to confirm`}
          </small>
        )}
        {short && <small className={`flag ${short}`}>Kit short</small>}
      </div>
    </a>
  )
}

interface PhaseDraft {
  key: string
  name: string
  start: string
  end: string
}

/** A new job with its first phases, all in one go. Clients and venues not yet known are added as typed. */
function NewJob({ view }: { view: View }) {
  const { clients, venues } = view.jobs
  const first = (): PhaseDraft => ({ key: newId(), name: 'Show', start: today(), end: today() })
  const [f, setF] = useState({ name: '', client: '', venue: '', status: 'confirmed' as ProjectStatus })
  const [phases, setPhases] = useState<PhaseDraft[]>(() => [first()])
  const setPhase = (key: string, changes: Partial<PhaseDraft>) =>
    setPhases(
      phases.map((p) => {
        if (p.key !== key) return p
        const next = { ...p, ...changes }
        if (next.end < next.start) next.end = next.start
        return next
      })
    )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return
    const id = newId()
    void act(async () => {
      const clientId = await clientNamed(f.client, clients)
      const venueId = await venueNamed(f.venue, venues)
      await client.mutate('project.create', { id, name: f.name.trim(), clientId, venueId, status: f.status, notes: '' })
      for (const p of phases)
        if (p.name.trim()) await client.mutate('phase.add', { id: newId(), projectId: id, name: p.name.trim(), start: p.start, end: p.end, venueId: null, notes: '' })
    }).then(() => {
      location.hash = `#jobs/${id}`
    }, (err: Error) => alert(err.message))
    setF({ name: '', client: '', venue: '', status: 'confirmed' })
    setPhases([first()])
  }

  return (
    <form className="grid-form" onSubmit={submit}>
      <label className="wide">
        Job <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Nissan launch" required />
      </label>
      <label>
        Client <input list="client-names" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} placeholder="Pick or add one" />
      </label>
      <label>
        Venue <input list="venue-names" value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} placeholder="Pick or add one" />
      </label>
      <label className="wide">
        Status
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ProjectStatus })}>
          {PROJECT_STATUSES.filter((s) => !STOPPED.includes(s)).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="wide phase-rows">
        <legend>Phases</legend>
        {phases.map((p, i) => (
          <div className="phase-row" key={p.key}>
            <input list="phase-names" value={p.name} onChange={(e) => setPhase(p.key, { name: e.target.value })} aria-label={`Phase ${i + 1}`} placeholder="Build, Show…" />
            <input type="date" value={p.start} onChange={(e) => setPhase(p.key, { start: e.target.value })} aria-label={`Phase ${i + 1} from`} />
            <input type="date" value={p.end} min={p.start} onChange={(e) => setPhase(p.key, { end: e.target.value })} aria-label={`Phase ${i + 1} to`} />
            <button type="button" className="link" onClick={() => setPhases(phases.filter((x) => x.key !== p.key))} aria-label={`Remove phase ${i + 1}`}>
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            const last = phases.at(-1)
            setPhases([...phases, { key: newId(), name: '', start: last?.end ?? today(), end: last?.end ?? today() }])
          }}
        >
          Add a phase
        </button>
      </fieldset>
      <button type="submit" className="primary wide">
        Add job
      </button>
      <Choices id="client-names" names={clients} />
      <Choices id="venue-names" names={venues} />
      <datalist id="phase-names">
        {PHASE_NAMES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </form>
  )
}

const blankContact = (): Contact => ({ name: '', role: '', email: null, phone: null })

function ClientRow({ c, jobs }: { c: ClientView; jobs: number }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ name: c.name, notes: c.notes, contacts: c.contacts })
  const setContact = (i: number, changes: Partial<Contact>) => setF({ ...f, contacts: f.contacts.map((x, j) => (j === i ? { ...x, ...changes } : x)) })
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return
    const contacts = f.contacts
      .filter((x) => x.name.trim())
      .map((x) => ({ name: x.name.trim(), role: x.role.trim(), email: x.email?.trim() || null, phone: x.phone?.trim() || null }))
    void act(() => client.mutate('client.upsert', { id: c.id, name: f.name.trim(), contacts, notes: f.notes.trim() })).then(
      () => setOpen(false),
      (err: Error) => alert(err.message)
    )
  }
  return (
    <div className="row person">
      <button
        type="button"
        className="who"
        aria-expanded={open}
        onClick={() => {
          setF({ name: c.name, notes: c.notes, contacts: c.contacts })
          setOpen(!open)
        }}
      >
        <b>{c.name}</b>
        <small>
          {jobs} job{jobs === 1 ? '' : 's'}
          {c.contacts.length > 0 && ` · ${c.contacts.map((x) => x.name).join(', ')}`}
        </small>
      </button>
      {c.pending && <span className="pill pending">Waiting to sync</span>}
      {open && (
        <form className="detail grid-form" onSubmit={save}>
          <label className="wide">
            Name <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          </label>
          {f.contacts.map((x, i) => (
            <fieldset className="wide contact" key={i}>
              <legend>Contact {i + 1}</legend>
              <input value={x.name} onChange={(e) => setContact(i, { name: e.target.value })} placeholder="Name" aria-label="Contact name" />
              <input value={x.role} onChange={(e) => setContact(i, { role: e.target.value })} placeholder="Role, e.g. Producer" aria-label="Contact role" />
              <input type="tel" value={x.phone ?? ''} onChange={(e) => setContact(i, { phone: e.target.value })} placeholder="Mobile" aria-label="Contact mobile" />
              <input type="email" value={x.email ?? ''} onChange={(e) => setContact(i, { email: e.target.value })} placeholder="Email" aria-label="Contact email" />
            </fieldset>
          ))}
          <button type="button" className="wide" onClick={() => setF({ ...f, contacts: [...f.contacts, blankContact()] })}>
            Add a contact
          </button>
          <label className="wide">
            Notes <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </label>
          <button type="submit" className="primary wide">
            Save client
          </button>
        </form>
      )}
    </div>
  )
}

function VenueRow({ v, jobs }: { v: VenueView; jobs: number }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ name: v.name, address: v.address, notes: v.notes })
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return
    void act(() => client.mutate('venue.upsert', { id: v.id, name: f.name.trim(), address: f.address.trim(), notes: f.notes.trim() })).then(
      () => setOpen(false),
      (err: Error) => alert(err.message)
    )
  }
  return (
    <div className="row person">
      <button
        type="button"
        className="who"
        aria-expanded={open}
        onClick={() => {
          setF({ name: v.name, address: v.address, notes: v.notes })
          setOpen(!open)
        }}
      >
        <b>{v.name}</b>
        <small>
          {jobs} job{jobs === 1 ? '' : 's'}
          {v.address && ` · ${v.address.split('\n')[0]}`}
        </small>
      </button>
      {v.pending && <span className="pill pending">Waiting to sync</span>}
      {open && (
        <form className="detail grid-form" onSubmit={save}>
          <label className="wide">
            Name <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          </label>
          <label className="wide">
            Address <textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="With the Eircode, the map link goes straight there" />
          </label>
          <label className="wide">
            Notes <textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Access, load-in, power, parking" />
          </label>
          <div className="actions wide">
            <button type="submit" className="primary">
              Save venue
            </button>
            {(v.address || v.name) && (
              <a className="button" href={mapLink(v)} target="_blank" rel="noreferrer">
                Map
              </a>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
