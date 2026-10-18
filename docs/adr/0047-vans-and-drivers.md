# ADR 0047: Vans and drivers

- **Status:** accepted
- **Date:** 17 October 2026
- **Decides:** how the company's vehicles, their checks, and who drives
  them on which job are kept; what is refused and what is only warned
  about; and where vehicles live in the app.

## Context

Every job moves kit, and most errands are a van and a driver: collecting
decks, dropping a desk back, a run to a supplier. Until now the van was
in the office's head or the job's notes ("1 x Luton van"), so nothing
noticed the same van on two jobs the same day, a van in for a new clutch
booked on a load in, or a freelancer down to drive with no licence on
their card. An out-of-date CVRT, motor tax or insurance is worse than a
clash: driving it is against the law, and the van is impounded.

Most of what's needed is already in the app in another shape. Crew
certificates and documents run out and are listed together
([ADR 0028](0028-certificates-a-call-needs-and-running-late.md),
[ADR 0029](0029-documents.md)), and the driving licence is one of the
certificates on a person's card ([ADR 0025](0025-crew-profiles-and-bringing-in-the-list.md)).
Kit in for repair isn't free for jobs ([ADR 0018](0018-faults-missing-kit-and-repairs.md)),
and kit is held by a confirmed job and pencilled in by a quote
([ADR 0014](0014-kit-on-jobs.md)). The planner flags a person on two jobs
as a clash and one that would clash if they said yes as a check
([ADR 0010](0010-planner.md)). Call sheets go to everyone on a phase
([ADR 0021](0021-call-sheets.md)).

## Decision

1. **A vehicle is a record of its own,** not stock: a name, its
   registration, its kind (van, Luton, truck over 3.5 tonnes, car,
   trailer), seats, payload in kg and notes. It's a company asset with
   dated checks and a driver, which kit has neither of. Registrations are
   kept in capitals. Retired, it stays on the jobs it was on.
2. **Each vehicle has five checks, each with the day it runs out:** its
   NCT (a car) or CVRT (anything else), motor tax, insurance, service
   due, and tachograph calibration. Which it needs follows its kind (a
   trailer no test, tax or insurance of its own; only a truck a
   tachograph) and can be unticked. A check with no day is "not recorded".
3. **The road checks are the law, and refused by name.** A booking on any
   day after its NCT or CVRT, motor tax, insurance or tachograph has run
   out is refused, whatever is sent: "Big Van (241-D-101)'s motor tax
   runs out on Wed 14 Oct, before the booking ends. Update its checks on
   the Vehicles page if that's changed." A check is good on its own last
   day, and days gone by aren't held against it, as for certificates. A
   service overdue, and a check not recorded, only warn.
4. **A booking is a vehicle on a job, or one phase of it, for given days,**
   with a driver chosen from the crew or none yet, and a note. Errands are
   jobs of the errand kind, so a van run is booked the same way as a gig.
   The days start as the phase's or the job's and can be changed: a van
   often goes the day before. A booking keeps its own days when its phase
   moves, and says so once it shares no day with the phase.
5. **The driver's licence is checked on the booking's days.** No licence,
   or one run out, is refused: "Aoife Brennan has no driving licence, so
   can't drive. Update their card if that's changed." So is someone
   archived, or erased. A licence not recorded is warned about, and the
   form groups the crew by it: in date, not recorded, and can't drive then
   (shown, not chosen). Licence categories (C1 for a heavy Luton) are not
   checked yet.
6. **A clash, or a day off the road, is the office's call.** Another
   booking of the same van on a job going ahead or pencilled in, on any of
   the same days, is refused until the booking says to book it anyway, as
   an offer to someone already booked is: "Big Van is already on Harbour
   Lights on Wed 7 Oct. Book it anyway to have it on both." The same for a
   van off the road on its days. The form asks first, with **Book anyway**.
   A job cancelled or lost holds no van.
7. **Off the road is like kit in for repair.** From a day, until a day or
   until someone says it's back, with why. It takes the vehicle off what's
   free (the booking form marks it, the server asks before booking it) and
   shows on every booking and in the planner while it lasts.
8. **Nothing is undone later.** A check or a licence that lapses after a
   booking was made, a van taken off the road, a second booking made
   anyway: each is said on the booking, worst first, and in the planner.
   Bookings are never taken off by the app.
9. **Vehicles live under Stock, as a page along its row:** Stock ›
   Vehicles (`#stock/vehicles`), each on its own page
   (`#stock/vehicles/<id>`), and on the Menu under Stock. The warehouse
   keeps the vans as it keeps the kit; their checks are dated like
   Testing's inspections and off the road is like Repairs, both already
   along that row ([ADR 0041](0041-where-things-live.md)). Vehicles are
   booked where the job is planned: a Vehicles card on the job's page,
   after Kit. Stock's row counts the vehicles that can't be booked because
   a road check has run out.
10. **Checks running out are listed like certificates.** Run out, or due in
    the next 30 days, soonest first: on the Vehicles page, beside the
    certificates and documents on Crew › People, and as a Home count for
    the company and the warehouse. The app asks nobody for anything: the
    new day goes on the vehicle's page.
11. **The planner has Vans rows.** A third set of rows beside Jobs and
    People (`…/vans`), one per vehicle, each day showing the jobs it's on
    and who drives, pencilled in or held, and off the road. Two jobs going
    ahead on one van, or one while it's off the road or a road check has
    run out, is a clash; the same with a pencilled job is a check. They're
    in To sort out with the crew's. A job's day in the planner names its
    vans and drivers ("Vehicles: Big Van (Cian)").
12. **The call sheet names them.** Every reader of a phase's sheet, on the
    app and on a freelancer's link, sees the vehicles on the whole job or
    that phase, on the sheet's days, and who drives ("Big Van: Cian Murphy
    driving", or "driver to be confirmed"), in its text copy too.
13. **Roles** ([ADR 0034](0034-roles-and-what-each-can-change.md)): a
    vehicle and its checks are changed by those who change stock; a
    booking by those who put kit on jobs. Finance sees them and changes
    nothing. A driver can't be erased while they drive a booking that
    hasn't ended, a phase can't be removed while it has vehicles, and a
    vehicle can't be retired while it's booked from today on.
14. **Made-up data** ([ADR 0019](0019-made-up-data-and-starting-fresh.md)):
    Big Van, its motor tax running out in nine days and its service
    overdue, on an errand, the festival's load in and load out, and the
    summit's last day, booked anyway (a clash); and The Luton, in for a
    new clutch until day 4 and its CVRT due on day 25, on the launch with
    a driver whose licence isn't recorded.

## Considered

- **A vehicle as a product in the catalogue, with an item per van.**
  Rejected: kit is counted, packed and scanned onto a job; a van is
  driven, by someone, with a test certificate. Sharing the catalogue would
  put vans on pick lists and labels and leave the checks and the driver
  nowhere.
- **Vehicles under Jobs, beside Clients and Venues.** Rejected: they're
  the warehouse's to keep, and the job's page is already where they're
  booked. Under Crew, beside drivers: rejected for the same reason.
- **Refusing a clash outright.** Rejected: one van can do a morning drop
  and an afternoon collection, and the office knows when it can. Asked,
  then booked anyway, as for crew.
- **Letting "book anyway" pass a check run out.** Rejected: that's
  driving without tax or insurance. The fix is the record, if the record
  was wrong.
- **Telling the driver from the app.** Not while the app contacts nobody:
  the call sheet already names them, and goes the usual way.

## Consequences

- The office sees a van on two jobs, a van off the road or a driver with
  no licence before the day, where it plans: the job, the planner, Home.
- Vehicle checks are kept by hand on the vehicle's page; nothing reads
  them from the motor tax or NCTS sites.
- Licence categories, fuel, mileage, a van's own kit list, and drivers'
  hours are left for later.
