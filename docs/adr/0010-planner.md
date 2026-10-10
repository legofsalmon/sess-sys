# ADR 0010: The week and month planner

- **Status:** Accepted, 30 September 2026. The fourth part of Phase 1.
- **Decides:** where the office sees what is on across jobs and people,
  how a week and a month are laid out, and what counts as a clash.

## Context

Today the office sees what is on in Google Calendar's week and month
views: one all-day event per phase-day, crew as guests
([current process](../research/current-process.md)). To see who is working
when, they open the events one at a time, and a freelancer booked on two
jobs on the same day is caught by memory, if at all.

The app now holds every job with its phases ([ADR 0007](0007-jobs.md)),
the crew asked for, who has been offered and booked, and the days people
can't work, on every office device, with or without signal. The roadmap
asks for "the week and month by project and by person, with clashes
flagged".

## Decision

- **In the Jobs tab.** The jobs list gets **List · Week · Month** at the
  top. The bottom tab bar stays at five areas: a sixth would crowd a phone,
  and the planner is a way of looking at jobs. Its address says what is on
  screen (`#plan/week/2026-10-05`, `#plan/month/2026-10-01`, with `/people`
  on the end for people), so a reload or a shared link lands in the same
  place.
- **By job or by person.** By job (the default), each job with anything on
  in the week or month is a row, and each day says which phase it is, as
  the calendar titles it ("Build 1/2"), and how many of the crew needed
  are booked ("2 of 3 crew"). Crew asked for outside Jobs get a row of
  their own. By person, each person with anything on is a row, and each
  day says where they are booked, where they have been offered work and
  not yet answered, and whether they have said they can't work. Everyone
  else can be shown too, to see who is free.
- **A week in words, a month at a glance.** A week runs Monday to Sunday,
  with room for the words; on a phone it scrolls sideways, starting at
  today, with the names kept in view. A month shows every day in narrow columns, with a short
  code and a colour for each day and the words for a screen reader and on
  hover; tapping a date opens its week. The planner is the one screen that
  uses a laptop's full width.
- **What counts.** Confirmed jobs are solid; enquiries and quotes are
  dashed, as pencilled in; cancelled and lost jobs are left out. Accepted
  and confirmed offers are bookings; offered and countered ones are
  offers still waiting on an answer; declined, filled and withdrawn ones
  are left out.
- **Clashes.** A person booked on two crew calls on the same day, or
  booked on a day they can't work, is a **clash**, shown in the bad tone
  and listed above the planner, in words, with the job to open. An offer
  still waiting on an answer for a day the person is already booked, or
  can't work, is flagged **check**, in amber: it would be a clash if they
  said yes. Two open offers on one day are normal while crew are being
  found, and are not flagged. The server already refuses a Yes that would
  book someone twice, and asks for an override before an offer goes to
  someone booked or away, so clashes mostly come from a day off marked
  after the booking (by the office, or by the freelancer on their link)
  and from offers sent with an override.
- **Crew left behind by a moved phase.** Moving a phase doesn't move its
  crew (ADR 0007). The planner shows their days in amber, as "no phase
  this day" (or, when another phase is on that day, as crew from a phase
  that moved), so it is seen before the day comes.
- **Worked out on the device.** Nothing new on the server: the planner is
  built from the data each office device already holds, so it works with
  no signal, and a change made anywhere shows as soon as it syncs.
- **Looking, not changing, for now.** Changes are made on the job's page
  or the Crew tab, a tap away: a job's name, anywhere in its cell, and
  each of its days open the job (added 10 October 2026, when Colly asked
  for the days to be clickable too). Dragging a phase to other days, with an
  option to move its crew too, waits until the office has used the planner
  and knows what it wants from it.

## Consequences

- The office can see a week of jobs and crew on a phone, and a month on
  a laptop, without opening an event. Google Calendar stays as the crew's
  view of their own work.
- A clash needs a person to sort it out: the planner says who, when and
  why, and does nothing about it on its own.
- The same layout will carry kit when the warehouse arrives (Phase 2):
  a row per product, with what is booked out and what is left.
- The planner isn't in the Figma design system yet; the code is the
  reference until it is added.
