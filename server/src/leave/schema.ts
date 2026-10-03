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
  // Leave years the office opens (Colly, 3 October 2026). On a server already in use, this year in Ireland opens at
  // once, and so does every year up to next that already holds a request, a day in lieu or an allowance, so nothing
  // stops working. A year further ahead stays shut, as an approver couldn't open it: what is in it stays, but nobody
  // asks for more leave that far ahead. An empty database opens none, so it stays empty for made-up data. A restore
  // runs this before the rows are back, so a backup's own years come back with them; a backup from before this has it
  // run after, as the live server did. Devices hear of each year opened through the feed, as the server's own
  // bookkeeping, not anyone's change; under the lock every change takes, so a server still answering during a deploy
  // can't slip a change in between.
  `
  SELECT pg_advisory_xact_lock(7331);
  CREATE TABLE IF NOT EXISTS leave_years (
    year       integer PRIMARY KEY,
    opened_at  timestamptz NOT NULL DEFAULT now()
  );
  WITH today AS (SELECT extract(year FROM now() AT TIME ZONE 'Europe/Dublin')::int AS year),
  opened AS (
    INSERT INTO leave_years (year)
    SELECT year FROM (
      SELECT extract(year FROM start_day)::int AS year FROM leave_requests
      UNION SELECT extract(year FROM day)::int FROM lieu_entries
      UNION SELECT year FROM leave_allowances
      UNION SELECT year FROM today WHERE EXISTS (SELECT 1 FROM changes)
    ) used
    WHERE year <= (SELECT year FROM today) + 1
    ON CONFLICT (year) DO NOTHING
    RETURNING year, opened_at
  )
  INSERT INTO changes (entity, entity_id, op, data)
  SELECT 'leaveYear', year::text, 'put',
    jsonb_build_object('id', year::text, 'year', year, 'openedAt', to_char(opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  FROM opened ORDER BY year;
  `,
]

export const LEAVE: Module = { versionTable: 'leave_schema_version', migrations: MIGRATIONS }

/** The number of the migration that opens leave years: tests set a database up as it was before it. */
export const LEAVE_YEARS_OPEN = 2
