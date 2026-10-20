import { afterAll } from 'vitest'
import { pgliteDb, type Db } from '../src/db.ts'

/**
 * Databases for a test file, booted once and reused (audit finding 13).
 * Booting PGlite is most of a second, several under load, and a backup test
 * wants four to eight of them; emptying one already running is a few
 * a moment. Each comes as a new one would: nothing in it at all, not
 * even the app's tables, and no settings or locks left from the test before.
 * Closing one puts it back for the next test; the file's last test closes
 * them for real.
 */

// PGlite starts with the search path set to public, which RESET or DISCARD would take back to its own default of
// pg_catalog: set again, here, rather than reset.
const EMPTY = 'SELECT pg_advisory_unlock_all(); DROP SCHEMA public CASCADE; CREATE SCHEMA public; SET search_path TO public'

const spare: Db[] = []
const all: Db[] = []

export async function scratchDb(): Promise<Db> {
  let db = spare.pop()
  if (!db) {
    db = await pgliteDb()
    all.push(db)
  }
  // Emptied as it's handed out rather than as it's put back, so a test that stopped part way leaves nothing behind.
  await db.exec(EMPTY)
  let closed = false
  const lent = db
  return {
    ...lent,
    close: async () => {
      if (closed) return
      closed = true
      spare.push(lent)
    },
  }
}

afterAll(async () => {
  for (const db of all.splice(0)) await db.close()
  spare.length = 0
})
