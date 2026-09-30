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
