import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { reportError } from './monitoring.ts'

/**
 * The two ways the server reaches Postgres. Production uses a real server
 * through `pg`; tests and local development use PGlite, the same Postgres
 * compiled to WebAssembly and running in-process, so the SQL under test is
 * the SQL that ships.
 */

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  /** Several statements at once, no parameters. For migrations. */
  exec(sql: string): Promise<void>
}

/**
 * Where the data actually lives. Reported by /api/health so a deploy can be
 * checked from outside: `memory` means everything is lost on restart.
 */
export type DbKind = 'postgres' | 'file' | 'memory'

export interface Db extends Queryable {
  kind: DbKind
  /**
   * For reads that must answer while a long change is being written: the pull,
   * the health check and the sign-in check on each request. On Postgres a few
   * connections of their own, so they never queue behind writes waiting for the
   * write lock (audit finding 7); on PGlite the same database.
   */
  reads: Queryable
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export async function pgliteDb(dataDir?: string): Promise<Db> {
  const lite = await PGlite.create(dataDir)
  const query: Queryable['query'] = (sql, params) => lite.query(sql, params) as never
  const exec: Queryable['exec'] = async (sql) => void (await lite.exec(sql))
  return {
    kind: dataDir ? 'file' : 'memory',
    query,
    exec,
    reads: { query, exec },
    transaction: (fn) =>
      lite.transaction((tx) =>
        fn({ query: (sql, params) => tx.query(sql, params) as never, exec: async (sql) => void (await tx.exec(sql)) })
      ),
    close: () => lite.close(),
  }
}

/**
 * The longest any one thing may take on Postgres (audit finding 7), so a change that sticks can't hold the write lock,
 * and with it every device, until a restart. Generous: they are a backstop, well past anything the app does on purpose
 * (the nightly backup reads a whole table in one statement). A push waits far less for the lock (`PUSH_LOCK_WAIT_MS`).
 */
export interface Limits {
  /** Waiting for a connection, a new one or a free one in the pool. */
  connectMs: number
  /** One statement inside a transaction, waiting for locks included. */
  statementMs: number
  /** Waiting for a lock inside a transaction. */
  lockMs: number
  /** A transaction left open with nothing running: the app stuck between two statements. Postgres ends the connection, which lets go of its locks. */
  idleInTransactionMs: number
}

export const LIMITS: Limits = { connectMs: 10_000, statementMs: 60_000, lockMs: 30_000, idleInTransactionMs: 60_000 }

export interface PostgresOptions {
  onError?: (err: Error) => void
  /** LIMITS unless a test wants them shorter; `false` for none, for a restore run by hand. */
  limits?: Partial<Limits> | false
  /** How many connections writes and reads each get. */
  size?: { writes: number; reads: number }
}

export function postgresDb(connectionString: string, options: PostgresOptions | ((err: Error) => void) = {}): Db {
  const { onError = idleConnectionFailed, limits: given, size = { writes: 10, reads: 3 } } = typeof options === 'function' ? { onError: options } : options
  const limits = given === false ? undefined : { ...LIMITS, ...given }
  const pool = new pg.Pool({ connectionString, max: size.writes, connectionTimeoutMillis: limits?.connectMs })
  // Reads have connections of their own, so a pull or the health check answers while writes queue for the write lock.
  const readPool = new pg.Pool({ connectionString, max: size.reads, connectionTimeoutMillis: limits?.connectMs })
  // A connection sitting idle in the pool can fail on its own (the database
  // restarting, say). The pool raises that as an event, and an event nobody
  // listens to stops the whole process; the pool drops the connection anyway.
  pool.on('error', onError)
  readPool.on('error', onError)
  // The limits go with each transaction rather than with the connection: Neon's pooled address (PgBouncer, handing
  // a connection to whoever's transaction is next) turns down settings sent when connecting, and a SET on a connection
  // may land on another one. Sent with BEGIN, they cost no extra trip to the database.
  const begin = limits
    ? `BEGIN; SET LOCAL statement_timeout = ${limits.statementMs}; SET LOCAL lock_timeout = ${limits.lockMs}; SET LOCAL idle_in_transaction_session_timeout = ${limits.idleInTransactionMs}`
    : 'BEGIN'
  return {
    kind: 'postgres',
    query: (sql, params) => pool.query(sql, params as unknown[]) as never,
    exec: async (sql) => void (await pool.query(sql)),
    reads: {
      query: (sql, params) => readPool.query(sql, params as unknown[]) as never,
      exec: async (sql) => void (await readPool.query(sql)),
    },
    async transaction(fn) {
      const client = await pool.connect()
      // Out of the pool, a connection that fails raises the same event with
      // nobody listening, which would stop the process. The statement it cut
      // off, or the next, fails too, so whoever asked hears of it; the
      // connection is then thrown away rather than handed out again.
      let lost: Error | undefined
      const failed = (err: Error) => void (lost = err)
      client.on('error', failed)
      try {
        await client.query(begin)
        const result = await fn({
          query: (sql, params) => client.query(sql, params as unknown[]) as never,
          exec: async (sql) => void (await client.query(sql)),
        })
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.off('error', failed)
        client.release(lost)
      }
    },
    close: async () => {
      await Promise.all([pool.end(), readPool.end()])
    },
  }
}

function idleConnectionFailed(err: Error) {
  console.error('A database connection failed while idle; the pool will open another.', err.message)
  reportError(err, { area: 'database' })
}

/**
 * DATABASE_URL for real Postgres; otherwise PGlite, in DATA_DIR or in memory.
 *
 * On a host (Railway, or anything run with NODE_ENV=production) there is no
 * in-memory fallback: a missing DATABASE_URL would otherwise start an app
 * that looks healthy and quietly loses every booking on the next restart.
 * Refusing to start makes the deploy fail with a reason in its logs instead.
 */
export function dbFromEnv(env: NodeJS.ProcessEnv = process.env, postgres: PostgresOptions = {}): Promise<Db> {
  if (env.DATABASE_URL) return Promise.resolve(postgresDb(env.DATABASE_URL, postgres))
  if (env.DATA_DIR) return pgliteDb(env.DATA_DIR)
  if (isHosted(env)) {
    return Promise.reject(
      new Error('No database configured. Set DATABASE_URL (or DATA_DIR for a file database); refusing to start with an in-memory database that loses everything on restart.')
    )
  }
  return pgliteDb()
}

function isHosted(env: NodeJS.ProcessEnv) {
  return env.NODE_ENV === 'production' || env.RAILWAY_ENVIRONMENT_NAME !== undefined || env.RAILWAY_ENVIRONMENT !== undefined
}
