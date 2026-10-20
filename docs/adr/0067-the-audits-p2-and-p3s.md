# ADR 0067: The 18 October audit's P2s and P3s

- **Status:** accepted
- **Date:** 20 October 2026
- **Asked for by:** Colly, 20 October 2026 ("proceed with all the P2s and
  P3s")
- **Follows:** [the 18 October audit](../audit-2026-10-18.md), findings 13
  to 26 and the P3 list; [ADR 0049](0049-holding-up-at-real-size.md) (its
  P1s), [ADR 0001](0001-sync-engine.md) (the sync engine)

## Context

The audit's P0s and P1s were fixed by 19 October, and backups and error
alerts switched on. What was left was worth doing but not urgent: the
server and the phones at real size over weeks rather than on the day, the
screens at real volume, small security hardening, docs that promised more
than the code, and polish. This records the choices among them that aren't
obvious from the code.

## Decision

**Sync and running it**

1. **A new device reads the latest of each record, not the whole feed**
   (finding 17). A first pull asks with `latest=new`; each page holds the
   newest change per record and is read in one statement with how far the
   feed went, so a change committed during the read comes with the next
   pull (P0 finding 1's guarantee kept). Deletes from before the copy began
   are left out; a re-read asks `latest=0` and gets them. Role filters
   apply to each page as before. A device with its own change applied but
   not yet read back reads the plain feed for the rest of that read, so
   its change can't vanish between pages. An older server, ignoring
   `latest`, is read change by change. The feed itself isn't compacted:
   it stays the history.
2. **Polling only while the live connection is down** (15), with a
   heartbeat both ways so a dead connection is noticed (P3). The server
   logs only requests that fail or take a second; the freelancers'
   calendar job asks the database nothing until one is due.
3. **The version is read from `version.json`, not compiled in** (14). A
   deploy that changes no screen now changes 2 KB on a phone, not 1.2 MB.
   It is the build's own file, kept by the service worker with the files
   it came with, so a phone reports the version it's actually running,
   which `/api/config` (the server's version) wouldn't. React and Leaflet
   have chunks of their own; Sentry's isn't precached while it's off.
   Splitting Shell by area was tried and dropped: the areas import each
   other, so every area's file changed with any one.
4. **Phones ask to keep their storage** (16) once someone is in, and You
   says whether this browser keeps the copy and what would go if it
   didn't.
5. **The backup's test restore checks the file first and runs in a
   worker** (13): the server is held up about 50 ms, not 3 s. Tests share
   one database a file instead of booting one a test.
6. **What error reports now see** (19): the server held up over a second,
   an empty pull behind the head, a device whose pushes keep failing while
   online, and a change waiting over a day. Each is reported now and then,
   not every time.
7. **Migrations take a lock** and database errors reach the logs without
   their detail or values (P3).

**Security** (24)

8. **Wrong demo passcodes are counted**: ten from one address in fifteen
   minutes and it gets a 429 saying how long to wait. A passcode under 8
   characters is still refused at start; 8 to 11 only warns, so the
   running demo can't fail a deploy. Colly decides when to refuse those.
9. **A content security policy** on the app shell (its own files, the
   theme script by hash, map tiles, Sentry's ingest, inline style
   attributes) and a strict one on the server's own pages (freelancers'
   pages, call sheets: nothing but inline style, the Copy button by hash,
   and forms back to the server).

**Screens**

10. **Volume gets a summary first** (20, 21, 22). A big call says "25 of
    40, both days" with the first eight names across the card and "and 17
    more". A job's kit opens with one line by reason ("12 lines short: 9
    none counted yet, 3 not enough") and one "Subhire what's short…" with
    a list to tick, where lines not yet counted start unticked so an
    unfinished count isn't subhired by mistake. Jobs shows the next
    fortnight under sticky week headings, with Show all kept for the tab's
    life so Back finds its place, and New job at the top on a phone. Home
    puts Needs attention before Today, one line a job, enquiries left out.
11. **Every page in an area row shows** (23): the rows wrap rather than
    scroll off the edge, and "On this screen" looks like a page's contents,
    not a second row.
12. **One link style, and success isn't green** (P3). Links stay red,
    since red is Session Hire's "you" by decision; a van's Change is a
    link like a kit line's; success lines are ink, healthy being quiet.
13. **Choosing a demo persona reads the copy again before opening** (23),
    rather than wiping it, which would throw away changes waiting to send.
14. **The quote carries the company's VAT number and address**, set in
    Admin › Office details (ADR 0042's open item). A change without them
    leaves them as they were.

**Docs and tests** (18, 26)

15. **Architecture says what's built**: which role's device holds whose
    phone and email, IndexedDB not SQLite, timers not a queue, no Yjs, and
    when backups and alerts went on.
16. **A parity test** runs 90 of the 93 commands on a phone with no signal
    and compares its copy with the server's once synced. It found and
    fixed four small drifts (a call's department, kit and van fields not
    tidied as the server does). One is left marked: a call keeps its own
    copy of its job, phase and venue names, which the server rewrites and
    the device doesn't until it syncs.

## Consequences

- A new phone downloads far fewer changes, and a deploy without screen
  changes costs a phone almost nothing.
- Kit that's short on a big job is one line and one action, not a button a
  line; Jobs on a phone starts at the next fortnight.
- Open: the call names drift above (rated 2); a sticky week heading can
  drop if one week alone holds more than a screen of jobs (2); a calendar
  brought back by a restore waits up to a day to be read; vitest's
  advisories need its next major version.
- Colly: clear the start command in Railway's dashboard on both services
  (finding 25), and decide when a demo passcode under 12 characters is
  refused.
