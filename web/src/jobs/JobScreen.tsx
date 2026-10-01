import {
  calendarTitles,
  crewFill,
  daysLabel,
  eachDay,
  irishToday,
  mapLink,
  newId,
  phaseOnCalendar,
  phaseOnlyGrew,
  PHASE_NAMES,
  PROJECT_STATUSES,
  STATUS_LABELS,
  STOPPED,
  spanLabel,
  venueLabel,
  type CallView,
  type CommandInput,
  type JobView,
  type PersonView,
  type PhaseView,
  type ProjectStatus,
  type View,
} from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { act, CallCard, euroToCents, SharePanel } from '../crew/CrewScreen.tsx'
import { client } from '../sync.ts'
import { Choices, clientNamed, NotDone, StatusPill, Top, venueNamed } from './common.tsx'
import { KitCard, kitSummary } from './Kit.tsx'

/**
 * One job: what it is, its phases and how each will read on the calendar,
 * its kit (ADR 0014) and its crew. Crew calls made here belong to the job
 * and its phase, so freelancers always see the job's current name, dates
 * and venue.
 */

export function JobScreen({ view, id }: { view: View; id: string }) {
  const job = view.jobs.jobs.find((j) => j.id === id)
  const [share, setShare] = useState<{ person: PersonView; call: CallView } | undefined>()
  if (!job)
    return (
      <div className="app crew jobs">
        <Top view={view} />
        <a className="back" href="#jobs">
          ‹ All jobs
        </a>
        <section className="card">
          <p className="empty">This job isn't on this device. It may still be on its way: check again once it says “Up to date”.</p>
        </section>
      </div>
    )
  const onShare = (call: CallView) => (person: PersonView) => setShare({ person, call })
  const stopped = STOPPED.includes(job.status)
  // Sending an offer opens beside the call it's for: under the phases, or over the crew across phases.
  const sharing = share && <SharePanel {...share} onClose={() => setShare(undefined)} />
  const inPhase = !!share && job.phases.some((p) => p.id === share.call.phaseId)

  return (
    <div className="app crew jobs">
      <Top view={view} />
      <a className="back" href="#jobs">
        ‹ All jobs
      </a>
      <NotDone view={view} />
      <Summary job={job} view={view} />

      <section className="card" aria-label="Phases">
        <h2>Phases</h2>
        {job.phases.length === 0 && <p className="empty">No phases yet, so no dates. Add the first below.</p>}
        {job.phases.map((p) => (
          <Phase key={p.id} job={job} phase={p} view={view} onShare={onShare} />
        ))}
        <AddPhase job={job} />
      </section>

      {inPhase && sharing}
      <KitCard job={job} view={view} />
      {!inPhase && sharing}

      <section className="card" aria-label="Crew">
        <h2>Crew</h2>
        {job.otherCalls.length > 0 && <p className="hint">Across phases:</p>}
        {job.otherCalls.map((c) => (
          <CallCard key={c.id} call={c} crew={view.crew} calendar={view.calendar} onShare={onShare(c)} inJob />
        ))}
        {stopped ? <p className="empty">This job is {job.status === 'lost' ? 'lost' : 'cancelled'}, so it needs no crew.</p> : <AskForCrew job={job} />}
      </section>
    </div>
  )
}

function Summary({ job, view }: { job: JobView; view: View }) {
  const [editing, setEditing] = useState(false)
  const crew = crewFill(job.calls)
  const kit = kitSummary(job, view.kit.byJob.get(job.id) ?? [])
  return (
    <section className="card">
      <header className="title">
        <h1>{job.name}</h1>
        <StatusPill status={job.status} pending={job.pending} />
      </header>
      <dl className="facts">
        <div>
          <dt>Client</dt>
          <dd>{job.client?.name ?? 'None yet'}</dd>
        </div>
        <div>
          <dt>Venue</dt>
          <dd>
            {job.venue ? (
              <>
                {venueLabel(job.venue)}{' '}
                <a href={mapLink(job.venue)} target="_blank" rel="noreferrer">
                  Map
                </a>
              </>
            ) : (
              'None yet'
            )}
          </dd>
        </div>
        <div>
          <dt>When</dt>
          <dd>{job.span ? spanLabel(job.span) : 'No dates yet'}</dd>
        </div>
        {crew.needed > 0 && (
          <div>
            <dt>Crew</dt>
            <dd>
              {crew.booked} of {crew.needed} booked
              {crew.toConfirm > 0 && `, ${crew.toConfirm} to confirm`}
            </dd>
          </div>
        )}
        {kit && (
          <div>
            <dt>Kit</dt>
            <dd>{kit}</dd>
          </div>
        )}
      </dl>
      {job.notes && <p className="notes">{job.notes}</p>}
      {job.venue?.notes && <p className="notes">At the venue: {job.venue.notes}</p>}
      {editing ? (
        <EditJob job={job} view={view} onDone={() => setEditing(false)} />
      ) : (
        <button type="button" onClick={() => setEditing(true)}>
          Change details
        </button>
      )}
    </section>
  )
}

/** Only what was changed is sent, so someone else's change to another detail stands (ADR 0007). */
function EditJob({ job, view, onDone }: { job: JobView; view: View; onDone: () => void }) {
  const { clients, venues } = view.jobs
  const [f, setF] = useState({ name: job.name, client: job.client?.name ?? '', venue: job.venue?.name ?? '', status: job.status, notes: job.notes })
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return
    const stopping = STOPPED.includes(f.status) && !STOPPED.includes(job.status)
    const people = job.calls
      .filter((c) => c.status === 'open')
      .flatMap((c) => c.offers.filter((o) => ['offered', 'countered', 'accepted', 'confirmed'].includes(o.status)))
    if (
      stopping &&
      job.calls.some((c) => c.status === 'open') &&
      !confirm(
        `Marking ${job.name} ${STATUS_LABELS[f.status].toLowerCase()} also cancels its crew calls${
          people.length ? `: ${people.length === 1 ? '1 person' : `${people.length} people`} offered or booked will see it's withdrawn` : ''
        }. Go ahead?`
      )
    )
      return
    void act(async () => {
      const changes: CommandInput<'project.update'> = { id: job.id }
      if (f.name.trim() !== job.name) changes.name = f.name.trim()
      if (f.status !== job.status) changes.status = f.status
      if (f.notes.trim() !== job.notes) changes.notes = f.notes.trim()
      const clientId = await clientNamed(f.client, clients)
      if (clientId !== job.clientId) changes.clientId = clientId
      const venueId = await venueNamed(f.venue, venues)
      if (venueId !== job.venueId) changes.venueId = venueId
      if (Object.keys(changes).length > 1) await client.mutate('project.update', changes)
    }).then(onDone, (err: Error) => alert(err.message))
  }
  return (
    <form className="grid-form" onSubmit={save}>
      <label className="wide">
        Job <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      </label>
      <label>
        Client <input list="edit-client-names" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} />
      </label>
      <label>
        Venue <input list="edit-venue-names" value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} />
      </label>
      <label className="wide">
        Status
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ProjectStatus })}>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="wide">
        Notes <textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </label>
      <div className="actions wide">
        <button type="submit" className="primary">
          Save
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
      <Choices id="edit-client-names" names={clients} />
      <Choices id="edit-venue-names" names={venues} />
    </form>
  )
}

/** "“Nissan - Build 1/2” and “Nissan - Build 2/2”"; a long phase gives its first and last. Only the days from `from` on, when given. */
function titlesLine(job: string, p: PhaseView, from = '') {
  const days = eachDay(p.start, p.end)
  const titles = calendarTitles(job, p)
    .filter((_, i) => days[i]! >= from)
    .map((t) => `“${t}”`)
  if (titles.length === 1) return titles[0]
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`
  return `${titles[0]} to ${titles.at(-1)}`
}

/** How a phase stands with Google Calendar (ADR 0008), in a line. */
function CalendarLine({ job, phase, view }: { job: JobView; phase: PhaseView; view: View }) {
  const today = irishToday()
  const on = phaseOnCalendar(job, phase, view.calendar.link, view.calendar.days, today)
  switch (on.state) {
    case 'theirs':
      return <p className="cal">Brought in from {on.calendar}, which keeps its days, so the app doesn't add them to the jobs calendar.</p>
    case 'waiting':
      return <p className="cal">Goes on the calendar as {titlesLine(job.name, phase)} once the job is confirmed.</p>
    case 'stopped':
      return <p className="cal">Not on the calendar: the job is {job.status}.</p>
    case 'past':
      return <p className="cal">Over, so the calendar keeps it as it was.</p>
    case 'unconnected':
      return <p className="cal">Goes on the calendar as {titlesLine(job.name, phase, today)} once one is connected on the Account tab.</p>
    case 'paused':
      return <p className="warn-line">Not being updated on the calendar: it needs connecting again on the Account tab.</p>
    case 'going':
      return (
        <p className="cal">
          Going on {on.calendar} as {titlesLine(job.name, phase, today)}…
        </p>
      )
    case 'on':
      return (
        <p className="cal">
          On {on.calendar} as {titlesLine(job.name, phase, today)}.
          {on.link && (
            <>
              {' '}
              <a href={on.link} target="_blank" rel="noreferrer">
                Open it
              </a>
            </>
          )}
        </p>
      )
    case 'failed':
      return (
        <p className="warn-line">
          {on.failed === on.days ? phase.name : `${on.failed} of its ${on.days} days`} couldn't go on {on.calendar}. {on.problem}
        </p>
      )
  }
}

function Phase({ job, phase, view, onShare }: { job: JobView; phase: PhaseView; view: View; onShare: (c: CallView) => (p: PersonView) => void }) {
  const [editing, setEditing] = useState(false)
  const outside = phase.calls.filter((c) => c.status === 'open' && (c.start < phase.start || c.end > phase.end))
  const ownVenue = phase.venueId && phase.venueId !== job.venueId ? phase.venue : undefined
  const contact = phase.contactId ? view.crew.people.find((p) => p.id === phase.contactId) : undefined
  return (
    <article className="phase" aria-label={phase.name}>
      <header>
        <div>
          <b>{phase.name}</b> <span className="muted">{spanLabel(phase)}</span>
          {ownVenue && <p>At {venueLabel(ownVenue)}</p>}
          {phase.notes && <p>{phase.notes}</p>}
        </div>
        {phase.pending ? (
          <span className="pill pending">Waiting to sync</span>
        ) : (
          <button type="button" className="link" onClick={() => setEditing(!editing)} aria-expanded={editing}>
            Change
          </button>
        )}
      </header>
      <CalendarLine job={job} phase={phase} view={view} />
      <div className="pick-link">
        <a className="button" href={`#jobs/${job.id}/sheet/${phase.id}`}>
          Call sheet
        </a>
        <span>{contact ? `Contact on the day: ${contact.name}` : 'No contact on the day yet'}</span>
      </div>
      {editing && <EditPhase phase={phase} view={view} onDone={() => setEditing(false)} />}
      {outside.map((c) => (
        <p className="warn-line" key={c.id}>
          The {c.role} crew are asked for {daysLabel(c.days)}, outside {phase.name}.
        </p>
      ))}
      {phase.calls.map((c) => (
        <CallCard key={c.id} call={c} crew={view.crew} calendar={view.calendar} onShare={onShare(c)} inJob />
      ))}
    </article>
  )
}

function EditPhase({ phase, view, onDone }: { phase: PhaseView; view: View; onDone: () => void }) {
  const { venues } = view.jobs
  const [f, setF] = useState({ name: phase.name, start: phase.start, end: phase.end, venue: phase.venueId ? (phase.venue?.name ?? '') : '', notes: phase.notes })
  // A change of dates to a phase with crew waits here until the office says whether the crew move too.
  const [ask, setAsk] = useState<CommandInput<'phase.update'> | undefined>()
  const openCalls = phase.calls.filter((c) => c.status === 'open')
  const send = (changes: CommandInput<'phase.update'>) => void act(() => client.mutate('phase.update', changes)).then(onDone, (err: Error) => alert(err.message))
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return
    let asking = false
    void act(async () => {
      const changes: CommandInput<'phase.update'> = { id: phase.id }
      if (f.name.trim() !== phase.name) changes.name = f.name.trim()
      if (f.start !== phase.start) changes.start = f.start
      if (f.end !== phase.end) changes.end = f.end < f.start ? f.start : f.end
      if (f.notes.trim() !== phase.notes) changes.notes = f.notes.trim()
      const venueId = await venueNamed(f.venue, venues)
      if (venueId !== phase.venueId) changes.venueId = venueId
      if (Object.keys(changes).length === 1) return
      // A phase that only grows hasn't moved, so its crew stay on their days and there's nothing to ask.
      const to = { start: changes.start ?? phase.start, end: changes.end ?? phase.end }
      if ((changes.start !== undefined || changes.end !== undefined) && openCalls.length && !phaseOnlyGrew(phase, to)) {
        asking = true
        setAsk(changes)
        return
      }
      await client.mutate('phase.update', changes)
    }).then(() => asking || onDone(), (err: Error) => alert(err.message))
  }
  const remove = () => {
    if (phase.calls.some((c) => c.status === 'open')) return alert(`${phase.name} still has crew. Cancel its crew calls first.`)
    const kit = view.kit.lines.filter((l) => l.phaseId === phase.id)
    if (kit.length) return alert(`${phase.name} still has kit. Put it on the whole job or take it off first.`)
    if (confirm(`Remove ${phase.name}?`)) void act(() => client.mutate('phase.remove', { id: phase.id })).then(onDone)
  }
  return (
    <form className="grid-form" onSubmit={save}>
      {/* While the move question is open, the fields hold still: Move them and Keep their dates send what Save captured. */}
      <label className="wide">
        Phase <input list="phase-names-edit" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required disabled={!!ask} />
      </label>
      <label>
        From{' '}
        <input
          type="date"
          value={f.start}
          onChange={(e) => setF({ ...f, start: e.target.value, end: f.end < e.target.value ? e.target.value : f.end })}
          disabled={!!ask}
        />
      </label>
      <label>
        To <input type="date" value={f.end} min={f.start} onChange={(e) => setF({ ...f, end: e.target.value })} disabled={!!ask} />
      </label>
      <label className="wide">
        Venue{' '}
        <input list="phase-venue-names" value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} placeholder="The job's venue" disabled={!!ask} />
      </label>
      <label className="wide">
        Notes <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} disabled={!!ask} />
      </label>
      {ask && (
        <p className="warn-line wide" role="status">
          Move its {openCalls.length} crew call{openCalls.length === 1 ? '' : 's'} too? The days their crew hold move with them.
        </p>
      )}
      <div className="actions wide">
        {ask ? (
          <>
            <button type="button" className="primary" onClick={() => send({ ...ask, moveCrew: true })}>
              Move them
            </button>
            <button type="button" onClick={() => send(ask)}>
              Keep their dates
            </button>
            <button type="button" className="link" onClick={() => setAsk(undefined)}>
              Back
            </button>
          </>
        ) : (
          <>
            <button type="submit" className="primary">
              Save
            </button>
            <button type="button" onClick={onDone}>
              Cancel
            </button>
            <button type="button" className="link" onClick={remove}>
              Remove phase
            </button>
          </>
        )}
      </div>
      <Choices id="phase-venue-names" names={venues} />
      <datalist id="phase-names-edit">
        {PHASE_NAMES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </form>
  )
}

function AddPhase({ job }: { job: JobView }) {
  const last = job.phases.at(-1)
  const start = last?.end ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' })
  const [f, setF] = useState({ name: '', start, end: start })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return
    void act(() =>
      client.mutate('phase.add', { id: newId(), projectId: job.id, name: f.name.trim(), start: f.start, end: f.end < f.start ? f.start : f.end, venueId: null, notes: '' })
    ).catch((err: Error) => alert(err.message))
    setF({ name: '', start: f.end, end: f.end })
  }
  return (
    <form className="grid-form add-phase" onSubmit={submit} aria-label="Add a phase">
      <label className="wide">
        New phase <input list="phase-names-add" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Build, Show…" />
      </label>
      <label>
        From <input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value, end: f.end < e.target.value ? e.target.value : f.end })} />
      </label>
      <label>
        To <input type="date" value={f.end} min={f.start} onChange={(e) => setF({ ...f, end: e.target.value })} />
      </label>
      <button type="submit" className="wide">
        Add phase
      </button>
      <datalist id="phase-names-add">
        {PHASE_NAMES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </form>
  )
}

/** A role the job needs, for one phase or across several. */
function AskForCrew({ job }: { job: JobView }) {
  const firstPhase = job.phases[0]
  const blank = { phaseId: firstPhase?.id ?? '', across: '', role: '', needed: 1, callTime: '', rate: '', details: '' }
  const [f, setF] = useState(blank)
  const phase = job.phases.find((p) => p.id === f.phaseId)
  const span = phase ?? job.span
  const [dates, setDates] = useState<{ start: string; end: string } | undefined>()
  const start = dates?.start ?? span?.start ?? ''
  const end = dates?.end ?? span?.end ?? ''
  const venue = phase?.venue ?? job.venue

  if (!job.span) return <p className="empty">Add a phase first: crew are asked for by phase and day.</p>
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!f.role.trim() || !start) return
    void act(() =>
      client.mutate('call.create', {
        id: newId(),
        projectId: job.id,
        phaseId: phase?.id ?? null,
        project: job.name,
        phase: phase?.name ?? f.across.trim(),
        venue: venue ? venueLabel(venue) : '',
        role: f.role.trim(),
        start,
        end: end < start ? start : end,
        callTime: f.callTime || null,
        needed: Math.max(1, f.needed),
        dayRateCents: euroToCents(f.rate),
        details: f.details.trim(),
        replyBy: null,
      })
    ).catch((err: Error) => alert(err.message))
    setF({ ...blank, phaseId: f.phaseId })
    setDates(undefined)
  }
  return (
    <form className="grid-form" onSubmit={submit} aria-label="Ask for crew">
      <label className="wide">
        For
        <select
          aria-label="For which phase"
          value={f.phaseId}
          onChange={(e) => {
            setF({ ...f, phaseId: e.target.value })
            setDates(undefined)
          }}
        >
          {job.phases.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}, {spanLabel(p)}
            </option>
          ))}
          <option value="">Across several phases</option>
        </select>
      </label>
      {!phase && (
        <label className="wide">
          Which phases <input value={f.across} onChange={(e) => setF({ ...f, across: e.target.value })} placeholder="e.g. Build and Show" />
        </label>
      )}
      <label>
        Role <input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="Audio tech" required />
      </label>
      <label>
        How many <input type="number" min={1} value={f.needed} onChange={(e) => setF({ ...f, needed: Number(e.target.value) })} />
      </label>
      <label>
        From <input type="date" value={start} onChange={(e) => setDates({ start: e.target.value, end: end < e.target.value ? e.target.value : end })} />
      </label>
      <label>
        To <input type="date" value={end} min={start} onChange={(e) => setDates({ start, end: e.target.value })} />
      </label>
      <label>
        Call time <input type="time" value={f.callTime} onChange={(e) => setF({ ...f, callTime: e.target.value })} />
      </label>
      <label>
        Day rate € <input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="250" />
      </label>
      <label className="wide">
        Details for crew <textarea rows={2} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="Travel, food, parking, dress" />
      </label>
      <button type="submit" className="primary wide">
        Ask for crew
      </button>
    </form>
  )
}
