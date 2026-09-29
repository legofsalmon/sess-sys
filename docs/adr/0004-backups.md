# ADR 0004: Nightly backups, each proved by a test restore

- **Status:** Accepted, 29 September 2026. Built; it switches on once the
  app server is given somewhere to keep the backups ([how](../backups.md)).
- **Decides:** how the company's data is backed up, how it is put back, and
  what phones do after it has been put back.

## Context

Everything the company records in the app lives in one Postgres database at
Neon. Neon keeps a short history of its own (hours to days, depending on the
plan) and can wind a database back to an earlier moment, but that history
lives in the same account, with the same login, as the database itself. A
mistake noticed a week later, a deleted project or a lost login would take
the data with it.

A backup nobody has tried to restore is a hope, not a backup. The
architecture asked for a nightly copy in separate storage, restored into a
scratch database to prove it works.

Restoring is also harder than usual here, because phones and laptops keep
their own copy of the data and sync with the server
([ADR 0001](0001-sync-engine.md)). After the server goes back to last
night's copy, a device that had already seen today's changes would believe
it was ahead of the server, and changes made since the backup would exist
only on the devices that made them.

[ADR 0003](0003-staff-sign-in.md) expected backups to pull the data out
through the app, with a key of their own. Making the backup inside the
server needs no key at all.

## Decision

- **The app server makes the backup itself, every night at 02:00 UTC.** It
  reads every table in one read-only transaction, so the copy is of a
  single moment even while people are working. If the server starts and the
  last good backup is more than a day old, it makes one a minute later; if a
  run fails, it tries again each hour, up to three times.
- **The backup is our own plain, open file:** gzipped text, a line per row
  in Postgres's own JSON for it, a header saying which version of the app's
  tables it holds, and an end line with a row count and checksum per table.
  It needs no Postgres tools to make or read, and anyone can open it
  without this app, which keeps the "never locked in" promise.
- **Every backup is test-restored before it counts.** Straight after
  writing it, the server restores the file into a throwaway database in
  memory and checks every table against the checksums. Only a backup that
  passes is reported as good. The health check says `"fresh": true` while
  the last good backup is under 26 hours old, so an uptime check can raise
  the alarm when backups stop.
- **Backups go to S3-compatible storage outside the database:** a Railway
  bucket to start with, or any S3-compatible service (Backblaze B2,
  Cloudflare R2, Amazon S3), chosen by settings alone. The storage checks a
  checksum of each file as it arrives, so a file damaged on the way is
  refused rather than kept.
- **Kept:** every night for 35 days, then the first backup of each month for
  a year, and never fewer than the newest seven, whatever the dates say.
  Files the app didn't make are never touched.
- **Put back only into an empty database.** Restoring means pointing the
  server at a new, empty database and deploying it once with `RESTORE_FROM`
  set to `latest` or a file's name. The restore happens in one transaction,
  and is only kept if every checksum matches. The app's newer table changes
  are then applied, so an older backup restores into newer code. On a
  database that already has tables the setting does nothing, so it can't
  overwrite anything if it is left in place by mistake.
- **After a restore, devices start afresh and send again what was lost.**
  Each database has a random generation, and a restored one gets a new
  generation. When a device sees the generation change, or sees the server
  behind where the device had got to, it throws its copy away, fetches the
  server's again, and re-sends everything it sent in the last 14 days (up to
  2,000 changes) along with anything still waiting. The server already
  ignores a change it has seen before, so the changes the backup did hold
  aren't doubled, and the ones it missed come back.
- **Not backed up:** sign-in sessions, so a restore signs everyone in afresh
  rather than bringing back a session that ended after the backup was made,
  and the database's own bookkeeping. Freelancers' private links are data,
  so they are backed up and keep working.
- **Neon's own history stays as a second layer,** for undoing a mistake
  noticed within hours. A wind-back done that way keeps the old generation,
  so it should be followed by the `new-generation` command; devices that
  were ahead of the wound-back server notice anyway, but only until new
  changes carry the server past where they had got to.

## Consequences

- Colly sets up the storage once, a few minutes in Railway, and adds its
  five settings to the app server ([backups.md](../backups.md)). Until
  then the server runs as now, and the Account tab says backups are off.
- The backup keys go only into Railway's variables. A backup holds
  everything, including freelancers' contact details and private links, so
  the bucket must stay private.
- Changes made on a phone after the last backup come back only if that phone
  syncs after the restore. Changes made on a phone that is lost, or signed
  out, before then are gone.
- After a restore everyone signs in again.
- Each night's test restore runs in the server's own memory. At Session
  Hire's size that is a few megabytes, well within the server's limits; if
  the data ever grows past a few hundred megabytes, backups should move to
  streaming, and to a separate job.
- A drill every few months is still worth doing: restore the latest backup
  into a new Neon branch or a local database with the `backup` command, and
  open the app on it.
