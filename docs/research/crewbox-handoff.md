# Handoff to Crewbox

Crewbox (`legofsalmon/crewbox`, read at `df0be80`) is the on-site box: chat,
push-to-talk, running order, patch sheets, lighting, show log, video and
network monitoring, all on the site's own Wi-Fi with no internet needed.
Session Hire's system is the office and warehouse side. The two meet
twice per event: **before the show** (the box needs to know the event, the
crew and the plan) and **after the show** (the rental system wants to know
what broke and what happened).

## What Crewbox accepts today

| Data                    | How it gets in today                                                                  | Machine route?                          |
| ----------------------- | ------------------------------------------------------------------------------------- | --------------------------------------- |
| Event name, Wi-Fi, PIN  | First-run `/setup` page, `PATCH /api/admin/settings`, or env vars (`server/src/config.ts`) | Admin PATCH only (password unlock)      |
| Crew                    | Each person types a name and the shared event PIN (`POST /api/join`)                  | None. No pre-created users, no email.   |
| Channels                | `#general` at boot; others over the chat WebSocket                                    | None over REST                          |
| Running order           | Yjs doc `timetable/event`, `Act {id, name, stage, date, start, end, changeover}`       | Only via the patch "festival" import    |
| Patch sheet             | CSV import (fuzzy headers) or the festival Google Sheets layout                       | File import in the UI                   |
| Lighting rig            | CSV (Lightwright, Eos, grandMA, Hog headers) or MVR/GDTF                              | File import in the UI                   |

The only keyed machine API is the **control API** (`server/src/control.ts`,
`x-api-key`), which is deliberately read-mostly: it can read state, set
tally and post a system message, and cannot change the event.

## What Crewbox can give back

| Data                       | Where it lives                                  | Readable today by                   |
| -------------------------- | ----------------------------------------------- | ----------------------------------- |
| Show log / incidents       | `incidents` table; `kind=technical` is closest to "kit fault" | `GET /api/incidents` with a crew session token; HTML report |
| As-rigged lighting, patch  | Yjs docs                                        | CSV export in the UI                |
| LED processor faults       | `/api/video/state`                              | Session token                       |
| Crew hours                 | Not tracked (only session first/last seen)      | Nobody                              |
| Chat archive               | `GET /api/admin/export`                         | Admin                               |

## Proposed handoff, in two steps

### Step 1: files only, no Crewbox changes

Session Hire generates a **show pack** for each project:

- a patch CSV in Crewbox's own export layout, if audio inputs were planned;
- a lighting CSV in Crewbox's export columns, if a rig was planned;
- a running order CSV and a printable crew list with the event PIN and the
  join QR (generated from the box's `/connect` URL once the box is known).

The crew chief loads it on the box. This works on day one and needs nothing
from the Crewbox side except the running-order import, which is small.

### Step 2: direct push and pull (needs Crewbox work)

New Crewbox work, proposed as its own PRs on that repo:

1. **`POST /api/control/event`** (control key): set event name and dates,
   seed channels (one per department), pre-create named crew with a role
   and an optional phone or email, and upsert running-order acts into
   `timetable/event` server-side with the existing idempotent `upsertAct`.
2. **Control-key read of the show log**, plus a JSON export, so the rental
   system can pull `technical` incidents after the show.
3. **Asset tags in the show log**: let a crew member scan or pick a case or
   asset number when logging a fault. Session Hire turns that into a repair
   ticket against the asset.
4. **Crew clock-in/out** (optional, later) so hours on site can feed
   timesheets.

The push happens while the box has internet (in the warehouse during prep,
or on site when the uplink is up). Session Hire queues the pack and
retries; Crewbox never depends on it being reachable. When there is no
uplink at all, step 1's files remain the fallback.

A shared identifier matters: each Session Hire project phase carries a
`crewboxEventId` once paired, and each Crewbox act carries the Session Hire
phase id, so re-pushes update instead of duplicating.

## What Session Hire should reuse from Crewbox

Crewbox has solved offline sync for the same people in the same fields.
Worth reusing, or at least copying the approach of:

- **Client outbox with idempotent ids** (`web/src/lib/db.ts`, `flush.ts`,
  `unsent.ts`): every change gets a client id, waits in IndexedDB until the
  server acknowledges it, and the server dedupes retries.
- **Server sequence numbers per stream** (`server/src/hub.ts`): a device
  says "I have up to #42" and gets exactly the gap.
- **Yjs documents** (`web/src/lib/docs/*`, `server/src/docs.ts`) for free-form
  collaborative text such as job notes and run-of-show.
- **`newId()` from `@crewbox/shared`** rather than `crypto.randomUUID`,
  because the Android webview is not always a secure context.
- **PWA shell and update watch** (`web/src/lib/pwa.ts`, `updatewatch.ts`),
  and the two-theme rule (daylight and dark FOH tent).

Licensing note: Crewbox is under the Elastic License 2.0 owned by
LeTissier Creative Studios Ltd. Copying code into Session Hire's system is
fine if the same owner licenses it that way; extracting the sync pieces into
a shared package both repos depend on is the cleaner route.
