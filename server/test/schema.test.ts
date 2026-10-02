import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { pgliteDb, type Db } from '../src/db.ts'
import { keptSyncTestTables, migrate, SYNC_TEST_GONE } from '../src/schema.ts'

/**
 * The old sync test's tables (ADR 0001) going: the migration drops each of
 * products, bookings, scans and issues only when it's empty, as on the live
 * database, and leaves one with rows in it for a person to deal with, which
 * the server says once as it starts.
 */

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn()
  cleanup = []
})

const SYNC_TEST_TABLES = ['products', 'bookings', 'scans', 'issues']

/** A database as it was the day before: the core tables up to the migration before the sync test went. */
async function before() {
  const db = await pgliteDb()
  cleanup.push(() => db.close())
  await migrate(db, SYNC_TEST_GONE - 1)
  return db
}

/** The server started on it, with what it logs. */
async function start(db: Db) {
  const lines: { msg: string; tables?: unknown }[] = []
  const app = await buildApp({ db, logger: true, logTo: { write: (line) => void lines.push(JSON.parse(line)) } })
  cleanup.push(() => app.close())
  return { app, said: lines.filter((l) => l.msg.includes('sync test')) }
}

async function tables(db: Db) {
  const { rows } = await db.query<{ name: string }>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema()`)
  return rows.map((r) => r.name)
}

describe('the sync test going', () => {
  it('drops its tables when they are empty, as they are on the live database, and says nothing', async () => {
    // Proves: four empty tables from before are gone once the server has started, and nothing is logged about them.
    const db = await before()
    expect(await tables(db)).toEqual(expect.arrayContaining(SYNC_TEST_TABLES))
    const { said } = await start(db)
    for (const t of SYNC_TEST_TABLES) expect(await tables(db)).not.toContain(t)
    expect(await keptSyncTestTables(db)).toEqual([])
    expect(said).toEqual([])
  })

  it('keeps one that holds rows, with its rows, and says so once at start', async () => {
    // Proves: a table with something in it is never dropped (bookings refer to products, so both stay), the empty
    // ones still go, the rows are untouched, and the server's start-up log names each one kept and how many rows it holds.
    const db = await before()
    await db.query(`INSERT INTO products (id, name, quantity) VALUES ('y10p', 'd&b Y10P', 4)`)
    await db.query(`INSERT INTO bookings (id, product_id, project, qty, start_day, end_day, status) VALUES ('b1', 'y10p', 'Nissan', 4, '2026-10-05', '2026-10-05', 'confirmed')`)
    const { said } = await start(db)
    const now = await tables(db)
    expect(now).toEqual(expect.arrayContaining(['products', 'bookings']))
    expect(now).not.toContain('scans')
    expect(now).not.toContain('issues')
    expect((await db.query(`SELECT name FROM products`)).rows).toEqual([{ name: 'd&b Y10P' }])
    expect(await keptSyncTestTables(db)).toEqual([
      { table: 'products', rows: 1 },
      { table: 'bookings', rows: 1 },
    ])
    expect(said).toHaveLength(1)
    expect(said[0]!.msg).toBe(
      "Kept the old sync test's tables that still hold rows: products (1 row), bookings (1 row). Nothing uses them now; drop them by hand once the rows are copied somewhere."
    )

    // Started again: still there, said again once, and nothing else changes.
    expect((await start(db)).said).toHaveLength(1)
    expect((await db.query(`SELECT 1 FROM bookings`)).rows).toHaveLength(1)
  })
})
