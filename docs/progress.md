# Build progress

Newest first. Each entry says what changed, what was checked, and what is
waiting on someone.

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
