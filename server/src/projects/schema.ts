import type { Db } from '../db.ts'
import { runMigrations, type Module } from '../migrations.ts'

/**
 * Jobs (ADR 0007): clients, venues, jobs (projects) and their phases.
 * Versioned on their own (projects_schema_version), like the crew module.
 * Set up before crew, whose calls refer to jobs and phases.
 *
 * Nothing here is deleted except phases: a job that didn't happen is
 * cancelled or lost, so the history and the export keep every job.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS clients (
    id        text PRIMARY KEY,
    name      text NOT NULL,
    contacts  jsonb NOT NULL DEFAULT '[]',
    notes     text NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS venues (
    id       text PRIMARY KEY,
    name     text NOT NULL,
    address  text NOT NULL DEFAULT '',
    notes    text NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS projects (
    id         text PRIMARY KEY,
    name       text NOT NULL,
    client_id  text REFERENCES clients(id),
    venue_id   text REFERENCES venues(id),
    status     text NOT NULL CHECK (status IN ('enquiry', 'quoted', 'confirmed', 'cancelled', 'lost')),
    notes      text NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS phases (
    id          text PRIMARY KEY,
    project_id  text NOT NULL REFERENCES projects(id),
    name        text NOT NULL,
    start_day   date NOT NULL,
    end_day     date NOT NULL,
    venue_id    text REFERENCES venues(id),
    notes       text NOT NULL DEFAULT '',
    CHECK (start_day <= end_day)
  );
  CREATE INDEX IF NOT EXISTS phases_project ON phases (project_id, start_day);
  CREATE INDEX IF NOT EXISTS phases_days ON phases (start_day, end_day);
  `,
  // Jobs brought in from Google Calendar (ADR 0011) keep their events on the
  // organiser's calendar, named here, so the calendar sync leaves them out.
  `
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_calendar text;
  `,
  // Who crew ring on the day, on each phase's call sheet (ADR 0021): a person in the crew module.
  `
  ALTER TABLE phases ADD COLUMN IF NOT EXISTS contact_id text;
  `,
  // The days a job's kit is held before it's needed and after (ADR 0030): one of each, as usual.
  `
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS prep_days integer NOT NULL DEFAULT 1 CHECK (prep_days BETWEEN 0 AND 14);
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS return_days integer NOT NULL DEFAULT 1 CHECK (return_days BETWEEN 0 AND 14);
  `,
]

export const PROJECTS: Module = { versionTable: 'projects_schema_version', migrations: MIGRATIONS }

export function migrateProjects(db: Db, upTo?: number) {
  return runMigrations(db, PROJECTS, upTo)
}
