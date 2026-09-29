import type { Queryable } from './db.ts'

/**
 * Reading every table the app has, without a list of them written by hand:
 * the backups (ADR 0004) and the export of everything (ADR 0006) both use
 * this, so a new module's tables are in both from their first day.
 */

/** The app's tables, each after the tables it refers to (alphabetical among equals). */
export async function tablesInOrder(q: Queryable): Promise<string[]> {
  const { rows: tables } = await q.query<{ name: string }>(
    `SELECT c.relname AS name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      ORDER BY c.relname COLLATE "C"`
  )
  const { rows: refs } = await q.query<{ child: string; parent: string }>(
    `SELECT DISTINCT ch.relname AS child, pa.relname AS parent
       FROM pg_constraint co
       JOIN pg_class ch ON ch.oid = co.conrelid
       JOIN pg_class pa ON pa.oid = co.confrelid
       JOIN pg_namespace n ON n.oid = ch.relnamespace
      WHERE co.contype = 'f' AND n.nspname = current_schema() AND ch.oid <> pa.oid`
  )
  const names = tables.map((t) => t.name)
  const parents = new Map(names.map((n) => [n, new Set<string>()]))
  for (const { child, parent } of refs) if (parents.has(parent)) parents.get(child)?.add(parent)
  const order: string[] = []
  const placed = new Set<string>()
  while (order.length < names.length) {
    const next = names.find((n) => !placed.has(n) && [...parents.get(n)!].every((p) => placed.has(p)))
    if (!next) throw new Error('Some tables refer to each other in a loop, so there is no order to copy them in.')
    order.push(next)
    placed.add(next)
  }
  return order
}

/** A table's columns in order, with the name of each one's type (`text`, `timestamp with time zone`, …). */
export async function columnsOf(q: Queryable, table: string): Promise<{ name: string; type: string }[]> {
  const { rows } = await q.query<{ name: string; type: string }>(
    `SELECT column_name AS name, data_type AS type
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1
      ORDER BY ordinal_position`,
    [table]
  )
  return rows
}

/** Times in UTC and numbers in full, whatever the database's own settings, so the text is always the same. */
export async function useCanonicalOutput(tx: Queryable) {
  await tx.query(`SET LOCAL TIME ZONE 'UTC'`)
  await tx.query('SET LOCAL extra_float_digits = 1')
}

/**
 * Every row of a table as Postgres's own JSON for it, in a fixed order, a
 * thousand at a time. Needs a transaction (the cursor lives in it).
 */
export async function forEachRow(tx: Queryable, table: string, onRow: (json: string) => Promise<void> | void) {
  await tx.query(`DECLARE table_rows NO SCROLL CURSOR FOR SELECT row_to_json(r)::text AS j FROM ${ident(table)} r ORDER BY ${await orderBy(tx, table)}`)
  for (;;) {
    const { rows: batch } = await tx.query<{ j: string }>('FETCH 1000 FROM table_rows')
    if (batch.length === 0) break
    for (const { j } of batch) await onRow(j)
  }
  await tx.query('CLOSE table_rows')
}

/**
 * By primary key, comparing text byte by byte rather than in the database's
 * language order, so any Postgres lists the rows the same way.
 */
async function orderBy(tx: Queryable, table: string): Promise<string> {
  const { rows } = await tx.query<{ col: string; collatable: boolean }>(
    `SELECT a.attname AS col, t.typcollation <> 0 AS collatable
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
       JOIN pg_type t ON t.oid = a.atttypid
      WHERE i.indrelid = $1::regclass AND i.indisprimary
      ORDER BY array_position(i.indkey::int2[], a.attnum)`,
    [ident(table)]
  )
  if (rows.length === 0) return 'r::text COLLATE "C"'
  return rows.map((r) => `r.${ident(r.col)}${r.collatable ? ' COLLATE "C"' : ''}`).join(', ')
}

export function ident(name: string) {
  return `"${name.replace(/"/g, '""')}"`
}
