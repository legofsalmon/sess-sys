import {
  crewFill,
  KIND_LABELS,
  kindOf,
  addDays,
  newId,
  PHASE_NAMES,
  phaseNames,
  PROJECT_KINDS,
  PROJECT_STATUSES,
  STATUS_LABELS,
  STOPPED,
  spanLabel,
  type ClientView,
  type JobView,
  type KitLineView,
  type ProjectKind,
  type ProjectStatus,
  type VenueView,
  type View,
} from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Pending } from '../StatusPill.tsx'
import { useAccess } from '../role.ts'
import { client } from '../sync.ts'
import { useToday, useView, useWide } from '../view.ts'
import { Beside, Choices, clientNamed, JobStatusPill, Top, useHash, venueNamed } from './common.tsx'
import { ImportScreen } from './ImportScreen.tsx'
import { TidyNudge, TidyScreen } from './TidyScreen.tsx'
import { JobScreen } from './JobScreen.tsx'
import { kitShort } from './Kit.tsx'
import { MoneyScreen, PricesScreen } from './Money.tsx'
import { NotesKitListScreen, NotesKitNudge, NotesKitScreen } from './NotesKit.tsx'
import { PickScreen } from './PickScreen.tsx'
import { QuoteScreen } from './Quote.tsx'
import { SheetScreen } from './SheetScreen.tsx'
import { JobViews, PlanScreen } from './PlanScreen.tsx'
import { ClientScreen } from './ClientScreen.tsx'
import { jobsAt, VenueScreen } from './VenueScreen.tsx'
import { Heading, Icon } from '../Icon.tsx'
import { JOBS } from '../Up.tsx'
import { useWindowed } from '../windowed.ts'

/**
 * Jobs (ADR 0007): every job, who it's for, where and when, made of phases.
 * A job opens on its own page (#jobs/<id>) with its phases, kit and crew,
 * its pick list on another (#jobs/<id>/pick, ADR 0017), each phase's call
 * sheet on another (#jobs/<id>/sheet/<phase>, ADR 0021), the
 * planner (#jobs/plan, ADR 0010) shows them by week or month, the clients
 * and venues have a list each (#jobs/clients, #jobs/venues, ADR 0041) and
 * a page each with its documents (#jobs/venues/<id>, ADR 0032), each job's
 * quote is on #jobs/<id>/quote and money on #jobs/money (ADR 0042), jobs
 * already on Google Calendar can be brought in (#jobs/import, ADR 0011) and
 * what came in tidied up (#jobs/tidy, ADR 0050), and
 * the kit their notes list turned into kit lines, a job at a time
 * (#jobs/<id>/notes-kit) or a season at a time (#jobs/notes-kit, ADR 0043).
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
  if (hash === '#jobs/plan' || hash.startsWith('#jobs/plan/')) return <PlanScreen view={view} hash={hash} />
  if (hash === '#jobs/import') return <ImportScreen view={view} />
  if (hash === '#jobs/tidy') return <TidyScreen view={view} />
  if (hash === '#jobs/clients') return <ClientsScreen view={view} />
  if (hash === '#jobs/venues') return <VenuesScreen view={view} />
  if (hash === '#jobs/money') return <MoneyScreen view={view} />
  if (hash === '#jobs/money/prices') return <PricesScreen view={view} />
  if (hash === '#jobs/notes-kit') return <NotesKitListScreen view={view} />
  if (hash.startsWith('#jobs/venues/')) return <VenueScreen view={view} id={decodeURIComponent(hash.slice('#jobs/venues/'.length))} />
  if (hash.startsWith('#jobs/clients/')) return <ClientScreen view={view} id={decodeURIComponent(hash.slice('#jobs/clients/'.length))} />
  const [, fromNotes] = /^#jobs\/([^/]+)\/notes-kit$/.exec(hash) ?? []
  if (fromNotes) return <NotesKitScreen view={view} jobId={decodeURIComponent(fromNotes)} />
  const [, quote] = /^#jobs\/([^/]+)\/quote$/.exec(hash) ?? []
  if (quote) return <QuoteScreen view={view} jobId={decodeURIComponent(quote)} />
  const [, pick] = /^#jobs\/(.+)\/pick$/.exec(hash) ?? []
  if (pick) return <PickScreen view={view} id={decodeURIComponent(pick)} />
  const [, sheetJob, sheetPhase] = /^#jobs\/([^/]+)\/sheet\/([^/]+)$/.exec(hash) ?? []
  if (sheetJob && sheetPhase) return <SheetScreen view={view} jobId={decodeURIComponent(sheetJob)} phaseId={decodeURIComponent(sheetPhase)} />
  const open = hash.startsWith('#jobs/') ? decodeURIComponent(hash.slice('#jobs/'.length)) : undefined
  // On a laptop the list keeps a column of its own (audit finding 25), with its search and filter, beside the open job or the rest of the tab; on a phone the job is a page of its own.
  if (wide)
    return (
      <Beside
        view={view}
        className="crew jobs"
        head={<JobViews />}
        list={<JobsCard view={view} current={open} />}
        open={open}
        up={{ steps: [JOBS], here: view.jobs.jobs.find((j) => j.id === open)?.name }}
      >
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
      <Top view={view} root />
      <JobViews />

      <JobsCard view={view} />

      <JobsRest view={view} />
    </div>
  )
}

/** A new job: under the list on a phone, beside it on a laptop. */
function JobsRest({ view }: { view: View }) {
  // Taking a job in is the office's, so a role without jobs has no New job (ADR 0034).
  const mayAdd = useAccess().can('jobs')
  return (
    <>
      <TidyNudge view={view} />
      <NotesKitNudge view={view} />
      {mayAdd && (
        <section className="card">
          <Heading icon="add">New job</Heading>
          <NewJob view={view} />
          {(view.calendar.link?.state === 'on' || view.calendar.link?.state === 'choosing') && (
            <p className="hint">
              Jobs already on a Google calendar? <a href="#jobs/import">Bring them in</a> rather than typing them again.
            </p>
          )}
        </section>
      )}
    </>
  )
}

/** Every client, on a page along Jobs' row (ADR 0041): each opens its own page, with its documents and its jobs. */
function ClientsScreen({ view }: { view: View }) {
  const { jobs, clients } = view.jobs
  return (
    <div className="app crew jobs">
      <Top view={view} />
      <JobViews current="clients" />
      <section className="card">
        <h1 className="with-icon">
          <Icon name="company" />
          <span>Clients</span>
        </h1>
        {clients.length === 0 && <Empty>Clients are added as you type them into a job.</Empty>}
        <ul className="job-list">
          {clients.map((c) => (
            <li key={c.id}>
              <ClientRow c={c} jobs={jobs.filter((j) => j.clientId === c.id).length} docs={view.attachments.of('client', c.id).length} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/** Every venue, on a page along Jobs' row (ADR 0041). */
function VenuesScreen({ view }: { view: View }) {
  const { jobs, venues } = view.jobs
  return (
    <div className="app crew jobs">
      <Top view={view} />
      <JobViews current="venues" />
      <section className="card">
        <h1 className="with-icon">
          <Icon name="venue" />
          <span>Venues</span>
        </h1>
        {venues.length === 0 && <Empty>Venues are added as you type them into a job.</Empty>}
        <ul className="job-list">
          {venues.map((v) => (
            <li key={v.id}>
              <VenueRow v={v} jobs={jobsAt(jobs, v.id).length} docs={view.attachments.of('venue', v.id).length} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

const jobKey = (j: JobView) => j.id

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
  const win = useWindowed('jobs', shown, jobKey, 110)

  return (
    <section className="card" aria-label="Jobs">
      <Heading icon="calendar">Jobs</Heading>
      <input className="search" type="search" placeholder="Find a job, client or venue" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find" />
      <div className="filters" role="group" aria-label="Show">
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {label} ({count(f)})
          </button>
        ))}
      </div>
      {shown.length === 0 && <Empty>{jobs.length === 0 && 'Add the first one under New job.'}</Empty>}
      {/* A long list (audit finding 11, ADR 0050): only the rows near the screen are drawn, and Back finds its place by them (places.ts). */}
      <ul className="job-list windowed" ref={win.list} style={win.style}>
        {win.rows.map((j, i) => (
          <li key={j.id} ref={win.row(j.id)} data-place={j.id} aria-setsize={shown.length} aria-posinset={win.start + i + 1}>
            <JobRow job={j} kit={view.kit.byJob.get(j.id)} current={j.id === current} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A job in the next fortnight with neither is worth a prompt; on every other row the empty line is noise (audit of 16 October, finding 8). */
const PROMPT_DAYS = 14

export function JobRow({ job, kit, current }: { job: JobView; kit: readonly KitLineView[] | undefined; current: boolean }) {
  const crew = crewFill(job.calls)
  const short = kitShort(kit)
  const today = useToday()
  const where = [job.client?.name, job.venue?.name].filter(Boolean).join(' · ')
  const soon = !!job.span && job.span.end >= today && job.span.start <= addDays(today, PROMPT_DAYS)
  return (
    <a className="job-row" href={`#jobs/${job.id}`} aria-current={current ? 'page' : undefined}>
      <div>
        <b>{job.name}</b>
        {(where || soon) && <p>{where || 'No client or venue yet'}</p>}
        <p>
          {kindOf(job) !== 'gig' && `${KIND_LABELS[kindOf(job)]} · `}
          {job.span ? spanLabel(job.span) : 'No dates yet'}
          {job.phases.length > 0 && ` · ${phaseNames(job.phases)}`}
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
  const [f, setF] = useState({ name: '', client: '', venue: '', status: 'enquiry' as ProjectStatus, kind: 'gig' as ProjectKind })
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
    const cleared = { name: '', client: '', venue: '', status: 'enquiry' as ProjectStatus, kind: 'gig' as ProjectKind }
    const clearedPhases = [first()]
    setF(cleared)
    setPhases(clearedPhases)
    void run(async () => {
      const clientId = await clientNamed(f.client, clients)
      const venueId = await venueNamed(f.venue, venues)
      await client.mutate('project.create', { id, name: f.name.trim(), clientId, venueId, status: f.status, kind: f.kind, notes: '' })
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
      <label className="wide">
        Kind
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ProjectKind })}>
          {PROJECT_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
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
    <a className="job-row" href={`#jobs/clients/${encodeURIComponent(c.id)}`}>
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
    <a className="job-row" href={`#jobs/venues/${encodeURIComponent(v.id)}`}>
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
