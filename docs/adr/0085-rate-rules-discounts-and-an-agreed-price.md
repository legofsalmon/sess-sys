# ADR 0085: Rate rules, discounts and an agreed price

- **Status:** accepted
- **Date:** 28 October 2026
- **Asked for by:** Colly, part 2 of the quoting plan ("Go for it", 28
  October 2026). This is part 2a; packages are part 2b.
- **Builds on:** [ADR 0042](0042-quotes-prices-and-a-money-view.md) (quotes and
  the price list), [ADR 0078](0078-reading-current-rms-through-its-api.md) (the quotes read
  from Current RMS), [ADR 0080](0080-a-quote-that-saves-itself-and-keeps-up-with-the-job.md)
  (the editor), [ADR 0084](0084-the-printed-quote.md) (the printed quote).

## Context

Every kit price in the app was a day price, charged for every day. Current
RMS charged each product by one of three rate definitions, and its rates
export gives each product one: 3 Day Week (180 products), Weekly (113) and
Daily (32), with Sale for the rest. The lines read from its quotes show how
each was charged:

- **Weekly:** the price is for a week, and any part of a week is a week:
  `ceil(days out / 7)`.
- **3 Day Week:** a day price, but never more than three days in any seven:
  `3 × whole weeks + min(3, days left over)`.
- **Daily:** by the day.

Without these, a week's hire was either over-quoted or put right by hand with
"Charge all kit for 3 days", and the office had no way to discount one line or
one department, or to quote the price the client had already agreed.

## Decision

1. **Each product price has a rule**: Daily, 3 Day Week or Weekly
   (`product_prices.rate`). The price list shows it beside the price, which
   reads "a day" or "a week" to match. A change from an app older than this
   says no rule, and the rule is kept.
2. **Take the rules from Current RMS.** One press on the price list (Jobs › Money › Price list) gives
   each priced product with no rule yet the rate definition its Current RMS
   lines were charged by most, matched by the product's name or one of its
   other names, case aside. A rule the office chose stays. 184 of the 2,983
   names in the history were charged more than one way, so it is the most
   common, not the only one.
3. **A kit line charged by a rule keeps its days out** (`out`) and works its
   days charged from them, so the office types "10 days out" and the line
   shows "Charged 6 days" (3 Day Week) or "2 weeks" (Weekly). The days
   charged are still saved on the line, so a device from before this reads
   the same amount. "Charge all kit for" now applies to lines charged by the
   day only.
4. **A line can have its own discount** (`discountPct`, 0 to 100 in tenths),
   taken off before the whole quote's. The printed line says "less 30%".
5. **A department's discount** is put on every line in it, one press per
   group. It is not a rule of its own: each line then says what it is
   charged, and any one can be changed after.
6. **Agree a total.** The office can type the price agreed before VAT
   (`quotes.agreed_cents`). The discount off the whole becomes whatever brings
   the lines to it, shared across VAT rates by their part (the last takes the
   cents left over), and the totals say "Agreed discount" with what it comes to as a percentage. The
   percentage field gives way to what the discount comes to while a price is
   agreed. A price above what the lines come to isn't saved. The copy of a
   version keeps it; a new version from the job starts without one.
7. **What changed since the version before** counts a line's discount, and
   an agreed price coming, going or changing.

## Consequences

- A product with no rule is charged by the day, as before, so nothing quoted
  changes until the rules are taken or chosen.
- The rules from Current RMS need its quotes read (Admin › Connections).
- Packages, with their own price, are part 2b.
