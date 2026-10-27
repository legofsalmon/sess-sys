# ADR 0078: Reading Current RMS through its API

- **Status:** accepted
- **Date:** 23 October 2026
- **Asked for by:** Colly, 23 October 2026 ("Could you integrate directly
  into the current RMS API?", then "Yes, let's build the API connection and
  then I'll give you an export so you can see the shape of the data too.")
- **Builds on:** [ADR 0042](0042-quotes-prices-and-a-money-view.md) (quotes
  and who sees money), [ADR 0056](0056-bringing-the-stock-in-from-current-rms.md)
  (the stock from Current RMS's exports),
  [ADR 0034](0034-roles-and-what-each-can-change.md) (roles).

## Context

The office quotes in Current RMS today. The quoting engine planned for the
app (a quick start, rate rules, packages, availability and margin on every
line) should be shaped by how quotes are really made there: which rate
definitions, which discounts, which lines go together. Exporting CSV files
by hand each time is slow and easy to get wrong (ADR 0056 needed three
files read together). Current RMS has an open API, with a key the office
makes under System Setup › Integrations › API.

That key gives full read **and write** access to the office's Current RMS.
Its rate limit is 60 requests a minute; opportunities come 25 a page, and
an opportunity's lines are a request of their own.

## Decision

1. **Read only, on the server.** The server holds the key (Railway:
   `CURRENT_CMS_KEY`, the name Colly saved it under, or
   `CURRENT_RMS_API_KEY`; the subdomain is `sessionhire` unless
   `CURRENT_RMS_SUBDOMAIN` says otherwise). The client in
   `server/src/rms/api.ts` has one way to ask, a GET; there is nothing that
   could change Current RMS. The key goes in a header, never the address,
   and no device is sent it.
2. **A copy of every opportunity and its lines**, kept by Current RMS's own
   ids in three tables of their own (`rms_opportunities`, `rms_lines`,
   `rms_reads`): the number, subject, client and venue by name, state and
   status, dates, totals, chargeable days, the client's discount and price
   category there; and for each line its group, product or service, how
   many, price, discount, chargeable days, rate definition, total and VAT,
   and whether it was subhired. Money in cents, as everywhere. No contacts
   are kept, only organisations' names.
3. **A read runs in the background from Admin** ("Bring in from Current
   RMS"), one request at a time a little over a second apart, waiting out
   any "too many" for as long as Current RMS says. It says how far it's got
   and can be stopped; what was read stays. A second read lists every
   opportunity again but reads the lines only of those Current RMS says
   changed, so it takes minutes, not the half hour of the first.
4. **For the office and directors only.** It's all prices, so reading it
   needs `money`, and starting or stopping a read needs `settings` too.
   The copy is never put in the change feed or on any phone: the server
   answers the pages from it, so they need signal.
5. **What came in, to read and to hand on.** Jobs › Money › Past quotes
   (`#jobs/money/current-rms`) lists every opportunity newest first, found
   by number, job, client or venue, each with its lines as Current RMS had
   them. Admin downloads it as two spreadsheets, opportunities and lines,
   to look at in Excel or to send for the quoting engine's design.

## Considered

- **CSV exports only.** Kept as a way in (ADR 0056), but by hand, several
  files at a time, and out of date as soon as they're made.
- **Writing quotes back to Current RMS**, so the office could switch over
  slowly. Rejected for now: the app would be changing a system the office
  relies on, and the standing rule is that the app touches nothing outside
  it until Colly says otherwise.
- **Putting the history on every device** like the rest of the app. A
  thousand opportunities and their lines is a lot to hold on a phone, and
  it's money, which most roles aren't sent (ADR 0042).
- **A nightly read.** Not yet: a read from Admin does for shaping the
  quoting engine. It can run each night later if the two are kept side by
  side for a while.

## Consequences

- Three new tables, backed up and in Download everything.
- Admin shows a Current RMS card to the office and directors; without the
  key it says it isn't connected.
- The first read on the live app takes about as many seconds as there are
  opportunities, plus one for every 25.

## Open

- **Matching past opportunities to the app's jobs and clients** (part 4 of
  the quoting plan): not yet; they stand on their own.
- **Products, rates and stock** could come through the API too, in place of
  ADR 0056's files; not yet.
- **Current RMS's own field names were taken from its documentation**
  (`api.current-rms.com/doc`), not from the office's data; the first real
  read will show anything that differs.
