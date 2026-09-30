# ADR 0008: Confirmed jobs onto Google Calendar

- **Status:** Accepted, 30 September 2026. The second part of Phase 1.
  Built; it switches on once the app server has its Google key (the same
  one as sign-in) and someone connects a calendar from the Account tab
  ([how](../sign-in-setup.md)).
- **Decides:** how jobs get from the app onto Google Calendar, which
  account writes them, and what happens when either side changes.

## Context

Today a job lives only in Google Calendar: one all-day event per phase per
day, titled `<Job> - <Phase> n/m`, with the venue as the location and the
crew as attendees, organised by one of the two ops staff
([current process](../research/current-process.md)). Jobs are now kept in
the app ([ADR 0007](0007-jobs.md)), so for nobody to type a job twice the
app has to write those events itself, in the same shape, so that crew and
staff see no change.

Admin access to the company's Google Workspace isn't available yet, so the
app can't act for the whole company. Colly has a test calendar to try it
on, and the shared **Session Hire Gigs** calendar exists but is empty.

The database is kept asleep when nobody is working, since Neon charges for
the time it is awake, so the sync can't check the calendar every minute.

## Decision

- **One Google account writes the jobs, connected by a person.** A member
  of staff signed in to the app connects a Google account from the Account
  tab (their own, or a shared ops account) and picks a calendar that
  account can change: the test calendar first, Session Hire Gigs later. The
  app asks Google for two permissions only: to change events on the
  account's calendars, and to see the list of its calendars so one can be
  picked. Events are organised by that account, as they are by the ops
  staff today, so the crew invites that come next (2b) come from a person
  crew already know.
- **The key Google gives the app is kept locked.** Google hands over a
  long-lived key when someone connects. It is stored encrypted, with a key
  worked out from the app's Google secret, which lives only in Railway, so
  the database, its backups and a copy of it are no use without the
  server's settings. It is left out of Download everything entirely.
  Disconnecting hands it back to Google, which stops it working.
- **What goes on the calendar:** every day of every phase of a confirmed
  job, from today on, as an all-day event with the title crew already know
  ("Nissan - Build 1/2"), the venue and its address as the location, and a
  description with the client, the phase and day, the venue's access notes,
  the job and phase notes, the crew booked for that day by role with call
  times and places still to fill, and a link to the job in the app. Names
  only: rates and phone numbers never go on the calendar. Enquiries and
  quotes stay off it, so nobody sees a job that isn't happening; a job goes
  on when it is confirmed and comes off when it is cancelled or lost.
- **Past days are left alone.** The app never changes or removes an event
  for a day that has gone, so the calendar keeps its record of what
  happened, and connecting the app doesn't fill years of history.
- **The app leads.** Renaming a job, moving a phase, changing a venue or
  booking crew changes the events within seconds. An event changed or
  deleted in Google is put back to match the job each night, or sooner
  when the job changes; the event says so at the bottom. Letting edits in
  Google flow back into jobs is for the importer and calendar-led jobs,
  later in Phase 1.
- **Each event's id is worked out from the job**, the calendar, the phase
  and the day, rather than made up. If the server stops halfway through
  writing, or two copies of the server run at once during a deploy, the
  second write finds the first one's event and updates it, so the calendar
  never gets doubles. Events also carry the app's own hidden marks
  (Google's private event properties), so the nightly check only ever
  looks at the app's events, never anyone's own.
- **It runs when something changes, not on a timer.** A change to a job,
  its phases, venue, client or crew sets the sync off a couple of seconds
  later, once the burst of changes has settled; there is one check each
  night, a few minutes after the backup, while the database is awake
  anyway; and a failed write is tried again after a minute, then with
  longer waits. Nothing else wakes the database.
- **Google being unavailable never stops work in the app.** A day that
  couldn't be written shows on the job page with the reason, and is tried
  again. If Google stops accepting the app's key (the password was changed,
  or access was removed in the Google account), the Account tab says
  "Connect again", and nothing more is tried until someone does.
- **Changing calendar moves the events**: the app takes its days from
  today on off the old calendar and puts them on the new one. **Disconnecting
  takes them off** too, then hands the key back. Past days stay where they
  are in both cases.
- **Connecting, choosing a calendar and disconnecting go in the history**,
  with who did it, like a download of everything. The sync's own writes
  are not people's changes and don't.
- **Phones and laptops see where each day stands** through the normal
  sync: the job page says, for each phase, whether its days are on the
  calendar, on their way, or couldn't be written and why, and the Account
  tab shows the connection. Neither needs signal to show the last known
  state.

## Consequences

- Colly's steps for the Google key grow by two: switch on the Google
  Calendar API in the same Google Cloud project, and add a second redirect
  address. Both are in the [setup steps](../sign-in-setup.md).
- The Google Cloud project should stay **Internal** (a sessionhire.com
  account). As an External app still in testing, Google stops the app's key
  working after seven days.
- Crew invites and reading their answers back (RSVPs) come next, as 2b,
  behind a switch on the Account tab that starts off, since each invite is
  an email to a freelancer.
- An edit made in Google to an app event is lost at the next sync. Until
  jobs can be calendar-led, the rule is: change the job in the app.
- If the Google secret is ever replaced in Railway, the stored key can no
  longer be unlocked, and the Account tab asks for the calendar to be
  connected again. Nothing is lost.
- With admin access to Workspace later, the same sync can write as a
  service account instead of a person, without changing anything else.
