import type { Module } from '../migrations.ts'

/**
 * Staff leave and time in lieu (ADR 0024). Versioned on their own
 * (leave_schema_version), so they never fight the crew migrations. The
 * flag saying who can approve time off lives on people, in the crew
 * module, since it's a fact about the person.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS leave_allowances (
    id            text PRIMARY KEY,
    person_id     text NOT NULL REFERENCES people(id),
    year          integer NOT NULL,
    days          integer NOT NULL CHECK (days >= 0),
    carried_over  integer NOT NULL DEFAULT 0 CHECK (carried_over >= 0),
    note          text NOT NULL DEFAULT '',
    UNIQUE (person_id, year)
  );
  CREATE TABLE IF NOT EXISTS leave_requests (
    id            text PRIMARY KEY,
    person_id     text NOT NULL REFERENCES people(id),
    type          text NOT NULL CHECK (type IN ('annual', 'lieu')),
    start_day     date NOT NULL,
    end_day       date NOT NULL,
    days          integer NOT NULL CHECK (days >= 0),
    note          text NOT NULL DEFAULT '',
    status        text NOT NULL CHECK (status IN ('waiting', 'approved', 'declined', 'cancelled')),
    requested_at  timestamptz NOT NULL DEFAULT now(),
    decided_by    text REFERENCES people(id),
    decided_at    timestamptz,
    reason        text NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS leave_requests_person ON leave_requests (person_id, start_day);
  CREATE TABLE IF NOT EXISTS lieu_entries (
    id            text PRIMARY KEY,
    person_id     text NOT NULL REFERENCES people(id),
    day           date NOT NULL,
    days          integer NOT NULL CHECK (days BETWEEN 1 AND 5),
    note          text NOT NULL DEFAULT '',
    status        text NOT NULL CHECK (status IN ('waiting', 'approved', 'declined', 'cancelled')),
    logged_at     timestamptz NOT NULL DEFAULT now(),
    decided_by    text REFERENCES people(id),
    decided_at    timestamptz,
    reason        text NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS lieu_entries_person ON lieu_entries (person_id, day);
  `,
]

export const LEAVE: Module = { versionTable: 'leave_schema_version', migrations: MIGRATIONS }
