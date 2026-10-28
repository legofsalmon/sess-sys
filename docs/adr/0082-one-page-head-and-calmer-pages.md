# ADR 0082: One page head on every screen, and calmer pages

- **Status:** accepted
- **Date:** 27 October 2026
- **Asked for by:** Colly, 27 October 2026 (chose option A of the proposal)

## Context

Colly said many screens stack so many cards of data that it is hard to scan
them, to tell whether you are on the right page, and to find your way
around. Walking 35 screens on a phone and a desk with the company at about
real size (300 jobs, 100 people, 300 products) found six causes:

1. **The page's name moved about.** On Jobs, Stock and Crew the big title
   named the area ("Crew") rather than the page (Calls); on Labels,
   Testing, a job, a product or a person it sat inside the first card,
   sometimes in the right-hand column.
2. **Two rows of links looked alike**: the area's pages and "On this
   screen" (ADR 0033).
3. **The area's row wrapped into a block on a phone**: Stock's nine pages
   took four lines, a third of the screen, before any stock.
4. **Every chunk was the same box** with the same capitalised heading,
   whether it was the page's main list or a footnote; the main list even
   repeated the title ("STOCK" under "Stock").
5. **Cards zigzagged in two columns** from 1200px (ADR 0036), in pairs as
   tall as the taller, so unrelated cards sat side by side and short ones
   left holes.
6. **A job's parts started below the first screen** (and Admin, a person
   and a product were long pages of equal cards).

The design system's navigation page asks for one view one job, the lightest
separation that works (space, then a label, then a surface), no more than
two levels of boxes, and the title as the one `h1` that says where you are.

Colly was offered three ways (the proposal, "Making busy screens easier to
scan"): A, the head and layout everywhere and then tabs on the pages that
are really several pages; B, the head and layout only; C, tabs on every
busy page, Home included. Colly chose A.

## Decision

Part one (this record's first PR):

1. **One page head, the same on every screen, outside any card**: the
   area's row of pages first under the bar, then the title naming this
   page (Calls, Catalogue, Labels, Admin), then "On this screen" (ADR 0033,
   which puts itself before the page's main thing), then the page. `Top`
   takes the row as `views`, the title as `heading` and a line under it as
   `sub`. Calls and Catalogue are titled by themselves now, not "Crew" and
   "Stock"; the bar's small line still names the area.
2. **The area's row stays one line.** On a phone it scrolls sideways, the
   current page brought into view, and the edge with more past it fades,
   so nothing is hidden with nothing to say so (audit P2 23, which is why
   it wrapped before).
3. **The page's main thing isn't boxed** (`card plain`): the catalogue,
   the places, the clients, the venues, the racks, Money's summary. It
   stands under the title with no heading repeating it. Cards stay for
   parts that stand beside it.
4. **Card headings are quieter**: sentence case, no capitals or letter
   spacing, so the page's title is clearly the biggest words on screen.
5. **Main and side instead of a zigzag** (`Split`). A page says which part
   is main and which stands beside it; from 1200px the main is the wide
   left column and the side a narrow right one, each reading down on its
   own. On a phone the side comes first, as it holds what waits on someone.
   Calls (answers to check beside the crew needed), People (certificates
   and vehicle checks running out beside the people), Labels (setting
   numbers aside beside the runs), Testing (testing a batch beside what's
   due) and Vehicles (checks running out beside the vans). Other pages are
   one column of a readable width. Home keeps its two across: it is a
   glance at everything.

Part two (the second PR):

6. **A record's name is the page's title**, outside its cards: a job's
   name with its status beside it, a person's with their photo or initials
   before it, a product's with its picture. Beside the catalogue on a desk,
   the product's head tops its column.
7. **A job's head is two lines, not a card**: client, venue (and its map)
   and dates; then its crew and kit. Its notes and Change details follow,
   unboxed. Its steps are a slim strip (ADR 0073) that says where the job is
   at; a step opens when pressed, and closes when pressed again. So the
   Phases, Crew, Kit and vans, Show pack and Quote tabs are on the first
   screen.
8. **Tabs on the pages that are really several pages** (`Tabs.tsx`, the
   job's tabs made shared): **Admin**: Company (office details, messages to
   crew, what heads of department see) · Connections (Google Calendar,
   Current RMS) · Data (backups, your data, bringing lists in, made-up data
   and starting fresh); the warnings about sign-in stay above the tabs and
   the version below them. **A person**: Coming up (with their own
   calendar) · Details · Documents · Worked · Their link; the ways to reach
   them stay under their name whichever is open. **A product**: Details ·
   On jobs · Items (and what's counted) · Faults. As on a job, the part is
   in the address (`#admin/data`, `#crew/person/<id>/worked`,
   `#stock/product/<id>/items`) without a step in the history, and the last
   one looked at opens next time on this device (`sh.adminPart`,
   `sh.personPart`, `sh.productPart`).

## Consequences

- Where you are is always in one place: the row says the area and marks
  the page, the title names the page.
- A desk shows less side by side than the two-across rule did on pages
  with no side; it reads in one order instead. This departs from ADR
  0036's "cards two across from 1200px", which is now Home's only.
- Nothing moved address and nothing was taken off any screen.
