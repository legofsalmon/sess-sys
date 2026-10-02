import {
  calendarTitles,
  crewFill,
  daysLabel,
  eachDay,
  mapLink,
  movedCallSpan,
  newId,
  parseEuro,
  phaseOnCalendar,
  phaseOnlyGrew,
  PHASE_NAMES,
  PROJECT_STATUSES,
  STATUS_LABELS,
  STOPPED,
  spanLabel,
  suggestedReplyBy,
  venueLabel,
  type CallView,
  type CommandInput,
  type JobView,
  type PersonView,
  type PhaseOnCalendar,
  type PhaseView,
  type ProjectStatus,
  type View,
} from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { CallCard, peopleOn, promptFor, SharePanelFor, type Share } from '../crew/CrewScreen.tsx'
import { Empty } from '../Empty.tsx'
import { Fold } from '../Fold.tsx'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { useToday } from '../view.ts'
import { Choices, clientNamed, JobStatusPill, Page, venueNamed } from './common.tsx'
import { KitCard, kitSummary } from './Kit.tsx'

/**
 * One job: what it is, its phases and how each will read on the calendar,
 * its kit (ADR 0014) and its crew. Crew calls made here belong to the job
 * and its phase, so freelancers always see the job's current name, dates
 * and venue.
 */

export function JobScreen({ view, id, bare }: { view: View; id: string; bare?: boolean }) {
  const job = view.jobs.jobs.find((j) => j.id === id)
  // An offer to send, or the people to tell after a withdrawal or a stopped job (audit finding 9): one panel at a time.
  const [share, setShare] = useState<Share | undefined>()
  const back = (
    <a className="back" href="#jobs">
      ‹ All jobs
    </a>
  )
  if (!job)
    return (
      <Page view={view} className="crew jobs" back={back} bare={bare}>
        <section className="card">
          <p className="empty">This job isn't on this device. It may still be on its way: check again once it says “Up to date”.</p>
        </section>
      </Page>
    )
  const onShare = (call: CallView) => (person: PersonView) => setShare({ kind: 'offer', person, call })
  const stopped = STOPPED.includes(job.status)
  // Sending an offer opens beside the call it's for: under the phases, or over the crew across phases. People to tell open under the job's details.
  const panel = share && <SharePanelFor share={share} onClose={() => setShare(undefined)} />
  const offering = share?.kind === 'offer' && panel
  const telling = share?.kind === 'tell' && panel
  const inPhase = share?.kind === 'offer' && job.phases.some((p) => p.id === share.call.phaseId)

  return (
    <Page view={view} className="crew jobs" back={back} bare={bare}>
      <Summary job={job} view={view} onTell={setShare} />
      {telling}

      <section className="card" aria-label="Phases">
        <h2>Phases</h2>
        {job.phases.length === 0 && <Empty>Add the first phase below, so the job has dates.</Empty>}
        {job.phases.map((p) => (
          <Phase key={p.id} job={job} phase={p} view={view} onShare={onShare} onTell={setShare} />
        ))}
        <Fold label="Add phase">
          <AddPhase job={job} />
        </Fold>
      </section>

      {inPhase && offering}
      <KitCard job={job} view={view} />
      {!inPhase && offering}

      <section className="card" aria-label="Crew">
        <h2>Crew</h2>
        {job.otherCalls.length > 0 && <p className="hint">Across phases:</p>}
        {job.otherCalls.map((c) => (
          <CallCard key={c.id} call={c} crew={view.crew} calendar={view.calendar} onShare={onShare(c)} onTell={setShare} inJob />
        ))}
        {stopped ? (
          <p className="empty">This job is {job.status === 'lost' ? 'lost' : 'cancelled'}, so it needs no crew.</p>
        ) : !job.span ? (
          <p className="empty">Add a phase first: crew are asked for by phase and day.</p>
        ) : (
          <Fold label="Ask for crew">
            <AskForCrew job={job} />
          </Fold>
        )}
      </section>
    </Page>
  )
}

function Summary({ job, view, onTell }: { job: JobView; view: View; onTell: (share: Share | undefined) => void }) {
  const [editing, setEditing] = useState(false)
  const crew = crewFill(job.calls)
  const kit = kitSummary(job, view.kit.byJob.get(job.id) ?? [])
  return (
    <section className="card">
      <header className="title">
        <h1>{job.name}</h1>
        <JobStatusPill status={job.status} pending={job.pending} />
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
        <EditJob job={job} view={view} onDone={() => setEditing(false)} onTell={onTell} />
      ) : (
        <button type="button" onClick={() => setEditing(true)}>
          Change details
        </button>
      )}
    </section>
  )
}

/** Only what was changed is sent, so someone else's change to another detail stands (ADR 0007). */
function EditJob({ job, view, onDone, onTell }: { job: JobView; view: View; onDone: () => void; onTell: (share: Share | undefined) => void }) {
  const { clients, venues } = view.jobs
  const [f, setF] = useState({ name: job.name, client: job.client?.name ?? '', venue: job.venue?.name ?? '', status: job.status, notes: job.notes })
  // Stopping a job with crew out waits here until the office says so, with the fields held still.
  const [asking, setAsking] = useState(false)
  const { run, error } = useAct()
  const stopping = STOPPED.includes(f.status) && !STOPPED.includes(job.status)
  // Everyone offered or booked on the job's open calls: told it's off once it's stopped.
  const people = job.calls.filter((c) => c.status === 'open').flatMap((c) => peopleOn(c))
  const send = () => {
    setAsking(false)
    void run(async () => {
      const changes: CommandInput<'project.update'> = { id: job.id }
      if (f.name.trim() !== job.name) changes.name = f.name.trim()
      if (f.status !== job.status) changes.status = f.status
      if (f.notes.trim() !== job.notes) changes.notes = f.notes.trim()
      const clientId = await clientNamed(f.client, clients)
      if (clientId !== job.clientId) changes.clientId = clientId
      const venueId = await venueNamed(f.venue, venues)
      if (venueId !== job.venueId) changes.venueId = venueId
      if (Object.keys(changes).length > 1) await client.mutate('project.update', changes)
    }).then((ok) => {
      if (!ok) return
      onDone()
      if (stopping) onTell(promptFor('job-stopped', people))
    })
  }
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return
    if (stopping && job.calls.some((c) => c.status === 'open')) return setAsking(true)
    send()
  }
  return (
    <form className="grid-form" onSubmit={save}>
      <label className="wide">
        Job <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required disabled={asking} />
      </label>
      <label>
        Client <input list="edit-client-names" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} disabled={asking} />
      </label>
      <label>
        Venue <input list="edit-venue-names" value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} disabled={asking} />
      </label>
      <label className="wide">
        Status
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ProjectStatus })} disabled={asking}>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="wide">
        Notes <textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} disabled={asking} />
      </label>
      <Refusal error={error} className="wide" />
      {asking ? (
        <Confirm
          className="wide"
          question={`Marking ${job.name} ${STATUS_LABELS[f.status].toLowerCase()} also cancels its crew calls${
            people.length ? `: ${people.length === 1 ? '1 person' : `${people.length} people`} offered or booked will see it's withdrawn` : ''
          }.`}
          yes={`Mark it ${STATUS_LABELS[f.status].toLowerCase()}`}
          no="Keep it as it is"
          onYes={send}
          onNo={() => setAsking(false)}
        />
      ) : (
        <div className="actions wide">
          <button type="submit" className="primary">
            Save
          </button>
          <button type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      )}
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
function CalendarLine({ job, phase, on, today }: { job: JobView; phase: PhaseView; on: PhaseOnCalendar; today: string }) {
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

function Phase({
  job,
  phase,
  view,
  onShare,
  onTell,
}: {
  job: JobView
  phase: PhaseView
  view: View
  onShare: (c: CallView) => (p: PersonView) => void
  onTell: (share: Share | undefined) => void
}) {
  const [editing, setEditing] = useState(false)
  const today = useToday()
  const outside = phase.calls.filter((c) => c.status === 'open' && (c.start < phase.start || c.end > phase.end))
  const ownVenue = phase.venueId && phase.venueId !== job.venueId ? phase.venue : undefined
  const contact = phase.contactId ? view.crew.people.find((p) => p.id === phase.contactId) : undefined
  const on = phaseOnCalendar(job, phase, view.calendar.link, view.calendar.days, today)
  // A calendar line to act on stays in view; the rest of the phase's details wait behind a tap (audit finding 16).
  const calendarWarns = on.state === 'paused' || on.state === 'failed'
  return (
    <article className="phase" aria-label={phase.name}>
      <header>
        <div>
          <b>{phase.name}</b> <span className="muted">{spanLabel(phase)}</span>
          {ownVenue && <p>At {venueLabel(ownVenue)}</p>}
        </div>
        {/* A phase still waiting to sync can be changed too: the change waits behind it, in order. */}
        <div className="actions">
          <Pending pending={phase.pending} />
          <button type="button" className="link" onClick={() => setEditing(!editing)} aria-expanded={editing}>
            Change
          </button>
        </div>
      </header>
      {calendarWarns && <CalendarLine job={job} phase={phase} on={on} today={today} />}
      <details className="phase-details">
        <summary>{phase.notes ? 'Running order, call sheet, calendar' : 'Call sheet and calendar'}</summary>
        <div>
          {phase.notes && <p className="notes">{phase.notes}</p>}
          {!calendarWarns && <CalendarLine job={job} phase={phase} on={on} today={today} />}
          <div className="pick-link">
            <a className="button" href={`#jobs/${job.id}/sheet/${phase.id}`}>
              Call sheet
            </a>
            <span>{contact ? `Contact on the day: ${contact.name}` : 'No contact on the day yet'}</span>
          </div>
        </div>
      </details>
      {editing && <EditPhase phase={phase} view={view} onDone={() => setEditing(false)} onTell={onTell} />}
      {outside.map((c) => (
        <p className="warn-line" key={c.id}>
          The {c.role} crew are asked for {daysLabel(c.days)}, outside {phase.name}.
        </p>
      ))}
      {phase.calls.map((c) => (
        <CallCard
          key={c.id}
          call={c}
          crew={view.crew}
          calendar={view.calendar}
          onShare={onShare(c)}
          onTell={onTell}
          inJob
          phaseDays={c.start === phase.start && c.end === phase.end}
        />
      ))}
    </article>
  )
}

function EditPhase({ phase, view, onDone, onTell }: { phase: PhaseView; view: View; onDone: () => void; onTell: (share: Share | undefined) => void }) {
  const { venues } = view.jobs
  const [f, setF] = useState({ name: phase.name, start: phase.start, end: phase.end, venue: phase.venueId ? (phase.venue?.name ?? '') : '', notes: phase.notes })
  // A change of dates to a phase with crew waits here until the office says whether the crew move too.
  const [ask, setAsk] = useState<CommandInput<'phase.update'> | undefined>()
  const [removing, setRemoving] = useState(false)
  const { run, error, refuse } = useAct()
  const openCalls = phase.calls.filter((c) => c.status === 'open')
  // Everyone on the phase's open calls, with the days the move gives each call. Their own days move with it, so the message gives the call's and the page has the rest.
  const movedPeople = (changes: CommandInput<'phase.update'>) => {
    const to = { start: changes.start ?? phase.start, end: changes.end ?? phase.end }
    return openCalls.flatMap((c) => {
      const span = movedCallSpan(c, phase, to)
      return peopleOn({ ...c, ...span, days: eachDay(span.start, span.end) }).map((t) => ({ ...t, context: { ...t.context, days: undefined } }))
    })
  }
  const send = (changes: CommandInput<'phase.update'>) =>
    void run(() => client.mutate('phase.update', changes)).then((ok) => {
      if (!ok) return
      onDone()
      if (changes.moveCrew) onTell(promptFor('phase-moved', movedPeople(changes)))
    })
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return
    let asking = false
    void run(async () => {
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
    }).then((ok) => ok && !asking && onDone())
  }
  const remove = () => {
    if (phase.calls.some((c) => c.status === 'open')) return refuse(`${phase.name} still has crew. Cancel its crew calls first.`)
    const kit = view.kit.lines.filter((l) => l.phaseId === phase.id)
    if (kit.length) return refuse(`${phase.name} still has kit. Put it on the whole job or take it off first.`)
    setRemoving(true)
  }
  const held = !!ask || removing
  return (
    <form className="grid-form" onSubmit={save}>
      {/* While a question is open, the fields hold still: Move them and Keep their dates send what Save captured. */}
      <label className="wide">
        Phase <input list="phase-names-edit" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required disabled={held} />
      </label>
      <label>
        From{' '}
        <input
          type="date"
          value={f.start}
          onChange={(e) => setF({ ...f, start: e.target.value, end: f.end < e.target.value ? e.target.value : f.end })}
          disabled={held}
        />
      </label>
      <label>
        To <input type="date" value={f.end} min={f.start} onChange={(e) => setF({ ...f, end: e.target.value })} disabled={held} />
      </label>
      <label className="wide">
        Venue{' '}
        <input list="phase-venue-names" value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} placeholder="The job's venue" disabled={held} />
      </label>
      <label className="wide">
        Notes <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} disabled={held} />
      </label>
      {ask && (
        <p className="warn-line wide" role="status">
          Move its {openCalls.length} crew call{openCalls.length === 1 ? '' : 's'} too? The days their crew hold move with them.
        </p>
      )}
      <Refusal error={error} className="wide" />
      {removing && (
        <Confirm
          className="wide"
          question={`Remove ${phase.name}? Its days come off the job and the calendar.`}
          yes="Remove it"
          onYes={() => {
            setRemoving(false)
            void run(() => client.mutate('phase.remove', { id: phase.id })).then((ok) => ok && onDone())
          }}
          onNo={() => setRemoving(false)}
        />
      )}
      <div className="actions wide" hidden={removing}>
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
  const today = useToday()
  const start = last?.end ?? today
  const [f, setF] = useState({ name: '', start, end: start })
  const { run, error } = useAct()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return
    // Ready for the next phase, starting where this one ends; a refusal brings what was typed back, unless the next thing has been typed since.
    const cleared = { name: '', start: f.end, end: f.end }
    setF(cleared)
    void run(() =>
      client.mutate('phase.add', { id: newId(), projectId: job.id, name: f.name.trim(), start: f.start, end: f.end < f.start ? f.start : f.end, venueId: null, notes: '' })
    ).then((ok) => {
      if (!ok) setF((now) => (now === cleared ? f : now))
    })
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
      <Refusal error={error} className="wide" />
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
  // The reply-by day is suggested from the first day until the office types or clears it (audit finding 21).
  const blank = { phaseId: undefined as string | undefined, across: '', role: '', needed: 1, callTime: '', rate: '', details: '', replyBy: undefined as string | undefined }
  const [f, setF] = useState(blank)
  // The phase picked ('' is across several), while the job still has it. Until then, the job's first phase as it is
  // now rather than when the page opened, so a job that had no phases then starts on the first one added.
  const picked = f.phaseId === '' || job.phases.some((p) => p.id === f.phaseId) ? f.phaseId : undefined
  const phaseId = picked ?? job.phases[0]?.id ?? ''
  const phase = job.phases.find((p) => p.id === phaseId)
  const span = phase ?? job.span
  const [dates, setDates] = useState<{ start: string; end: string } | undefined>()
  const start = dates?.start ?? span?.start ?? ''
  const end = dates?.end ?? span?.end ?? ''
  const venue = phase?.venue ?? job.venue
  const today = useToday()
  const replyBy = f.replyBy ?? (start ? (suggestedReplyBy(start, end < start ? start : end, today) ?? '') : '')
  const { run, error, refuse } = useAct()

  if (!job.span) return <p className="empty">Add a phase first: crew are asked for by phase and day.</p>
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!f.role.trim() || !start) return
    const rate = parseEuro(f.rate)
    if (rate.reason !== undefined) return refuse(rate.reason)
    // Ready for the next call; a refusal brings what was typed back, unless the next thing has been typed since.
    const cleared = { ...blank, phaseId: f.phaseId }
    setF(cleared)
    setDates(undefined)
    void run(() =>
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
        dayRateCents: rate.cents,
        details: f.details.trim(),
        replyBy: replyBy || null,
      })
    ).then((ok) => {
      if (ok) return
      setF((now) => (now === cleared ? f : now))
      setDates((now) => now ?? dates)
    })
  }
  return (
    <form className="grid-form" onSubmit={submit} aria-label="Ask for crew">
      <label className="wide">
        For
        <select
          aria-label="For which phase"
          value={phaseId}
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
        Reply by <input type="date" value={replyBy} onChange={(e) => setF({ ...f, replyBy: e.target.value })} />
      </label>
      <p className="hint wide">Two days before the first day, or the day before when the job is close. Clear it if there's no hurry.</p>
      <label className="wide">
        Details for crew <textarea rows={2} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="Travel, food, parking, dress" />
      </label>
      <Refusal error={error} className="wide" />
      <button type="submit" className="primary wide">
        Ask for crew
      </button>
    </form>
  )
}
