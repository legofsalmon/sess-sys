import { createHash } from 'node:crypto'
import { createGzip, gunzipSync } from 'node:zlib'
import type { Db, Queryable } from '../db.ts'
import { moduleVersion } from '../migrations.ts'
import { MODULES, migrateAll, migrateAllTo } from '../modules.ts'
import { forEachRow, ident, tablesInOrder as listTables, useCanonicalOutput } from '../tables.ts'
import { decryptBackup, isEncrypted } from './crypto.ts'

/**
 * The backup file: the whole database as text, one row per line, gzipped.
 *
 *     H<tab>{"format":"session-hire-backup","version":1,...}   header
 *     T<tab>places                                              a table starts
 *     {"id":"a3","name":"Bay A3","notes":""}                    a row
 *     ...
 *     E<tab>{"tables":{"places":{"rows":1,"sha256":"…"}}}        the end, with a checksum per table
 *
 * Each row is Postgres's own JSON for it (row_to_json), and a restore hands
 * that text straight back to Postgres, so dates, times to the microsecond
 * and JSON columns come back exactly. The file is plain text inside, so it
 * can be read without this app, which keeps the "your data is never locked
 * in" promise; with BACKUP_KEY set it is then encrypted whole (crypto.ts),
 * and reading it needs the key. A file that was cut short has no end line
 * and is refused.
 *
 * Everything is held in memory while it is made or read. At Session Hire's
 * size that is a few megabytes; streaming can come if it ever isn't.
 */

export const FORMAT = 'session-hire-backup'

export interface BackupHeader {
  format: typeof FORMAT
  version: 1
  createdAt: string
  /** Each module's schema version when the backup was made, by its version table. */
  schemas: Record<string, number>
  /** In restore order: every table comes after the tables it refers to. */
  tables: string[]
  /** The code that made it, when the host says (Railway does). */
  commit?: string
}

export interface TableSummary {
  rows: number
  sha256: string
}

export interface BackupSummary {
  tables: Record<string, TableSummary>
}

export interface Backup {
  data: Buffer
  header: BackupHeader
  summary: BackupSummary
  rows: number
}

export interface RestoreReport {
  header: BackupHeader
  tables: Record<string, number>
  rows: number
}

/** A backup that can't be made or restored, with a reason a person can act on. */
export class BackupError extends Error {}

/**
 * Not backed up:
 * - sign-in sessions, so a restore signs everyone in afresh rather than
 *   bringing back a session that was ended after the backup was made;
 * - the copy's own bookkeeping (its generation and the backup log);
 * - schema versions, which travel in the header instead.
 */
const NOT_BACKED_UP = new Set(['sessions', 'server_meta', 'backup_runs', ...MODULES.map((m) => m.versionTable)])

const INSERT_BATCH = 500

/** Copy every table, all from the same moment, into a backup file. */
export async function writeBackup(db: Db, { now = new Date(), commit }: { now?: Date; commit?: string } = {}): Promise<Backup> {
  const gzip = createGzip()
  const chunks: Buffer[] = []
  gzip.on('data', (chunk: Buffer) => chunks.push(chunk))
  const finished = new Promise<void>((resolve, reject) => {
    gzip.on('end', resolve)
    gzip.on('error', reject)
  })
  const write = (line: string) => new Promise<void>((resolve) => (gzip.write(`${line}\n`) ? resolve() : gzip.once('drain', resolve)))

  let made: { header: BackupHeader; summary: BackupSummary }
  try {
    made = await db.transaction(async (tx) => {
      // One consistent moment across every table, and nothing written.
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
      await useCanonicalOutput(tx)
      const schemas: Record<string, number> = {}
      for (const mod of MODULES) schemas[mod.versionTable] = await moduleVersion(tx, mod)
      const tables = (await tablesInOrder(tx)).filter((t) => !NOT_BACKED_UP.has(t))
      const header: BackupHeader = { format: FORMAT, version: 1, createdAt: now.toISOString(), schemas, tables, ...(commit ? { commit } : {}) }
      await write(`H\t${JSON.stringify(header)}`)
      const summary: BackupSummary = { tables: {} }
      for (const table of tables) {
        await write(`T\t${table}`)
        summary.tables[table] = await eachRow(tx, table, write)
      }
      await write(`E\t${JSON.stringify(summary)}`)
      return { header, summary }
    })
  } catch (err) {
    gzip.destroy()
    throw err
  }
  gzip.end()
  await finished
  const rows = Object.values(made.summary.tables).reduce((n, t) => n + t.rows, 0)
  return { data: Buffer.concat(chunks), ...made, rows }
}

interface Parsed {
  header: BackupHeader
  sections: { table: string; rows: string[] }[]
  summary: BackupSummary
}

/** Unpack and sanity-check a backup file without touching any database. An encrypted file needs the key it was made with. */
export function readBackup(data: Buffer, key?: Buffer): Parsed {
  try {
    return parse(unlock(data, key))
  } catch (err) {
    if (err instanceof BackupError) throw err
    throw new BackupError(`The backup is damaged: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function unlock(data: Buffer, key: Buffer | undefined): Buffer {
  if (!isEncrypted(data)) return data
  if (!key) throw new BackupError('This backup is encrypted. Set BACKUP_KEY to the key it was made with, then try again.')
  try {
    return decryptBackup(data, key)
  } catch (err) {
    throw new BackupError(err instanceof Error ? err.message : String(err))
  }
}

function parse(data: Buffer): Parsed {
  let text: string
  try {
    text = gunzipSync(data).toString('utf8')
  } catch {
    throw new BackupError("This isn't a Session Hire backup, or it is damaged: it won't unzip.")
  }
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()

  const first = lines[0] ?? ''
  let header: BackupHeader | undefined
  if (first.startsWith('H\t')) {
    try {
      header = JSON.parse(first.slice(2)) as BackupHeader
    } catch {
      // Falls through to the refusal below.
    }
  }
  if (header?.format !== FORMAT) throw new BackupError("This isn't a Session Hire backup: it has no backup header.")
  if (header.version !== 1) throw new BackupError(`This backup is in format ${header.version}, which this version of the app can't read.`)
  if (!Array.isArray(header.tables) || typeof header.schemas !== 'object') throw new BackupError('The backup is damaged: its header is incomplete.')

  const sections: Parsed['sections'] = []
  let summary: BackupSummary | undefined
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('{')) {
      const section = sections.at(-1)
      if (!section) throw new BackupError(`The backup is damaged: line ${i + 1} is a row outside any table.`)
      section.rows.push(line)
    } else if (line.startsWith('T\t')) {
      sections.push({ table: line.slice(2), rows: [] })
    } else if (line.startsWith('E\t') && i === lines.length - 1) {
      summary = JSON.parse(line.slice(2)) as BackupSummary
    } else {
      throw new BackupError(`The backup is damaged at line ${i + 1}.`)
    }
  }
  if (!summary) throw new BackupError('The backup is incomplete: it stops before its end line, so it may have been cut short.')
  const listed = sections.map((s) => s.table).join(',')
  if (listed !== header.tables.join(',')) throw new BackupError("The backup is damaged: its tables don't match its header.")
  for (const { table, rows } of sections) {
    if (summary.tables[table]?.rows !== rows.length) {
      throw new BackupError(`The backup is damaged: ${table} has ${rows.length} rows but should have ${summary.tables[table]?.rows ?? 0}.`)
    }
  }
  return { header, sections, summary }
}

/**
 * Load a backup into an empty database: set up the schema as it was when
 * the backup was made, put every row back, check each table against the
 * checksum written at the time, then upgrade to this version of the app.
 * Up to the upgrade it is all or nothing. The restored copy gets a new
 * generation, so devices know to start their own copy afresh (see the sync
 * client).
 */
export async function restoreBackup(db: Db, data: Buffer, key?: Buffer): Promise<RestoreReport> {
  const { header, sections, summary } = readBackup(data, key)
  const known = new Map(MODULES.map((m) => [m.versionTable, m]))
  for (const [versionTable, version] of Object.entries(header.schemas)) {
    const mod = known.get(versionTable)
    if (!mod || version > mod.migrations.length) {
      throw new BackupError('This backup was made by a newer version of the app. Restore it with that version or a later one.')
    }
  }
  if ((await tablesInOrder(db)).length > 0) {
    throw new BackupError('The database to restore into already has tables in it. Restore into a new, empty database.')
  }

  await db.transaction(async (tx) => {
    // In one transaction with the rows, so a restore that fails part way leaves the database as empty as it found it.
    // A migration that keeps a table only while it holds rows (the old sync test's, schema.ts) runs before the rows
    // are back, so it's told which tables the backup holds, and leaves those for them.
    await tx.query(`SELECT set_config('session_hire.restoring', $1, true)`, [header.tables.join(',')])
    await migrateAllTo(tx, header.schemas)
    for (const { table, rows } of sections) {
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        await tx.query(`INSERT INTO ${ident(table)} SELECT * FROM json_populate_recordset(NULL::${ident(table)}, $1::json)`, [
          `[${rows.slice(i, i + INSERT_BATCH).join(',')}]`,
        ])
      }
    }
    await useCanonicalOutput(tx)
    for (const table of header.tables) {
      const got = await eachRow(tx, table)
      const want = summary.tables[table]!
      if (got.rows !== want.rows || got.sha256 !== want.sha256) {
        throw new BackupError(`${table} didn't come back exactly as it was backed up, so nothing was restored.`)
      }
    }
    await continueCounters(tx)
  })
  await migrateAll(db)

  const tables = Object.fromEntries(header.tables.map((t) => [t, summary.tables[t]!.rows]))
  return { header, tables, rows: Object.values(tables).reduce((n, r) => n + r, 0) }
}

/** Which copy of the data this database holds; see the `server_meta` migration. */
export async function readGeneration(q: Queryable): Promise<string> {
  const { rows } = await q.query<{ value: string }>(`SELECT value FROM server_meta WHERE key = 'generation'`)
  return rows[0]?.value ?? ''
}

/**
 * Give this database a new generation, so every device starts its copy
 * afresh on its next sync. A restore does this by itself; this is for data
 * put back some other way, such as Neon's own restore to an earlier time.
 */
export async function newGeneration(q: Queryable): Promise<string> {
  const { rows } = await q.query<{ value: string }>(
    `INSERT INTO server_meta (key, value) VALUES ('generation', gen_random_uuid()::text)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value RETURNING value`
  )
  return rows[0]!.value
}

/** Whether the database has any tables at all yet. */
export async function isEmptyDatabase(q: Queryable): Promise<boolean> {
  return (await tablesInOrder(q)).length === 0
}

/** Every row of a table as JSON text, in a fixed order, with a count and a checksum. */
async function eachRow(tx: Queryable, table: string, onRow?: (row: string) => Promise<void>): Promise<TableSummary> {
  const hash = createHash('sha256')
  let rows = 0
  await forEachRow(tx, table, async (j) => {
    hash.update(j).update('\n')
    rows++
    if (onRow) await onRow(j)
  })
  return { rows, sha256: hash.digest('hex') }
}

/** The app's tables, each after the tables it refers to; see tables.ts. */
async function tablesInOrder(q: Queryable): Promise<string[]> {
  try {
    return await listTables(q)
  } catch (err) {
    throw new BackupError(err instanceof Error ? err.message : String(err))
  }
}

/** Counters, such as the change feed's sequence, carry on after the highest number restored. */
async function continueCounters(tx: Queryable) {
  const { rows } = await tx.query<{ tbl: string; col: string; seq: string }>(
    `SELECT c.relname AS tbl, a.attname AS col, pg_get_serial_sequence(format('%I', c.relname), a.attname) AS seq
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname = current_schema() AND c.relkind = 'r'
        AND pg_get_serial_sequence(format('%I', c.relname), a.attname) IS NOT NULL`
  )
  for (const { tbl, col, seq } of rows) {
    await tx.query(`SELECT setval($1::regclass, coalesce((SELECT max(${ident(col)}) FROM ${ident(tbl)}), 0) + 1, false)`, [seq])
  }
}
