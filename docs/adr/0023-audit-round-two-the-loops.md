# ADR 0023: Round two of the audit: closing the loops

- **Status:** Accepted, 1 October 2026. Built after round one of the
  audit's fixes ([the audit](../audit-2026-09-30.md), findings 7 to 15).
- **Decides:** how people and crew calls are corrected after they're
  made, how the office and the crew are told about what changes, how a
  freelancer comes back to the office, and how the device keeps its copy
  without rebuilding, saving or fighting over it.

## Context

The audit found that the app starts loops it doesn't finish. A person
or a crew call, once made, couldn't be changed; a phase that moved left
its crew on the old days. The app sends nothing itself, by design, but it
never prompted the office to send anything after the offer either, and
the office wasn't told when answers arrived. A booked freelancer had no
way to say they couldn't make it, and no page carried the office's
number. Refusals showed on the wrong screen or as browser alerts. And
every 30 seconds the app rebuilt and re-saved everything, whether or not
anything had changed, on storage that could hang or go blank.

## Decision

**People can be corrected.**

- Every field the Add form takes can be edited, with the same
  `person.upsert` command. The server keeps what a device doesn't own
  (the link token, whether they're archived), so an edit from an old
  copy never undoes either.
- A person is **archived**, never deleted: `person.archive` with a
  flag, so they can be brought back. Archiving is refused while they
  hold an open offer or an accepted or confirmed booking from today on,
  naming the job; a job long over never blocks it. Archived people leave
  every picker (Offer to…, the contact on the day, the planner's lanes),
  can't be offered work or named as a contact, aren't matched by the
  calendar import, and their link and calendar feed answer "gone". A
  phase that already names them as contact keeps them until it's
  changed. Their past bookings, timesheets and history stay.
- Freelancers fix their own phone and email on their link, with
  `person.contact`, which the server runs only for the link's own
  person and which carries only the fields sent. The history names the
  fields, never the values.
- The right to erasure (their details removed, not just archived) is a
  later item. The download exists; the deletion doesn't.

**Crew calls can be changed, and a phase that moves takes its crew.**

- `call.update` changes a call field by field, as `phase.update` does a
  phase. When the dates change, every offer's days follow: someone
  holding all the old days holds all the new ones; someone holding
  chosen days keeps the ones still in range; anyone accepted or
  confirmed who would be left with no days stops the change, by name,
  so the office releases them or keeps their days. Needing fewer people
  than are held is refused. A new rate reaches only offers nobody has
  answered; anyone who has accepted, asked for a rate or been confirmed
  keeps what was agreed, and the form says so. A booked person is never
  moved onto a day they marked off.
- `phase.update` takes `moveCrew`. When the phase's dates change and the
  office says "Move them", its open calls shift with the phase's start
  and are kept inside it, and their offers' days shift the same way,
  under the same refusals. A phase that only gets longer hasn't moved,
  so nothing is asked and nobody moves. "Keep their dates" leaves the
  calls where they were, with the existing warning.
- **Booked means confirmed.** Someone who has accepted is "to confirm".
  The job page, the jobs list, the planner, a person's row and the call
  sheet all say the same.

**Telling people.**

- After Confirm, Withdraw or Release, a cancelled or lost job, a changed
  call, a moved phase, and an approved or reopened timesheet, the app
  opens the Send panel with a message written for that event, in the
  voice of the offer message, to send by WhatsApp, text, email or copy.
  For several people at once it steps through them. The app still sends
  nothing itself ([ADR 0002](0002-crew-booking-links.md)).
- The office is told. The Crew tab carries a count of answers to check.
  Declines and pull-outs join "Answers to check" and stay until the
  office taps Noted (`offer.seen`), or offers the call to someone else
  from that row; accepted and countered answers leave it through Confirm
  and Withdraw as before. Each row says what it needs: "The call is 1
  short", "Was down for 2 days".
- **Office details** are a setting of their own: name, phone and email,
  set on the Account tab and shown as tel: and mailto: links on every
  freelancer page (the offer page, the call sheet, the timesheet).
  Nothing is shown until something is set. They live in their own small
  module, with its own table and version, so they never fight the crew
  tables' migrations.
- **"Can't make it."** On an accepted or confirmed offer, the freelancer's
  page offers a collapsed "Can't make it any more?" with a note. It's an
  answer, `offer.respond` with `pullOut`, allowed only from those two
  states and never for a job already over, and it gives the offer a new
  status, **pulled-out**: not holding, not open. The call's held count
  drops, the call reopens if it was full, the call sheet and feed leave
  them out, and the office sees it unseen in Answers to check. Anyone
  told the call had filled stays told; the office re-offers.

**The device's copy.**

- A sync round that pushed nothing and pulled nothing saves nothing and
  tells no screen. The view is built once per change (a version counter,
  the connection and the Irish day key it) and handed out until
  something changes, including the day turning. A poke reads the cursor
  without building a view.
- The three rebuild hotspots give the same answer another way: offers
  grouped by call once, one date formatter, one collator. At 31 times
  the made-up data the rebuild fell from 44 ms to 18 ms and the idle tick
  from 137 ms to 3 ms, which is the pull's round trip, not the device's
  work.
- Storage fails safely. A save that aborts settles, with "This phone is
  out of storage" when that's why, and the change is taken back with
  the reason. If IndexedDB is missing or won't open, the app runs from
  memory with a banner saying nothing is kept. Two tabs never fight: the
  tab holding the Web Lock syncs and saves, another shows "The app is
  open in another tab" with "Use this tab", and without Web Locks the
  newest tab wins. A start-up that fails shows a card with the reason
  and Try again, never a white page.

**Refusals, where they happen.**

- One count in every screen's top bar, beside what's waiting: "1 not
  done", in the bad tone. It opens the one list of every area's server
  refusals, wherever the page is scrolled to: what was asked, in words,
  when it was asked and turned down, the reason, and Dismiss. The
  per-area "Not done" cards are gone; the top bar is the whole list.
- One `act()` for the whole app. Every change goes through it; a local
  refusal (the shared schema, the view guard, "this phone is out of
  storage", "the app is open in another tab") is shown in a line where
  the action was, never in a browser alert. The schema's wording never
  reaches the screen: every typed field has a plain sentence ("How many
  is a whole number from 1 to 100."), and anything else becomes one
  general sentence. A form keeps what was typed when its change is
  refused, so the reason points at the field it means.
- Every "are you sure?" is a question in place: the consequence in
  words, two buttons (the safe one first and focused), the fields held
  still, and a way back. Nothing blocks the page.

**Money reads as typed.** One parser in `shared/src/money.ts` takes
"€1,250", "1 250,50", "1.250,50", "250.5" and "250"; a single separator
with three digits after it is a thousands mark, and with both a comma and
a dot the last one is the decimal point. Nonsense is refused in words
("Put in a price like 250 or 1,250.50."). Every money field in the app
and on the freelancer's link uses it, and the link's inputs no longer
carry a pattern that would stop "€300" at the browser.

## Consequences

- Nothing a person or the office has agreed changes silently: every
  rule above refuses by name rather than un-booking someone, and the
  prompt after each action puts the telling in the office's hands.
- Three new states to know: an archived person, a pulled-out offer, an
  answer seen or not. Older devices that don't know them keep working:
  an unknown status shows as its plain text and a missing flag reads as
  false.
- Two things left for later and written down here so they aren't lost:
  the right to erasure, and a "running late" note on the day, which the
  architecture promises alongside "can't make it".
