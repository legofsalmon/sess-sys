import type { Module } from '../migrations.ts'

/**
 * Vans and drivers (ADR 0047): the company's vehicles and their checks, and
 * each booked on a job or one of its phases with a driver from the crew.
 * Versioned on their own (vehicles_schema_version), so they never fight
 * the warehouse's or the crew's migrations, and backed up and exported
 * like every module's tables. A vehicle's checks are a JSON record by
 * kind, as a person's certificates are, so a new kind needs no migration.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS vehicles (
    id            text PRIMARY KEY,
    name          text NOT NULL,
    registration  text NOT NULL DEFAULT '',
    kind          text NOT NULL,
    seats         integer,
    payload_kg    integer,
    notes         text NOT NULL DEFAULT '',
    checks        jsonb NOT NULL DEFAULT '{}',
    off_since     date,
    off_until     date,
    off_note      text NOT NULL DEFAULT '',
    archived      boolean NOT NULL DEFAULT false
  );
  CREATE TABLE IF NOT EXISTS vehicle_bookings (
    id          text PRIMARY KEY,
    vehicle_id  text NOT NULL REFERENCES vehicles(id),
    project_id  text NOT NULL REFERENCES projects(id),
    phase_id    text REFERENCES phases(id),
    start_day   date NOT NULL,
    end_day     date NOT NULL,
    driver_id   text REFERENCES people(id),
    notes       text NOT NULL DEFAULT '',
    override    boolean NOT NULL DEFAULT false,
    CHECK (start_day <= end_day)
  );
  CREATE INDEX IF NOT EXISTS vehicle_bookings_vehicle ON vehicle_bookings (vehicle_id, start_day);
  CREATE INDEX IF NOT EXISTS vehicle_bookings_project ON vehicle_bookings (project_id);
  CREATE INDEX IF NOT EXISTS vehicle_bookings_driver ON vehicle_bookings (driver_id);
  `,
]

export const VEHICLES: Module = { versionTable: 'vehicles_schema_version', migrations: MIGRATIONS }
