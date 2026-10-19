# ADR 0059: A job's page in parts, with the whole width

- **Status:** accepted
- **Date:** 19 October 2026
- **Asked for by:** Colly, 19 October 2026

## Context

Colly asked for the job page to be tidied and split up so it is easier to
look at and manage, and for the list of coming-up jobs down the left to go
when a single job is open, as it took too much room.

A job's page had grown one card at a time: its details, its phases with
every crew call inside them, kit, vans, crew across phases with Ask for
crew, the show pack and the quote, all down one page. On a desk it sat in
the right three-fifths of the window, beside the list (audit finding 25),
so a job with a few phases and a full kit list was a long scroll in a
narrow column.

The design system's navigation page says a second question is a second
view, tab or pane, and that tabs are for two to six peer views of one
thing, never nested ([navigation.md](https://github.com/legofsalmon/design-system/blob/main/docs/navigation.md#chunking-a-screen)).

## Decision

1. **A job is a page of its own on a desk too.** The jobs list stays beside
   the rest of the Jobs tab (its search, New job, the nudges), but opening
   a job gives it the whole width. The way up in the bar (ADR 0039: Jobs ›
   the job) goes back to the list. Stock keeps its list beside a record.
2. **The job's details stay on top**: name, status, client, venue, when,
   crew and kit at a glance, notes, Change details. People to tell after a
   job is stopped or a phase moved open under them, whichever part is open.
3. **Under them, its parts as tabs**, one at a time: **Phases**, **Crew**,
   **Kit and vans**, **Show pack**, and **Quote** for the roles that see
   money. Phases carries its count and Crew "booked/needed".
4. **Crew calls move from inside the phases to Crew**, a card per phase
   with calls, then Across phases, then More crew with Ask for crew. Each
   phase on Phases says "Crew: 2 of 4 booked", a tap to Crew. An offer
   being sent opens under the card of the call it is for.
5. **The part is in the address** (`#jobs/<id>/crew`, `/phases`, `/kit`,
   `/pack`, `/money`) without a step in the history, so a reload keeps it
   and Back still goes up to the list. With no part named, the page opens
   on the one last looked at on this device (`sh.jobPart`), so the office
   going job to job to book crew lands on Crew each time; first time,
   Phases.
6. Tabs follow the system's: one Tab stop, Left and Right move and open,
   Home and End go to the ends, the open one underlined in the accent.

## Consequences

- A new part of a job is a tab, not another card down the page; past six
  it is time to rethink the parts.
- Links that mean a part go to it: a crew call's job from Crew and a
  person's page go to its Crew.
- Ctrl+F only finds what is in the open part (accepted, as with the
  windowed lists of ADR 0050).
- Tests that use a job's crew, kit, show pack or quote open its tab first.
