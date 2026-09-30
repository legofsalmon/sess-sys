# ADR 0018: Faults, missing kit and repairs

- **Status:** Accepted, 30 September 2026. The sixth part of Phase 2.
- **Decides:** how damaged and missing kit is reported, on return from a
  job or anywhere else; the repair list; how a fault ends; and what kit
  that can't go out does to what's free for jobs.

## Context

Kit goes out to jobs and comes back by scanning
([ADR 0017](0017-pick-lists-and-scanning-out-and-in.md)). What comes back
isn't always what went out: a speaker with a blown driver, a cable cut
near the plug, a mic left in a hotel. Today that lives in someone's head
or on a whiteboard, and availability counts the broken speaker as ready
for the next job.

The architecture's rule for scans holds here too: a report records
something that already happened, so it's kept, whichever phone sends it
and whenever it syncs. The stock list is still filling up, so faults are
needed for counted kit (cables, clamps, and numbered products not
labelled yet), not only for labelled items.

## Decision

- **A fault** is a numbered item, or some of a counted product, reported
  **damaged** or **missing**, with what's wrong (or where it was last
  seen), the job it came back from, if any, and when, by the phone's
  clock. Damage says whether it can still go out, such as a dented case
  that works fine; missing kit never can.
- **Where it's reported.**
  - Coming back on a job's pick list: after an item is scanned back,
    **Report damage to SH-…**; each item still out has **Missing** beside
    **Back**; counted kit has **Missing** beside **Back** in its count,
    and **Report damage to counted …** once some are back.
  - On an item's page, and for counted kit on its product's page:
    **Report damage** and **Report missing**, at any time.
- **Kit reported missing from a job isn't out with it any more**, nor
  back: the pick list counts it as missing, and the Stock tab no longer
  lists the job as having kit still out because of it. A missing item
  that's scanned, on any pick list, is **marked found** at once and the
  answer says so. Scanned out again, it's out again.
- **The repair list** is the Stock tab's **Faults and repairs** card:
  every open fault, damaged ones then missing, oldest first, each linking
  to its item or product. Each has **Repair notes** (what's been done,
  such as "sent to d&b for a new driver, €180") and how it ends:
  - damaged: **Fixed**, **Not faulty**, or **Write off**;
  - missing: **Found**, or **Write off**.
- **Writing off** retires an item, as scrapped when damaged or lost when
  missing, in the same change; a case with kit in it is emptied first. For
  counted kit it takes that many off the counts, from the biggest count
  first. Nothing is deleted: the fault, and the item, stay in the history,
  and a retired item can still be brought back.
- **Availability.** Kit with an open fault that stops it going out
  (missing, or damaged and not fit to use) isn't counted as owned when
  checking a job's kit, so the job's page and the Stock tab's Kit short
  list say so: "Short 1: 2 owned and fit to go out (1 damaged or
  missing)". The pick list leaves those items out of where to find the
  kit, and warns when one is scanned out anyway: "It's reported damaged,
  can't go out: Blown driver. Check it before it goes." The scan is
  still kept.
- **An item's page** says its fault at the top ("Fault: Damaged, can't go
  out: Blown driver") and lists its faults, open ones first; a product's
  items list flags the ones that can't go out.
- **The server keeps every report**, as it does every scan. It turns one
  down only when the item, product or job was never saved, or the item is
  already retired (sold, scrapped, lost or stolen), and says why. A fault
  is closed once: closed the same way twice (two phones) is fine; closed
  another way is turned down with how it was closed.

## Consequences

- Returns are checked on the same page as they're scanned, with no
  signal, and the office sees what came back broken or didn't come back
  as soon as the phone syncs.
- What's free for next week's jobs no longer counts kit on the repair
  bench or lost on site.
- The repair bench can be a place in the stock list: moving kit there is
  still up to the person, as a fault doesn't move anything.
- A case reported missing takes what's in it along, as a scan of the
  case does; writing a case off needs it emptied first.
- Costs of repairs are in the notes for now; a proper repair cost, the
  supplier it went to, and charging a client for damage come with
  finance.
- PAT tests and inspections (due dates, results, and kit unavailable when
  overdue) are the next part, and use the same idea of kit that can't go
  out. So are faults reported on site by crew (Phase 5, with Crewbox).
- Scans that don't match the plan are said as they happen and fixed by
  scanning; a separate list for sorting them out later isn't needed yet.
