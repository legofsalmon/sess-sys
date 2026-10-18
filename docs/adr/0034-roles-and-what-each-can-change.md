# ADR 0034: Roles, and what each can change

- **Status:** accepted
- **Date:** 11 October 2026
- **Asked for by:** Colly, 11 October 2026 ("there's a note that the app
  needs roles and permissions. This is definitely required.")

## Context

Since sign-in (ADR 0003), everyone signed in could change everything: a
warehouse phone could cancel a job, and anyone could tick themselves as
able to approve time off. ADR 0003 said roles would come later, enforced
on the server; the personas ([personas.md](../personas.md), ADR 0033) rated
it a 2 and asked for a decision before the office trial ends. The six
personas are the starting list: director, office, head of department,
warehouse, staff crew and freelancer.

The app keeps working offline, with every device holding a copy of the
data and sending changes as commands the server decides on (ADR 0001). So
the place a permission counts is the server, on every command, whatever
device sent it; the device should only stop offering what will be turned
down.

## Decision

1. **Five staff roles**, one per persona with an account. A freelancer has
   no account and no role: their private link (ADR 0002) is their way in,
   and what it lets them do is unchanged.

   | Role | Can change |
   |---|---|
   | **Director** | Everything, and what only a director does: roles, who approves time off, erasing a person on request, made-up data and starting fresh |
   | **Office and production** | Jobs, clients and venues; crew and their bookings; kit on jobs; stock and the warehouse; settings (office details, Google Calendar, bringing lists in, backups now, downloading everything) |
   | **Head of department** | Crew and their bookings, kit on jobs, stock and the warehouse. Not jobs themselves, nor settings |
   | ~~**Warehouse**~~ | Stock and the warehouse (counts, faults, tests, labels, places, scanning out and in), and kit on jobs. Replaced by **Freelancer** (reporting a fault) in [ADR 0050](0050-freelancer-in-place-of-warehouse.md); holders became heads of department |
   | **Staff crew** | Their own leave and days in lieu, and reporting a fault |

   Everyone can also report a fault and ask for their own leave. Deciding
   leave still takes "Can approve time off" (ADR 0024) on top of the role.

2. **Everyone signed in still reads everything.** A role decides what a
   person can *change*, not what they see: every device holds the whole
   company's copy, and narrowing that per person is its own piece of work
   (below, *Open*).

3. **A role lives on the staff person on the Crew tab**, found by the email
   their Google account signs in with, as leave already finds "me". It is
   set by a director with its own command (`person.role`), never by an
   ordinary edit, and shows on the person's line ("Warehouse · Audio ·
   Level 3"). None set is staff crew. An account that matches nobody on
   the Crew tab, or someone archived, is staff crew: it can look and report
   a fault.

4. **Roles start off, and come on when someone is made a director.** Until
   then everyone signed in can change everything, as today, and Admin says
   so with **Switch roles on**, which makes the person signed in the first
   director. There is always a director after that: the last one can't be
   given another role, archived or made a freelancer. This needs no new
   setting on the server, and a company that never names a director keeps
   working as it does now. With sign-in off (made-up data trials) there is
   no one to hold to anything, and nothing changes.

5. **Who approves time off is a director's to give** once roles are on: an
   edit by anyone else that changes the tick is turned down, and the form
   only shows the tick to a director.

6. **Every command says which kind of change it is** (`COMMAND_NEEDS` in
   `shared/src/roles.ts`): jobs, crew, kit, stock, fault, leave, settings or
   company. It is typed against every command, so a new one doesn't
   compile until it says which. The server checks it on every command
   before anything else, and turns one down with the reason and who to
   ask: "Only the office and directors can change jobs, clients and
   venues. Your role is Warehouse; a director can change it on your person
   on the Crew tab." Requests outside the sync (downloads, settings,
   starting fresh, bringing lists in, putting a file on a document) say
   which kind they are in their route's config, and are checked the same
   way.

7. **The device works out the role the same way, from its own copy**, so
   it holds with no signal and changes as soon as a director's change
   syncs. Every change goes through the sync client, which turns down one
   the role doesn't cover before it is kept, in the same words. And the
   app doesn't offer what can't apply: a role without jobs has no *New job*
   and no *Change details*; without crew, no *Ask for crew*, *Offer…*, *Add
   person*, days off, new links, edits or archiving; without stock, no *Add
   product*; Admin shows the settings only to the office and directors, and
   *Made-up data and starting fresh* only to directors. Admin gains **Your
   role**: what it covers, and who changes it.

8. **The demo's personas are the roles** (ADR 0033 point 7). Choosing one
   on *See it as…* tells the server, which holds that browser to the role
   (a cookie, only on the passcode-locked demo), and the app offers what
   the role covers. *Staff crew* is staff crew; the freelancer is their
   link, as before. With no persona chosen the demo is held to nothing.

## Considered

- **Permissions ticked one by one per person.** Flexible, but nobody keeps
  a grid of thirty ticks right for a hundred people, and the personas
  already say who does what. Five roles, with leave approval kept as the
  one extra tick it already was.
- **Roles on the sign-in account (`users`) instead of the Crew tab.** An
  account only exists after its first sign-in, so a director couldn't set
  someone's role before they arrived, and it would be a second list of
  staff beside the Crew tab. The Crew tab is already where staff are, and
  where leave matches accounts.
- **A setting naming the first director (`DIRECTOR_EMAILS`).** Safer
  against a mistake in the first minute, but one more thing to set on
  Railway before anything works. Starting off and switching on from
  Admin matches how sign-in and invites already come on, and the last
  director can't be removed.
- **Heads of department limited to their own department's crew and
  kit.** Truer to the persona, but a crew call has no department yet (ADR
  0033), and a head often helps another department on a show week. Home
  already narrows what they look at; the role doesn't narrow what they
  can change. Revisit once calls carry a department.
- **Locked buttons that name who can unlock them** (the design system's
  locked state). Right for a protected thing a person might lift on the
  spot; a role is set by someone else, and a warehouse phone full of
  padlocks is noise. Hidden where it never applies, and a refusal in
  words where it's tried anyway.

## Consequences

- Before real staff use the app, a director switches roles on from Admin
  and gives the office, heads and warehouse their roles on the Crew tab.
  Until then nothing changes for anyone.
- Every member of staff needs the email they sign in with on their own
  person on the Crew tab, or they are staff crew. Admin says so.
- A change made offline by someone whose role is then lowered is turned
  down when it syncs, with the reason, like any other refusal.
- The history records `person.role` ("Gave Aoife Brennan the role Head of
  department"), and the download and backups carry the new `role`
  column.

## Open

- **Reading is not narrowed.** Staff crew can still see every freelancer's
  rate, phone and certificates, and every private link's address, because
  every device holds the whole copy. Rated **2**: everyone signed in is
  company staff on company accounts, as today, but a staff crew account
  doesn't need any of it. The fix is a change feed narrowed by role, with
  a device starting its copy afresh when its role changes; it's the next
  piece of this work. **Money came first** ([ADR 0042](0042-quotes-prices-and-a-money-view.md)):
  a sixth kind of change, `money`, for the office and directors, and the
  feed leaves prices, quotes and payments out for every other role.
  **Rates and links came next** ([ADR 0046](0046-departments-on-calls-and-what-each-role-reads.md)):
  crew rates, timesheet amounts and private links go only to the roles
  that need them, each person's own always. Phones and certificates are
  still to narrow.
- Heads of department aren't narrowed to their department (above), except
  that they read their own department's links (ADR 0046).
- The office trial will show whether five roles fit; anything crew did
  that the roles didn't predict goes in the design system's learnings.
