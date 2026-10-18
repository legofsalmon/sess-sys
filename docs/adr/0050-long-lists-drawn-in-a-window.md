# ADR 0050: Long lists drawn in a window

- **Status:** accepted
- **Date:** 18 October 2026
- **Asked for by:** Colly, 18 October 2026 ("First two on the still to
  build please": faster long lists, only drawing the rows on screen)
- **Follows:** [ADR 0049](0049-holding-up-at-real-size.md), finding 11 of
  the [audit of 18 October](../audit-2026-10-18.md)

## Context

The live app holds 903 jobs. ADR 0049 made Jobs' rows and Crew's call
groups `content-visibility: auto`, so the browser lays out and paints only
those near the screen. That halved the Jobs tab and took Crew from 2.8 s
to 1.0 s on a phone-speed CPU, but every row was still built: React made
all 900 rows and their pills, crew counts and kit flags on every tap and
every change pulled in, and that work was most of what was left. People
still tap twice on a screen that takes most of a second.

ADR 0049 kept every row in the page on purpose, so find in page, Tab and
a screen reader reach every job. Colly has now asked for only the rows on
screen to be drawn.

## Decision

1. **Jobs' list and Crew's call groups are drawn in a window**
   (`web/src/windowed.ts`): the rows on the screen and a screen's worth
   above and below, the rest standing in as padding on the list at the
   height each row was last drawn at, or a guess (110 px a job, 300 px a
   job's calls) for one never drawn. Scrolling draws the next rows as they
   come near. No library: the hook is about a hundred lines and knows the
   two ways a list scrolls here, with the page on a phone and in its own
   column beside an open job on a laptop.
2. **Heights are kept for the tab's life**, by list and row, so a list drawn
   again on Back is the height it was left at and `places.ts` finds its row
   at the same distance down; the row itself is then put back where it was
   on the screen, as before.
3. **A row that changes height above the screen moves the page by as much**,
   so the rows being read stay put. The browser's own scroll anchoring is
   off on these lists, or both would move it.
4. **Filled calls are built only once unfolded** (they were built and
   hidden), as a window can't tell what is on a screen it isn't on.
5. **Each job row says where it is in the whole list** (`aria-setsize`,
   `aria-posinset`), so a screen reader hears "140 of 600" though only a
   few dozen are in the page. The line between rows goes by that position,
   not by which row happens to be drawn first.

## What it costs

- **Find in page finds only the rows near the screen.** The Jobs list has
  its own search, by job, client and venue, at its top; Crew has its
  department filter. A person who presses Ctrl+F for a job far down the
  list will not find it there. Rated a 2: the search field is the first
  thing on the card, and the office uses it already.
- **Tab moves through the drawn rows,** and as focus moves the page follows
  it and the next rows are drawn, so tabbing down the list still reaches
  every row. A row scrolled far away by hand while it has focus is no
  longer in the page, and focus goes back to the page.
- **A screen reader's reading mode** reads the rows drawn, then moves on.

## Measured

900 extra jobs on the made-up data, each with two calls short of people,
CPU slowed four times, phone size, from the tap to the next frame:

| Tab | ADR 0049 | Windowed |
|---|---|---|
| Jobs | 254–587 ms | 80–242 ms |
| Crew | 730–959 ms | 132–192 ms |

The Jobs list builds 26 rows instead of 600; scrolling it end to end, on a
phone and in the laptop's column, left no blank row on the screen.

## Consequences

- `content-visibility` is gone from these rows: a row standing in at a
  guess would report the guess as its height.
- Another long list can take the same hook: a name, its items, a key and a
  guessed height, with the list's and each row's `ref`.
