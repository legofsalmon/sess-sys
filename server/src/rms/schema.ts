import type { Module } from '../migrations.ts'

/**
 * Current RMS, read through its API (ADR 0078): a copy of every
 * opportunity and its lines, kept by Current RMS's own ids, and a row for
 * each time it was read. Versioned on its own (rms_schema_version), and
 * backed up and exported like every module's tables. Nothing here refers
 * to the app's own records: matching the history to jobs comes later.
 *
 * The copy is never sent to devices; the server answers the office and
 * directors' screens from it, since it is all prices. A client's contacts
 * aren't kept, only the organisation's name.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS rms_opportunities (
    id                  integer PRIMARY KEY,
    number              text NOT NULL DEFAULT '',
    subject             text NOT NULL DEFAULT '',
    client              text NOT NULL DEFAULT '',
    venue               text NOT NULL DEFAULT '',
    state               text NOT NULL DEFAULT '',
    status              text NOT NULL DEFAULT '',
    starts_at           timestamptz,
    ends_at             timestamptz,
    net_cents           bigint NOT NULL DEFAULT 0,
    gross_cents         bigint NOT NULL DEFAULT 0,
    rental_cents        bigint NOT NULL DEFAULT 0,
    sale_cents          bigint NOT NULL DEFAULT 0,
    service_cents       bigint NOT NULL DEFAULT 0,
    surcharge_cents     bigint NOT NULL DEFAULT 0,
    tax_cents           bigint NOT NULL DEFAULT 0,
    undiscounted_cents  bigint NOT NULL DEFAULT 0,
    chargeable_days     numeric,
    discount_category   text NOT NULL DEFAULT '',
    price_category      text NOT NULL DEFAULT '',
    tags                jsonb NOT NULL DEFAULT '[]',
    created_at          timestamptz,
    updated_at          timestamptz,
    read_at             timestamptz NOT NULL DEFAULT now(),
    lines_read_for      timestamptz
  );
  CREATE INDEX IF NOT EXISTS rms_opportunities_starts ON rms_opportunities (starts_at DESC NULLS LAST);
  CREATE TABLE IF NOT EXISTS rms_lines (
    id                integer PRIMARY KEY,
    opportunity_id    integer NOT NULL REFERENCES rms_opportunities(id) ON DELETE CASCADE,
    path              text NOT NULL DEFAULT '',
    kind              text NOT NULL DEFAULT '',
    transaction_type  text NOT NULL DEFAULT '',
    item_type         text NOT NULL DEFAULT '',
    item_id           integer,
    name              text NOT NULL DEFAULT '',
    description       text NOT NULL DEFAULT '',
    quantity          numeric NOT NULL DEFAULT 0,
    price_cents       bigint NOT NULL DEFAULT 0,
    discount_pct      numeric NOT NULL DEFAULT 0,
    chargeable_days   numeric,
    rate_definition   text NOT NULL DEFAULT '',
    period            text NOT NULL DEFAULT '',
    unit_cents        bigint NOT NULL DEFAULT 0,
    total_cents       bigint NOT NULL DEFAULT 0,
    tax_cents         bigint NOT NULL DEFAULT 0,
    sub_rent          boolean NOT NULL DEFAULT false,
    starts_at         timestamptz,
    ends_at           timestamptz
  );
  CREATE INDEX IF NOT EXISTS rms_lines_opportunity ON rms_lines (opportunity_id, path);
  CREATE TABLE IF NOT EXISTS rms_reads (
    id              bigserial PRIMARY KEY,
    started_at      timestamptz NOT NULL,
    finished_at     timestamptz,
    opportunities   integer NOT NULL DEFAULT 0,
    lines           integer NOT NULL DEFAULT 0,
    error           text,
    stopped         boolean NOT NULL DEFAULT false
  );
  `,
]

export const RMS: Module = { versionTable: 'rms_schema_version', migrations: MIGRATIONS }
