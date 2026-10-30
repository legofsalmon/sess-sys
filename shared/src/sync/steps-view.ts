import type { CommandArgs, Mutation } from '../commands.ts'
import { dayLabel } from '../crew.ts'
import { kindOf, STATUS_LABELS, STOPPED } from '../jobs.ts'
import { plural } from '../stock.ts'
import { JOB_STEPS, STEP_LABELS, STEP_LINES, stepId, type JobStep, type StepEntities, type StepRecord } from '../steps.ts'
import type { CrewView, PersonView } from './crew-view.ts'
import { crewFill, type JobsView, type JobView } from './jobs-view.ts'
import type { KitView } from './kit-view.ts'
import type { MoneyView } from './money-view.ts'
import type { MovesView } from './pick-view.ts'
import type { VehiclesView } from './vehicles-view.ts'

/**
 * A job's steps (ADR 0073) as a device sees them: who each is down to and
 * whether it's ticked, from what the server has sent with this device's own
 * waiting changes laid over it, and, for the steps the app can tell for
 * itself, whether it's done from the job's own records. Worked out on the
 * device, so the tracker and everyone's list hold with no signal, and a
 * tick the app gives can't go stale: it's read afresh each time.
 */

/** Done, not needed on this job, the one the job is at, or one still to come. */
export type StepState = 'done' | 'skipped' | 'now' | 'later'

export interface StepView {
  key: JobStep
  /** 1 to 8, in order. */
  number: number
  label: string
  line: string
  ownerId: string | null
  owner: PersonView | undefined
  /** Ticked by hand: when, and by whom. */
  ticked: { at: string; by: PersonView | undefined } | undefined
  /** Done as the app can tell from the job's records, in words ("All 6 calls booked"); undefined when it can't tell. */
  auto: string | undefined
  done: boolean
  /** Why it doesn't apply to this job ("No crew on a dry hire"); undefined when it does. */
  skipped: string | undefined
  /** How far along it is, while it isn't done ("3 of 5 calls booked"). */
  hint: string | undefined
  state: StepState
  /** The part of the job page or the page where the work is done. */
  part: 'phases' | 'crew' | 'kit' | 'money' | 'pick' | undefined
  pending: boolean
}

export interface JobSteps {
  job: JobView
  steps: StepView[]
  /** The step the job is at: the first not done and not passed over. Undefined once every step is done. */
  current: StepView | undefined
  done: number
  /** Of the steps that apply. */
  of: number
  /** Why the job has no steps to do: it's cancelled or lost, or it's an errand or a meeting. */
  stopped: string | undefined
}

export interface MyStep {
  job: JobView
  step: StepView
  /** It's the step the job is at, so it's theirs to do now. */
  next: boolean
}

export interface StepsView {
  of(jobId: string): JobSteps | undefined
  /** A person's steps not done yet, on jobs going ahead or pencilled in: the ones the job is at first, then by the job's first day. */
  mine(personId: string): MyStep[]
}

type Tables = { [E in keyof StepEntities]: Record<string, StepEntities[E]> }

/** Jobs with steps: gigs and dry hires. Errands and meetings are done in a day and need none. */
export const hasSteps = (job: Pick<JobView, 'kind'>) => kindOf(job) === 'gig' || kindOf(job) === 'hire'

const PART: Record<JobStep, StepView['part']> = {
  quote: 'money',
  confirmed: 'money',
  crew: 'crew',
  kit: 'kit',
  prep: 'pick',
  show: 'phases',
  back: 'pick',
  deprep: 'pick',
}

export function stepsView(
  entities: Partial<Tables>,
  outbox: readonly (Mutation & { appliedSeq?: number })[],
  cursor: number,
  jobs: JobsView,
  crew: CrewView,
  kit: KitView,
  moves: MovesView,
  money: MoneyView,
  vehicles: VehiclesView,
  today: string
): StepsView {
  // Snapshots saved before steps have no table for them.
  const records = new Map<string, StepRecord & { pending: boolean }>()
  for (const r of Object.values(entities.jobStep ?? {})) records.set(r.id, { ...r, pending: false })
  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    if (m.name !== 'jobStep.set') continue
    const a = m.args as CommandArgs<'jobStep.set'>
    const key = stepId(a.projectId, a.step)
    const was = records.get(key) ?? { id: key, projectId: a.projectId, step: a.step, ownerId: null, doneAt: null, doneBy: null }
    const ticked = a.done === undefined ? was.doneAt !== null : a.done
    records.set(key, {
      ...was,
      ownerId: a.ownerId === undefined ? was.ownerId : a.ownerId,
      // A tick kept stays as it was given: ticking again isn't a new tick.
      doneAt: ticked ? (was.doneAt ?? m.createdAt) : null,
      doneBy: ticked ? (was.doneAt ? was.doneBy : (a.by ?? null)) : null,
      pending: true,
    })
  }
  const people = new Map(crew.people.map((p) => [p.id, p]))
  const jobById = new Map(jobs.jobs.map((j) => [j.id, j]))

  /** What the app can tell of each step for itself: done, in words, or how far along, or not needed. */
  function told(job: JobView): Record<JobStep, { auto?: string; hint?: string; skipped?: string }> {
    const quotes = money.quotesOf(job.id)
    const sent = quotes.find((q) => q.status === 'sent' || q.status === 'accepted')
    const accepted = quotes.find((q) => q.status === 'accepted')
    const draft = quotes.find((q) => q.status === 'draft')
    const crewOn = crewFill(job.calls)
    const lines = kit.byJob.get(job.id) ?? []
    const short = lines.filter((l) => l.short > 0).length
    const vans = vehicles.ofJob(job.id).length
    const pick = lines.length ? moves.pickList(job.id) : undefined
    const onKit = pick?.rows.filter((r) => r.lines.length > 0) ?? []
    const wentOut = onKit.reduce((n, r) => n + Math.min(r.out + r.back + r.missing, r.need), 0)
    const anyOut = pick ? pick.stillOut + pick.back + pick.missing > 0 : false
    const over = job.span !== undefined && job.span.end < today
    const on = job.span !== undefined && job.span.start <= today && today <= job.span.end
    return {
      quote: sent
        ? { auto: sent.sentOn ? `Sent ${dayLabel(sent.sentOn)}` : 'Sent' }
        : job.status === 'quoted' || job.status === 'confirmed'
          ? { auto: `The job is ${STATUS_LABELS[job.status].toLowerCase()}` }
          : { hint: draft ? 'A draft is started' : 'No quote yet' },
      // Only the job's own status is the yes (ADR 0103): it's what puts the job on the calendar and holds its kit, so a
      // quote accepted on a job still an enquiry is the step to take, not a step done.
      confirmed:
        job.status === 'confirmed'
          ? { auto: 'The job is confirmed' }
          : accepted
            ? { hint: `The client said yes${accepted.answeredOn ? ` ${dayLabel(accepted.answeredOn)}` : ''}, and the job is still ${STATUS_LABELS[job.status].toLowerCase()}` }
            : { hint: `Still ${STATUS_LABELS[job.status].toLowerCase()}` },
      crew:
        crewOn.needed === 0
          ? kindOf(job) === 'hire'
            ? { skipped: 'No crew on a dry hire' }
            : { hint: 'No crew asked for yet' }
          : crewOn.booked >= crewOn.needed
            ? { auto: `All ${crewOn.needed} crew booked` }
            : { hint: `${crewOn.booked} of ${crewOn.needed} booked${crewOn.toConfirm ? `, ${crewOn.toConfirm} to confirm` : ''}` },
      kit: {
        hint: lines.length
          ? [plural(lines.length, 'line') + ' of kit', short ? `${short} short` : '', vans ? plural(vans, 'vehicle') : ''].filter(Boolean).join(', ')
          : 'No kit on the job yet',
      },
      prep:
        pick && pick.need > 0 && wentOut >= pick.need
          ? { auto: 'Everything went out' }
          : pick && pick.need > 0
            ? { hint: `${wentOut} of ${pick.need} out` }
            : { hint: 'No kit to pick yet' },
      show: over
        ? { auto: `Finished ${dayLabel(job.span!.end)}` }
        : on
          ? { hint: 'On now' }
          : { hint: job.span ? `Starts ${dayLabel(job.span.start)}` : 'No dates yet' },
      back:
        anyOut && pick!.stillOut === 0
          ? { auto: pick!.missing ? `All back but ${pick!.missing} missing` : 'All back' }
          : anyOut
            ? { hint: `${pick!.stillOut} still out` }
            : { hint: 'Nothing out yet' },
      deprep: {},
    }
  }

  const built = new Map<string, JobSteps>()
  function of(jobId: string): JobSteps | undefined {
    const ready = built.get(jobId)
    if (ready) return ready
    const job = jobById.get(jobId)
    if (!job) return undefined
    const stopped = STOPPED.includes(job.status)
      ? `This job is ${STATUS_LABELS[job.status].toLowerCase()}, so its steps are stopped.`
      : !hasSteps(job)
        ? 'Errands and meetings have no steps.'
        : undefined
    const what = told(job)
    let current: StepView | undefined
    const steps = JOB_STEPS.map((key, i): StepView => {
      const r = records.get(stepId(job.id, key))
      const t = what[key]
      const ticked = r?.doneAt ? { at: r.doneAt, by: r.doneBy ? people.get(r.doneBy) : undefined } : undefined
      const done = !!ticked || !!t.auto
      const skipped = done ? undefined : t.skipped
      const step: StepView = {
        key,
        number: i + 1,
        label: STEP_LABELS[key],
        line: STEP_LINES[key],
        ownerId: r?.ownerId ?? null,
        owner: r?.ownerId ? people.get(r.ownerId) : undefined,
        ticked,
        auto: t.auto,
        done,
        skipped,
        hint: done || skipped ? undefined : t.hint,
        state: done ? 'done' : skipped ? 'skipped' : current ? 'later' : 'now',
        part: PART[key],
        pending: r?.pending ?? false,
      }
      if (step.state === 'now') current = step
      return step
    })
    const applies = steps.filter((s) => !s.skipped)
    const out: JobSteps = { job, steps, current: stopped ? undefined : current, done: applies.filter((s) => s.done).length, of: applies.length, stopped }
    built.set(jobId, out)
    return out
  }

  return {
    of,
    mine(personId) {
      const out: MyStep[] = []
      const seen = new Set<string>()
      for (const r of records.values()) {
        if (r.ownerId !== personId || seen.has(r.projectId)) continue
        seen.add(r.projectId)
        const s = of(r.projectId)
        if (!s || s.stopped) continue
        for (const step of s.steps) if (step.ownerId === personId && !step.done && !step.skipped) out.push({ job: s.job, step, next: step === s.current })
      }
      const first = (j: JobView) => j.span?.start ?? '9999'
      return out.sort((a, b) => Number(b.next) - Number(a.next) || first(a.job).localeCompare(first(b.job)) || a.job.name.localeCompare(b.job.name) || a.step.number - b.step.number)
    },
  }
}
