# ADR 0055: Combining people brought in twice

- **Status:** accepted
- **Date:** 19 October 2026
- **Asked for by:** Colly, 19 October 2026 ("a function to combine users
  created to the same one - some have been picked up twice due to multiple
  email addresses")

## Context

A bring-in from Google Calendar ([ADR 0011](0011-calendar-import.md),
[ADR 0037](0037-job-kinds-and-days-gone-as-history.md)) knows a guest only
by their address. Someone invited as aoife@sessionhire.com on one event
and aoifebyrne@gmail.com on another came in as two people, each with half
their bookings. The live app had 91 people after the two bring-ins of 16
October, some of them twice. Each address is also how the next bring-in
finds them and, for staff, how their Google sign-in finds their role
([ADR 0034](0034-roles-and-what-each-can-change.md),
[ADR 0052](0052-google-only-for-staff.md)), so the second address can't
simply be thrown away.

## Decision

**One command, `person.merge`.** It keeps one person and makes the
others part of them: every offer and booking (and so every timesheet),
day off, document, leave request, day in lieu, leave allowance, running
late, their own calendar, the days they drive a van, the counts they did,
the phases that name them as the contact, and the guests on Google
Calendar invites. The others are then removed. Its history entry reads
"Made Aoifebyrne part of Aoife Byrne, as one person"; earlier entries
still read the others' names, and their link answers are the one
person's in the History filter.

**What the one person holds** (`mergedPerson`, shared, so a device shows
it before the server answers): the kept person's details, with anything
they lack filled from the others; a real name over one the bring-in made
from an address; every skill once; notes joined; the highest level; the
best of each certificate; approving leave if any did; archived only if
all were.

**Every address stays.** A new `otherEmails` on the person holds the
addresses the others had. The calendar bring-in, the crew list bring-in,
a Google sign-in (role and "who am I"), a staff link's sign-in check and
the "someone already has that email" rule all match them as they match
`email`. They're set only by combining, and shown on the person's page as
"Also found by".

**Their links keep working.** `person_merges` remembers who was made part
of whom, with the link they had, so a freelancer's old private link and
its calendar feed open the one person's. A new link for the one person
stops those too. Download everything leaves the old links out, as it does
people's own.

**One call offered twice.** Two of them offered the same call is one
person offered it twice. The one with a timesheet is kept, or else the
furthest along (booked, then accepted, then waiting), holding every day
either held; the other goes, its running late and invite days moving
across. Two timesheets for one call are refused, as one booking has one.

**What is refused.** Two different roles, or a role kept on a freelancer
(who has none), since that would change what someone signs in as: the
words say which to change. Someone erased on request. Someone with a role
can be combined only by the office or a director, who can already change
who signs in. Only from the app, never a link.

**Where the office does it.** On a person's page, "Combine with…" under
Change details lists who looks like them, ticked when sure, and finds
anyone else by name or address. Jobs › Tidy up has "The same person,
brought in twice", a group at a time with "Keep the details of". Both
end in one question that says what moves, which addresses will find them,
and that it can't be split again in one go. Crew › People's tidy line
counts them.

**Who looks like one person** (`samePeople`): the same full name, the
same phone number, or an address that spells the other's name
("johnmurphy@" and John Murphy). These start ticked (Default Effect: the
one action is still a press and a question away). A one-word name made
from an address ("Adam") beside the one person whose first name it is
is offered unticked: a wrong tick joins two people's work.

## Consequences

- The office can make the two bring-ins' people one in a sitting, and the
  next bring-in won't split them again. Nothing is written to Google and
  nobody is contacted.
- It can't be undone in one go; the history says who was combined.
- A leave allowance for a year both had keeps the kept person's (it's a
  setting, not leave taken).
- Erasing the one person ([ADR 0027](0027-erasing-a-person-on-request.md))
  also erases what the history and the change feed held under the others'
  ids, and their old links.
- Their addresses can't yet be edited or taken off one by one; only by
  combining. If that's needed, it's a field on the person's form.
