# Session Hire system: phased plan

Status: proposal for review, 2026-09-29. See [architecture.md](architecture.md)
for the design these phases build.

The order is chosen so that each phase replaces something people do today
and is useful on its own, and so that the riskiest technical piece (offline
sync with server-checked availability) is proven before anything depends on
it. Durations are deliberately left out until the open questions in the
architecture doc are answered.

## Phase 0: Foundations

**Status: built; the phone field test is left.** Sync engine built and decided ([ADR 0001](adr/0001-sync-engine.md)); app live on Railway with Postgres in Frankfurt; staff sign-in built ([ADR 0003](adr/0003-staff-sign-in.md)) and waiting on its Google key; nightly backups with a test restore built ([ADR 0004](adr/0004-backups.md)) and waiting on their bucket; error alerts and uptime checks with Sentry built ([ADR 0005](adr/0005-error-alerts.md)) and waiting on the Sentry key; the history of every change and Download everything built and on ([ADR 0006](adr/0006-audit-trail-and-export.md)). Made-up data to try every part of the app with, and Start fresh to clear it all before the real data goes in, built and on ([ADR 0019](adr/0019-made-up-data-and-starting-fresh.md)). See [progress.md](progress.md).

- Repo, CI, preview deploys, EU hosting, backups with a tested restore.
- Staff sign-in with Google Workspace; freelancer magic links.
- **Sync spike**: the outbox, command handlers and change feed on one toy
  entity, tested offline on real phones in a dead spot. Ends with an ADR:
  own sync on the Crewbox pattern, or PowerSync.
- Audit trail and the "export everything" job from the start.

**Done when:** a change made on a phone in flight mode appears on a laptop
within a second of the phone reconnecting, and survives the server being
restarted mid-sync.

## Alongside Phase 0 and 1: labelling pilot

No stock is barcoded yet and labelling thousands of items takes months,
so the label trial starts early: order sample QR labels, metal tags and
cable labels, put them on a few cases and cables, and see what survives a
few jobs. Hardware to start is roughly £4-6k (two rugged Android scanners,
pocket and ring scanners, a label printer and a portable labeller); see the
research for the list. UHF RFID for cables is a later option.

## Phase 1: Projects and the calendar (replace the invite-by-hand workflow)

**Status: started 29 September 2026.** Jobs with their phases, clients and
venues built and on, with crew asked for from the job
([ADR 0007](adr/0007-jobs.md)). Confirmed jobs go onto Google Calendar in
today's event format, kept up to date by the app
([ADR 0008](adr/0008-calendar-sync.md)); it switches on with the Google key
and a calendar connected on the Account tab. Crew can be invited to their
days, with their Yes or No in Google counting as their answer, behind a
switch that starts off ([ADR 0009](adr/0009-crew-invites.md)). The week and
month planner shows every job and person, with clashes flagged
([ADR 0010](adr/0010-planner.md)). The jobs already on the organisers'
calendars can be brought in, after a look at everything that would come
in ([ADR 0011](adr/0011-calendar-import.md)). Everyone has a read-only
feed of their own bookings for any calendar app
([ADR 0012](adr/0012-personal-calendar-feeds.md)). **Everything on the
Phase 1 list is built (30 September 2026)**; what's left is the office
using it for real, which needs the Google key. See
[progress.md](progress.md).

- Clients, venues, projects, phases, crew requirements and assignments
  (built).
- Confirmed jobs written to a Google calendar in today's event format, app
  leading (built; tried first on Colly's test calendar, then **Session
  Hire Gigs**).
- Crew as attendees on the events, with RSVPs updating assignments (built,
  behind a switch on the Account tab that starts off; tried first on the
  test calendar with staff's own addresses).
- Importer for the organisers' existing calendars (built: jobs come in
  confirmed or pencilled in, with their crew, after a look at everything
  first).
- A planner view: the week and month by project and by person, with
  clashes flagged (the same freelancer on two jobs) (built; looking only
  for now, with dragging phases to wait until the office has used it).
- Personal iCal feeds (built: a read-only address for each person, safe
  in a shared calendar, found on their page, the Crew tab and the Account
  tab).

**Done when:** ops create every new job in the system, crew still receive
the same Google invites, and nobody has to type a job twice.

## Phase 2: Warehouse and stock

**Started 30 September 2026.** The catalogue is built
([ADR 0013](adr/0013-warehouse-catalogue.md)): products numbered or
counted, items with Session Hire numbers that are never used twice,
places, cases up to five deep, and counts, in the Stock tab and working
with no signal. Kit on jobs is built too
([ADR 0014](adr/0014-kit-on-jobs.md)): each job's products and how many,
for the whole job or a phase, with shortages worked out on each device
and subhire. So is printing labels ([ADR 0015](adr/0015-printing-labels.md)):
numbers set aside a run at a time, printed here or by a label maker, and
put on items by scanning them. And so is scanning with the phone's camera
in the app ([ADR 0016](adr/0016-camera-scanning.md)), and so are pick
lists with scanning kit out to jobs and back in
([ADR 0017](adr/0017-pick-lists-and-scanning-out-and-in.md)), and so are
faults, missing kit and repairs
([ADR 0018](adr/0018-faults-missing-kit-and-repairs.md)). See
[progress.md](progress.md).

- Catalogue, products, assets, containers, bulk stock, locations (built:
  products, numbered items with their labels, cases, counted stock and
  places).
- Label printing: QR plus a readable number on polyester labels, riveted
  metal tags for cases and rigging, heat-shrink or flag labels for cables
  (built: numbers set aside for a run, the next free number skipping
  them; printed from the browser on a label printer or A4 sheets, or a
  spreadsheet for a label maker; claimed by scanning in the Stock search;
  an item's own label from its page).
- The labelling rollout from [research/stock-tracking.md](research/stock-tracking.md):
  pilot the label materials, then compliance items, then high-value gear
  labelled as it comes back from jobs, then cases, then cables as bundles,
  then a baseline stocktake and rolling cycle counts.
- Equipment lines on projects, with live availability and shortage
  warnings, including subhire lines (built: kit lines for the whole job
  or a phase; confirmed jobs hold kit and enquiries and quotes are
  pencilled in; short is warned about, never refused).
- Scanning with the phone's camera in the app, offline (built: labels and
  makers' barcodes in the Stock search, one after another).
- Pick lists per project, **scan out and scan in on a phone, offline**,
  missing and damaged items on return, and a conflict queue for scans that
  did not match the plan (built: each job's pick list with where to find
  its kit, scanned or counted out and back with no signal, a case taking
  what's in it along; a scan that doesn't match the plan is kept and
  said; the Stock tab lists jobs going out soon and kit still out;
  damaged and missing kit reported as it comes back, and a missing item
  scanned is marked found. A separate queue for scans that didn't match
  isn't needed yet: each is said as it happens and fixed by scanning).
- Faults, repairs, PAT and inspection records; unavailable while in repair
  (built: faults and missing kit on items and counted kit, the Stock
  tab's repair list with repair notes, fixed, found or written off, and
  kit that can't go out taken off what's free for jobs; PAT tests and
  thorough examinations recorded per item or a batch by scanning, with
  when each is next due, and failed or overdue kit taken off what's
  free and warned about when scanned out).

**Done when:** a job's kit is picked and returned by scanning, and
availability for next week is trusted without walking the shelves.

## Phase 3: Crew

Built to the "meet freelancers in the middle" principle in
[architecture.md](architecture.md): no app or login needed to get work.

**Started early, 29 September 2026**, in parallel with Phase 0 and 1
([ADR 0002](adr/0002-crew-booking-links.md)). Done so far: offers to one
person or a shortlist, private freelancer links (accept some days, decline,
counter the rate, days off), no double booking, personal calendar feeds,
offer messages ready for WhatsApp, text or email, and crew asked for from a
job's phases ([ADR 0007](adr/0007-jobs.md)).

- Freelancer profiles, skills, rates, documents with expiry reminders.
- Availability: read free/busy from the freelancer's own calendar if they
  share it, or they mark days off by link.
- One-tap links in SMS, WhatsApp and email for accept, decline and the
  call sheet; partial acceptance of multi-day jobs; rate counter-offers.
- Ready-made freelancer invoices from hours and extras, approved in one
  step, with payment status visible to them.
- Offers by app, email, SMS or WhatsApp: send a role to one person or a
  shortlist, first to accept gets it;
  accept and decline in the app or by the calendar invite.
- Call sheets per phase: call time, venue, access, parking, contacts, run
  of show, available offline on the crew chief's phone.
- Timesheets from assignments, adjusted and approved by ops.
- **Crewbox show pack** (files: patch CSV, lighting CSV, running order,
  crew list with the join QR).

**Done when:** crew are booked, briefed and paid from the system, and the
calendar invite is a courtesy rather than the record.

## Phase 4: Light finance

- Price lists, rate rules, client discounts.
- Quotes with versions and PDF output; accept online.
- Invoices, deposits and credit notes in EUR with Irish VAT.
- Freelancer cost lines from timesheets.
- Finance dashboard: revenue by month (quoted, confirmed, invoiced),
  outstanding and overdue invoices, freelancer costs owed, margin per job.
- Exports for the accountant: invoice register, VAT summary by rate and
  period, freelancer payments, job profit, as CSV and Excel with the PDFs.
- Job profitability: quoted versus actual.
- Later, only if needed: a connector to Xero, QuickBooks or Sage, built on
  the same export table.

**Done when:** a job goes from enquiry to invoice without leaving the
system, and the accountant gets a VAT period's figures from one export
without re-keying.

## Phase 5: Crewbox link and on-site mode

- Crewbox changes (on that repo): keyed event import, control-key show-log
  read, asset tags on fault reports, optionally crew clock-in.
- Push the event, crew and running order to the box when it has internet;
  pull technical incidents back as repair tickets against assets.
- A trimmed "on site" view for the crew chief: kit list with scan-to-check,
  crew present, notes, all offline.

**Done when:** a crew chief sets up the box from the job in one step and
faults reported on site are waiting in the warehouse repair queue on return.

## Phase 6: Grow

- Utilisation and revenue per product (what to buy, what to sell).
- Multi-warehouse and transfers, vehicle and driver scheduling.
- Client portal (view quotes, sign, pay deposit).
- RFID, native app store builds if the PWA falls short.
- Turn off calendar-led mode once no live projects use it.

## Decisions to make before the build starts

1. Answers to the open questions at the end of [architecture.md](architecture.md).
2. ~~Calendar or warehouse first?~~ Decided 2026-09-29: calendar first.
   Stock labelling research runs alongside, since no stock is barcoded
   yet and the rollout takes time.
3. ~~Hosting provider and budget.~~ Decided 29 September 2026: Railway for the app server, Neon (EU) for Postgres.
