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

## Principle: open and flexible, not "our way or no way"

Session Hire's main complaint about Rentman and TeamTrack is that they are
closed and rigid: the product decides how the business works. So these
rules hold everywhere in the design:

- **Your data, always reachable.** A documented API over everything the UI
  can do, webhooks on every change, and a full export (CSV, JSON, Excel)
  any time. Nothing is locked behind a paid tier.
- **Configurable, not hard-coded.** Phase types, job statuses, departments,
  crew roles, rate rules, custom fields on any record, checklists and
  document templates (quotes, call sheets, pick lists) are settings, not
  code. The defaults match how Session Hire works today.
- **Workflows you can bend.** Status changes trigger rules the business
  sets ("when a job is confirmed, email the crew chief and reserve the
  van"), and any rule can be switched off. Nothing forces an order of steps
  the job doesn't need, such as a quote before a booking.
- **Escape hatches.** Any number can be overridden with a note (a price, an
  availability warning, a crew clash), and the override is logged rather
  than blocked.
- **Modules, like Crewbox.** Warehouse, crew and finance are separate
  modules on one core, so a new department or process is a new module, not
  a fork.
- **Plays well with others.** Google Calendar, Crewbox and file exports
  from day one; anything else (accounting, CRM, messaging) through the same
  API a customer could use.

## Principle: meet freelancers in the middle

With Rentman and TeamTrack, freelancers have to come to the company's
system: another app, another login, another profile to maintain for each
company they work for. Most of Session Hire's crew are freelancers who
also work for other companies, so the system bends to them instead:

- **No app or account required.** Offers, call sheets and changes arrive
  where they already look: SMS or WhatsApp, email, and a Google or Apple
  calendar invite. Each message has a one-tap link (accept, decline, view
  the call sheet) that works without signing in. The app is there for
  those who want it, never a condition of getting work.
- **Their calendar, not ours.** A freelancer can share free/busy from
  their own calendar (Google, Apple, Outlook, any iCal) so ops see real
  availability without the freelancer filling in a second calendar. Only
  busy or free is read; never who else they work for.
- **Enter things once.** Certificates, insurance, bank details and rates
  are uploaded once and kept up to date by expiry reminders, not re-asked
  per job. A freelancer can download everything the company holds on
  them at any time.
- **Offers that suit how they work.** Full details up front (dates, call
  times, venue, rate, travel, food), a clear deadline to answer, the option
  to accept only some days of a multi-day job, and to counter the rate.
- **Get paid without chasing.** The days worked and the extras from the
  job (a timesheet, sent from their link) become a ready-made invoice (self-billing, if they agree) that they check and
  approve in one step, with the payment status visible to them.
- **Two-way.** Freelancers can tell the company things too: flag they're
  running late, add a note to the call sheet, swap a shift with another
  approved freelancer if ops allow it.

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
 │  └─ integrations: Google Calendar, Crewbox, exports       │
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
syncs, the server either confirms it or rejects it with a reason ("Show
still has kit: 4 × d&b Y10P. Put it on the whole job or take it off
first"), and the UI turns that into a task for a person rather than
silently undoing it. Running short of kit is a warning rather than a
refusal: the job's kit is kept as asked and every device shows the
shortage until someone sorts it, since the count may be unfinished or the
rest about to be subhired ([ADR 0014](adr/0014-kit-on-jobs.md)).

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

**Decided (29 September 2026, [ADR 0001](adr/0001-sync-engine.md)):** build our own, reusing Crewbox's outbox and sequence
code, with PowerSync as the fallback if the partial replication (each
freelancer only sees their own jobs) turns out harder than expected. The
spike that decided it, and its test results, are in the ADR.

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

Call sheets follow the same scopes ([ADR 0021](adr/0021-call-sheets.md)):
the office's shows everything; the contact on the day, the crew chief of
the table above, sees everyone booked with their numbers and the kit on
their private link; the rest of the crew see who else is on by name and
role, and only the contact's number.

## Domain model (first cut)

**Projects**

Clients, venues, projects and phases are built, and the app calls a project
a job ([ADR 0007](adr/0007-jobs.md)).

- **Client**, **Contact**, **Venue** (address, access notes, load-in details,
  power, parking, what3words). Contacts are held inside the client for now.
- **Project**: a job for a client (for example, Nissan at the Heritage).
  Has a status people set: enquiry, quoted, confirmed, cancelled, lost.
  What the system can see for itself comes from the records that show it:
  on now from the dates, out and returned from scans, invoiced and closed
  from the invoices.
- **Phase**: an ordered part of a project with its own dates and location:
  Prep, Build, Load in, Rehearsal, Show, Babysit, Load out, or custom. A
  phase spans one or more whole days. Each phase-day is what becomes a
  calendar event today.
- **Equipment line**: product and quantity against a project, optionally
  against specific phases, grouped by department (Audio, Lighting, Video,
  Staging, Power, Transport and labour). Includes subhire lines from
  another company. Built as kit lines
  ([ADR 0014](adr/0014-kit-on-jobs.md)): a product and how many, for the
  whole job or one phase, with how many of those are subhired and from
  whom.
- **Crew requirement**: a role needed on a phase ("2 x audio tech, Build and
  Show"), filled by **Crew assignments**. Built as crew calls, asked for from
  the job ([ADR 0002](adr/0002-crew-booking-links.md),
  [ADR 0007](adr/0007-jobs.md)).
- **Quote**: versioned, frozen snapshot of lines and prices sent to the
  client.

**Warehouse and stock**

The catalogue is built: products, items and their labels, places, cases
and counted stock ([ADR 0013](adr/0013-warehouse-catalogue.md)). The app
says product and item; the code says model and asset.

- **Product**: a model (d&b Y10P). Numbered (serialised) or counted
  (bulk); a numbered product can also be counted until its items are
  labelled.
- **Asset**: one numbered item; in stock or retired (sold, scrapped,
  lost, stolen), and kept at a place or in a case. Its id is internal
  and never printed, so a label can be replaced without touching
  history. Where it is right now, out on a job or back, comes from
  scans later.
- **Identifier**: a tag on an asset or case. One asset can carry several
  (the Session Hire QR label with its readable number such as `SH-004217`,
  the manufacturer's serial barcode, and later an NFC or UHF RFID tag).
  Built with the Session Hire number: each is used only once, and an old
  label stays with its item. See
  [research/stock-tracking.md](research/stock-tracking.md).
- **Label run**: numbers set aside for printing, from a first number, as
  many as asked for ([ADR 0015](adr/0015-printing-labels.md)). The next
  free number skips every run, a run is kept for good since its labels
  may be printed, and a label from a run becomes an item's identifier
  when it's scanned and put on the item. The QR code on a label holds
  just the number.
- **Place**: where kit lives: the warehouse, a bay or shelf, a van, the
  repair bench. A flat list, added by typing a new name.
- **Bulk stock**: quantities per place or case (cables, clamps).
- **Container**: a case, rack, bag or cable bundle that holds assets or
  quantities, and can sit inside another container (a rack in a truck
  pack). Built as numbered products that hold other kit, up to five deep;
  moving one moves everything in it. Permanent containers (an amp rack)
  are sealed: scanning the case moves everything in it. Temporary ones (a
  job's mixed case) are packed per job, with pick lists. Checked on
  return against what went out.
- **Movement**: every scan out, scan in, transfer between warehouses, or
  write-off, with who, when, where and the device's offline time. Built
  for scanning out to jobs and back in
  ([ADR 0017](adr/0017-pick-lists-and-scanning-out-and-in.md)): the job,
  the item or the product and how many, and when it happened on the
  phone, never refused; what's out where is worked out on each device
  from the movements in the order they happened, and a case takes what's
  in it along.
- **Maintenance record**: fault reports, repairs, electrical inspection and
  testing, and thorough examination of lifting gear, with due dates. An
  asset under repair, or overdue an inspection, cannot be scanned out
  without an override. Lifting accessories need a thorough examination
  every 6 months under S.I. 299/2007 and a register with a lasting mark on
  each item, which the asset label provides. Faults are built
  ([ADR 0018](adr/0018-faults-missing-kit-and-repairs.md)): an item, or
  some counted kit, reported damaged or missing, with repair notes, and
  closed as fixed, not faulty, found or written off. Since a scan records
  what already happened, scanning out faulty kit is warned about and
  kept, not refused. Inspections are built
  ([ADR 0020](adr/0020-inspections.md)): each PAT and thorough
  examination recorded on an item, passed or failed, kept for good; a
  product says how many months apart its items need each, and each
  device works out when it's next due. Failed or overdue kit is warned
  about when scanned out, the same way.
- **Availability** is computed from equipment lines, movements and
  maintenance, per product per hour, including prep and return buffers.
  Built for now from kit lines and what's owned, per product per whole
  day, on each device ([ADR 0014](adr/0014-kit-on-jobs.md)): confirmed
  jobs hold kit, enquiries and quotes are pencilled in. Movements are
  recorded now (ADR 0017), but kit out past its job isn't yet taken off
  what's free. Kit missing, or damaged and not fit to use, is
  (ADR 0018), and so is kit that failed or is overdue a test
  (ADR 0020); hours and buffers come next.

**People**

- **Person**: staff, freelancer, or a supplier company's contact.
  Skills (audio no. 1, LX op, video tech, rigger, driver), day and half-day
  rates, contact details, emergency contact. Every field can be edited;
  a leaver is archived, never deleted, and can be brought back; a
  freelancer corrects their own phone and email on their link
  ([ADR 0023](adr/0023-audit-round-two-the-loops.md)).
- **Documents**: Safe Pass, manual handling, working at height, IPAF/PASMA,
  driving licence, insurance for companies; with expiry dates and reminders.
  An expired required certificate blocks the assignment, the same way an
  overdue PAT test blocks an asset.
- **Availability**: freelancers mark unavailable days; offers respect them.
- **Leave and time in lieu**, for staff ([ADR 0024](adr/0024-staff-leave.md)):
  annual leave applied for and approved in whole days, counted in the
  weekdays that aren't Irish public holidays, against a calendar-year
  allowance; days in lieu logged for a day worked and approved the same
  way. Whoever has "Can approve time off" decides, never their own.
  Approved leave is days off, so the planner shows it and offers warn.
- **Crew assignment**: person on a phase in a role at an agreed rate, with a
  status (proposed, offered, accepted, declined, confirmed, cancelled, or
  pulled-out when a booked freelancer says they can't make it) and a
  call time. Offers go out by app, email, calendar invite, and SMS or
  WhatsApp. A call can be changed after it's made and a moved phase can
  take its crew with it; the app prompts the office to tell the people
  affected, and the office's own phone and email sit on every
  freelancer page ([ADR 0023](adr/0023-audit-round-two-the-loops.md)).
- **Timesheet**: the days worked on a booking at its day rate, and the
  extras (parking, mileage), sent by the freelancer from their link and
  approved by ops, who can change it and say why
  ([ADR 0022](adr/0022-timesheets.md)). Session Hire's freelancers bill a
  day rate, not hours.

**Finance (light)**

- Price lists and discounts per client, day and week rates, multi-day
  factors.
- Quotes and invoices in EUR with Irish VAT (23% and 13.5%, rate per line
  so it can change), EU reverse charge, GBP for Northern Ireland jobs,
  deposits and credit notes.
- Freelancer costs from confirmed assignments and timesheets.
- Job profitability: quoted versus actual kit, crew, subhire and transport.
- **No accounting integration at first.** Session Hire's bookkeeping is
  fairly offline today, so the system is the place to *see* the money and
  hand it on, not a ledger:
  - a finance dashboard: quoted, confirmed and invoiced revenue by month,
    what is outstanding and overdue, freelancer costs owed, and margin per
    job;
  - exports an accountant can use as they are: invoice and credit note
    registers, a VAT summary by rate and period, freelancer payments, and
    per-job profit, as CSV and Excel, plus the invoice PDFs;
  - every export built from one internal ledger-style table (date,
    document, client, net, VAT rate, VAT, gross, category), so a Xero,
    QuickBooks or Sage connector can be added later by mapping that table,
    without reworking anything.

**Everything** carries an audit trail: who changed what, when, from which
device, and whether it was made offline. Built in Phase 0 as the History
tab ([ADR 0006](adr/0006-audit-trail-and-export.md)).

## Google Calendar during the transition

Goal: nobody has to change how they work on day one, and the calendar stays
right after the switch.

**Built so far** ([ADR 0008](adr/0008-calendar-sync.md)): the app writes
every day of every confirmed job, from today on, to one calendar picked on
the Account tab, as one Google account connected by a member of staff. The
app leads. Event ids are worked out from the job, so a retried write never
doubles an event, and the app's hidden mark keeps it to its own events. It
runs when something changes and checks the calendar once a night, rather
than watching it, so the database can sleep.

With crew invites on ([ADR 0009](adr/0009-crew-invites.md), a switch on the
Account tab that starts off), crew offered or booked are guests on their
days' events, and their Yes or No in Google counts as their answer to the
offer, through the same rules as their private link. The server asks Google
every two minutes which of its events changed since the last look (with a
few minutes to spare), compares the answers with the ones it holds in
memory, and only touches the database when one has changed; each answer is
taken in once, even with two servers running during a deploy. Every change
to an event reads it first and is written only if it is unchanged since, so
guests added by hand and answers given in between are kept. Guests hear
from Google only when they are added or taken off, or the title, date or
place changes. Push notifications from Google would bring answers in
seconds rather than minutes; they come with calendar-led jobs, when edits
in Google have to flow back in quickly.

The week and month view the office opens Google Calendar for today is in
the app too ([ADR 0010](adr/0010-planner.md)): the planner lays out every
job, or every person, by day, with the crew still to find and clashes
flagged, worked out on each device from what it holds, so it needs no
signal. Google Calendar stays as the crew's view of their own work. What
follows is the full plan.

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
- **RSVPs flow in** (built): a freelancer accepting the invite accepts
  the offer; declining every day declines it; a No from someone already
  confirmed is shown to ops rather than unbooking them.
- **Edits flow in** while a project is in *calendar-led* mode: an ops
  person moving an event in Google moves the phase. Once a project is
  switched to *app-led*, the system owns date, title and attendees, and an
  edit in Google is reverted with a note to the person who made it.
- New projects start app-led once Phase 1 is live; old ones stay
  calendar-led until they finish.

**Import** (built, [ADR 0011](adr/0011-calendar-import.md)). The office
brings in the jobs on any calendar the connected account can see: its own,
or an organiser's once they share it (both directly, with a Google
Workspace domain-wide delegation grant, later). The server reads the
all-day events, splits each title at its last " - " into job and phase,
puts a job's days in a row into phases (more than 14 days apart is another
job), and matches locations to venues and guests to people, then shows all
of it before anything is saved. Bringing in saves the ticked jobs in one
change, with a crew call per phase and offers from the guests' answers,
and remembers each event-day by the id Google gives it on every calendar,
so looking again shows only what is new and lists what changed in Google.
Job sheets go into the notes as written; turning kit lists into kit lines
can come once the stock list has the products to match them against
([ADR 0014](adr/0014-kit-on-jobs.md)). A job brought in stays
with the calendar it came from, which keeps its events, so the app doesn't
write it to the jobs calendar.

**Personal feeds** (built, [ADR 0012](adr/0012-personal-calendar-feeds.md)).
Every person also gets a feed of their own bookings for any calendar app
(Google, Apple, Outlook), at a read-only address worked out from their
private link: it can go in a calendar they share without letting anyone
answer for them, and a new link retires it. Freelancers find it on their
page, the office copies it from the Crew tab, and staff who also work jobs
find theirs on the Account tab. The server keeps every feed in memory and
builds them again only after a change, so calendar apps looking every
hour don't keep the database awake. The server's log masks private link
and feed addresses.

## Crewbox

See [research/crewbox-handoff.md](research/crewbox-handoff.md). In short:
a **show pack** of files first (no Crewbox changes needed), then a keyed
push of event, crew and running order into the box and a pull of technical
incidents back as repair tickets, which needs four small additions to
Crewbox.

## Mobile

- **PWA first.** Installable, offline shell, works on iOS and Android.
  Bluetooth barcode scanners work as keyboards, and camera scanning works in
  the browser (built, [ADR 0016](adr/0016-camera-scanning.md)): the
  `BarcodeDetector` API on Android, and a QR code reader in the app
  (`jsQR`) elsewhere, kept with the app so it works with no signal. A read
  is handled like a number typed or sent by a scanner; pictures never
  leave the phone.
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
| Auth           | Google Workspace sign-in for staff ([ADR 0003](adr/0003-staff-sign-in.md)); a private link per freelancer ([ADR 0002](adr/0002-crew-booking-links.md)) | Staff already have Workspace; freelancers do not |
| Hosting        | One EU region to start (Dublin or Frankfurt)                      | GDPR, latency                                     |
| Tests          | Vitest, Playwright including offline scenarios                    | Same as Crewbox                                   |

## Resilience

- Postgres with point-in-time recovery, plus a nightly logical backup to
  separate storage, each one restored into a scratch database to prove it
  works before it counts ([ADR 0004](adr/0004-backups.md)). After a
  restore, devices reload their copy and send again what the backup missed.
- Start fresh on the Account tab deletes everything but the staff
  accounts, after a backup, to clear made-up data before the real data
  goes in ([ADR 0019](adr/0019-made-up-data-and-starting-fresh.md)).
  Devices reload their copy as after a restore, but drop what they had
  waiting instead of sending it again, and the server turns down changes
  made on the copy from before.
- The outbox means no scan or change is lost if the server is down; devices
  keep working from their replica.
- Every command is idempotent by its client id, so retries are safe.
- Health checks, error alerts and an uptime check from day one, with
  Sentry, which also emails when a night's backup fails or doesn't happen.
  Reports are built to leave out anyone's details
  ([ADR 0005](adr/0005-error-alerts.md)).
- An export of everything (CSV and JSON) that the company can run any time,
  so it is never locked in, which is a common complaint about the incumbents.
  Built as **Download everything**: one file with a spreadsheet for each
  table, all of it as JSON, and the history in words
  ([ADR 0006](adr/0006-audit-trail-and-export.md)).

## Security and GDPR

- Roles: owner, ops, warehouse, crew chief, freelancer, accountant (read
  finance only). Enforced on the server and in the sync scopes.
- Personal data of freelancers (PPS number if ever needed for payments, bank
  details, documents) kept in separate tables with tighter access and
  deletion on request.
- Data stays in the EU. A processing record and retention rules are written
  before crew data goes in.

## Open questions for Session Hire

1. ~~Is `sessionhire.com` on Google Workspace?~~ Answered: yes. Admin
   access for the import and sync will be granted later; until then the
   sync is built and tested against a test calendar.
2. ~~Which accounting package do you use?~~ Answered: bookkeeping is
   fairly offline, so finance is a dashboard and exporter first, with
   integration added if that grows.
3. ~~Roughly how many assets, freelancers and jobs a year?~~ Answered:
   thousands of assets, 100+ freelancers, hundreds of jobs a year. **No
   stock is barcoded**, so choosing and rolling out a tracking method is
   part of the project; see [research/stock-tracking.md](research/stock-tracking.md).
   Still open: is there a spreadsheet or old list of stock to import?
4. ~~What made you rule out Rentman and TeamTrack?~~ Answered: closed
   ecosystems, lack of flexibility, and a cumbersome, company-centred way
   for freelancers to deal with the business. These became the "open and
   flexible" and "meet freelancers in the middle" principles above.
5. Is Crewbox always going to be owned by the same people, so its sync code
   can be shared as a package?
