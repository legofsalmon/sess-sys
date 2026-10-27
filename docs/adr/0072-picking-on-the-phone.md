# ADR 0072: Picking on the phone

- **Status:** accepted
- **Date:** 22 October 2026
- **Asked for by:** Colly, 22 October 2026 ("after the gig is booked and
  gear sorted, consider the workflow for a member of warehouse staff or
  head of department who inherits a pick list and has to go through
  picking on their phones. What would best suit their needs?")
- **Builds on:** [ADR 0017](0017-pick-lists-and-scanning-out-and-in.md)
  (pick lists and scanning), [ADR 0018](0018-faults-missing-kit-and-repairs.md)
  (faults), and the 20 October audit's finding 5 (a line a place, done rows
  folded, the scan box kept in view, PR #120).

## Context

The office or a head puts the kit on a job; somebody else often picks it.
The person who picks it is on the warehouse floor with a phone in one
hand and gloves on, often with patchy signal, and on a load-out morning
under real time pressure ([personas](../personas.md), W and H). They
didn't plan the job, so they don't know why a line is there, when it's
needed or what it goes in. A head of audio picks the audio, not the
lighting. And the pick list read in the kit's order (by department, then
product), which is how it was planned, not how a warehouse is walked.

What they need, in the order they meet it:

1. **What am I picking for, and by when?** The job, the first day it's
   needed and where, and the vans it goes in.
2. **My part of it.** Their own department's kit, without the rest
   competing for their eye.
3. **Where to go next.** A walk round the warehouse, place by place, not
   back and forth between bays.
4. **Why it's on the list.** The planner's note on a line ("the pair with
   the new grilles", "spares, side stage").
5. **A fast, forgiving scan.** One that's easy to take back when the wrong
   label is read, and counted kit counted out without typing.
6. **A screen that stays on** between scans.

## Decision

- **Before you start.** Going out, under the total, the next phase still
  to come: "In 2 days: Load in, Thu 24 Oct at The Point" (Today, Tomorrow
  or On now when it's close), and the vehicles booked on the job with
  their drivers. A real deadline shown as information (Time Scarcity),
  never invented.
- **Whose kit.** When a job's kit is in more than one department, a row of
  buttons above the list: All, then each department on the kit, each with
  how many rows are left ("3 left", or "done"). Choosing one narrows the
  list, and the total says the department's progress and the whole job's:
  "Audio: 2 of 6 out · 20 of 40 in all". A head of department starts on
  their own department's kit (the person's department, read as a stock
  department the way Home reads it); everyone else on All. The choice is
  kept on the phone (`sh.pick`), as Home's is (Default Effect, with the
  choice visible and changed in one tap).
- **In what order.** Going out, "By department" (the kit's own order, as
  before) or "By where it's kept": each row still to pick under the place
  most of it is kept, places in the stock list's order, so the list reads
  as a walk round the warehouse; a row with none in stock goes last under
  "Nowhere in stock", and done rows fold at the end. Each row still lists
  every place it's at. Kept on the phone with the department. Coming back
  is always by department, as returns are checked by whoever owns them.
- **The kit's notes** show on each row ("Note: The pair with the new
  grilles"), named by phase when the product is on more than one line.
- **Undo.** The answer to a scan, a count, Not going or Back has Undo
  beside it, which records the opposite movement: back in for an item
  sent out, out again with the job it was out with before (another job's,
  if the scan moved it), and the count the other way. Nothing is deleted;
  the history keeps both. Undo goes once it's used or the next scan
  answers (the design system's "undo beats asking").
- **The rest in one tap.** Counted kit gets a button for the rest: going
  out, "Count out the 12", the kit's need less what's out, no more than
  is counted on the shelves; coming back, "Count back all 12". Typing a
  number still works for part of it.
- **All out says so.** "All 40 out: ready to load.", in the healthy colour
  (Goal Gradient; the reward for the work is seeing it done).
- **The screen stays on** while the pick list is open for someone who can
  send kit out (the Screen Wake Lock, where the phone has it; where it
  doesn't or it's refused, nothing changes).

## Consequences

- A head of department or warehouse hand who inherits a job can pick it
  without asking the planner what a line is for or when it goes, and walk
  the warehouse once.
- No new data: all of it is worked out on the phone from what's there, so
  it works with no signal and the server is unchanged.
- Undo is a second movement, so the item's log and History show both the
  scan and its undoing. That's honest, and the same as scanning it back.
- Not done here, for later if wanted: who scanned what (movements don't
  record a person yet), a sign-off ("picked by Aoife, 2 short, subhired")
  that the office sees, and splitting one pick list between two people by
  place.
