import type { Db } from '../db.ts'
import { runMigrations, type Module } from '../migrations.ts'

/**
 * Crew tables. Versioned on their own (crew_schema_version) so the crew
 * module and the core can add migrations independently without fighting
 * over one list.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS people (
    id              text PRIMARY KEY,
    name            text NOT NULL,
    kind            text NOT NULL CHECK (kind IN ('staff', 'freelancer')),
    email           text,
    phone           text,
    skills          jsonb NOT NULL DEFAULT '[]',
    day_rate_cents  integer,
    notes           text NOT NULL DEFAULT '',
    link_token      text NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS unavailability (
    id         text PRIMARY KEY,
    person_id  text NOT NULL REFERENCES people(id),
    start_day  date NOT NULL,
    end_day    date NOT NULL,
    note       text NOT NULL DEFAULT '',
    source     text NOT NULL CHECK (source IN ('ops', 'self', 'calendar'))
  );
  CREATE INDEX IF NOT EXISTS unavailability_person ON unavailability (person_id, start_day, end_day);
  CREATE TABLE IF NOT EXISTS crew_calls (
    id              text PRIMARY KEY,
    project         text NOT NULL,
    phase           text NOT NULL DEFAULT '',
    venue           text NOT NULL DEFAULT '',
    role            text NOT NULL,
    start_day       date NOT NULL,
    end_day         date NOT NULL,
    call_time       text,
    needed          integer NOT NULL CHECK (needed > 0),
    day_rate_cents  integer,
    details         text NOT NULL DEFAULT '',
    reply_by        date,
    status          text NOT NULL CHECK (status IN ('open', 'cancelled'))
  );
  CREATE TABLE IF NOT EXISTS offers (
    id                  text PRIMARY KEY,
    call_id             text NOT NULL REFERENCES crew_calls(id),
    person_id           text NOT NULL REFERENCES people(id),
    status              text NOT NULL,
    days                jsonb NOT NULL,
    day_rate_cents      integer,
    counter_rate_cents  integer,
    note                text NOT NULL DEFAULT '',
    responded_at        timestamptz,
    responded_via       text,
    override            boolean NOT NULL DEFAULT false
  );
  CREATE INDEX IF NOT EXISTS offers_call ON offers (call_id);
  CREATE INDEX IF NOT EXISTS offers_person ON offers (person_id);
  `,
  // Calls as part of a job, and of one of its phases (ADR 0007). A phase
  // can only be removed once its calls are cancelled; they then keep the
  // job but lose the phase.
  `
  ALTER TABLE crew_calls ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id);
  ALTER TABLE crew_calls ADD COLUMN IF NOT EXISTS phase_id text REFERENCES phases(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS crew_calls_project ON crew_calls (project_id);
  CREATE INDEX IF NOT EXISTS crew_calls_phase ON crew_calls (phase_id);
  `,
  // Timesheets (ADR 0022): one for a booking, so it has the booking's offer
  // id. What was sent is kept beside what the office approved.
  `
  CREATE TABLE IF NOT EXISTS timesheets (
    id              text PRIMARY KEY REFERENCES offers(id),
    status          text NOT NULL CHECK (status IN ('sent', 'approved')),
    days            jsonb NOT NULL,
    day_rate_cents  integer,
    extras          jsonb NOT NULL DEFAULT '[]',
    sent            jsonb NOT NULL,
    note            text NOT NULL DEFAULT '',
    office_note     text NOT NULL DEFAULT '',
    sent_at         timestamptz NOT NULL,
    sent_via        text NOT NULL CHECK (sent_via IN ('link', 'app')),
    approved_at     timestamptz
  );
  `,
  // Archived people (audit finding 7): leavers kept for the record, offered
  // nothing, their link and feed stopped. Older rows read as not archived.
  `
  ALTER TABLE people ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
  `,
  // Declines and pull-outs wait in "Answers to check" until the office
  // notes them (audit finding 9): when that was, or null while they wait.
  `ALTER TABLE offers ADD COLUMN IF NOT EXISTS seen_at timestamptz;`,
  // Staff leave (ADR 0024): who can approve time off, and approved leave
  // as days off, under the request's own id, with a source of its own.
  `
  ALTER TABLE people ADD COLUMN IF NOT EXISTS approves_leave boolean NOT NULL DEFAULT false;
  ALTER TABLE unavailability DROP CONSTRAINT IF EXISTS unavailability_source_check;
  ALTER TABLE unavailability ADD CONSTRAINT unavailability_source_check CHECK (source IN ('ops', 'self', 'calendar', 'leave'));
  `,
]

export const CREW: Module = { versionTable: 'crew_schema_version', migrations: MIGRATIONS }

export function migrateCrew(db: Db, upTo?: number) {
  return runMigrations(db, CREW, upTo)
}
