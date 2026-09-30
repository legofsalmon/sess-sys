import { MAX_NUMBER, numberText, plural, type CommandArgs } from '@sh/shared'
import { emit, Refused, type Ctx } from '../kernel.ts'
import { getLabelRun, nextNumber } from './store.ts'

/**
 * Labels (ADR 0015): the rules the server keeps for numbers set aside for
 * printing, whichever device asks.
 *
 * - the server picks the numbers, the next free ones after everything used
 *   or set aside, so two devices setting some aside at once never get the
 *   same ones, and the next free number for an item skips them;
 * - a run's numbers never change and a run is never taken back, since its
 *   labels may be printed already; numbers not stuck on simply stay unused.
 */

type LabelCommand = 'labels.reserve' | 'labels.update'
type Handler<N extends LabelCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

async function emitRun(ctx: Ctx, id: string) {
  await emit(ctx, 'labelRun', id, await getLabelRun(ctx.tx, id))
}

export const labelHandlers: { [N in LabelCommand]: Handler<N> } = {
  async 'labels.reserve'(ctx, a) {
    if (await getLabelRun(ctx.tx, a.id)) throw new Refused({ code: 'conflict', message: 'These numbers are set aside already.' })
    const first = await nextNumber(ctx.tx)
    const left = MAX_NUMBER - first + 1
    if (a.count > left)
      throw new Refused({
        code: 'conflict',
        message:
          left > 0
            ? `Only ${plural(left, 'number')} ${left === 1 ? 'is' : 'are'} left, from ${numberText(first)}. Set aside ${left === 1 ? 'that one' : 'those'} at most.`
            : 'Every six-digit number has been used or set aside.',
      })
    await ctx.tx.query(`INSERT INTO label_runs (id, first_number, count, name, notes) VALUES ($1, $2, $3, $4, $5)`, [
      a.id,
      first,
      a.count,
      a.name.trim(),
      a.notes.trim(),
    ])
    await emitRun(ctx, a.id)
  },

  async 'labels.update'(ctx, a) {
    if (!(await getLabelRun(ctx.tx, a.id))) throw new Refused({ code: 'not-found', message: 'Those labels are no longer on the list.' })
    const sets: string[] = []
    const values: unknown[] = [a.id]
    if (a.name !== undefined) sets.push(`name = $${values.push(a.name.trim())}`)
    if (a.notes !== undefined) sets.push(`notes = $${values.push(a.notes.trim())}`)
    await ctx.tx.query(`UPDATE label_runs SET ${sets.join(', ')} WHERE id = $1`, values)
    await emitRun(ctx, a.id)
  },
}
