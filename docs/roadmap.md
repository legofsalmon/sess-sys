# Session Hire system: phased plan

Status: proposal for review, 2026-09-29. See [architecture.md](architecture.md)
for the design these phases build.

The order is chosen so that each phase replaces something people do today
and is useful on its own, and so that the riskiest technical piece (offline
sync with server-checked availability) is proven before anything depends on
it. Durations are deliberately left out until the open questions in the
architecture doc are answered.

## Phase 0: Foundations

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

- Clients, venues, projects, phases, crew requirements and assignments.
- Two-way sync with the **Session Hire Gigs** calendar in today's event
  format; RSVPs update assignments.
- Importer for the organisers' existing calendars into draft projects.
- A planner view: the week and month by project and by person, with
  clashes flagged (the same freelancer on two jobs).
- Personal iCal feeds.

**Done when:** ops create every new job in the system, crew still receive
the same Google invites, and nobody has to type a job twice.

## Phase 2: Warehouse and stock

- Catalogue, products, assets, containers, bulk stock, locations.
- Label printing: QR plus a readable number on polyester labels, riveted
  metal tags for cases and rigging, heat-shrink or flag labels for cables.
- The labelling rollout from [research/stock-tracking.md](research/stock-tracking.md):
  pilot the label materials, then compliance items, then high-value gear
  labelled as it comes back from jobs, then cases, then cables as bundles,
  then a baseline stocktake and rolling cycle counts.
- Equipment lines on projects, with live availability and shortage
  warnings, including subhire lines.
- Pick lists per project, **scan out and scan in on a phone, offline**,
  missing and damaged items on return, and a conflict queue for scans that
  did not match the plan.
- Faults, repairs, PAT and inspection records; unavailable while in repair.

**Done when:** a job's kit is picked and returned by scanning, and
availability for next week is trusted without walking the shelves.

## Phase 3: Crew

Built to the "meet freelancers in the middle" principle in
[architecture.md](architecture.md): no app or login needed to get work.

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
3. Hosting provider and budget.
