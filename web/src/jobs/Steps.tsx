import { dayLabel, firstName, irishToday, type JobView, type StepView, type View } from '@sh/shared'
import { useEffect, useState } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { peopleOn, promptFor, type Share } from '../crew/CrewScreen.tsx'
import { useMe } from '../crew/Leave.tsx'
import { Icon } from '../Icon.tsx'
import { useAccess } from '../role.ts'
import { Pending } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import type { JobPart } from './JobScreen.tsx'
import './steps.css'

/**
 * A job's steps (ADR 0073): the way the job goes, from the quote to the kit
 * checked and put away, as one line of steps across the top of the job
 * page, the step it's at marked, then the step picked open under it: what
 * it means, who it's down to, and its tick. The app ticks what it can tell
 * from the job's own records; the rest are ticked here. A step given to
 * someone is on their list on Home, and they hear of it in Notifications,
 * in the app only.
 *
 * The strip is how a job moves on (ADR 0103): the step it's at offers its
 * one next thing beside where it's at, and the Confirmed step is the
 * client's answer itself. Saying yes there confirms the job (and records the
 * yes on the quote that went), which is what puts it on the calendar and
 * holds its kit; saying no marks it lost. A tick by hand on Confirmed would
 * say the job was going ahead while it stayed an enquiry, so it has none.
 */

const PART_NAMES: Partial<Record<NonNullable<StepView['part']>, string>> = { crew: 'Crew', kit: 'Kit and vans', money: 'Quote', phases: 'Phases' }

export function StepsCard({ job, view, onPart, onTell }: { job: JobView; view: View; onPart: (p: JobPart) => void; onTell: (share: Share | undefined) => void }) {
  const steps = view.steps.of(job.id)
  const [open, setOpen] = useState<StepView['key'] | undefined>()
  // Moving to another job opens that job's own step.
  useEffect(() => setOpen(undefined), [job.id])
  if (!steps) return null
  if (steps.stopped && steps.steps.every((s) => !s.ownerId && !s.ticked)) {
    // An errand, a meeting, or a stopped job nobody had started on: a line, not a tracker.
    return (
      <section className="card job-steps" aria-label="Steps">
        <p className="hint">{steps.stopped}</p>
      </section>
    )
  }
  // A slim strip until a step is opened (ADR 0082), so the job's parts are on the first screen; the hint says where it's at meanwhile.
  const shown = steps.steps.find((s) => s.key === open)
  const at = steps.current
  // The way already come: every step before the one the job is at, all of them once it's through, none on a stopped job.
  const reached = at ? steps.steps.indexOf(at) : steps.stopped ? 0 : steps.steps.length
  return (
    <section className="card job-steps" aria-labelledby="job-steps-title">
      <header className="steps-head">
        <h2 id="job-steps-title">Steps</h2>
        <p className="hint">
          {steps.stopped ??
            (at
              ? `${steps.done} of ${steps.of} done · at ${at.label}${at.owner ? `, ${firstName(at.owner)}` : ''}`
              : `All ${steps.of} done`)}
        </p>
        {/* The one thing to do next, where the eye already is (Default Effect): the rest of the step opens under the dots. */}
        {at && !steps.stopped && shown?.key !== at.key && <NextThing job={job} view={view} step={at} onPart={onPart} onOpen={() => setOpen(at.key)} />}
      </header>
      <ol className="steps-flow" data-stopped={steps.stopped ? 'true' : undefined}>
        {steps.steps.map((s, i) => (
          <li key={s.key} data-state={s.state} data-come={i < reached ? 'true' : undefined} aria-current={s.state === 'now' && !steps.stopped ? 'step' : undefined}>
            <button type="button" aria-expanded={s.key === shown?.key} aria-controls="job-step-open" aria-label={stepName(s, steps.stopped !== undefined)} onClick={() => setOpen((was) => (was === s.key ? undefined : s.key))}>
              <span className="step-dot" aria-hidden="true">
                {s.done ? <Icon name="done" /> : s.number}
              </span>
              <span className="step-label" aria-hidden="true">
                {s.label}
              </span>
              <span className="step-owner" aria-hidden="true">
                {s.owner ? firstName(s.owner) : s.skipped ? 'Not needed' : ' '}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {shown && <OpenStep key={`${job.id}.${shown.key}`} job={job} view={view} step={shown} stopped={steps.stopped !== undefined} onPart={onPart} onTell={onTell} />}
    </section>
  )
}

/**
 * The step the job is at, as one button: the part of the job where it's done, or, at Confirmed, the step opened for the
 * client's answer. Nothing for a step that only happens (the show itself) or that this role can't act on.
 */
function NextThing({ job, view, step, onPart, onOpen }: { job: JobView; view: View; step: StepView; onPart: (p: JobPart) => void; onOpen: () => void }) {
  const access = useAccess()
  const href = `#jobs/${encodeURIComponent(job.id)}`
  switch (step.key) {
    case 'quote':
      if (!access.can('money')) return null
      return (
        <a className="button primary next-thing" href={`${href}/quote`}>
          {view.money.quotesOf(job.id).length ? 'Open the quote' : 'Make a quote'}
        </a>
      )
    case 'confirmed':
      if (!access.can('jobs')) return null
      return (
        <button type="button" className="primary next-thing" onClick={onOpen}>
          Record the client's answer
        </button>
      )
    case 'crew':
    case 'kit':
      return (
        <button type="button" className="primary next-thing" onClick={() => onPart(step.key as JobPart)}>
          Open {PART_NAMES[step.key as 'crew' | 'kit']}
        </button>
      )
    case 'prep':
    case 'back':
      return (
        <a className="button primary next-thing" href={`${href}/pick`}>
          Open the pick list
        </a>
      )
    default:
      return null
  }
}

/** What a screen reader hears for a step: its number and name, how it stands, and who has it. */
function stepName(s: StepView, stopped: boolean): string {
  const how = s.done ? 'done' : s.skipped ? 'not needed' : s.state === 'now' && !stopped ? 'the step the job is at' : 'to do'
  return `${s.number}. ${s.label}, ${how}${s.owner ? `, ${s.owner.name}` : ''}`
}

function OpenStep({
  job,
  view,
  step,
  stopped,
  onPart,
  onTell,
}: {
  job: JobView
  view: View
  step: StepView
  stopped: boolean
  onPart: (p: JobPart) => void
  onTell: (share: Share | undefined) => void
}) {
  const access = useAccess()
  const { me } = useMe(view)
  const { run, error } = useAct()
  // Staff crew change only their own steps (ADR 0073); the server says the same.
  const mayChange = access.can('steps') && (access.role !== 'crew' || (!!access.personId && step.ownerId === access.personId)) && !stopped
  const staff = view.leave.staff
  const set = (change: { ownerId?: string | null; done?: boolean }) =>
    run(async () => {
      await client.mutate('jobStep.set', { projectId: job.id, step: step.key, ...change, by: me?.id ?? null })
      // A quote sent another way (by hand, from Current RMS) moves an enquiry on, as marking one sent here does (ADR 0081).
      if (step.key === 'quote' && change.done && job.status === 'enquiry' && access.can('jobs')) await client.mutate('project.update', { id: job.id, status: 'quoted' })
    })
  // The client's answer is the job's own status, not a tick (ADR 0103).
  const answering = step.key === 'confirmed' && !step.ticked && job.status !== 'confirmed' && !stopped && access.can('jobs')
  const where = step.part === 'pick' ? undefined : step.part && PART_NAMES[step.part]
  const seesPart = step.part !== 'money' || access.can('money')
  return (
    <div className="step-open" id="job-step-open" aria-live="polite">
      <h3>
        {step.number}. {step.label} <Pending pending={step.pending} />
      </h3>
      <p className="step-state" data-state={step.state}>
        {step.auto
          ? `Done: ${step.auto}.`
          : step.ticked
            ? `Ticked done${step.ticked.by ? ` by ${step.ticked.by.name}` : ''}, ${dayLabel(irishToday(new Date(step.ticked.at)))}.`
            : step.skipped
              ? `Not needed: ${step.skipped}.`
              : `${step.hint ? `${step.hint}. ` : ''}${step.state === 'now' && !stopped ? 'This is the step the job is at.' : ''}`}
      </p>
      {/* The answer first, where the eye is: who it's down to can wait under it. */}
      {answering ? <ClientsAnswer job={job} view={view} onTell={onTell} /> : <p className="hint">{step.line}</p>}
      {mayChange ? (
        <div className="step-actions">
          <label className="field">
            Down to
            <select value={step.ownerId ?? ''} onChange={(e) => void set({ ownerId: e.target.value || null })}>
              <option value="">Nobody yet</option>
              {step.owner && !staff.some((p) => p.id === step.ownerId) && <option value={step.owner.id}>{step.owner.name}</option>}
              {staff.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.id === me?.id ? ' (you)' : ''}
                </option>
              ))}
            </select>
          </label>
          {me && step.ownerId !== me.id && access.role !== 'crew' && staff.some((p) => p.id === me.id) && (
            <button type="button" onClick={() => void set({ ownerId: me.id })}>
              Give it to me
            </button>
          )}
          {/* What the app ticks itself has no tick to give or take; a tick given by hand on top of it stays, out of the way. */}
          {!step.auto &&
            !answering &&
            (step.ticked ? (
              <button type="button" onClick={() => void set({ done: false })}>
                Take the tick off
              </button>
            ) : (
              !step.skipped && (
                <button type="button" className="primary" onClick={() => void set({ done: true })}>
                  Mark {step.label.toLowerCase()} done
                </button>
              )
            ))}
        </div>
      ) : (
        <p className="step-owner-line">{step.owner ? `Down to ${step.owner.name}.` : 'Not given to anyone yet.'}</p>
      )}
      <Refusal error={error} />
      {step.part === 'pick' && (
        <a className="button" href={`#jobs/${encodeURIComponent(job.id)}/pick`}>
          Open the pick list
        </a>
      )}
      {seesPart && where && !answering && (
        <button type="button" className="link" onClick={() => onPart(step.part as JobPart)}>
          Open {where}
        </button>
      )}
    </div>
  )
}

/**
 * The client's answer, on the Confirmed step (ADR 0103): yes confirms the job, which puts it on the calendar and holds
 * its kit; no marks it lost, which cancels its crew calls, so that one asks first. Either goes on the quote that went
 * too, when there is one waiting for an answer, so the quote and the job never say different things.
 */
function ClientsAnswer({ job, view, onTell }: { job: JobView; view: View; onTell: (share: Share | undefined) => void }) {
  const access = useAccess()
  const [asking, setAsking] = useState(false)
  const { run, error } = useAct()
  const today = irishToday()
  // The version that went to the client and is waiting on them; a draft is left to be finished and sent.
  const current = access.can('money') ? view.money.currentOf(job.id) : undefined
  const waiting = current && !current.invoicedOn && (current.status === 'sent' || current.status === 'accepted' || current.status === 'declined') ? current : undefined
  const people = job.calls.filter((c) => c.status === 'open').flatMap((c) => peopleOn(c))
  const answer = (yes: boolean) => {
    setAsking(false)
    void run(async () => {
      const said = yes ? 'accepted' : 'declined'
      if (waiting && waiting.status !== said) await client.mutate('quote.answer', { id: waiting.id, answer: said, on: today })
      await client.mutate('project.update', { id: job.id, status: yes ? 'confirmed' : 'lost' })
    }).then((ok) => ok && !yes && onTell(promptFor('job-stopped', people)))
  }
  return (
    <div className="clients-answer">
      <p>
        {waiting?.status === 'accepted'
          ? 'The client has said yes. Confirming the job puts it on the jobs calendar and holds its kit.'
          : waiting?.status === 'declined'
            ? 'The client turned the quote down. Mark the job lost, or confirm it if they came back.'
            : `Confirming the job puts it on the jobs calendar and holds its kit${waiting ? `, and records the yes on version ${waiting.version} of the quote` : ''}.`}
      </p>
      {asking ? (
        <Confirm
          question={`Marking ${job.name} lost also cancels its crew calls${
            people.length ? `: ${people.length === 1 ? '1 person' : `${people.length} people`} offered or booked will see it's withdrawn` : ''
          }.`}
          yes="Mark it lost"
          no="Keep it as it is"
          onYes={() => answer(false)}
          onNo={() => setAsking(false)}
        />
      ) : (
        <div className="step-actions">
          <button type="button" className="primary" onClick={() => answer(true)} disabled={job.pending}>
            Confirm the job
          </button>
          <button type="button" onClick={() => (job.calls.some((c) => c.status === 'open') ? setAsking(true) : answer(false))} disabled={job.pending}>
            The client said no
          </button>
        </div>
      )}
      <Refusal error={error} />
    </div>
  )
}
