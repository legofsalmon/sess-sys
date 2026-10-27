import type { Module } from '../migrations.ts'

/**
 * A job's steps (ADR 0073): one row for each step of a job that has been
 * given to someone or ticked by hand. A step the app can tell is done
 * from the job's own records (the quote sent, the calls booked, the kit
 * back) isn't kept here: devices work it out afresh. Versioned on their
 * own (steps_schema_version), and backed up and exported like every
 * module's tables.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS job_steps (
    id          text PRIMARY KEY,
    project_id  text NOT NULL REFERENCES projects(id),
    step        text NOT NULL,
    owner_id    text REFERENCES people(id),
    done_at     timestamptz,
    done_by     text REFERENCES people(id),
    UNIQUE (project_id, step)
  );
  CREATE INDEX IF NOT EXISTS job_steps_owner ON job_steps (owner_id);
  `,
]

export const STEPS: Module = { versionTable: 'steps_schema_version', migrations: MIGRATIONS }
