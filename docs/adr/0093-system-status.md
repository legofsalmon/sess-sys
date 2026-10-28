# ADR 0093: A status page for everything the app relies on

- **Status:** accepted
- **Date:** 28 October 2026
- **Asked for by:** Colly, 28 October 2026: "Could you include a systems
  status checker also in the app to monitor the various connections and
  systems used?"
- **Builds on:** [ADR 0004](0004-backups.md) (backups),
  [ADR 0005](0005-error-alerts.md) (error alerts and uptime),
  [ADR 0008](0008-calendar-sync.md) (Google Calendar),
  [ADR 0044](0044-freelancers-own-calendars-read-only.md) (crew's own calendars),
  [ADR 0057](0057-venues-on-the-map.md) (the map search),
  [ADR 0078](0078-reading-current-rms-through-its-api.md) (Current RMS),
  [ADR 0086](0086-travel-and-subsistence-on-quotes.md) (the AA's fuel price).

## Context

The app leans on a dozen things it doesn't run itself: the Neon database,
the Railway server, the bucket backups and documents' files go in, Sentry,
Google sign-in and Google Calendar, Current RMS, the AA's fuel survey and
OpenStreetMap's search. Each already said how it stood somewhere (the
Backups card, the Calendar card, the Current RMS card, the server's log,
/api/health), but nowhere answered "is everything all right?" in one place,
and some (the bucket, the map search, the fuel page) said nothing until they
failed someone mid-task. On 28 October Railway's outage also left merges
undeployed, and nothing in the app showed that the server was running an
older version than main.

## Decision

**Admin › Status** (`#admin/status`), a fourth part of Admin for the roles
that look after the company's settings (office, directors, system admins),
shows thirteen checks in three groups:

| Group | Checks |
|---|---|
| The app | The server (version, code, memory, up since), Updates (newest version on main against the one running), Database (answers, how fast, how big), Sign-in, Error reports, Live updates (devices connected now) |
| Keeping the data safe | Nightly backups, Storage for backups and files (the bucket, asked for its list of backups) |
| Services outside the app | Google Calendar, Crew's own calendars, Current RMS, AA fuel price, Map search |

Each has one of four states, a sentence, and, when it needs someone, what to
do ("Set SENTRY_DSN in Railway", "Connect again under Admin › Connections",
"choose Deploy Latest Commit"):

- **Working**: the quiet settled pill. Healthy is quiet.
- **Needs a look**: amber. Working, or the app carries on without it, but
  someone should look (backups not encrypted, the AA page unreadable while
  quotes keep last month's price, a newer version merged and not live).
- **Not working**: the app's bad tone (burnt orange), and the summary card's
  edge. Something is failing (no backups, the bucket or Google not
  answering, sign-in off).
- **Off**: grey. Not set up, or off on purpose (Current RMS without a key,
  the fuel price taken by hand). Writing to Google Calendar is off by
  Colly's call, so the calendar says "reading only" and still counts as
  working.

The page opens with a one-line answer ("Everything is working", or "2 things
need a look" with their names), the version and when it was checked, and
**Check again**.

**How it looks.** `GET /api/status` (needs `settings`) answers every check
at once. Most come from what the server already knows (the backups' last
run, the calendar connection, the freelancers' calendars' last reads, the
fuel settings). The rest ask the service itself, read only and the way the
app already uses it: the bucket's list of backups, the connected Google
account's calendars, one opportunity from Current RMS, the AA's survey page
(read at most hourly, as before), OpenStreetMap search's own `/status` page,
and the changelog on GitHub's main for the newest version. Each look waits
ten seconds at most, side by side. The answer is kept for a minute, so
opening the page twice asks nothing twice; Check again asks afresh.

**Nothing is written and nobody is contacted.** No check writes to Google
Calendar, sends anything to anyone, or changes data. (A Google account
found to have withdrawn the app's access is marked "connect again", exactly
as any other look at it already does.)

**The health check says the version.** `/api/health` now has `version` and
`commit`, so the version that's live can be seen from outside too.

## Consequences

- The office sees in one place what used to need Railway's log, and gets the
  step to fix each thing in words.
- GitHub not answering only turns Updates off: it never counts against the
  app. The browser tests point it and the map search nowhere
  (`LATEST_VERSION_URL`, `NOMINATIM_URL`).
- It is a page to open, not an alarm: Sentry still emails about errors and
  the uptime check still watches `/api/up`. Telling the office in
  Notifications when a check turns bad could follow.
- The thresholds (a database answering slower than a second, a crew calendar
  unread for two days, a merge not live after 15 minutes) are first guesses
  and live in `server/src/status.ts`.
