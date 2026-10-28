# ADR 0081: Starting a quote and following it up

- **Status:** accepted
- **Date:** 27 October 2026
- **Asked for by:** Colly, 23 October 2026 ("Consider the users to aim for
  ease of use, clarity and excellent UX"), part 1b of the quoting plan.
- **Builds on:** [ADR 0042](0042-quotes-prices-and-a-money-view.md) (quotes),
  [ADR 0080](0080-a-quote-that-saves-itself-and-keeps-up-with-the-job.md)
  (the editor), [ADR 0069](0069-to-sort-out-today-and-ahead.md) (Notifications'
  "To sort out").

## Context

From the plan's walk through the quote screens:

- **A quote could only start from a job's page.** A phone call asking "what
  would it cost" meant making the job first, with its status, kind and
  phases, then finding its Quote tab.
- **The quote and the job didn't agree.** Marking a quote sent left the job
  an enquiry; the client accepting left it unconfirmed, so it wasn't on the
  jobs calendar and held no kit, until someone remembered to change it on
  the job page.
- **Nothing said a quote was waiting.** Money showed months and who owes,
  but not which quotes had gone two weeks with no answer, so following up
  rested on memory.

## Decision

1. **New quote on Money.** The job in a few words (name, client, venue,
   first and last day) makes an enquiry with its days as one Show, and opens
   its first draft, at the client's usual discount. Clients and venues not
   yet known are added as typed, as on Jobs.
2. **Sent makes the job quoted.** Marking a quote sent moves an enquiry to
   quoted, since that's all quoted means. A job already confirmed or
   stopped stays as it is.
3. **An answer offers to put the job in step**, not by itself. Accepted:
   "Confirm the job" (it goes on the calendar and holds its kit). Turned
   down: "Mark the job lost" (its crew calls are cancelled). Each says what
   it will do, on the quote and in Money's list, because those are bigger
   than a label.
4. **Quotes on Money**, at the top: answered with the job not in step; sent
   and waiting for an answer, with "worth a call" after a week
   (`CHASE_AFTER_DAYS`); drafts not sent. The longest waiting first, each
   with the client, version, amount and how long.
5. **Quotes to follow up on Notifications**, for the office and directors,
   beside "To sort out": only the ones to act on (a week with no answer, or
   answered and out of step). Worked out on the device, so it shows with no
   signal.
6. **The app contacts nobody.** The lists say who to ring; the office rings
   or emails the client themselves, as with sending the quote.

## Considered

- **Confirming the job when the quote is accepted, by itself.** Confirming
  holds kit and writes the calendar (when that's switched on); losing a job
  cancels crew calls. A director should see those happen, so it's one press
  instead.
- **A reminder sent to the client.** Out: the app sends nothing to anyone
  until Colly says otherwise.
- **Following up from "To sort out" itself.** That list is crew clashes for
  whoever books crew; quotes are for whoever sees money, so they're a
  section of their own beside it.

## Consequences

- `quotesToFollow` in the money view; no new records or commands. Starting a
  quote is the same three changes the app already makes (a job, a phase, a
  quote), queued on the device.
