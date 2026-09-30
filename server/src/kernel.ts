import { newId, type EntityName, type Rejection } from '@sh/shared'
import type { Db, Queryable } from './db.ts'

/**
 * What every command handler, in any module, works with. Kept apart from
 * commands.ts so module handlers (crew, and later warehouse and finance) can
 * import it without a cycle.
 */

/** Throw from a handler to turn the command down with a reason a person can act on. */
export class Refused extends Error {
  constructor(readonly reason: Rejection) {
    super(reason.message)
  }
}

export interface Ctx {
  tx: Queryable
  /** The command the changes belong to, for the history; null for the server's own bookkeeping. */
  mutationId: string | null
  /** Last sequence number written in this transaction. */
  seq: number
  /** Where the command came from: a device running the app, or a person's private link. */
  via: 'app' | 'link'
}

/**
 * Append to the change feed. Commits are serialised by the advisory lock
 * taken in `applyMutation`, so sequence numbers become visible in order and
 * a device pulling "after N" can never skip one that commits late.
 */
export async function emit(ctx: Ctx, entity: EntityName, id: string, data: unknown) {
  const { rows } = await ctx.tx.query<{ seq: string }>(
    'INSERT INTO changes (entity, entity_id, op, data, mutation_id) VALUES ($1, $2, $3, $4, $5) RETURNING seq',
    [entity, id, 'put', JSON.stringify(data), ctx.mutationId]
  )
  ctx.seq = Number(rows[0]!.seq)
}

/** Tell devices a record is gone. */
export async function emitRemoved(ctx: Ctx, entity: EntityName, id: string) {
  const { rows } = await ctx.tx.query<{ seq: string }>(
    `INSERT INTO changes (entity, entity_id, op, data, mutation_id) VALUES ($1, $2, 'delete', NULL, $3) RETURNING seq`,
    [entity, id, ctx.mutationId]
  )
  ctx.seq = Number(rows[0]!.seq)
}

/** Something the server does at a person's request outside the sync commands, such as connecting a calendar. */
export interface ServerAction {
  /** How the history knows it, such as `calendar.connect`. Not a command, so no device can send it. */
  name: string
  args: Record<string, unknown>
  /** The app's device code, when the request came from the app. */
  clientId?: string
  userId?: string
  device?: string
}

/**
 * Change records outside a device's command, under the same lock as
 * `applyMutation`, so the change feed stays in order. With an `action`, the
 * changes go in the history as that person's; without one they are the
 * server's own bookkeeping (the calendar sync saying how far it has got),
 * which isn't anyone's change and isn't in the history.
 */
export async function serverChange<T>(db: Db, action: ServerAction | undefined, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(7331)')
    const mutationId = action ? newId() : null
    if (action) {
      const clientId = action.clientId && /^[a-z0-9]{1,64}$/.test(action.clientId) ? action.clientId : 'server'
      await tx.query(
        `INSERT INTO mutations (id, client_id, user_id, name, args, created_at, device, received_at, status, result)
         VALUES ($1, $2, $3, $4, $5, now(), $6, clock_timestamp(), 'applied', '{}')`,
        [mutationId, clientId, action.userId ?? null, action.name, JSON.stringify(action.args), action.device ?? null]
      )
    }
    return fn({ tx, mutationId, seq: 0, via: 'app' })
  })
}
