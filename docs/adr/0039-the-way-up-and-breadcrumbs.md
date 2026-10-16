# ADR 0039: The way up, and breadcrumbs on a desk

- **Status:** accepted
- **Date:** 16 October 2026
- **Asked for by:** Colly, 16 October 2026

## Context

Colly asked for breadcrumbs or a back button to help people find their way
around, and for the information architecture to be tidied
([where things live](../information-architecture.md)).

Most pages under an area already had a "‹ All jobs" link, but each screen
drew its own under the top bar, so it scrolled away down a long page (a
job, a product), the planner and a few others had none of their own, and
on a desk, beside the list, nothing said where the open record sat.

The shared design system's navigation page has Up (to the parent, always
the same place from the same page, in the app bar) and Back (the
browser's, history). It keeps breadcrumbs for web pages people arrive at
from outside, and says a working tool's Up and context line do the job.

## Decision

1. **One way up, in the top bar** of every page under an area's own
   screen (`Up.tsx`, through `Top`'s `up`). The bar sticks, so the way up
   is in view at the foot of a long page. It goes to the parent in the
   tree, whatever way the person came; the browser's Back stays history.
   An area's own screen has none.
2. **On a phone it is one link**: "‹ All jobs", "‹ Liffey Brands Shoot",
   "‹ Admin", as tall as a thumb, as before.
3. **From 900px it is breadcrumbs**, from the area down: Jobs › Liffey
   Brands Shoot › Pick list, each a link but the page itself, which is
   plain text marked as the current page. The separators are drawn and
   not read out; long names end in "…". Beside the list on a desk an open
   record has them too, though the list is its way back, so the header
   says where it is.
4. **Trails start at the area.** Admin's pages start at the Menu
   (Menu › Admin › Bring in the crew list), since that is where Admin is.

## Consequences

- A new page passes `up` to `Top` (or `Page`) rather than drawing a
  `.back` link: the steps from its area to its parent, and its own name.
- **A departure from the design system**, at Colly's ask: breadcrumbs in a
  working tool. They appear only on a desk, where there is room, and
  shrink to the system's Up link on a phone, as its `ds-crumbs` already
  does when short of room. Sent back to the system as a learning.
- If the tidy-up moves pages, the trails move with them, in one place
  each.
