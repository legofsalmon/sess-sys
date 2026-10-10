import {
  crewFill,
  newId,
  PHASE_NAMES,
  PROJECT_STATUSES,
  STATUS_LABELS,
  STOPPED,
  spanLabel,
  type ClientView,
  type JobView,
  type KitLineView,
  type ProjectStatus,
  type VenueView,
  type View,
} from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { useToday, useView, useWide } from '../view.ts'
import { Beside, Choices, clientNamed, JobStatusPill, Top, useHash, venueNamed } from './common.tsx'
import { ImportScreen } from './ImportScreen.tsx'
import { JobScreen } from './JobScreen.tsx'
import { kitShort } from './Kit.tsx'
import { PickScreen } from './PickScreen.tsx'
import { SheetScreen } from './SheetScreen.tsx'
import { JobViews, PlanScreen } from './PlanScreen.tsx'
import { ClientScreen } from './ClientScreen.tsx'
import { jobsAt, VenueScreen } from './VenueScreen.tsx'

/**
 * Jobs (ADR 0007): every job, who it's for, where and when, made of phases.
 * A job opens on its own page (#jobs/<id>) with its phases, kit and crew,
 * its pick list on another (#jobs/<id>/pick, ADR 0017), each phase's call
 * sheet on another (#jobs/<id>/sheet/<phase>, ADR 0021), the
 * planner (#plan, ADR 0010) shows them by week or month, each venue has a
 * page of its own with its documents (#venues/<id>, ADR 0032), as does each
 * client (#clients/<id>), and jobs already
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
  const wide = useWide()
  if (hash === '#plan' || hash.startsWith('#plan/')) return <PlanScreen view={view} hash={hash} />
  if (hash === '#import') return <ImportScreen view={view} />
  if (hash.startsWith('#venues/')) return <VenueScreen view={view} id={decodeURIComponent(hash.slice('#venues/'.length))} />
  if (hash.startsWith('#clients/')) return <ClientScreen view={view} id={decodeURIComponent(hash.slice('#clients/'.length))} />
  const [, pick] = /^#jobs\/(.+)\/pick$/.exec(hash) ?? []
  if (pick) return <PickScreen view={view} id={decodeURIComponent(pick)} />
  const [, sheetJob, sheetPhase] = /^#jobs\/([^/]+)\/sheet\/([^/]+)$/.exec(hash) ?? []
  if (sheetJob && sheetPhase) return <SheetScreen view={view} jobId={decodeURIComponent(sheetJob)} phaseId={decodeURIComponent(sheetPhase)} />
  const open = hash.startsWith('#jobs/') ? decodeURIComponent(hash.slice('#jobs/'.length)) : undefined
  // On a laptop the list keeps a column of its own (audit finding 25), with its search and filter, beside the open job or the rest of the tab; on a phone the job is a page of its own.
  if (wide)
    return (
      <Beside view={view} className="crew jobs" head={<JobViews />} list={<JobsCard view={view} current={open} />} open={open}>
        {/* Keyed by the job, so a form left open on one isn't still open on the next picked from the list. */}
        {open ? <JobScreen key={open} view={view} id={open} bare /> : <JobsRest view={view} />}
      </Beside>
    )
  if (open) return <JobScreen view={view} id={open} />
  return <JobList view={view} />
}

function JobList({ view }: { view: View }) {
  return (
    <div className="app crew jobs">
      <Top view={view} />
      <JobViews />

      <JobsCard view={view} />

      <JobsRest view={view} />
    </div>
  )
}

/** A new job, the clients and the venues: under the list on a phone, beside it on a laptop. */
function JobsRest({ view }: { view: View }) {
  const { jobs, clients, venues } = view.jobs
  return (
    <>
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
        {clients.length === 0 && <Empty>Clients are added as you type them into a job.</Empty>}
        <ul className="job-list">
          {clients.map((c) => (
            <li key={c.id}>
              <ClientRow c={c} jobs={jobs.filter((j) => j.clientId === c.id).length} docs={view.attachments.of('client', c.id).length} />
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Venues</h2>
        {venues.length === 0 && <Empty>Venues are added as you type them into a job.</Empty>}
        <ul className="job-list">
          {venues.map((v) => (
            <li key={v.id}>
              <VenueRow v={v} jobs={jobsAt(jobs, v.id).length} docs={view.attachments.of('venue', v.id).length} />
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

/** Every job, searched and filtered; `current` marks the one open beside the list. */
function JobsCard({ view, current }: { view: View; current?: string }) {
  const { jobs } = view.jobs
  const [filter, setFilter] = useState<Filter>('coming')
  const [search, setSearch] = useState('')
  const day = useToday()
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
    <section className="card" aria-label="Jobs">
      <h2>Jobs</h2>
      <input className="search" type="search" placeholder="Find a job, client or venue" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find" />
      <div className="filters" role="group" aria-label="Show">
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {label} ({count(f)})
          </button>
        ))}
      </div>
      {shown.length === 0 && <Empty>{jobs.length === 0 && 'Add the first one under New job.'}</Empty>}
      <ul className="job-list">
        {shown.map((j) => (
          <li key={j.id}>
            <JobRow job={j} kit={view.kit.byJob.get(j.id)} current={j.id === current} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function JobRow({ job, kit, current }: { job: JobView; kit: readonly KitLineView[] | undefined; current: boolean }) {
  const crew = crewFill(job.calls)
  const short = kitShort(kit)
  return (
    <a className="job-row" href={`#jobs/${job.id}`} aria-current={current ? 'page' : undefined}>
      <div>
        <b>{job.name}</b>
        <p>{[job.client?.name, job.venue?.name].filter(Boolean).join(' · ') || 'No client or venue yet'}</p>
        <p>
          {job.span ? spanLabel(job.span) : 'No dates yet'}
          {job.phases.length > 0 && ` · ${job.phases.map((p) => p.name).join(', ')}`}
        </p>
      </div>
      <div className="side">
        <JobStatusPill status={job.status} pending={job.pending} />
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
  const today = useToday()
  const first = (): PhaseDraft => ({ key: newId(), name: 'Show', start: today, end: today })
  const [f, setF] = useState({ name: '', client: '', venue: '', status: 'confirmed' as ProjectStatus })
  const [phases, setPhases] = useState<PhaseDraft[]>(() => [first()])
  const { run, error } = useAct()
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
    // A refusal brings what was typed back, unless the next thing has been typed since.
    const cleared = { name: '', client: '', venue: '', status: 'confirmed' as ProjectStatus }
    const clearedPhases = [first()]
    setF(cleared)
    setPhases(clearedPhases)
    void run(async () => {
      const clientId = await clientNamed(f.client, clients)
      const venueId = await venueNamed(f.venue, venues)
      await client.mutate('project.create', { id, name: f.name.trim(), clientId, venueId, status: f.status, notes: '' })
      for (const p of phases)
        if (p.name.trim()) await client.mutate('phase.add', { id: newId(), projectId: id, name: p.name.trim(), start: p.start, end: p.end, venueId: null, notes: '' })
    }).then((ok) => {
      if (ok) location.hash = `#jobs/${id}`
      else {
        setF((now) => (now === cleared ? f : now))
        setPhases((now) => (now === clearedPhases ? phases : now))
      }
    })
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
      {f.status === 'confirmed' && <p className="hint wide">A confirmed job goes on the jobs calendar and holds its kit.</p>}
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
            setPhases([...phases, { key: newId(), name: '', start: last?.end ?? today, end: last?.end ?? today }])
          }}
        >
          Add a phase
        </button>
      </fieldset>
      <Refusal error={error} className="wide" />
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

/** A client in the list: opens their own page, with their documents and their jobs (ADR 0032). */
function ClientRow({ c, jobs, docs }: { c: ClientView; jobs: number; docs: number }) {
  return (
    <a className="job-row" href={`#clients/${encodeURIComponent(c.id)}`}>
      <div>
        <b>{c.name}</b>
        <p>
          {jobs} job{jobs === 1 ? '' : 's'}
          {docs > 0 && ` · ${docs} document${docs === 1 ? '' : 's'}`}
          {c.contacts.length > 0 && ` · ${c.contacts.map((x) => x.name).join(', ')}`}
        </p>
      </div>
      <div className="side">
        <Pending pending={c.pending} />
      </div>
    </a>
  )
}

/** A venue in the list: opens its own page, with its documents and its jobs (ADR 0032). */
function VenueRow({ v, jobs, docs }: { v: VenueView; jobs: number; docs: number }) {
  return (
    <a className="job-row" href={`#venues/${encodeURIComponent(v.id)}`}>
      <div>
        <b>{v.name}</b>
        <p>
          {jobs} job{jobs === 1 ? '' : 's'}
          {docs > 0 && ` · ${docs} document${docs === 1 ? '' : 's'}`}
          {v.address && ` · ${v.address.split('\n')[0]}`}
        </p>
      </div>
      <div className="side">
        <Pending pending={v.pending} />
      </div>
    </a>
  )
}
