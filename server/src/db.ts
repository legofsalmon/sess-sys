import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'

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

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export async function pgliteDb(dataDir?: string): Promise<Db> {
  const lite = await PGlite.create(dataDir)
  return {
    query: (sql, params) => lite.query(sql, params) as never,
    exec: async (sql) => void (await lite.exec(sql)),
    transaction: (fn) =>
      lite.transaction((tx) =>
        fn({ query: (sql, params) => tx.query(sql, params) as never, exec: async (sql) => void (await tx.exec(sql)) })
      ),
    close: () => lite.close(),
  }
}

export function postgresDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 })
  return {
    query: (sql, params) => pool.query(sql, params as unknown[]) as never,
    exec: async (sql) => void (await pool.query(sql)),
    async transaction(fn) {
      const client = await pool.connect()
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
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

/** DATABASE_URL for real Postgres; otherwise PGlite, in memory or in DATA_DIR. */
export function dbFromEnv(env = process.env): Promise<Db> {
  if (env.DATABASE_URL) return Promise.resolve(postgresDb(env.DATABASE_URL))
  return pgliteDb(env.DATA_DIR)
}
