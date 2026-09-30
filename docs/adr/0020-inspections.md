# ADR 0020: Inspections

- **Status:** Accepted, 30 September 2026. The seventh part of Phase 2.
- **Decides:** how electrical tests (PAT) and thorough examinations of
  lifting gear are recorded, one at a time or a batch by scanning; how
  each item's next one is worked out; and what failed or overdue kit does
  to what's free for jobs.

## Context

Hire kit that plugs in is tested every so often, and lifting gear
(hoists, chain, truss, shackles and slings) needs a thorough examination
by a competent person at set intervals under the General Application
Regulations (S.I. 299/2007). Today the dates live on stickers and in a
tester's spreadsheet, and nothing stops a speaker whose test has run out
from going on the van.

Faults ([ADR 0018](0018-faults-missing-kit-and-repairs.md)) brought the
idea of kit that can't go out; inspections use the same one. Testing is
often done in a batch, a shelf at a time, by a contractor who isn't on
the system, and the warehouse may have no signal.

## Decision

- **Two kinds:** the **electrical test (PAT)** and the **thorough
  examination**. A product says how often its items need each, in whole
  months from 1 to 60, or never (the default). The form suggests 12 for
  PAT and 6 for a thorough examination, the law's interval for lifting
  accessories; Session Hire sets its own with whoever does the testing.
  Only numbered products have them, as the record is per item.
- **A record** says an item passed or failed, which kind, the day it was
  done (today, or a day before for one done on paper), who did it (a
  person or a testing company, remembered on that phone), and a note
  such as a reading. Records are kept for good and never edited: they're
  the register an inspector asks for. A mistake is put right by
  recording the test again.
- **When it's next due** is the same day that many months after the
  last one passed (31 August and 6 months is 28 February). The item's
  page shows where it stands on each kind:
  - **due** on a day, with how often and when it last passed;
  - **due in the next 30 days**, listed on the Stock tab;
  - **overdue**, or its last one **failed**: it **can't go out** until
    it passes;
  - **not recorded yet**: listed, but not stopped, since its last test
    may be on a sticker. Once recorded, it's counted.
- **Where it's recorded.**
  - On an item's page, **Inspections**: where it stands, **Record a
    test**, and every one recorded, newest first.
  - **Test a batch** (from the Stock tab's **Inspections due** card):
    pick the kind and who's testing, then scan or type each item that
    passes. Each scan records a pass at once and says when it's next due:
    "SH-000123 d&b Y10P: passed, next due 30 Sept 2027." If it failed,
    **It failed** straight after records the fail. Works with no signal.
- **The Stock tab's Inspections due card** lists what can't go out
  (failed, then overdue, longest first), what's due in the next 30 days,
  and how many of each product aren't recorded yet.
- **Availability**, as for faults: kit that's failed or overdue isn't
  counted as owned when checking a job's kit ("2 owned and fit to go out
  (1 damaged, missing or due a test)"), the pick list leaves it out of
  where to find the kit, and scanning it out warns: "PAT failed on 30
  Sept 2026. Test it before it goes." The scan is still kept. A
  product's page says how many of its items can't go out, and its items
  list flags each one.
- **The server keeps every record**, as it does every scan. It turns one
  down only when the item was never saved or is retired, and says why.
  Each device works out what's due from the records, so it's right with
  no signal and on the day it runs out, with nothing to run overnight.

## Consequences

- An overdue speaker is caught on the pick list before it goes, and a
  shelf is tested with a phone and a label scanner, not a spreadsheet.
- The register for an item, and for the whole stock list, is in the
  History tab and in Download everything, with who tested it and when.
- Existing stickers are brought in by recording the last test's day on
  each item, or as a batch on the day of the next round of testing.
- Not yet: certificates as files, reminders by email before a round is
  due, user checks before each use, and hours-based servicing (lamps,
  hazers). Those can use the same record when they're needed.
