import type { Module } from '../migrations.ts'

/**
 * Settings, starting with the office's own details (audit finding 10).
 * Versioned on their own (office_schema_version), so they never fight the
 * crew migrations. One row per setting, by id; "office" is the only one
 * for now.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS settings (
    id          text PRIMARY KEY,
    name        text NOT NULL DEFAULT '',
    phone       text,
    email       text,
    updated_at  timestamptz NOT NULL DEFAULT now()
  );
  `,
]

export const OFFICE: Module = { versionTable: 'office_schema_version', migrations: MIGRATIONS }
