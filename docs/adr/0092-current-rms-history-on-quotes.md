# ADR 0092: Current RMS's history on quotes

- **Status:** accepted
- **Date:** 28 October 2026
- **Asked for by:** Colly, part 4 of the quoting plan ("could you proceed
  with the work to bring in the old quotes", 28 October 2026), and the
  choice of "Link and look up only" on whether old quotes with no matching
  job should become past jobs.
- **Builds on:** [ADR 0078](0078-reading-current-rms-through-its-api.md) (the read-only copy
  of Current RMS), [ADR 0042](0042-quotes-prices-and-a-money-view.md)
  (quotes), [ADR 0085](0085-rate-rules-discounts-and-an-agreed-price.md) (rate rules).

## Context

The read-only connection (ADR 0078) brought every Current RMS opportunity and
its lines onto the server, but they sat apart: a list to search, with no tie
to the jobs the calendars brought in and no help when pricing. Pricing a line
meant opening Current RMS to see what the client paid last time. Its statuses
can't be trusted for won or lost: hundreds of quotes are still "provisional"
with their dates long past.

## Decision

1. **Each opportunity is matched to its likeliest job.** A job is a
   candidate when its days meet the opportunity's, give or take a day. It is
   scored by the client (the same company as both systems spell it, with
   Ltd, Limited and The left out, and "Verve" the same as "Verve Live"),
   the words of the name shared, and starting the same day. It is *sure*
   when the best scores 4 or more and no other job comes within 2.
   Worked out on the server each time (`matchOpportunities` in
   `shared/src/rms-history.ts`), so new jobs and a new read are matched
   without anything stored.
2. **The office links them, on Match to jobs** (`#jobs/money/current-rms/match`):
   each one beside its suggested job, with the other candidates to choose
   from; all the sure ones link in one press; any can be unlinked. The link
   is kept in `rms_matches` (server only, never synced, in Download
   everything). Linking records which job it was for here and nothing more:
   the job and Current RMS don't change.
3. **Old quotes with no job of ours stay past quotes.** Colly chose "Link and
   look up only": they are not made into jobs, so the calendars stay the
   one source of jobs.
4. **What went ahead is an order.** An order that wasn't cancelled went
   ahead; lost, dead or cancelled, or a quote whose days are past with no
   order, didn't; anything still to come isn't counted (`rmsOutcome`).
5. **By client:** on Past quotes, how many of each client's quotes went
   ahead of those decided, the usual discount (off what the lines came to,
   on those that went ahead), and when last. A job's quote shows its
   client's line and the past quotes linked to it, in an "In Current RMS"
   card.
6. **Last charged:** a line being priced shows what it was last charged in
   Current RMS to this client and to anyone, priced per period with its
   rate and discount, and "Use €X" fills the price. It's asked by the names
   the line goes by there: a product's own and its other names ([ADR 0070](0070-finding-a-product-by-typing.md)),
   a crew role without its phase, or what the line says. Only lines with a
   price count, and group headings don't.
7. **All of it is for those who see money** (office, directors, system
   admins), answered by the server from its copy, so it needs signal. The
   hints and the card say nothing without it; the quote works as before.

## Consequences

- Pricing from history takes a press, not a trip to Current RMS, and the
  office sees a client's usual discount before offering one.
- Matching is a suggestion: a job of ours on the same days for a different
  client can be offered, scored 0, and is never linked without a press.
- A product renamed here since Current RMS won't find its old lines unless
  the old name is one of its other names.
- Nothing here writes to Current RMS; the reader still can only ask.
