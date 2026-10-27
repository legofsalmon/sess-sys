import type { Module } from '../migrations.ts'

/**
 * The purchase list (ADR 0077): kit the crew ask the company to buy, and
 * one vote a person for each. Versioned on its own
 * (purchases_schema_version), and backed up and exported like every
 * module's tables. Who asked is a person on the Crew tab, or, for a
 * request brought in from a list, the name the list gave.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS purchase_requests (
    id              text PRIMARY KEY,
    title           text NOT NULL,
    details         text NOT NULL DEFAULT '',
    link            text NOT NULL DEFAULT '',
    department      text,
    asked_by        text REFERENCES people(id),
    asked_by_name   text NOT NULL DEFAULT '',
    asked_on        date NOT NULL,
    status          text NOT NULL DEFAULT 'asked',
    notes           text NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS purchase_requests_asked_by ON purchase_requests (asked_by);
  CREATE TABLE IF NOT EXISTS purchase_votes (
    id          text PRIMARY KEY,
    request_id  text NOT NULL REFERENCES purchase_requests(id),
    person_id   text NOT NULL REFERENCES people(id),
    UNIQUE (request_id, person_id)
  );
  CREATE INDEX IF NOT EXISTS purchase_votes_person ON purchase_votes (person_id);
  `,
]

export const PURCHASES: Module = { versionTable: 'purchases_schema_version', migrations: MIGRATIONS }
