import type { Db } from '../db.ts'
import { runMigrations, type Module } from '../migrations.ts'

/**
 * Staff accounts and their sessions. Versioned on their own
 * (auth_schema_version), like the crew tables.
 *
 * A session row keeps a hash of the cookie's secret, never the secret
 * itself, so a copy of the database can't be used to sign in. Sessions are
 * not in the export for the same reason; accounts are.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS users (
    id              text PRIMARY KEY,
    google_sub      text NOT NULL UNIQUE,
    email           text NOT NULL,
    name            text NOT NULL,
    picture         text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_sign_in_at timestamptz NOT NULL DEFAULT now(),
    disabled        boolean NOT NULL DEFAULT false
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id           text PRIMARY KEY,
    user_id      text NOT NULL REFERENCES users(id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    user_agent   text NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
  `,
]

export const AUTH: Module = { versionTable: 'auth_schema_version', migrations: MIGRATIONS }

export function migrateAuth(db: Db, upTo?: number) {
  return runMigrations(db, AUTH, upTo)
}
