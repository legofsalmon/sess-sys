import type { Db } from '../db.ts'

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

export async function migrateAuth(db: Db) {
  await db.query('CREATE TABLE IF NOT EXISTS auth_schema_version (version integer NOT NULL)')
  const { rows } = await db.query<{ version: number }>('SELECT version FROM auth_schema_version')
  let version = rows[0]?.version ?? 0
  if (rows.length === 0) await db.query('INSERT INTO auth_schema_version (version) VALUES (0)')
  for (; version < MIGRATIONS.length; version++) {
    await db.transaction(async (tx) => {
      await tx.exec(MIGRATIONS[version]!)
      await tx.query('UPDATE auth_schema_version SET version = $1', [version + 1])
    })
  }
}
