# ADR 0101: Sending a quote to the client by email

- **Status:** accepted
- **Date:** 30 October 2026
- **Asked for by:** Colly, 30 October 2026: "Can we add a send button and an
  email integration to send to the client directly."
- **Builds on:** [ADR 0042](0042-quotes-prices-and-a-money-view.md) (quotes), [ADR 0084](0084-the-printed-quote.md)
  (the printed quote and its number), [ADR 0098](0098-claude-drafts-quotes-from-the-mailbox.md)
  (the operations mailbox, connected with Google), [ADR 0048](0048-messages-to-crew-off-until-said.md)
  (nothing reaches anyone outside the app until the office says)
- **Changes:** [ADR 0098](0098-claude-drafts-quotes-from-the-mailbox.md): the
  mailbox connection now asks Google to send as well as read, and moves
  from the Claude card to Admin › Connections.

## Context

Until now the app sent nothing to a client. The office printed the quote
as a PDF, sent it from their own mail, and came back to press Mark as
sent. Colly asked for a Send button that emails the quote to the client
from the app.

The app already holds a Google connection to operations@sessionhire.com
(ADR 0098), the mailbox cc'd on client correspondence so that Claude can
follow the threads. Sending the quote from that same mailbox keeps the
quote's thread where the office already reads it, and where Claude reads
it, with no second email service, no second set of keys and no mail
coming from an address the client has never seen. The alternative, a
transactional email service with its own domain setup, would have added a
provider for one kind of email and put the quote's thread outside the
mailbox.

Three things had to hold. Nothing goes until the office turns it on (ADR
0048's rule, which has kept the app from contacting anyone by mistake
since the real calendars came in). What the client is sent must be the
quote as the app prints it, with its number on it, so a quote by email
and a quote by hand read the same. And the office must be able to see,
afterwards, exactly what went to whom.

## Decision

1. **A quote goes from operations@, with the quote attached as a PDF.**
   The mailbox connection (ADR 0098) now asks Google for two things:
   reading the mail and sending from the account (`gmail.readonly` and
   `gmail.send`), still nothing that could reply to, delete or file
   anything there. What Google allowed is kept with the connection; a
   connection made before this reads only, and Admin says to connect it
   again and allow sending. The From is "Session Hire
   <operations@sessionhire.com>"; replies go to whoever pressed Send and to
   operations@, so the client's answer reaches the person and stays in the
   mailbox Claude reads.
2. **Off until the office turns it on.** A switch under Admin ›
   Connections › The operations mailbox, "Send quotes by email from
   operations@", starts off. While it's off nothing about sending shows
   and the quote is marked sent by hand as before. The mailbox connection
   itself moves to that card, since it now serves both Claude and sending;
   the Claude card points to it.
3. **Send to the client opens a compose box,** filled in by the server:
   To from the client's contacts with an address, a subject with the
   quote's number ("Quote 1115 from Session Hire: Liffey Brands Launch")
   and a message that says what the quote comes to, until when the prices
   hold and any deposit, signed by the person and the company. The office
   reads it over, changes any of it, can look at the PDF first, and
   presses Send. An address that isn't one is said once the field is
   left, not while it's typed (design system rule 18). Cancel leaves no
   trace. "Sent another way? Mark as sent" keeps the old way as a quiet
   link beside it.
4. **Sending marks a draft sent first, then sends.** The server marks the
   quote sent as the person's own change, which gives it its number (ADR
   0084) and moves an enquiry to quoted ([ADR 0081](0081-starting-a-quote-and-following-it-up.md)), then draws the PDF
   with that number on it, hands the email to Gmail, and records what went.
   The compose box shows the number the quote will get; should another
   quote take it first, the send is stopped with the real number named
   and the box opens again, so the subject never names the wrong quote.
   If Gmail fails, the quote stays marked sent (it has its number) and
   nothing is recorded, so Send is offered again; the reason is said in
   words and nothing has gone.
5. **The PDF is drawn on the server** with pdfkit, since the server has no
   browser, and says what the printed page says (QuoteSheet.tsx) in the
   same order: who it's from, the facts, who it's for, the job, the lines
   by group, the sums, the deposit, the notes, the terms, how to pay, and
   the footer. The two are kept together by hand; a change to one is a
   change to the other. The same PDF is there to look at from the compose
   box and to download from any quote, draft or sent, as "Quote 1115 -
   Liffey Brands Launch.pdf".
6. **What went is kept.** Each send is a record every device that sees
   money gets (`quoteEmail`: when, by whom, from, to, the subject, the
   version and number as sent), shown on the quote's page newest first with
   the PDF that went, and the history says "Emailed version 1 of the quote
   for Liffey Brands Launch to the client". The message's words and the
   PDF stay on the server, in the backups; the export leaves the PDF out
   of the spreadsheet as too big to be of use there. Sending again, to
   another address or after a change of mind, makes another record.
7. **Who can send** is who can see money: the office and directors, as
   for the quote itself. Turning the switch on is the same.

## Considered

- **A transactional email service** (Resend, Postmark, SES). Reliable and
  simple to call, but a second provider with its own domain records and
  keys for one kind of email, and the quote's thread would sit outside
  the mailbox the office and Claude read. The Gmail connection was already
  there and already Colly's choice of where client mail lives.
- **Sending from the signed-in person's own Google account.** The client
  would see the person's name, but the app would need each person's
  consent to send as them, and the thread would miss operations@ unless
  cc'd by hand, which is the very thing ADR 0098 set out to stop relying
  on. Replies to the person are kept by the Reply-To instead.
- **Composing in the person's own mail program** (a mailto: link with the
  PDF to attach by hand). No new permission, but the PDF can't go in a
  mailto:, so it's the old way with an extra step.
- **Marking sent only after Gmail takes it.** Then the PDF would go with
  no number on it, or the number would have to be reserved and given back
  on failure. Marking first means a failed send leaves a numbered quote
  with no email, which the page says plainly and offers to send again.
- **Rendering the PDF with a headless browser** from the same HTML as the
  printed page, so the two could never differ. Railway's build has no
  Chromium and adding one costs hundreds of megabytes and a slower start;
  pdfkit is small and the sheet is simple. The duplication is accepted and
  noted in both files.

## Consequences

- The mailbox needs connecting again once this is live, to allow sending;
  until then the compose box says so and sends nothing. Setup is in
  [Sign-in setup, step 9](../sign-in-setup.md#9-connect-the-operations-mailbox).
- Replies arrive in two places by design: the sender's inbox and
  operations@. Mail to operations@ is read by Claude when Claude is on;
  nothing here turns Claude on.
- A quote that went by email says so on its page and in the history; one
  marked sent by hand looks as before. The office's records of the
  client's answer, the invoice and the payment are unchanged.
- The e2e test server has no Google key, so the browser test plays the
  server's part of the compose box and presses Cancel; the send itself,
  the PDF and the refusals are tested on the server with Gmail stood in.
- Learnings for the design system: a compose box as a part (fields one
  under the other, the fault on leaving a field, the one primary action
  and a quiet way out), and "a quiet link for the old way" beside a new
  primary action.

## Setting it up

[Sign-in setup, step 9](../sign-in-setup.md#9-connect-the-operations-mailbox),
then Admin › Connections › The operations mailbox › Send quotes by email
from operations@.
