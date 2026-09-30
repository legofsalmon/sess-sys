# ADR 0017: Pick lists, and scanning kit out and back in

- **Status:** Accepted, 30 September 2026. The fifth part of Phase 2.
- **Decides:** what a job's pick list shows, how kit is scanned out to a
  job and back in on a phone with no signal, how the app knows what's out
  where, and what it does when a scan doesn't match the plan.

## Context

A job's kit is a list of products and how many
([ADR 0014](0014-kit-on-jobs.md)). Items have labels
([ADR 0015](0015-printing-labels.md)) and the phone's camera reads them
([ADR 0016](0016-camera-scanning.md)). What's missing is the warehouse
floor: finding the kit for a job, taking it out, and knowing it all came
back.

The architecture sets the rules ([architecture](../architecture.md),
"Why commands"): a scan records something that already happened, so it
is never refused. The warehouse keeps working in a dead spot, and a scan
that doesn't match the plan ("scanned out for Nissan but it's on Fuel")
is shown for a person to sort out, not undone. The stock list is still
filling up, so some of a job's kit will be counted, not labelled.

## Decision

- **Each job has a pick list** (#jobs/‹job›/pick), opened from the Kit
  card on the job's page. One row per product on the job's kit: how many
  the job needs from Session Hire's own (lines for different phases added
  up; subhired ones left out), how many are out, and where to find the
  rest: each place with the numbers of the items there, what's in cases,
  and what's counted. Rows go by department, as on the job's page.
- **Going out, and Coming back.** The page has two modes. Going out, each
  item scanned is recorded as out with this job; coming back, as back in.
  Scanning is by the camera (Scan, as in the Stock search) or a scanner
  that types, into the page's own field. A maker's serial works as it
  does in the search.
- **What a scan says.** Each scan is answered at once in words: "SH-000123
  d&b Y10P: 3 of 8 out." And when it doesn't match the plan, it says so
  and records it anyway:
  - not on this job's kit: "Not on the kit for Nissan. Out anyway: add it
    to the kit, or scan it back in if it isn't going";
  - more than the job needs: "9 out; Nissan needs 8";
  - still out with another job: "It was out with Fuel; now it's out with
    Nissan";
  - retired: "It's marked as sold";
  - coming back, it went out with another job: it's back in, and the
    answer says which job it came back from.
  An item already out with this job, or not out at all when coming back,
  is said so and not recorded twice.
- **Counted kit** (cables, clamps, and numbered products not labelled
  yet) is counted out and back: a number and Out, or Back, on its row.
- **Cases.** Scanning a case scans everything in it, as the stock list
  says it holds, as the architecture has it for sealed cases. An item
  taken out of the case and scanned on its own after that is on its own
  again: the latest scan of the item, or of any case it's in, says where
  it is.
- **A scan is a movement:** the job, out or back, the item or the product
  and how many, and when it happened on the phone. Movements are kept for
  good. Where an item is kept (its place or case) doesn't change when it
  goes out: out and back are worked out from the movements on each
  device, so the pick list works with no signal and catches up as other
  phones' scans arrive, ordered by when they happened, not when they
  synced.
- **The server records every scan**, whoever sends it, whatever the plan
  says. It turns one down only when what it names was never saved (a job
  or an item that the server itself refused), and says which, so the
  scan can be done again.
- **Where it shows.** The pick list; "Out: 12 of 40" on the job's Kit
  card; an item's page says which job it's out with and since when; and
  the Stock tab lists jobs going out in the next 14 days or on now, with
  how much is out, and jobs over with kit still out.
- **Undoing a mistake** is scanning it back, or Not going on the item's
  row, which records it back in. Nothing is deleted.

## Consequences

- Kit can be picked and returned on any phone, with no signal, and every
  phone agrees afterwards on what's out, whatever order the scans arrive
  in.
- The pick list adds up a job's lines, even where one phase's kit could
  be reused for another, since kit sent to a site usually stays.
- Kit out after its job has ended isn't yet taken off what's free for the
  next job: the Stock tab's list of jobs with kit still out is the
  warning for now. Availability from movements, prep and return days
  comes with the next parts.
- Missing and damaged items on return, faults and repairs come next,
  with the Stock tab's list becoming the place scans that didn't match
  are sorted out.
- A case's contents are what the stock list says now; packing a mixed
  case for one job, and checking it against what went out, comes with
  the next parts too.
- Movements grow by a few thousand a month at most, and every phone
  keeps them all for now. If that gets slow, phones can keep just the
  recent ones.
- Printing a pick list on paper comes later, with document templates.
