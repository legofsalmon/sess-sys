# Session Hire

Management system for Session Hire, an Irish A/V rental company: event
booking and planning, warehouse and stock, crew booking, and light finance.
Offline-first web app for phone and laptop, coexisting with Google Calendar
during the move and handing off to [Crewbox](https://github.com/legofsalmon/crewbox)
on site.

Phase 0 is built, with the phone field test left: the offline sync
engine, crew booking, staff sign-in, nightly backups, error alerts, and a
history of every change with a download of everything. Everything on
the Phase 1 list is built too: clients, venues and each job's phases,
with crew asked for from the job, confirmed jobs written to Google
Calendar, crew invited to their days there, with their answers read back
(behind a switch that starts off), a week and month planner by job or by
person that flags clashes, bringing in the jobs already on Google
Calendar, and a read-only calendar feed of each person's own bookings.
Phase 2, the warehouse, has started with the catalogue in the Stock tab:
products numbered or counted, items with Session Hire numbers, places,
cases and counts; kit on jobs, with shortages flagged and subhire; and
printing labels, with numbers set aside for each run and labels put on
items by scanning them; scanning labels with the phone's camera in
the app; a pick list for each job, with kit scanned out and back in
on a phone, with no signal too; and damaged and missing kit reported as
it comes back, with a repair list; and PAT tests and thorough
examinations recorded, a batch at a time by scanning, with failed and
overdue kit kept off jobs. Phase 3, crew, has call sheets for each
phase: in the app, on paper, and on each freelancer's private link,
with who to ring on the day; and timesheets, the days worked at the day
rate and the extras, sent from a freelancer's link and approved by the
office in one step. Until the real stock and crew lists
are in, the Account tab puts in made-up data to try every part of the
app with, and Start fresh clears it all before the real data goes in.
The app runs on Railway. Start with the
**Session Hire Blueprint**,
[docs/hub/index.html](docs/hub/index.html): one page that pulls together the
research, principles, architecture, stock tracking, roadmap and decisions,
with the full documents embedded. Open it in a browser. After editing any
markdown file in `docs/`, rebuild it with `node scripts/build-hub.mjs`.

### Deploying the blueprint on Vercel

Import this repo in Vercel; no settings are needed, `vercel.json` covers it.
The planned domain is `sh.letissier.ie`: add it under the project's
Domains settings and point a `CNAME` for `sh` at the target Vercel shows.
Each push rebuilds the page from the markdown in `docs/` (`npm run build`
writes `dist/index.html`). The page asks search engines not to index it,
but a production deployment is public to anyone with the URL unless you
turn on Deployment Protection in the Vercel project settings.

The source documents:

- [docs/architecture.md](docs/architecture.md): the proposed design
- [docs/roadmap.md](docs/roadmap.md): the phased plan
- [docs/research/](docs/research/): competitor audit, today's booking process,
  and the Crewbox handoff
