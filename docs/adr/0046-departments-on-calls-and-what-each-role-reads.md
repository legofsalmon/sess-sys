# ADR 0046: A department on every call, and what each role reads

- **Status:** accepted
- **Date:** 17 October 2026
- **Asked for by:** Colly, 17 October 2026 (the two open rows of the
  [personas](../personas.md): "Crew needed can't be narrowed to a
  department" and "Everyone signed in can read everything, rates and
  links included", both rated 2)

## Context

A head of department's Home (ADR 0033) narrows people, kit, leave and
certificates to their department, but not *crew needed*: a crew call
(ADR 0007) has a role ("Sound No.1") and no department, so Home left the
count out for them. The Calls page couldn't narrow either. Calls brought
in from the calendar (ADR 0011, ADR 0037) are all "Crew", which says
nothing. The call sheet and the show pack (ADR 0045) guessed each
person's department from their profile, which is wrong for an audio tech
working a stagehand call.

Roles (ADR 0034) narrow what a person can change, not what they read.
Money came first (ADR 0042): its tables aren't sent to a role without
it. Crew pay and private links were left: every device still held every
freelancer's day rate, every booking's rate, every timesheet's amounts,
and every private link, which is a key to act as that freelancer. Those
sit on records every role needs (who's booked, on which days, whose
timesheet is in), so leaving the tables out, as for money, would break
the crew screens for everyone.

## Decision

### A department on every call

1. **Each crew call has a department**, from the list crew profiles use
   (ADR 0025), or none. It's a new `department` column on `crew_calls`,
   sent with `call.create` and `call.update`, and shown on the call's
   line, its edit form, the call sheet (app, paper and link) and the
   show pack's crew list.
2. **It starts on the one its role suggests**, the likely answer already
   there (the Default Effect), with a line saying it came from the role.
   The suggestion is, in order: the department calls for the same role
   were given before, then the one most people with the role as a skill
   are in, then the role's own words ("Sound", "FOH", "LX", "Camera",
   "Rigger", "Driver"). A role that says nothing, such as "Stagehand",
   suggests none. A call sent without a department, as by an older app,
   is given the suggestion by the server, worked out the same way.
3. **A call brought in from the calendar** takes the department more than
   half its people are in, or none.
4. **Calls with none are given one many at a time**: Crew › Calls
   narrowed to "No department" offers *Give these a department…*, a list
   with nothing ticked to start (a default is never "all"), Tick all, and
   one department for every call ticked (`call.department`, for those who
   change crew). The list then moves to that department, where the calls
   now are, and says what was done.
5. **Crew › Calls narrows to a department.** A head of department starts
   on their own; everyone else on all.
6. **Home for a department counts *crew needed*** for the calls in it,
   and every role's Home that shows it opens the Calls page.
7. **The show pack and the call sheet carry the call's department**, and
   a person's own only for a call with none.

### What each role reads

8. **Records are sent; fields are left out.** The server sends every
   role the same records and leaves out what it doesn't need. It sends a
   rate it leaves out as null, a link as empty and an extra's amount as 0,
   with a flag on the record (`rateHidden`, `linkHidden`, `amountsHidden`)
   so a screen says it's hidden rather than "rate to agree", "no link
   yet" or a total of nothing.

   | | Crew rates and timesheet amounts | Private links |
   |---|---|---|
   | Office, director | All | All |
   | Head of department | Only if a director allows it | Their department's people |
   | Warehouse, staff crew | None | None |

   Everyone reads their own: their rate, their link, their offers and
   their timesheets. With roles off, or sign-in off, everyone reads
   everything, as before.
9. **Heads of department see rates only when a director says so**, with
   one switch in Admin (`reading.heads`, director only). It's off to start
   because a rate on a phone can't be taken back, so seeing it is the
   choice that's made, not the one that's undone. A head of department
   sees their own department's links because they send its offers.
10. **A role without rates can't set or agree one.** The server refuses a
   call made or changed with a rate, a counter-offer agreed, and a
   timesheet sent, approved or reopened, saying who can and that a
   director can let heads see rates. The device refuses them first, the
   same way, offline too. The screens don't offer them: the rate field
   says the office sets it, a counter-offer shows only *Say no*, and
   *Check* on a timesheet becomes *Open*. A person edited by such a role
   keeps the rate the server has.
11. **A device reads its copy again when what it's sent changes.** The
   pull's answer says what the device reads when that isn't everything.
   A device told something different reads from the start, so a rate it
   held goes when its role loses it, and comes back when it's given.
12. **The history leaves the figures out** for a role without rates ("1
   day, and extras", "asked for a different rate"). Download everything
   stays with the office and directors (ADR 0034), so it holds everything.
13. **The demo's personas read what the person they stand for reads.**
   The browser tells the server who the persona is (staff crew and the
   warehouse are a person on the Crew tab; a head of department is a
   department), and the server sends what that person would be sent. The
   freelancer persona's page is found by the server, since the browser
   may hold no one's link.
14. **You says what this role reads**, in a line under the role.

## Considered

- **Leaving the tables out, as for money.** Rejected. Offers, bookings
  and timesheets are how the warehouse sees who's on and a head sees
  who's coming. Without them the crew screens would be empty for most
  roles.
- **Hiding them on the screen but sending them.** Rejected, as for money
  (ADR 0042): every device keeps its copy in the browser, so a shared
  warehouse phone would carry everyone's pay.
- **A department on the role, not the call.** Rejected. The same role is
  different departments on different jobs ("Stagehand" for Production or
  Transport), and the office already thinks in calls.
- **Guessing the department on screen only.** Rejected. Home, the call
  sheet and the show pack all need the same answer, and a guess changes
  as people join, so the call keeps the one it was given.
- **Heads of department see rates by default.** Rejected for now. Some
  heads book their own crew, so the switch is there for a director.

## Consequences

- One new column on `crew_calls` (`department`) and one on `settings`
  (`heads_see_rates`). Both are in the backups and Download everything.
  Calls from before have none, so they show "no department" until given
  one.
- Made-up data gives every call the department its role suggests, except
  the Harbour Lights load out's hands, which have none to give.
- A role change, or the director's switch, makes that person's devices
  read their copy again at their next sync, with nothing for them to do.
- A head of department can no longer make a new link for someone whose
  link they aren't sent: it would stop the old one with no new one to
  send. The server refuses it (`person.newLink`), saying who can, and the
  device refuses it first; the button isn't offered.

## Open

- **Phones and certificates are still read by all staff** (ADR 0034).
  Rated 2: the warehouse and crew chiefs ring crew on the day. Closed by
  [ADR 0062](0062-what-crew-and-freelancers-read-of-other-people.md):
  documents and everything but the phone are narrowed, and heads' rates to
  their department.
- **Rate-free roles can't fill in a timesheet for someone.** The office
  does. Rated 1: heads of department haven't asked to.
- **A department is one per call.** A call needing a sound tech who can
  also rig is two calls. Rated 1.
