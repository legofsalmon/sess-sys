import { roleKey, type CommandArgs, type Quote } from '@sh/shared'
import { emit, emitRemoved, Refused, type Ctx } from '../kernel.ts'
import { getTimesheet } from '../crew/timesheets.ts'
import { getClient, getProject } from '../projects/store.ts'
import { getModel } from '../stock/store.ts'
import { getClientDiscount, getCostPaid, getProductPrice, getQuote, getRolePrice, quotesOf } from './store.ts'

/**
 * Light finance (ADR 0042). The rules, wherever a change comes from:
 *
 * - a job has one draft at a time, and a new version is numbered after the
 *   last; only a draft changes, so what went to the client stays readable;
 * - the client's answer goes on the job's newest version that isn't a
 *   draft (or the draft itself, accepted by phone before it was sent):
 *   an older one has been replaced;
 * - only an accepted quote is invoiced, and only an invoiced one paid;
 *   each is a record of what happened outside the app, so it can be taken
 *   back, in the opposite order;
 * - once a quote is invoiced, the job's quote is settled: no new version.
 *
 * Sending the same change twice, as a phone may, changes nothing.
 */

type FinanceCommand = 'quote.save' | 'quote.sent' | 'quote.answer' | 'quote.invoiced' | 'quote.paid' | 'price.product' | 'price.role' | 'price.client' | 'cost.paid'
type Handler<N extends FinanceCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

const emitQuote = async (ctx: Ctx, id: string) => emit(ctx, 'quote', id, await getQuote(ctx.tx, id))

async function quoteFor(ctx: Ctx, id: string): Promise<Quote> {
  const q = await getQuote(ctx.tx, id, true)
  if (!q) throw new Refused({ code: 'not-found', message: 'That quote is no longer here.' })
  return q
}

/** Version 2 has been replaced by version 3: the client's answer, the invoice and the payment go on the one that counts. */
async function refuseIfReplaced(ctx: Ctx, q: Quote) {
  const versions = await quotesOf(ctx.tx, q.projectId)
  const current = versions.find((v) => v.invoicedOn) ?? versions.find((v) => v.status !== 'draft') ?? versions[0]
  if (current && current.id !== q.id && !(q.status === 'draft' && q.version > current.version))
    throw new Refused({ code: 'conflict', message: `Version ${q.version} has been replaced by version ${current.version}, so this goes on that one.` })
}

const settled = (q: Quote) =>
  q.status === 'accepted' ? `Version ${q.version} has been accepted` : q.status === 'declined' ? `Version ${q.version} was turned down` : `Version ${q.version} has gone to the client`

export const financeHandlers: { [N in FinanceCommand]: Handler<N> } = {
  async 'quote.save'(ctx, a) {
    const job = await getProject(ctx.tx, a.projectId, true)
    if (!job) throw new Refused({ code: 'not-found', message: 'That job no longer exists.' })
    const was = await getQuote(ctx.tx, a.id, true)
    if (was) {
      if (was.projectId !== a.projectId) throw new Refused({ code: 'invalid', message: 'That quote belongs to another job.' })
      if (was.status !== 'draft') throw new Refused({ code: 'conflict', message: `${settled(was)}, so it stays as it was. Start a new version to change it.` })
      await ctx.tx.query(`UPDATE quotes SET lines = $2, discount_pct = $3, notes = $4, saved_at = now() WHERE id = $1`, [
        a.id,
        JSON.stringify(a.lines),
        a.discountPct,
        a.notes.trim(),
      ])
      return emitQuote(ctx, a.id)
    }
    const versions = await quotesOf(ctx.tx, a.projectId)
    const invoiced = versions.find((v) => v.invoicedOn)
    if (invoiced) throw new Refused({ code: 'conflict', message: `Version ${invoiced.version} is invoiced, so the quote for ${job.name} is settled.` })
    const draft = versions.find((v) => v.status === 'draft')
    if (draft) throw new Refused({ code: 'conflict', message: `There's already a draft of this quote, version ${draft.version}: change that one.` })
    await ctx.tx.query(`INSERT INTO quotes (id, project_id, version, status, lines, discount_pct, notes) VALUES ($1, $2, $3, 'draft', $4, $5, $6)`, [
      a.id,
      a.projectId,
      (versions[0]?.version ?? 0) + 1,
      JSON.stringify(a.lines),
      a.discountPct,
      a.notes.trim(),
    ])
    await emitQuote(ctx, a.id)
  },

  async 'quote.sent'(ctx, a) {
    const q = await quoteFor(ctx, a.id)
    if (q.status !== 'draft') return
    if (q.lines.length === 0) throw new Refused({ code: 'invalid', message: 'This quote has no lines yet. Add what it is for first.' })
    await ctx.tx.query(`UPDATE quotes SET status = 'sent', sent_on = $2 WHERE id = $1`, [a.id, a.on])
    await emitQuote(ctx, a.id)
  },

  async 'quote.answer'(ctx, a) {
    const q = await quoteFor(ctx, a.id)
    if (q.invoicedOn) throw new Refused({ code: 'conflict', message: "This quote is invoiced, so the client's answer stays. Take the invoice back first." })
    if (a.answer === 'none') {
      if (q.status !== 'accepted' && q.status !== 'declined') return
      await ctx.tx.query(`UPDATE quotes SET status = 'sent', answered_on = NULL WHERE id = $1`, [a.id])
      return emitQuote(ctx, a.id)
    }
    if (q.status === a.answer && q.answeredOn === a.on) return
    await refuseIfReplaced(ctx, q)
    if (q.status === 'draft' && q.lines.length === 0) throw new Refused({ code: 'invalid', message: 'This quote has no lines yet. Add what it is for first.' })
    await ctx.tx.query(`UPDATE quotes SET status = $2, answered_on = $3, sent_on = coalesce(sent_on, $3) WHERE id = $1`, [a.id, a.answer, a.on])
    await emitQuote(ctx, a.id)
  },

  async 'quote.invoiced'(ctx, a) {
    const q = await quoteFor(ctx, a.id)
    if (a.on === null) {
      if (!q.invoicedOn) return
      if (q.paidOn) throw new Refused({ code: 'conflict', message: 'This invoice is marked paid. Take the payment back first.' })
      await ctx.tx.query(`UPDATE quotes SET invoiced_on = NULL, invoice_ref = '' WHERE id = $1`, [a.id])
      return emitQuote(ctx, a.id)
    }
    if (q.status !== 'accepted') throw new Refused({ code: 'conflict', message: "Only a quote the client accepted is invoiced. Record their answer first." })
    if (q.invoicedOn === a.on && q.invoiceRef === a.ref.trim()) return
    await refuseIfReplaced(ctx, q)
    await ctx.tx.query(`UPDATE quotes SET invoiced_on = $2, invoice_ref = $3 WHERE id = $1`, [a.id, a.on, a.ref.trim()])
    await emitQuote(ctx, a.id)
  },

  async 'quote.paid'(ctx, a) {
    const q = await quoteFor(ctx, a.id)
    if (q.paidOn === a.on) return
    if (a.on !== null && !q.invoicedOn) throw new Refused({ code: 'conflict', message: 'Mark it invoiced first: a payment is for an invoice.' })
    await ctx.tx.query(`UPDATE quotes SET paid_on = $2 WHERE id = $1`, [a.id, a.on])
    await emitQuote(ctx, a.id)
  },

  async 'price.product'(ctx, a) {
    if (!(await getModel(ctx.tx, a.modelId))) throw new Refused({ code: 'not-found', message: 'That product is no longer in the stock list.' })
    if (a.dayCents === null) {
      const { rows: gone } = await ctx.tx.query('DELETE FROM product_prices WHERE model_id = $1 RETURNING 1', [a.modelId])
      if (gone.length) await emitRemoved(ctx, 'productPrice', a.modelId)
      return
    }
    await ctx.tx.query(`INSERT INTO product_prices (model_id, day_cents) VALUES ($1, $2) ON CONFLICT (model_id) DO UPDATE SET day_cents = EXCLUDED.day_cents`, [a.modelId, a.dayCents])
    await emit(ctx, 'productPrice', a.modelId, await getProductPrice(ctx.tx, a.modelId))
  },

  async 'price.role'(ctx, a) {
    const key = roleKey(a.role)
    if (a.dayCents === null) {
      const { rows: gone } = await ctx.tx.query('DELETE FROM role_prices WHERE id = $1 RETURNING 1', [key])
      if (gone.length) await emitRemoved(ctx, 'rolePrice', key)
      return
    }
    await ctx.tx.query(`INSERT INTO role_prices (id, role, day_cents) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, day_cents = EXCLUDED.day_cents`, [
      key,
      a.role.trim().replace(/\s+/g, ' '),
      a.dayCents,
    ])
    await emit(ctx, 'rolePrice', key, await getRolePrice(ctx.tx, key))
  },

  async 'price.client'(ctx, a) {
    if (!(await getClient(ctx.tx, a.clientId))) throw new Refused({ code: 'not-found', message: 'That client no longer exists.' })
    if (a.pct === null) {
      const { rows: gone } = await ctx.tx.query('DELETE FROM client_discounts WHERE client_id = $1 RETURNING 1', [a.clientId])
      if (gone.length) await emitRemoved(ctx, 'clientDiscount', a.clientId)
      return
    }
    await ctx.tx.query(`INSERT INTO client_discounts (client_id, pct) VALUES ($1, $2) ON CONFLICT (client_id) DO UPDATE SET pct = EXCLUDED.pct`, [a.clientId, a.pct])
    await emit(ctx, 'clientDiscount', a.clientId, await getClientDiscount(ctx.tx, a.clientId))
  },

  async 'cost.paid'(ctx, a) {
    if (a.on === null) {
      const { rows: gone } = await ctx.tx.query('DELETE FROM cost_payments WHERE timesheet_id = $1 RETURNING 1', [a.id])
      if (gone.length) await emitRemoved(ctx, 'costPaid', a.id)
      return
    }
    const t = await getTimesheet(ctx.tx, a.id)
    if (t?.status !== 'approved') throw new Refused({ code: 'conflict', message: 'Only an approved timesheet is marked paid. Approve it first.' })
    if ((await getCostPaid(ctx.tx, a.id))?.paidOn === a.on) return
    await ctx.tx.query(`INSERT INTO cost_payments (timesheet_id, paid_on) VALUES ($1, $2) ON CONFLICT (timesheet_id) DO UPDATE SET paid_on = EXCLUDED.paid_on`, [a.id, a.on])
    await emit(ctx, 'costPaid', a.id, await getCostPaid(ctx.tx, a.id))
  },
}
