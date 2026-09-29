# ADR 0001: Build our own sync engine on the Crewbox pattern

- **Status:** Accepted, 29 September 2026. Field test on real phones still to do once the app is hosted.
- **Decides:** the open question "own sync or PowerSync" from [architecture.md](../architecture.md).

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
