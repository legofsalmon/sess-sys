import { irishToday, newId, type DataStatus } from '@sh/shared'
import { newGeneration, readGeneration } from '../backup/format.ts'
import { readLink } from '../calendar/store.ts'
import { applyMutationIn, type From } from '../commands.ts'
import type { Db, Queryable } from '../db.ts'
import { ident, tablesInOrder } from '../tables.ts'
import { madeUpData } from './madeup.ts'

/**
 * Made-up data and starting fresh (ADR 0019). Made-up data goes into an
 * empty app, to try it out; starting fresh deletes everything, made-up or
 * not, before the real jobs, crew and stock go in. Both are records in
 * `server_meta`, which isn't backed up or exported, so they belong to this
 * copy of the data.
 */

/** Kept when starting fresh: who can sign in, the server's own bookkeeping, and which version each table is at. */
const KEPT = /^(users|sessions|server_meta|backup_runs|(\w+_)?schema_version)$/

/** What the history calls them. Not commands, so no device can send them. */
export const DATA_ACTIONS = { madeUp: 'data.made-up', fresh: 'data.fresh' } as const

/** Refused, with a reason a person can act on. */
export class DataRefused extends Error {}

interface Mark {
  at: string
  by: string | null
  /** For starting fresh: the generation it began, which tells devices to drop what they had waiting. */
  generation?: string
}

async function readMark(q: Queryable, key: 'made_up' | 'fresh'): Promise<Mark | null> {
  const { rows } = await q.query<{ value: string }>(`SELECT value FROM server_meta WHERE key = $1`, [key])
  return rows[0] ? (JSON.parse(rows[0].value) as Mark) : null
}

async function writeMark(q: Queryable, key: 'made_up' | 'fresh', mark: Mark) {
  await q.query(`INSERT INTO server_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(mark)])
}

/** Nothing has happened in the app since it began or started fresh. */
async function isEmpty(q: Queryable): Promise<boolean> {
  const { rows } = await q.query('SELECT 1 FROM changes LIMIT 1')
  return rows.length === 0
}

async function calendarConnected(q: Queryable): Promise<boolean> {
  const link = await readLink(q)
  return !!link && link.state !== 'off'
}

export async function dataStatus(q: Queryable, backups: boolean): Promise<DataStatus> {
  const [empty, madeUp, fresh, calendar] = await Promise.all([isEmpty(q), readMark(q, 'made_up'), readMark(q, 'fresh'), calendarConnected(q)])
  return {
    empty,
    madeUp: madeUp && { at: madeUp.at, by: madeUp.by },
    fresh: fresh && { at: fresh.at, by: fresh.by },
    calendarConnected: calendar,
    backups,
  }
}

/** Whether this generation began with someone starting fresh, so devices drop what they had waiting rather than send it. */
export async function startedFresh(q: Queryable, generation: string): Promise<boolean> {
  return (await readMark(q, 'fresh'))?.generation === generation
}

/**
 * Whether the app has started fresh since a device's copy, `generation`,
 * so what it made on that copy belongs to what was cleared. Read under the
 * command lock, so starting fresh can't come between this and the command.
 */
export async function clearedSince(q: Queryable, generation: string): Promise<boolean> {
  const current = await readGeneration(q)
  return current !== '' && current !== generation && (await startedFresh(q, current))
}

export interface Who {
  /** The signed-in member of staff, and their name for the Account tab. */
  userId?: string
  name?: string
  /** The app's device code, for the history. */
  clientId?: string
  device?: string
}

const deviceCode = (who: Who) => (who.clientId && /^[a-z0-9]{1,64}$/.test(who.clientId) ? who.clientId : 'server')

/**
 * Made-up data, into an empty app, all at once or not at all. Each command
 * goes through the same rules as a phone's; one turned down means the made-up
 * data is out of date with those rules, which a test catches first.
 */
export async function fillWithMadeUpData(db: Db, who: Who, now = new Date()): Promise<{ commands: number }> {
  const commands = madeUpData(irishToday(now))
  const from: From = { userId: who.userId, device: 'Made-up data' }
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(7331)')
    if (await calendarConnected(tx))
      throw new DataRefused('Disconnect Google Calendar first, above: the made-up jobs would go on it.')
    if (!(await isEmpty(tx))) throw new DataRefused('Made-up data only goes into an empty app. Start fresh first, then put it in.')
    for (const m of commands) {
      const result = await applyMutationIn(tx, 'server', m, from)
      if (result.status !== 'applied') throw new Error(`Made-up data: ${m.name} was turned down: ${result.reason.message}`)
    }
    await recordAction(tx, who, DATA_ACTIONS.madeUp, { commands: commands.length }, now)
    await writeMark(tx, 'made_up', { at: now.toISOString(), by: who.name ?? null })
  })
  return { commands: commands.length }
}

/**
 * Delete everything but the staff accounts, and start a new generation that
 * tells every device to empty its copy and drop what it has waiting. The one
 * entry left in the history says who did it and how much went.
 */
export async function startFresh(db: Db, who: Who, now = new Date()): Promise<{ rows: number; generation: string }> {
  return db.transaction(async (tx) => {
    // After every command in progress, and before the next.
    await tx.query('SELECT pg_advisory_xact_lock(7331)')
    if (await calendarConnected(tx))
      throw new DataRefused("Disconnect Google Calendar first, above: that takes the app's days off the calendar. Then start fresh.")
    const tables = (await tablesInOrder(tx)).filter((t) => !KEPT.test(t))
    let rows = 0
    for (const t of tables) {
      const { rows: counted } = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM ${ident(t)}`)
      rows += Number(counted[0]!.n)
    }
    await tx.query(`TRUNCATE ${tables.map(ident).join(', ')} RESTART IDENTITY`)
    const generation = await newGeneration(tx)
    await tx.query(`DELETE FROM server_meta WHERE key = 'made_up'`)
    await writeMark(tx, 'fresh', { at: now.toISOString(), by: who.name ?? null, generation })
    await recordAction(tx, who, DATA_ACTIONS.fresh, { rows }, now)
    return { rows, generation }
  })
}

/** In the history as that person's, like connecting a calendar. */
async function recordAction(tx: Queryable, who: Who, name: string, args: Record<string, unknown>, now: Date) {
  await tx.query(
    `INSERT INTO mutations (id, client_id, user_id, name, args, created_at, device, received_at, status, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp(), 'applied', '{}')`,
    [newId(), deviceCode(who), who.userId ?? null, name, JSON.stringify(args), now.toISOString(), who.device ?? null]
  )
}
