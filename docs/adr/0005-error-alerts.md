# ADR 0005: Error alerts and uptime checks, with Sentry

- **Status:** Accepted, 29 September 2026. Built; it switches on once the
  app server is given a Sentry project's key ([how](../monitoring.md)).
- **Decides:** how whoever looks after the app hears that something has
  gone wrong, and what those reports may hold.

## Context

With the app running for real, something has to notice when it breaks, and
today nothing would. Railway restarts a server that crashes, but tells
nobody. A failed backup shows on the Account tab only to someone who opens
it ([ADR 0004](0004-backups.md)). A fault in the app on a freelancer's
phone, often somewhere with no signal, is seen only by them.

The data is personal: freelancers' names, numbers and email addresses, when
they're away and why, and their private links, which work like a password
([ADR 0002](0002-crew-booking-links.md)). Error reports must not carry any
of it. Sentry's current SDK (version 11) collects request bodies, headers,
cookies, query strings and the values of the code's variables unless it is
told not to.

On 29 September 2026 Colly chose Sentry over Better Stack. Sentry's free
plan keeps the data in the EU and covers errors from the server and from
phones, an uptime check and a check on the nightly backup, all with email
alerts, in one account.

## Decision

- **Sentry's free plan, with the data kept in the EU (Frankfurt).** The
  server and the app report to one Sentry project, set by one setting,
  `SENTRY_DSN`. Without it nothing is reported, and phones don't download
  any of Sentry's code.
- **What is reported:**
  - by the server: a request that failed on the server (an answer of 500 or
    more; requests turned away as wrong, such as 400s and 404s, are normal
    and not reported), a crash, a start-up that went wrong, and a backup
    that failed or couldn't start;
  - by the app on each phone and laptop: any error in the app's own code
    that nothing caught. Errors from browser extensions and other sites'
    scripts are left out.
- **What a report holds, and what it never holds.** A report holds the
  error, where in the code it happened, which version of the app, and what
  kind of device and browser or server. From the server it names the route
  as the code writes it (`/f/:token/away`), never the address used; from a
  phone it names the screen by its address, cut off before any `?` or `#`.
  It never holds who was using the app, a request's body, headers, cookies
  or query, what was on screen or clicked, the values of the code's
  variables, or an IP address: the SDK tells Sentry not to work one out.
  This is by construction. The SDK's collectors are switched off at the
  source, not filtered afterwards, and a last step before anything is sent
  removes those fields should one ever appear. An error's own text can
  quote a value, so that step also replaces email addresses and anything
  shaped like a private link (24 or more letters and digits in a row) in
  it.
- **A report made with no signal waits on the device,** up to 30 of them,
  and goes when the signal is back or the next time the app opens. The app
  remembers where to report, so it can report even when it opens with no
  signal.
- **Sentry checks `/api/up` every minute.** It answers without touching the
  database, so the checks don't keep Neon's database awake and use up its
  free compute hours. Three failed checks in a row, about three minutes,
  raise an issue.
- **The nightly backup checks in with Sentry.** Each scheduled run tells
  Sentry when it starts and how it ended; the first check-in sets up the
  monitor, `nightly-backup`, due at 02:00 UTC. A run that fails, runs for
  over 30 minutes, or hasn't started within an hour of 02:00 (with the
  server down, say) raises an issue at once. "Back up now" doesn't check in,
  being outside the schedule, but its failures are reported as errors.
- **One alert emails all of it:** any new issue in the project, whether an
  error, downtime or a missed backup, and any old one that comes back.
- **The server still stops on a failure nothing handled,** as it did
  before. The report is sent first, then Railway restarts the server,
  rather than it carrying on half-broken.

## Consequences

- Colly makes a free Sentry account with one project, adds its key to
  Railway, and sets up the uptime check and the alert, about ten minutes
  ([monitoring.md](../monitoring.md)). Until then the server logs that
  reporting is off, and the health check says `"errors":"off"`.
- The free plan has room for one person and 5,000 errors a month. Repeats
  of one fault are grouped into one issue, with one email, but each repeat
  counts towards the 5,000. A fault that floods past the limit has its
  later reports dropped until the month ends, after the alert has gone out.
  More people, or more room, means a paid plan.
- The key (the DSN) is sent to every phone, as it must be for phones to
  report. It can only send reports, not read them.
- Phones download Sentry's code (about 31 KB) only while reporting is on,
  and keep it for offline use like the rest of the app.
- Stack traces from phones point into the app's minified code. Uploading
  source maps to Sentry at each deploy would make them readable, at the cost
  of another secret in the build; that can wait until a phone's fault needs
  it.
- An error on a phone in the moment before Sentry starts, while the app
  asks the server where to report, isn't reported.
- Moving to another service later touches two files,
  `server/src/monitoring.ts` and `web/src/errorsSdk.ts`.
