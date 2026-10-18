# ADR 0053: Tidying what came in from the calendars

- **Status:** accepted
- **Date:** 18 October 2026
- **Asked for by:** Colly, 18 October 2026 ("First two on the still to
  build please": the tidy-ups for the imported data left open by the
  [audit of 16 October](../audit-2026-10-16.md))

## Context

[ADR 0037](0037-job-kinds-and-days-gone-as-history.md) changed how the
next bring-in reads a calendar. What was already in stayed as it came.
On the live data on 18 October, after both organisers' calendars were
brought in from 19 December 2025:

- 30 jobs had been brought in as several: 132 jobs in all, the festival
  "EP" as 22 of them ("EP - LX", "EP - Audio", "EP - Smirnoff LX"),
  "District X" as 19, "ATN" as 13. A calendar with an event a department
  or stage gives a job each.
- 71 people were still named from their address ("Craicaudio").
- No job had a client, though "Verve" is in 45 names, and 34 jobs name a
  venue the app already holds ("button factory", "3 arena", "Rds").
- 137 job names start with a small letter.
- Every job card on Jobs said "No client or venue yet".
- Staff on the invite for four hires and a gig in a day showed as
  clashes, and a call for 40 with 25 held said "0/2 days filled".

Each of these is a guess about what someone meant. The app can find the
candidates; only the office knows which are right.

## Decision

**One place to tidy.** Jobs › Tidy up (`#jobs/tidy`,
`web/src/jobs/TidyScreen.tsx`) lists what the data suggests, in five
groups, each saying what it found and why. Nothing changes until someone
chooses, and every change is an ordinary command, in the history like
any other. The finding lives in `shared/src/tidy.ts`, so the same rules
can run on the import screen later. A quiet card on Jobs ("From the calendars:
30 jobs brought in as several, 71 people named from their address…") and
a line under Crew's People lead there, and after a bring-in the import screen's
last step is "Tidy up what came in". When there is nothing, the lines go.

**The same job, brought in as several** (finding 5's second half).
Two jobs are suggested as one when they are the same kind, both brought
in (or both made in the app), going ahead, within two days of each
other, and either share the part before " - " or one name starts the
other at a word boundary. Groups that share a head ("EP - LX", "EP -
Audio") come ticked; a name that merely starts another ("Addison Rae",
"Addison Rae Show") doesn't, by the Default Effect: a wrong tick costs a
job. The office names the one job, ticks, and confirms.

The new command `project.merge` keeps one job and moves everything of
the others onto it: phases, crew calls, kit lines, faults, movements,
vans, quotes and the calendar's remembered days (so a second bring-in
still knows them). Each phase is named for what its title added ("EP -
Smirnoff LX" gives the day "Smirnoff LX"), keeping a name someone chose
("Load in (FLY Travel)"); a call with no department takes one from its
title. Notes are joined, the first client and venue kept, and the widest
prep and return days. It refuses to mix a job made in the app with one
brought in, since only the second is left off the jobs calendar, and
refuses two jobs that each have a quote. The history says "Made EP - LX
and EP - Audio part of EP". It can't be split again in one go;
the question before it says so.

The bring-in itself now reads a department after " - " as a day of the
job ("EP - Smirnoff LX" is EP with a day "Smirnoff LX"), so the next one
doesn't make them apart again. A person's name after " - " ("Sreenath -
CCD") still isn't.

**People named from their address** (finding 7's rest). Everyone whose
name is just their address's first part gets a name field.

**Venues and clients in job names** (finding 8). A venue the app holds
is matched against job names however it's written ("3 arena" for
3Arena, "Rds" for "Royal Dublin Society (RDS)"); a one-word venue name
needs six letters. A job is also offered the venue other jobs of the same
name were at. None is ticked, with a "Tick all" for when the list reads
right. For clients there's nothing to match yet, so the page lists words
in three or more names that aren't venues, clients or ordinary words
("Verve, 45 jobs"); choosing one makes the client if needed and offers
the jobs that name it, ticked.

**Names starting with a small letter** (finding 15). Offered with a
capital, all at once after a question; a name like "iPhone launch" is
left alone. New names from the bring-in get the capital as they come.

**On the screens.** "No client or venue yet" shows only on a job in the
next 14 days with neither (healthy is quiet; finding 8). Repeat days
read "Show 3 times" instead of "Show, Show, Show" (finding 9). A call
says "25 of 40, both days" or "20 to 25 of 40 a day" (16 October finding
19, 18 October finding 20). The history of a bring-in says the date it
started from and what was left out (finding 10). A member of staff on
several different jobs in a day is not a clash; a freelancer still is
(finding 12).

## Consequences

- The office can make the live data look like the company in a sitting,
  and choose each change. Nothing is written to Google and nobody is
  contacted.
- Joining jobs removes the others for good. Their history entries stay.
- A department list (Audio, LX, Video, Laser, LED Tech, Backline, SFX,
  Rigger) decides what after " - " is a day. A department missing from
  it makes a job of its own, as before, and the Tidy up page catches it.
- Clients are found by word frequency, so a word that is a person
  ("Joanna") can be offered. It is only offered; nothing is ticked until
  the office picks a word.
- Still open from 16 October: long Shows as hires (11), Home as a glance
  (14), "needed" from those who accepted (16).
