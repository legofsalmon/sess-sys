import { AUTH } from './auth/schema.ts'
import { CALENDAR } from './calendar/schema.ts'
import { CREW } from './crew/schema.ts'
import type { Db, Queryable } from './db.ts'
import { runMigrations, runMigrationsIn, type Module } from './migrations.ts'
import { OFFICE } from './office/schema.ts'
import { PROJECTS } from './projects/schema.ts'
import { CORE } from './schema.ts'
import { STOCK } from './stock/schema.ts'

/**
 * Every module's tables, in the order they are set up: crew calls refer to
 * jobs, so jobs come first, and the calendar connection names staff accounts.
 * The warehouse comes after: kit on jobs (ADR 0014) refers to jobs and their phases.
 * The office's settings refer to nothing, so they come last.
 */
export const MODULES: readonly Module[] = [CORE, PROJECTS, CREW, AUTH, CALENDAR, STOCK, OFFICE]

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
