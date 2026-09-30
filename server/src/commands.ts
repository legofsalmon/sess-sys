import {
  commandSchemas,
  type CommandArgs,
  type CommandName,
  type Mutation,
  type MutationResult,
} from '@sh/shared'
import { newId } from '@sh/shared'
import { crewHandlers } from './crew/handlers.ts'
import { timesheetHandlers } from './crew/timesheets.ts'
import type { Db, Queryable } from './db.ts'
import { emit, Refused, type Ctx } from './kernel.ts'
import { projectHandlers } from './projects/handlers.ts'
import { stockHandlers } from './stock/handlers.ts'
import { kitHandlers } from './stock/kit.ts'
import { labelHandlers } from './stock/labels.ts'
import { faultHandlers } from './stock/faults.ts'
import { inspectionHandlers } from './stock/inspections.ts'
import { moveHandlers } from './stock/moves.ts'

/**
 * Where the server decides. Each mutation runs in its own transaction:
 * check it has not been seen before, validate it, apply it, write the
 * resulting changes to the feed, and record the answer. Either all of that
 * happens or none of it does, so a crash halfway through leaves the device
 * to resend and get a clean answer.
 */

export type Handler<N extends CommandName> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

const handlers: { [N in CommandName]: Handler<N> } = {
  async 'product.upsert'(ctx, a) {
    await ctx.tx.query(
      `INSERT INTO products (id, name, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, quantity = EXCLUDED.quantity`,
      [a.id, a.name, a.quantity]
    )
    await emit(ctx, 'product', a.id, a)
  },

  async 'booking.create'(ctx, a) {
    const existing = await ctx.tx.query('SELECT 1 FROM bookings WHERE id = $1', [a.id])
    if (existing.rows.length) throw new Refused({ code: 'conflict', message: 'This booking already exists.' })
    // Lock the product row so two bookings for it are checked one at a time.
    const { rows } = await ctx.tx.query<{ name: string; quantity: number }>(
      'SELECT name, quantity FROM products WHERE id = $1 FOR UPDATE',
      [a.productId]
    )
    const product = rows[0]
    if (!product) throw new Refused({ code: 'not-found', message: 'That product no longer exists.' })
    const used = await peakUse(ctx.tx, a.productId, a.start, a.end)
    const free = product.quantity - used
    if (a.qty > free) {
      const short = a.qty - Math.max(free, 0)
      throw new Refused({
        code: 'short',
        short,
        message: `Only ${Math.max(free, 0)} × ${product.name} free ${a.start === a.end ? `on ${a.start}` : `from ${a.start} to ${a.end}`}; ${short} more needed. Subhire or change the dates.`,
      })
    }
    await ctx.tx.query(
      `INSERT INTO bookings (id, product_id, project, qty, start_day, end_day, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed')`,
      [a.id, a.productId, a.project, a.qty, a.start, a.end]
    )
    await emit(ctx, 'booking', a.id, { ...a, status: 'confirmed' })
  },

  async 'booking.cancel'(ctx, a) {
    const { rows } = await ctx.tx.query<BookingRow>(
      `UPDATE bookings SET status = 'cancelled' WHERE id = $1
       RETURNING id, product_id, project, qty, start_day::text, end_day::text, status`,
      [a.id]
    )
    const row = rows[0]
    if (!row) throw new Refused({ code: 'not-found', message: 'That booking no longer exists.' })
    await emit(ctx, 'booking', a.id, bookingFromRow(row))
  },

  async 'scan.record'(ctx, a) {
    // A scan is never refused: the item is already on the truck. If it does
    // not match the plan, record it anyway and raise an issue for a person.
    const dup = await ctx.tx.query('SELECT 1 FROM scans WHERE id = $1', [a.id])
    if (dup.rows.length) return
    await ctx.tx.query('INSERT INTO scans (id, product_id, booking_id, direction, at) VALUES ($1, $2, $3, $4, $5)', [
      a.id,
      a.productId,
      a.bookingId,
      a.direction,
      a.at,
    ])
    await emit(ctx, 'scan', a.id, a)
    if (a.direction !== 'out') return

    let problem: { kind: 'scan-without-booking' | 'scan-over-booking'; message: string } | undefined
    if (!a.bookingId) {
      problem = { kind: 'scan-without-booking', message: 'Scanned out without a booking.' }
    } else {
      const { rows } = await ctx.tx.query<{ qty: number; status: string; project: string }>(
        'SELECT qty, status, project FROM bookings WHERE id = $1',
        [a.bookingId]
      )
      const b = rows[0]
      const { rows: counted } = await ctx.tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM scans WHERE booking_id = $1 AND product_id = $2 AND direction = 'out'`,
        [a.bookingId, a.productId]
      )
      const out = Number(counted[0]!.n)
      if (!b || b.status !== 'confirmed') problem = { kind: 'scan-without-booking', message: 'Scanned out against a booking that is not confirmed.' }
      else if (out > b.qty) problem = { kind: 'scan-over-booking', message: `${out} scanned out for ${b.project}, but only ${b.qty} booked.` }
    }
    if (problem) {
      const issueId = newId()
      await ctx.tx.query('INSERT INTO issues (id, kind, message, scan_id) VALUES ($1, $2, $3, $4)', [
        issueId,
        problem.kind,
        problem.message,
        a.id,
      ])
      await emit(ctx, 'issue', issueId, { id: issueId, ...problem, scanId: a.id, resolved: false })
    }
  },

  ...crewHandlers,
  ...projectHandlers,
  ...stockHandlers,
  ...kitHandlers,
  ...labelHandlers,
  ...moveHandlers,
  ...faultHandlers,
  ...inspectionHandlers,
  ...timesheetHandlers,
}

/**
 * The most units of a product booked on any single day in the range. Using
 * the peak, not the sum, means a booking on Monday and another on Friday do
 * not count against each other.
 */
async function peakUse(tx: Queryable, productId: string, start: string, end: string): Promise<number> {
  const { rows } = await tx.query<{ peak: number | null }>(
    `SELECT max(used)::int AS peak FROM (
       SELECT d, coalesce(sum(b.qty), 0) AS used
       FROM generate_series($2::date, $3::date, interval '1 day') AS d
       LEFT JOIN bookings b
         ON b.product_id = $1 AND b.status = 'confirmed' AND d BETWEEN b.start_day AND b.end_day
       GROUP BY d
     ) per_day`,
    [productId, start, end]
  )
  return rows[0]?.peak ?? 0
}

interface BookingRow {
  id: string
  product_id: string
  project: string
  qty: number
  start_day: string
  end_day: string
  status: 'confirmed' | 'cancelled'
}
function bookingFromRow(r: BookingRow) {
  return { id: r.id, productId: r.product_id, project: r.project, qty: r.qty, start: r.start_day, end: r.end_day, status: r.status }
}

/** Where a command came from, kept on it for the history (ADR 0006). */
export interface From {
  /**
   * 'link' or 'calendar' only when the server itself runs a command for a
   * person using their private link, or answering in Google Calendar; a
   * device can't claim either.
   */
  via?: Ctx['via']
  /** The signed-in member of staff whose device sent it: the history's "who". */
  userId?: string
  /** When the device sent it, by the device's own clock. */
  sentAt?: string
  /** The kind of device, such as "Safari on iPhone". */
  device?: string
}

export async function applyMutation(db: Db, clientId: string, m: Mutation, from: From = {}): Promise<MutationResult> {
  return db.transaction((tx) => applyMutationIn(tx, clientId, m, from))
}

/**
 * The same, as part of a transaction the caller already has, so the
 * command stands or falls with the caller's other changes: the calendar
 * sync records a crew member's answer and acts on it together.
 */
export async function applyMutationIn(tx: Queryable, clientId: string, m: Mutation, from: From = {}): Promise<MutationResult> {
  // One writer at a time; see `emit`. At Session Hire's volume (a few
  // people, hundreds of jobs a year) this costs nothing.
  await tx.query('SELECT pg_advisory_xact_lock(7331)')

  const seen = await tx.query<{ result: MutationResult }>('SELECT result FROM mutations WHERE id = $1', [m.id])
  if (seen.rows[0]) return { ...seen.rows[0].result, duplicate: true }

  const ctx: Ctx = { tx, mutationId: m.id, seq: 0, via: from.via ?? 'app' }
  let result: MutationResult
  // Record the mutation first so the changes it writes can point at it.
  // Arrival is read after taking the lock, so the history's order is the order changes were made in.
  await tx.query(
    `INSERT INTO mutations (id, client_id, user_id, name, args, created_at, sent_at, device, received_at, status, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, clock_timestamp(), 'applied', '{}')`,
    [m.id, clientId, from.userId ?? null, m.name, JSON.stringify(m.args), m.createdAt, from.sentAt ?? null, from.device ?? null]
  )
  const parsed = commandSchemas[m.name].safeParse(m.args)
  if (!parsed.success) {
    result = { id: m.id, status: 'rejected', reason: { code: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid request.' } }
  } else {
    try {
      await tx.query('SAVEPOINT cmd')
      await (handlers[m.name] as Handler<CommandName>)(ctx, parsed.data as never)
      await tx.query('RELEASE SAVEPOINT cmd')
      if (ctx.seq === 0) ctx.seq = await currentSeq(tx)
      result = { id: m.id, status: 'applied', seq: ctx.seq }
    } catch (err) {
      if (!(err instanceof Refused)) throw err
      await tx.query('ROLLBACK TO SAVEPOINT cmd')
      result = { id: m.id, status: 'rejected', reason: err.reason }
    }
  }
  await tx.query('UPDATE mutations SET status = $2, result = $3 WHERE id = $1', [m.id, result.status, JSON.stringify(result)])
  return result
}

export async function currentSeq(q: Queryable): Promise<number> {
  const { rows } = await q.query<{ seq: string | null }>('SELECT max(seq) AS seq FROM changes')
  return Number(rows[0]?.seq ?? 0)
}
