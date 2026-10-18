# ADR 0048: Messages to crew are off until the office says so

- **Status:** accepted
- **Date:** 18 October 2026
- **Asked for by:** Colly, 18 October 2026 ("Go" on the quiet switch, finding
  3 of the [audit of 16 October](../audit-2026-10-16.md))

## Context

The app never sends a message itself: an offer, a call sheet, a timesheet
request, a certificate reminder and the word after a change each open a
WhatsApp, text or email to the person with the words filled in, for
someone in the office to send ([ADR 0002](0002-crew-booking-links.md),
[ADR 0021](0021-call-sheets.md)). That was the right line while every
person in the app was made up. Since 16 October the app holds two
organisers' calendars: 903 real jobs and 91 real people with their phone
numbers and private links. Every "Offer…", "Send", "Tell" and "Ask" now
composes a message to a real freelancer about a real job, and the office
has a season of imported data to tidy before any of it should go out.

Colly's standing rule is that the app contacts nobody until they say
otherwise. The audit rated this a 3: a mis-tap while tidying sends a
WhatsApp to a freelancer about a job in October, and it cannot be unsent.

## Decision

1. **One company-wide setting, "messages", with `promptMessages` to it,**
   beside the office's details and what heads read
   ([ADR 0046](0046-departments-on-calls-and-what-each-role-reads.md)).
   The command `messages.prompt { on }` needs the `settings` ability
   ([ADR 0034](0034-roles-and-what-each-can-change.md)): the office and directors.
   It goes in the history as "Turned on messages to crew".
2. **Off is the default.** No row means off, so a company that starts from
   a calendar import starts quiet, and so does this one on deploy. Off is
   the safe, reversible choice (Default Effect, pre-choosing the safe
   option); on is the choice that is made, once. Made-up data turns it
   on, so the demo shows the Send panel.
3. **While off, nothing opens.** The offer is still made, the call still
   changed, the timesheet still approved: the data is the same and every
   private link says so at once. In the Send panel's place a card says
   "Messages to crew are off", who would have been sent what, that their
   link already says so, and links to Admin for those who can turn them
   on. One card covers a "Tell 3 people" too.
4. **Plain contact stays.** WhatsApp, Email and Ring on a person's page
   open a chat or a call with nothing written; the certificate reminder
   mentions no link. They are a phone book, not a prompt, and a mis-tap
   sends nothing.

## Considered

- **Hide the buttons.** Offer… would vanish while off, and the office
  could not make an offer at all. The offer is a record the app needs;
  only the message is held.
- **On by default, off after an import.** Needs the import to flip it,
  and a one-off change to the live data for the two imports already
  done. Off by default needs neither, and a company with no import has
  one switch to find, said on the card the first time it bites.
- **A switch per person or per job.** Nobody asked; one switch is one
  mode, shown twice (Admin and the card), and the office turns it on
  for good once the lists are tidy.

## Consequences

- One new column on `settings` (`prompt_messages`), in the backups and
  Download everything.
- On deploy the live app goes quiet. The office turns messages on under
  Admin › Messages to crew when the lists are tidy and Colly says so.
- The browser test for crew booking turns messages on through Admin
  before sending the offer, so the switch is exercised every run.

## Open

- **The calendar invites switch (ADR 0009) and this one are two
  switches** for two ways out of the app. Rated 1: both are on Admin,
  both off, and each says what it does when on.
