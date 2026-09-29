# Session Hire system: proposed architecture

Status: proposal for review, 2026-09-29. Nothing is built yet.

Read with [research/competitor-audit.md](research/competitor-audit.md),
[research/current-process.md](research/current-process.md) and
[research/crewbox-handoff.md](research/crewbox-handoff.md). The build order
is in [roadmap.md](roadmap.md).

## What it has to be

- **One system for the whole job:** quote, book, prep, crew, deliver, return,
  invoice. Four areas: projects and planning, warehouse and stock, crew,
  light finance.
- **Web first, phone as much as laptop.** Warehouse staff scan with a phone;
  crew chiefs check call times on a phone in a field; ops plan on a laptop.
- **Offline is normal, not an error.** A warehouse with bad signal, a field
  in Screggan, a basement venue. Reading and the common writes (scan out,
  scan in, mark a fault, tick a checklist, accept a job) must work with no
  connection and sync when it comes back.
- **Real-time when online.** Two people planning the same job see each
  other's changes within a second.
- **Reliable and resilient.** No lost scans, no double bookings, backups
  that are tested, a clear record of who changed what.
- **Google Calendar keeps working** during the move, in both directions.
- **Hands off to Crewbox** for the on-site part.
- **Irish:** EUR, Irish VAT, GDPR, data held in the EU.

## Where this beats the off-the-shelf tools

The [competitor audit](research/competitor-audit.md) found five gaps no
product covers well. They set the priorities below:

1. **Offline-first warehouse and site work.** No product documents real
   offline scanning with sync afterwards; Current RMS's scanner is iOS-only.
2. **Two-way Google Calendar sync.** Everyone offers a one-way iCal feed
   that Google refreshes about once a day.
3. **Handoff to on-site comms and back.** Rental tools stop at the call
   sheet; nothing brings damage, shortages and extra kit back from site.
4. **Contractor-heavy crewing in the same system as the kit.** Crew is
   bolted on, or lives in a separate tool with fragile one-way links.
5. **Irish defaults:** 23% and 13.5% VAT, EU reverse charge, GBP for
   Northern Ireland work, certificate expiry blocking assignment.

Where not to compete: Rentman's quoting and invoicing breadth and HireHop's
core stock handling. Matching them is enough.

## The shape of the system

```
 Phones / laptops (PWA, optional Capacitor shell for scanning)
 ┌───────────────────────────────────────────────────────────┐
 │ React UI                                                  │
 │  ├─ local replica (SQLite-in-browser or IndexedDB)        │
 │  ├─ outbox of commands (client ids, retried until acked)  │
 │  └─ Yjs docs for free text (job notes, run of show)       │
 └──────────────┬────────────────────────────────────────────┘
                │ HTTPS + WebSocket (changes streamed by sequence number)
 ┌──────────────┴────────────────────────────────────────────┐
 │ API server (TypeScript, Fastify)                          │
 │  ├─ command handlers: validate, check availability, write │
 │  ├─ change feed: per-scope sequence numbers               │
 │  ├─ jobs: calendar sync, emails, PDF quotes, exports      │
 │  └─ integrations: Google Calendar, Crewbox, accounting    │
 └──────────────┬────────────────────────────────────────────┘
                │
       Postgres (EU region, point-in-time recovery)
       Object storage (PDFs, photos, documents)
```

### Why commands, not a free-for-all merge

Most offline-first tools either sync rows and let the last write win, or use
CRDTs that merge anything. Neither is right for rental stock: two people
offline can both "book" the last four Y10Ps, and a merge cannot make a fifth
speaker appear.

So the client sends **intentions** ("add 4 x Y10P to Nissan, 4 to 7 Oct",
"scan asset 00123 out to Nissan"), not raw row edits. The server is the only
thing that decides whether they succeed. Offline, the client applies the
command optimistically to its local copy and shows it as pending. When it
syncs, the server either confirms it or rejects it with a reason ("only 2
available; 2 more would need a subhire"), and the UI turns that into a task
for a person rather than silently undoing it.

Some commands can never be rejected, because they record something that
already happened in the physical world: a scan, a fault report, a checklist
tick. Those are stored as events and reconciled afterwards ("asset 00123
was scanned out to Nissan but was booked on Fuel: conflict to resolve").
This is how the warehouse keeps working in a dead spot without the system
ever lying about stock.

This is the same pattern Crewbox uses for chat (client id, outbox, server
sequence numbers) extended with server-side validation. Free text that many
people edit at once (job notes, run of show) uses Yjs, as Crewbox does for
patch sheets.

### Build or buy the sync layer

| Option                          | For                                               | Against                                                       |
| ------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| **Own, on the Crewbox pattern** | Already proven by the same team in the field; full control of conflict rules; no vendor | More to build and test up front                               |
| PowerSync (Postgres to on-device SQLite) | Mature partial replication, self-hostable, upload queue you control | Another service to run; its rule language for who sees what   |
| ElectricSQL / Zero / Replicache | Good real-time read sync                          | Offline writes weak or left to you; younger products          |

**Recommendation:** build our own, reusing Crewbox's outbox and sequence
code, with PowerSync as the fallback if the partial replication (each
freelancer only sees their own jobs) turns out harder than expected. This
is decided in an ADR in the first build phase, after a one-week spike.

### What lives on the device

Nobody's phone holds the whole company. Each device syncs **scopes**:

| Who                    | What syncs to their device                                                    |
| ---------------------- | ----------------------------------------------------------------------------- |
| Ops / office           | All live projects from 30 days back to 12 months ahead, full catalogue, crew  |
| Warehouse              | Catalogue, assets, cases, stock locations, pick lists for the next 14 days     |
| Crew chief on a job    | That job: phases, crew list and phone numbers, kit list, run of show, venue   |
| Freelancer             | Their own offers and bookings, call times, venue details, their documents     |

Scopes also enforce privacy: a freelancer's device never receives rates or
personal details of other crew.

## Domain model (first cut)

**Projects**

- **Client**, **Contact**, **Venue** (address, access notes, load-in details,
  power, parking, what3words).
- **Project**: a job for a client (for example, Nissan at the Heritage).
  Has a status: enquiry, quoted, confirmed, in progress, returned, invoiced,
  closed, lost.
- **Phase**: an ordered part of a project with its own dates and location:
  Prep, Build, Load in, Rehearsal, Show, Babysit, Load out, or custom. A
  phase spans one or more days. This is the thing that becomes a calendar
  event today.
- **Equipment line**: product and quantity against a project, optionally
  against specific phases, grouped by department (Audio, Lighting, Video,
  Staging, Power, Transport and labour). Includes subhire lines from
  another company.
- **Crew requirement**: a role needed on a phase ("2 x audio tech, Build and
  Show"), filled by **Crew assignments**.
- **Quote**: versioned, frozen snapshot of lines and prices sent to the
  client.

**Warehouse and stock**

- **Product**: a model (d&b Y10P). Serialised or bulk.
- **Asset**: one serialised item with a barcode or QR label; has a status and
  a location.
- **Bulk stock**: quantities per location (cables, clamps).
- **Kit / case**: a fixed set of assets or products (a "Y10P stack" or a
  "ops kit"), scanned as one unit and checked on return.
- **Movement**: every scan out, scan in, transfer between warehouses, or
  write-off, with who, when, where and the device's offline time.
- **Maintenance record**: fault reports, repairs, PAT tests, inspections,
  with due dates. An asset under repair is not available.
- **Availability** is computed from equipment lines, movements and
  maintenance, per product per hour, including prep and return buffers.

**People**

- **Person**: staff, freelancer, or a supplier company's contact.
  Skills (audio no. 1, LX op, video tech, rigger, driver), day and half-day
  rates, contact details, emergency contact.
- **Documents**: Safe Pass, manual handling, working at height, IPAF/PASMA,
  driving licence, insurance for companies; with expiry dates and reminders.
  An expired required certificate blocks the assignment, the same way an
  overdue PAT test blocks an asset.
- **Availability**: freelancers mark unavailable days; offers respect them.
- **Crew assignment**: person on a phase in a role at an agreed rate, with a
  status (proposed, offered, accepted, declined, confirmed, cancelled) and a
  call time. Offers go out by app, email, calendar invite, and SMS or
  WhatsApp.
- **Timesheet**: actual hours per assignment, approved by ops.

**Finance (light)**

- Price lists and discounts per client, day and week rates, multi-day
  factors.
- Quotes and invoices in EUR with Irish VAT (23% and 13.5%, rate per line
  so it can change), EU reverse charge, GBP for Northern Ireland jobs,
  deposits and credit notes.
- Freelancer costs from confirmed assignments and timesheets.
- Job profitability: quoted versus actual kit, crew, subhire and transport.
- Export to the accounting package (Xero, QuickBooks Online or Sage;
  to be confirmed) rather than becoming one.

**Everything** carries an audit trail: who changed what, when, from which
device, and whether it was made offline.

## Google Calendar during the transition

Goal: nobody has to change how they work on day one, and the calendar stays
right after the switch.

**Where events live.** The system writes to the existing shared **Session
Hire Gigs** calendar, so there is one place everyone subscribes to. Each
phase-day becomes one all-day event, in today's format:
`<Project> - <Phase> [n/m]`, venue as location, crew as attendees. The
description is generated: call time, run of show, a link back to the job,
and the kit list for staff (not for external crew).

**Two-way sync.**

- The system keeps its own id on each event (`extendedProperties.private`),
  so it never confuses its events with anyone's personal ones.
- It watches the calendar with Google's push notifications and incremental
  sync tokens, so changes arrive in seconds.
- **RSVPs flow in:** a freelancer accepting the invite marks their
  assignment accepted; declining frees the slot and alerts ops.
- **Edits flow in** while a project is in *calendar-led* mode: an ops
  person moving an event in Google moves the phase. Once a project is
  switched to *app-led*, the system owns date, title and attendees, and an
  edit in Google is reverted with a note to the person who made it.
- New projects start app-led once Phase 1 is live; old ones stay
  calendar-led until they finish.

**Import.** A one-off importer reads the organisers' calendars
(with a Google Workspace domain-wide delegation grant, or each organiser
connecting their account) and turns events into draft projects: groups by
the text before the first " - ", orders phases, maps attendees to people,
and parses kit list descriptions into draft equipment lines marked for
review.

**Personal feeds.** Every person also gets a private iCal feed of their own
bookings, which works for freelancers on any calendar app.

## Crewbox

See [research/crewbox-handoff.md](research/crewbox-handoff.md). In short:
a **show pack** of files first (no Crewbox changes needed), then a keyed
push of event, crew and running order into the box and a pull of technical
incidents back as repair tickets, which needs four small additions to
Crewbox.

## Mobile

- **PWA first.** Installable, offline shell, works on iOS and Android.
  Bluetooth barcode scanners work as keyboards, and camera scanning works in
  the browser (the `BarcodeDetector` API on Android, a WASM decoder on iOS).
- **Capacitor wrapper** for the warehouse app when we need what the browser
  cannot do reliably: faster native camera scanning, background sync on
  iOS, NFC tags, and staying signed in for months. Crewbox already has a
  Capacitor setup to copy.
- **RFID** (for example, Zebra handhelds) is a later option; the Movement
  model already treats "scanned" the same whatever the reader.

## Technology

| Layer          | Choice                                                            | Why                                               |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------------- |
| Language       | TypeScript everywhere, npm workspaces                             | Same as Crewbox; shared types and schemas         |
| Web            | React, Vite, vite-plugin-pwa                                      | Same as Crewbox                                   |
| Local store    | SQLite in the browser (wa-sqlite on OPFS), IndexedDB fallback     | Real queries for availability offline             |
| API            | Fastify, zod schemas shared with the client                       | Same as Crewbox                                   |
| Database       | Postgres in an EU region, managed, with point-in-time recovery    | Relational data, range queries for availability   |
| Jobs           | Postgres-backed queue (pg-boss or graphile-worker)                | No extra service                                  |
| Files          | S3-compatible storage in the EU                                   | Quotes, photos of damage, documents               |
| Auth           | Google Workspace sign-in for staff; email magic link for freelancers | Staff already have Workspace; freelancers do not |
| Hosting        | One EU region to start (Dublin or Frankfurt)                      | GDPR, latency                                     |
| Tests          | Vitest, Playwright including offline scenarios                    | Same as Crewbox                                   |

## Resilience

- Postgres with point-in-time recovery, plus a nightly logical backup to
  separate storage, restored into a scratch database weekly to prove it
  works.
- The outbox means no scan or change is lost if the server is down; devices
  keep working from their replica.
- Every command is idempotent by its client id, so retries are safe.
- Health checks, error tracking and an uptime alert from day one.
- An export of everything (CSV and JSON) that the company can run any time,
  so it is never locked in, which is a common complaint about the incumbents.

## Security and GDPR

- Roles: owner, ops, warehouse, crew chief, freelancer, accountant (read
  finance only). Enforced on the server and in the sync scopes.
- Personal data of freelancers (PPS number if ever needed for payments, bank
  details, documents) kept in separate tables with tighter access and
  deletion on request.
- Data stays in the EU. A processing record and retention rules are written
  before crew data goes in.

## Open questions for Session Hire

1. Is `sessionhire.com` on Google Workspace, and can an admin grant the
   calendar access for the import and sync?
2. Which accounting package do you use?
3. Roughly how many serialised assets, bulk lines, freelancers and jobs a
   year? Is any stock already barcoded, and is there a spreadsheet or old
   system to import from?
4. What made you rule out Rentman and TeamTrack: price, missing features,
   or something they do badly? That tells us where to spend effort first.
5. Is Crewbox always going to be owned by the same people, so its sync code
   can be shared as a package?
