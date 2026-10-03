# ADR 0024: Staff leave and time in lieu

- **Status:** Accepted, 1 October 2026. Built after round two of the
  audit ([ADR 0023](0023-audit-round-two-the-loops.md)), as the first
  part of the app that is for the staff rather than for the jobs.
  Amended 3 October 2026 with Colly's words on how far ahead staff can
  ask: "the office have to manually open the years for leave. So staff
  can't apply for leave very far in advance." Leave is now asked for
  only in a year the office has opened (below).
- **Decides:** what annual leave and time in lieu are in the app, who
  applies and who approves, how the balances are worked out, how the
  planner and offers respect leave once it's approved, and which years
  staff can ask for leave in.

## Context

Session Hire's staff get annual leave, and earn days in lieu when they
work a show day at the weekend. Both are kept in people's heads and in
messages today, so nobody can say at a glance how many days someone has
left, and the planner doesn't know that someone is away until the office
marks their days off by hand.

Colly's decisions: the leave year is the calendar year; time in lieu is
counted in days for now, not hours; who the senior staff are comes
later, so for now a flag on a person says they can approve time off;
and just annual leave and time in lieu, with no sick or unpaid leave
yet.

The app already has people (staff or freelancer), days off that the
planner and offers respect, staff sign-in with Google, and a Crew tab
with a count of what's waiting on the office. Leave is built on those
rather than beside them.

## Decision

**Staff only, in whole days.**

- Only a person of kind staff has leave. Freelancers mark days off on
  their link, as before.
- A request is a start and an end day, inclusive. Its length is the
  weekdays (Monday to Friday) in it that aren't Irish public holidays:
  Monday to the Friday after is 5 days, and the week with the October
  bank holiday in it is 4. The form shows the count before anything is
  sent ("5 days"), and the server counts again and writes its own count,
  never the device's. A request can't cross the year end: December and
  January are asked for separately, so each belongs to one leave year.
  A request can be for days already gone, so leave taken before anyone
  wrote it down can be put in for the record; once approved it counts
  as taken, and can't be cancelled.
- Half days and working patterns (someone who works four days a week,
  or Tuesday to Saturday) are later items, named below.

**Irish public holidays by rule.** `shared/src/holidays.ts` works out
any year's public holidays from the rules: New Year's Day; St Brigid's
Day, the first Monday in February, or 1 February when that is a Friday;
St Patrick's Day; Easter Monday; the first Mondays of May, June and
August; the last Monday of October; Christmas Day; St Stephen's Day. A
test checks them against the published dates for 2026 and 2027. They
are never counted as leave, and the planner marks them as a faint band
so the office can see them when planning crew.

**Three records, in a module of their own** (`shared/src/leave.ts`,
`server/src/leave/`, with its own schema version table so it never
fights the crew migrations):

- `leaveAllowance`: one for a person and a year, with the id
  `<personId>-<year>`: the days, how many were carried over from the
  year before, and a note. Set by an approver. When none has been set,
  the year reads as 20 days (four working weeks, the statutory minimum)
  and nothing carried over.
- `leaveRequest`: a person, a type (annual leave or days in lieu), the
  start and end day, the counted days, a note, and a status: waiting,
  approved, declined or cancelled, with when it was asked for and, once
  decided, who decided it, when, and the reason given.
- `lieuEntry`: a day worked, how many days in lieu it earns (a whole
  number, 1 to 5, since a long show day can be worth more than one), a
  note, and the same statuses and decision fields.

A person gains `approvesLeave`, which starts off and is set on the Crew
tab's person form as "Can approve time off", for staff only. Older rows
and device snapshots read it as off.

**Years the office opens** (amended 3 October 2026). Colly: "the office
have to manually open the years for leave. So staff can't apply for
leave very far in advance."

- A leave year is open or not, for the whole company: a fourth record,
  `leaveYear`, one for each year opened, with when, in a table of the
  module's own (`leave_years`). Who opened it is in the history.
- An approver opens a year with `leave.open`. Only this year in Ireland
  or the next can be opened, so a slip can't open 2062 ("Only this year
  or next can be opened for leave: 2026 or 2027."). Opening a year
  already open changes nothing, as a phone sending twice does.
- An open year can't be closed again. Closing one with requests in it
  would leave leave on record in a year nobody can ask in. Closing one
  with none would undo little: only next year can be opened early, after
  a question in place, and anything asked for in it waits for an
  approver, who can decline it. Open stays open is one rule, for staff
  and for the history.
- A request in a year that isn't open is refused, on the device before
  sending and on the server, in the same words: "Leave for 2027 isn't
  open yet. The office opens each year when it's ready." A year gone
  that was never opened can't be now ("Leave for 2025 isn't open, and
  only this year and next can be opened."). An open year stays open
  after it ends, so December's leave can still go in for the record in
  January.
- A day in lieu is logged for a day already worked, never ahead, so it
  needs no open year. Taking one is a request, so that does.
- An allowance is set for this year or next only, open or not, so the
  office can set next year's before opening it ("Allowances are set for
  this year or next only: 2026 or 2027."). Another year's show on the
  Leave screen as they stand.
- The migration that brings the table opens, on a server already in
  use, this year in Ireland and every year up to next that already
  holds a request, a day in lieu or an allowance, so nothing that
  worked stops. A year further ahead stays shut until it is next year
  and an approver opens it, as for any year: what is in it stays, and
  can still be decided or cancelled, but nobody asks for more leave
  that far ahead. Devices
  hear of the years opened through the feed. A new, empty database
  opens none, and starting fresh empties the table with the rest, so
  the office opens the year once the real crew list is in.

**Commands.** `leave.request`, `leave.cancel`, `leave.decide`,
`lieu.log`, `lieu.cancel`, `lieu.decide`, `leave.allowance` and
`leave.open`. The server refuses in plain words:

- only staff have leave;
- leave only in an open year, a year opened only this year or next, and
  an allowance only for this year or next (above);
- a request can't overlap the person's own waiting or approved
  requests, and a day in lieu can't be logged twice for the same day,
  or for a day that hasn't come yet;
- a request for more days than are left this year is refused ("Only 2
  days of annual leave left this year", "Only 1 day in lieu to take"),
  and approving one is checked the same way, since another request may
  have been approved since;
- deciding needs "Can approve time off", and nobody decides their own
  request or lieu entry; nothing is approved for someone archived since
  they asked, so no days off are written for someone who has left
  (declining still clears the queue); allowances are set, and years
  opened, by approvers only;
- cancelling is the requester's, while the request is waiting or
  approved and hasn't started.

**Who is asking.** When sign-in is on, every change carries the
signed-in account, and the server matches its email to a person on the
Crew tab (case doesn't matter). A request or a lieu entry has to be
that person's own; a decision or an allowance has to be by someone that
person is, with the flag. When sign-in is off, as it is until the
Google key is in, there is no signed-in person: the app asks "Who are
you?" once, over the staff, remembers the answer on the device, and
sends it as `by` with decisions and allowances. The server takes `by`
only when sign-in is off; with sign-in on it ignores it, except that a
`by` naming someone other than the signed-in person is refused, on a
cancel as on a decision. So the screen works today, and becomes honest
by itself the day sign-in is switched on.

**Approved leave is days off.** Approving a request writes one
unavailability row, with the request's own id, the source `leave` and
the note "Annual leave" or "Day in lieu" ("Days in lieu" for more than
one). The planner then shows the days as it shows any days off, offers
to that person for those days warn as they do for any days off, and the
clash is flagged if they're booked. Declining or cancelling removes the
row. The office can't remove those days off by hand, and the person's
private link page shows them as approved leave with no Remove: the
leave is cancelled instead, so the two never disagree.

**Balances**, worked out on each device from what it holds
(`shared/src/sync/leave-view.ts`, on the view as `leave`), for each
staff person and a year:

- annual leave: the allowance and what was carried over; taken
  (approved days on or before today), booked (approved days after
  today), waiting, and left, which is the allowance plus the carry-over
  less everything approved;
- time in lieu: earned (approved entries), waiting to be approved
  (entries not yet decided), taken, booked and waiting (requests of that
  type), and left, which is earned less everything approved.

Lieu earned in one year and not taken in it is a later item, like
carrying annual leave over by rule: for now an approver writes the
carry-over into the next year's allowance, and the Leave screen says so
under the lieu facts, where someone would otherwise meet "No days in
lieu to take" in January.

**The queue for approvers.** Waiting requests and entries, oldest
first, each with what an approver should see: the jobs the person holds
days on (accepted or confirmed), other staff off on those days, and
other staff who have asked for the same days.

**The Leave screen**, at `#crew/leave`, reached from a card on the Crew
tab:

- *My leave*: the signed-in person's year as facts, with last year and
  next year a tap away; Apply (type, from, to, note, with the day count
  shown before sending); Log a day in lieu (the day worked, how many
  days, a note); and my requests and entries, with their status and
  Cancel where it's allowed.
- *To approve*, for people with the flag: the queue with its warnings,
  and Approve and Decline in place, the reason optional.
- *Allowances*, for approvers: each staff member's year, with days and
  carried over to edit, for this year and next.
- Over Apply, which of this year and next are open, and that the other
  isn't yet; for an approver, "Open 2027 for leave", asked in place
  first.
- The Crew tab's badge adds the waiting count for an approver to the
  answers to check.

**The person's own calendar feed** carries approved leave as all-day
events, "Annual leave" or "Day in lieu", beside their bookings. It was
a small change in the feed builder, so it's in.

**The history** says it in words, with dates written as the rest of
the history writes them: "Aoife Byrne asked for annual leave, Mon 5 Oct
to Fri 9 Oct (5 days)"; "Colly Hewson approved Aoife Byrne's annual
leave, Mon 5 Oct to Fri 9 Oct", or "declined …: too many away that
week"; "Cian Murphy logged a day in lieu for Sat 3 Oct"; "Colly Hewson
set Aoife Byrne's 2026 allowance to 22 days, 2 carried over"; "Colly
Hewson opened 2027 for leave". The
decider's name comes from the `by` the device sends; without one the
label starts with the verb ("Approved Aoife Byrne's annual leave, …"),
and the entry's own "who" names them. The export has the three new
tables with a line each, and the people table's line says who can
approve time off; the open years' table has a line too.

**Made-up data.** The staff have allowances for this year; Aoife
Brennan can approve time off; Cian Murphy is waiting on a week's leave;
Orla Hayes had a week approved last month, so her days off are in the
planner; and Cian has a day in lieu waiting for the gala's last show
day. This year is open for leave and next year isn't, so opening it can
be tried, and the made-up weeks are kept inside this year: early in
January Orla's comes after today, and late in December Cian's before
it.

## Consequences

- Staff and whoever approves can see what's left without asking, and
  the planner and offers know about leave the moment it's approved.
- Three new statuses and one new flag to know. A device that hasn't
  heard of them keeps working: the unknown source on a days-off row is
  shown as any other days off, and a missing flag reads as off.
- Staff can't ask for next year until the office opens it, and after
  starting fresh not even this year: the approver's Open is on the
  Leave screen for that. No new leave record is for a year after next,
  which also closes an edge in erasing
  ([ADR 0027](0027-erasing-a-person-on-request.md)).
- Until sign-in is on, the screen trusts who a device says it is, as
  the rest of the app does today. That is written here so nobody
  mistakes it for a check.
- An email belongs to one person on the Crew tab. Were two people who
  aren't archived to share one, the server would match the signed-in
  account by id and the device by list order, and the two could
  disagree, so the signed-in person is told they can only ask for
  their own leave. The fix is on the Crew tab, not here.
- Left for later and written down so they aren't lost: half days; working
  patterns other than Monday to Friday; sick and unpaid leave; carrying
  annual leave and lieu over by rule at the year end; hours of lieu
  rather than days; who the senior staff are, as a role rather than a
  flag; and an approver telling the person their request was decided,
  through the Send panel, as the office tells freelancers.
