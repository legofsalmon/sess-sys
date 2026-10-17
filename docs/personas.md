# Who uses Session Hire, and how

Colly asked on 11 October 2026 for a look at the app through the eyes of
each kind of person who will use it, from the directors down to the
freelancers and the warehouse, so each one is properly served. This page
is that look: who they are, what they come to do, where the app helps
them today and where it falls short. It also explains the two changes it
led to straight away: a **Home** screen with an overview for each role,
and **navigation that shows how the app is laid out**
([Decision 0033](adr/0033-home-and-finding-your-way-around.md)).

The personas are drawn from how booking works today
([current-process.md](research/current-process.md)), the competitor
audit, Colly's answers on 29 September, and the shared design system's
crew research (calm, certain, in control, good at their job). They are
roles, not job titles: one person at a small company is often two or
three of them in a day.

## The people

| | Persona | Where and when | Under what pressure | Uses |
|---|---|---|---|---|
| **D** | **Director** | The office, a phone between meetings, a site walk | Low most days, high when a big job wobbles | The staff app, signed in |
| **O** | **Office and production** (the two ops staff who book today) | The office, at a desk, all day | Steady, with spikes when a call falls through | The staff app, signed in |
| **H** | **Head of department** (audio, LX, video, rigging) | Office, warehouse and site, mostly on a phone | High in show weeks | The staff app, signed in |
| **W** | **Warehouse** | The warehouse floor, a phone in one hand, gloves, patchy signal | High on a load-out morning | The staff app on a shared or own phone |
| **S** | **Staff crew** (employed technicians) | Site, van and home, on a phone | Medium | The staff app, a little |
| **F** | **Freelancer** | Anywhere, their own phone, between other companies' work | Low for the app, high on the day | A private link: no app, no login |

### D. Director

*"Are we all right this week, and is anything about to go wrong that I
need to know about?"*

- **One job of the visit:** the state of the company at a glance, then
  out. They rarely do the work themselves; they look, ask and decide.
- **What they look at:** what's on today and this week; jobs confirmed
  against enquiries and quotes; crew still needed; kit short; anything
  stuck (answers waiting, timesheets not approved, kit not back); later,
  money (quoted, confirmed, invoiced, owed).
- **Behaviour designed for:** *Salience*. A director scans, so the few
  things that need them must stand out from everything that is fine.
  Healthy is quiet: a count that is zero isn't shown.
- **Before this change:** no overview. To know whether the week was all
  right they had to open Jobs, Stock and Crew in turn and scroll each to
  the bottom (Crew is over five phone screens long). **Gap rated 3.**
- **Now:** Home, shown for *the whole company*: today, what needs
  attention across every area with a count, and the week ahead.
- **Money:** Jobs › Money, by month (quoted, confirmed, invoiced), who
  owes, freelancers owed and each job's margin; Home's whole-company view
  has a short Money card ([Decision 0042](adr/0042-quotes-prices-and-a-money-view.md)).
  Only the office and directors see it.

### O. Office and production

*"Who's still to answer, what's not crewed, and what's not on the calendar
yet?"*

- **One job of the visit:** keep every job crewed, dated and told. They
  live in the app all day.
- **What they do:** take enquiries and confirm jobs (Jobs); set phases and
  check the planner (Jobs, Week and Month); ask for crew and settle
  answers (Crew, and a job's crew card); send call sheets; check
  documents and certificates; approve timesheets.
- **Behaviour designed for:** *Default Effect* (a new job starts as an
  enquiry, an offer goes to the right people) and *Bundling bad news* (the
  answers to check are one list, with a count on the Crew tab).
- **Support today:** good. Most of Phase 1 and 3 is built for this
  person. The Crew tab's badge already says how many answers wait.
- **What fell short:** the Crew tab is one long column of seven cards with
  no way to see what's on it without scrolling (**3**), and nothing told
  them what was short across all three areas at once (**2**).
- **Now:** every screen with several parts shows them as a strip under the
  title (*On this screen*), with counts, which jumps to each. Home, shown
  for the office, puts answers, crew needed, timesheets, documents and
  running late first.

### H. Head of department

*"Are my people sorted for the week, is my kit ready, and is anyone
waiting on me?"*

- **One job of the visit:** their own department: its crew, its kit and
  its people's time off.
- **What they do:** check who is on their calls; approve leave for their
  team (the leave approvers, ADR 0024); chase certificates running out;
  look at faults and inspections on their department's kit; check kit
  short on their jobs.
- **Behaviour designed for:** *Limited Choice*. A head of audio does not
  need lighting's faults; narrowing to one department turns a list of
  forty into a list of four.
- **Before this change:** nothing could be narrowed to a department apart
  from the people list and the stock filter, and leave waiting on them
  was only counted on the Crew badge. **Gap rated 3.**
- **Now:** Home, shown for *a department*: the same counts narrowed to
  their people (by the department on their profile, ADR 0025) and their
  kit (by the stock department that matches: LX is lighting, LED is
  video, riggers are rigging). It starts on their own department when
  their profile has one.
- **Still open:** a crew call has a role ("audio tech") but no
  department, so *crew needed* can't yet be narrowed; Home says so
  rather than guessing from the role's words. Adding a department to a
  call is a small change for a later round.

### W. Warehouse

*"What's going out today, what's coming back, and what's broken?"*

- **One job of the visit:** get the right kit out and back, and know what
  can't go.
- **What they do:** pick lists and scanning out and in (a job's pick
  list); faults and repairs; counts; labels; inspections (PAT and
  lifting); finding an item by number or with the camera.
- **Behaviour designed for:** *Time Scarcity*. On a load-out morning they
  tunnel, so the next thing to do goes first and nothing else competes
  with it. And offline is normal: everything works with no signal.
- **Support today:** good for the tasks themselves (Phase 2 is built).
- **What fell short:** the Stock tab put the catalogue first and the
  day's work (pick lists, still out) below it, with no way to jump
  (**3** on a load-out morning, where a 2 at a desk counts double).
- **Now:** Home, shown for *the warehouse*: going out today and tomorrow,
  still out after the job, faults, inspections that stop kit going out,
  counts due this week, each opening the list that sorts it. Stock keeps
  its order, and its strip jumps straight to *Pick lists* or *Faults*.

### S. Staff crew

*"When am I on next, and how much leave have I left?"*

- **One job of the visit:** their own work and time.
- **What they do:** ask for leave, see their balance and days in lieu;
  see their bookings (staff get offers through the same links as
  freelancers); subscribe to their calendar feed.
- **Behaviour designed for:** *Autonomy*. It's their time; the app shows
  where they stand and lets them ask, without chasing.
- **Before this change:** leave was a screen under Crew; their own
  bookings were only on their link. **Gap rated 2.**
- **Now:** Home, shown for *me*: my next bookings, my leave balance and
  what's waiting, and for an approver, the leave waiting on them. Signed
  in, it knows who they are from their Google account; until sign-in is
  on, it asks once, as Leave does.

### F. Freelancer

*"What have I been offered, where am I tomorrow, and have I sent my
timesheet?"*

- **One job of the visit:** answer, turn up, get paid. They work for
  several companies and owe none of them an app.
- **What they use:** their private link (ADR 0002): offers to answer,
  bookings, the day's card with *running late*, timesheets, days they
  can't work, documents and certificates, their calendar feed.
- **Behaviour designed for:** *Friction*. Every step added loses answers,
  so no login, no app, one tap from a text message.
- **Support today:** good. The page is already ordered by what's due
  (today, offers, timesheets, bookings, days off, details).
- **What fell short:** with several offers and bookings the page grows
  long, and what's waiting on them is only clear by reading it all
  (**2**).
- **Now:** a line at the top of their page says what's waiting on them
  and what's next, each part a link down the page: "1 offer to answer ·
  1 timesheet to send · Next: Harbour Lights Festival, Wed 14 Oct".

### Not a user yet: clients

Clients see what Session Hire sends them: call sheets, and quotes as a
PDF the office sends itself (Decision 0042). A client page to accept a
quote online is still Phase 4, and waits on the rule that the app contacts
nobody.

## How a job moves through them

One job, from the first call to the last timesheet, and who does each
step where. **Bold** is a step the app does today.

| Step | Who | Where in the app |
|---|---|---|
| **Enquiry logged** | O | Jobs › New job (starts as an enquiry) |
| **Quote sent** | O, D | A job's Quote card › its quote, printed as a PDF the office sends itself |
| **Confirmed, phases dated** | O | A job's page; the planner (Jobs › Week, Month); Google Calendar (on with the key) |
| **Crew asked** | O, H | A job's crew card › Ask for crew |
| **Offer answered** | F, S | Their link › Offers waiting on you |
| **Answer settled** | O | Crew › Answers to check; Home |
| **Kit put on the job** | O, H | A job's kit card; *Kit short* on Stock and Home |
| **Call sheet sent** | O | A job's call sheet |
| **Kit picked and scanned out** | W | A job's pick list; Home for the warehouse |
| **On the day: running late, call sheet** | F, S, O | Their link's day card; Crew › Answers to check |
| **Kit scanned back, faults logged** | W | The pick list; Stock › Faults and repairs |
| **Timesheet sent** | F | Their link › Timesheets |
| **Timesheet approved** | O, H | Crew › Timesheets; Home |
| **Invoiced, paid** | D, O | Recorded on the job's quote; owed and paid on Jobs › Money |

### A day for each

- **The warehouse, a load-out morning.** Opens the app: Home is already on
  *the warehouse* (remembered on that phone). "Going out today:
  Harbour Lights Festival, 0 of 46 out." Tap, and the pick list opens;
  scan out; back to Home; the line now reads 46 of 46. *Still out after
  the job: 1* is next.
- **A head of audio, Monday.** Home on *Audio*: 2 answers from audio
  crew, 1 certificate running out, 1 leave request waiting on them, kit
  short 4 × d&b Y10P on Brightwater. Each tap lands on the card that
  sorts it.
- **A director, between meetings.** Home on *the whole company*: 2 jobs
  on today, 6 coming up this week, crew needed on 3 calls, kit short on
  2 jobs. All good otherwise, and nothing else is shown.
- **The office, all day.** Lives in Crew and Jobs; Home in the morning
  for the list of what's waiting, the Crew badge after that.
- **A freelancer, on a bus.** A text with their link; the top line says
  "1 offer to answer"; tap; Accept.

## How the app is laid out

Before, five tabs of equal weight, with History beside Account, and each
tab a long column of cards whose names you only met by scrolling.

```
Before                         After
Jobs | Stock | Crew |          Home | Jobs | Stock | Crew | Admin
History | Account
                               Home     today, what needs doing, the week
                                        (for the company, a department,
                                         the warehouse, or me)
Jobs     list / week / month   Jobs     Jobs · New job · Clients · Venues
         job › pick list,               job › pick list, call sheet
         call sheet; venues,            venues and clients
         clients
Stock    catalogue, pick lists Stock    Stock · Pick lists · Faults ·
         faults, counts, short,         Inspections · Counts · Kit short ·
         labels, places                 Labels · Places
Crew     answers, timesheets,  Crew     Answers · Timesheets · Leave ·
         leave, running out,            Running out · Crew needed · People
         crew needed, people
History  every change          Admin    History · Sign-in · Office details ·
Account  sign-in, calendar,             Calendar · Backups · Your data ·
         backups, data, device          Bringing lists in · This device
```

What changed, and why (the shared design system's navigation page has the
grammar):

1. **Home first.** Every role has a place to start that says how things
   stand (*Visibility of system status*). The address `#home`, and the
   bare address, open it.
2. **Five destinations, each with a picture and a word.** A phone shows up
   to five in the bar; a sixth would hide behind a menu, which people use
   about half as often. History is a record kept for the directors and the
   office, used rarely, so it moved under **Admin** with the settings
   (Account is renamed Admin; its address stays `#account`). Icons help
   the eye find the tab; the word stays, as navigation always carries one.
3. **Each top-level screen has its name as a title** at the top, large,
   so Jobs, Stock and Crew no longer look alike. A record's page keeps
   its own title (the job, the product) with the area named above it and
   the way back ("‹ All jobs").
4. **On this screen.** Under the title, a strip names the screen's parts,
   with a count where a part has one ("Answers 5", "Running out 6"). A tap
   jumps to the part and puts the focus on its heading. The strip stays
   at the top while the screen scrolls and marks the part in view, so it
   is also a "you are here". It's built from the cards on the screen, so
   a new card joins it without anyone remembering to add it.

## What's left, rated

Each was rated with the Nielsen Norman Group's severity scale, as the
design system asks (0 to 4; a 3 is fixed or named).

| Problem | Who | Rating | Now |
|---|---|---|---|
| No overview of the state of things | D, H, W | 3 | Fixed: Home |
| Screens look alike; no sense of where you are | All staff | 3 | Fixed: titles, icons, the strip |
| Long screens with no way to see their parts | O, W | 3 | Fixed: *On this screen* |
| Nothing narrows to a department | H | 3 | Fixed on Home; crew calls still have no department (open, below) |
| Crew needed can't be narrowed to a department | H | 2 | Open: calls need a department |
| A freelancer's page doesn't say what's waiting | F | 2 | Fixed: the line at the top |
| Staff can't see their own bookings in the app | S | 2 | Fixed: Home for me |
| No money anywhere | D | 2 | Fixed: Jobs › Money and each job's quote, for the office and directors ([Decision 0042](adr/0042-quotes-prices-and-a-money-view.md)) |
| Everyone signed in can do everything | D | 2 | Fixed: five roles decide what each person can change ([Decision 0034](adr/0034-roles-and-what-each-can-change.md)). Home stays a view anyone can switch |
| Everyone signed in can read everything, rates and links included | D, S | 2 | Open: money is narrowed to the office and directors (Decision 0042); rates and links aren't yet (Decision 0034) |
| Nothing knows which van is free, or who can drive it | O, W | 3 | Fixed: Stock › Vehicles, booked on the job with a driver; clashes in the planner ([Decision 0047](adr/0047-vans-and-drivers.md)). Licence categories open |

## Seeing it as each of them

The demo copy (shdemo.letissier.ie) opens on **See it as…**, one card per
persona above. Picking one opens the app where that person starts, with a
bar on every screen saying whose eyes these are and **Choose someone
else**. The freelancer card opens a made-up freelancer's own page, with
the same bar.

## Next

- A department on each crew call, so a head of department's Home narrows
  *crew needed* too.
- Roles: built ([Decision 0034](adr/0034-roles-and-what-each-can-change.md)).
  Each persona with an account is a role that decides what they can
  change; on the demo, *See it as…* holds the browser to that role. Next is
  narrowing what each role can read.
- Try Home with the office and the warehouse during the office trial, and
  write what they did that this page didn't predict into the design
  system's learnings.
