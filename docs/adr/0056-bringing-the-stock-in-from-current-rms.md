# ADR 0056: Bringing the stock in from Current RMS

- **Status:** accepted
- **Date:** 19 October 2026
- **Asked for by:** Colly, 19 October 2026 ("I have an export of the
  database from current RMS, the current system used to manage some of the
  stock, can this be imported?"), who then said "I would presume all the
  stock is bulk rather than itemised as we need to integrate a new
  QR/barcode system to do that".

## Context

Some of the stock is kept in Current RMS. It exports one table a file, and
three of them matter here:

- **Products:** one row a product, with its name, product group,
  replacement charge, hire price and rate definition ("Daily Rate", "3 Day
  Week Rate", "Weekly Rate"), and whether it is serialised or bulk. It says
  nothing of how many there are, except a bulk quantity that can be stale.
- **Stock levels:** one row a serialised asset, with Current RMS's own
  asset number ("0000000751"), and one row a product's bulk stock with its
  balance. Rows of stock kept for sale come with them.
- **Rates:** the hire price again, and for some products a second, per
  store rate that is the one actually charged (a product priced €0
  store-wide and €90 for the Default store).

Neither products nor stock levels is a stock list on its own, so the
bring-in of [ADR 0026](0026-bringing-in-the-stock-list-and-item-logs.md)
can't read either as it stands: the products file has no counts for
serialised kit, and the stock levels have a row an asset (which the
bring-in reads as one counted row repeated, a problem) and no department
or value. Current RMS's asset numbers aren't on the kit: the company
hasn't labelled it yet.

## Decision

**The files are chosen together and read into one list on the device.**
"Bring in the stock list" takes several files at once. When they're
Current RMS's exports, known by their headers (`shared/src/current-rms.ts`),
the products and stock levels are both needed, the rates used when chosen,
and they're read into one stock list of a row a product with the headers
the bring-in knows: Product, Department, Category, Quantity, Value, Day
price. That list then goes through the usual bring-in unchanged: the
preview, every row checked, problems fixed in place, the same files a
second time changing nothing. The screen says what was read ("309 products
and 3,491 pieces of kit from Current RMS, with the rates"). A file chosen
twice, a missing one, or a product the stock levels count that the
products file doesn't have is turned back in words, before anything is
sent.

**Everything comes in counted.** Each asset is one of its product, bulk
stock its balance, sale stock left out, and a product none are held of
comes in with nothing counted. Current RMS's asset numbers are left
behind: they're on no label, so they'd be numbers nobody can scan, and
keeping 3,000 of them as old numbers would make 3,000 items to be found
and checked one by one. Products worth €150 or more come in numbered and
counted until labelled (ADR 0013's line), so labelling them later with the
app's own QR labels takes one off the count each, as ever. Current RMS has
one store, "Default", and no locations, so where it's all kept is typed
once above the rows ("All this kit is kept at", [ADR 0061](0061-one-place-for-a-whole-stock-list.md)).

**Product groups become departments.** A group that names one (Audio,
Lighting, Power, Rigging, Staging) is that; the others are matched by
hand: microphones and XLR cable Audio, DMX and FX Lighting, video
equipment and TV Video, pipe and drape Staging, the rest (cables,
computers) Other. The group stays as the category either way.

**A day price, in any stock list.** The bring-in reads a new column, Day
price ("day price", "day rate", "daily rate", "price a day", "hire
price", "rental price"), onto the price list of
[ADR 0042](0042-quotes-prices-and-a-money-view.md) with `price.product`.
Like a value, it fills a product's price only where it has none, so a
price the office set stays; two rows giving one product different prices
is a problem. From Current RMS it's the Default store's rate where there
is one, else the store-wide one, else the products file's; nought is no
price. The rental price is read as a price for a day whatever its rate
definition: the prices look like day prices across all three, and a
"Weekly Rate" that is really a week's price is put right on the product's
page.

**Left out:** pictures (the export's links are signed and stop working
within hours), weights, tags, countries of origin, sale prices, and stock
kept for sale.

## Consequences

- The office runs it on the live app: Stock › Bring in the stock list,
  choose the three files together, type where the kit is kept, tick to
  make that place, and bring it in.
- The device needs the prices it's sent to check rows again as the office
  fixes them; the office and directors are sent them (money ability).
- Labelling the kit is warehouse work from here: each label takes one off
  its product's count.
