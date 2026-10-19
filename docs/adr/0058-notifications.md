# ADR 0058: Notifications

- **Status:** accepted
- **Date:** 19 October 2026
- **Asked for by:** Colly, 19 October 2026 ("Can you add a notification
  centre to the app - something that fires toast messages when something
  updates for something the person is associated with.")

## Context

Crew and the office found out that a job they were on had moved, that an
offer they sent had been answered, or that their leave had been decided,
only by opening the right screen and noticing. The app already keeps every
change anyone makes, who made it and when, in words (the history,
[ADR 0006](0006-audit-trail-and-export.md)), and every device is poked the
moment anything changes ([ADR 0001](0001-sync-engine.md)).

Colly's standing rule since the real calendars came in is that the app
contacts nobody outside it until Colly says so
([ADR 0048](0048-messages-to-crew-off-until-said.md)).

## Decision

**A list, a bell and pop-ups, in the app only.** Nothing is emailed,
texted or pushed to a phone; the notifications are there when the app is
open.

- **What's someone's own.** Read on the server from what it holds now,
  nearest them first:
  - *About you*: their record on the Crew tab, their offers and bookings,
    the timesheets for them, their leave, days in lieu and allowance, days
    marked off, their documents, and the vans they're down to drive;
  - *An offer you sent*: so a freelancer's answer, on their link or in
    Google Calendar, comes back to whoever sent it;
  - *A job you're on*: as crew on a live offer, the contact on the day for
    a phase, or a driver; the job, its phases and its calls;
  - *A job you made* in the app, with the offers on it.

  The account is matched to its person on the Crew tab by email, as roles
  are ([ADR 0034](0034-roles-and-what-each-can-change.md)); one with no
  match has only the jobs it made and the offers it sent, and the list
  says so. With nobody signed in (a demo copy, or sign-in off) the device
  stands in for the person.
- **The list is the history, narrowed.** `GET /api/notices` reads the
  history for changes in the last 30 days that touched those records, by
  anyone but them (on any of their devices, their link or their calendar),
  at most 100, in the History tab's words and without crew pay for a role
  that doesn't read it ([ADR 0046](0046-departments-on-calls-and-what-each-role-reads.md)).
  Noting an answer (`offer.seen`) is housekeeping and left out. Nothing new
  is kept about the changes; one small table, `notices_read`, keeps how far
  each account has read, so the count is the same on the phone and at the
  desk, and never goes back for a slower device.
- **The bell**, top right on every screen before dark and light, counts
  what's new in the accent, the colour of things waiting for you, and says
  it in words to a screen reader ("Notifications, 3 new"). It opens
  **Notifications** (`#notifications`, also in the Menu under You): each
  change under the day it reached the server, with who made it, why it's
  theirs and when, linking to the job, the person, Leave or Timesheets.
  Opening the list reads it; what was new as it opened stays marked
  "New", in words beside a dot.
- **Pop-ups** come from the device looking again each time its copy moves
  on, which the server's poke sets off within a second or two of anyone's
  change. Only what arrives while the app is open pops up: a backlog is
  counted on the bell instead, and a job someone has just been put on
  doesn't pop up its past. Each is the design system's toast in its
  toaster: at the bottom corner, above the phone's bar, one action (Open)
  and Dismiss, leaving after `timing.notice`, and waiting while the
  pointer or the keyboard is on it. More than two arriving together are
  one pop-up that counts them and opens the list. A switch on the list
  turns pop-ups off on that device; the list and the bell stay. Nothing
  pops up while the list itself is open.

## Consequences

- The list needs signal, as the History tab does; with none it says so,
  and the bell keeps the last count.
- "Associated" is worked out from today's records: put on a job, a person
  sees its last 30 days in the list (not as pop-ups); taken off, those
  changes leave it.
- Freelancers on their private links don't have the app, so they get no
  notifications; their link page already shows what's theirs.
- Push to a phone with the app shut, or email, would need Colly's say
  first (the standing rule) and a service worker or a mail sender; both are
  left out.
- The design system gained the `notifications` icon (0.5.1). A list of
  notifications is a part it doesn't have yet, sent back as a learning.
