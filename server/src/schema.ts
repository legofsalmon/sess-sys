import type { Db } from './db.ts'

/**
 * Tables for the sync spike. Two of them are the sync machinery and will
 * stay as the real system grows:
 *
 * - `mutations`: every command a device has sent, with the answer it got.
 *   A repeat of the same id gets the same answer and changes nothing, which
 *   is what makes resending an outbox safe. It is also the audit trail:
 *   who asked, from which device, when they did it, and when it arrived.
 * - `changes`: an append-only feed with a sequence number. Devices pull
 *   "everything after N".
 *
 * The rest (products, bookings, scans, issues) stand in for the real model.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS mutations (
    id          text PRIMARY KEY,
    client_id   text NOT NULL,
    name        text NOT NULL,
    args        jsonb NOT NULL,
    created_at  timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    status      text NOT NULL CHECK (status IN ('applied', 'rejected')),
    result      jsonb NOT NULL
  );
  CREATE TABLE IF NOT EXISTS changes (
    seq         bigserial PRIMARY KEY,
    entity      text NOT NULL,
    entity_id   text NOT NULL,
    op          text NOT NULL CHECK (op IN ('put', 'delete')),
    data        jsonb,
    mutation_id text REFERENCES mutations(id),
    at          timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS products (
    id       text PRIMARY KEY,
    name     text NOT NULL,
    quantity integer NOT NULL CHECK (quantity >= 0)
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id         text PRIMARY KEY,
    product_id text NOT NULL REFERENCES products(id),
    project    text NOT NULL,
    qty        integer NOT NULL CHECK (qty > 0),
    start_day  date NOT NULL,
    end_day    date NOT NULL,
    status     text NOT NULL CHECK (status IN ('confirmed', 'cancelled'))
  );
  CREATE INDEX IF NOT EXISTS bookings_product_dates ON bookings (product_id, start_day, end_day);
  CREATE TABLE IF NOT EXISTS scans (
    id         text PRIMARY KEY,
    product_id text NOT NULL,
    booking_id text,
    direction  text NOT NULL CHECK (direction IN ('out', 'in')),
    at         timestamptz NOT NULL
  );
  CREATE TABLE IF NOT EXISTS issues (
    id       text PRIMARY KEY,
    kind     text NOT NULL,
    message  text NOT NULL,
    scan_id  text NOT NULL,
    resolved boolean NOT NULL DEFAULT false
  );
  `,
  // Who sent each command, once staff sign in. Empty for freelancers'
  // links (client_id says whose link) and for anything from before.
  `ALTER TABLE mutations ADD COLUMN IF NOT EXISTS user_id text;`,
]

export async function migrate(db: Db) {
  await db.query('CREATE TABLE IF NOT EXISTS schema_version (version integer NOT NULL)')
  const { rows } = await db.query<{ version: number }>('SELECT version FROM schema_version')
  let version = rows[0]?.version ?? 0
  if (rows.length === 0) await db.query('INSERT INTO schema_version (version) VALUES (0)')
  for (; version < MIGRATIONS.length; version++) {
    await db.transaction(async (tx) => {
      await tx.exec(MIGRATIONS[version]!)
      await tx.query('UPDATE schema_version SET version = $1', [version + 1])
    })
  }
}
