# ADR 0013: The warehouse catalogue

- **Status:** Accepted, 30 September 2026. The first part of Phase 2.
- **Decides:** how products, their numbered items, labels, places, cases
  and counted stock are held, before equipment lines on jobs, label
  printing and scanning build on them.

## Context

Phase 2 is the warehouse ([roadmap](../roadmap.md)). Everything in it
needs the same base: what Session Hire owns, how many of each, and where it
lives. Equipment lines on jobs need how many of each product there are, to
warn of shortages. Scanning needs a number on each item it can look up.
Faults and inspections need the item they belong to.

Nothing is labelled yet. The [stock research](../research/stock-tracking.md)
recommends a QR label with a readable number (`SH-004217`) on every item
worth tracking one by one, counting the rest, an internal id for each item
that is never printed, and labelling over weeks as gear passes through the
warehouse (§0, §3, §5, §9). So for a while most gear will have no label,
yet the app still has to know it's there.

The Stock tab holds the Phase 0 sync test, whose "products" are a stand-in
for this.

## Decision

- **Products** are the kinds of kit: "d&b Y10P", "XLR 10 m", "Amp rack".
  Each has a name (no two the same), a department (Audio, Lighting, Video,
  Staging, Rigging, Power or Other), a category typed freely (Speakers,
  Cables), a replacement value if known, notes, and how it is tracked:
  - **numbered**: each one gets its own label and number, for anything
    worth more than about €150, anything needing its own test or
    inspection history, and anything that goes missing (speakers, amps,
    consoles, fixtures, rigging, every case);
  - **counted**: quantities only, for cheap interchangeable kit (cables,
    clamps, adaptors).

  The code calls a product a model, since the sync test already has
  products; the app says product.
- **Items** are the numbered pieces. Each has an internal id that never
  changes and is never printed, a Session Hire number (`SH-` and six
  digits), the manufacturer's serial, where it lives, and notes.
  - **The number** is either the next free one, given by the server (a
    device with no signal shows "number when synced"), or the one on a
    label already stuck on, typed or scanned in any form: `SH-000123`,
    `sh 123` or `123`.
  - **A number is only ever used once.** A new label for a worn one gives
    the item a new number; the old one is kept as a former label and is
    never given out again. The item keeps its id and its history.
  - **Items are never deleted.** Retiring one (sold, scrapped, lost or
    stolen) keeps it and its number; one that turns up again is brought
    back.
- **Counted stock** is how many of a product are at a place or in a case,
  set by counting ("there are 120 here") or moved ("10 from Bay A3 into a
  cable bag"). A move needs that many to be there, and no count goes below
  nothing.
- **Numbered products can be counted until they're labelled.** "24 × d&b
  Y10P" counted at the warehouse is 24 not labelled yet. Adding an item
  where some are counted takes one off the count (the form ticks this),
  so labelling changes where the numbers come from, not the total. The
  app knows everything owned from the first day, and "not labelled yet"
  shows how far the labelling has got.
- **Places** are where kit lives: the warehouse, a bay or shelf, a van, the
  repair bench. A flat list the office names, added by typing a new name
  wherever a place is asked for; one can be removed once nothing is there.
- **Cases** are numbered products marked as holding other kit: road cases,
  racks, bags, cable bundles. A case holds items and counted stock, and
  can sit in another case (a rack in a truck pack), up to five deep.
  Nothing can go inside itself or inside something it holds. Moving a case
  moves everything in it. A case is emptied before it's retired. What is
  recorded is what normally lives in the case, such as an amp rack's amps
  or a bag's ten XLRs; packing cases for a job comes with pick lists.
- **An item lives at a place or in a case, or isn't placed yet.** Where it
  is right now, out on a job or back, will come from scans; this is where
  it's kept. A retired item is kept nowhere.
- **The server keeps the rules**, whichever device a change comes from:
  numbers used once, product and place names used once, nothing inside
  itself, no moving more than is there, and no removing a product that
  has items or counted stock, or a place with anything at it. A change
  made with no signal shows as waiting, and if the server turns it down,
  the reason says what to do, as everywhere else.
- **The Stock tab becomes the catalogue:** products by department, with a
  search that finds a product, a number or a serial (a Bluetooth or USB
  scanner that types a label's number and Enter opens the item); a page
  for each product with its items and counts, where items are added one
  after another while labelling; a page for each item with where it lives,
  what's inside if it's a case, a new label and retiring; and a page for
  each place with everything there. The sync test moves to the bottom of
  Stock until equipment lines replace it.

## Consequences

- Equipment lines, next, can work out how many of a product there are
  from the first day: items in service plus what's counted.
- Label printing and scanning look items up by number. Labels live in
  their own table, so a manufacturer's barcode, an NFC tag or a UHF RFID
  tag can be added to an item later without changing the item.
- Two devices with no signal can both type the same number; the second to
  reach the server is told which item has it. Labels from a pre-printed
  roll can't clash that way.
- The next free number is one more than the highest ever used. Printing a
  run of labels, next, will set its numbers aside so that numbers given
  out in the office don't land in a roll not yet stuck on.
- A new device downloads every product, item and count the first time it
  opens. That's fine for thousands of items; a smaller first download can
  come later if it gets slow.
- "In repair", PAT tests and lifting inspections come with faults and
  inspections later in Phase 2, with the fields they need on products and
  items.
- Bringing in an existing stock list waits on knowing its shape: is there
  a spreadsheet?
