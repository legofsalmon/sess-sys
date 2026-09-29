import type { EntityName, Rejection } from '@sh/shared'
import type { Queryable } from './db.ts'

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
  mutationId: string
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
