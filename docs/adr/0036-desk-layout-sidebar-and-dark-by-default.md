# ADR 0036: A desk layout, a sidebar, and dark by default

- **Status:** accepted
- **Date:** 12 October 2026
- **Asked for by:** Colly, 12 October 2026

## Context

On a laptop the app was a phone stretched: one 640px column in the middle
of the screen and the five places in a bar along the bottom. Colly asked
for better use of the space on a desk, the bar as a sidebar there, a dark
theme by default with a toggle top right, and the header to be the
company's name and mark with the demo's "seeing it as Director" under it,
rather than in a black bar of its own above everything.

The shared design system already says most of this: dark is its default
theme, an app with both lets the person choose, and from 900px across a
bar of two to five places becomes a rail down the side, expanded with its
words on a desk (its navigation page noted sess-sys as the one app with a
bar on desk too).

## Decision

1. **From 900px the five places are a sidebar** down the left: the same
   links, a picture beside each word, the current one filled in the red,
   the Crew count at the end of its row. Under 900px it stays the bar
   along the bottom. The sidebar doesn't step aside for a pinch, as the
   phone's bar does for its keyboard.
2. **Wider screens use the width.** From 900px the page is up to 760px
   wide beside the sidebar; from 1200px a screen's cards stand two across,
   in the order they come, and the Menu's groups likewise. The header,
   titles, ways back, filters and anything not a card keep the full width.
   The Jobs and Stock list-and-record layout and the planner keep theirs;
   History stays one column because it reads down the days.
3. **Dark by default, light a press away.** index.html opens dark. A sun
   or moon button at the right of every header (sign-in and the demo's
   chooser too) switches between them. You (#me) offers the same plus
   "match this device's setting". The choice is the device's own, in
   localStorage under `sh.theme`, read by a line in index.html before the
   page is drawn so it never flicks from dark to light. Session Hire's own
   red and burnt orange have their dark values for "dark" and for "auto"
   on a phone set to dark; a test holds both to own-colours.ts.
4. **The header is the company.** The mark and "Session Hire" lead every
   screen. Under it is the area on the live app and, on the demo, "Seeing
   it as Director", the persona's name in the red (which means "you") and
   a link back to the chooser. The black bar is gone.
5. **Home is the page's one title, and today's date is top right** in the
   header (Colly, 12 October 2026), with "Hello, <name>" left under the
   title. On a phone narrower than 480px the date takes the room "Up to
   date" had, which stays for a screen reader; waiting and no signal still
   show.

## Consequences

- The freelancer's pages, on their own phones, still follow the phone's
  setting: they aren't the app and have no toggle.
- On the demo the area's name leaves the header; the screen's large title
  and the lit place in the sidebar or bar still say where you are.
- Two cards side by side are as tall as the taller, so a short card can
  have space under it. Cards keep their order rather than packing.
