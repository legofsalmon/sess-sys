# ADR 0042: Quotes, prices and a money view

- **Status:** accepted
- **Date:** 17 October 2026
- **Asked for by:** Colly, 17 October 2026 (picked "A price list, quotes
  built from a job's kit and crew as a PDF you download, then a dashboard
  of quoted, confirmed and owed by month and an export for the
  accountant. It stays a viewer and exporter. Nothing gets sent to
  clients.")

## Context

Phase 4 of the [roadmap](../roadmap.md) is light finance. Until now the
app held no money but crew day rates and timesheets (ADR 0022). Quotes
were typed in a spreadsheet from the job's kit and crew, so the same job
was keyed twice, and the director had no view of what was quoted,
confirmed or owed (the [personas](../personas.md) rated "No money
anywhere" a 2 for the director).

Bookkeeping stays with the accountant. The decision recorded in the
roadmap is a dashboard and exports first, and no accounting connector
unless the business grows into one. The owner's standing rule also
applies: the app sends nothing to anyone. Anything that would go to a
client is a download that a person sends.

## Decision

1. **A price list.** Each product can have a day price, each crew role a
   day price to the client, and each client a usual discount. These are
   three small tables (`product_prices`, `role_prices`,
   `client_discounts`) changed by `price.product`, `price.role` and
   `price.client`. Clearing a value takes it off the list. A role is
   matched by its name, ignoring case and spaces, as calls name it. A
   role with no price is quoted at the rate its crew were asked for at.
   A product with no price goes on a quote at nothing, so the office
   sees it and prices it there, rather than the line silently dropping.
2. **A quote is a job's, built from its kit and crew.** "Build it from
   the job" makes a line for each kit line (how many, for the days it's
   out) and each open crew call (how many needed, for its days), at the
   price list's prices and the standard VAT rate, with the client's
   usual discount. Every line can then be changed, removed or added to:
   what it says, how many, the days charged (in halves), the price a day,
   and its VAT rate. Irish VAT is 23%, with 13.5% and 0% available per
   line. The multi-day rule is the days charged on each line, which can
   be set for all the kit at once ("a week's hire charged as three
   days"). Totals take the discount off each rate's lines and work the
   VAT out on what's left, each to the cent, so the totals always add up.
3. **Versions keep what went to the client.** A job has one draft at a
   time. Only a draft changes (`quote.save`). Marking it sent
   (`quote.sent`, with the day) freezes it, and any change after is a new
   version numbered after the last. Older versions stay readable on the
   quote page.
4. **The quote is a printed A4 page, saved as a PDF from the browser**,
   the way call sheets print (ADR 0021). The app emails nothing. The
   office sends the PDF itself, then records what happened as it happens:
   the client's answer (`quote.answer`, accepted or turned down, with the
   day), the invoice (`quote.invoiced`, with the day and the invoice
   number the office's own system gave it) and the payment
   (`quote.paid`). Each record can be taken back, in the opposite order.
   They go on the job's **current** quote: the invoiced one, or else the
   newest one that has gone out. Once a quote is invoiced the job is
   settled, and no new version can be started.
5. **Costs and margin from approved timesheets.** A freelancer's approved
   timesheet is a cost to the job it's for. The office marks it paid with
   a day (`cost.paid`). While it's marked paid, the timesheet can't be
   reopened, so the paid figure can't change under it. A job's margin is
   its current quote before VAT, less its freelancers' approved
   timesheets and those booked and still to come at their booked days
   and rate.
6. **The money view**, for the director and the office. By month (by
   the month each job starts) it shows what's quoted, confirmed
   (accepted) and invoiced, before VAT, with freelancer costs by the
   month of their last day. It also shows who owes, with VAT, as
   invoiced (accepted quotes not marked paid, by client), freelancers
   owed (approved, not marked paid) and the margin for each job. All of
   it is worked out on the device from its own copy, with the person's
   own waiting changes laid over it, so it works with no signal like the
   rest of the app.
7. **Files for the accountant**, made on the device for a period
   (Revenue's two-month VAT periods, or a year). There are three: the
   invoices, a row for each VAT rate on each, by the day invoiced; VAT by
   period and rate, with a total for each period; and freelancers'
   approved timesheets, by the day approved, with who they trade as and
   their VAT number. These are CSV files Excel opens with Irish names
   intact and nothing run as a formula. The five new tables are in
   Download everything too.

### Who sees money (ADR 0034)

ADR 0034 decided that roles narrow what a person can change, not what
they read, and left narrowing reading open as "the next piece of this
work". Money is where that piece starts.

8. **A new ability, `money`: see and change prices, quotes and what is
   owed.** It goes to the office and directors only. Heads of department,
   the warehouse and staff crew have no use for the company's margins,
   and on a shared warehouse phone they would be on show.
9. **The server doesn't send money to a role without it.** The change
   feed leaves out the five money tables for such a device. Its cursor
   still moves past those changes, and the answer says `money: false`.
   A device told it can no longer see money clears what it held. A device
   given money later reads its copy again from the start, for the
   changes it was never sent. Every command is checked on the server as
   ADR 0034 set out. With roles off, or sign-in off, everyone sees
   everything, as before.
10. **The history says what was done without the amounts** ("Set the day
    price of d&b Y10P", "Recorded that the client accepted version 2 of
    the quote for Autumn Gala"). It stays readable by all staff, as
    before.

### Where it lives (ADR 0041)

11. **A job's quote is on the job: `#jobs/<id>/quote`.** The job page
    has a Quote card after its kit and crew, since that's what the quote
    is built from. The card gives the version, the figure before VAT,
    where it's got to and the margin, with one link to the quote. The
    breadcrumbs read Jobs › Autumn Gala › Quote.
12. **Money is a page along Jobs' row: `#jobs/money`**, after Clients and
    Venues, and only for the roles that see money. The director's
    question about money is a question about jobs (what's quoted,
    confirmed, invoiced and owed, job by job and client by client), and
    the director already looks along Jobs' row for the planner and the
    clients. Like the other pages along a row, it has no way up. The
    price list sits beneath it at `#jobs/money/prices` (Jobs › Money ›
    Price list). The Menu names Money under Jobs, for the same roles.
    Home's "whole company" view gets a short Money card for those roles,
    so the director's glance includes it.

## Considered

- **A Money area of its own in the bar.** Rejected. The bar keeps the
  places used all day (ADR 0035), and money is a weekly look for two
  roles. A sixth tab would push one of the five off a phone for
  everyone.
- **Money under Admin.** Rejected. Admin is settings (ADR 0041), and
  money is the state of the business, not a setting.
- **Hiding money on the device but sending it to everyone.** Rejected.
  Every device holds its copy in the browser's storage, so a warehouse
  phone would carry every margin. Narrowing the feed is what ADR 0034
  said the fix would be.
- **Emailing the quote from the app, or an online accept page.** Not
  now. The owner's standing rule is that the app contacts nobody. A
  client page to accept online stays on the roadmap, behind that rule.
- **Invoices, deposits and credit notes made in the app.** Not now. The
  office's accounts package makes the invoice, and the app records that
  it was made, its number and its day. That keeps one source for the
  invoice and leaves Revenue's numbering rules to the package.
- **A days-charged figure on the job itself.** Rejected in favour of days
  on each line, set for all the kit at once. Crew are charged for the
  days they work, which a job-wide figure would get wrong.

## Consequences

- Prices, quotes, discounts and freelancer payments are five new tables
  in the finance module (`server/src/finance`), in the backups and
  Download everything. Made-up data has a price list, a discount and
  quotes at each stage.
- A role change that gives or takes away money makes that person's
  devices start or drop money at their next sync, with nothing for them
  to do.
- A timesheet marked paid stays approved until the payment is taken back.
- Booking rates on offers and timesheets were still read by every role.
  They're crew's own pay, not the company's prices, and narrowing them
  was the rest of ADR 0034's reading work. It came in
  [ADR 0046](0046-departments-on-calls-and-what-each-role-reads.md),
  which leaves the fields out of records rather than the tables out.
- The quote prints the office's phone and email from Admin, and nothing
  else about the company.

## Open

- **No VAT number, address or terms on the printed quote.** The office
  details (Admin) have no field for them yet. Until then they go in the
  quote's notes. Rated 2: the PDF is a quote, not an invoice, so Revenue's
  invoice rules don't apply to it.
- **Quotes have no number of their own.** They're known by job and
  version, and the invoice number is the office's own system's.
- **Subhire and staff costs aren't in the margin.** Subhire has no cost
  field yet (ADR 0014), and staff are paid through payroll.
- **No overdue flag on what's owed.** There are no payment terms to count
  from yet. Owed is listed most first, with the day each was invoiced.
