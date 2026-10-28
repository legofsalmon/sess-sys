# ADR 0091: One page width

- **Status:** accepted
- **Date:** 28 October 2026
- **Asked for by:** Colly, 28 October 2026: "On the stock page I notice as I
  click through the tabs that the width changes, can this be standardised
  across the full app?"
- **Changes:** the widths in [ADR 0036](0036-desk-layout-sidebar-and-dark-by-default.md)
  (desk layout), [ADR 0059](0059-a-job-page-in-parts.md) (the job page) and
  [ADR 0082](0082-one-page-head-and-calmer-pages.md) (main and side).

## Context

Each kind of page had grown its own width. On a 1280px laptop Stock's
Catalogue, Labels, Testing and Vehicles were 1072px wide and Places,
Counting, Repairs, Racks and the Purchase list 960px; on a big screen the
Catalogue (the list beside a record) and the planner went to 1400px. Jobs,
Crew, Admin and You were the same mix. So moving along an area's row, which
is meant to feel like turning a page of the same book, made the bar, the
row and the title jump sideways, and the eye had to find them again. Between
640 and 900px the planner and the catalogue were also wider than the rest.

The widths came from good local reasons: a page with one column kept its
lines readable at 960px, a page with a side column took 1200px, and the
planner and the list beside a record wanted all the room there was. But the
person moving between them sees one app, and the design system's
consistency heuristic (the same thing in the same place) outweighs a few
hundred extra pixels on one page.

## Decision

1. **Every page in the app is the same width at the same window size.** On
   a phone or tablet the full width up to 640px; from 900px, with the places
   in the sidebar, what is left up to 1200px. No page is narrower or wider:
   not the planner, not a job, not the catalogue beside a record, not
   History.
2. **What changes from page to page is how the width is shared out inside
   it**: one column, a main and a side (Split), the list beside a record
   (Beside), or Home's cards two across. The bar, the area's row and the
   title stay exactly where they were.
3. **Readable lines come from the words, not the page**: a card's paragraph
   stops at about 75 characters, so a one-column page can be the full width
   without its sentences running across it.
4. **Signing in is the one exception.** It stands alone before the app, and
   keeps the phone's width.

1200px rather than 1400px: on the office's laptops (1366 to 1536px wide,
less the 208px sidebar) the two are the same, and on a bigger screen 1200px
keeps one-column forms and lists from stretching. The planner gives up its
last 200px on a big screen; if that is missed, the answer is a wider page
everywhere, not the planner alone.

## Consequences

- Moving between any two pages keeps the bar, the row and the title still.
  A browser test (layout.spec.ts) walks every area's pages, Admin, You and
  Home on a phone, a laptop and a 1680px screen and fails if any page's
  width differs.
- One-column pages are wider on a desk than before (up to 1200px from
  960px); their fields and rows stretch with them.
- A new page gets the width for free; giving one page a width of its own
  undoes this record.
