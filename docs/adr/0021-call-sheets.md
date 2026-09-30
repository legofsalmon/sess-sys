# ADR 0021: Call sheets

- **Status:** Accepted, 30 September 2026. The first part of Phase 3 built
  after crew booking.
- **Decides:** what a job's call sheet holds, who sees which parts of it,
  how it reaches crew who don't use the app, and the one thing it needs
  that the app didn't already hold.

## Context

A call sheet is the day sheet crew work from: where to be and when, who
else is on, who to ring, and what's happening through the day. Today it's
the Google Calendar event's description when someone fills it in
([research/current-process.md](../research/current-process.md)): a run of
show, access notes and sometimes a kit list, all as typed. Most events
have none.

Nearly everything it needs is in the app already: each job's phases and
days, the venue with its address and notes on access and parking, crew
asked for from the phase with call times and details, who said yes, the
kit, and the client. What's missing is who crew ring on the day.

The architecture sets who sees what ("What lives on the device"): a crew
chief on a job gets the crew list with phone numbers and the kit list; a
freelancer gets their own bookings, call times and venue details, and
never other crew's rates or personal details. Most crew are freelancers
without the app, so their sheet has to reach them like their offers do:
a link that works with no app and no login
([ADR 0002](0002-crew-booking-links.md)).

## Decision

- **A call sheet is per phase:** the job, the phase's days, the venue
  with a map link and its notes, the running order, who's on for each
  crew call with its call time and details, and the contact on the day.
  It's worked out from what the app holds, not typed again.
- **The running order is the phase's notes,** and the job's notes are
  shown too. Both already go on the calendar events crew are invited to
  ([ADR 0008](0008-calendar-sync.md)), so nothing new is made public. The
  venue's notes are its access, load-in, power and parking.
- **The contact on the day is the one new thing:** a person picked for
  each phase, from anyone in the app, staff or freelancer. Their name and
  number go on everyone's sheet for the phase. It's kept on the phase and
  in the history like any change.
- **Three readers, one set of rules,** worked out in one place for the app
  and the link page alike:
  - **the office**, in the app: everyone asked, including who's only been
    offered and places still to find, with their numbers; the client's
    contacts; and the phase's kit with the whole job's;
  - **the contact on the day**, on their private link: everyone who has
    said yes, with their numbers, and the kit, as a crew chief needs; not
    who's only been offered, nor the client's contacts;
  - **everyone else**, on their private link: who else is on, by name and
    role, only once the office has confirmed them; and the contact's
    number. Never another person's number or rate, and never the kit.
- **In the app** it's a page from each phase on the job's page, at
  #jobs/‹job›/sheet/‹phase›, which works with no signal like the rest of
  the app. From it the office picks the contact on the day, sends each
  person who has said yes a link to their own sheet by WhatsApp, text or
  email, copies a version for a crew's WhatsApp group (with no number but
  the contact's), and prints it on A4. On paper, where there's nowhere to
  say who's only been offered, only those who've said yes are listed, and
  it says it's the office's copy.
- **On a freelancer's private link** each booking they've accepted, or
  are confirmed on, has its call sheet, at /f/‹link›/sheet/‹call›: plain
  HTML with no app, login or script, like the rest of their page. A call
  they were only offered, someone else's call, or a cancelled one shows no
  sheet. It's read fresh each time it's opened, so it's never out of date.

## Consequences

- A crew member has everything for the day on one page from the link they
  already have, and the office stops typing it into event descriptions.
- The calendar events don't show the contact on the day yet. Adding it to
  their description rewrites every event once; it can come with the next
  change to the calendar sync.
- A sheet opened on a freelancer's phone is the page as it was then:
  with no signal on site it shows only if the phone kept it. Saving it,
  or the office's printout, covers a dead spot for now.
- A sheet on a private link comes with a booking, so a contact on the
  day who isn't booked on the phase, such as someone in the office, has
  theirs in the app. Booking the crew chief as a crew call puts it on
  their link too.
- The contact on the day is per phase, so a job with a different lead for
  the build and the show can say so; a job with the same lead picks them
  for each phase.
- Client contacts stay on the office's sheet. If crew need the client's
  producer on the day, the office can make them the contact, or put them
  in the phase's notes.
