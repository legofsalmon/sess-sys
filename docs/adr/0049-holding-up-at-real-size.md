# ADR 0049: Holding up at real size

- **Status:** accepted
- **Date:** 18 October 2026
- **Decides:** how the server and the phone cope with the real season
  (compression, time limits, a busy answer, freelancers' calendars read
  apart), what an edit made against an old copy does, who can change the
  email that decides a role, and what the screens draw for a role and at
  volume. These are the P1 findings 4 to 12 of the
  [18 October audit](../audit-2026-10-18.md).

## Context

The 18 October audit ran the app with the real data: about 900 jobs, 91
people and two calendars' worth of offers. Most of it held. What didn't
was size: nothing was compressed, one write lock and no database time
limits let one long change stall every phone, one freelancer's calendar
could freeze the server for 26 s, an edit typed offline replaced a newer
one without a word, a role's account could be moved by changing an email
from below, and the screens drew buttons a role can't use, opened half
way down, and listed every filled call.

## Decision

**Compression (finding 6).** The web build writes a `.br` and a `.gz`
beside every text file over 1 KB (`scripts/compress-web.mjs`, run by
`npm run build -w web`, which Railway's build already calls), and
`@fastify/static` serves them pre-compressed. `/api/*` answers over 1 KB
are compressed as they're sent (`@fastify/compress`, Brotli quality 5).
Already-compressed downloads, the live connection and the pages outside
`/api/` that aren't the app's own files are left alone. The app's files
go from 1.3 MB to 0.33 MB.

**Time limits and a busy answer (finding 7).** Every transaction starts
with `SET LOCAL` limits: a statement 60 s, a lock 30 s, idle in a
transaction 60 s; a connection is waited for 10 s. They are set per
transaction, not per connection, because Neon's pooled address may not
keep session settings. A push waits at most 3 s for the write lock, then
answers with what it finished and `busy: true`; the phone saves those
answers, still pulls, stays "Up to date" rather than "No signal", and
sends the rest on its next round. Pulls, health and the sign-in check use
a read pool of their own (3 connections), so they never queue behind
writes. The calendar bring-in is **not** split into batches under the
lock: feed numbers are given out as rows are written, so a batch released
mid-transaction could let a device step past numbers that weren't
committed yet, and separate transactions would break "Take it all back".
Instead the bring-in plans outside the lock and, under it, checks nothing
changed (planning again if it did) before the bulk save.

**Freelancers' calendars (finding 4, and the cap in finding 25).** Each
read runs in a worker thread, at most two at a time, each stopped after
15 s or 256 MB. Daily and weekly repeats start a whole number of periods
before the window instead of at their first day; all work per file is
capped (200,000 steps or 5 s). A file over a limit is a failed read in
plain words, like any other, and the last good busy times are kept; the
old silent cap of 5,000 per event is gone. ical.js's time zones are reset
per file, and its search for exceptions is turned off (they are matched
by UID already), which was a second way a large file blocked the server.
The worker starts from a plain `.mjs` that loads the TypeScript through
tsx's `tsImport`, because on Node 22 tsx's loader doesn't reach workers.

**An edit made against an old copy (finding 5).** Each change carries
`seen`: how far the device's copy had read the feed when the person made
it. For `project.update`, `phase.update`, `venue.upsert`, `client.upsert`,
`person.upsert` and `call.update` the server looks for other devices'
changes to that record since `seen`, field by field. A field nobody else
changed applies; a field someone else changed that this person left as
they saw it keeps the other person's value; a field both changed refuses
the whole change as a conflict, in words that name the record. The phone
keeps the typed text in Not done with "Copy what you typed". A change
with no `seen` (an older app, or one replayed after a backup restore)
applies in arrival order as before.

**The email that decides a role (finding 12).** Changing the email or
type of someone whose stored role is above staff crew needs the right to
change settings (office and directors). A freelancer's link can never
change an email (its page now fixes only the number). No email may belong
to two people who aren't archived. The calendar bring-in matches people
by trimmed, lower-case email so it agrees with that check.

**Screens (findings 8, 9, 10).** A move to a new screen starts at its
top; Back and Forward restore the place kept for that step in the
browser's history (`web/src/places.ts`). A control a role can never use
isn't drawn: the design system hides what cannot apply and locks only
what the person can lift, and a role can't be lifted on the device. The
server's refusals stay as the backstop. Crew › Calls shows the calls
short of people; filled calls fold under "Show N filled calls", except
one with something to act on today (a missing certificate, a late note,
someone to note as late).

## Consequences

- No environment variables. The server opens up to 13 Postgres
  connections instead of 10.
- A busy server shows as up to date, not as no signal; changes wait and
  go on the next round.
- A head can no longer correct a role-holder's email, their own
  included; the office does it. Bringing a person back from the archive
  doesn't yet check their email against everyone else's.
- An hourly, monthly or yearly repeat from years ago is still worked
  through from its first day and may now make a whole file fail as "too
  much" where before its repeats were silently missing.
- An edit refused as a conflict is redone as a whole, with the text kept
  to copy. Other edit commands (kit, assets, faults, office) aren't
  checked yet; each is one entry in `server/src/seen.ts`.
- Node should be pinned to 22 on Railway (finding 25): the worker's tsx
  start was checked on Node 22 only.
