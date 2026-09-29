# Competitor Audit: Rental and Crew Management Software for an Irish A/V Hire Company

**Prepared for:** Session Hire (Irish audio, lighting, video and staging rental for events and festivals)
**Research date:** late September 2026 (web research; vendor sites, help centres, Capterra, review aggregators)
**Scope:** Rentman, TeamTrack, Current RMS (now "OnRent Events"), Flex Rental Solutions, HireHop, easyjob (protonic), plus short notes on CrewBrain, CrewPlanner, Liveforce, Booqable and RentalPoint.

## How to read this report

- **[V] Verified:** confirmed on the vendor's own site, help centre or pricing page during this research.
- **[R] Reported:** taken from a third-party aggregator (Capterra, SaaSworthy, SourceForge and similar) and not confirmed on the vendor site.
- **[I] Inferred / unverified:** my judgement from indirect evidence, or from the absence of documentation. Check these in a demo before relying on them.
- Ratings: **Strong** / **Partial** / **Weak** / **None** / **?** (unknown).
- Prices exclude VAT. Aggregator prices are often stale; vendor pricing pages win where they disagree.

> **Naming notes**
> - The brief said "teamtrack.co". The product used in UK/IE events is **TeamTrack at teamtrack.uk** [V].
> - **Current RMS was acquired by Klipboard and is being rebranded as "OnRent Events"** [V]. Klipboard says functionality is unchanged. The same group owns InspHire, which now carries the OnRent brand too.
> - Several vendor pages (HireHop, parts of Rentman support) returned HTTP 403 to automated fetching. Claims about them lean on search snippets and aggregators, and are marked to match.

---

## 1. Comparison matrix

| Area | Rentman | TeamTrack | Current RMS / OnRent Events | Flex | HireHop | easyjob |
|---|---|---|---|---|---|---|
| **Main focus** | All-in-one: inventory, crew, projects (NL, EU-wide) | Crew, logistics and people only (UK) | Rental and events, inventory-first (UK) | Rental and warehouse, US-centric | Rental and inventory, very flexible (UK) | All-in-one on-prem/hosted (DE) |
| **Pricing model** | €39/mo platform fee + per power user per module. Basic users free | From £41/mo + optional modules. Freelancers billed per use | Per user: €69 first, €49 each extra (£59/£39) | From ~$510/mo, unlimited users, paid add-ons | £46 first user, £23 each extra. Free tier | Licence by edition (S–XL), not published |
| 1. Booking and planning | Strong | Partial (events and roles only, no equipment) | Strong | Strong | Strong | Strong |
| 2. Warehouse and stock | Strong (scanning is a paid add-on) | None (relies on rental system) | Strong (best PAT/testing) | Strong (RFID) | Strong | Strong |
| 3. Crew scheduling | Strong (tiered) | Strong (its core) | Partial | Partial (StaffingPlus add-on) | Partial (labour planner; CrewBrain link) | Partial–Strong [I] |
| 4. Finance | Strong | Weak (Xero, freelancer invoice upload) | Strong | Partial (QuickBooks is a paid add-on) | Strong | Strong (DATEV-centric) |
| 5. Mobile and offline | Partial (native app, limited offline) | Partial (native crew app, offline unknown) | Weak (iOS scanning app, Android pulled) | Partial (native Flex5 app, offline unknown) | Partial (scanning app, offline unknown) | Partial (mobile app needs server) |
| 6. Real-time collaboration | Partial | Partial | Partial | Weak–Partial | Partial | Weak–Partial |
| 7. Integrations and API | Strong (API, webhooks, Zapier, Make). Calendar one-way iCal | Partial (named connectors, no public API docs found) | Strong (open API, some webhooks). Calendar one-way iCal | Partial (API exists [I]) | Strong (API, webhooks, Zapier via webhooks) | Partial (interfaces, API [I]) |
| 8. Irish/EU fit | Strong (EU hosting, EUR, VAT schemes, e-invoice export) | Partial (UK, GBP, GDPR) | Partial–Strong (EUR pricing, Xero/Sage/QBO) | Weak (US focus, USD) | Partial–Strong (UK, VAT, Xero/Sage) | Partial (EU, German/DATEV-centric) |
| Two-way Google Calendar | No (one-way iCal, Google refreshes about daily) | Not documented | No (iCal feeds) | Not found | Not found | Not found |
| Offline-first site ops | No | No | No | No | No | No |

---

## 2. Product-by-product findings

### 2.1 Rentman (Netherlands)

**Target market:** AV rental and event production companies, from small to large. Positioned as the all-in-one. It is the most common modern choice in Benelux, UK and IE. Rentman claims 250,000+ users [R]. AVCOM (probably Irish, not verified) is a Rentman customer story [V].

**Pricing [V, rentman.io/pricing]:**
- Platform: €39/mo. Includes CRM, tasks, dashboards, file sharing, mobile app and API.
- Inventory module: Standard €14, Pro €19 per power user per month.
- Crew module: Essential €14, Standard €19, Pro €24 per power user per month. Enterprise is invite-only.
- Add-ons per power user per month: Quoting & Invoicing €9, Equipment Tracking (QR/barcode scanning) €9, History Logs €12.
- Additional warehouse: €5 per month each.
- **Basic users are free.** These are warehouse staff, technicians and freelancers.
- Annual billing saves 8%.
- Worked example (my arithmetic [I]): 3 planners with Inventory Pro, Crew Pro, Q&I and Tracking come to about €39 + 3 × (19 + 24 + 9 + 9) = **about €222/mo**.

| # | Area | Rating | Notes |
|---|---|---|---|
| 1 | Booking and planning | **Strong** | Projects with subprojects and planning periods. Quotes and contract versions. Availability. Subrental. Multi-phase through subprojects and time schedules [V/R]. |
| 2 | Warehouse and stock | **Strong** | Serial and bulk items. Bundles and cases. Consumables. Packing lists. Repairs and maintenance [V]. QR/barcode scanning needs the paid Equipment Tracking add-on. Zebra TC22/TC27 Android scanners are supported [V]. Asset-scoped maintenance history [R]. PAT testing depth is less clear than Current RMS [I]. Multi-warehouse at €5 each [V]. |
| 3 | Crew | **Strong** | Crew functions. Availability requests. Time tracking. Custom pay rates. Transport and travel time on Pro. Call sheets. Crew app. Freelancers are free basic users. Enterprise adds a freelancer marketplace, work permits, and travel, catering and accommodation [V]. |
| 4 | Finance | **Strong** | Quotes and invoices with e-signature and online payment (Q&I add-on). Configurable VAT classes and schemes, so 23%, 13.5% and 0% can be set up. Multi-currency is display-only with a manual exchange rate [V]. E-invoice export formats [V]. Xero and QuickBooks integrations [V]. Exact, Twinfield and others probable [I]. |
| 5 | Mobile and offline | **Partial** | Native iOS/Android app for scanning, project info, schedule and hours [V]. The changelog mentions offline navigation fixes and offline bulk uploads, so offline is partial at best [R]. No documented offline-first scanning with conflict resolution [I]. Reviewers call the app "limited for administrative tasks" [R]. |
| 6 | Real-time collaboration | **Partial** | Web app with shared live data, tasks, file sharing and comments [V]. No co-editing presence or live cursors [I]. |
| 7 | Integrations and API | **Strong** | Public REST API and webhooks for many entities, including AppointmentCrew and CrewAvailability [V]. Zapier and Make connectors [V]. **Calendar sync is one-way via iCal** (Rentman to Google). Google refreshes the feed only about once a day, with a 6-month window [V]. |
| 8 | Irish/EU | **Strong** | Hosted in European AWS data centres. Encrypted per-customer database. GDPR processor terms [V]. EUR native. Irish VAT is set up by configuring VAT schemes [V]. No Irish-specific accounting connectors such as Sage 50 IE, Big Red Book or Surf found [I]. |

**Common complaints [R, Capterra 4.6/5, 243 reviews]:** extra power users get expensive. Setup takes time and patience. Reporting is limited and custom reports are hard. The mobile app is limited next to desktop. The Google Calendar sync is one-way with a daily refresh, which in practice is a pain point [I, from the documented behaviour].

### 2.2 TeamTrack (UK, teamtrack.uk)

**Target market:** event operations, production and rental companies. The website says 1 to 500+ people. It sells itself as **crew and people-first, and complements an inventory platform**. It does not do equipment.

**Pricing [V, teamtrack.uk]:** from **£41/mo**, covering the core modules, 1 team member and up to 5 freelancers. **Freelancers are charged only when they are added to events.** Optional modules cost £15–£40/mo each: TimeCard App, Files, Forms, CDM/RAMS, Project Tracker, Freelancer Invoice Upload and Xero. No minimum term.

| # | Area | Rating | Notes |
|---|---|---|---|
| 1 | Booking and planning | **Partial** | Events, roles, venues and schedules with calendar, grid and matrix views [V]. No equipment quoting or availability; that comes from the rental system. |
| 2 | Warehouse | **None** | By design. Integrates with OnRent Events, HireHop and HireTrack NX [V]. |
| 3 | Crew | **Strong** | Freelancer onboarding, qualifications and booking history. Availability requests, offers and confirmations over SMS and email with conflict visibility. Time and attendance on mobile or shared devices. Holidays and sickness. Travel and accommodation (flights, trains, hotels) with **Schengen day tracking**. Vehicles. Call sheets. CDM/RAMS [V]. Pay-rate detail is not documented [I]. |
| 4 | Finance | **Weak** | Xero integration, freelancer invoice upload, and profitability reporting [V]. No client invoicing; that sits in the rental system. |
| 5 | Mobile and offline | **Partial** | Native iOS/Android TeamTrack App: schedules, offers, clock in/out, expenses, mileage, travel, documents and push notifications. A separate TimeCard App. Languages EN/ES/PT [V]. **Offline behaviour not documented** [I]. |
| 6 | Real-time | **Partial** | Web planner and push updates [V]. No chat found [I]. |
| 7 | Integrations and API | **Partial** | Two-way sync with OnRent Events, built by TeamTrack on the Current RMS open API. OnRent says it "can't vouch for it" [V]. HireHop and HireTrack NX. HR systems: BrightHR, HiBob, PeopleHR and others. Xero, Dynamics 365 BC. ClickSend SMS and Mailgun. Crew agencies Crewsaders and Pirate Crew listed as "coming soon" [V]. **No Rentman integration, no public API docs, and no Google Calendar sync found** [I]. |
| 8 | Irish/EU | **Partial** | UK company, GBP pricing, GDPR applies [I]. Hosting location not found [I]. Schengen tracking is useful for EU touring [V]. |

**Common complaints:** few public reviews were found. Structural issues [I]: it is a second system beside the rental tool, the Current RMS link is unsupported by Current, and there is no Rentman link.

### 2.3 Current RMS, now OnRent Events (UK, owned by Klipboard)

**Target market:** AV, lighting, production, broadcast, and weddings and parties. Small to mid-size businesses.

**Pricing [V, current-rms.com/pricing]:** a single plan. **€69/mo for the first user and €49/mo for each additional user** (£59/£39, $79/$49). Unlimited support. 30-day trial. No setup fee. Aggregator figures ($62/$27) are out of date [R].

| # | Area | Rating | Notes |
|---|---|---|---|
| 1 | Booking and planning | **Strong** | Opportunities to orders. Quotes with packages, deposits and crew charges. Versions through cloning [I]. Sub-rent tracking. Venues and timelines "from single rentals to festival setups" [V]. |
| 2 | Warehouse | **Strong** | Serialised and bulk stock. Barcodes. Allocate, prep, book out and check in [V]. **Testing and inspection is the best in class.** It records PAT, test-and-tag, LOLER and similar results, and **can block an asset overdue for testing from being added to a job**. PATorganiser integration and CSV import [V]. Multi-store is supported [I]. |
| 3 | Crew | **Partial** | Crew and transport scheduling with iCal feeds, services and crew charges [V]. Freelancer availability requests are weak. That gap is why TeamTrack and CrewBrain integrations exist [I]. |
| 4 | Finance | **Strong** | Invoicing with deposits and part charges. Xero, QuickBooks Online and Sage Business Cloud [V]. Tax classes exist in the API [V]. Multi-currency not confirmed [I]. |
| 5 | Mobile and offline | **Weak** | The "Companion" scanning app is **iOS only for now; Android was pulled** over Google Play policy [V]. It pairs to a job by QR and uses OAuth, which implies it needs a connection [I]. Otherwise it is a responsive web app. Reviewers call the mobile app "terrible" [R]. |
| 6 | Real-time | **Partial** | Discussions and activity feeds under "Communication and Collaboration" [V]. |
| 7 | Integrations and API | **Strong** | Open read/write REST API (api.current-rms.com) [V]. Webhooks, including stock-level events [V]. **Zapier is only "under consideration"** on the feature board [V]. Calendar is one-way iCal [V]. Mailchimp, Adobe Sign and WooCommerce [V]. |
| 8 | Irish/EU | **Partial–Strong** | EUR pricing. Xero and Sage Business Cloud are both common in Ireland [V]. Hosting region not verified [I]. |

**Common complaints [R, Capterra 4.5/5, 84 reviews]:** a frustrating sign-in procedure. Reviewers say development has slowed or stalled, which is worth watching after the acquisition. The mobile app. Basic reporting. Poor documentation of roles and permissions. Harder to scale. One reviewer moved to Rentman because Current RMS makes you jump between pages to set up a project [R].

### 2.4 Flex Rental Solutions (USA)

**Target market:** mid-to-large US AV and staging rental houses.

**Pricing [V, flexrentalsolutions.com/plan-pricing]:** **from $510/mo with unlimited users.**

Add-ons per month:

| Add-on | Price |
|---|---|
| 2nd location | $150 |
| 3rd–5th location | $100 each |
| 6th location onward | $75 each |
| RFID | $100 |
| StaffingPlus (crew) | $100 |
| QuickBooks | $50 |
| Payments | $25 |

Custom reports cost $240/hr and training $165/hr. There is no EUR price list [I].

| # | Area | Rating | Notes |
|---|---|---|---|
| 1 | Booking and planning | **Strong** | Quotes, packages, dynamic pricing, contracts with e-signature, availability [V]. |
| 2 | Warehouse | **Strong** | Barcode and **RFID** (prep, manifest return, free scan). Pull sheets. Transfer orders between locations. Maintenance [V]. |
| 3 | Crew | **Partial** | Labour scheduling. StaffingPlus add-on with call sheets and Gantt [V]. The freelancer app is less developed [I]. |
| 4 | Finance | **Partial** | Invoicing and payments. QuickBooks is a paid add-on [V]. Xero, Sage and EU VAT depth not verified [I]. |
| 5 | Mobile and offline | **Partial** | Native Flex5 iOS/Android and tablet apps for warehouse scanning [V]. Offline not documented [I]. |
| 6 | Real-time | **Weak–Partial** | [I] |
| 7 | Integrations | **Partial** | API exists [I]. CrewBrain one-way link [V]. |
| 8 | Irish/EU | **Weak** | USD and US-centric. EU hosting not verified [I]. |

**Common complaints [R, Capterra 4.0/5, 137 reviews]:** "slow and laggy". A dated, dense UI. A steep learning curve. Bugs at busy times. Mobile gaps in the past. The G2 profile has been inactive for over a year [R].

### 2.5 HireHop (UK)

**Target market:** UK and international rental companies of all sizes, including AV, broadcast, construction and party hire. Known for flexibility and value.

**Pricing [R, Capterra, SelectHub]:** **£46/mo for the first user and £23/mo for each additional user.** There is a limited free tier. No implementation fee. The vendor pricing page blocked automated fetch.

| # | Area | Rating | Notes |
|---|---|---|---|
| 1 | Booking and planning | **Strong** | Jobs, projects, quotes, availability, sub-hire, customer-specific pricing and a route planner [R/V]. |
| 2 | Warehouse | **Strong** | Serialised and bulk stock. **Barcode, QR and RFID scanning from any device, including phone cameras and PDAs.** Multi-terminal real-time job checking [R]. Testing and certification is not a stated strength [R]. |
| 3 | Crew | **Partial** | Labour rates. Dual resource planners to assign staff and track labour cost [R]. **CrewBrain integration** for proper crew scheduling [R/V]. TeamTrack integration [V]. |
| 4 | Finance | **Strong** | Xero sync covers contacts, invoices, deposits, credit notes, payments and POs, and pulls in VAT and nominal codes. Sage Accounting too [R]. QuickBooks probable [I]. |
| 5 | Mobile and offline | **Partial** | Scanning app, 2023 [V title]. Offline not verified [I]. |
| 6 | Real-time | **Partial** | Real-time stock and scanning across terminals [R]. |
| 7 | Integrations and API | **Strong** | API and **webhooks** that POST JSON and can feed Zapier [V]. The Google Workspace add-on is Gmail sending only [V]. No calendar sync found [I]. |
| 8 | Irish/EU | **Partial–Strong** | UK VAT model, multi-currency [I], Xero and Sage. Hosting not verified [I]. |

**Common complaints [R, Capterra 4.9/5, 84 reviews]:** the UI is plain or dated and features can be hard to find. Initial inventory setup is awkward. Weak procurement. Document template quirks. Overall sentiment is very positive and support is praised.

### 2.6 easyjob (protonic software, Germany)

**Target market:** AV, event, touring, staging and tent rental. Strongest in the DACH region. Editions S, M, L and XL, sized by headcount and number of sites [V].

**Pricing:** **not published.** It is a licence plus subscription by edition and modules [V/R]. Deployment is a Windows client and server, locally or in the cloud or hosted [V/R].

| # | Area | Rating | Notes |
|---|---|---|---|
| 1 | Booking and planning | **Strong** | Request to invoice, multi-site, multi-country, multi-currency. Profitability planner [V/R]. |
| 2 | Warehouse | **Strong** | Multi-location stock, maintenance, and an Android scanner app [R/V]. |
| 3 | Crew | **Partial–Strong** | Staff and vehicle scheduling and a timecard in the mobile app [R]. Many users add CrewBrain, which has a two-way sync with easyjob [V]. |
| 4 | Finance | **Strong** | DATEV export and bookkeeping configuration [R]. Irish or UK packages unlikely [I]. |
| 5 | Mobile and offline | **Partial** | The easyjob Mobile app needs an edition M+ server at 6.2.2.46 or later [R]. The WebApp is a client and partner portal [V]. Offline not documented [I]. |
| 6 | Real-time | **Weak–Partial** | Architecture is desktop-first [I]. |
| 7 | Integrations | **Partial** | CrewBrain two-way [V]. API [I]. |
| 8 | Irish/EU | **Partial** | EU vendor with strong GDPR posture [I]. Localised around German accounting [I]. |

**Common complaints:** few English-language reviews (OMR: 1 review, 3.5/5 [R]). Structural issues [I]: a Windows-desktop heritage, opaque pricing, and a German-centric ecosystem.

### 2.7 Other relevant tools (brief)

| Tool | What / who | Pricing | Notes |
|---|---|---|---|
| **CrewBrain** (DE) | Crew scheduling for live events | Essential, Standard and Enterprise tiers. Price not found. 30-day trial [V] | Connectors: **two-way** with easyjob and Current RMS; **one-way** with Rentman, Flex and HireHop [V]. REST API v1/v2, **webhooks**, and an **MCP server for AI tools** [V]. Calendars: **two-way Office 365 via Microsoft Graph**, iCal only for Google [V]. Native app plus a smartphone WebApp [V]. The closest existing model for the "crew layer on top of a rental system" pattern. |
| **CrewPlanner** (BE/NL) | Flexible-workforce planning for hospitality, events and staffing agencies | £50/mo (1 manager), £225 (3), £900 (10). Unlimited employees. 1,000 scheduled hours included, then £0.07–£0.12 per hour [V] | Contracts with e-sign, time tracking, payouts, SMS and chat (Classic tier), API tokens (Pro). Xero, Exact and Odoo, plus payroll connectors that are not Irish [V]. |
| **Liveforce** (UK) | Event staffing | £70–£200/mo; extra admins £40 [V] | GPS check-in/out, crew app, timesheets, payroll reports, API [V]. Built for staffing agencies, not technical crew [I]. |
| **Shiftbase** (NL) | General shift scheduling, hours and absence | Per user per month [I] | Not event-shaped: no projects or gear. Useful only as HR/timesheet backup [I]. Not researched in depth. |
| **Booqable** (NL) | Simple rental with online store | $29 / $69 / $149 per month [R] | Aimed at small consumer or party rental. Barcode scanning. No real crew or multi-phase projects [R/I]. **Not a fit for Session Hire's operations.** |
| **RentalPoint** (CA) | Event and AV rental; hotel in-house AV billing | From about $86/mo [R] | Browser-based and responsive with **no native app** [R]. North American focus. |
| **HireTrack NX** (UK) | Long-standing UK AV rental system | Not researched | Integrates with TeamTrack [V]. |

---

## 3. Irish and EU specifics (cross-cutting)

| Topic | Situation | Implication for Session Hire |
|---|---|---|
| **EUR** | Rentman is EUR-native. Current RMS and easyjob support EUR. HireHop and TeamTrack are GBP-first but usable. Flex is USD. | Build EUR-native. Keep GBP invoicing for NI and UK festival work (NI keeps EU VAT rules for goods under the Windsor Framework [I]). |
| **Irish VAT** | Standard rate is **23%**; the reduced rate is **13.5%**. Most equipment hire and A/V services are likely 23% [I; confirm with an accountant]. Rentman VAT schemes and classes can model this [V]. Others use tax classes. | Needs per-line VAT class, a reverse-charge scheme for EU B2B customers, and 0% on exports. |
| **E-invoicing** | Rentman exports e-invoice formats [V]. Ireland is phasing in B2B e-invoicing for the EU's ViDA programme in the late 2020s [I; verify the current Revenue timetable]. | Design invoices so they can emit EN 16931 / Peppol later. |
| **GDPR and EU hosting** | **Only Rentman confirms EU data centres** [V]. Current RMS, HireHop, TeamTrack and Flex hosting regions are **unverified** [I]. Freelancer records (PPSN, bank details, certifications, right-to-work) are sensitive. | Host in the EU (e.g. AWS eu-west-1 Dublin). Keep DPAs with sub-processors. Build retention and deletion for freelancer data. |
| **RCT (Relevant Contracts Tax)** | RCT covers "construction operations", defined broadly. It includes installing lighting and electrical systems and erecting structures [V, Revenue/FSSU]. **Temporary event staging and AV rigging are most likely outside it**, but permanent AV installs in buildings could be caught [I]. None of the tools handle RCT [I]. | Low priority. Flag install-type jobs for accountant review. Consider an "install / fabric of building" job flag. |
| **Contractor status** | Crews are heavily freelance. Irish employment-status tests tightened after the Supreme Court's 2023 *Karshan (Domino's)* judgment and Revenue's code of practice [I]. | Keep records: contractor invoices, rates agreed per job, right of substitution. Freelancer invoice upload (TeamTrack) and self-billing are worth building. |
| **Irish accounting packages** | Xero, Sage (Business Cloud / Sage 50 IE) and QuickBooks Online are covered by the main tools. **Irish-specific packages (Big Red Book, Surf Accounts, Thesaurus/BrightPay payroll) are not integrated by any tool** [I]. | Start with Xero or Sage. Offer generic CSV/journal export for the rest. |

---

## 4. Common user complaints (synthesis)

| Complaint | Where seen | Strength of evidence |
|---|---|---|
| Per-seat pricing punishes growth ("extra power users are expensive") | Rentman [R]. Current RMS €49 per extra user [V]. HireHop per user [R] | Strong |
| Mobile app weak or limited next to desktop | Rentman [R], Current RMS ("terrible"; Android pulled) [R/V], Flex (past gaps) [R] | Strong |
| No or poor offline behaviour | Rentman offline fixes in the changelog [R]. No vendor documents offline scanning [I] | Medium (mostly inferred from silence) |
| Slow, laggy or dated UI | Flex [R], HireHop (plain UI) [R] | Strong for Flex |
| Steep setup and learning curve | Rentman, Flex, HireHop inventory import [R] | Strong |
| Weak or basic reporting | Rentman, Current RMS [R] | Strong |
| Slow product development after acquisition | Current RMS [R] | Medium |
| Crew needs a second tool | Current RMS, HireHop and easyjob users add TeamTrack or CrewBrain [V] | Strong |
| Calendar sync one-way and slow (daily Google refresh) | Rentman [V], Current RMS [V], CrewBrain (Google via iCal) [V] | Strong (documented) |
| Sign-in and permissions friction | Current RMS [R] | Medium |

Reddit and forum mining produced little directly usable material through search. The opinions above come mainly from Capterra, G2 and aggregators. Asking in r/livesound, r/VIDEOENGINEERING or Irish production Facebook groups would be a useful follow-up [I].

---

## 5. Gap analysis: what Session Hire could own

**1. Offline-first site and warehouse operations (clearest gap).**
- No product documents true offline operation: scanning, checking in and out, reading job sheets, logging damage and recording hours with no signal, then syncing with conflict resolution later.
- Festival sites, fields, basements and steel-framed venues are exactly where signal fails.
- Current RMS's scanner app is iOS-only and connection-bound. Rentman has only partial offline fixes. The rest are silent.
- **Opportunity:** a local-first PWA or native app.
  - Keep a local replica of the job, pick list, asset register and crew list.
  - Queue scans and edits as events.
  - Merge deterministically on reconnect. The same asset scanned twice should resolve predictably.
  - Show clear "last synced" state.

**2. Handoff to on-site crew communications.**
- Rental systems stop at the call sheet. Crew tools (TeamTrack, CrewBrain) stop at scheduling and timesheets.
- Nothing hands the live job (running order, contacts, stage plots, patch and rigging docs, changes) into the on-site comms channel, whether that is WhatsApp, Slack or radio logs.
- Nothing brings back site events: damage, shortages, overtime, extra kit used (which becomes billable additions).
- **Opportunity:** a "show mode" job pack plus a structured event stream from site. Photos, damage reports and extra-kit requests flow back to the warehouse and to invoicing.

**3. Google Calendar coexistence during migration.**
- Every product offers **one-way iCal only** to Google. Google refreshes these feeds only about daily.
- Only CrewBrain does two-way sync, and only with Office 365.
- A company that currently runs on Google Calendar can't migrate gradually. Staff keep editing Google, and the new system never sees it.
- **Opportunity:** real two-way Google Calendar sync through the Calendar API with push notifications.
  - Map calendar events to provisional holds or bookings.
  - Mark ownership per field.
  - Let the business "adopt" legacy calendar entries into proper jobs over time.
  - Nobody has this, and it removes the biggest risk in switching.

**4. Contractor-heavy crewing done properly.**
- Crew features are either bolted on (Current RMS, HireHop, Flex) or live in a separate product with fragile integrations. TeamTrack's two-way link to Current RMS is unsupported by Current. Rentman has no TeamTrack link, and CrewBrain's Rentman link is one-way.
- Nobody combines these in one data model:
  - availability broadcast by skill and rate
  - first-to-accept or ranked offers over SMS/WhatsApp
  - per-job agreed rates (day, half day, overtime, travel, per diem)
  - freelancer invoice capture or self-billing matched to timesheets
  - certification expiry (Safe Pass, IPAF, PASMA, rigging)
  - Irish status-compliance records
- Pricing models also punish freelancers or planners. Rentman's power users are the exception, since freelancers are free there. TeamTrack's per-use freelancer billing is the fairest model found.
- **Opportunity:** freelancers as first-class, free, mobile-first users, with job-level rate cards feeding directly into costing and job P&L.

**5. Multi-phase festival projects with crew and kit on the same timeline.**
- Rentman comes closest with subprojects. Others treat load-in, show and load-out as dates on a single job.
- **Opportunity:** phases as first-class objects, each carrying kit, crew, vehicles and venue access windows, with availability calculated per phase. Kit released after load-in can be re-hired mid-festival.

**6. Irish-native finance.**
- The following exist only as configuration, never as defaults:
  - 23%/13.5% VAT classes
  - EU reverse charge
  - GBP invoicing for NI and UK
  - e-invoice readiness
  - Sage/Xero IE mapping
  - an RCT flag for install work
- **Opportunity:** a small but real advantage in setup time and accounting accuracy.

**7. Compliance gating beyond PAT.**
- Only Current RMS blocks assets overdue for testing.
- **Opportunity:** extend that gate to crew certificates and vehicle checks (NCT/CVRT, tachograph) with the same "can't assign if expired" rule.

**What not to try to beat:** Rentman's breadth of quoting and invoicing, and HireHop's value and flexibility on core stock. For those, parity is enough. The differentiation is in points 1–4.

---

## 6. Sources

**Rentman**
- https://rentman.io/pricing
- https://rentman.io/pricing/crew
- https://www.capterra.com/p/144616/Rentman/
- https://support.rentman.io/hc/en-us/articles/360014047779-Synchronize-your-External-Calendar
- https://rentman.io/integrations/calendar
- https://support.rentman.io/hc/en-us/articles/15274709111826-Public-API-Webhooks
- https://api.rentman.net/
- https://rentman.io/integrations/api
- https://support.rentman.io/hc/en-us/articles/9723268717202-Rentman-Changelog-350-400
- https://support.rentman.io/hc/en-us/articles/360014365179-Rentman-Mobile-App
- https://support.rentman.io/hc/en-us/articles/360013478180-Scanner-Options-in-Rentman
- https://rentman.io/data-security
- https://support.rentman.io/hc/en-us/articles/360013979460-Display-Multiple-Currencies-on-Financial-Documents
- https://support.rentman.io/hc/en-us/articles/360013887460-Configure-Taxation-VAT-GST
- https://support.rentman.io/hc/en-us/articles/360014032939-Exporting-Invoices-in-E-Invoice-Formats
- https://rentman.io/product-updates/custom-pay-rates
- https://rentman.io/customers/stories/avcom

**TeamTrack**
- https://www.teamtrack.uk/
- https://www.teamtrack.uk/integration/
- https://www.teamtrack.uk/apps/teamtrack/
- https://www.teamtrack.uk/product/

**Current RMS / OnRent Events**
- https://www.current-rms.com/pricing
- https://www.capterra.com/p/142401/Current-RMS/
- https://help.current-rms.com/en/articles/10709885-team-track-integration
- https://help.current-rms.com/en/articles/16071358-introducing-a-new-look-for-onrent-events
- https://www.internationalrentalnews.com/news/klipboard-to-use-onrent-brand-for-insphire-and-current-rms-software/8122906.article
- https://www.klipboard.com/en-us/products/onrent-events
- https://help.current-rms.com/en/articles/2901973-what-is-the-onrent-events-companion-app
- https://help.current-rms.com/en/collections/2941416-integrations-and-api
- https://wishlist.current-rms.com/c/18-zapier-integration
- https://api.current-rms.com/doc
- https://help.current-rms.com/en/articles/3822294-how-does-testing-inspection-work
- https://www.current-rms.com/features/testing-and-maintenance

**Flex**
- https://www.flexrentalsolutions.com/plan-pricing/
- https://www.capterra.com/p/135722/Flex/
- https://www.flexrentalsolutions.com/flex-rfid-tracking-software/
- https://helpcenter.flexrentalsolutions.com/hc/en-us/categories/360000991874-Flex5-Mobile-App

**HireHop**
- https://www.capterra.com/p/155333/HireHop/
- https://www.selecthub.com/p/equipment-rental-software/hirehop/
- https://www.hirehop.com/en-features/ (403 to fetch; search snippets only)
- https://www.hirehop.com/announcement/08-11-23/
- https://www.hirehop.com/check-job-multiple-terminals-software-hire-companies/
- https://www.hirehop.co.uk/blog/webhooks/
- https://workspace.google.com/marketplace/app/hirehop_equipment_rental_software/10173395617

**easyjob**
- https://www.protonic-software.com/en/easyjob/
- https://www.protonic-software.com/en/easyjob/corporate/modules/webapp.psx
- https://apps.apple.com/us/app/easyjob-mobile/id1009349820
- https://play.google.com/store/apps/details?id=com.protonic.easyjobscanner
- https://omr.com/en/reviews/product/protonic-software-easyjob
- https://sourceforge.net/software/product/protonic-easyjob/

**Other tools**
- https://www.crewbrain.com/en/features/interfaces/
- https://www.crewbrain.com/en/features/ical-connection/
- https://crewplanner.com/en/pricing
- https://liveforce.co/pricing-event-staffing-software/
- https://booqable.com/pricing/
- https://www.capterra.com/p/10027845/RentalPoint/
- https://rentalpoint3.com/

**Irish tax and regulation**
- https://www.revenue.ie/en/self-assessment-and-self-employment/rct/index.aspx
- https://www.fssu.ie/post-primary/topics/rct-and-vat/rct-relevant-contracts-tax/definition-of-construction-operations-for-rct/
- https://www.saashub.com/compare-current-rms-vs-flex-rental

## 7. Items to verify in demos

1. Rentman: exactly what the app does offline (scanning queue? hours?) and whether it supports Sage 50 IE.
2. Current RMS / OnRent: hosting region, multi-currency, product roadmap after the Klipboard acquisition, and when the Android app returns.
3. HireHop: pricing in EUR, hosting region, offline scanning, and whether QuickBooks is supported.
4. TeamTrack: offline behaviour of the app, whether it has a public API, calendar export, pay-rate model, and hosting region.
5. Flex and easyjob: EUR pricing and support hours in the Irish time zone.
6. Accountant: VAT treatment of hire with operator, whether 13.5% applies to any A/V services, and RCT exposure on permanent install jobs.
