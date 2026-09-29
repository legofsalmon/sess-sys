import type { Db } from '../db.ts'

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
]

/** In the order a full export should list them. */
export const CREW_TABLES = ['people', 'unavailability', 'crew_calls', 'offers'] as const

export async function migrateCrew(db: Db) {
  await db.query('CREATE TABLE IF NOT EXISTS crew_schema_version (version integer NOT NULL)')
  const { rows } = await db.query<{ version: number }>('SELECT version FROM crew_schema_version')
  let version = rows[0]?.version ?? 0
  if (rows.length === 0) await db.query('INSERT INTO crew_schema_version (version) VALUES (0)')
  for (; version < MIGRATIONS.length; version++) {
    await db.transaction(async (tx) => {
      await tx.exec(MIGRATIONS[version]!)
      await tx.query('UPDATE crew_schema_version SET version = $1', [version + 1])
    })
  }
}
