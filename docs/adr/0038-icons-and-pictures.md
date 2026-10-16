# ADR 0038: Icons, and pictures of kit and crew

- **Status:** accepted
- **Date:** 16 October 2026
- **Asked for by:** Colly, 16 October 2026

## Context

Colly found the app very text heavy: Stock, Crew and a job's page are long
runs of names and grey lines in one weight, and nothing tells one card or
one row from the next until it's read. They asked for icons, placeholders
for pictures of gear and of crew, and for the icons to go back into the
shared design system so every app draws the same ones.

The app had five hand-drawn icons (the places in the bar) and a sun and
moon. The shared design system had a rule (an icon beside its word, show
the thing itself where you can) but no icons and no parts for pictures.

## Decision

1. **One icon set, the design system's.** The design system now ships 71
   icons from Lucide (an open set, ISC licence), named by what they mean to
   crew (`audio`, `rigging`, `case`, `repair`, `pick-list`), with the rules
   for using them and for pictures of things and people in its
   `docs/imagery.md` (version 0.4.0). The app vendors `icons.js` and
   `icons.d.ts` beside the colour tokens with `npm run ds:sync`, and draws
   them with `web/src/Icon.tsx`. The bar's icons and the theme button moved
   over to the set; the app draws no icons of its own.
2. **Every card heading on Home, Jobs, a job, Stock and Crew starts with an
   icon**, so a long page of cards can be scanned by shape. The Menu's
   places each have one, and its "›" is the set's `next`.
3. **Kit gets a picture.** Every product in the stock list, every item found
   by a search, every kit line on a job, and the top of a product's or an
   item's page has a square tile. Until there is a photo it is a quiet
   placeholder with the icon for what the thing is: a case is a case; then a
   word in its category or name (mic, cable, desk, projector, screen,
   headphones, rack); else its department. The department filters and the
   kit groups on a job carry their department's icon too
   (`web/src/stock/kitIcon.ts`).
4. **Crew get a face.** Every person in the People list, everyone named on
   a crew call (small and overlapping), and who's working or away this week
   on Home has a round tile with their initials until there's a photo. The
   initials sit on the same neutral grey for everyone: colour means state
   here, so no colour per person. They're drawn from an attribute, so a
   row's text is still just the name.
5. **Placeholders now, photos later.** There's nowhere to keep photos until
   the backup bucket is set up (files wait on it, as documents' do), so
   every picture is a placeholder today. `Thumb` and `Avatar`
   (`web/src/Picture.tsx`) already take a photo's address and fall back to
   the placeholder if it can't load. A person's photo will be theirs to give
   and to remove, and erasing a person erases it.

## Consequences

- Rows are a little taller on a phone (a 44px tile beside two lines of
  text), and Stock shows the same five products in about the same height.
- Adding a product with a new kind of thing may want a new word in
  `kitIcon.ts`, or a new icon in the design system first; the app never
  reaches into Lucide itself.
- Next: a way to add a photo to a product and for a freelancer to add their
  own, once files have somewhere to live.
