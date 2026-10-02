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
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export async function pgliteDb(dataDir?: string): Promise<Db> {
  const lite = await PGlite.create(dataDir)
  return {
    kind: dataDir ? 'file' : 'memory',
    query: (sql, params) => lite.query(sql, params) as never,
    exec: async (sql) => void (await lite.exec(sql)),
    transaction: (fn) =>
      lite.transaction((tx) =>
        fn({ query: (sql, params) => tx.query(sql, params) as never, exec: async (sql) => void (await tx.exec(sql)) })
      ),
    close: () => lite.close(),
  }
}

export function postgresDb(connectionString: string, onError: (err: Error) => void = idleConnectionFailed): Db {
  const pool = new pg.Pool({ connectionString, max: 10 })
  // A connection sitting idle in the pool can fail on its own (the database
  // restarting, say). The pool raises that as an event, and an event nobody
  // listens to stops the whole process; the pool drops the connection anyway.
  pool.on('error', onError)
  return {
    kind: 'postgres',
    query: (sql, params) => pool.query(sql, params as unknown[]) as never,
    exec: async (sql) => void (await pool.query(sql)),
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
        await client.query('BEGIN')
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
    close: () => pool.end(),
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
export function dbFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<Db> {
  if (env.DATABASE_URL) return Promise.resolve(postgresDb(env.DATABASE_URL))
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
