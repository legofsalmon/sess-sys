import type { Module } from '../migrations.ts'

/**
 * People's documents (ADR 0029), and venues' (ADR 0032). Versioned on their own
 * (documents_schema_version), so they never fight the crew migrations,
 * and backed up and exported like every module's tables. Devices never
 * see where a file is kept, nor the list of files to delete.
 *
 * A file is put on the list of files to delete before it's written to the
 * storage, and taken off it in the change that puts it on a document; a
 * document removed, replaced or erased puts its file back on. So whatever
 * fails part way, no file the app wrote is ever left in the storage
 * without the list saying so.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS documents (
    id          text PRIMARY KEY,
    person_id   text NOT NULL REFERENCES people(id),
    kind        text NOT NULL,
    title       text NOT NULL,
    expires     date,
    file_key    text UNIQUE,
    file_type   text CHECK (file_type IN ('pdf', 'jpeg', 'png', 'webp', 'heic')),
    file_bytes  integer,
    file_at     timestamptz,
    sent_via    text NOT NULL CHECK (sent_via IN ('office', 'link')),
    sent_at     timestamptz NOT NULL,
    checked_at  timestamptz,
    renews      text
  );
  CREATE INDEX IF NOT EXISTS documents_person ON documents (person_id);
  CREATE TABLE IF NOT EXISTS document_files_to_delete (
    key         text PRIMARY KEY,
    since       timestamptz NOT NULL,
    after       timestamptz NOT NULL,
    tries       integer NOT NULL DEFAULT 0,
    last_error  text
  );
  `,
  // Venues' documents (ADR 0032): a file kept as people's are, on the same list of files to delete, or a link, or both.
  `
  CREATE TABLE IF NOT EXISTS venue_documents (
    id          text PRIMARY KEY,
    venue_id    text NOT NULL REFERENCES venues(id),
    kind        text NOT NULL,
    title       text NOT NULL,
    link        text,
    file_key    text UNIQUE,
    file_type   text CHECK (file_type IN ('pdf', 'jpeg', 'png', 'webp', 'heic')),
    file_bytes  integer,
    file_at     timestamptz,
    added_at    timestamptz NOT NULL
  );
  CREATE INDEX IF NOT EXISTS venue_documents_venue ON venue_documents (venue_id);
  `,
]

export const DOCUMENTS: Module = { versionTable: 'documents_schema_version', migrations: MIGRATIONS }
