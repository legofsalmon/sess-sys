# ADR 0030: Getting kit ready and back, and kit still out

- **Status:** Accepted, 7 October 2026. The next part of Phase 2, after
  inspections ([ADR 0020](0020-inspections.md)).
- **Decides:** how long a job holds its kit around the days it's needed,
  what happens to kit still out after its job, and why availability stays
  in whole days rather than hours.

## Context

Kit on jobs ([ADR 0014](0014-kit-on-jobs.md)) holds a job's kit on the
days of its phases and no others. The architecture asks for more:
availability "per product per hour, including prep and return buffers"
([architecture](../architecture.md), "Availability"). ADR 0014 left two
gaps:

- **Getting ready and coming back take time.** Speakers for a Saturday
  show are tested, packed and loaded on the Friday, and are checked in on
  the Sunday or Monday. A job on the day before or after can't have them,
  but the app said it could.
- **Kit out past its job still counted as free.** Scans out and in are
  recorded ([ADR 0017](0017-pick-lists-and-scanning.md)), so the app knows
  when a job is over and its kit hasn't come back, but it still offered
  that kit to the next job.

Jobs are whole days in Irish time ([ADR 0007](0007-jobs.md)), so a phase
has no hours to work from.

## Decision

- **Days held around a job.** Each job holds its kit for some whole days
  before its first day, to get it ready, and some after its last, to check
  it back in. Usually one before and one after; any job can say from 0 to
  14 of each. A whole-job line is held from the first of those days to the
  last; a line for one phase from that phase's days before to its days
  after.
- **Said where it matters.** The Kit card on a job says "Kit held Fri 3
  Oct to Mon 6 Oct: a day before to get it ready, a day after to check it
  back in", with a Change link. A shortage on one of those days says so:
  "Short 2 on Fri 3 Oct, getting it ready". A job whose own Prep phase
  already covers the getting ready can say none before.
- **Kit still out after its job isn't free.** Once a job's days held are
  over, any of its kit scanned out and not back (items, and counted kit
  out less what's back or missing) is taken off what's owned until it's
  scanned in. The line says so: "2 still out after their jobs". A
  cancelled or lost job, or one with no phases, holds nothing, so its
  kit still out is counted the same way. Kit already reported missing or
  not fit to go out ([ADR 0018](0018-faults-missing-kit-and-repairs.md))
  isn't counted twice.
- **Whole days, not hours.** Phases are whole days, so the buffers are
  too. Hours would need times on phases, which the calendar events don't
  carry yet; the days held around a job are what the hours were for.
- **Same rules as before.** Worked out on each device, warned about and
  never refused. The server only checks the days are whole, 0 to 14, and
  records a change in History ("kit held no days before, to get it
  ready").

## Consequences

- More warnings at first: two jobs a day apart now share a day of kit.
  Where kit really goes straight from one to the next, the jobs say no
  days before or after.
- Jobs already in the system hold one day either side from now on, the
  default, since none of them say otherwise.
- Kit still out shows short on the next job until it's scanned back in,
  which is a nudge to scan it; a lost scan is fixed by scanning it in.
- Hours can come with times on phases, if the office asks for them. The
  days held stay as the coarse version.
