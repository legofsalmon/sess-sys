# ADR 0035: The Menu, and You

- **Status:** accepted
- **Date:** 11 October 2026
- **Asked for by:** Colly, 11 October 2026

## Context

After ADR 0033 the bar was Home, Jobs, Stock, Crew and Admin. Colly said
the bar held places that didn't need to be a tap away, and asked for one
menu that shows the whole app, with History and the account in it, and a
page of a person's own settings and details.

Admin was the only place in the bar that nobody used all day: the
company's settings, opened now and then. It also held a person's own
things (who they're signed in as, signing out, their own calendar feed,
their role since ADR 0034), so a crew member opened "Admin" to sign out.
The places inside each area (the planner, bringing jobs in, labels,
counts, PAT tests, leave) could only be found by knowing the screen they
hang off.

## Decision

1. **The bar is Home, Jobs, Stock, Crew and Menu.** The four places used
   all day stay a tap away, and the Menu takes Admin's slot. Five stays
   the most a phone's bar holds with a word under each picture.
2. **The Menu (#menu) names every place, grouped as the work is:** Jobs
   (Jobs, Planner, Bring in from Google Calendar), Stock (Stock, Labels,
   Counting, PAT tests), Crew (Crew, Leave), Company (Admin, History) and
   You. Each place is a row with a line saying what's there. It's a
   screen rather than a sheet over the page, so the browser's back works
   and nothing has to trap focus.
3. **You (#me) holds what is a person's own:** their role, who they're
   signed in as and signing out, their own bookings' calendar feed, and
   this device's sync state.
4. **Admin keeps the company's settings** at its old address (#account),
   so links and bookmarks still land. History moved off it into the Menu.
   Admin, History and You keep the Menu's tab lit and have "‹ Menu".
5. **Roles decide what's listed, not the screens.** Everyone reads
   everything (ADR 0034), so a place leaves the Menu only when it is for
   changes the role can't make: Admin needs `settings` or `company`, and
   bringing jobs in needs `jobs`. Each place carries the abilities it
   needs, checked with the same `useAccess().can` the screens use.

## Consequences

- A crew member signs out from You, never from Admin.
- A new place is one row in `MENU` (web/src/MenuScreen.tsx).
- Admin is one tap further away for the office and directors, who open it
  rarely.
