# ADR 0030: Stocktakes and rolling counts

- **Status:** Accepted, 4 October 2026. The last step of the labelling
  rollout in Phase 2 ([roadmap](../roadmap.md)): a baseline stocktake,
  then rolling counts. Colly chose it: "stocktakes and rolling counts".
- **Decides:** how a place or a case is counted on a phone with no
  signal; what the comparison with the record says and how each
  difference is put right; what a count keeps as a record; how counted
  kit out on jobs is treated; which places to count each week; how the
  baseline stocktake is run once the stock list is in; and what a count
  is to the item log, erasure, Start fresh, the history and the export.

## Context

Phase 2 is done "when a job's kit is picked and returned by scanning,
and availability for next week is trusted without walking the shelves".
Scanning out and in is built
([ADR 0017](0017-pick-lists-and-scanning-out-and-in.md)), and so are
faults and missing kit ([ADR 0018](0018-faults-missing-kit-and-repairs.md))
and the stock list's import
([ADR 0026](0026-bringing-in-the-stock-list-and-item-logs.md)). What
nothing does yet is check the record against the shelves. The stock
research ends the labelling with "a full baseline stocktake, then move
to rolling cycle counts" (§0, §5 step 6) and says how (§8): duplicate
scans of an item count once, quantities are typed for counted kit, and
counts are blind, since a counter shown "120" tends to find 120.

The real stock list (about 1,500 rows) comes in next week. Straight
after, the office will want to check every shelf against it, then keep
checking a few places each week, so the record stays right without
anyone walking the whole warehouse again.

What the app already knows, on every phone: where each item is kept (a
place, or a case, which is at a place), how many of each counted product
are at each place or in each case, what's out with which job (from the
scans), and what's reported missing or damaged. A count compares those
with what is actually there.

## Decision

### Counting a place or a case

- **Where it starts.** "Count this place" on a place's page, "Count
  what's in it" on a case's page, and the Stock tab's new **Counts**
  card, which lists what to count this week. The count in progress is
  its own page, `#stock/count`.
- **What's expected.** The items kept at the place directly, its cases
  among them, and the counted kit kept there directly; for a case, what
  the stock list says is in it directly. Items in a case at the place
  are expected in that case: counting the place checks the case is
  there, and counting the case checks what's in it. So a place's count
  never asks anyone to open every case, and a case's count is done when
  it's opened. A case is found when it's scanned or when anything in it
  is, since what's in it can't be in it anywhere else: a case opened and
  its contents scanned, its own label missed, is never said to be not
  found. In a case's count, its own label and that of any case it's in
  are what hold the count, not things in it: scanned, the answer says so
  and they aren't noted.
- **Numbered items and cases are scanned**, by the camera, a scanner
  that types, or typed, with the same lookup as the Stock search
  (`itemByCode`): an old number first, then a Session Hire number now
  or before, then a maker's serial only one item has. An item scanned
  twice counts once, and the answer says so. A number nobody has is
  noted as it's scanned, as read, without control characters and cut to
  100 characters, so a maker's QR code holding a long web address can't
  leave a count that can't be finished.
- **The tally** is big, at the top: "31 of 42 found". Expected there
  means kept there and neither out with a job nor reported missing; an
  item in repair stays expected, since a fault doesn't move kit
  (ADR 0018), and the repair bench is a place of its own if the office
  wants one. One in repair and not scanned is said as in repair ("9 of
  10 found, 1 in repair"), never as not found.
- **Counted kit is a number typed per product**, in big fields, without
  the number recorded beside it: a blind count, as the research says.
  A product left blank isn't counted; 0 means none there. "A product
  that's here but not on the list", picked by name, adds one not
  expected. Numbered products not labelled yet are counted the same way.
- **Who counted:** the signed-in person, matched by email to the Crew
  tab as for leave ([ADR 0024](0024-staff-leave.md)); while sign-in is
  off, picked on the count from the staff, the same choice the Leave
  screen remembers on that phone. It can be left unsaid.
- **Kept on the phone.** The count in progress is saved in the phone's
  browser storage on every scan and every number typed, so a reload, a
  dropped signal or the app going to the background loses nothing. One
  count at a time on a phone: starting another asks, in the app, whether
  to carry on with the one under way or discard it. Two tabs of the app
  on one phone share that count, each hearing the other's scans, so
  neither writes over them. Discarding asks first, in place, never with
  the browser's own dialog.
- **No signal needed.** Everything is worked out from the phone's copy.
  **Finish** works out the comparison, sends one command (below), and
  opens the count's page with the differences.

### What the count says, and the fix for each

The count's page says each difference in plain words, with its fix one
tap away, and "all of these" where there's more than one of a kind.
Each fix is a command that already exists, with its own rules, its own
history line and its own refusals.

| What | When | Said | Fix |
| --- | --- | --- | --- |
| Not found | Expected, not scanned | "SH-000123 d&b Y10P" under Not found | **Report missing** through the missing-kit report (ADR 0018), so it joins the repair list and scanning it later marks it found; **Report all 3 missing**. Or leave it, to look again. |
| Out with a job | Kept here, out with a job, not scanned | "Out with Nissan launch" | None: it isn't expected on the shelf |
| Already missing | Kept here, reported missing, not scanned | "Already reported missing" | None: never reported missing twice |
| In repair | Kept here, damaged and can't go out, not scanned | "In repair: blown driver" | None: never said to be missing |
| In the wrong place | Scanned here, kept at another place, in another case, or not placed yet | "Kept at Bay B1" | **Move here** (`asset.move`); **Move all 2 here**. Or leave it. |
| In a case kept here | Scanned here, kept in a case that's here | "Kept in SH-000200 (Amp rack), which is kept here", and found | None: it is where the record says |
| Retired | Scanned, but sold, scrapped, lost or stolen | "Marked as lost" | **Bring it back and keep it here** (`asset.reinstate`, then `asset.move`). One added by mistake is said, with no fix. |
| Reported missing, scanned | Scanned while reported missing | "Reported missing" | **Mark found** (`fault.close`, found, the same path a pick list takes), and keep it here if it was kept elsewhere; one in a case kept here stays in its case |
| Out with a job, scanned | Scanned here, but its latest scan was out with a job | "Recorded as out with Nissan launch" | None here, said plainly with a link to the job's pick list: the count never changes a job's scans behind its back |
| A number no item has | Scanned, matching no item | "No item has SH-000777" | None here: a link to claim the label in the Stock search |
| Counted kit | A number typed | "XLR 10 m: 95 counted, 120 recorded, 20 out with jobs or reported missing: 5 short" | **Set to 115** (`stock.set`); **Set all 2 counts** |

**Counted kit out on jobs.** Counted kit doesn't leave its count when it
goes out: 120 XLRs at Bay A3 stay 120 while 20 are at a job, and the
count is what the warehouse owns. A shelf counted while some are out has
fewer on it than the record, and setting the count to what's on the
shelf would lose the ones out, for good. What's out isn't tied to a
place either: the scans say how many of a product are out, not which
shelf they came from. So the fix is

> **set to** the counted number plus those away (out with jobs, or
> reported missing), **but never more than recorded**, unless more than
> recorded were counted.

`setTo = max(counted, min(recorded, counted + away))`. A count is short
only when even the ones away can't make up the record, and over only
when more were counted than recorded.

- 95 counted, 120 recorded, 20 out: set to 115. Five are lost, not 25.
- 100 counted, 120 recorded, 20 out: fits; nothing to set, and the
  page says the 20 not here may be among those away.
- 105 counted, 120 recorded, 20 out: fits. There may be five more than
  the record, but only once the 20 are back can anyone tell.
- 130 counted, 120 recorded: set to 130.
- Kept at two places with 20 out: whichever shelf is counted, the 20
  are taken to be from it, as far as its record allows, so neither
  count can lose them; a loss at one place may then wait until the kit
  is back, and the next count finds it.

The rule never shrinks what's owned because kit is out; at worst it
leaves a shortfall for a later count. The page shows how many are away
with each product, so the person sees why. The safest count of counted
kit is with nothing out, which the week's list can't promise, so the
rule makes any day safe.

### The count is a record

**`count.record`**, one command, sent at **Finish**: the place or the
case; when it started and finished, by the phone's clock; who counted
(a person on the Crew tab, or nobody said); what the count said of each
item (found; not found; out with a job, reported missing or in repair;
found though kept elsewhere, in a case here, retired or out with a job),
with where each was kept and the job for one out; the numbers no item
has; each product counted or expected (recorded, counted or not, and
how many were away); and a short summary in numbers (expected, found,
not found, in the wrong place, not expected, products not counted,
short and over).

- **Kept whatever has changed since**, like a scan: it records what was
  on the shelf at that moment. It's turned down only if the place or
  case never existed (never in the change feed: a place or case the
  server itself turned down, or an item whose product never was a case),
  naming which. A place removed since keeps its counts. A person named
  who isn't on the Crew tab, or who has been erased on request since, is
  left out rather than turning the count down.
- **The fixes are not in it.** Each is its own command, sent from the
  count's page, so each is checked by its own rules when it's made, can
  be turned down on its own, and has its own line in the history and the
  item log.
- **The count's page** (`#stock/count/<id>`) says the comparison as the
  record has it, and whether each fix is still to do from what the
  phone holds now: an item since reported missing shows "Reported
  missing", one moved here shows "Moved here". So it's right after a
  reload, on another phone, and when a fix was made somewhere else. A
  fix is offered only while the record is as the count found it: counted
  kit whose count has changed since (counted again and set, say) says
  "The record has changed since: 16 now", and an item moved on somewhere
  else since says where it is now, each with no fix, so opening an older
  count never undoes a newer one.
- Counts sync to every device (entity `count`), so "last counted" and
  the week's list show with no signal.

### Last counted, and the item log

- **A place's page and a case's page** say when each was last counted
  and by whom, with its summary ("Last counted Sat 3 Oct 2026 by Cian
  Murphy: 9 of 10 found, 1 not found"), and list its counts, newest
  first, each opening its page.
- **The item log** gains what a count said about the item, without
  flooding it: "Found in the count at Bay A3", "Not found in the count
  at Bay A3", and "Found in the count at Bay A3, kept at Bay B1". The
  move that follows is the log's own "Moved to Bay A3". Kit away (out
  with a job, already reported missing, in repair) and not scanned gets
  no line: the count said nothing new about it. So a place counted each
  quarter adds four lines a year to each item there. The phone builds
  these from the counts it holds, and the server from its history, keyed
  `count:<id>`, joined as the rest of the log is.

### Rolling counts

- **Places, not products.** A count is a walk to a shelf; the research's
  counting by value (A items monthly, C items twice a year) would send
  the counter to every shelf for a few items each. That can come later
  if the office wants it, as an order within a place.
- **Cases are counted on demand**, not on the rolling list. Each place's
  count checks its cases are there; what's in a case is checked when it
  comes back from a job (its pick list) and whenever it's opened, from
  its page. Session Hire has hundreds of cases, most of them sealed
  racks whose contents travel together: on the rolling list they would
  bury the shelves. A case's page says when it was last counted, so a
  case not opened in a while is easy to see.
- **This week's list** is worked out on each phone from the counts it
  holds, with no settings. A quarter is 13 weeks, so every place is
  counted about once a quarter when `ceil(places ÷ 13)` are counted each
  week: 40 places is 4 a week. The list is every place never counted,
  then the places counted longest ago, enough to make up the week's
  number less those already counted since Monday. Places never counted
  are in order of name, "Bay 2" before "Bay 10". Once a week's places
  are done, the card says so and names the next, so the office can get
  ahead.
- **How far the cycle has got:** "28 of 40 places counted in the last 13
  weeks", on the card.
- **No settings.** The quarter is a constant (`ROLLING_WEEKS` in
  `shared/src/counts.ts`), as is the rule. A setting would be a number
  nobody changes; if the office wants a month or a half-year, it's one
  line.

### The baseline stocktake

The first full round is the baseline. Once the stock list is in
(ADR 0026, after Start fresh), every place is new, so every place is on
the week's list under "Never counted". The office:

1. Counts each place from the list, or from its page while walking the
   warehouse, a bay at a time, by scanning each label and typing each
   count. Several phones can count different places at once.
2. Opens each case that isn't sealed and counts it from its page; sealed
   racks are checked by their place's count.
3. Puts right what each count found, from its page: moves, missing
   reports, counts set. What's not found is best left a day or two, then
   reported missing if it hasn't turned up, so it joins the repair list.
4. Is done when the Counts card says every place has been counted:
   "40 of 40 places counted in the last 13 weeks". From then on, the
   week's list keeps every place within a quarter.

Labels go on as the baseline walks the shelves, as the research
suggests: a number scanned that no item has is listed on the count, with
a link to claim it in the Stock search.

### Erasure, Start fresh, the history and the export

- **Who counted is a pointer to a person**, kept when they're erased
  ([ADR 0027](0027-erasing-a-person-on-request.md)): a count is a
  warehouse record, not the person's. It's needed for what was found
  where, not for who found it, and no law asks for the name, so it reads
  as their name reads: "Erased person", or their name while it's kept
  for their pay or leave records, and then "Erased person". A count is
  never deleted for them. `server/src/erasure/places.ts` lists it with
  the other pointers to people from records that aren't theirs, and
  ADR 0027's table has its row.
- **Start fresh** clears counts with everything else.
- **The history** says each count in words: "Cian Murphy counted Bay A1:
  9 of 10 found, 1 not found, 1 count short", naming who counted as the
  count was kept, so one naming nobody the server knew reads "Counted
  Bay A1". The not-done list says "Record the count of Bay A1".
- **The export** describes the `counts` table.
- **Made-up data** has three past counts: Bay B1 forty days ago, all as
  recorded; Bay A2 twenty days ago, all as recorded; and Bay A1 five days
  ago with a speaker not found and the uncounted speakers one short,
  left for the office to look into. Van 1 has never been counted, so
  it's first on the week's list.

### Built

- `shared/src/counts.ts`: the record, its command, the summary's words.
- `shared/src/sync/counts-view.ts`: the comparison (`compareCount`), the
  counts each device holds, last counted, each item's lines for its log,
  and the week's list.
- `server/src/stock/counts.ts`: `count.record`, stored in `counts`
  (stock migration 9).
- `web/src/stock/Counts.tsx`: the Counts card, the count in progress,
  the count's page and last counted.

## Consequences

- The baseline can start the day the stock list is in, on any number of
  phones, with no signal in the bays, and what it finds is put right
  with the commands the office already knows.
- After that, about one place in thirteen a week keeps the record within
  a quarter of the shelves, which is what "trusted without walking the
  shelves" needs.
- A count holds what it said of every item, so a place of 300 items
  makes a record of a few tens of kilobytes; every phone keeps every
  count. At 40 places a quarter that's a few megabytes a year, which
  phones can drop the oldest of later if it matters. A count holds up to
  5,000 items, a few hundred kilobytes, so counts waiting on a phone go
  up with the rest of what it sends; a place bigger than that, which
  Session Hire hasn't got, would be split into shelves.
- Counted kit out on a job can hide a loss until it's back; the next
  count finds it. A count with nothing out is exact.
- A case's contents are only as fresh as the last time it was opened,
  which the case's page says.
- Not yet: counting by value within a place, a count of a whole product
  wherever it's kept, photos on a count, and the count printed on
  paper.
