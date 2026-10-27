import { ERASED_REFUSAL, kindOf, STATUS_LABELS, STEP_NOT_YOURS, stepId, stepOwnerRefusal, STOPPED, type CommandArgs } from '@sh/shared'
import { getPerson, personByEmail } from '../crew/store.ts'
import { readErasure } from '../erasure/places.ts'
import { emit, Refused, type Ctx } from '../kernel.ts'
import { getProject } from '../projects/store.ts'
import { getStep } from './store.ts'

/**
 * A job's steps (ADR 0073). A step is given to a member of staff who isn't
 * archived or erased, on a gig or a dry hire going ahead or pencilled in;
 * taking a tick or a name off is always allowed, so a stopped job can be
 * tidied. Staff crew change only the steps that are theirs. Giving a step
 * to someone tells them in the app only, through Notifications, which
 * read the history: nothing here emails, texts or messages anyone.
 */

type Handler<N extends 'jobStep.set'> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

export const stepHandlers: { 'jobStep.set': Handler<'jobStep.set'> } = {
  async 'jobStep.set'(ctx, a) {
    const job = await getProject(ctx.tx, a.projectId, true)
    if (!job) throw new Refused({ code: 'not-found', message: 'That job is no longer in the app.' })
    const id = stepId(a.projectId, a.step)
    const was = await getStep(ctx.tx, id)
    const adds = (a.ownerId !== undefined && a.ownerId !== null && a.ownerId !== was?.ownerId) || (a.done === true && !was?.doneAt)
    if (adds && STOPPED.includes(job.status))
      throw new Refused({ code: 'conflict', message: `${job.name} is ${STATUS_LABELS[job.status].toLowerCase()}, so its steps are stopped.` })
    if (adds && kindOf(job) !== 'gig' && kindOf(job) !== 'hire') throw new Refused({ code: 'conflict', message: 'Errands and meetings have no steps.' })

    // Who is doing it: the signed-in person; with sign-in off, whoever the device says, if they're in the app.
    const me = ctx.user ? await personByEmail(ctx.tx, ctx.user.email) : undefined
    if (ctx.role === 'crew' && (!me || was?.ownerId !== me.id)) throw new Refused({ code: 'forbidden', message: STEP_NOT_YOURS })

    if (a.ownerId && a.ownerId !== was?.ownerId) {
      const owner = await getPerson(ctx.tx, a.ownerId)
      if (owner && (await readErasure(ctx.tx, owner.id))) throw new Refused({ code: 'conflict', message: ERASED_REFUSAL })
      const no = stepOwnerRefusal(owner)
      if (no) throw new Refused({ code: 'conflict', message: no })
    }
    const by = ctx.user ? (me?.id ?? null) : a.by ? ((await getPerson(ctx.tx, a.by))?.id ?? null) : null

    const owner = a.ownerId === undefined ? (was?.ownerId ?? null) : a.ownerId
    const ticked = a.done === undefined ? !!was?.doneAt : a.done
    // Ticked again is the same tick: when and by whom stay as they were.
    const keep = ticked && !!was?.doneAt
    await ctx.tx.query(
      `INSERT INTO job_steps (id, project_id, step, owner_id, done_at, done_by) VALUES ($1, $2, $3, $4, CASE WHEN $5::boolean THEN now() END, CASE WHEN $5::boolean THEN $6 END)
       ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id,
         done_at = CASE WHEN $7::boolean THEN job_steps.done_at ELSE EXCLUDED.done_at END,
         done_by = CASE WHEN $7::boolean THEN job_steps.done_by ELSE EXCLUDED.done_by END`,
      [id, a.projectId, a.step, owner, ticked, by, keep]
    )
    await emit(ctx, 'jobStep', id, await getStep(ctx.tx, id))
  },
}

