import { dayLabel, firstName, irishToday, type JobView, type StepView, type View } from '@sh/shared'
import { useEffect, useState } from 'react'
import { Refusal, useAct } from '../act.tsx'
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
 */

const PART_NAMES: Partial<Record<NonNullable<StepView['part']>, string>> = { crew: 'Crew', kit: 'Kit and vans', money: 'Quote', phases: 'Phases' }

export function StepsCard({ job, view, onPart }: { job: JobView; view: View; onPart: (p: JobPart) => void }) {
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
  const shown = steps.steps.find((s) => s.key === open) ?? steps.current ?? steps.steps[steps.steps.length - 1]!
  const at = steps.current
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
      </header>
      <ol className="steps-flow" data-stopped={steps.stopped ? 'true' : undefined}>
        {steps.steps.map((s) => (
          <li key={s.key} data-state={s.state} aria-current={s.state === 'now' && !steps.stopped ? 'step' : undefined}>
            <button type="button" aria-pressed={s.key === shown.key} aria-controls="job-step-open" aria-label={stepName(s, steps.stopped !== undefined)} onClick={() => setOpen(s.key)}>
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
      <OpenStep key={`${job.id}.${shown.key}`} job={job} view={view} step={shown} stopped={steps.stopped !== undefined} onPart={onPart} />
    </section>
  )
}

/** What a screen reader hears for a step: its number and name, how it stands, and who has it. */
function stepName(s: StepView, stopped: boolean): string {
  const how = s.done ? 'done' : s.skipped ? 'not needed' : s.state === 'now' && !stopped ? 'the step the job is at' : 'to do'
  return `${s.number}. ${s.label}, ${how}${s.owner ? `, ${s.owner.name}` : ''}`
}

function OpenStep({ job, view, step, stopped, onPart }: { job: JobView; view: View; step: StepView; stopped: boolean; onPart: (p: JobPart) => void }) {
  const access = useAccess()
  const { me } = useMe(view)
  const { run, error } = useAct()
  // Staff crew change only their own steps (ADR 0073); the server says the same.
  const mayChange = access.can('steps') && (access.role !== 'crew' || (!!access.personId && step.ownerId === access.personId)) && !stopped
  const staff = view.leave.staff
  const set = (change: { ownerId?: string | null; done?: boolean }) =>
    run(() => client.mutate('jobStep.set', { projectId: job.id, step: step.key, ...change, by: me?.id ?? null }))
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
      <p className="hint">{step.line}</p>
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
      {seesPart && where && (
        <button type="button" className="link" onClick={() => onPart(step.part as JobPart)}>
          Open {where}
        </button>
      )}
    </div>
  )
}
