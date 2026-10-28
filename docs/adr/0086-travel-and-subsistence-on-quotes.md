# ADR 0086: Travel and subsistence on quotes

- **Status:** accepted
- **Date:** 28 October 2026
- **Asked for by:** Colly, 28 October 2026: travel for the crew when a gig is
  further than a distance set in Admin, priced from the fuel price and what a
  vehicle uses, from Dublin city centre to the venue; a per diem set in Admin
  for each of the crew; and a switch on the quote for when the job provides
  meals.
- **Builds on:** [ADR 0042](0042-quotes-prices-and-a-money-view.md) (quotes),
  [ADR 0047](0047-vans-and-drivers.md) (vans on a job),
  [ADR 0057](0057-venues-on-the-map.md) (venue pins),
  [ADR 0080](0080-a-quote-that-saves-itself-and-keeps-up-with-the-job.md) (the
  editor), [ADR 0085](0085-rate-rules-discounts-and-an-agreed-price.md)
  (discounts and an agreed price).

## Context

Crew travel and meals were typed onto quotes by hand, when someone remembered,
with the sums done on a phone. They follow from things the app already knows:
where the venue is, how many crew for how many days, and how many vans go.

## Decision

**Two lines the quote works out for itself.** A draft adds a travel line and
a subsistence line at the end, under "Travel and subsistence", marked on the
line (`extra: 'travel' | 'subsistence'`). They are ordinary quote lines, so
the totals, VAT (23%), printing, versions and "What changed since" need
nothing new. They aren't typed: the draft works them out again whenever the
crew lines, the venue, the vans or Admin's figures change, and saves itself
as it does for any change. A quote that has gone to the client keeps the
lines it went with.

- **Travel**: charged when the distance each way is more than Admin's
  "Travel after" (50 km unless set). One line, charged once: for each van
  booked on the job (at least one), the fuel there and back,
  `2 × km × litres per 100 km / 100 × fuel price`, to the cent.
- **Distance**: from Dublin city centre (O'Connell Bridge) to the venue's
  pin, or the first of its phases' venues with one, as the crow flies and a
  fifth more for the roads (Galway, Cork and Belfast come out within a few
  km of the motorway). No road route is asked of an outside service. The
  office can type the real distance on the quote (`quotes.travel_km`), which
  wins over the map and carries to the next version.
- **Subsistence**: the per diem for each crew day: each crew line's how many
  times its days, a half day counted as a day. Printed as so many crew days
  at the per diem a day. Not charged when the quote's "Meals provided" switch
  is on (`quotes.meals_provided`, carried to the next version).
- **Discounts**: a line's or a department's discount doesn't reach them
  (they're kept apart from the lines typed), but the discount off the whole
  and an agreed price do, as for any line.

**A price not set charges nothing.** The fuel price and the per diem start
unset; until they're set the quote says so and where to set them, rather
than putting a guessed figure on a client's quote. What a van uses starts at
10 litres for 100 km.

**The fuel price comes from AA Ireland, read when asked.** There is no free
feed of Irish pump prices. AA Ireland's fuel price page (Colly's pointer)
carries its monthly survey, updated on the second Monday of each month, as a
table. Admin › Company › Travel and subsistence has "Read the AA's price":
the server reads the page (at most once an hour), takes the diesel pump
price and the survey's month from the table, and puts the figure in the box
for the office to save. A page that no longer reads as the survey offers
nothing and says to type it in. It isn't read on a timer and saved by
itself, so a change to the AA's page can never put a wrong price on a quote
unseen. The day the price was saved shows in Admin, and a quote with travel
says so when it's more than 30 days old.

## Consequences

- `quote_settings` gains `travel_from_km`, `fuel_cents_per_litre` (cent a
  litre to one place), `litres_per_100_km`, `per_diem_cents` and
  `fuel_set_on`, set together by `quoting.travel` (money's); `quoting.update`
  leaves them alone. `quotes` gains `meals_provided` and `travel_km`.
- `GET /api/fuel-price` (money's) answers the AA's figure or a 502 saying to
  type it in. The app contacts nobody: it reads one public page when asked.
- An existing draft, opened once the figures are set, gains the lines and
  saves itself, as it would for any change from the job.
- Not done: travel for crew in their own cars, overnight stays, tolls, a
  van's own fuel use (one figure for every van), and road distances from a
  route planner.
