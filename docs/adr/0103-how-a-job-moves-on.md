# ADR 0103: How a job moves on

- **Status:** accepted
- **Date:** 30 October 2026
- **Asked for by:** Colly ("we need to do a review of how a job moves from
  phase to phase. I tried to bring the gloss gala quote to a job but it
  wasn't very intuitive.", 30 October 2026)
- **Builds on:** [ADR 0073](0073-a-jobs-steps-and-who-has-each.md) (a
  job's steps), [ADR 0081](0081-starting-a-quote-and-following-it-up.md)
  (marking a quote sent makes the job quoted; the client's answer offers to
  put the job in step), [ADR 0092](0092-current-rms-history-on-quotes.md)
  and [ADR 0102](0102-a-job-from-a-past-quote.md) (past quotes from
  Current RMS, and a job made from one).

## Context

Three things each said where a job was, and they could disagree:

1. **The job's status** (Enquiry, Quoted, Confirmed, Cancelled, Lost): the one
   that matters, since confirmed is what puts a job on the jobs calendar and
   holds its kit. It changed only in a dropdown inside "Change details", or
   from the quote's "What happened" card once the client's answer was
   recorded there.
2. **The quote's status** (Draft, Sent, Accepted, Turned down).
3. **The steps** across the job page. Their Confirmed step ticked itself when
   the quote was accepted, and could be ticked by hand, while the job stayed
   an enquiry, off the calendar, its kit not held.

And a past quote from Current RMS for a job already here (most of them: the
calendars brought the jobs in) offered only "Make another job from this",
which makes the same job twice. There was no way to put its lines on the
job that was already here.

## Decision

1. **The steps are how a job moves on.** The head of the steps strip has one
   button for the step the job is at: Make a quote or Open the quote, Record
   the client's answer, Open Crew, Open Kit and vans, Open the pick list.
   Nothing for the show itself, or for a role that can't act on the step.
2. **The Confirmed step is the client's answer, not a tick.** It offers
   **Confirm the job** and **The client said no**. Yes confirms the job and,
   when a version of the quote went to the client, records the yes on it the
   same day; no marks the job lost (asking first when it has crew calls,
   which it cancels) and records the no, then offers to tell the crew, as
   Change details does. A draft never sent is left as it is.
3. **The Confirmed step is done only when the job is confirmed.** A quote
   accepted on a job still an enquiry or quoted is the step to take, and says
   so ("The client said yes Fri 30 Oct, and the job is still quoted"). A
   tick given by hand before this stays, with Take the tick off.
4. **A quote sent another way** (ticking Quote sent by hand) makes an enquiry
   quoted, as marking it sent on the quote does.
5. **A past quote goes on the job it's for first.** The job it's linked to,
   or else the one it most looks like by its days, client and name (the same
   matching as Match to jobs, on the device), is offered first: **Put it on
   <job>'s quote**. Its lines, charged as they were, go after the lines of
   the job's draft, or start a new version when there's no draft. Making a
   new job is the second choice, and its form says when the job is already
   here. The job's quote page has "Put its lines on this quote" under each
   past quote linked to it. A past quote not linked to the job yet is linked.
6. **A job made from a past quote opens on its page**, on the Quote tab,
   with the steps saying what's next, rather than on the bare draft.

The job's status stays in Change details, for putting right a mistake and
for cancelling.

## Consequences

- The job's pill, its quote and its steps say the same thing about whether
  it's going ahead.
- Existing kit on the job isn't touched when a past quote goes on an
  existing job's quote; its Kit card offers to add what's quoted, as for
  any quote (PR #190).
- Left open: crew lines on the quote don't become crew calls; a job made
  from a past quote is one Show across all its days, so its Prep, Build and
  Load out are added by hand.
