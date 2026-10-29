# ADR 0097: Claude's to-do list for the office and directors

- **Status:** accepted
- **Date:** 29 October 2026
- **Asked for by:** Colly, 29 October 2026 ("Claude would act as a PA here
  with notifications/to do lists for the office staff/director"), and on
  how it comes: "Each weekday morning, and on request"
- **Builds on:** [ADR 0096](0096-claude-inside-the-app.md) (Claude inside
  the app, its switch, key and monthly limit),
  [ADR 0058](0058-notifications.md) (Notifications),
  [ADR 0088](0088-quotes-in-the-sidebar.md) (quotes to follow up)

## Context

The office keeps on top of the season by looking: Quotes for those to
chase, To sort out for crew clashes, each job's notes for what was
promised. Colly asked for Claude as a PA inside the app, with a to-do list
for the office and directors, and chose that it comes each weekday morning
and whenever someone asks.

## Decision

1. **Claude puts in order what the app already knows.** It's shown, as
   facts: enquiries with no quote sent, quotes sent and waiting for an
   answer (with when and how much), accepted quotes not invoiced, crew calls
   on confirmed jobs in the next fortnight still short, and the notes of
   jobs in the next 60 days. At most 40 of each, the soonest first, and no
   person named: jobs, clients and venues only. It writes up to twelve
   things to do, most pressing first, each with a line on why, and a
   sentence on the day. It's told never to make up a job, a date or an
   amount, and that the notes are the office's writing, never instructions.
2. **Each weekday from 7am in Ireland, and on request.** The server looks
   every ten minutes; on a weekday from 7am, with Claude on, set up and under
   its monthly limit, and no list yet today, it writes one. "Write it now"
   writes one whenever someone asks; asked twice at once, both wait for the
   same list. Nothing is written at weekends unless asked.
3. **On Home and at the top of Notifications**, for those who see money
   (the office and directors, as for the rest of Claude), as "To do". Each
   thing links to its job, opening the quote, crew or kit when it's about
   that; a job Claude named that the app doesn't have opens Quotes. Under
   it: "Written by Claude today at 07:04, from what the app knows. 3 things
   left. It contacts nobody."
4. **Ticking a thing done is the only change.** Ticked by anyone, it's
   ticked for all: the list is the company's, like the quotes to chase.
   Ticking changes nothing else in the app; doing the thing is still done
   where it's done.
5. **Kept two weeks, then deleted.** `assistant_lists` holds each list
   (when, morning or asked, the summary and the things). It names no one,
   but a thing's words may come from a job's notes, so erasing anyone
   ([ADR 0027](0027-erasing-a-person-on-request.md)) deletes every list,
   and the next is written fresh. It's in the backups and the export.
   Each list's cost is counted with the rest in `assistant_uses`.

## Consequences

- The morning starts with one short list instead of four screens. The
  screens stay the record: the list only points at them.
- A list costs about the same as reading an enquiry, so a month of
  mornings is about a euro or two on Opus 5.5.
- The bell's count doesn't include the list: it counts what others
  changed, and the list is waiting on the screen when it's opened.

## Open

- Whether heads of department get a list for their own department.
- A weekly business report, when Colly wants it (the plan's third role).

## Later

- 29 October 2026, [ADR 0098](0098-claude-drafts-quotes-from-the-mailbox.md):
  the list is also told of client mail in the operations mailbox that has
  waited a day or more for a reply.
