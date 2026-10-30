# ADR 0062: What crew and freelancers read of other people

- **Status:** accepted
- **Date:** 19 October 2026
- **Asked for by:** Colly, 19 October 2026 ("do the work to limit what each
  role can see on the build side")
- **Follows:** [ADR 0034](0034-roles-and-what-each-can-change.md) (roles),
  [ADR 0042](0042-quotes-prices-and-a-money-view.md) (money),
  [ADR 0046](0046-departments-on-calls-and-what-each-role-reads.md) (rates
  and links), [ADR 0051](0051-freelancer-in-place-of-warehouse.md)

## Context

Roles decide what someone can change (ADR 0034). What they read was
narrowed twice: money isn't sent to a role without it (ADR 0042), and crew
rates, timesheet amounts and private links are left out of the records
every role needs (ADR 0046). Three things were still sent to every device
signed in:

- **Other people's details.** Every email, the office's notes on a person
  ("bad back", "not with Dara again") and a freelancer's company and VAT
  number reached staff crew and signed-in freelancers.
- **Their documents.** Insurance and certificate cards, and their files,
  opened for anyone signed in. ADR 0046 left this open, rated 2.
- **What people wrote about their own time.** The note on a day off or a
  leave request ("hospital"), the reason a request was turned down, why
  someone is running late or pulled out, and what a freelancer said
  answering an offer. The history repeated some of it.

And a head of department a director let see rates saw every department's,
when they book only their own.

## Decision

1. **Staff crew read a colleague's phone, and not their email, notes or
   company.** Crew ring each other on the day, so the number stays; the
   rest is the office's. A **freelancer** signed in reads none of it, phone
   included. The server sends what's left out as nothing, with
   `detailsHidden` on the person, and their page says "Your role doesn't
   see Dara's email, notes or company. The office has them." Everyone reads
   their own.
2. **Documents go to the person they belong to, the office, directors and
   heads of department.** For staff crew and freelancers the feed leaves
   other people's documents out (their cursor still moves past them), and
   the file's address answers 403, saying who can. Certificates as a person
   holds them (which, and when they run out) stay on the person: a call
   that needs one is checked by them. The documents part of a page says
   they're hidden, not "none yet".
3. **Time off keeps its days and loses its words.** For staff crew and
   freelancers, someone else's leave, days in lieu, days away, running late
   and answer to an offer come with the dates and the answer, and without
   the note or the reason given. The history and the notifications leave
   those words out for them too. The planner and the crew screens still show
   who's away and who's on.
4. **A head of department who reads rates reads their own department's.**
   When a director lets heads see rates (ADR 0046), a head reads the rates
   of people in their department and of calls in it, and the bookings and
   timesheets on those calls; not anyone else's. They can set or agree a
   rate only there: a call they make for another department, or a change to
   its rate, is refused, saying the office sets it, on the server and on the
   device first. An edit to someone in another department keeps the rate the
   server has. The history and notifications name everyone's figures, so
   they show none to a head.
5. **On the server, as before.** All of it is cut as the feed goes out
   (`server/src/reading.ts`, rules in `shared/src/reading.ts`), so a shared
   warehouse phone holds nothing it couldn't show. A device whose reading
   changes reads its copy again from the start, and lets go of the
   documents it held first, since those are left out rather than cut down.
6. **The office, directors and system admins read everything**, as do all
   with roles or sign-in off. **You** says what this role reads of other
   people in its line under the role.

| | Rates | Links | Phone | Email, notes, company | Documents | Notes on time off |
|---|---|---|---|---|---|---|
| Office, director, system admin | All | All | All | All | All | All |
| Head of department | Their department's, if a director allows | Their department's | All | All | All | All |
| Staff crew | Own | Own | All | Own | Own | Own |
| Freelancer | Own | Own | Own | Own | Own | Own |

## Considered

- **Heads see their department's quotes.** Rejected: a quote is the
  whole job's, not a department's, so there's no department share to show.
  Money stays with the office and directors (ADR 0042); a head's money is
  their department's crew rates.
- **Staff crew without phones too.** Rejected for now: the warehouse and
  crew chiefs ring crew on the day (personas). A freelancer signed in has
  their call sheet for the people they need to reach.
- **Sending the documents' records without their files.** Rejected: the
  record names what someone sent and when it runs out, and nothing on a
  crew screen needs another person's.

## Consequences

- A staff crew or freelancer's devices read their copy again at their next
  sync, with nothing for them to do.
- A head who sees rates no longer sees another department's, nor figures in
  the history. A director who wants a head to see everyone's makes them
  office.
- No new tables or columns; nothing changes in the backups or Download
  everything, which stay with the office and directors.

## Open

- **Staff crew who approve time off read others' leave without its note.**
  The flag isn't a role; a director can make them a head of department.
  Rated 1.
- **A head reads every department's documents and details.** They book
  crew across departments for some jobs. Rated 1.

## Later: timesheets, the history and clients' documents (29 October 2026)

The 20 October audit (findings 34 to 39) found four ways round these rules
and two screens that put the office's work in front of staff crew. Colly
chose to close them before staff sign in.

- **Timesheets are in rule 3.** What someone wrote on their timesheet, and
  the office's note back, reach only them, the office, directors and heads,
  as for time off. The days and the amounts' rules are unchanged.
- **The history follows rule 2.** For a reader who gets only their own
  documents, another person's document is "Saved one of Dara Quinn's
  documents", with no title, expiry or file. The notices read the same way.
- **Clients' documents are for roles with jobs or money** (the office and
  directors, and heads of department since Colly's choice later on 29
  October), in the feed and on the file's address: a client's contract or
  purchase order carries the prices kept from everyone else. Venues' stay
  open to everyone, as crew need floor plans and access notes. ADR 0032's
  open line about who opens which is settled here.
- **Staff crew start on their own work.** With nothing chosen yet, a role
  without crew opens Home on Me and Crew on People, sees no Answers to
  check, and sees only their own timesheets. Home › Me links to their own
  page when offers wait there, their person page has "Your page" to open
  it and copy their calendar address, and Your work says which bookings
  are confirmed and which only accepted.
