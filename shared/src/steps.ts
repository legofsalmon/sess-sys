import { z } from 'zod'

/**
 * A job's steps (ADR 0073): the way every gig and dry hire goes, from the
 * quote to the kit checked and put away again, one step after another,
 * each with a member of staff it's down to. Where the app already knows a
 * step is done (the quote sent, every call booked, all the kit back) it
 * says so itself; the rest are ticked by hand. A step given to someone is
 * on their own list on Home, and they hear of it in Notifications, in the
 * app only: nobody is emailed or texted (ADR 0048).
 *
 * The list is the same for every job, in this order. A step that doesn't
 * apply (crew on a dry hire with none asked for) says so and is passed over.
 */
export const JOB_STEPS = ['quote', 'confirmed', 'crew', 'kit', 'prep', 'show', 'back', 'deprep'] as const
export type JobStep = (typeof JOB_STEPS)[number]

/** Each step's name, as the tracker shows it. */
export const STEP_LABELS: Record<JobStep, string> = {
  quote: 'Quote sent',
  confirmed: 'Confirmed',
  crew: 'Crew booked',
  kit: 'Kit and vans',
  prep: 'Picked',
  show: 'On the job',
  back: 'Back in',
  deprep: 'Deprepped',
}

/** What it means for each step to be done, in a sentence. */
export const STEP_LINES: Record<JobStep, string> = {
  quote: 'The quote is written and sent to the client.',
  confirmed: 'The client has said yes, and the job is going ahead.',
  crew: 'Every crew call has someone for every day.',
  kit: 'The kit list and the vans are settled.',
  prep: 'Everything on the pick list has gone out of the warehouse.',
  show: 'The job has happened.',
  back: 'Everything that went out is back in the warehouse.',
  deprep: 'The kit is checked, cleaned and put away, and any faults reported.',
}

/** A step's record: who it's down to, and the tick, when it was ticked by hand. */
export interface StepRecord {
  /** The job and the step, together: one record each. */
  id: string
  projectId: string
  step: JobStep
  /** The member of staff it's down to; null for nobody yet. */
  ownerId: string | null
  /** When it was ticked by hand, and by whom (null when the app couldn't tell). */
  doneAt: string | null
  doneBy: string | null
}

export interface StepEntities {
  jobStep: StepRecord
}
export const STEP_ENTITY_NAMES = ['jobStep'] as const

/** One record a step of a job, so two devices giving the same step land on the same one. */
export const stepId = (projectId: string, step: JobStep) => `${projectId}.${step}`

const id = z.string().min(1).max(64)

export const stepCommandSchemas = {
  /**
   * Give a step to someone or to nobody, tick it or take the tick off: only
   * what's said changes. `by` is who ticked it, as the device knows them,
   * for a copy with sign-in off; signed in, the server knows.
   */
  'jobStep.set': z
    .object({
      projectId: id,
      step: z.enum(JOB_STEPS),
      ownerId: id.nullable().optional(),
      done: z.boolean().optional(),
      by: id.nullable().optional(),
    })
    .refine((a) => a.ownerId !== undefined || a.done !== undefined, { message: 'Nothing to change.' }),
} as const

/** Why a step can't be given to this person, or undefined when it can: staff only, as they're the ones with a list. */
export function stepOwnerRefusal(p: { name: string; kind: 'staff' | 'freelancer'; archived?: boolean } | undefined): string | undefined {
  if (!p) return "That person isn't in the app any more."
  if (p.archived) return `${p.name} has been archived; give the step to someone else.`
  if (p.kind !== 'staff') return `${p.name} is a freelancer. Steps are for staff, who see them on Home.`
  return undefined
}

/** Staff crew may tick or hand on only a step that's theirs; everyone above them, any step (ADR 0073). */
export const STEP_NOT_YOURS = 'Staff crew can change only a step that is theirs. Ask the office or a head of department to give it to you.'
