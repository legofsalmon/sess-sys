import { PURCHASE_NOT_YOURS, PURCHASE_WHO, roleCan, voteId, type CommandArgs, type CommandName } from '@sh/shared'
import { getPerson, personByEmail } from '../crew/store.ts'
import { emit, emitRemoved, Refused, type Ctx } from '../kernel.ts'
import { getPurchase, getVote } from './store.ts'

/**
 * The purchase list (ADR 0077). Anyone signed in asks for kit and votes,
 * one vote each; whoever asked changes or takes back their own, and those
 * who change stock anyone's, and say where each is at. Nothing here buys
 * anything or tells anyone outside the app: whoever asked hears of a
 * change in their Notifications, which read the history (ADR 0048).
 */

type PurchaseCommand = Extract<CommandName, `purchase.${string}`>
type Handler<N extends PurchaseCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

/** Who is doing it: the signed-in person; with sign-in off, whoever the device says, if they're in the app. */
async function whoIs(ctx: Ctx, by: string | null | undefined) {
  if (ctx.user) return personByEmail(ctx.tx, ctx.user.email)
  return by ? getPerson(ctx.tx, by) : undefined
}

async function mustRequest(ctx: Ctx, id: string, lock = false) {
  const r = await getPurchase(ctx.tx, id, lock)
  if (!r) throw new Refused({ code: 'not-found', message: "That request isn't on the purchase list any more." })
  return r
}

/** Whoever asked may change their own; anyone who changes stock, anyone's (and everyone, with roles off). */
async function mayChange(ctx: Ctx, askedBy: string | null) {
  if (!ctx.role || roleCan(ctx.role, 'stock')) return
  const me = await whoIs(ctx, undefined)
  if (!me || me.id !== askedBy) throw new Refused({ code: 'forbidden', message: PURCHASE_NOT_YOURS })
}

const emitRequest = async (ctx: Ctx, id: string) => emit(ctx, 'purchaseRequest', id, await getPurchase(ctx.tx, id))

export const purchaseHandlers: { [N in PurchaseCommand]: Handler<N> } = {
  async 'purchase.ask'(ctx, a) {
    if (await getPurchase(ctx.tx, a.id)) throw new Refused({ code: 'conflict', message: 'That request is on the list already.' })
    const me = await whoIs(ctx, a.by)
    await ctx.tx.query(
      `INSERT INTO purchase_requests (id, title, details, link, department, asked_by, asked_on, status)
       VALUES ($1, $2, $3, $4, $5, $6, (now() AT TIME ZONE 'Europe/Dublin')::date, 'asked')`,
      [a.id, a.title, a.details, a.link, a.department, me?.id ?? null]
    )
    await emitRequest(ctx, a.id)
  },

  async 'purchase.update'(ctx, a) {
    const r = await mustRequest(ctx, a.id, true)
    await mayChange(ctx, r.askedBy)
    await ctx.tx.query('UPDATE purchase_requests SET title = $2, details = $3, link = $4, department = $5 WHERE id = $1', [
      a.id,
      a.title ?? r.title,
      a.details ?? r.details,
      a.link ?? r.link,
      a.department === undefined ? r.department : a.department,
    ])
    await emitRequest(ctx, a.id)
  },

  async 'purchase.status'(ctx, a) {
    await mustRequest(ctx, a.id, true)
    await ctx.tx.query('UPDATE purchase_requests SET status = $2, notes = $3 WHERE id = $1', [a.id, a.status, a.notes])
    await emitRequest(ctx, a.id)
  },

  async 'purchase.remove'(ctx, a) {
    const r = await mustRequest(ctx, a.id, true)
    await mayChange(ctx, r.askedBy)
    const { rows } = await ctx.tx.query<{ id: string }>('DELETE FROM purchase_votes WHERE request_id = $1 RETURNING id', [a.id])
    for (const v of rows.map((x) => x.id).sort()) await emitRemoved(ctx, 'purchaseVote', v)
    await ctx.tx.query('DELETE FROM purchase_requests WHERE id = $1', [a.id])
    await emitRemoved(ctx, 'purchaseRequest', a.id)
  },

  async 'purchase.vote'(ctx, a) {
    await mustRequest(ctx, a.requestId)
    const me = await whoIs(ctx, a.by)
    if (!me) throw new Refused({ code: 'conflict', message: PURCHASE_WHO })
    const id = voteId(a.requestId, me.id)
    if (a.vote) {
      // Voting again is the same vote.
      if (await getVote(ctx.tx, id)) return
      await ctx.tx.query('INSERT INTO purchase_votes (id, request_id, person_id) VALUES ($1, $2, $3)', [id, a.requestId, me.id])
      await emit(ctx, 'purchaseVote', id, await getVote(ctx.tx, id))
    } else {
      const { rows } = await ctx.tx.query('DELETE FROM purchase_votes WHERE id = $1 RETURNING id', [id])
      if (rows.length) await emitRemoved(ctx, 'purchaseVote', id)
    }
  },

  async 'purchase.bringIn'(ctx, a) {
    for (const r of a.requests) {
      // Brought in before, it's left as it is: what has changed since in the app stays.
      if (await getPurchase(ctx.tx, r.id)) continue
      if (r.askedBy && !(await getPerson(ctx.tx, r.askedBy)))
        throw new Refused({ code: 'not-found', message: `Whoever asked for “${r.title}” isn't on the Crew tab any more. Choose the file again.` })
      await ctx.tx.query(
        `INSERT INTO purchase_requests (id, title, details, link, department, asked_by, asked_by_name, asked_on, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [r.id, r.title, r.details, r.link, r.department, r.askedBy, r.askedBy ? '' : r.askedByName, r.askedOn, r.status, r.notes]
      )
      await emitRequest(ctx, r.id)
    }
  },
}
