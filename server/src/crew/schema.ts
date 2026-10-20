import { NAME_PARTICLES } from '@sh/shared'
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
  // The profile (ADR 0025): the department, the level (0 an applicant, 1
  // known, higher more preferred), the name they go by, certificates by
  // kind as JSON, and the company they trade through. Older rows read as
  // Level 1 with nothing else set.
  `
  ALTER TABLE people ADD COLUMN IF NOT EXISTS department text;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 0 AND 5);
  ALTER TABLE people ADD COLUMN IF NOT EXISTS known_as text;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS certificates jsonb NOT NULL DEFAULT '{}';
  ALTER TABLE people ADD COLUMN IF NOT EXISTS company_name text;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS company_vat_number text;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS company_cro_number text;
  `,
  // The certificates a call needs (ADR 0028), as a list of kinds. Older
  // calls need none. A person's own certificates are JSON by kind already,
  // so the new kinds need nothing there.
  `ALTER TABLE crew_calls ADD COLUMN IF NOT EXISTS needs_certificates jsonb NOT NULL DEFAULT '[]';`,
  // Running late (ADR 0028): one for a booking and a day, said on the
  // person's link. It names the person and holds their words, so it's a
  // table of its own that erasing them can clear.
  `
  CREATE TABLE IF NOT EXISTS running_late (
    id          text PRIMARY KEY,
    person_id   text NOT NULL REFERENCES people(id),
    offer_id    text NOT NULL REFERENCES offers(id),
    call_id     text NOT NULL REFERENCES crew_calls(id),
    day         date NOT NULL,
    late_by     text CHECK (late_by IN ('15', '30', '60', 'more')),
    arrive_at   text,
    note        text NOT NULL DEFAULT '',
    said_at     timestamptz NOT NULL,
    arrived_at  timestamptz,
    seen_at     timestamptz,
    UNIQUE (offer_id, day)
  );
  CREATE INDEX IF NOT EXISTS running_late_person ON running_late (person_id);
  CREATE INDEX IF NOT EXISTS running_late_day ON running_late (day);
  `,
  // Roles (ADR 0034): what a member of staff can change once signed in.
  // None is staff crew; only staff have one.
  `
  ALTER TABLE people ADD COLUMN IF NOT EXISTS role text CHECK (role IN ('director', 'office', 'head', 'warehouse', 'crew'));
  `,
  // Their own calendar, read only (ADR 0044): one each, its id the person's. The address is a secret, like a link: it
  // never goes to a device, in the history or in Download everything. Only busy times are kept, as JSON, never what
  // they were. `read_at` is the last good read; `tried_at` the last look, good or not, and `problem` why it wasn't.
  `
  CREATE TABLE IF NOT EXISTS own_calendars (
    id         text PRIMARY KEY,
    person_id  text NOT NULL UNIQUE REFERENCES people(id),
    address    text NOT NULL,
    added_by   text NOT NULL CHECK (added_by IN ('self', 'office')),
    added_at   timestamptz NOT NULL DEFAULT now(),
    read_at    timestamptz,
    tried_at   timestamptz,
    problem    text,
    busy       jsonb NOT NULL DEFAULT '[]',
    until_day  date NOT NULL,
    CHECK (id = person_id)
  );
  `,
  // A department on every crew call (ADR 0046), from the crew profiles' list; none for a call nobody has given one.
  `ALTER TABLE crew_calls ADD COLUMN IF NOT EXISTS department text;`,
  // The freelancer in the warehouse's place in the list of roles (ADR 0051). Whoever was the warehouse becomes a head of
  // department, which keeps everything the warehouse could change (kit, stock, faults, leave), so nobody is locked out of
  // their work the morning after; a director can narrow it on their page.
  `
  ALTER TABLE people DROP CONSTRAINT IF EXISTS people_role_check;
  UPDATE people SET role = 'head' WHERE role = 'warehouse';
  ALTER TABLE people ADD CONSTRAINT people_role_check CHECK (role IN ('director', 'office', 'head', 'crew', 'freelancer'));
  `,
  // Combining people brought in twice (ADR 0055): the addresses they had as the others, in small letters, which a
  // bring-in and a Google sign-in match as they match `email`; and each person made part of another, with the secret of
  // the link they had, so a freelancer's old link and calendar feed open the one person's. No row says anything else
  // about them. A second combining moves the rows on to whoever is kept then.
  `
  ALTER TABLE people ADD COLUMN IF NOT EXISTS other_emails jsonb NOT NULL DEFAULT '[]';
  CREATE TABLE IF NOT EXISTS person_merges (
    from_id     text PRIMARY KEY,
    into_id     text NOT NULL REFERENCES people(id),
    link_token  text NOT NULL UNIQUE,
    merged_at   timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS person_merges_into ON person_merges (into_id);
  `,
  // A first and a last name, asked for in place of one name (ADR 0066). The whole name stays, always the two joined, so
  // everything that reads it reads as before. Everyone already here is split as splitName in shared/src/crew.ts splits
  // a name, word for word: the last word is the last name, with any words before it that start one ("Ó", "Mac", "van").
  // One word is a first name alone. The office corrects any it gets wrong.
  `
  ALTER TABLE people ADD COLUMN IF NOT EXISTS first_name text NOT NULL DEFAULT '';
  ALTER TABLE people ADD COLUMN IF NOT EXISTS last_name text NOT NULL DEFAULT '';
  CREATE FUNCTION sh_split_name(whole text, particles text[], OUT first_name text, OUT last_name text) LANGUAGE plpgsql AS $$
  DECLARE
    words text[] := string_to_array(regexp_replace(btrim(whole), '[[:space:]]+', ' ', 'g'), ' ');
    n integer := coalesce(array_length(words, 1), 0);
    i integer := n;
  BEGIN
    IF n < 2 THEN
      first_name := coalesce(words[1], '');
      last_name := '';
      RETURN;
    END IF;
    WHILE i > 2 AND words[i - 1] = ANY(particles) LOOP
      i := i - 1;
    END LOOP;
    first_name := array_to_string(words[1:i - 1], ' ');
    last_name := array_to_string(words[i:n], ' ');
  END
  $$;
  UPDATE people SET (first_name, last_name) = (SELECT s.first_name, s.last_name FROM sh_split_name(name, ARRAY[${NAME_PARTICLES.map((w) => `'${w}'`).join(', ')}]::text[]) s)
   WHERE first_name = '';
  DROP FUNCTION sh_split_name(text, text[]);
  `,
]

export const CREW: Module = { versionTable: 'crew_schema_version', migrations: MIGRATIONS }

export function migrateCrew(db: Db, upTo?: number) {
  return runMigrations(db, CREW, upTo)
}
