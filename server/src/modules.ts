import { AUTH } from './auth/schema.ts'
import { CALENDAR } from './calendar/schema.ts'
import { CREW } from './crew/schema.ts'
import type { Db, Queryable } from './db.ts'
import { runMigrations, runMigrationsIn, type Module } from './migrations.ts'
import { PROJECTS } from './projects/schema.ts'
import { CORE } from './schema.ts'
import { STOCK } from './stock/schema.ts'

/**
 * Every module's tables, in the order they are set up: crew calls refer to
 * jobs, so jobs come first, and the calendar connection names staff accounts.
 * The warehouse (ADR 0013) refers to nothing else yet.
 */
export const MODULES: readonly Module[] = [CORE, PROJECTS, CREW, AUTH, CALENDAR, STOCK]

/** Set up or upgrade the whole database. */
export async function migrateAll(db: Db) {
  for (const mod of MODULES) await runMigrations(db, mod)
}

/**
 * Set up every module only as far as the given versions (by version table;
 * a module not listed stays at 0), inside the caller's transaction. A
 * restore uses this to load a backup into the schema it was made with.
 */
export async function migrateAllTo(tx: Queryable, versions: Record<string, number>) {
  for (const mod of MODULES) await runMigrationsIn(tx, mod, versions[mod.versionTable] ?? 0)
}
