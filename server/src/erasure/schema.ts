import type { Module } from '../migrations.ts'

/**
 * The list of people erased on request (ADR 0027). Versioned on its own
 * (erasure_schema_version), so it never fights the crew migrations, and
 * backed up and exported like every module's tables.
 *
 * Ids and dates only, nothing about the person: their id, when, and the
 * day their name can go if it was kept for their pay or leave records. No
 * reference to `people`: a restore of a backup from before someone was
 * added still keeps them on the list, so nothing sent again afterwards
 * can bring them back.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS erasures (
    person_id        text PRIMARY KEY,
    erased_at        timestamptz NOT NULL,
    name_kept_until  date
  );
  `,
]

export const ERASURE: Module = { versionTable: 'erasure_schema_version', migrations: MIGRATIONS }
