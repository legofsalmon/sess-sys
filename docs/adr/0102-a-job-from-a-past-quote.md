# ADR 0102: A job from a past quote

- **Status:** accepted
- **Date:** 30 October 2026
- **Asked for by:** Colly ("For the past quotes can we still add an action
  to create a job in the new system from that? I'd like to test that.",
  30 October 2026), which changes the "Link and look up only" choice in
  [ADR 0092](0092-current-rms-history-on-quotes.md) point 3.
- **Builds on:** [ADR 0078](0078-reading-current-rms-through-its-api.md) (the
  read-only copy of Current RMS), [ADR 0081](0081-starting-a-quote-and-following-it-up.md)
  (New quote makes an enquiry and its draft), [ADR 0085](0085-rate-rules-discounts-and-an-agreed-price.md)
  (rate rules, line discounts, an agreed total), [ADR 0096](0096-claude-inside-the-app.md)
  (lines offered to tick, matched to the stock list).

## Context

The quotes from Current RMS are on the Quotes page and on Past quotes, read
only. An open quote there for a job still to come, an order the calendars
never brought in, or a job the client books again each year all have to be
typed in again to get a job and a quote here. The office wants to try the
app on real jobs, and the quickest way is from a quote it already wrote.

## Decision

1. **"Make a job from this" on a past quote's page**
   (`#jobs/money/current-rms/<id>`), and **"Make a job from it"** on each
   unlinked one on the Quotes page, which opens that page with the form
   (`…/<id>/job`). One already linked to a job offers "Make another job
   from this", as a copy.
2. **The form starts as Current RMS had it, for the office to check:** the
   name, the client as one already here spells it ("Verve" for "Verve
   Live"), the venue, the days in Ireland, and confirmed for an order that
   wasn't cancelled, otherwise an enquiry (`rmsJobDraft`). Days that are
   past are said to be, so a repeat job gets new ones. Nothing is made
   until it's pressed.
3. **Each line is offered as a line of the draft quote**, the same list and
   choices as Claude's lines from an enquiry (`rmsSuggestions`):
   - groups aren't lines; they give the department of what's under them;
     an accessory charged nothing came with its product and is left out;
   - products hired out are kit, matched to the stock list when it's
     plainly the same one, with a product to pick when it isn't;
   - services are crew, under the company's own name for the role;
   - typed lines are as written; anything sold is charged once;
   - **each is charged as it was there:** the price for a day or a week, the
     rate rule it was charged by (Weekly, 3 Day Week, Daily), its
     chargeable days as the days out, and its discount. The price stays when
     another product is picked (`Suggestion.charged`), since it's what the
     client was quoted.
   - lines charged nothing (a product inside a package priced as one) are
     offered unticked, so the quote comes to what it did there.
4. **A total agreed on the whole** (the lines came to more than a euro away
   from the quote's total) is offered as the same agreed total, ticked.
5. **What's made:** the job with its days as one Show, noted "Made from quote
   N in Current RMS", and its first draft quote, with no discount off the
   whole (the lines carry theirs). A past quote not yet linked to a job is
   linked to the new one, as Match to jobs would, so its quote shows what
   was charged. The quote gets its own number when it's sent.
6. **Nothing in Current RMS changes**, and the past quote stays as it was.
   It's for those who see money, and needs signal, as the past quotes do.

## Consequences

- The calendars are no longer the one source of jobs from Current RMS's
  history: the office chooses which old quotes become jobs, one at a time.
- A line's days are as Current RMS had them; when the job's days change,
  the office changes the lines on the quote.
- Kit on the quote isn't put on the job's kit list: the office adds it from
  the job, as for any quote started from nothing.
- A copy of an old job keeps its old prices until changed; "Last charged"
  and the price list are a press away on the quote.
