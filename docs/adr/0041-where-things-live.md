# ADR 0041: Where things live

- **Status:** accepted
- **Date:** 16 October 2026
- **Asked for by:** Colly, 16 October 2026 ("Move it all" on the
  [where things live](../information-architecture.md) proposal)

## Context

Colly asked for the information architecture to be tidied. The way up
came first (ADR 0039). The rest was in the proposal: addresses that didn't
follow their area (`#plan`, `#venues`, `#clients`, `#import`, `#account`),
lists brought in from two places, clients and venues with no list of their
own, Stock as one long screen of eight cards, and Admin mixing settings
with once-a-season work.

## Decision

1. **Every address starts with its area.** The planner is `#jobs/plan/…`,
   bringing jobs in `#jobs/import`, clients `#jobs/clients[/<id>]`, venues
   `#jobs/venues[/<id>]`, Admin `#admin`. The old addresses are put to the
   new ones in place (`addresses.ts`, `history.replaceState`, before
   anything else reads the address), so bookmarks, links already sent and
   Google's sign-in return still land, and Back doesn't return to them.
2. **Each area names its pages in one row** under its header (`Views.tsx`):
   Jobs' List · Week · Month · Clients · Venues; Stock's Catalogue · Places
   · Labels · Counting · Testing · Repairs, with tests overdue and repairs
   open counted; Crew's Calls · People · Leave · Timesheets, with Calls and
   Leave counting what the Crew tab's badge counts between them. Moving along a row is
   lateral, so those pages have no way up; the current one is marked. A
   row wider than a phone scrolls sideways with the current one in view.
3. **Stock's long screen splits** into those pages. The Catalogue keeps the
   search and what needs doing today (kit short, pick lists).
4. **Each list is brought in where it lives**: jobs under Jobs, the stock
   list at `#stock/import`, the crew list at `#crew/import`. Admin keeps a
   "Bring lists in" card linking to all three, so the office still finds
   them together. Admin is otherwise settings.
5. **Clients and Venues get a list page each**, and the Menu names them,
   with Places, Testing and Repairs.

## Consequences

- A new page's address starts with its area, and the tab lights from that
  alone; a page along a row adds itself to the area's row in `Views.tsx`.
- Breadcrumbs read as the page's place: Jobs › Clients › Liffey Brands,
  Stock › Places › Bay 3.
- **Crew split second**, once a person had a page of their own (ADR 0040):
  Calls holds the answers to check and the crew needed, since both are
  about filling calls; People holds the list and certificates running
  out; a person's page and a timesheet sit under People and Timesheets in
  the breadcrumbs.
- Old addresses must stay in `addresses.ts`: links to them are out in
  messages and calendars.
