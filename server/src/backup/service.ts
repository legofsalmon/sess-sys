import { newId, type BackupRun, type BackupStatus } from '@sh/shared'
import type { Db } from '../db.ts'
import { pgliteDb } from '../db.ts'
import { BackupError, isEmptyDatabase, restoreBackup, writeBackup, type RestoreReport } from './format.ts'
import type { BackupStore, StoredFile } from './store.ts'

/**
 * The nightly backup (ADR 0004). Each run copies the database to a file,
 * puts the file in the store, then proves it by restoring it into a scratch
 * database in memory and checking every table. Only a run that gets through
 * all of that counts as a good backup. Old files are then thinned out:
 * every night for 35 days, then the first of each month for a year.
 *
 * The schedule lives in memory and asks the database nothing between runs,
 * so a quiet database can go to sleep (Neon stops charging when it does).
 */

export const PREFIX = 'backups/'
const HOUR = 3_600_000
const DAY = 24 * HOUR
/** A good backup older than this means the nightly run has stopped working. */
const FRESH_FOR = 26 * HOUR
/** A run still marked running after this long died partway (a restart, say). */
const STALE_RUN = 30 * 60_000
/** "Back up now" is refused this soon after another run. */
const MANUAL_GAP = 5 * 60_000

export interface Retention {
  days: number
  months: number
  /** Never thin below this many, whatever the clock says. */
  atLeast: number
}
export const RETENTION: Retention = { days: 35, months: 12, atLeast: 7 }

interface Log {
  info(obj: object, msg: string): void
  warn(obj: object, msg: string): void
  error(obj: object, msg: string): void
}

/** Something outside the server watching the backups, such as Sentry (ADR 0005). */
export interface BackupWatch {
  /** A run is under way; whatever this returns comes back to `finished`. */
  started(trigger: BackupRun['trigger']): unknown
  finished(handle: unknown, run: BackupRun): void
  /** A scheduled run couldn't even begin, for example with the database unreachable. */
  couldNotStart(err: unknown): void
}

export interface BackupsOptions {
  log?: Log
  watch?: BackupWatch
  now?: () => Date
  /** Hour of the day, in UTC, for the nightly run. 02:00 UTC is 3am in Dublin in summer, 2am in winter. */
  hourUtc?: number
  /** Which code is running, recorded in each file. */
  commit?: string
  retention?: Retention
}

export class Busy extends Error {}

export class Backups {
  private last: BackupRun | undefined
  private lastOk: BackupRun | undefined
  private timer: NodeJS.Timeout | undefined
  private nextAt: Date | undefined
  private failuresInARow = 0
  private stopped = false
  private readonly now: () => Date

  constructor(
    private readonly db: Db,
    readonly store: BackupStore | undefined,
    private readonly options: BackupsOptions = {}
  ) {
    this.now = options.now ?? (() => new Date())
  }

  /** Read the last runs once, at start-up. */
  async load() {
    const { rows } = await this.db.query<RunRow>(`SELECT ${RUN_COLUMNS} FROM backup_runs ORDER BY started_at DESC LIMIT 1`)
    const { rows: ok } = await this.db.query<RunRow>(`SELECT ${RUN_COLUMNS} FROM backup_runs WHERE status = 'ok' ORDER BY started_at DESC LIMIT 1`)
    this.last = rows[0] && fromRow(rows[0])
    this.lastOk = ok[0] && fromRow(ok[0])
    return this
  }

  status(): BackupStatus {
    if (!this.store) return { configured: false, fresh: false }
    const finished = this.lastOk?.finishedAt ? Date.parse(this.lastOk.finishedAt) : undefined
    return {
      configured: true,
      where: this.store.where,
      last: this.last,
      lastOk: this.lastOk,
      fresh: finished !== undefined && this.now().getTime() - finished < FRESH_FOR,
      next: this.nextAt?.toISOString(),
    }
  }

  /**
   * One backup, start to finish. Refused while another is running (on this
   * server or, during a deploy, the one it is replacing), and for "Back up
   * now" within a few minutes of the last one.
   */
  async run(trigger: BackupRun['trigger']): Promise<BackupRun> {
    const store = this.store
    if (!store) throw new BackupError('Backups are off: no storage is set up on the server yet.')
    const id = newId()
    const began = await this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(7332)')
      await tx.query(
        `UPDATE backup_runs SET status = 'failed', finished_at = now(), error = 'Stopped partway (the server restarted).'
          WHERE status = 'running' AND started_at < now() - make_interval(secs => $1)`,
        [STALE_RUN / 1000]
      )
      const { rows } = await tx.query<{ status: string; recent: boolean }>(
        `SELECT status, started_at > now() - make_interval(secs => $1) AS recent FROM backup_runs ORDER BY started_at DESC LIMIT 1`,
        [MANUAL_GAP / 1000]
      )
      const latest = rows[0]
      if (latest?.status === 'running') return false
      if (trigger === 'manual' && latest?.recent) return false
      await tx.query(`INSERT INTO backup_runs (id, status, trigger) VALUES ($1, 'running', $2)`, [id, trigger])
      return true
    })
    if (!began) throw new Busy('A backup ran a moment ago or is running now. Try again in a few minutes.')

    const log = this.options.log
    const at = this.now()
    const watching = this.options.watch?.started(trigger)
    let run: BackupRun
    try {
      const backup = await writeBackup(this.db, { now: at, commit: this.options.commit })
      const key = backupKey(at)
      await store.put(key, backup.data)
      await checkRestores(backup.data)
      await this.thin(store)
      run = await this.finish(id, { status: 'ok', key, bytes: backup.data.length, rows: backup.rows })
      log?.info({ key, bytes: backup.data.length, rows: backup.rows }, 'Backup made and checked by a test restore')
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      run = await this.finish(id, { status: 'failed', error })
      log?.error({ err }, 'Backup failed')
    }
    this.last = run
    if (run.status === 'ok') this.lastOk = run
    this.options.watch?.finished(watching, run)
    return run
  }

  /** Run nightly, and soon after start-up if the last good backup is more than a day old. */
  start() {
    if (!this.store || this.timer) return
    this.stopped = false
    const lastOk = this.lastOk?.finishedAt ? Date.parse(this.lastOk.finishedAt) : 0
    const overdue = this.now().getTime() - lastOk > DAY
    this.schedule(overdue ? new Date(this.now().getTime() + 60_000) : this.nextNightly(), overdue ? 'catch-up' : 'nightly')
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    this.timer = undefined
    this.nextAt = undefined
  }

  /** The next nightly slot after now. */
  nextNightly(): Date {
    const now = this.now()
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), this.options.hourUtc ?? 2))
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
    return next
  }

  private schedule(at: Date, trigger: BackupRun['trigger']) {
    clearTimeout(this.timer)
    this.nextAt = at
    this.timer = setTimeout(
      () => {
        this.timer = undefined
        // Someone pressed "Back up now" a moment ago: that one will do.
        const lastOk = this.lastOk?.finishedAt ? Date.parse(this.lastOk.finishedAt) : 0
        if (this.now().getTime() - lastOk < HOUR) {
          this.failuresInARow = 0
          return this.schedule(this.nextNightly(), 'nightly')
        }
        void this.run(trigger)
          .then((run) => run.status === 'ok')
          .catch((err) => {
            // Another run under way is fine; anything else (the database asleep or unreachable, say) is worth a retry.
            if (err instanceof Busy) return true
            this.options.log?.error({ err }, 'Backup could not start')
            this.options.watch?.couldNotStart(err)
            return false
          })
          .then((ok) => {
            // A failed run tries again in an hour, up to three times, rather than leaving a whole day without one.
            this.failuresInARow = ok ? 0 : this.failuresInARow + 1
            const retry = this.failuresInARow > 0 && this.failuresInARow <= 3
            if (this.stopped) return
            this.schedule(retry ? new Date(this.now().getTime() + HOUR) : this.nextNightly(), retry ? 'retry' : 'nightly')
          })
      },
      Math.max(0, at.getTime() - this.now().getTime())
    )
    this.timer.unref()
  }

  private async thin(store: BackupStore) {
    try {
      for (const key of toThin(await store.list(PREFIX), this.now(), this.options.retention)) await store.delete(key)
    } catch (err) {
      // Too many old files is not worth failing a good backup over.
      this.options.log?.warn({ err }, 'Could not thin out old backups')
    }
  }

  private async finish(id: string, result: { status: 'ok' | 'failed'; key?: string; bytes?: number; rows?: number; error?: string }) {
    const { rows } = await this.db.query<RunRow>(
      `UPDATE backup_runs SET status = $2, finished_at = now(), key = $3, bytes = $4, row_count = $5, error = $6
        WHERE id = $1 RETURNING ${RUN_COLUMNS}`,
      [id, result.status, result.key ?? null, result.bytes ?? null, result.rows ?? null, result.error?.slice(0, 500) ?? null]
    )
    return fromRow(rows[0]!)
  }
}

/** Prove a backup file restores: load it into a throwaway database in memory and check every table. */
export async function checkRestores(data: Buffer): Promise<RestoreReport> {
  const scratch = await pgliteDb()
  try {
    return await restoreBackup(scratch, data)
  } catch (err) {
    throw new BackupError(`The test restore failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await scratch.close()
  }
}

/**
 * Restore on start-up, for a new, empty database: the server is deployed
 * with RESTORE_FROM set to `latest` or a file's name. On a database that
 * already has tables it does nothing, so leaving the setting in place by
 * mistake can't overwrite anything.
 */
export async function restoreFrom(db: Db, store: BackupStore | undefined, from: string): Promise<{ key: string; report: RestoreReport } | undefined> {
  if (!(await isEmptyDatabase(db))) return undefined
  if (!store) throw new BackupError('RESTORE_FROM is set, but there is no backup storage to restore from. Set the BACKUP_S3_ settings too.')
  const key = from === 'latest' ? await latestKey(store) : from
  const report = await restoreBackup(db, await store.get(key))
  return { key, report }
}

export async function latestKey(store: BackupStore): Promise<string> {
  const files = (await store.list(PREFIX)).filter((f) => keyDate(f.key))
  const newest = files.sort((a, b) => keyDate(b.key)!.getTime() - keyDate(a.key)!.getTime())[0]
  if (!newest) throw new BackupError('There are no backups in the storage yet.')
  return newest.key
}

/** backups/2026/09/session-hire-2026-09-30T020014Z.backup.gz */
export function backupKey(at: Date): string {
  const iso = at.toISOString()
  const stamp = `${iso.slice(0, 10)}T${iso.slice(11, 19).replace(/:/g, '')}Z`
  return `${PREFIX}${iso.slice(0, 4)}/${iso.slice(5, 7)}/session-hire-${stamp}.backup.gz`
}

/** When a backup was made, from its name; undefined for any file this app didn't name. */
export function keyDate(key: string): Date | undefined {
  const m = key.match(/(?:^|\/)session-hire-(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z\.backup\.gz$/)
  if (!m) return undefined
  const [, y, mo, d, h, mi, s] = m.map(Number) as [number, number, number, number, number, number, number]
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s))
}

/**
 * Which files to delete: keep the newest few whatever happens, everything
 * from the last `days` days, and the first backup of each month for
 * `months` months. Files this app didn't name are never touched.
 */
export function toThin(files: StoredFile[], now: Date, retention: Retention = RETENTION): string[] {
  const dated = files
    .map((f) => ({ key: f.key, at: keyDate(f.key) }))
    .filter((f): f is { key: string; at: Date } => f.at !== undefined)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
  const keep = new Set(dated.slice(0, retention.atLeast).map((f) => f.key))
  const firstOfMonth = new Map<string, string>()
  for (const f of dated) {
    if (now.getTime() - f.at.getTime() < retention.days * DAY) keep.add(f.key)
    const monthsAgo = (now.getUTCFullYear() - f.at.getUTCFullYear()) * 12 + now.getUTCMonth() - f.at.getUTCMonth()
    // Newest first, so the last one seen in each month is its earliest.
    if (monthsAgo <= retention.months) firstOfMonth.set(`${f.at.getUTCFullYear()}-${f.at.getUTCMonth()}`, f.key)
  }
  for (const key of firstOfMonth.values()) keep.add(key)
  return dated.filter((f) => !keep.has(f.key)).map((f) => f.key)
}

interface RunRow {
  id: string
  started_at: string
  finished_at: string | null
  status: BackupRun['status']
  trigger: BackupRun['trigger']
  key: string | null
  bytes: number | null
  row_count: number | null
  error: string | null
}

const RUN_COLUMNS = `id, to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS started_at,
  to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS finished_at, status, trigger, key, bytes, row_count, error`

function fromRow(r: RunRow): BackupRun {
  return {
    id: r.id,
    startedAt: r.started_at,
    status: r.status,
    trigger: r.trigger,
    ...(r.finished_at ? { finishedAt: r.finished_at } : {}),
    ...(r.key ? { key: r.key } : {}),
    ...(r.bytes !== null ? { bytes: r.bytes } : {}),
    ...(r.row_count !== null ? { rows: r.row_count } : {}),
    ...(r.error ? { error: r.error } : {}),
  }
}
