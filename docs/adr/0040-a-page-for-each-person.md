# ADR 0040: A page for each person

- **Status:** accepted
- **Date:** 16 October 2026
- **Asked for by:** Colly, 16 October 2026 ("Can we make individual pages
  for crew please?")

## Context

Everything about a person was already kept (ADR 0025 onwards): contact,
department, level, role, certificates, documents, what they've worked,
bookings, days off and their private link. All of it opened in place, as
one long fold inside the People list on Crew: a row's detail held two
forms, three rows of buttons and a document list, so the list jumped
about as rows opened, a person couldn't be linked to, and nothing else in
the app could take you to someone. Venues and clients got pages of their
own for the same reason (ADR 0032).

## Decision

1. **A person has a page at `#crew/person/<id>`**, under the Crew tab
   (which stays lit) with "‹ Crew" back, like a timesheet's page.
2. **The page is cards in order of use:** who they are (their picture,
   name, kind or role, department and level, then Call, WhatsApp and
   Email, and the details kept, level, role and Change details); Coming
   up (bookings and offers waiting on them, each opening its job, days
   off, Mark days off behind its button, and Archive); Certificates and
   documents; Worked (every job, the first ten and the rest a tap away,
   each opening its job); and Their link (open, copy, calendar address,
   new link).
3. **The People list is one line each**, the person's picture, name and
   who they are, and the line opens their page. Nothing opens in place
   any more.
4. **Names open the page wherever a person is listed by name as a link
   target:** the offers on a call card and a person's lane in the
   planner.
5. **Archive stays one tap**, as it was: it goes back to the list, which
   says who was archived with "Bring … back" (rule 10). Archived people
   keep their page, read-only, and are still erased from the Archived
   list (ADR 0027).
6. **Call, WhatsApp and Email are links the office taps**: the app still
   sends nothing itself.

## Consequences

- A person can be linked to from anywhere (Home, a call sheet, a
  timesheet) with `personHref(id)` from `web/src/crew/PersonScreen.tsx`.
- Roles (ADR 0034) work as before: a role without `crew` sees the page
  with nothing to change, and Their link is hidden from it.
- The People list no longer shows bookings and days off in detail; its
  line still counts them.
