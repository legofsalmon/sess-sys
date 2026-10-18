# ADR 0054: Charts on Home

- **Status:** accepted
- **Date:** 18 October 2026
- **Asked for by:** Colly, 18 October 2026 ("Can you add some more visuals
  and graphs to the dashboard?")

## Context

Home ([ADR 0033](0033-home-and-finding-your-way-around.md)) said how things
stand as counts and lists: what needs attention, today, the week ahead.
With the real calendars in (over 900 jobs, 91 people) the shape of the
weeks and months ahead, how crew are booked day by day and how much kit is
out, could only be read by opening Jobs, Crew or Stock and counting.

## Decision

Home draws column charts, each for the view it belongs to:

| View | Chart | Columns | Parts, bottom up |
|---|---|---|---|
| Company | Jobs by week | this week and seven more | confirmed, not yet decided |
| Company, Department | Crew, the next fortnight | each day from today | booked, waiting to confirm, still needed |
| Company | The season | six months back to five ahead | confirmed, not yet decided |
| Company (money ability) | Money | three months back to two ahead | confirmed, still a quote (before VAT) |
| Warehouse, Department with kit | Kit booked out, the next fortnight | each day from today | items for confirmed jobs, pencilled in |
| Me | Your weeks | this week and seven more | days confirmed, waiting to confirm |

Jobs counts gigs and hires only: errands and meetings fill a calendar,
not a week. A department narrows crew by a call's department
([ADR 0046](0046-departments-on-calls-and-what-each-role-reads.md)) and kit by the stock
department that matches. Money stays behind the money ability
([ADR 0034](0034-roles-and-what-each-can-change.md)).

How they are drawn:

- **Colour is the shared grammar, not a palette.** Settled is plain ink,
  not yet settled a lighter grey, and only crew still needed is amber, the
  attention colour; a fully booked fortnight is quiet. No new hues, so
  nothing in a chart can be read as "you" (red) or as a status it isn't.
  Checked with the data-visualisation validator in both themes: the
  three marks are 15 or more apart for colour-blind eyes and 3:1 against
  the card. Under forced colours they use the system's own.
- **HTML, not a chart library.** Each column is a button, so it is light
  on a phone and a finger, a pointer, the keyboard (one tab stop, arrows
  move along) and a screen reader all reach it. The line above the chart
  says the column picked in words ("Today: 2 booked, 3 still needed");
  it starts on the column today is in.
- **Marks as the system draws data:** columns no wider than 24px with a
  rounded top, a 2px gap between parts, one hairline at the top of the
  scale and one along the baseline, the largest value as the scale's only
  number, and a key under every chart of two or more parts.
- A chart with nothing in any column says so in a sentence instead.

The series are worked out in `shared/src/sync/home-charts.ts` from this
device's own copy, so they draw with no signal, as the rest of Home does.

## Consequences

- Home is longer; the "On this screen" strip names each chart, a tap away.
- "This week" counts the whole week, Monday on, days gone included, so it
  reads as the calendar shows it.
- The design system has no chart guidance; this is sent back as a gap.
