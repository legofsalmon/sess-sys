# ADR 0051: Freelancer in place of Warehouse in the list of roles

- **Status:** accepted
- **Date:** 18 October 2026
- **Asked for by:** Colly, 18 October 2026 ("Can you change warehouse in the
  staff role list to freelancer. I think this is more useful")
- **Changes:** [ADR 0034](0034-roles-and-what-each-can-change.md)

## Context

The roles of [ADR 0034](0034-roles-and-what-each-can-change.md) were five:
director, office, head of department, warehouse and staff crew, one per
persona with an account. A freelancer had none: their private link
([ADR 0002](0002-crew-booking-links.md)) is their way in, and an account
matched to a freelancer signed in as staff crew, which can ask for leave
the company doesn't give freelancers.

Since the calendars came in (16 October) most of the 91 people on the Crew
tab are freelancers, and the company books them far more than it staffs a
warehouse. The warehouse, meanwhile, is a department like audio or LX, run
by its head.

## Decision

1. **The roles are director, office, head of department, staff crew and
   freelancer.** Warehouse is gone from the list.
2. **A freelancer can change one thing: report a fault.** Their own offers,
   bookings, timesheets and days off go through their private link, as
   before; signed in, they look at the company's work like staff crew, but
   ask for no leave. What they read is staff crew's
   ([ADR 0046](0046-departments-on-calls-and-what-each-role-reads.md)): no
   money, nobody's rate or link but their own.
3. **Who is a freelancer.** Anyone on the Crew tab as a freelancer signs in
   with the freelancer role, without anyone picking it. A member of staff
   can be given it too, on their page, for someone kept as staff who works
   as a freelancer.
4. **Whoever was the warehouse becomes a head of department.** A head can
   change everything the warehouse could (kit on jobs, stock, faults,
   leave) and crew bookings besides. Moving them to staff crew or
   freelancer would have locked them out of the stock the morning after;
   a director can narrow it on their page. The history still says
   "Gave … the role Warehouse" for the changes made before.
5. **The demo keeps its Warehouse persona**, Home for the warehouse and all,
   held to a head of department's role. Its Freelancer persona is still the
   freelancer's private page, which is how freelancers use the app.

## Design

- **One job:** a director says what someone signed in can change.
- **Behaviour designed for:** Default Effect: a freelancer who signs in is
  held to the freelancer role with nobody choosing it, and the safe side of
  it (they can't ask for leave or see others' pay). Loss Aversion: the
  people who had the warehouse role keep every ability they had.
- **Departures:** none from the shared system; role names are this app's.

## Consequences

- One database step moves `warehouse` to `head` and lets `freelancer` in.
  A backup made before it restores and comes up the same way.
- Heads of department are not narrowed to their department for stock or
  crew (open since ADR 0034, rated 2): a former warehouse role can now book
  crew. A director who doesn't want that sets them to staff crew.
