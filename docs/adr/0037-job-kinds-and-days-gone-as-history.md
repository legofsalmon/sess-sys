# ADR 0037: A job's kind, and days gone as history

- **Status:** accepted
- **Date:** 16 October 2026
- **Asked for by:** Colly, 16 October 2026 ("go for it" on the audit's fix
  order), after [the audit of the real data](../audit-2026-10-16.md)

## Context

The first real bring-in ([ADR 0011](0011-calendar-import.md)) read two
organisers' calendars from 1 October 2026: 141 jobs, 66 crew calls, 179
offers and 36 people. It ran clean, and the audit found the rules it was
built on didn't fit the calendars as they are:

- A calendar is not a job list. Around a fifth of the "jobs" were dry
  hires ("Murt lx hire", "Show scope drape rental"), van runs ("Collect
  Screwfix", "Return PSI Truss Adapters") and meetings ("Ryder Cup
  Meeting", "Site visit Ryder cup"). Each came in as a gig with a Show
  phase and a crew call for everyone on the invite.
- Google's unanswered invites on days gone became 54 offers waiting, 32 of
  them in the past, so Home said calls still needed crew for gigs that had
  happened, and Crew listed 41 timesheets "not in yet" for days nobody
  would ever send one for.
- The tidier calendar writes "WL - Malahide Build 4/9 & Client Walk
  Through", "Mansion House - Load Out PA", "Coca Cola Truck - Live RDS".
  The parser took the part after " - " as a phase only when all of it was
  phase words, so these became jobs of their own: four jobs became
  thirteen.
- "Nissan - Show Day 2/ Load Out" put the six people on the invite on the
  Show call and again on a Load out call, so the job said 9 of 18 booked
  and the planner listed each of them as a clash with themselves.
- Google had no name for most guests, so 21 of 28 freelancers are named
  from their email handle ("Craicaudio", "Scflighting"), and the
  company's info@ mailbox and a supplier's hire@ are people on the crew
  list.

Everything is still exactly as the bring-in made it: nothing has been
typed, answered or moved in the app since. So the cheapest fix is to get
the rules right, take the first bring-in back, and bring the calendars in
again from the start of the season.

## Decision

- **A job has a kind:** gig, dry hire, errand or meeting. A gig is what
  the app has always meant by a job: crew and kit on days. A dry hire is
  kit going out with no crew. An errand is a van run or a collection. A
  meeting is people and no kit. The kind is a field on the job like its
  status, set when a job is added or edited, and shown on the job's row
  and page when it isn't a gig. A job saved before kinds existed is a gig.
  The kind changes nothing else yet: a dry hire still holds its kit a day
  either side, and all four still count on Home and in the planner. What
  each kind should do differently there is the next decision, once the
  office has seen them apart.
- **The bring-in guesses the kind from the title**, and the office
  corrects it on the import screen before anything is saved. "Collect",
  "return", "drop off", "pick up" or "deliver" at the start of a name is
  an errand; "meeting", "site visit", "recce" or "walk through" anywhere
  is a meeting; "hire", "dry hire", "rental" or "rent" anywhere is a dry
  hire (the company's own name says nothing); anything else is a gig. A
  phase word after " - " is still a phase of the job, whatever its kind:
  "Davin lx hire - Load out" is the Load out of a dry hire.
- **Only a gig has crew.** A dry hire, an errand or a meeting comes in
  with no crew call; whoever was on the invite is written on the phase's
  notes ("On the invite: Aoife Byrne, Sean"). A day with no phase word
  comes in as the kind's own day: Show for a gig, and Hire, Errand or
  Meeting otherwise, so a hire's days read as a hire in the planner.
- **Days gone are the record of who worked, not offers.** On a day before
  today, a guest who said Yes is a confirmed booking, as before. A guest
  who hadn't answered, said Maybe or said No is not an offer: they are
  noted on the phase ("No answer on the invite: Dara Walsh (Mon 6 Oct)",
  "Said no: …") so nothing is lost, and the call needs as many people as
  were booked, so it isn't still looking for crew. Today and the days to
  come work as before: a Yes is booked, no answer is offered, a No is
  declined, for the office to confirm or find cover.
- **A booking brought in after its last day has no timesheet.** It was
  paid some other way before the app existed; the record is enough. A
  booking brought in before its days, which then happen, has one as
  usual.
- **Titles can carry a note.** When the part after " - " starts with a
  phase word, the phase is that word and the rest is the phase's note:
  "Build 4/9 & Client Walk Through" is a Build with the note "Client Walk
  Through", "Load Out PA" a Load out with "PA", "Live RDS" a Show with
  "RDS". A note is at most six words; more than that is the job's name. A
  phase word in the middle of a title with the job before it ("WL -
  Malahide Build 4/9 & Client Walk Through") is read the same way.
  "Launch" joins the words for Show, and "install" joins the words that
  can end a title with no " - " ("St. Patrick's Cathedral Install").
- **A day naming two phases books its crew once,** on the first phase
  named: "Show Day 2/ Load Out" puts them on the Show, and the Load out,
  with nobody of its own, gets no call.
- **People's names are the office's to give.** The import screen's list of
  people on the invites has each name as it will show, editable, and says
  "Named from their address: give them their name" where Google had none.
  A person's own address is suggested for the crew list only once they are
  on a gig: a client at a meeting isn't crew. A shared mailbox (info@,
  accounts@, office@, hello@, bookings@, hire@, sales@, support@ and the
  like, at any domain) is never crew; it is noted on the phase instead.
- **The first bring-in can be taken back.** The import screen says what
  has been brought in so far (jobs, days, crew bookings and offers, people
  added from the invites, and from which calendars) and offers to take it
  all back in one go, so the calendars can be brought in again from the
  first day with these rules and the office's corrections. Taking back
  removes every job marked as brought in from a calendar, with its phases,
  crew calls and offers, and every person the bring-in added whom nothing
  else in the app refers to (no answer of their own, timesheet, document,
  day off, leave, lateness or contact duty); venues stay, since the next
  bring-in finds them by name. It is refused once anyone has acted on
  those jobs in the app (an answer from a link or in the app, a timesheet,
  kit on a job, a movement or a fault), because that work would go with
  them. It is one entry in the history, like the bring-in, and nothing is
  written to Google.

## Consequences

- Colly takes the first bring-in back and brings both calendars in again
  from the start of the season. On the import screen the dry hires,
  errands and meetings show their kind to check, the people list shows the
  names to type, and the days gone come in as bookings and notes rather
  than offers; then Home, Crew and the planner show the office's real
  state of play.
- The audit's findings 2, 4, 5, 6 and 7 close with this. Finding 8
  (clients and venues from title words) and finding 9 (how a residency's
  repeat days read on a card) stay open.
- What a dry hire, an errand or a meeting should do differently on Home,
  in the planner and for kit is decided next, once the office has seen
  them apart. Until then the kind is a label, and a hire's phase named
  Hire is how the planner tells them apart.
- Any job can have its kind changed afterwards like any other field, and
  the phase names are the office's to rename, so a wrong guess costs one
  edit.

Later (29 October 2026), from the audit of 20 October 2026:

- Taking it all back refuses in words for a quote, or crew running late, on
  a job brought in, as for kit (finding 51). A person added from the
  invites stays when they have a leave allowance, their own calendar, a
  count they made or a leave decision they took; and anything added later
  that still refers to the jobs or people is said in words ("Something in
  the app still refers to these jobs or people") rather than as a fault.
- A person added from the invites whom anyone has changed since (named on
  Tidy up, a phone or rate typed, a level set) stays too, as the history
  shows a change to them by something other than a bring-in; the card and
  the question say how many stay (finding 53).
- A job on the import screen is known by its first event as it was looked
  at, not its first day, so a job that gained an earlier day before the
  bring-in still comes in. A job chosen that is in the app already, as
  when a bring-in is sent twice after a dropped connection, is said to be
  "in the app already", apart from one gone from the calendar (finding 52).
