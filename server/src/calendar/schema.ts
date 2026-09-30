import type { Module } from '../migrations.ts'

/**
 * Confirmed jobs on Google Calendar (ADR 0008). Versioned on its own
 * (calendar_schema_version), set up after sign-in, whose accounts it
 * names.
 *
 * `calendar_link` is the one connection. It is never deleted: `app_key`,
 * made once, marks every event the app writes, so the app still knows its
 * own events after being disconnected and connected again.
 * `refresh_token` is the key Google gave the app, encrypted (see crypto.ts);
 * it is left out of the export, and backups hold only the locked copy.
 *
 * `calendar_days` is one row per phase-day the app has written to a
 * calendar, or tried to. Rows outlive their phase, since a removed phase's
 * events still have to come off the calendar, and are kept after their
 * event is removed, so writing the same day again reuses its event.
 *
 * `calendar_guests` is who the app invited to each day's event because of
 * an offer (ADR 0009), the address it used, and their last answer in
 * Google, so an answer is taken in once and a changed address moves the
 * invite. `calendar_link.invites` switches invites on; it starts off.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS calendar_link (
    id             text PRIMARY KEY CHECK (id = 'main'),
    state          text NOT NULL CHECK (state IN ('off', 'choosing', 'on', 'stopping', 'reconnect')),
    app_key        text NOT NULL,
    account_email  text,
    account_sub    text,
    refresh_token  text,
    calendar_id    text,
    calendar_name  text,
    problem        text,
    app_url        text,
    connected_by   text REFERENCES users(id),
    connected_at   timestamptz,
    updated_at     timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS calendar_days (
    id            text PRIMARY KEY,
    phase_id      text NOT NULL,
    project_id    text NOT NULL,
    day           date NOT NULL,
    calendar_id   text NOT NULL,
    event_id      text NOT NULL,
    generation    integer NOT NULL DEFAULT 0,
    state         text NOT NULL CHECK (state IN ('on', 'failed', 'removed')),
    title         text NOT NULL,
    content_hash  text,
    etag          text,
    html_link     text,
    problem       text,
    updated_at    timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS calendar_days_day ON calendar_days (day);
  `,
  // Crew invites (ADR 0009). `invites` is the switch on the Account tab.
  // `calendar_guests` is everyone the app has put on an event because of an
  // offer, with the address it used and their last answer; guests added by
  // hand in Google are not here, and are left alone.
  `
  ALTER TABLE calendar_link ADD COLUMN IF NOT EXISTS invites boolean NOT NULL DEFAULT false;
  CREATE TABLE IF NOT EXISTS calendar_guests (
    day_id      text NOT NULL,
    person_id   text NOT NULL,
    offer_id    text NOT NULL,
    email       text NOT NULL,
    response    text NOT NULL CHECK (response IN ('needsAction', 'accepted', 'declined', 'tentative')),
    problem     text,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (day_id, person_id)
  );
  CREATE INDEX IF NOT EXISTS calendar_guests_offer ON calendar_guests (offer_id);
  `,
]

export const CALENDAR: Module = { versionTable: 'calendar_schema_version', migrations: MIGRATIONS }
