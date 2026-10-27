# ADR 0075: Dry hire stock and the rack designer

- **Status:** accepted
- **Date:** 22 October 2026
- **Asked for by:** Colly, 22 October 2026: the rack designing tool ("Similar
  to stagerack.com. Here you can check for size and space, and draw on
  equipment currently in stock, but also potentially other stock that we
  don't own yet"); on the card, gear we don't own goes in the catalogue
  ("A - also an option would be to dry hire the stock in from a
  supplier"); then "within the stock catalogue we would need to
  differentiate our own stock and dry hire stock also."
- **Builds on:** [ADR 0074](0074-racks.md) (racks, sizes and layouts),
  [ADR 0013](0013-warehouse-catalogue.md) (the catalogue),
  [ADR 0014](0014-kit-on-jobs.md) (what's short) and
  [ADR 0031](0031-getting-kit-ready-and-back.md) (what jobs hold on a day).

## Context

A rack is often planned before all its kit is ours: an amp we'd buy, a
hazer we hire in from a supplier when a job needs it. Part 1 drew a rack's
layout from a form, one thing at a time. Planning one wants the kit laid
out beside the rack to pick from, with what's free, and the rack's cost if
some of it is hired in or bought.

## Decision

- **Every product is Ours or Dry hire** (`models.dry_hire`). A dry hire
  product has the supplier it comes from and their price a day
  (`supplier`, `hire_day_cents`); its value is what one would cost to buy,
  for weighing up buying it. It sits in the catalogue with our own, and
  the catalogue filters by **Whose** (Ours, Dry hire) once there is any.
- **None of a dry hire product is ours to label or count**: the server
  refuses items or counts for it, and a product with items or counts can't
  be made dry hire until they're gone. A rack is always ours.
- **Dry hire is never short.** On a job it's hired in for the job: its
  kit line says so quietly, with the supplier, and counts none of ours.
- **A rack's layout adds up what's dry hired:** how many things, their
  hire a day and what they'd cost to buy, said where a price is missing.
  A built rack isn't missing what's dry hired in its layout; it's listed
  as to hire in, and a job booking that rack says what to hire in for it.
- **The rack designer** (`#stock/racks/<id>`, "Design it" from the rack's
  page and straight after adding one): the kit to build with on one side,
  found by typing, filtered by whose, each with its size and how many are
  free on a day (what we have, less what's racked, unfit or held by jobs
  that day), or who it's hired from; the rack front and back on the other,
  with its totals and what won't fit as on its page.
- **Put kit in by dragging it, or by pressing it then pressing where it
  goes**, the same on a desk and a phone and by keyboard. The units it
  would take light up as it's held over them, amber where it won't fit; it
  still goes in, as a layout is a plan (ADR 0074). Drag or press a thing
  in the rack to move it, to the other side, loose, or back to the list to
  take it out. Loose kit put on the rails goes one at a time.
- No new commands: the designer writes `rackSlot.set` and
  `rackSlot.remove`, so the history, roles and offline working are as for
  the layout form, which stays on the rack's page.

## Consequences

- Dry hire products sit in pick lists and quotes like any other; the
  hire-in itself (who orders it, when it comes and goes back) isn't
  tracked yet. A supplier is a name typed, not a client or a contact.
- "Free" in the designer is a guide for planning: it doesn't stop a
  rack's layout using kit that jobs hold, since a layout books nothing.
- A product that becomes ours after being dry hire is changed to Ours and
  then labelled or counted as usual.
