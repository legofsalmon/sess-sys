# Build progress

Newest first. Each entry says what changed, what was checked, and what is
waiting on someone.

## 29 September 2026: nightly backups built

**Done**

- Every night at 02:00 UTC the app server copies the whole database into
  one file and puts it in storage outside the database. It then restores
  that file into a scratch database and checks every table before counting
  it as a backup, so a backup that can't be restored is caught the night
  it's made, not the day it's needed.
  [Decision 0004](adr/0004-backups.md) has the reasons.
- The file is plain text inside, a line per row with a checksum per table,
  so it can be read without the app.
- Backups are kept for 35 days, then the first of each month for a year. A
  failed backup is tried again each hour, up to three times.
- Putting the data back means pointing the server at a new, empty database
  with `RESTORE_FROM` set, and deploying: [the steps](backups.md). Phones
  and laptops notice on their next sync, reload their copy, and send again
  everything they changed in the last two weeks, so work done after the
  backup isn't lost.
- The **Account** tab has a **Backups** card: when the last backup was
  made, what went wrong if the last try failed, and **Back up now**. The
  health check says whether backups are fresh, ready for the uptime alert.
- Checked: 21 new server tests (every table coming back exactly, accents,
  emoji and times to the microsecond included; damaged and cut-short files
  refused with nothing changed; an older backup restoring into newer code;
  the schedule, retries and what's kept; phones catching up after a
  restore; the storage's signed requests), one of them restoring into a
  fresh real Postgres database, and 3 new browser tests for the card. A
  trial on a local server restored a backup into an empty database on
  start-up, and left a database with data in it alone.
- Merged into `main` at 20:25 UTC and live by 20:32. The live health check
  says `"backups":"off"` until the bucket is added.

**Next**

- Colly: make a Railway bucket and give it to the app server, a few
  minutes: [the steps](backups.md). Until then the Account tab says
  backups are off.
- Colly, still waiting: the Google sign-in key
  ([the steps](sign-in-setup.md)) and the phone field test
  ([the steps](field-test.md)).
- Error tracking and uptime alerts.

## 29 September 2026: staff sign-in built

**Done**

- Staff sign in with their Google account. Staff means a sessionhire.com
  Workspace account, or an address listed by hand, such as a tester's.
  Everything the app reads or changes now needs sign-in, except the health
  check and freelancers' private links.
  [Decision 0003](adr/0003-staff-sign-in.md) has the reasons.
- A signed-in phone stays signed in for 60 days after it was last used, and
  keeps working with no signal. It only shows the sign-in page when the
  server says so, and anything changed offline waits until someone signs in
  rather than being lost.
- Every change now records who made it, in the audit trail and the export.
- New **Account** tab: who is signed in, and **Sign out**, which also clears
  the device's copy of the data (with a warning if changes haven't synced).
- Safety catch: once anyone has signed in, the server won't start without
  the Google key, so a lost setting can't quietly open the app to everyone.
- Checked: 26 new server tests (signing in; turning away personal accounts,
  other companies and unverified addresses; forged returns from Google; sign
  out, expiry and switched-off accounts; live updates only for signed-in
  devices) and 3 new browser tests (the sign-in page keeping waiting
  changes, a refused account, signing out clearing the device). All earlier
  tests still pass.
- Merged into `main` at 19:36 UTC. It reaches the live app with the next
  deploy; until the Google key is added the health check will say
  `"auth":"off"` and the app stays open as before.

**Next**

- Colly: make the Google sign-in key, add it in Railway, then **Deploy
  Latest Commit**, about ten minutes: [the steps](sign-in-setup.md). Until
  then the app stays open to anyone with the address, so keep to made-up
  data.
- Phone field test: [the steps](field-test.md).
- Backups with a tested restore, then error tracking and uptime alerts.

## 29 September 2026: app live on Railway

**Done**

- The app runs at shserver-production.up.railway.app, deployed from `main`,
  with its data in a Neon Postgres database created through Vercel's
  storage menu. A Railway incident ("slow or stuck deployments") held the
  first deploy up for a few minutes.
- The health check (`/api/health`) now says where the data lives:
  `postgres`, `file` or `memory`. Before this, there was no way to tell from
  outside which database a deploy was using.
- On a host the server now refuses to start without a database, so a missing
  `DATABASE_URL` fails the deploy with a reason in its logs instead of
  running on a throwaway in-memory store that loses everything on restart.
- Checked: new server tests for each setting and for the health check.

- The database is in Frankfurt (confirmed by Colly), as planned for GDPR
  and latency.
- Confirmed live at 19:19 UTC: the health check reads `"db":"postgres"`.
  Railway didn't start a deploy by itself for the merges after the first
  one, so Colly deployed the latest commit by hand (Railway's command
  palette, **Deploy Latest Commit**).

**Next**

- Phone field test on the live app: [the steps](field-test.md) (Colly).
- Find out why Railway skips merges: the reason it shows on skipped
  deployments. Until then, each merge to `main` needs Deploy Latest Commit.
- Staff sign-in with Google, so real jobs and crew can go in: being built.

## 29 September 2026: crew booking started early

Built in parallel with Phase 0, so the freelancer side can be tried as soon
as the app is hosted. The decision is recorded in
[ADR 0002](adr/0002-crew-booking-links.md).

**Done**

- **Crew screen for ops** (the Crew tab in the app): people with skills,
  rates and contact details; jobs that need crew (project, phase, role,
  dates, call time, how many, day rate, venue, details); offers to one
  person or a shortlist; answers to check, with Confirm, "Agree €300" for
  counters, and Release.
- **Send an offer where the freelancer already looks:** the app writes the
  message with every detail and their link, and opens WhatsApp, text or
  email with it filled in. Nothing is sent automatically yet.
- **Freelancer's private link, no app or login:** see offers in full, accept
  all or some days, decline, ask for a different rate, mark days off,
  subscribe to bookings in Google, Apple or Outlook calendar, and download
  everything held on them. Works with JavaScript off, so it opens instantly
  from WhatsApp.
- **Rules the server enforces**, whichever way an answer arrives: nobody is
  double booked; the first to accept a shortlisted role gets it and the rest
  are told it's filled; days someone marked off need an explicit override.
- Checked: 12 new server tests (shortlists, part-days, counters, clashes,
  days off, links, calendar feed, offline ops device) and a browser test
  where the office offers a job and a phone answers from the link. All
  earlier tests still pass.

**Next for crew**

- Link crew calls to Phase 1 projects and phases, and add confirmed crew to
  the Google Calendar event as attendees; read RSVPs back as answers.
- Documents with expiry (Safe Pass, manual handling) that block an offer.
- Timesheets from confirmed days, then ready-made freelancer invoices.

**Waiting on**

- Nothing new. Real freelancer data waits until staff sign-in is in.

## 29 September 2026: hosting picked

**Decided:** the app server runs on Railway and the database on Neon
(Postgres, EU). Vercel keeps serving this blueprint at sh.letissier.ie.

**Done**

- `railway.json` added: Railway builds the app, starts the server and checks
  `/api/health` before switching traffic over. The server already serves the
  app and its live connections from one place.
- Checked: a production-style start locally serves the app and answers the
  health check.

- Neon project `session-hire` created (Postgres 17, Frankfurt, free tier).
  The server creates its tables on first start.
- `main` branch created from the working branch, so production deploys
  from `main` and new work arrives through pull requests.

**Waiting on**

- Colly: make `main` the default branch on GitHub, then create the Railway
  project from `main` with `DATABASE_URL` set as a secret, and share the URL
  for the phone field test.

## 29 September 2026: Phase 0 started

**Done**

- Codebase set up as one TypeScript repo with three parts: `shared` (the
  model, commands and the device-side sync engine), `server` (Fastify and
  Postgres) and `web` (the installable app).
- The sync engine is built and the decision is recorded in
  [ADR 0001](adr/0001-sync-engine.md): our own engine on the Crewbox pattern.
- A small test app shows it working: add stock, book it, scan it out, switch
  the signal off, book on another device, switch it back on.
- Checked: 10 server tests (including 20 devices at once on real Postgres)
  and a browser test where a phone in flight mode reloads the app, books,
  and gets the server's answer on reconnect. All pass.
- CI runs typecheck, tests, the browser test and the blueprint build on
  every push.

**Waiting on**

- Somewhere to host the server so the test app can be tried on real phones,
  in a real dead spot. Vercel hosts the blueprint but cannot hold the
  server's live connections.

**Next in Phase 0**

- Host the test app and do the field test.
- Staff sign-in with Google Workspace and freelancer email links.
- Backups with a tested restore; error tracking and uptime alerts.
