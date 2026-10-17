import type { Module } from '../migrations.ts'

/**
 * Light finance (ADR 0042): the price list, quotes and the records of what
 * happened to them, and when freelancers were paid. Versioned on their own
 * (finance_schema_version), so they never fight the other modules'
 * migrations, and backed up and exported like every module's tables.
 *
 * A quote's lines are kept whole with it, as the version the client saw:
 * they're never edited one by one, only saved together while it's a draft.
 * One draft per job at a time, and each version's number is the job's own.
 * Discounts are percentages to one decimal place.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS quotes (
    id            text PRIMARY KEY,
    project_id    text NOT NULL REFERENCES projects(id),
    version       integer NOT NULL CHECK (version > 0),
    status        text NOT NULL CHECK (status IN ('draft', 'sent', 'accepted', 'declined')),
    lines         jsonb NOT NULL,
    discount_pct  numeric(4, 1) NOT NULL DEFAULT 0,
    notes         text NOT NULL DEFAULT '',
    made_at       timestamptz NOT NULL DEFAULT now(),
    saved_at      timestamptz NOT NULL DEFAULT now(),
    sent_on       date,
    answered_on   date,
    invoiced_on   date,
    invoice_ref   text NOT NULL DEFAULT '',
    paid_on       date,
    UNIQUE (project_id, version)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS quotes_one_draft ON quotes (project_id) WHERE status = 'draft';
  CREATE TABLE IF NOT EXISTS product_prices (
    model_id    text PRIMARY KEY REFERENCES models(id),
    day_cents   integer NOT NULL CHECK (day_cents >= 0)
  );
  CREATE TABLE IF NOT EXISTS role_prices (
    id          text PRIMARY KEY,
    role        text NOT NULL,
    day_cents   integer NOT NULL CHECK (day_cents >= 0)
  );
  CREATE TABLE IF NOT EXISTS client_discounts (
    client_id   text PRIMARY KEY REFERENCES clients(id),
    pct         numeric(4, 1) NOT NULL CHECK (pct >= 0 AND pct <= 100)
  );
  CREATE TABLE IF NOT EXISTS cost_payments (
    timesheet_id  text PRIMARY KEY REFERENCES timesheets(id) ON DELETE CASCADE,
    paid_on       date NOT NULL
  );
  `,
]

export const FINANCE: Module = { versionTable: 'finance_schema_version', migrations: MIGRATIONS }
