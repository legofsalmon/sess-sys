import type { Db, Queryable } from './db.ts'

/**
 * Each part of the app (the core, crew, sign-in, and later warehouse and
 * finance) keeps its own numbered list of migrations and its own version
 * table, so modules can grow without fighting over one list. Migrations
 * only ever go forward.
 */
export interface Module {
  /** Table holding this module's schema version. Also its name in backups. */
  versionTable: string
  migrations: readonly string[]
}

/** Bring a module up to `upTo` (all of its migrations by default), one transaction per migration. Never goes back. */
export function runMigrations(db: Db, mod: Module, upTo = mod.migrations.length) {
  return migrate(db, mod, upTo, (step) => db.transaction(step))
}

/** The same, inside a transaction the caller already has open, so it all happens or none of it does. */
export function runMigrationsIn(tx: Queryable, mod: Module, upTo = mod.migrations.length) {
  return migrate(tx, mod, upTo, (step) => step(tx))
}

async function migrate(q: Queryable, mod: Module, upTo: number, inStep: (step: (tx: Queryable) => Promise<void>) => Promise<void>) {
  await q.query(`CREATE TABLE IF NOT EXISTS ${mod.versionTable} (version integer NOT NULL)`)
  const { rows } = await q.query<{ version: number }>(`SELECT version FROM ${mod.versionTable}`)
  let version = rows[0]?.version ?? 0
  if (rows.length === 0) await q.query(`INSERT INTO ${mod.versionTable} (version) VALUES (0)`)
  for (; version < Math.min(upTo, mod.migrations.length); version++) {
    const next = version + 1
    await inStep(async (tx) => {
      await tx.exec(mod.migrations[next - 1]!)
      await tx.query(`UPDATE ${mod.versionTable} SET version = $1`, [next])
    })
  }
}

/** The module's schema version in this database; 0 if it has never been set up. */
export async function moduleVersion(q: Queryable, mod: Module): Promise<number> {
  const { rows: exists } = await q.query<{ found: string | null }>('SELECT to_regclass($1)::text AS found', [mod.versionTable])
  if (!exists[0]?.found) return 0
  const { rows } = await q.query<{ version: number }>(`SELECT version FROM ${mod.versionTable}`)
  return rows[0]?.version ?? 0
}
