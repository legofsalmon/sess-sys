import {
  crewFill,
  dayLabel,
  KIND_LABELS,
  kindOf,
  addDays,
  mondayOf,
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
import { useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Fold } from '../Fold.tsx'
import { Pending } from '../StatusPill.tsx'
import { useAccess } from '../role.ts'
import { client } from '../sync.ts'
import { useToday, useView, useWide } from '../view.ts'
import { Beside, Choices, clientNamed, JobStatusPill, Top, useHash, venueNamed } from './common.tsx'
import { ImportScreen } from './ImportScreen.tsx'
import { TidyNudge, TidyScreen } from './TidyScreen.tsx'
import { JOB_PARTS, JobScreen, type JobPart } from './JobScreen.tsx'
import { kitShort } from './Kit.tsx'
import { MoneyScreen, PricesScreen } from './Money.tsx'
import { PastQuoteScreen, PastQuotesScreen } from './PastQuotes.tsx'
import { NotesKitListScreen, NotesKitNudge, NotesKitScreen } from './NotesKit.tsx'
import { PickScreen } from './PickScreen.tsx'
import { QuoteScreen } from './Quote.tsx'
import { SheetScreen } from './SheetScreen.tsx'
import { JobViews, PlanScreen } from './PlanScreen.tsx'
import { ClientScreen } from './ClientScreen.tsx'
import { jobsAt, VenueScreen } from './VenueScreen.tsx'
import { VenuesMapCard } from './VenueMaps.tsx'
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
  if (hash === '#jobs/money/current-rms') return <PastQuotesScreen view={view} />
  if (hash.startsWith('#jobs/money/current-rms/')) return <PastQuoteScreen view={view} id={decodeURIComponent(hash.slice('#jobs/money/current-rms/'.length))} />
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
  // A job's page, at a part of it when the address names one.
  const [, partOf, part] = /^#jobs\/([^/]+)\/([a-z]+)$/.exec(hash) ?? []
  const open = partOf && JOB_PARTS.includes(part as JobPart) ? decodeURIComponent(partOf) : hash.startsWith('#jobs/') ? decodeURIComponent(hash.slice('#jobs/'.length)) : undefined
  // A job has the whole width, on a laptop too: the list beside it took a third of the desk from it. The way up goes back to the list.
  if (open) return <JobScreen key={open} view={view} id={open} part={partOf ? (part as JobPart) : undefined} />
  // On a laptop the list keeps a column of its own (audit finding 25), with its search and filter, beside the rest of the tab; on a phone it's above it.
  if (wide)
    return (
      <Beside view={view} className="crew jobs" views={<JobViews />} heading="Jobs" list={<JobsCard view={view} />}>
        <JobsRest view={view} />
      </Beside>
    )
  return <JobList view={view} />
}

function JobList({ view }: { view: View }) {
  return (
    <div className="app crew jobs">
      <Top view={view} views={<JobViews />} heading="Jobs" />

      <JobsCard view={view} phone />

      <JobsRest view={view} phone />
    </div>
  )
}

/** The way to bring in jobs already on a calendar, rather than typing them as new ones; in view beside New job, open or not. */
function BringInHint({ view }: { view: View }) {
  if (view.calendar.link?.state !== 'on' && view.calendar.link?.state !== 'choosing') return null
  return (
    <p className="hint">
      Jobs already on a Google calendar? <a href="#jobs/import">Bring them in</a> rather than typing them again.
    </p>
  )
}

/** Beside the list on a laptop: the nudges, and a new job. On a phone New job is at the top of the list, behind its button (audit finding 22). */
function JobsRest({ view, phone = false }: { view: View; phone?: boolean }) {
  // Taking a job in is the office's, so a role without jobs has no New job (ADR 0034).
  const mayAdd = useAccess().can('jobs')
  return (
    <>
      <TidyNudge view={view} />
      <NotesKitNudge view={view} />
      {mayAdd && !phone && (
        <section className="card">
          <Heading icon="add">New job</Heading>
          <NewJob view={view} />
          <BringInHint view={view} />
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
      <Top view={view} views={<JobViews current="clients" />} heading="Clients" />
      <section className="card plain">
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

/** Every venue, on a page along Jobs' row (ADR 0041), with a map of them all above the list (ADR 0057). */
function VenuesScreen({ view }: { view: View }) {
  const { jobs, venues } = view.jobs
  return (
    <div className="app crew jobs">
      <Top view={view} views={<JobViews current="venues" />} heading="Venues" />
      <VenuesMapCard venues={venues} jobsAt={(id) => jobsAt(jobs, id).length} />
      <section className="card plain">
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

/** A row of the list: the heading of a week, or a job with its place among the jobs. */
type Row = { week: string; label: string } | { job: JobView; n: number }
const rowKey = (r: Row) => ('job' in r ? r.job.id : `week:${r.week}`)

/** Coming up shows the next fortnight until Show all (audit finding 22). */
const SOON_DAYS = 14
/** Show all, kept for the tab's life, so Back from a job finds the same list and its place on it (places.ts). */
let showingAll = false

/** "This week", "Next week", "Last week", or "Week of Mon 3 Nov". */
function weekLabel(monday: string, today: string): string {
  const now = mondayOf(today)
  if (monday === now) return 'This week'
  if (monday === addDays(now, 7)) return 'Next week'
  if (monday === addDays(now, -7)) return 'Last week'
  return `Week of ${dayLabel(monday)}`
}

/** Jobs under the heading of their week: a job already going is in this week's; one with no dates under "No dates yet". */
function byWeek(jobs: readonly JobView[], today: string): Row[] {
  const rows: Row[] = []
  let last: string | undefined
  jobs.forEach((job, n) => {
    const week = job.span ? mondayOf(job.span.start < today && job.span.end >= today ? today : job.span.start) : ''
    if (week !== last) rows.push({ week, label: week ? weekLabel(week, today) : 'No dates yet' })
    last = week
    rows.push({ job, n })
  })
  return rows
}

/**
 * The week headings stay at the top while their jobs scroll under them: on
 * a phone just under the top bar, whatever its height; in a column of its
 * own on a laptop, at the column's top.
 */
function useUnderTop(phone: boolean) {
  const card = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = card.current
    const top = document.querySelector<HTMLElement>('.top')
    if (!phone || !el || !top || typeof ResizeObserver === 'undefined') return
    const set = () => el.style.setProperty('--under-top', `${(parseFloat(getComputedStyle(top).top) || 0) + top.offsetHeight}px`)
    const watch = new ResizeObserver(set)
    watch.observe(top)
    set()
    return () => watch.disconnect()
  }, [phone])
  return card
}

/** Every job, searched and filtered, by week. */
function JobsCard({ view, phone = false }: { view: View; phone?: boolean }) {
  const { jobs } = view.jobs
  const [filter, setFilter] = useState<Filter>('coming')
  const [search, setSearch] = useState('')
  const [all, setAll] = useState(showingAll)
  const mayAdd = useAccess().can('jobs')
  const card = useUnderTop(phone)
  const day = useToday()
  // Worked out again only when the jobs, the day or what's asked for change, not on every render (audit, 20 October 2026, finding 2).
  const counts = useMemo(() => {
    const counted = new Map<Filter, number>()
    for (const j of jobs) counted.set(filterOf(j, day), (counted.get(filterOf(j, day)) ?? 0) + 1)
    return counted
  }, [jobs, day])
  const count = (f: Filter) => counts.get(f) ?? 0
  const { rows, shownCount, listedCount } = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const matches = (j: JobView) => {
      const text = [j.name, j.client?.name, j.venue?.name, ...j.phases.map((p) => p.venue?.name)].filter(Boolean).join(' ').toLowerCase()
      return words.every((w) => text.includes(w))
    }
    const shown = jobs.filter((j) => filterOf(j, day) === filter && matches(j))
    // Past jobs newest first; everything else soonest first.
    if (filter === 'past') shown.reverse()
    // The next fortnight, and the ones with no dates yet, until Show all; a search looks through them all.
    const soonOnly = filter === 'coming' && !all && words.length === 0
    const soonEnd = addDays(day, SOON_DAYS)
    const listed = soonOnly ? shown.filter((j) => !j.span || j.span.start < soonEnd) : shown
    return { rows: byWeek(listed, day), shownCount: shown.length, listedCount: listed.length }
  }, [jobs, day, filter, search, all])
  const win = useWindowed('jobs', rows, rowKey, 110)

  return (
    <section className="card plain jobs-card" aria-label="Jobs" ref={card}>
      {phone && mayAdd && (
        <>
          <Fold label="New job" className="new-job">
            <NewJob view={view} />
          </Fold>
          <BringInHint view={view} />
        </>
      )}
      <input className="search" type="search" placeholder="Find a job, client or venue" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find" />
      <div className="filters" role="group" aria-label="Show">
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {label} ({count(f)})
          </button>
        ))}
      </div>
      {shownCount === 0 && <Empty>{jobs.length === 0 && 'Add the first one under New job.'}</Empty>}
      {shownCount > 0 && listedCount === 0 && <p className="hint">Nothing in the next fortnight.</p>}
      {/* A long list (audit finding 11, ADR 0050): only the rows near the screen are drawn, and Back finds its place by them (places.ts). */}
      <ul className="job-list windowed" ref={win.list} style={win.style}>
        {win.rows.map((r) =>
          'job' in r ? (
            <li key={r.job.id} ref={win.row(r.job.id)} data-place={r.job.id} aria-setsize={listedCount} aria-posinset={r.n + 1}>
              <JobRow job={r.job} kit={view.kit.byJob.get(r.job.id)} current={false} />
            </li>
          ) : (
            <li key={rowKey(r)} ref={win.row(rowKey(r))} data-place={rowKey(r)} className="week-head">
              <h3>{r.label}</h3>
            </li>
          )
        )}
      </ul>
      {listedCount < shownCount && (
        <button
          type="button"
          className="link show-all"
          onClick={() => {
            showingAll = true
            setAll(true)
          }}
        >
          Show all {shownCount.toLocaleString('en-IE')} coming up
        </button>
      )}
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
          {!v.pin && ' · not on the map yet'}
        </p>
      </div>
      <div className="side">
        <Pending pending={v.pending} />
      </div>
    </a>
  )
}
