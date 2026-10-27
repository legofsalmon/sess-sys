# ADR 0079: Building a rack up: side by side, rack parts, labels, undo and copies

- **Status:** accepted (part 2 of 3 of a more advanced rack builder)
- **Date:** 23 October 2026
- **Asked for by:** Colly, 23 October 2026, "a more advanced rack builder",
  planned in three parts in the Claude Doc "A more advanced rack builder:
  survey and plan". This is the second part.
- **Builds on:** [ADR 0074](0074-racks.md) (racks and layouts),
  [ADR 0075](0075-dry-hire-stock-and-the-rack-designer.md) (the designer) and
  [ADR 0076](0076-rack-mount-kit-and-the-rack-in-3d.md) (rack-mount kit and 3D).

## Decision

- **Narrower kit sits side by side.** A slot says where it sits across the
  rails (`rack_slots.across`: left, middle or right), as seen facing those
  rails. Half-width kit goes left or right, or centred in the middle; a
  third in any of the three. Two things on the same units only sit on top
  of each other, or meet in the middle front to back, when their parts of
  the width cross. A unit with two halves on it is used once in the totals.
  The designer places narrower kit where it's pressed or dropped across
  the unit, flat or in 3D, and the details can change it.
- **Rack parts are products** (`models.rack_part`: blank, vent, shelf or
  drawer), so they're counted, found, laid out and checked in a built rack
  like anything else. Only rack-mount products are parts. A press adds the
  usual six (1U and 2U blanks, a vent, a shelf, a 1U and a 2U drawer) when
  there are none. They're drawn as what they are: a blank or vent as a
  panel with nothing behind it, a shelf as a tray, a drawer with a handle.
- **Fill the gaps with blanks** puts full-width blanks over every run of
  empty units on the front, the tallest that fits first, and says any
  unit no blank is short enough for.
- **Loose kit can be in a shelf or drawer** on the same rack's rails
  (`rack_slots.in_slot_id`). Taking the shelf or drawer out, or off the
  rails, leaves what was in it loose in the rack; the server says so for
  each.
- **Labels, groups and tape.** A slot can have its own label (what's
  written on it in this rack, shown in place of the product's name), a
  group (RF, Playback) and the colour of its tape (`colour`, from nine
  tape colours). The tape colour is content, like a fixture's colour: a
  swatch on the panel's left edge and in the groups key, always with its
  name, never meaning anything in the app. Groups are listed under the
  rack with their tape.
- **Undo and redo** in the designer, for this visit (up to 50 steps), by
  button or Ctrl/⌘ Z and Shift Z. Each step is the changes it made and the
  ones that take it back, sent as ordinary layout changes, so another
  device sees an undo as it sees any change. Taking out a shelf and
  undoing it puts back what was in it.
- **Copy this rack** makes a new rack product of the same size and case,
  without a stock code (codes are each product's own), and the same
  layout, labels and all, and opens it in the designer. It isn't undone
  by Undo: it's a product, removed as any other.

## Why

- Rack builders like STAGERACK and Rackula all place half-rack kit side by
  side, offer blanks and vents, and let a slot be labelled; without them a
  real RF or playback rack can't be drawn as it's built.
- Parts as products rather than drawings keep the one rule of racks: what's
  in the layout is what a built rack is checked against.
- Undo makes dragging things about safe to try (Nielsen: user control and
  freedom), where before a slip meant remembering where it was.

## Left for part 3

Product photos on the panels, a printable rack sheet, and perhaps sizes
filled in from a list of known models.
