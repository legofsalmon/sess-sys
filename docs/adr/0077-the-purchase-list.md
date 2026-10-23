# ADR 0077: The purchase list, with votes

- **Status:** accepted
- **Date:** 23 October 2026
- **Asked for by:** Colly, 23 October 2026 ("a purchase request form in the
  app where crew/freelancers can request equipment to be bought. At the
  moment it's done through a WhatsApp channel … This list can be public to
  all staff with the ability to vote on the ones they would find most
  useful/best.")
- **Builds on:** [ADR 0034](0034-roles-and-what-each-can-change.md) and
  [ADR 0051](0051-freelancer-in-place-of-warehouse.md) (roles),
  [ADR 0058](0058-notifications.md) (notifications),
  [ADR 0048](0048-messages-to-crew-off-until-said.md) (nobody is contacted),
  [ADR 0027](0027-erasing-a-person-on-request.md) and
  [ADR 0055](0055-combining-people-brought-in-twice.md) (where a person's id lives).

## Context

Crew asked for kit to be bought in a WhatsApp group. Requests ran together
with the replies (who has ordered what, what's already in the warehouse,
"specific quantities and links please"), so a month later nobody could say
what was still wanted, what had been ordered, or what most people thought
would help. The office wanted it in the app, open to everyone, with votes.

## Decision

- **One list, on Stock's row** (`#stock/buy`), each request on its own page
  (`#stock/buy/<id>`). A request says what to buy, how many and anything
  else, a link, and the department; the app adds who asked and the day.
- **Anyone signed in asks and votes.** A new ability, `ask`, held by every
  role, freelancers included. One vote a person a request, pressed again to
  take it back; the vote's id is the request's and the person's together, so
  two devices can't vote twice.
- **Ranked by votes.** Asked for and agreed are listed most votes first,
  newest breaking a tie; ordered comes next, oldest first; arrived and not
  buying are folded away. A department filter appears once there are two.
- **Where it's at:** Asked for, Agreed, Ordered, Arrived, Not buying, with
  the office's notes, said by whoever changes stock (office, heads,
  directors). Whoever asked can change or take back their own; changing
  someone else's needs stock too. The server checks; the device says the
  same before anything is kept.
- **Who asked hears of it in the app.** Their requests are among their own
  records in Notifications, so a change of status reaches them there. Votes
  don't notify anyone. Nothing is emailed, texted or ordered.
- **Bringing a list in** (`#stock/buy/bring-in`, settings): a .csv with a
  What column and any of Asked on, Asked by, How many and details, Link,
  Department, Where it's at and Notes. Each name under Asked by is matched
  to the one person it can be (whole name, known-as name, or a first name
  nobody else has); the office can choose someone else or keep the name as
  written. A row's id is made from its day, name and what, so the same list
  again adds nothing and leaves alone what changed since. Read on the
  device and sent as one command (`purchase.bringIn`). A row that can't be
  read says why and stays out until the file is fixed.
- **The WhatsApp group came in that way.** Its export was sorted by hand
  into one row a request (a long list split into its items, a request and
  its follow-ups made one, the replies kept as notes, what the chat said was
  ordered or done marked so), and the file kept in the project's private
  files, not here: the names and words are the crew's.

## Records

`purchase_requests` and `purchase_votes`, a module of their own
(`purchases_schema_version`). `asked_by` and `person_id` are pointers to the
person: erasing someone keeps the request and the vote, reading "Erased
person"; combining people moves both, a vote both had given becoming one.
Taking a calendar bring-in back leaves alone anyone who asked or voted.

## Consequences

- Requests and votes are read by every role: they hold no money or
  contact details.
- Freelancers who don't sign in can't ask yet: their private link page has
  no form. If the office wants one, it goes there next.
- No icon fits voting or buying in the shared set, so the list uses the
  kit icon and the vote is words and a number.
