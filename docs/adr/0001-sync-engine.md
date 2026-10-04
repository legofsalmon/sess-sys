# ADR 0001: Build our own sync engine on the Crewbox pattern

- **Status:** Accepted, 29 September 2026. Field test on real phones still to do once the app is hosted.
- **Decides:** the open question "own sync or PowerSync" from [architecture.md](../architecture.md).
- **Amended:** 2 October 2026, from the [audit](../audit-2026-09-30.md)'s
  P3 list: the sync test this was decided with is gone. Its screen under
  Stock, its `product.upsert`, `booking.create`, `booking.cancel` and
  `scan.record` commands, and its products, bookings, scans and issues
  tables went with it; each table was dropped only if it was empty, as
  all four were on the live database. The evidence below is still proved
  on every run, on the warehouse's counted stock instead: `stock.move`
  carries the two devices moving the same four speakers (1, 3, 4, 5 and
  8, with 7 against real Postgres), a batch judged change by change in
  order stands in for 2, and `move.record` for 6, scans kept even beyond
  the plan. A phone on an older version that still sends one of the old
  commands has it turned down in plain words ("The app doesn't do this
  any more, so it wasn't made."), with nothing kept, while the rest of
  its outbox goes through; the old records in its copy sit unused.
- **Amended:** 2 October 2026 by [ADR 0027](0027-erasing-a-person-on-request.md): erasing a person on request rewrites the earlier copies of their records in the change feed, which otherwise only ever grows, so a new device's first sync can't pull their old details.
- **Amended:** 4 October 2026: control characters. Postgres keeps no NUL
  in text or JSON, and text pasted from Word or a PDF can carry invisible
  control characters, so a NUL in a person's name failed the whole push.
  Typed text is now cleaned, not refused: nobody can see a stray control
  character to take it out. The shared helpers every command uses
  (`shared/src/plain.ts`) keep tab, line feed and carriage return, turn a
  vertical tab (Word's line break), a form feed and the old next-line
  character into line feeds, and drop the rest, and half an emoji left by
  cutting text short. The device keeps a command as its schema reads it,
  so it sends cleaned text and lays it over its copy, the server cleans
  again to the same text, and its change coming back matches. A command
  from an older version of the app is recorded with its text cleaned the
  same way. The CSV reader and text from Google Calendar are cleaned as
  they're read. Where a character can't be cleaned, such as in an id, the
  server turns that one change down in plain words ("Something in this
  has a character the app can't keep, so it wasn't saved. Check it and
  try again.") and the rest of the push goes on; any other request gets
  a 400 in the same words. It's what was sent, so it's not reported as a
  fault. Only those characters count: the same codes for anything else,
  such as JSON the server built wrong, are the server's own fault and
  are reported as any fault is. Real Postgres and PGlite refuse these
  the same way, and both are tested.
- **Amended:** 4 October 2026: a sync asked for while a round is failing
  (as the app asks when the phone says it's back online) gets a round of
  its own rather than the failure of the round sent before, which left
  "No signal" showing until the next retry, up to 30 seconds on. The
  app's retries (`shared/src/sync/retry.ts`) leave one retry for each
  sync however many asked for it, still backing off to every 30
  seconds: a retry each stacked up, so a few asks while a slow round
  failed kept a phone on a poor signal trying every few seconds for
  ten minutes.

## Context

Session Hire's app has to work with no signal in warehouses, fields and
basements, and must never overbook stock. Most offline-first tools either
let the last write win or merge everything automatically; neither works when
two people offline both book the last four speakers. The options were:

| Option | For | Against |
| --- | --- | --- |
| Own engine, Crewbox pattern | Same team already runs it in the field; full control of conflict rules; no extra service | More to build and test |
| PowerSync | Mature partial replication, self-hostable | Another service to run; its own rule language for who sees what |
| ElectricSQL, Zero, Replicache | Good real-time reads | Offline writes weak or left to us |

## What we built to decide

A thin slice of the real model (products, bookings, scans, issues) with:

- **Commands, not row edits.** A device sends "book 4 × Y10P for Nissan"; the
  server alone decides. Validation runs on the device too, for quick feedback.
- **An outbox** saved before anything is sent. Each command has its own id and
  the server stores every answer, so resending after a lost response applies
  nothing twice.
- **A change feed** with a sequence number. Devices pull "everything after N".
  Writes take one advisory lock so numbers become visible strictly in order
  and a slow commit can never be skipped.
- **Pokes, not data, on the WebSocket.** A dropped socket loses nothing; the
  next pull covers it.
- **Scans are facts.** A scan is never refused. If it does not match the plan,
  it is recorded and an issue is raised for a person.
- **Audit and export from day one.** Every command is kept with who sent it,
  the device time and the arrival time; `/api/export` returns everything.

## Evidence

All of these pass (`npm test`, `npx playwright test`):

1. Two devices offline book the same four speakers. On reconnect the first is
   confirmed, the second becomes a problem with the reason ("Only 0 × d&b
   Y10P free… Subhire or change the dates"), and both devices agree.
2. Bookings on different days do not count against each other; a
   cancellation frees stock.
3. A response lost on the way back, then a resend: applied exactly once.
4. The app reloaded from storage keeps its outbox.
5. The server restarted between two syncs, same database: nothing lost.
6. Offline scans that exceed the booking are accepted and raise an issue.
7. Twenty devices booking at the same moment against real Postgres: exactly
   four succeed and the change feed has no gaps.
8. In a real browser: the phone goes into flight mode, the app reloads from
   the device, a booking waits, the office books the same speakers, the phone
   reconnects and shows the refusal.

## Decision

Build our own engine on this pattern. It is small (about 300 lines on each
side), it already does the hard part correctly, and every rule about what
may conflict stays in plain TypeScript next to the domain code.

## Consequences

- We own replication scopes (who gets which records). The spike syncs
  everything; per-person scopes come with the real model in Phase 1.
- The single write lock is fine at Session Hire's scale. If writes ever
  queue behind it, the change feed can move to per-scope sequences.
- Multiple server instances will need Postgres `LISTEN/NOTIFY` for pokes.
- Revisit PowerSync only if partial replication turns out harder than it
  looks here.
