# ADR 0087: Packages

- **Status:** accepted
- **Date:** 28 October 2026
- **Asked for by:** Colly, part 2 of the quoting plan ("Go for it", 28
  October 2026). This is part 2b; rate rules, discounts and an agreed price
  were 2a ([ADR 0085](0085-rate-rules-discounts-and-an-agreed-price.md)).
- **Builds on:** [ADR 0042](0042-quotes-prices-and-a-money-view.md) (the price
  list and quotes), [ADR 0080](0080-a-quote-that-saves-itself-and-keeps-up-with-the-job.md)
  (adding lines on a quote).

## Context

Current RMS's quotes have hundreds of lines like "Mic package", "Cable
package" and "Decor LX package": a typed line with one price, charged Weekly,
and what it holds written in its description ("4 × SM58 with clips / 2 ×
DI's"). Each was typed again for every quote, spelt a dozen ways ("Mic
Package", "MIc package", "mic package"), with prices from nothing to €100.
The app had no way to quote kit together at one price except a line typed in
by hand.

## Decision

1. **A package is on the price list**: a name, the department it's listed
   under on a quote, a price and its rate rule (as products have), the
   products it holds from the stock list with how many of each, and
   anything else it includes in words ("with clips and stands"). Table
   `packages`, entity `package`, sent only to those who see money.
2. **On a quote it's one line.** "Add a package" puts it on at its price and
   rule for the job's days, listed under its department. What it holds is
   written on the line (`includes`) when it's added, with the package it
   came from (`packageId`), so a quote prints as it was made however the
   package changes later. The office can change the words on the line.
3. **What it holds prints under its line** in smaller type, on the draft and
   the printed quote.
4. **A package holds only products in the stock list** (up to 40, each
   once). One taken out of the stock list later prints as "a product no
   longer listed" until the package is changed.
5. **Taking a package off the price list** leaves quotes it's on as they
   were.

## Consequences

- A package's line is priced as a whole: it doesn't take its products' own
  prices, and its products are not added to the job's kit. Availability per
  quote line (part 3) can read what a package holds from its `packageId`.
- The packages Current RMS quoted are not brought in: they were typed text
  with no products. The office makes the few it uses.
