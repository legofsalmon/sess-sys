# Build progress

Newest first. Each entry says what changed, what was checked, and what is
waiting on someone.

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

**Waiting on**

- Colly: confirm the database's region is in Europe. Then the phone field
  test can start.

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
