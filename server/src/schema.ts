import type { Db, Queryable } from './db.ts'
import { runMigrations, type Module } from './migrations.ts'

/**
 * The sync machinery's tables, which every module's commands go through:
 *
 * - `mutations`: every command a device has sent, with the answer it got.
 *   A repeat of the same id gets the same answer and changes nothing, which
 *   is what makes resending an outbox safe. It is also the history (ADR
 *   0006): who asked, from which device, when they did it, and when it
 *   arrived. The server adds each download of everything to it too, under a
 *   name no device can send (`data.export`).
 * - `changes`: an append-only feed with a sequence number. Devices pull
 *   "everything after N".
 *
 * The sync spike's stand-ins for the real model (products, bookings, scans,
 * issues) went with the sync test on 2 October 2026, in the fifth migration.
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
  // Backups (ADR 0004). `generation` names this copy of the data: a
  // database restored from a backup gets a new one, which tells devices to
  // start their copy afresh. `backup_runs` is the log of nightly backups.
  // Neither is itself backed up.
  `
  CREATE TABLE IF NOT EXISTS server_meta (
    key   text PRIMARY KEY,
    value text NOT NULL
  );
  INSERT INTO server_meta (key, value) VALUES ('generation', gen_random_uuid()::text) ON CONFLICT (key) DO NOTHING;
  CREATE TABLE IF NOT EXISTS backup_runs (
    id          text PRIMARY KEY,
    started_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    status      text NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
    trigger     text NOT NULL,
    key         text,
    bytes       integer,
    row_count   integer,
    error       text
  );
  `,
  // The history (ADR 0006). `sent_at` is when the device sent the command,
  // by its own clock, like `created_at`, so the gap between the two is how
  // long it waited there. `device` is the kind of device, such as "Safari on
  // iPhone". Both are empty for what came before. The indexes serve the
  // History tab: newest first, for one person, or for one record.
  `
  ALTER TABLE mutations ADD COLUMN IF NOT EXISTS sent_at timestamptz;
  ALTER TABLE mutations ADD COLUMN IF NOT EXISTS device text;
  CREATE INDEX IF NOT EXISTS mutations_received ON mutations (received_at, id);
  CREATE INDEX IF NOT EXISTS mutations_user ON mutations (user_id, received_at, id);
  CREATE INDEX IF NOT EXISTS mutations_client ON mutations (client_id, received_at, id);
  CREATE INDEX IF NOT EXISTS changes_entity_id ON changes (entity_id, seq);
  CREATE INDEX IF NOT EXISTS changes_mutation ON changes (mutation_id);
  `,
  // The Phase 0 sync test is gone (ADR 0001), and with it the stand-ins it
  // wrote to. Each goes only if it's empty, so nothing anyone saved is lost;
  // one that isn't is left, and the server says so at start. A restore puts
  // the rows back after the migrations, so it names the tables its backup
  // holds (backup/format.ts), and those stay for their rows.
  `
  DO $$
  DECLARE
    t text;
    has_rows boolean;
  BEGIN
    FOREACH t IN ARRAY ARRAY['issues', 'scans', 'bookings', 'products'] LOOP
      CONTINUE WHEN to_regclass(t) IS NULL;
      CONTINUE WHEN t = ANY (string_to_array(current_setting('session_hire.restoring', true), ','));
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', t) INTO has_rows;
      CONTINUE WHEN has_rows;
      EXECUTE format('DROP TABLE %I', t);
    END LOOP;
  END $$;
  `,
]

export const CORE: Module = { versionTable: 'schema_version', migrations: MIGRATIONS }

/** The number of the migration that drops the sync test's tables: tests set a database up as it was before it. */
export const SYNC_TEST_GONE = 5

export function migrate(db: Db, upTo?: number) {
  return runMigrations(db, CORE, upTo)
}

/** The sync test's tables that migration left because they held rows, with how many each holds. */
export async function keptSyncTestTables(q: Queryable): Promise<{ table: string; rows: number }[]> {
  const kept: { table: string; rows: number }[] = []
  for (const table of ['products', 'bookings', 'scans', 'issues']) {
    const { rows: found } = await q.query<{ found: string | null }>('SELECT to_regclass($1)::text AS found', [table])
    if (!found[0]?.found) continue
    const { rows } = await q.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)
    kept.push({ table, rows: Number(rows[0]!.n) })
  }
  return kept
}
