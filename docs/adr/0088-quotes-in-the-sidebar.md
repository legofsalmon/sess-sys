# ADR 0088: Quotes, a place of its own

- **Status:** accepted
- **Date:** 28 October 2026
- **Asked for by:** Colly: "I'm starting on a quotes section down the left
  side of the site" (28 October 2026).
- **Builds on:** [ADR 0036](0036-desk-layout-sidebar-and-dark-by-default.md)
  (the desk sidebar), [ADR 0035](0035-the-menu-and-you.md) (the Menu),
  [ADR 0042](0042-quotes-prices-and-a-money-view.md) (quotes and Money),
  [ADR 0081](0081-starting-a-quote-and-following-it-up.md) (quotes to follow
  up).

## Context

Quotes had no place of their own. Each lived on its job's page, and the
quotes waiting on the office were a card at the top of Jobs › Money, under
the director's figures. Finding last month's quote for a client meant
knowing the job, and the office, who quote all day, went through Money to
get to them. With the quoting engine built (ADRs 0080 to 0087), quoting is
a daily job of its own.

## Decision

1. **Quotes is a sixth place in the desk sidebar**, after Jobs, at
   `#quotes`, for those who see money (the office, directors and system
   admins). Others don't see it, and the address tells them it's for the
   office.
2. **On a phone the bar keeps its five.** The design system's navigation
   puts two to five places in a phone's bar, so Quotes is on the Menu, under
   Jobs, beside Money, and lights the Menu's tab while it's open, as Admin
   does.
3. **The page has two parts.** "To follow up" (moved from Money, as it was:
   New quote, answered but not in step, waiting for an answer, not sent) and
   "All quotes": each job's quote, the last changed first, to find by job,
   client, venue, quote number or invoice number, and narrow to Not sent,
   Sent, Accepted (invoiced and paid count) or Turned down. The last thirty
   until Show all; a search looks through them all.
4. **A row opens the job's quote** (`#jobs/<id>/quote`), where it's changed.
   The page only finds them. A job with a new version being drafted over a
   sent one shows the draft, and says what happened to the one before.
5. **Money keeps the figures** and links to Quotes. The price list and Past
   quotes from Current RMS keep their addresses under Money and are linked
   from Quotes.

## Consequences

- The office has one place to start a quote, chase one and find an old one.
- On a desk a top-level place shows only to some roles, so the sidebar is
  six for the office and five for crew.
- Quotes has no Up: it's a top-level place. On a phone the Menu's tab is the
  way back to the Menu.
