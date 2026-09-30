# ADR 0011: Bringing jobs in from Google Calendar

- **Status:** Accepted, 30 September 2026. The fifth part of Phase 1.
  Built; it works once the app server has its Google key and a Google
  account is connected on the Account tab
  ([how](../sign-in-setup.md)).
- **Decides:** how the jobs already on the organisers' Google calendars
  get into the app, what the app guesses from an event and what it asks,
  and who looks after those jobs' events afterwards.

## Context

Every job the office has booked so far lives only in Google Calendar: one
all-day event per phase per day, titled `<Job> - <Phase> n/m`, with the
venue as the location, the crew as guests (their Yes is their
confirmation) and, sometimes, the job sheet in the description
([current process](../research/current-process.md)). The events are on the
calendars of the two ops staff who organise them. The app now holds jobs
([ADR 0007](0007-jobs.md)), writes confirmed ones to a calendar
([ADR 0008](0008-calendar-sync.md)) and lays out every job and person by
day ([ADR 0010](0010-planner.md)), but only for jobs typed into it. The
roadmap's promise is that nobody types a job twice.

The Google account connected on the Account tab can already read the
events on any calendar it can see, with the permissions it was given for
the sync, so reading them needs nothing new from Google. Admin access to
the company's Workspace, which would let the app read both organisers'
calendars directly, isn't available yet.

## Decision

- **From a calendar the connected account can see.** The import screen,
  opened from the Jobs tab or the Account tab, lists the calendars the
  connected account can see, its own first (not Google's own holiday and
  birthday calendars). Someone else's calendar is listed once they share
  it with that account and it is added under Other calendars in Google.
  The office picks one and a
  start date (by default the first of the month three months back), and
  the app reads its events from then to two years ahead. It never writes
  to that calendar and never emails anyone.
- **Look first, then bring in.** *Look at the calendar* shows what would
  come in, before anything is saved: each job it found, ticked, with its
  phases and days, venue and crew; the people on the invites who aren't in
  the app yet; and what was left out, with why. Any job can be unticked or
  renamed, and giving two jobs the same name brings them in as one.
  *Bring in* reads the calendar again and saves what was ticked in one go,
  so a half-finished import can't happen; the history says who did it and
  how much came in.
- **Which events.** All-day events, which is how every gig is entered
  today. Events with a start time (meetings, calls), repeating events
  (birthdays, reminders), out-of-office and other special events, events
  with no title, and the app's own events are left out, and the screen
  says how many of each.
- **Titles into jobs and phases.** The phase is the part after the last
  " - ", and the job everything before it, so "Tik Tok - Ploughing - Load
  In" is the job "Tik Tok - Ploughing" and its Load in. Phase words become
  the app's own (Prep, Load in, Build, Rehearsal, Show, Babysit, Load
  out), with the usual variants (rehearsals and tech, set up, show day,
  get in and get out, derig, strike); any other word is kept as typed.
  Numbering such as "2/3" and "Day 2" is dropped, since the app numbers
  days itself. A day with two phases ("Show Day 2/ Load Out") is a day of
  both. A title with no " - " is split before a phase word at its end
  ("Fairview Build"), except a lone "Show", which is usually part of the
  name ("Dublin Horse Show"); otherwise it is all job, with its phase
  guessed as Show and marked as a guess.
- **Events into jobs.** Events with the same job name, ignoring case,
  spacing and punctuation, are one job, unless more than 14 days apart,
  when they are separate jobs (the same party next year). A phase's days
  in a row are one phase; a gap starts another. A job whose titles all say
  TBC, pencil, hold or provisional (or end in a question mark) comes in as
  an enquiry, pencilled in, and the word comes off its name; a job with
  any firm day comes in as confirmed. Days that have gone come in too, as
  the record of who worked what.
- **Venues.** The event's location is the venue: the part before the
  first comma is its name, and the whole of it the address. A venue
  already in the app with that name (or that address) is used; otherwise
  a new one is added. The job's venue is the one most of its days are at,
  and a phase somewhere else gets its own.
- **Crew.** Guests are matched to people in the app by email (or, for
  someone in the app with no email, by name). The organiser, the connected
  account and meeting rooms aren't crew. People on the invites who aren't
  in the app yet are listed, ticked when their address looks like a
  person's own (Gmail, Outlook, iCloud and the like, or sessionhire.com,
  who come in as staff) and unticked otherwise, since those are mostly
  suppliers and clients; ticked ones are added with the name Google has
  for them. Each phase gets one crew call, for "Crew", needing as many
  people as its busiest day had on the invites: a guest who said Yes is
  booked, one who hasn't answered (or said Maybe) is offered, one who said
  No is kept as declined. The office can split the call by role
  afterwards. What the calendar says is brought in
  as it is, even where someone is on two jobs on one day; the planner
  flags those as clashes for the office to sort out. Nothing is sent to
  anyone: their private links simply show the job.
- **Job sheets.** An event's description (kit list, running order, access
  notes) goes into its phase's notes as plain text, or into the job's
  notes when every phase has the same one. Kit lists become kit lines
  when the warehouse arrives (Phase 2); until then they are kept as
  written.
- **Looking again.** Each event brought in is remembered, by the id Google
  gives it on every calendar it is on, so looking again, or at the other
  organiser's calendar, shows only what is new. New days for a job brought
  in before are added to it. Days a job typed into the app already has are
  left out, as is a job the office has cancelled in the app. Events
  deleted, moved, or made longer or shorter in Google since they were
  brought in are listed, so the office can change the job to match.
- **The organisers' calendars keep the jobs brought in from them.** Their
  events are already on the crew's calendars, with the crew's answers, so
  the app doesn't put these jobs on the jobs calendar as well, which would
  show every day twice and, with invites on, invite the crew a second time.
  The job page says where its days are. Everything else about these jobs
  works as for any other: the planner, crew calls and offers, private
  links, and the history. Handing a job over to the app, so the app writes
  its events and the organiser's copies go, comes later, once the office
  has decided how crew should see that switch.

## Consequences

- The office can bring in every gig on an organiser's calendar in a
  couple of minutes, check every guess before anything is saved, and fix
  anything afterwards as an ordinary change to the job.
- Until a job is handed over to the app, its events are changed in
  Google, as today, and in the app to match: looking again brings in new
  days and lists deleted or moved ones, but doesn't change a job on its
  own. The same goes for crew: an answer given in Google after the job was
  brought in isn't picked up, so the office changes the offer in the app
  (or the crew member answers on their private link). Following changes
  made in Google as they happen needs Google's push notifications, which
  come with calendar-led jobs.
- Each organiser's calendar is brought in from the account connected on
  the Account tab, so the other organiser shares their calendar with that
  account (or connects their own for a moment). With Workspace admin
  access later, the app can read both directly.
- Only guests the account can see are brought in: an event whose guest
  list is hidden from other guests comes in without crew.
