import type { Db } from './db.ts'
import { runMigrations, type Module } from './migrations.ts'

/**
 * Tables for the sync spike. Two of them are the sync machinery and will
 * stay as the real system grows:
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
]

export const CORE: Module = { versionTable: 'schema_version', migrations: MIGRATIONS }

export function migrate(db: Db, upTo?: number) {
  return runMigrations(db, CORE, upTo)
}
