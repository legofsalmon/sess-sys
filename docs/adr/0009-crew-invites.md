# ADR 0009: Crew invites on the calendar, and their answers

- **Status:** Accepted, 30 September 2026. The third part of Phase 1.
  Built behind a switch on the Account tab that starts off, since each
  invite is an email to a freelancer. Colly was asked on 30 September
  whether invites go out when crew are offered a job or once they are
  booked, and answered on 1 October: with the offer, and accepting the
  invite in Google Calendar is one acceptable way of agreeing to the job.
  That is what's built; the switch stays off until the Google key is in.
- **Decides:** who gets a Google Calendar invite to a job's days, from
  whom and when, and what their Yes or No in Google does in the app.

## Context

Today the invite is the offer: ops add crew as guests on each day's
event, and "Accepted" means the person is on the job
([current process](../research/current-process.md)). The app now writes
those events itself ([ADR 0008](0008-calendar-sync.md)), without guests,
and offers go out through each freelancer's private link
([ADR 0002](0002-crew-booking-links.md)). For crew to see no change, the
app has to put them on the events it writes and take their answers back,
without anyone answering twice.

Most freelancers use personal Gmail, Outlook, iCloud or GMX calendars.
Google updates the events in Google calendars directly, but other
calendars only hear about an event, a change or a cancellation by email.

## Decision

- **Invites go out with the offer.** With the switch on, a person offered
  a place on a confirmed job, who has an email address in the app, is a
  guest on each of the job's events on the days offered, from today on.
  Enquiries and quotes have no events, so their offers wait until the job
  is confirmed. The private link still works; either answer counts.
- **Their answer in Google counts, as on their link.** A Yes to any day
  is a yes to the offer, for all its days except any they said No to. A
  No to a day means not that day; a No to every day declines. Tentative
  ("Maybe") is not an answer yet. The same rules as the link hold: the
  first to say yes gets the place, nobody is booked on two jobs on one
  day, and the office still confirms. Each answer goes in the history as
  the freelancer's, on Google Calendar.
- **Once the office has confirmed, Google can't undo it.** The link says
  "contact the office" in that case; here, a No in Google to a booked day
  is shown on the job page for the office to act on, and the booking
  stands until they do. Counter-offers wait for the office the same way.
- **Guests follow the offers.** Someone whose place is filled by someone
  else, or whose offer is withdrawn, is taken off the events, and Google
  tells them. Someone who took only some days on their link comes off the
  other days. Someone who said No in Google stays on as a No, so they
  aren't sent a cancellation for something they turned down.
- **Emails only when they matter.** Adding or removing a guest, and a
  change to the title, date or place, are sent to guests; a change to
  the description alone (the crew list, the notes) is not, since those
  change often. Deleting an event with guests tells them it's cancelled.
- **Guests can't see each other's addresses, or invite others.** The
  description names the crew for the day already; personal email
  addresses stay between each freelancer and the office.
- **Other guests are left alone.** Anyone added to an event by hand in
  Google, such as a client or a supplier, stays on it when the app
  updates the event; the app reads the event before changing it, so
  nothing added in the meantime is lost. This also holds with the switch
  off.
- **Answers are read by asking Google, not the database.** Every two
  minutes the server asks Google which of the app's events have changed.
  Only when an answer has actually changed does it touch the database, so
  the database still sleeps when nobody is working. The nightly check
  looks at every event as well, in case anything was missed, for example
  while the server was restarting.
- **Turning the switch off stops everything at once.** Nothing more is
  sent and no more answers are read. People already invited keep their
  invites as they are; the app stops changing their guest lists.
  Disconnecting the calendar turns it off too, so connecting again starts
  with invites off.
- **Turning it on says what it will send.** The Account tab counts the
  invites and people first ("12 invites to 5 people"), since everyone
  already offered or booked from today on is invited straight away.

## Consequences

- Invites come from the account connected on the Account tab. It should
  be one crew already get invites from (the ops account), so the events
  land straight in their calendars: Google holds back invites from
  unknown senders for some people until they answer the email.
- The connected account gets Google's own "Aoife accepted" emails, as the
  ops staff do today. They can be turned off in that account's Google
  Calendar settings.
- The switch should be tried on the test calendar with staff's own
  addresses first, to see the emails as a freelancer would, before Session
  Hire Gigs.
- A No in Google to a confirmed booking needs a person: the office
  phones the freelancer and withdraws the offer or finds cover. Changing
  part of a confirmed booking in the app is later work.
- Google limits how many invites an account sends in a day; Session
  Hire's volume is far below it.
- Push notifications from Google would make answers arrive within
  seconds instead of minutes, at the cost of a public address Google
  calls and renewing the watch every week. Two minutes is enough for crew
  bookings; it can be revisited with calendar-led jobs.
