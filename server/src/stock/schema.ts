import type { Db } from '../db.ts'
import { runMigrations, type Module } from '../migrations.ts'

/**
 * The warehouse catalogue (ADR 0013): products (models), numbered items
 * (assets) and the labels on them (identifiers), places, and counted stock.
 * Versioned on its own (stock_schema_version), like the other modules.
 *
 * Items and their labels are never deleted, so a number is never used
 * twice and every item keeps its history. A case refers to the case it's
 * in; that check waits until the end of each change, so a backup can put
 * items back in any order.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS places (
    id     text PRIMARY KEY,
    name   text NOT NULL,
    notes  text NOT NULL DEFAULT ''
  );
  CREATE UNIQUE INDEX IF NOT EXISTS places_name ON places (lower(name));
  CREATE TABLE IF NOT EXISTS models (
    id           text PRIMARY KEY,
    name         text NOT NULL,
    department   text NOT NULL CHECK (department IN ('audio', 'lighting', 'video', 'staging', 'rigging', 'power', 'other')),
    category     text NOT NULL DEFAULT '',
    tracking     text NOT NULL CHECK (tracking IN ('serialised', 'bulk')),
    is_case      boolean NOT NULL DEFAULT false,
    value_cents  integer CHECK (value_cents >= 0),
    notes        text NOT NULL DEFAULT '',
    CHECK (tracking = 'serialised' OR NOT is_case)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS models_name ON models (lower(name));
  CREATE TABLE IF NOT EXISTS assets (
    id              text PRIMARY KEY,
    model_id        text NOT NULL REFERENCES models(id),
    serial          text NOT NULL DEFAULT '',
    place_id        text REFERENCES places(id),
    case_id         text REFERENCES assets(id) DEFERRABLE INITIALLY DEFERRED,
    status          text NOT NULL CHECK (status IN ('active', 'retired')),
    retired_reason  text CHECK (retired_reason IN ('sold', 'scrapped', 'lost', 'stolen')),
    retired_note    text,
    notes           text NOT NULL DEFAULT '',
    CHECK (place_id IS NULL OR case_id IS NULL),
    CHECK (case_id <> id),
    CHECK (status = 'active' OR (place_id IS NULL AND case_id IS NULL))
  );
  CREATE INDEX IF NOT EXISTS assets_model ON assets (model_id);
  CREATE INDEX IF NOT EXISTS assets_place ON assets (place_id);
  CREATE INDEX IF NOT EXISTS assets_case ON assets (case_id);
  CREATE TABLE IF NOT EXISTS identifiers (
    id          text PRIMARY KEY,
    asset_id    text NOT NULL REFERENCES assets(id),
    kind        text NOT NULL CHECK (kind IN ('sh')),
    value       text NOT NULL,
    added_at    timestamptz NOT NULL DEFAULT now(),
    retired_at  timestamptz,
    UNIQUE (kind, value)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS identifiers_current ON identifiers (asset_id, kind) WHERE retired_at IS NULL;
  CREATE TABLE IF NOT EXISTS stock (
    id        text PRIMARY KEY,
    model_id  text NOT NULL REFERENCES models(id),
    place_id  text REFERENCES places(id),
    case_id   text REFERENCES assets(id),
    qty       integer NOT NULL CHECK (qty > 0),
    CHECK ((place_id IS NULL) <> (case_id IS NULL))
  );
  CREATE INDEX IF NOT EXISTS stock_model ON stock (model_id);
  CREATE INDEX IF NOT EXISTS stock_place ON stock (place_id);
  CREATE INDEX IF NOT EXISTS stock_case ON stock (case_id);
  `,
]

export const STOCK: Module = { versionTable: 'stock_schema_version', migrations: MIGRATIONS }

export function migrateStock(db: Db, upTo?: number) {
  return runMigrations(db, STOCK, upTo)
}
