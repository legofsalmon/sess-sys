# ADR 0098: Claude drafts quotes from the operations mailbox

- **Status:** accepted
- **Date:** 29 October 2026
- **Asked for by:** Colly, 29 October 2026: "I'd like claude to monitor the
  operations@sessionhire.com mailbox - which will be cc'd on all
  client/operations correspondance. I'd rather this as then adam/olan etc
  can choose to have private conversations by omitting the
  operations@sessionhire.com email", then "as it monitors, I'd like it to
  start to draft quotes filling in as much detail as possible from
  overhearing on the quote email thread. We don't need any normal language
  interaction or asking claude to change option now. You can retain the
  paste box functionality but only as a secondary option."
- **Changes:** [ADR 0096](0096-claude-inside-the-app.md) (no more asking
  Claude in words to change a quote; pasting an enquiry stays, folded away)
- **Builds on:** [ADR 0008](0008-calendar-sync.md) (the Google
  key, a lasting key locked in the database),
  [ADR 0097](0097-claudes-to-do-list.md) (the to-do list)

## Context

Enquiries come by email, and the office answers them by email: the quote
grows over the thread. Colly wants Claude to follow those threads and draft
the quote as it goes, without anyone typing to Claude. Who sees a thread is
decided by the people in it: copying operations@ shares it, leaving it off
keeps it private.

## Decision

1. **operations@ is a mailbox of its own,** a Workspace user, connected once
   under Admin › Company by signing in as it. The app asks Google only to
   read its mail (`gmail.readonly`), so it can't send, reply, delete or file
   anything there. Its lasting key is locked in the database as the
   calendar's is, and handed back on Disconnect. A Google Group or an alias
   on someone's own account won't do: a group can't be read this way, and
   an alias would show Claude that person's private mail.
2. **Read every five minutes,** while Claude is on, set up and under its
   monthly limit: the mail that came since it was last read (from a week
   before it was first connected, so enquiries in hand get quotes), at most
   six threads a look, oldest first. A newsletter or receipt (a mail with a
   List-Unsubscribe or bulk header) is never sent to Claude.
3. **Claude reads the whole thread** each time it grows, without what each
   mail quotes of the last, and says whether it's a new enquiry, about a job
   already in the app (from those it's shown: enquiries, quotes and
   confirmed jobs from a month ago on), or neither; and what the thread asks
   for so far, read by the enquiry rules of ADR 0096, the later mail winning
   where it changes the earlier. Mail from @sessionhire.com is the office
   answering.
4. **A new enquiry becomes a job and a draft quote,** as Claude, through
   the same commands a person's device sends: the client and venue found by
   name or added, the job as an enquiry with its days, and its first
   draft, matched to the stock list and priced from the price list on the
   server as on a device. The job's notes say whose mail it came from. The
   history shows these changes as Claude's, "from the operations mailbox".
5. **Claude keeps its draft up to date until someone changes it.** While
   the draft's lines are still the ones Claude last wrote, a new mail
   redrafts them (and gives the job its days if it had none). Once someone
   has changed the draft, Claude is shown its lines and says what the new
   mail changes on them; that's offered on the quote, labelled as Claude's,
   to take in one press or leave, by the same card as before. Mail about a
   job that wasn't Claude's enquiry is linked to the job and read the same
   way.
6. **What Claude read is kept apart.** `mail_threads` keeps each thread's
   kind, job, count and the lines last drafted; `mail_notes` keeps its
   subject, sender, summary, questions and offered changes, and is emptied
   whenever anyone is erased (ADR 0027), since it can name anyone. The mail
   itself is never copied: it stays in Gmail and is read again when the
   thread grows. `mail_seen` keeps only Gmail's ids.
7. **Asking in words goes,** as Colly asked: no "Ask Claude to change this
   quote", and its route is removed. The paste box stays on New quote,
   folded under "Or paste an enquiry for Claude to read", for enquiries
   that came by phone or WhatsApp.
8. **Quotes shows the mailbox:** "From the operations mailbox" lists the
   threads of the last month that were enquiries or about a job, each
   opening its job's quote, with whether Claude is still drafting it or has
   changes to look at. The to-do list is told of client mail waiting a day
   or more for a reply.

## Consequences

- Copying operations@ is how the office hands a thread to Claude, and
  leaving it off is how a conversation stays private.
- Each look that finds mail costs an ask per thread, a few US cents on
  Opus 5.5; the monthly limit holds as before.
- A draft opened on a device while Claude redrafts it shows the new lines
  once it syncs; a change saved over an older copy is turned down as for
  any edit (seen.ts).
- Claude never sends anything: a draft is still checked, sent by the
  office, and marked sent as before.

## Setting it up

[Sign-in setup, step 9](../sign-in-setup.md#9-connect-the-operations-mailbox-for-claude).
