# ADR 0084: The printed quote

- **Status:** accepted
- **Date:** 28 October 2026
- **Asked for by:** Colly, 23 October 2026 ("Consider the users to aim for
  ease of use, clarity and excellent UX"), part 1c of the quoting plan.
  Numbering decided by Colly on 27 October: carry on from Current RMS's.
- **Builds on:** [ADR 0042](0042-quotes-prices-and-a-money-view.md) (quotes and
  the A4 print), [ADR 0080](0080-a-quote-that-saves-itself-and-keeps-up-with-the-job.md)
  (the editor), [ADR 0081](0081-starting-a-quote-and-following-it-up.md)
  (starting and following up).

## Context

The printed quote is the one part of the app a client sees. ADR 0042 left
it thin, with its gaps rated 2: no quote number, no "valid until", no
terms, deposit or bank details, and no client address. The office typed
these into the notes, or didn't. The plan's walk through the screens rated
it 3 for the client. Versions also couldn't be compared, so telling a
client what changed meant reading two lists side by side.

Current RMS's history (read on 27 October) numbers quotes with plain
numbers, padded to ten digits, the highest being 1114, and gives no number
to a draft.

## Decision

1. **A quote number per job, given when it first goes to the client.**
   Marking a version sent (or recording an answer straight from a draft)
   gives the job's quote the next number; later versions keep it, printed as
   "1115 · version 2". Drafts have none, so a quote thrown away never uses a
   number. Numbers print without padding.
2. **The next number is set in Admin › Printed quotes**, to carry on from
   Current RMS (1115) with no jump for clients. Left empty, it carries on
   from the highest given. It can't be set to a number already given.
3. **The number comes with sending, so print after marking sent.** The draft
   still prints, headed "Draft quote · Not sent yet", for a look before it
   goes. Once marked sent, it becomes quote 1115 and stays as it is, and
   that's what the office prints and sends. The draft says which number it
   will get.
4. **Valid until and a deposit on each quote.** Prices hold for 30 days from
   the day it's sent unless changed; a deposit is an optional whole
   percentage, shown in euro on the draft and printed as "A deposit of 50%,
   €1,254.60, confirms the booking". A new version keeps both from the one
   before.
5. **Terms and bank details in Admin, printed under every quote**, with
   "Please give quote 1115 as the reference" under the bank details. They are
   money's records, sent only to those who see money.
6. **The client's address for quotes** on the client's page, printed under
   their name with the first contact.
7. **The page laid out as a letter.** The company, its address, phone, email
   and VAT number top left; quote number, date and valid until top right,
   dates in full with the year; who it's for beside the job, its dates and
   venue; then the lines, totals, deposit, notes, terms and bank details.
8. **What changed since the version before**, on every version after the
   first: lines added, taken off and changed (how many, days, price), the
   discount, and the total against the last one's. A new version's lines get
   new ids, so lines are matched by product, else what they were built from,
   else their words.

## Considered

- **Numbering drafts.** Current RMS doesn't, and it would use numbers on
  quotes never sent.
- **Giving the number on first print.** The PDF would carry a number, but
  printing a look at a draft would use one, and a draft printed and then
  changed wouldn't match what was sent. Marking sent before printing keeps
  what's printed and what's kept the same.
- **A prefix such as Q-2026-.** Current RMS's are plain numbers; clients
  have seen those.
- **A logo.** The sheet uses the company name as text for now; a logo
  waits on files being kept for the company (the bucket is there for
  documents) and is an easy follow-up.

## Consequences

- `quotes.number`, `valid_days` (default 30) and `deposit_pct`; a
  `quote_settings` row ("quoting": next number, terms, bank) as the money
  record `quoteSettings`; `clients.address`. Commands: `quoting.update`;
  `quote.save` and `client.upsert` take the new fields as optional, so an
  older app's save leaves them as they were.
- A device offline works out the number as the server would. If another
  device sends a quote first, the server's number replaces it once it's in;
  a PDF printed offline in that moment would carry the wrong one, which is
  why the draft says the number and the sent version shows it after sync.
- Quotes sent before this have no number and print as before.
