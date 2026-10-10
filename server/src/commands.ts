import {
  cleanText,
  commandSchemas,
  type CommandArgs,
  type CommandName,
  type Mutation,
  type MutationResult,
} from '@sh/shared'
import { crewHandlers } from './crew/handlers.ts'
import { lateHandlers } from './crew/late.ts'
import { timesheetHandlers } from './crew/timesheets.ts'
import type { Db, Queryable } from './db.ts'
import { documentHandlers } from './documents/handlers.ts'
import { attachmentHandlers } from './documents/attachments.ts'
import { argsToStore, erasureHandlers, refuseIfErased } from './erasure/handlers.ts'
import { CHARACTERS, isCharacterError, Refused, type Ctx } from './kernel.ts'
import { leaveHandlers } from './leave/handlers.ts'
import { reportError } from './monitoring.ts'
import { officeHandlers } from './office/handlers.ts'
import { projectHandlers } from './projects/handlers.ts'
import { stockHandlers } from './stock/handlers.ts'
import { kitHandlers } from './stock/kit.ts'
import { labelHandlers } from './stock/labels.ts'
import { faultHandlers } from './stock/faults.ts'
import { inspectionHandlers } from './stock/inspections.ts'
import { moveHandlers } from './stock/moves.ts'
import { countHandlers } from './stock/counts.ts'

/**
 * Where the server decides. Each mutation runs in its own transaction:
 * check it has not been seen before, validate it, apply it, write the
 * resulting changes to the feed, and record the answer. Either all of that
 * happens or none of it does, so a crash halfway through leaves the device
 * to resend and get a clean answer.
 */

export type Handler<N extends CommandName> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

const handlers: { [N in CommandName]: Handler<N> } = {
  ...crewHandlers,
  ...projectHandlers,
  ...stockHandlers,
  ...kitHandlers,
  ...labelHandlers,
  ...moveHandlers,
  ...faultHandlers,
  ...inspectionHandlers,
  ...timesheetHandlers,
  ...officeHandlers,
  ...leaveHandlers,
  ...lateHandlers,
  ...erasureHandlers,
  ...documentHandlers,
  ...countHandlers,
  ...attachmentHandlers,
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
  /** The same account with its email, for the handlers that check who is asking (ADR 0024). */
  user?: { id: string; email: string }
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
export async function applyMutationIn(tx: Queryable, clientId: string, m: Mutation, from: From = {}, log?: Log): Promise<MutationResult> {
  // One writer at a time; see `emit`. At Session Hire's volume (a few
  // people, hundreds of jobs a year) this costs nothing.
  await tx.query('SELECT pg_advisory_xact_lock(7331)')

  const seen = await tx.query<{ result: MutationResult }>('SELECT result FROM mutations WHERE id = $1', [m.id])
  if (seen.rows[0]) return { ...seen.rows[0].result, duplicate: true }
  // A command this version doesn't have, such as the old sync test's (ADR 0001), from a phone still on
  // an older version. It can never apply, so it's turned down in words and nothing is kept, the history
  // included: a resend gets the same answer anyway, and the rest of the push carries on.
  if (!Object.hasOwn(commandSchemas, m.name)) return { id: m.id, status: 'rejected', reason: { code: 'invalid', message: UNKNOWN } }

  const ctx: Ctx = { tx, mutationId: m.id, seq: 0, via: from.via ?? 'app', ...(from.user ? { user: from.user } : {}) }
  let result: MutationResult
  // Record the mutation first so the changes it writes can point at it.
  // Arrival is read after taking the lock, so the history's order is the order changes were made in.
  // About someone erased on request, only what erasing keeps is stored, even of a change turned down (ADR 0027).
  // Its text is cleaned as the schema will clean it, so a NUL from an older version of the app can't fail the push.
  const stored = cleanArgs(await argsToStore(tx, m.name, m.args))
  await tx.query(
    `INSERT INTO mutations (id, client_id, user_id, name, args, created_at, sent_at, device, received_at, status, result)
     VALUES ($1, $2, $3, $4, $5, coalesce($6::timestamptz, clock_timestamp()), $7, $8, clock_timestamp(), 'applied', '{}')`,
    [m.id, clientId, from.userId ?? null, m.name, JSON.stringify(stored), timestampOrNull(m.createdAt), from.sentAt ?? null, from.device ?? null]
  )
  const parsed = commandSchemas[m.name].safeParse(m.args)
  if (!parsed.success) {
    result = { id: m.id, status: 'rejected', reason: { code: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid request.' } }
  } else {
    try {
      await tx.query('SAVEPOINT cmd')
      await refuseIfErased(tx, m.name, parsed.data)
      await (handlers[m.name] as Handler<CommandName>)(ctx, parsed.data as never)
      await tx.query('RELEASE SAVEPOINT cmd')
      if (ctx.seq === 0) ctx.seq = await currentSeq(tx)
      result = { id: m.id, status: 'applied', seq: ctx.seq }
    } catch (err) {
      // Whatever went wrong, the transaction takes nothing more until the
      // savepoint is rolled back. If even that fails the connection is gone,
      // and failing the whole push is right.
      await tx.query('ROLLBACK TO SAVEPOINT cmd')
      if (err instanceof Refused) {
        result = { id: m.id, status: 'rejected', reason: err.reason }
      } else if (isCharacterError(err)) {
        // A character the database can't hold, in a part nobody types (typed text is cleaned): what was sent, not
        // the server's fault, so it's turned down like any refusal and not reported. Before the calendar's own
        // case, as trying it again next round would only find the same character.
        log?.info({ command: m.name }, 'Turned down a change with a character the database cannot hold')
        result = { id: m.id, status: 'rejected', reason: { code: 'invalid', message: CHARACTERS } }
      } else {
        // The calendar sync runs an answer inside its own round and tries
        // again next time: it wants the fault, not a change dropped for good.
        if (ctx.via === 'calendar') throw err
        // The server's fault, not the device's: a database error the handler
        // didn't see coming, or a bug. Thrown, it would fail the whole push,
        // and the phone would show "No signal" and resend the same batch for
        // ever, with every later change stuck behind it. So the change is
        // dropped with a reason the person can read, recorded like any other
        // refusal so a resend gets the same answer, and logged and reported
        // by the command's name, never with what was in it.
        log?.warn({ err, command: m.name }, 'Dropped a change the server could not apply')
        reportError(err, { area: 'commands', command: m.name })
        result = { id: m.id, status: 'rejected', reason: { code: 'invalid', message: DROPPED } }
      }
    }
  }
  await tx.query('UPDATE mutations SET status = $2, result = $3 WHERE id = $1', [m.id, result.status, JSON.stringify(result)])
  return result
}

/**
 * A command's arguments as the history keeps them: every piece of text,
 * keys too, cleaned as the schemas clean typed text. They're stored before
 * they're checked, so a change from an older version of the app with a NUL
 * in it is still recorded, and applied as cleaned, rather than failing the
 * whole push.
 */
function cleanArgs(v: unknown): unknown {
  if (typeof v === 'string') return cleanText(v)
  if (Array.isArray(v)) return v.map(cleanArgs)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [cleanText(k), cleanArgs(x)]))
  return v
}

const DROPPED = "The server couldn't apply this change, so it was dropped. Check it and send it again."
const UNKNOWN = "The app doesn't do this any more, so it wasn't made."

/** Where a dropped change is noted, besides the error report, and a refused one: the request's log. */
export interface Log {
  warn(detail: object, message: string): void
  info(detail: object, message: string): void
}

/**
 * A device's own timestamp, as Postgres will always take it, or null when it
 * isn't one. Checked here, mutation by mutation, rather than in the push's
 * schema: the insert runs outside the savepoint, so a value Postgres
 * refused would fail the whole push and strand the device just the same,
 * and a schema check would turn the whole push away instead.
 */
function timestampOrNull(s: string): string | null {
  const ms = Date.parse(s)
  if (Number.isNaN(ms)) return null
  // Only a four-digit year: Postgres has no year 0, and JavaScript writes a
  // year beyond 9999 (or before 0) in a form Postgres doesn't read.
  const iso = new Date(ms).toISOString()
  return /^[1-9]\d{3}-/.test(iso) ? iso : null
}

export async function currentSeq(q: Queryable): Promise<number> {
  const { rows } = await q.query<{ seq: string | null }>('SELECT max(seq) AS seq FROM changes')
  return Number(rows[0]?.seq ?? 0)
}
