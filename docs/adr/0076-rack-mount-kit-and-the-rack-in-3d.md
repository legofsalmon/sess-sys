# ADR 0076: Rack-mount kit, rack cases, and the rack in 3D

- **Status:** accepted (part 1 of 3 of a more advanced rack builder)
- **Date:** 23 October 2026
- **Asked for by:** Colly, 23 October 2026: "Can we make this a more
  advanced rack builder? Something more similar to the 3d rack builder
  tools and utilities available", and "a 'rackable' checkbox so that we
  can state that a stock item is capable of being put in a rack. This can
  then reveal more options when true - such as rack height, depth etc". On
  the card, a true 3D view you can turn rather than a fixed drawing.
- **Builds on:** [ADR 0074](0074-racks.md) (racks, sizes and layouts) and
  [ADR 0075](0075-dry-hire-stock-and-the-rack-designer.md) (the designer).
- **Survey:** the touring rack tools (STAGERACK, Rackula and others) draw
  racks flat, front and back; 3D is found in AV design CAD (Vectorworks
  ConnectCAD) and data-centre planners. The survey and the three-part plan
  are in the Claude Doc "A more advanced rack builder: survey and plan".

## Decision

- **Rack-mount is said, not guessed** (`models.rack_mount`). A product
  ticked as rack-mount shows and keeps its height in rack units, its width
  across the rails (full, half or a third: `rack_width`) and its depth;
  one that isn't keeps none of them. Weight and power are for any product.
  Products given a height before, or already on a layout's rails, became
  rack-mount when this came in. A rack is never rack-mount.
- **Kit not marked rack-mount on the rails is said, not refused**, as for
  everything in a layout: it may be meant to sit on a shelf. The designer
  lists rack-mount kit by default, with everything else a tap away to put
  loose in the rack.
- **A rack's case** gets its outside width, height and depth
  (`case_*_mm`, for the truck), whether it's on castors, and what its power
  can take in amps (`power_limit_a`, such as a 16 A distro in it).
- **What a layout comes to** adds amps at 230 V and heat in BTU an hour to
  the weight and watts, and says two more things: a rack over 50 kg all in
  that isn't on castors (more than two people should lift), and power past
  what the case's power can take.
- **The rack in 3D**, in the designer beside the flat view and a new side
  view: the case see-through, its four rails and each rack unit marked, and
  each thing on the rails as a box to its height, width and depth, from the
  front rails back or the back rails forward, its name on its panel.
  Turned by dragging, zoomed by scrolling or pinching, or set square to the
  front, back or side. Kit is dropped or pressed onto the face towards you,
  as on the flat view; a thing in it is pressed to pick it up. Built with
  three.js, loaded only when the 3D view is shown. A desk opens it in 3D,
  a phone flat; the last choice is kept on the device.
- **From the side**: the rack cut through, front rails on the left and
  back on the right, each thing as deep as it is, so the room behind it
  and front and back kit that meet are seen.
- The flat view stays the one to use by keyboard and screen reader; the 3D
  drawing names what's on the rails for a screen reader and points there.

## Consequences

- Kit narrower than the rack is drawn at the left of its unit until part 2
  gives it a place across (left, middle, right), with shelves, drawers,
  blanks, labels and colours.
- The 3D view is about 140 kB more to download, once, when first shown.
- Part 3 adds product photos on the panels and a printable rack sheet.
