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
]

export const ASSISTANT: Module = { versionTable: 'assistant_schema_version', migrations: MIGRATIONS }
