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

/** Times in UTC and numbers in full, whatever the database's own settings, so the text is always the same. */
export async function useCanonicalOutput(tx: Queryable) {
  await tx.query(`SET LOCAL TIME ZONE 'UTC'`)
  await tx.query('SET LOCAL extra_float_digits = 1')
}

/**
 * What reading every table needs to know of each, asked once for them all
 * rather than table by table (audit, 20 October 2026, finding 19): its
 * columns, the order its rows are read in, and how many it has, all from
 * the transaction's one moment. A download or a backup read about fifty
 * tables with five or six trips each, two thirds of them bookkeeping.
 */
export interface TableLayout {
  columns: Map<string, { name: string; type: string }[]>
  order: Map<string, string>
  rows: Map<string, number>
}

export async function tableLayout(tx: Queryable, tables: readonly string[]): Promise<TableLayout> {
  const columns = new Map<string, { name: string; type: string }[]>(tables.map((t) => [t, []]))
  const { rows: cols } = await tx.query<{ tbl: string; name: string; type: string }>(
    `SELECT table_name AS tbl, column_name AS name, data_type AS type
       FROM information_schema.columns
      WHERE table_schema = current_schema()
      ORDER BY table_name, ordinal_position`
  )
  for (const c of cols) columns.get(c.tbl)?.push({ name: c.name, type: c.type })
  const keys = new Map<string, string[]>()
  const { rows: pk } = await tx.query<{ tbl: string; col: string; collatable: boolean }>(
    `SELECT c.relname AS tbl, a.attname AS col, t.typcollation <> 0 AS collatable
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
       JOIN pg_type t ON t.oid = a.atttypid
      WHERE n.nspname = current_schema() AND i.indisprimary
      ORDER BY c.relname, array_position(i.indkey::int2[], a.attnum)`
  )
  for (const k of pk) keys.set(k.tbl, [...(keys.get(k.tbl) ?? []), `r.${ident(k.col)}${k.collatable ? ' COLLATE "C"' : ''}`])
  const order = new Map(tables.map((t) => [t, keys.get(t)?.join(', ') ?? 'r::text COLLATE "C"']))
  const rows = new Map<string, number>()
  if (tables.length) {
    const { rows: counted } = await tx.query<Record<string, string | number>>(`SELECT ${tables.map((t, i) => `(SELECT count(*) FROM ${ident(t)}) AS n${i}`).join(', ')}`)
    tables.forEach((t, i) => rows.set(t, Number(counted[0]![`n${i}`])))
  }
  return { columns, order, rows }
}

/** Rows read at a time from a big table. */
const FETCH = 5000

/**
 * Every row of a table as Postgres's own JSON for it, in a fixed order: in
 * one go when the layout says it's small, which most are, and otherwise a
 * few thousand at a time. Needs a transaction (the cursor lives in it).
 */
export async function forEachRow(tx: Queryable, table: string, onRow: (json: string) => Promise<void> | void, layout?: TableLayout) {
  const order = layout?.order.get(table) ?? (await orderBy(tx, table))
  const select = `SELECT row_to_json(r)::text AS j FROM ${ident(table)} r ORDER BY ${order}`
  if ((layout?.rows.get(table) ?? Infinity) <= FETCH) {
    for (const { j } of (await tx.query<{ j: string }>(select)).rows) await onRow(j)
    return
  }
  await tx.query(`DECLARE table_rows NO SCROLL CURSOR FOR ${select}`)
  for (;;) {
    const { rows: batch } = await tx.query<{ j: string }>(`FETCH ${FETCH} FROM table_rows`)
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
