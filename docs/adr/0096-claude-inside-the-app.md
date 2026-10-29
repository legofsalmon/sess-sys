# ADR 0096: Claude inside the app, suggesting on the quote screens

- **Status:** accepted
- **Date:** 29 October 2026
- **Asked for by:** Colly, 29 October 2026 ("I'd like Claude to only be
  available and make suggestions from within the app. So Claude would act as
  a PA here with notifications/to do lists for the office staff/director,
  assist in creating / amending / updating quotes in this early phase")
- **Builds on:** [ADR 0042](0042-quotes-prices-and-a-money-view.md) (quotes),
  [ADR 0043](0043-kit-lists-from-the-notes.md) (matching written kit to the stock list),
  [ADR 0081](0081-starting-a-quote-and-following-it-up.md) (New quote),
  [ADR 0090](0090-timesheets-off-until-used.md) (the same kind of
  company-wide switch)

## Context

The plan ([Claude inside Session Hire](https://claude.ai/artifact/6z9f5bSSAMGtZRvqmckD3h))
offered three roles: reading enquiries into quotes, a PA on a shared
mailbox, and a weekly business report. Colly chose the first, kept inside
the app: no mailbox, no email, nobody contacted. This record is that first
part. The office and directors' to-do list Colly also asked for comes next,
on its own record.

An enquiry arrives as an email or a message, and the office types it into
New quote: the job's name, client, venue and days, then each piece of kit
and crew on the quote. Most of that is copying. A change to a quote ("add
two more radio mics, make it three days, 10% off the lighting") is a few
presses each, across several lines.

## Decision

1. **Claude suggests, a person takes.** Nothing Claude says is saved until
   someone presses to take it, and then it's saved by the same commands as
   typing it in (`project.create`, `phase.add`, `quote.save`), under the role
   rules of [ADR 0034](0034-roles-and-what-each-can-change.md). The history says who
   took it, as for anything typed. Everything Claude suggests sits under
   "Suggested by Claude", in no colour of its own, each line ticked to take
   or not (Autonomy Bias: the tool says what it did, and the person can
   override it).
2. **New quote reads an enquiry.** Pasted under "Paste an enquiry" and
   read with one press, Claude fills in the job's name, client, venue and
   days, gives the parts when the enquiry gives separate days (a build, the
   show, a derig), a short summary, what to ask the client, and the kit,
   crew and anything else to charge. The button says what it will start:
   "Start the quote with 4 lines, 2 with no price yet".
3. **Matched and priced on the device, not by Claude.** Claude writes kit
   as the enquiry names it; the stock list's matcher (ADR 0043) finds the
   product and the price list prices it, with its rate rule
   ([ADR 0085](0085-rate-rules-discounts-and-an-agreed-price.md)). A sure match
   takes the product's name; one it isn't sure of offers the products most
   like it, or stays as written at no price, which the quote counts as a
   line with no price. Crew take the company's own name for a role when it's
   plainly the same one ("Stagehands" is Stagehand), priced from the price
   list. Claude never makes up a price: it's told so, and it may only pass
   on one the person said.
4. **A draft quote can be changed in words.** "Ask Claude to change this
   quote" sends the lines (what, department, how many, days, how charged,
   price and discount; never costs or suppliers) and what was asked. Claude
   answers with lines to add, lines to take off, changes to lines, and a
   discount on the whole, each named by the line's id. The server drops any
   id that isn't on the quote and any change that changes nothing. "Make
   these 3 changes" puts them into the draft, which saves itself as usual.
5. **Off until the office says.** A company-wide setting, `assistant.use`
   on the "assistant" row of `settings`, under Admin › Company, for those
   who change settings and see money. Off, Claude is offered nowhere.
6. **The server holds the key, and a monthly limit.** `ANTHROPIC_API_KEY`
   in Railway, `CLAUDE_MODEL` to choose another model (Claude Opus 5.5
   unless said), and `CLAUDE_MONTHLY_LIMIT_USD` for what it may spend in a
   month, $50 unless said. Each ask is counted in `assistant_uses`: when,
   what for, the model, the tokens and the cost in US cents, and nothing
   else: not the words, not the answer, not who asked, so there's nothing
   of anyone's to erase. At the limit, asks are turned down until the 1st.
   Admin › Company and Admin › Status say what's been spent. Status never
   asks Claude anything, since each ask costs.
7. **Only what's needed goes to Anthropic.** The enquiry, or the quote's
   lines and the ask, and the names Claude needs to match them: the
   company's crew roles and up to 300 clients and venues, the most used
   first. Not the stock list, not people, not rates paid. Anthropic doesn't
   train on what the API is sent, and deletes it within 30 days; it is
   processed in the US or globally, not only in the EU (the plan's
   choices: Claude on Google Cloud in an EU region can replace it later
   without changing the screens). Text inside the enquiry is read as the
   client's, never as instructions.
8. **Answers read leniently.** Claude answers in a JSON schema
   (structured outputs). What comes back is read so that a little out of
   range still helps: too long is cut, too many shortened, a number brought
   into range, a date it couldn't read left empty. A refusal, an answer cut
   off, or no answer says why on the screen, and what it cost is counted
   all the same.
9. **Tests never ask Anthropic.** The server takes a stand-in for the call
   in its tests, and the browser tests point `ANTHROPIC_BASE_URL` at a
   stand-in on the test machine.

## Consequences

- An enquiry becomes a quote in one paste and a check, and a quote changes
  in a sentence. The office still checks every line, and the default is
  to take each one, so the check is to untick, not to tick.
- Claude costs a few cents an ask: a long enquiry and its answer, with
  Claude's own thinking, come to about 5 to 10 US cents on Opus 5.5.
- It needs signal, like Current RMS's history: asks go through the server.
- The kit match is the same as kit from notes, so a product's other names
  ([ADR 0070](0070-finding-a-product-by-typing.md)) help Claude's lines too.

## Open

- The to-do list and notifications for the office and directors: built in
  [ADR 0097](0097-claudes-to-do-list.md).
- Whether to send Claude the stock list's names, so it can name kit as the
  company does. Left out for now: it's long, and the matcher does it well.
- Hosting in the EU, if the company wants it.
