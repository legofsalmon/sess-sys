import type { Module } from '../migrations.ts'

/**
 * Claude inside the app (ADR 0096): a row for each time Claude was asked,
 * for the monthly limit and Admin › Status. Only what it was and what it
 * cost are kept: not the words sent, not what came back, and not who
 * asked, so there is nothing of anyone's here to erase. Versioned on its
 * own (assistant_schema_version), backed up and exported like the rest.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS assistant_uses (
    id             bigserial PRIMARY KEY,
    at             timestamptz NOT NULL DEFAULT now(),
    kind           text NOT NULL,
    model          text NOT NULL,
    input_tokens   integer NOT NULL DEFAULT 0,
    output_tokens  integer NOT NULL DEFAULT 0,
    cost_cents     integer NOT NULL DEFAULT 0,
    ok             boolean NOT NULL DEFAULT true
  );
  CREATE INDEX IF NOT EXISTS assistant_uses_at ON assistant_uses (at);
  `,
  // Claude's to-do lists for the office and directors (ADR 0097): what it wrote and which were ticked done. Kept two
  // weeks, and all dropped when anyone is erased, since what it wrote can name people from a job's notes.
  `
  CREATE TABLE IF NOT EXISTS assistant_lists (
    id        bigserial PRIMARY KEY,
    made_at   timestamptz NOT NULL DEFAULT now(),
    how       text NOT NULL CHECK (how IN ('morning', 'asked')),
    summary   text NOT NULL DEFAULT '',
    items     jsonb NOT NULL DEFAULT '[]'
  );
  `,
  // The operations mailbox (ADR 0098). The connection: one row, its Google key locked as the calendar's is. Each thread
  // Claude read: what it was, the job it's about, and the lines Claude last drafted, so a quote nobody has changed since
  // is kept up to date. What it read (the subject, who from, the summary, what to ask, what it suggests) is kept apart
  // in mail_notes, which erasing anyone empties; the mail itself stays in Gmail, read again when the thread grows.
  `
  CREATE TABLE IF NOT EXISTS assistant_mailbox (
    id             text PRIMARY KEY,
    state          text NOT NULL CHECK (state IN ('off', 'on', 'reconnect')),
    account_email  text,
    account_sub    text,
    refresh_token  text,
    problem        text,
    connected_by   text,
    connected_at   timestamptz,
    read_after     timestamptz,
    looked_at      timestamptz
  );
  CREATE TABLE IF NOT EXISTS mail_threads (
    id             text PRIMARY KEY,
    project_id     text REFERENCES projects(id) ON DELETE SET NULL,
    kind           text NOT NULL CHECK (kind IN ('enquiry', 'job', 'other')),
    messages       integer NOT NULL DEFAULT 0,
    last_at        timestamptz NOT NULL,
    last_outside   boolean NOT NULL DEFAULT false,
    drafted_lines  jsonb,
    read_at        timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS mail_threads_project ON mail_threads (project_id);
  CREATE TABLE IF NOT EXISTS mail_notes (
    thread_id  text PRIMARY KEY REFERENCES mail_threads(id) ON DELETE CASCADE,
    subject    text NOT NULL DEFAULT '',
    sender     text NOT NULL DEFAULT '',
    summary    text NOT NULL DEFAULT '',
    questions  jsonb NOT NULL DEFAULT '[]',
    advice     jsonb
  );
  CREATE TABLE IF NOT EXISTS mail_seen (
    id         text PRIMARY KEY,
    thread_id  text NOT NULL,
    at         timestamptz NOT NULL DEFAULT now()
  );
  `,
]

export const ASSISTANT: Module = { versionTable: 'assistant_schema_version', migrations: MIGRATIONS }
