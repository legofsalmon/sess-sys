# ADR 0074: Racks

- **Status:** accepted (part 1 of 2; the rack designer and dry hire stock follow)
- **Date:** 22 October 2026
- **Asked for by:** Colly, 22 October 2026 ("consider how you would make up
  racks in the stock. They will consist of a rack flightcase and various
  components. It will essentially be a virtual group of equipment that
  gets its own name/stockcode etc. scanning that checks in all of the
  contents within it etc. Part of this I'd also like to assist with the
  designing of these racks by providing a virtual rack designing tool.
  Similar to stagerack.com.")
- **Builds on:** [ADR 0013](0013-warehouse-catalogue.md) (products, items
  and cases), [ADR 0014](0014-kit-on-jobs.md) (kit on jobs and what's
  short), [ADR 0017](0017-pick-lists-and-scanning-out-and-in.md) (a case
  scanned takes what's in it along) and
  [ADR 0070](0070-finding-a-product-by-typing.md) (finding a product).

## Context

Much of the kit travels built into racks: a monitor rack, an amp rack, a
playback rack, each a flightcase with the same kit in it every time. The
stock list already let a case hold items, and scanning a case out or in
takes everything in it along. What it lacked: a rack as a thing with its
own name and stock code that a job books, a plan of what goes where in it
to check a built one against, sizes to tell whether kit fits, and a rule
that kit built into a rack isn't free to go out on its own.

## Decision

- **A rack is a product** marked as a rack (always a numbered case), with
  its own stock code. Each one built is an item of it: the flightcase,
  holding its kit. Two identical monitor racks are two items of "Monitor
  rack"; a one-off rack is a product of its own. A job books a rack by its
  name as one kit line, and what's short is worked out as for any product.
- **A stock code on any product** (`models.code`), unique when given,
  whatever the capitals, and found by the catalogue search and the product
  picker as its name is.
- **Sizes on any product**: rack units, depth in mm, weight in kg to a
  tenth, power in watts. For a rack they say the room in it, the depth it
  takes and its weight empty.
- **A layout for each rack** (`rack_slots`, `rackSlot.set` and
  `rackSlot.remove`): a slot for each thing in it, at the rack unit its top
  sits at, counted from the top as racks are, on the front or the back
  rails; or loose in it (cables in the drawer), any number. Something on the
  rails is one at a time. A rack can't go in a rack.
- **A layout is a plan, said, not refused.** The app adds up the units
  used each side, the weight and the power, and says what won't fit: off
  the bottom, on top of something else on the same rails, deeper than the
  rack, or a front and back that meet in the middle (their depths together
  more than the rack's). The server refuses only what can't be meant: the
  rack isn't a rack, the product is gone or a mistake, the rack itself.
  This is the escape hatch of ADR 0014.
- **A built rack is checked against its layout**, product by product: what
  it should hold and doesn't (missing), and what it holds that its layout
  doesn't. Shown on the rack's page (each built one: "All there" or "2
  missing") and on the built rack's own page.
- **Kit built into a rack goes with the rack.** An item in a rack, however
  deep, and anything counted in one, isn't free for a job on its own:
  what a product has to go out is less what's racked. Scanning works as it
  did: a rack scanned out or in takes everything in it.
- **Where:** Stock › Racks lists them (size, how many built, which aren't
  all there, which don't fit) and adds one; a rack's product page shows its
  layout, drawn unit by unit front and back and listed, with the totals and
  what won't fit; a product in layouts says which; an item built into a
  rack says so.
- A product in a layout can't be removed or marked as a mistake until it's
  taken out; a rack with a layout stays a rack. A rack marked as added by
  mistake takes its layout with it.

## Part 2, to follow

Colly's answers on the card and after it (22 October 2026, 20:28 and
20:35): gear not owned goes in the catalogue, and the catalogue tells our
own stock from dry hire stock. So each product will be **Ours** or **Dry
hired in**, a dry hire one with its supplier, hire price and a buy price
if we're weighing up buying it; the catalogue filters by it; dry hire kit
is never counted short and shows on a job as hired in. The **rack
designer** then lays out a rack by dragging gear in from what we own (and
how much is free on a day) and from dry hire, with the same checks as
here, and totals what the rack would cost to buy or hire in.

## Consequences

- Booking a rack and booking the kit in it separately would count the kit
  twice; racked kit isn't free, so a job asking for a loose amp that only
  exists inside racks shows short, which is true.
- The layout check is by product, not by item: which particular amp is in
  the rack doesn't matter, only that it's there.
- Kit loose in a case inside a rack (a drawer that is a case of its own)
  counts as racked, but the check only reads what the rack holds directly.
