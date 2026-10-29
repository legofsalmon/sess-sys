# ADR 0089: Availability, subhire and margin on quotes

- **Status:** accepted
- **Date:** 28 October 2026
- **Asked for by:** Colly, part 3 of the quoting plan ("You can continue on
  with part 3", 28 October 2026).
- **Builds on:** [ADR 0014](0014-kit-on-jobs.md) (subhire on a job's kit
  line), [ADR 0031](0031-getting-kit-ready-and-back.md) (when kit is held),
  [ADR 0042](0042-quotes-prices-and-a-money-view.md) (quotes),
  [ADR 0087](0087-packages.md) (packages).

## Context

A quote could promise kit that was already out that week; the office found
out later, on the job's kit tab. Subhire had a count on the job's kit but no
cost, transport had a price and no cost, and the only margin was a job's,
after the event, from freelancers' timesheets. The boss's question on the
phone is "can we do it, and what do we make?", and the quote couldn't answer
either part before it went out.

## Decision

1. **Each kit line says whether there's enough.** The quote's lines are
   checked against the job's days, with its days to get kit ready and check
   it back (ADR 0031), from today on, against what other jobs hold. The
   job's own kit is left out, since the quote is what the job's kit will be.
   All lines of a product and the products in packages are counted
   together. Kit hired in and dry hire stock aren't. Worked out on the
   device (`quoteKit`, `quoteWants` in `shared/src/sync/quote-kit.ts`).
2. **A short line says so and offers to hire in what's short.** Its line
   reads "Short by 4 on Mon 9 Nov: Corrib Arts Week has 16 out" with "Hire 4
   in", which puts that many on the line as hired in and opens it for who
   from and the cost. A line that would be short if pencilled jobs went
   ahead says that quietly. A line with enough says nothing until it's
   opened ("healthy is quiet"). The summary counts lines short of kit. A
   package line lists the pieces it's short of.
3. **A line carries a cost side, never printed** (`subhireQty`, `supplier`,
   `costCents` on the quote line): how many of a kit line are hired in and
   who from, as a job's kit line has them, and what the whole line costs us
   before VAT. Built from the job, a line takes the job's subhire. Left
   empty, a line's cost is worked out (`lineCostOf`):
   - crew at their crew call's booked rate, or else the rate anyone's been
     booked at for the role;
   - our own kit costs nothing;
   - travel and subsistence cost what they charge, since they go on to the
     crew.

   Kit hired in, or anything else with no cost typed, is "not known" until
   typed.
4. **Transport has its own Add.** "Add transport" offers each van booked on
   the job ("Luton van and driver"), or transport typed. Either way it's
   charged once, under Transport, with its cost beside it.
5. **The margin is for everyone who sees quotes**: the office, directors
   and system admins (Colly, 28 October 2026: "Office and directors can see
   all of this"). They see each line's margin, and the whole quote's in the
   summary that stays in view ("Margin €3,400.00, 62%"), counting lines
   with no cost yet, and on a version that has gone out. It is never
   printed. The plan had said "to the boss only"; Colly widened it.

## Consequences

- The margin before a job is an estimate: crew at booked rates, our own kit
  at nothing. The job's margin after (ADR 0042) still comes from approved
  timesheets, and is unchanged.
- Hiring in on a quote doesn't change the job's kit. The office still sets
  subhire on the kit tab once the job is confirmed.
- The check reads what this device has, as the job's kit does: an
  enquiry's or quote's kit counts only as pencilled, so a line can be
  enough now and short once another job confirms.
