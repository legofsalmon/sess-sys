# ADR 0022: Timesheets

- **Status:** Accepted, 30 September 2026. The second part of Phase 3
  built after crew booking, after call sheets
  ([ADR 0021](0021-call-sheets.md)).
- **Decides:** what a freelancer's timesheet holds, when and how they send
  it, how the office checks and approves it, and what the freelancer sees
  afterwards.

## Context

Phase 3 is done when crew are "booked, briefed and paid from the
system". Booking and call sheets are built; being paid is not. The
roadmap's next step is timesheets from the bookings, then ready-made
freelancer invoices from them.

The architecture described a timesheet as "actual hours per assignment".
Colly has since said that Session Hire's freelancers bill a **day rate**,
not hours. So what the office needs to pay someone is the days they
worked, at the rate agreed on the booking, and the extras they paid out
on the job: parking, tolls, mileage, or anything else agreed.

Each booking already holds the days and the agreed rate. It is an offer
the freelancer accepted, perhaps for only some days or at a rate they
countered, and the office confirmed. Most freelancers don't use the app,
so, as with offers and call sheets, their side has to work from their
private link with no app, login or script
([ADR 0002](0002-crew-booking-links.md)).

## Decision

- **One timesheet per booking.** It has the booking's own id, so there
  can never be two. It holds the days worked, the day rate, the extras
  (each a line of what and how much, up to ten) and a note from the
  freelancer. The total is the days times the rate, plus the extras.
- **Only a freelancer's confirmed booking, from its first day, on a job
  going ahead, has one.** Staff are paid through payroll, so theirs have
  none. A booking only accepted waits for the office to confirm it. The
  server, the app and the freelancer's page all use the same check,
  so they agree.
- **The freelancer sends it from their private link.** Their page lists
  their timesheets: to send, sent, and approved lately. Each is a page
  of its own, at /f/‹link›/timesheet/‹booking›, with their booked days
  ticked, rows for extras and a note, sent with an ordinary form. They
  can change it until the office approves it. They can only tick days
  they were booked for; anything else goes to the office.
- **The office checks and approves it in one step.** The Crew tab
  lists timesheets to approve, bookings over with nothing sent yet, and
  those approved lately. Opening one lets the office change the days
  (any of the job's, for work beyond the booking), the rate and the
  extras. It also has a note saying why and a preview of what the
  freelancer will see changed; **Approve** then settles it with those
  figures. For someone who won't send one, the office fills it in and
  approves it. **Ask** sends a link straight to the freelancer's own
  timesheet by WhatsApp, text or email.
- **What was sent is kept beside what was approved.** The freelancer's
  page shows the approved total, each line, and the office's changes in
  words: "Mileage: €20, not €25.50", "Left out: Dinner €22", with the
  office's note. The history keeps every version too.
- **Approved is settled.** The freelancer can no longer change it; the
  office reopens it to change it. Approving again with the same figures,
  as a phone sending twice does, changes nothing. Approving with
  different figures is turned down until it's reopened.
- **It works like the rest of the app.** On a phone with no signal the
  office's approvals wait and sync later; the server has the final say.

## Consequences

- The office no longer collects days and receipts by message. Every
  booking that has happened shows whether its timesheet is in.
- Half days, overtime and a different rate for some days are not fields
  of their own. The office changes the rate or adds an extra line, with
  a note. If they turn out to be common, they can be added.
- Receipts aren't uploaded yet: freelancers keep them, and the note says
  where they are.
- A timesheet sent before its job was cancelled stays to be settled. A
  booking cancelled before the work gets none; a cancellation fee is
  agreed with the office for now.
- **Next: ready-made freelancer invoices.** An invoice will gather each
  freelancer's approved timesheets, for them to accept in one step,
  with its payment status on their page. Once a timesheet is on an
  invoice, reopening it will be refused.
