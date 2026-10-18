# Where things live

16 October 2026. Colly asked for the app's information architecture to be
looked over and tidied, and for breadcrumbs or a back button. The way up is
built (ADR 0039). This page is the rest: where each place lived, what was
untidy about it, and the structure proposed. Colly chose "Move it all", and
it is built (ADR 0041).

## How it was

Five places in the bar (phone) or sidebar (desk): Home, Jobs, Stock, Crew,
Menu. Under each, its pages:

| Area | Pages under it now | Address |
|---|---|---|
| Home | Company, department, warehouse or me | `#home` |
| Jobs | List, Week, Month (the planner) | `#jobs`, `#plan/…` |
| | A job; its pick list; a phase's call sheet | `#jobs/<id>`, `…/pick`, `…/sheet/<phase>` |
| | A venue; a client (listed at the foot of the Jobs list) | `#venues/<id>`, `#clients/<id>` |
| | Bring in from Google Calendar | `#import` |
| Stock | Catalogue, kit short, pick lists, places, repairs, tests due, labels, counts (one long screen) | `#stock` |
| | A product, an item, a place | `#stock/product/<id>`, `…/item/<id>`, `…/place/<id>` |
| | Labels and a run of them; counting and a count; PAT tests | `#stock/labels…`, `#stock/count…`, `#stock/testing` |
| Crew | Answers to check, crew needed, people (each a fold) | `#crew` |
| | Leave; a timesheet | `#crew/leave`, `#crew/timesheet/<id>` |
| Menu | Every place by name | `#menu` |
| | Admin (company settings, and bringing in the crew and stock lists) | `#account`, `#account/import-…` |
| | History; You | `#history`, `#me` |

## What is untidy

1. **Addresses don't follow the areas.** The planner, venues, clients and
   bringing jobs in belong to Jobs but sit at `#plan`, `#venues`,
   `#clients` and `#import`; Admin is `#account`. A shared link doesn't say
   where it goes, and every new screen has to be taught which tab to light.
2. **Bringing lists in is in two places.** Jobs come in from Jobs; the crew
   and stock lists come in from Admin. Someone looking for one won't guess
   where the other is.
3. **Clients and venues have no list of their own.** They are found at the
   foot of the Jobs list, under every job, so on a phone they are a long
   scroll away, and the Menu doesn't name them.
4. **Stock is one long screen.** Labels, counting, testing and repairs each
   have a page, but on the Stock screen they are cards among eight, and
   only the Menu lists them as places.
5. **A person has no page.** Their details open as a fold inside the People
   list (the "Crew member pages" thread is building a page per person).
6. **Admin mixes settings with work.** The office, calendar, backups and
   data are settings; bringing in lists is a job done once a season.

## Proposed

The bar stays as it is: Home, Jobs, Stock, Crew, Menu. Inside each area,
its pages are named in one row under the title, the way Jobs already has
List, Week and Month, so nothing is only reachable from the Menu.

| Area | Row under the title | Pages beneath |
|---|---|---|
| Jobs | List · Week · Month · Clients · Venues | a job (pick list, call sheets); a client; a venue; Bring in from Google Calendar |
| Stock | Catalogue · Places · Labels · Counting · Testing · Repairs · Vehicles | a product, an item, a place; a run of labels; a count; a vehicle ([Decision 0047](adr/0047-vans-and-drivers.md)); Bring in the stock list |
| Crew | To check · People · Leave · Timesheets | a person (from the other thread); a timesheet; Bring in the crew list |
| Menu | (every place by name, as now) | Admin (settings only), History, You |

- **Every address starts with its area**: `#jobs/plan/…`, `#jobs/venues/<id>`,
  `#jobs/clients/<id>`, `#jobs/import`, `#admin`. The old addresses keep
  working and land on the new ones, so bookmarks and links already sent
  are safe.
- **Each list is brought in where it lives**: jobs under Jobs, stock under
  Stock, crew under Crew. Admin keeps a "Bring lists in" card that links
  to all three, so the office still finds them in one place.
- **Clients and Venues get a list page each** in Jobs, and the Menu names
  them.
- **Stock's long screen splits** into its peers; Catalogue keeps the search
  and what needs doing today (kit short, pick lists).
- **Admin is settings only**: the office, Google Calendar, backups, data.

The way up follows the same tree, so a page's breadcrumbs read as its
place: Jobs › Clients › Liffey Brands, Stock › Labels › Run 12.

## Not proposed

- No sixth place in the bar: five is the most a phone shows well, and the
  Menu already names everything.
- History stays under the Menu, where the directors and the office look
  for it now and then.

## Built

Built as proposed (ADR 0041), with every old address landing on its new
one. Crew's row came second, once each person had a page: Calls · People ·
Leave · Timesheets, where Calls is the answers to check and the crew still
needed (proposed as "To check", but crew needed belongs with it).
