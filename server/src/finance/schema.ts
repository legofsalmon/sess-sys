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
  // The printed quote (ADR 0084): the job's quote number, given when it's first sent and the same on every version; how
  // long its prices hold; a deposit. And what every quote says: the next number, the company's terms and bank details.
  `
  ALTER TABLE quotes ADD COLUMN IF NOT EXISTS number integer CHECK (number > 0);
  ALTER TABLE quotes ADD COLUMN IF NOT EXISTS valid_days integer NOT NULL DEFAULT 30 CHECK (valid_days BETWEEN 1 AND 365);
  ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deposit_pct integer CHECK (deposit_pct BETWEEN 1 AND 100);
  CREATE TABLE IF NOT EXISTS quote_settings (
    id           text PRIMARY KEY,
    next_number  integer CHECK (next_number > 0),
    terms        text NOT NULL DEFAULT '',
    bank         text NOT NULL DEFAULT ''
  );
  `,
  // Pricing the way Current RMS did (ADR 0085): each product's rate rule (Daily, 3 Day Week or Weekly), and a price
  // agreed for a whole quote in place of a discount percentage.
  `
  ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS rate text CHECK (rate IN ('daily', 'week3', 'weekly'));
  ALTER TABLE quotes ADD COLUMN IF NOT EXISTS agreed_cents bigint CHECK (agreed_cents >= 0);
  `,
  // Travel and subsistence (ADR 0086): on each quote, whether the job gives the crew their meals and the distance typed
  // in place of the map's; and how they're charged, set once for every quote. A price not set is null and charges nothing.
  `
  ALTER TABLE quotes ADD COLUMN IF NOT EXISTS meals_provided boolean NOT NULL DEFAULT false;
  ALTER TABLE quotes ADD COLUMN IF NOT EXISTS travel_km integer CHECK (travel_km BETWEEN 0 AND 2000);
  ALTER TABLE quote_settings ADD COLUMN IF NOT EXISTS travel_from_km integer CHECK (travel_from_km BETWEEN 0 AND 1000);
  ALTER TABLE quote_settings ADD COLUMN IF NOT EXISTS fuel_cents_per_litre numeric(4, 1) CHECK (fuel_cents_per_litre > 0);
  ALTER TABLE quote_settings ADD COLUMN IF NOT EXISTS litres_per_100_km numeric(3, 1) CHECK (litres_per_100_km > 0);
  ALTER TABLE quote_settings ADD COLUMN IF NOT EXISTS per_diem_cents integer CHECK (per_diem_cents >= 0);
  ALTER TABLE quote_settings ADD COLUMN IF NOT EXISTS fuel_set_on date;
  `,
  // Packages (ADR 0087): kit quoted together at one price, with what each holds.
  `
  CREATE TABLE IF NOT EXISTS packages (
    id          text PRIMARY KEY,
    name        text NOT NULL,
    department  text NOT NULL,
    day_cents   integer NOT NULL CHECK (day_cents >= 0),
    rate        text NOT NULL DEFAULT 'daily' CHECK (rate IN ('daily', 'week3', 'weekly')),
    items       jsonb NOT NULL DEFAULT '[]',
    notes       text NOT NULL DEFAULT ''
  );
  `,
  // The fuel price kept up from the AA's monthly survey (ADR 0086): on unless the office turns it off, and the survey
  // the price came from, so each new one is taken once.
  `
  ALTER TABLE quote_settings ADD COLUMN IF NOT EXISTS fuel_auto boolean NOT NULL DEFAULT true;
  ALTER TABLE quote_settings ADD COLUMN IF NOT EXISTS fuel_month text;
  ALTER TABLE quote_settings ADD COLUMN IF NOT EXISTS crew_per_car integer CHECK (crew_per_car BETWEEN 1 AND 8);
  `,
  // A product's price goes with the product (audit, 20 October 2026, finding 46). Removing one deletes its price and tells
  // the devices first; this keeps a price from ever holding a removal back.
  `
  ALTER TABLE product_prices DROP CONSTRAINT IF EXISTS product_prices_model_id_fkey;
  ALTER TABLE product_prices ADD CONSTRAINT product_prices_model_id_fkey FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE;
  `,
  // Sending a quote to the client by email (ADR 0101): whether the office has turned it on, and a row for each email that
  // went: the quote as it was (version and number), when, by whom (a staff account's id, no key to it), from and to which
  // addresses, the subject and message, what Gmail called it, and the PDF that went, as base64 text so the backups and
  // the export, which write rows as text, carry it like any other column.
  `
  ALTER TABLE quote_settings ADD COLUMN IF NOT EXISTS email_quotes boolean NOT NULL DEFAULT false;
  CREATE TABLE IF NOT EXISTS quote_emails (
    id            text PRIMARY KEY,
    quote_id      text NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    project_id    text NOT NULL,
    version       integer NOT NULL,
    number        integer,
    sent_at       timestamptz NOT NULL DEFAULT now(),
    sent_by       text,
    from_address  text NOT NULL,
    to_addresses  text[] NOT NULL,
    subject       text NOT NULL,
    message       text NOT NULL DEFAULT '',
    gmail_id      text,
    thread_id     text,
    pdf_base64    text NOT NULL
  );
  CREATE INDEX IF NOT EXISTS quote_emails_quote ON quote_emails (quote_id);
  `,
]

export const FINANCE: Module = { versionTable: 'finance_schema_version', migrations: MIGRATIONS }
