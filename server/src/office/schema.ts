import type { Module } from '../migrations.ts'

/**
 * Settings, starting with the office's own details (audit finding 10).
 * Versioned on their own (office_schema_version), so they never fight the
 * crew migrations. One row per setting, by id; "office" is the only one
 * for now, and
 * "reading" (ADR 0046) for whether heads of department see crew rates.
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
  // What heads of department read (ADR 0046): on the "reading" row, whether a director lets them see crew rates.
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS heads_see_rates boolean;`,
  // Whether the app prompts messages to crew (ADR 0048): on the "messages" row, off until the office says.
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS prompt_messages boolean;`,
  // The company's VAT number and address, on the "office" row, for the printed quote (ADR 0042's open item).
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS vat_number text, ADD COLUMN IF NOT EXISTS address text;`,
  // Whether the company uses timesheets (ADR 0090): on the "timesheets" row, off until the office says.
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS use_timesheets boolean;`,
]

export const OFFICE: Module = { versionTable: 'office_schema_version', migrations: MIGRATIONS }
