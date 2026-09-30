# ADR 0002: Freelancers answer offers from a private link, not an app

- **Status:** Accepted, 29 September 2026. Built early, in parallel with Phase 0 and 1, so crew booking can be tried alongside the calendar.
- **Decides:** how the "meet freelancers in the middle" principle in [architecture.md](../architecture.md) works for offers and bookings.
- **Amended:** 30 September 2026 by [ADR 0012](0012-personal-calendar-feeds.md): the calendar feed has a read-only address of its own, and its events no longer carry the private link.

## Context

Most of Session Hire's 100+ crew are freelancers who also work for other
companies. Rentman and TeamTrack make them install an app and keep a profile
per company, which they find cumbersome. Offers today are Google Calendar
invites with little detail, and "yes" is an RSVP. We need offers with full
details, part-acceptance of multi-day jobs and rate counters, without asking
freelancers to sign up for anything.

## Decision

- **Every person gets a private link** (`/f/<secret>`), made by the server.
  Holding the link is the whole credential: no account, password or code.
  Ops can replace it at any time and the old one stops working.
- **The link page is plain server-rendered HTML with ordinary forms.** No
  JavaScript, so it opens instantly in WhatsApp's, Gmail's or any phone's
  browser. It shows every offer with role, dates, call time, venue (with a
  map link), rate and details; answers are Accept (all or some days),
  Decline, or "ask for a different rate" with a note. It also lets the
  freelancer mark days they can't work, subscribe to their bookings as a
  calendar feed (Google, Apple, Outlook), and download everything held on
  them.
- **Ops send the offer themselves** from the crew screen: the app writes the
  message (all the details plus the link) and opens WhatsApp, the phone's
  texting app or email with it filled in. Nothing is sent on Session Hire's
  behalf yet, so there are no messaging accounts, costs or deliverability to
  manage. Automatic sending (SMS/WhatsApp Business, email) can be added later
  behind the same message.
- **Answers are commands like everything else.** The link's form posts run
  through the same server handlers as the app, so the same rules hold
  whichever way an answer arrives:
  - nobody holds two jobs on the same day;
  - a job never gets more people on a day than it needs; with a shortlist the
    first to accept gets the place, and everyone else's offer changes to
    "filled" so a late "yes" gets a clear answer;
  - an offer for a day someone marked off, or already holds, is refused
    unless ops tick "offer anyway", which is kept on the offer.
- **Ops confirm.** "Accepted" means the freelancer said yes; "confirmed" is
  the booking. A counter-offer becomes a booking only when ops agree it.
- **Crew tables are their own module** (`server/src/crew`, `shared/src/crew.ts`)
  with their own migration counter, so crew and the core can change in
  parallel. Jobs are plain text (project, phase, venue) until the Phase 1
  project model lands; then a crew call points at a project phase.

## Consequences

- A leaked link lets someone answer as that person. Mitigations: long random
  secrets, `no-store` and `noindex` on every page, no other crew's details on
  the page, and a one-tap "New link" for ops. If this proves too weak, a
  one-time code by text can be added to the answer step without changing the
  flow.
- Until staff sign-in lands (Phase 0), the ops crew screen, like the rest of
  the test app, is open to anyone with the app URL. It must not hold real
  freelancer data until sign-in is in.
- Calendar RSVPs are not yet read back. When Phase 1's two-way sync is live,
  a Google RSVP becomes one more way to send `offer.respond` (`respondedVia:
  'calendar'`), and a confirmed offer adds the person as an attendee on the
  Session Hire Gigs event.
- Reading freelancers' own free/busy (Google, Outlook or iCal) is a later
  step; days off are marked by the freelancer on their link or by ops for now.
