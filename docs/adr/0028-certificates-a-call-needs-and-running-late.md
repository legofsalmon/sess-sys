# ADR 0028: The certificates a call needs, and running late

- **Status:** Accepted, 2 October 2026. Built in the fourth round, after
  crew profiles ([ADR 0025](0025-crew-profiles-and-bringing-in-the-list.md)).
- **Decides:** which certificates the app knows, how a crew call says
  which ones it needs and what that does to an offer, how the office is
  reminded before a certificate runs out, and how a freelancer says from
  their private link that they're running late on the day.

## Context

The architecture promises two things that weren't built. Under People:
"An expired required certificate blocks the assignment, the same way an
overdue PAT test blocks an asset", with expiry reminders so a freelancer
enters a certificate once and isn't asked for it per job. And under
"Meet freelancers in the middle": two-way contact, so a freelancer can
"flag they're running late". ADR 0023 built "Can't make it any more" and
left running late for later; ADR 0025 built certificates as first aid,
manual handling and driving licence, and left Safe Pass, working at
height, IPAF and the blocking for later.

Rigging calls need people who can legally work at height and operate a
lift: a Safe Pass on a site, a working at height certificate, an IPAF
card for the platform (its categories, such as 3a or 3b, say which). A
person's certificates are a JSON record by kind on their row, each held,
not held or unknown, with an expiry and a note.

On the day, a freelancer who is late rings the office or the crew chief,
if they have the number to hand. The link they already have is the
natural place to say it, and the crew chief is the one who needs to know.

## Decision

### Certificates

**Three more kinds.** `safe-pass`, `working-at-height` and `ipaf` join
the three of ADR 0025, each held, not held or unknown, with an expiry day
or none and a note up to 200 characters. An IPAF card's categories go in
the note ("3a, 3b"); the form's note for IPAF suggests it. The kinds are
keys in the person's `certificates` JSON column, which has no check on
them, so no migration: the shared schema's list is the only gate, and a
person saved before reads the new kinds as unknown. A version of the app
from before knows only the first three, and its form sends only those
that say something, leaving one out to clear it. So `person.upsert` now
keeps any of the three new kinds that an edit leaves out, while the first
three are as sent, as before, and an edit that sends no certificates
keeps them all; a device lays an edit over its copy the same way. This
version's form sends every kind, one not known as not known. The form
gains a note beside each certificate held, or with a note already, so a
phone's form stays short, and the card says the note with the kind
("IPAF 3a, 3b (to Thu 22 Oct 2026)").

**Bringing in the list reads them too.** Columns headed Safe Pass,
Safepass or Safe Pass card; Working at height, Working at heights or
WAH; IPAF, IPAF card or PAL card, read as the other certificate columns
are: Yes is held, No is not, blank says nothing. Matching and merging are
unchanged, so a second import keeps the expiry and note the office typed.

**A call says what it needs.** A crew call gains `needsCertificates`, a
list of kinds, on `call.create` and `call.update`, set from a row of
ticks on each form a call is made or changed on (the job's page, the Crew
tab's own form and Change). Stored as a JSON column on `crew_calls` (crew
migration 8); a call saved before needs nothing. The call's facts, the
offer message and the freelancer's offer card all say "Needs working at
height and IPAF", so nobody turns up without the card.

**An offer is refused for a certificate that's missing.** When the office
sends an offer, each certificate the call needs is checked against the
person's record and the call's days:

- not held: "Laoise Keane has no IPAF, which this call needs.";
- run out already: "Tadhg Brady's manual handling certificate ran out on
  2 September.";
- runs out before the call's last day: "Seán Ó Briain's IPAF runs out on
  3 November, before the job ends." (or "before the job starts"), with
  the year when it isn't this one;

each followed by "Update their card if that's changed." The person is
named in full, since the office may have two Seáns. A certificate held
with no expiry is good for any job, and a card is good on its expiry day
itself, so one that ran out after a job's last day was good for that
job, and a job that's over isn't held against it. Not known is allowed:
the picker and the offer say so in the warn tone, once for all the kinds
("Working at height and IPAF not known for Dara Quinn: check before the
job."), since most of the crew list says nothing about most
certificates.

"Send anyway" doesn't pass it. The override is for clashes and days off,
which are the office's judgement; a missing certificate is a legal
condition of the work (a Safe Pass on a site, a lift's operator card),
and the way past it is to correct the record, which then lets the offer
go. The same shared function says it on the device as Offer is pressed,
in place and with no round trip, and on the server, so an offer made
offline is refused in the same words when it arrives.

**Checked when the office offers, warned about after.** Nothing is undone
later: an answer from a freelancer's link is never refused for a record
the office keeps, and a booking stays when a certificate lapses or a call
comes to need one. Instead the call's line warns, at rest and in the warn
tone, for anyone offered, asking a rate, accepted or booked whose
certificate is missing or runs out before their own last day; and the
open call says "not known" against each offer it applies to.

**The picker** puts people into three groups when the call needs
certificates, under the select's own headings, each in ADR 0025's order
(department, level, name): those who hold what's needed ("Hold working
at height and IPAF"), those not known ("Not known: check first"), and
those missing one ("Missing a certificate"), each line marked ("· no
IPAF", "· IPAF runs out Tue 3 Nov", "· working at height and IPAF not
known"). A call needing nothing has one list, as before. Someone in the
last group can still be picked: Offer then says why not, in place, and
sends nothing.

**Reminders.** The Crew tab has a card, "Certificates running out (4)",
listing each held certificate whose expiry has passed or falls in the
next 30 days, for everyone not archived, soonest first (so the longest
run out heads it), the first three and then "Show all". Each line has
"Ask for the new card", which opens the same panel as the other prompted
messages, with WhatsApp, Text, Email and Copy, and a message written for
it ("Hi Pádraig, our records say your IPAF runs out on 22 October. When
you've renewed it, could you send us a photo of the new card? …"). A line
leaves the list when the card says a new expiry, or No for someone not
renewing.

30 days matches what's due soon for inspections (ADR 0020), and gives
time to book a Safe Pass or IPAF renewal course, which is usually a few
weeks out; a longer window would keep a long list in view all year. The
person's card says a certificate running out within the same 30 days in
the warn tone, as it says one run out in the bad tone.

**Not on the Crew badge.** The badge counts what people have sent the
office that waits on it now: answers, leave to approve, running late.
Expiries are known weeks ahead and with a hundred crew there'd nearly
always be one, so a badge that counted them would always be lit and stop
being read. A certificate that matters to a job is on that call's line
anyway.

**History** says what a call needs: "Asked for 2 × Rigger for Harbour
Lights Festival (Load in), Sat 3 Oct to Sun 4 Oct, needing working at
height and IPAF"; "Changed the call for Stagehand on Harbour Lights
Festival: certificates needed to Safe Pass".

### Running late

**From the link, on the day.** On a freelancer's private link, for a day
they hold on a call going ahead (accepted or confirmed), from 18:00 Irish
time the evening before until the end of that day, a card at the top of
the page says "Today" (or "Tomorrow") with the job, the role, the call
time, the call sheet, and "Running late?". It takes roughly how late
(about 15 minutes, about 30, about an hour, more than an hour) or the
time they'll be there, and a note up to 200 characters. With two days
open at once (the evening of one booked day before another), it asks
which. They can change it, or say "I'm here now". Outside the window, or
for a day they don't hold, the server refuses: "You're not booked on Sat
3 Oct." or "You can say you're running late from 6pm the evening before
a day you're booked."

18:00 is the evening before: late enough that the day's plans are known,
and early enough to say it before a 7am call.

**Commands**, sent from the link like its other answers, and laid over
the office's view on a device like any change:

- `late.say`: a booking, a day, how late or a time, and a note. One
  record per booking per day: saying it again replaces it, and makes it
  new to the office again.
- `late.arrived`: they're there.
- `late.seen`: the office noted it.

The history says "Gráinne Power said they'll be about 30 minutes late
for Liffey Brands Shoot (Shoot), Fri 2 Oct: Traffic on the M50", "Gráinne
Power said they're there now, at Liffey Brands Shoot (Shoot)", and
"Noted that Gráinne Power is running late for Liffey Brands Shoot
(Shoot)".

**The record** is `runningLate`, in its own table, `running_late` (crew
migration 9): the person's id, the booking and its call, the day, how
late or the time, the note, and when it was said, when they arrived and
when the office noted it. It names the person and holds their words, so
it's in their own download from their link.

**It clears itself after the day.** Every screen and page shows a record
only until its day is over: the devices by the Irish day, the link page
and call sheet by the server's. The row stays, as an answer to an offer
does, for the history, the export and the person's own download, and it
will go with the person when erasing someone is built (ADR 0023 left
it for later).

**The office sees it at once.** It joins "Answers to check" at the top
("Gráinne Power is running late", with Ring and Noted), counted on the
Crew badge, until the office taps Noted or the person says they're
there. Until the day is over it's on the call's line ("Gráinne: about
30 minutes late, “Traffic on the M50”", or "Gráinne: there now") and on
the planner's day, under the job's day and under the person's work.

**The contact on the day sees it** on their call sheet on their link: a
"Running late" card under who to ring, with each person's number, and
against the person in the crew list. The office's call sheet in the app
says it against the person. The rest of the crew don't: how late someone
is, and why, is between them, the office and whoever is running the day,
as phone numbers are.

**It needs signal.** The link page is server-rendered: opening it and
sending need signal. The form says so, and gives the contact on the
day's number, or else the office's, to ring if it won't send. The
office's app shows it as soon as it next syncs.

### Made-up data

The riggers for Harbour Lights' load in need working at height and IPAF;
Pádraig, booked, holds both, his IPAF (3a, 3b) running out in 20 days;
Róisín, offered, holds both, her Safe Pass running out in 12; Laoise has
no IPAF. The load-in stagehands came to need a Safe Pass after Tadhg was
booked, and his runs out the day before the job ends, so the call's line
warns. A shoot today for Liffey Brands has Gráinne on camera, running
about 30 minutes late with traffic on the M50, said from her link, and
Aoife as crew chief and contact on the day, whose call sheet shows it.

## Consequences

- An offer can't go to someone the record says can't do the work, and
  the office is told the reason by name, with the fix. Nothing booked is
  undone by a lapse; it's warned about where the office looks.
- A phone still running the version from before this one keeps the new
  kinds when it edits someone, since a new kind it leaves out is kept,
  and can still clear one of the first three. Devices that haven't heard of `needsCertificates` or
  `runningLate` keep working: a call reads as needing nothing and the
  records go unshown.
- Running late is kept after its day, like every answer. If the office
  would rather it went, a nightly clear-out of rows past their day is a
  small change.
- Left for later and written here so it isn't lost: a freelancer
  uploading a photo of their renewed card from their link, which needs
  file storage; the office recording "running late" for someone who
  rang in; a needed certificate per role as a default, so a rigging call
  ticks itself; reminders sent on a schedule rather than prompted; and
  PASMA, manual handling for lifting gear, and other kinds as the office
  asks for them.
