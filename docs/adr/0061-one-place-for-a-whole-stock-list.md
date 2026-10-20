# ADR 0061: One place for a whole stock list

- **Status:** accepted
- **Date:** 19 October 2026
- **Asked for by:** Colly, 19 October 2026 ("on the page to set the stock
  location can we just provide an option to set the stock location all to
  the same?")

## Context

Counted stock has to be somewhere, so a row that says nowhere is a problem
([ADR 0026](0026-bringing-in-the-stock-list-and-item-logs.md)). Current
RMS's exports ([ADR 0056](0056-bringing-the-stock-in-from-current-rms.md))
place nothing, so all 309 rows came up with "Say where these are kept" and
a place field of their own. A field above the rows, "Kit the list doesn't
place is at", already answered all of them at once, but it sat at the foot
of the Places and cases card, under the new places and their tick, where
it read as a footnote rather than the one answer. And a list that does
place its kit had no way to put it all in one place.

## Decision

- The card is "Where it's kept", and the one place comes first. When no
  row says a place, it reads **All this kit is kept at**; when some do, it
  stays "Kit the list doesn't place is at".
- When some rows do say a place, a tick, **Put all of it there**, sends
  every row to that one place, whatever the list says (`allAt` on the
  bring-in's options; an older app leaves it out, meaning no). Kit in a
  case stays in its case: the case is what's placed.
- A typed place that isn't here yet is still made only with the tick
  "Make the places and cases this list names", as before.

## Consequences

- A second bring-in with "Put all of it there" moves what's already here
  to that place, as any changed place does; the preview says so row by
  row.
