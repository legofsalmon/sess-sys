# Build progress

Newest first. Each entry says what changed, what was checked, and what is
waiting on someone.

## 20 October 2026: finding a product by typing

**Done**

- Kit from the notes and Add kit choose a product by typing, not from a
  long dropdown: any part of the name, an other name it goes by, or its
  category or department, in any order ("shure 58", "beta", "wedge"), the
  best first and Enter takes it. Products can have other names, set on
  their page, and Kit from the notes matches lines written that way
  ([Decision 0070](adr/0070-finding-a-product-by-typing.md), Colly's ask).
  The design system's combobox gained the pattern for picking one record.
- Checked: typecheck, all unit and server tests, the kit, notes, pick list,
  faults and inspections browser tests, one new test typing part of a name.

## 20 October 2026: To sort out, from today on

**Done**

- Jobs › Week and Month: "To sort out" no longer lists clashes and checks
  on days gone; the day itself still shows them. Notifications now open
  with the clashes and checks from today to four weeks out, for anyone who
  books crew ([Decision 0069](adr/0069-to-sort-out-today-and-ahead.md),
  Colly's ask).
- Checked: typecheck and unit tests, with a test that a day gone leaves
  the list but keeps its mark.

## 20 October 2026: saving names in Tidy up

**Done**

- Jobs › Tidy up › People named from their address: a name saved for
  someone whose address already spells it (aoife.byrne@…, saved as Aoife
  Byrne) left them on the list as if nothing was saved. The office's save
  is now remembered, so each person leaves the list once named
  ([Decision 0068](adr/0068-a-name-checked-in-tidy-up.md), Colly's bug
  report).
- Checked: typecheck, all unit tests, a browser test saving three names in
  a row, which failed before the fix.

## 20 October 2026: the Skills field, reviewed against the design system

**Done**

- The Skills field ([Decision 0063](adr/0063-skills-as-picks.md)) given a
  full review against the shared design system (Colly's "give it a full
  review to align with the style and design guide"). While something is
  typed one offer is highlighted, the one Enter or a comma takes, the
  spelling in use before a new one, so "aud" and Enter is Audio. The list
  scrolls to keep the highlight in sight; Backspace held down to clear
  what's typed no longer runs on into the chips; each chip added or taken
  off is said aloud; the highlighted row looks apart from the one under the
  pointer; and the "Add as a new skill" row is readable when highlighted.
- Checked: typecheck, all unit tests, the browser tests, contrast of each
  row in both themes.
## 20 October 2026: the audit's P2s and P3s

**Done**

- All of the 18 October audit's P2s (findings 13 to 26) and its P3 polish,
  in [Decision 0067](adr/0067-the-audits-p2-and-p3s.md) (Colly's "proceed
  with all the P2s and P3s"). A new phone reads the latest of each record
  rather than the whole feed; a deploy without screen changes costs a phone
  2 KB, not 1.2 MB; devices poll only while the live connection is down,
  with a heartbeat; phones ask to keep their storage; the backup's test
  restore no longer holds the server up; more failures reach the error
  reports; demo passcode guesses are limited and every page has a content
  security policy.
- On the screens: a big call reads "25 of 40, both days" with its names
  across the card; a job's short kit is one line by reason and one
  "Subhire what's short…"; Jobs shows the next fortnight under week
  headings with New job at the top; Home puts what needs attention first;
  every page in an area row shows on a phone; one link style; the quote
  carries the company's VAT number and address (Admin › Office details).
- The architecture page now says what's built, including which role's
  device holds whose contact details. New tests on the money, kit from
  the notes and vans views, and a parity test that runs 90 commands on a
  phone offline and compares its copy with the server's.
- Checked: typecheck (now including the browser tests), all unit, server
  and browser tests.

**Waiting on**

- Colly: clear the start command in Railway's dashboard on both services
  (audit finding 25), and say when a demo passcode under 12 characters
  should be refused rather than warned about.

## 20 October 2026: a photo on a person's page

**Done**

- A photo on a person's page, in [Decision 0065](adr/0065-a-photo-on-a-persons-page.md)
  (Colly's "upload of peoples images on their staff page"). Add a photo,
  Change photo and Remove photo under their picture, for the person and
  whoever can change crew. The device squares and shrinks it before sending;
  it's kept in the bucket the documents use, and shown in place of the
  initials on their page, the People list and Home. Erasing and combining
  people handle it.
- Checked: typecheck, all tests (new server tests for photos).

## 20 October 2026: first and last names

**Done**

- A person's name is asked for in two, first and last, in
  [Decision 0066](adr/0066-first-and-last-names.md) (Colly's "first name and
  last name fields whenever name is asked for"): the person form, Tidy up's
  people named from their address, and the people on a calendar bring-in.
  The whole name stays as the two joined, so everything else reads as
  before. Everyone already in the app is split on deploy, Irish surnames
  kept whole ("Seán Ó Briain"), and the form shows the split to correct.
  Download everything has the two as columns.
- Checked: typecheck, all unit and server tests (the deploy's split checked
  against the app's own), the browser tests.

## 20 October 2026: making another email the main one

**Done**

- A person's main email can be swapped for another of theirs, in
  [Decision 0064](adr/0064-making-another-email-the-main-one.md) (Colly's
  "change the primary email address for users that have been combined"):
  on their page, each address under "Also found by" has **Make main**, and
  the one it replaces joins the others. They answer to the same addresses,
  so sign-in and roles don't change; for someone with a role only the
  office and directors can do it.
- Checked: typecheck, all tests (new unit and server tests).

## 20 October 2026: skills as picks

**Done**

- Skills as picks, in [Decision 0063](adr/0063-skills-as-picks.md)
  (Colly's "an autocomplete free type field, that can populate with
  multiple selections"): the person form's Skills field holds chips, offers
  the skills already on the crew list as you type (most used first, in the
  spelling most people have), and still takes a new one as typed. Enter or
  a comma adds, Backspace or a chip's own button takes one off.
- Checked: typecheck, all unit and server tests, the browser suite (new
  skills test).

## 19 October 2026: what crew and freelancers read of other people

**Done**

- Reading narrowed further, in [Decision 0062](adr/0062-what-crew-and-freelancers-read-of-other-people.md)
  (Colly's "limit what each role can see"). Rates, money and private links
  were already narrowed (Decisions 0042 and 0046); now staff crew read a
  colleague's phone but not their email, notes or company, and a signed-in
  freelancer none of it. Other people's certificates and insurance, and
  their files, go only to the office, directors and heads. Time off, running
  late and answers to offers keep their days and lose what was written, in
  the feed, the history and the notifications. A head allowed to see rates
  sees their own department's, and can set only those. All on the server;
  each screen says what's hidden.
- Checked: typecheck, all tests (new unit and server tests).

## 19 October 2026, night: one place for a whole stock list

**Done**

- One place for a whole stock list, in [Decision 0061](adr/0061-one-place-for-a-whole-stock-list.md)
  (Colly's "set the stock location all to the same"): the bring-in's
  "Where it's kept" card now asks first where all the kit is kept, and a
  list that places its kit can be put all in one place with "Put all of it
  there".
- Checked: typecheck, all tests (1 new unit, end-to-end extended).

**Waiting on**

- Colly: bring the Current RMS files in on the live app (Claude can't sign
  in there).

## 19 October 2026: system admins

**Done**

- System admins, in [Decision 0060](adr/0060-system-admins.md) (Colly's
  "I need to retain admin access to continue building this out"): the
  Railway variable `SYSTEM_ADMINS` names accounts that can change
  everything whatever their role on the Crew tab. Set on the server only,
  so no director's change can take it away, and it isn't a director: it
  doesn't switch roles on or count as the last one. **You** says so.
  **Switch roles on** on You now shows when it should.
- Checked: typecheck, all tests (new unit and server tests).

**Waiting on**

- Colly: add `SYSTEM_ADMINS` with their sign-in address on the
  **shserver** service in Railway.

## 19 October 2026: a job's page in parts

**Done**

- A job's page tidied, in [Decision 0059](adr/0059-a-job-page-in-parts.md)
  (Colly's "tidy up and segment the job page", and "the coming up jobs
  shouldn't be there when you click into a job"): on a desk a job now has
  the whole width, with no list beside it; Jobs › the job in the bar goes
  back to the list. Its details stay on top, and under them its parts are
  tabs, one at a time: Phases, Crew (booked of needed), Kit and vans, Show
  pack, and Quote for the roles that see money. Crew calls moved out of the
  phases into Crew, a card per phase; each phase says how its crew stand,
  a tap from them. The page opens on the part last looked at.
- Checked: typecheck, all tests, and the page on a phone and a desk.

## 19 October 2026: notifications

**Done**

- Notifications, in [Decision 0058](adr/0058-notifications.md) (Colly's
  "a notification centre … that fires toast messages when something
  updates for something the person is associated with"): a bell top right
  on every screen counts what's new, and opens a list of what others
  changed in the last 30 days on what's yours (the jobs you're on or made,
  the offers you sent, your own details, bookings, leave and timesheets),
  in the History tab's words, each linking to its page. Changes that arrive
  while the app is open pop up at the bottom of the screen, more than two
  at once as one; a switch on the list turns the pop-ups off on that
  device. In the app only: nobody is emailed, texted or pushed to.
- The bell icon is new in the design system (0.5.1, its PR #15).
- Checked: typecheck, all tests (3 new server, 1 new end-to-end), and the
  pop-up and the list looked at on a phone and a desk.

**Waiting on**

- Nothing: the design system's PR #15 is merged.

## 19 October 2026: venues on the map

**Done**

- Venues on the map, in [Decision 0057](adr/0057-venues-on-the-map.md)
  (Colly's "a map interface for the individual venue pages and an overall
  map for the venues page"): each venue's page has its map with
  Directions, and Jobs › Venues has one map of them all. OpenStreetMap,
  drawn with Leaflet: open, free, no key. A venue's pin is kept on the
  venue, so the map needs no look-up once it's placed and works with poor
  signal. It is placed by looking the venue up by name and address,
  pasting a map link or coordinates, or tapping the map. **Find the rest**
  looks up every venue not yet on the map for the office to check, then
  puts the ticked ones on in one press.
- Checked: typecheck, all tests (6 new unit, 9 new server, 2 new
  end-to-end), and the pages on a phone and a desk in both themes.

**Waiting on**

- The office: Jobs › Venues › Find the rest on the live app, then a look
  at any venue it couldn't find.

## 19 October 2026: the stock from Current RMS

**Done**

- Bringing the stock in from Current RMS, in [Decision 0056](adr/0056-bringing-the-stock-in-from-current-rms.md)
  (Colly's "can this be imported?"): Stock › Bring in the stock list takes
  Current RMS's products, stock levels and rates exports chosen together,
  and reads them into one list of a row a product, everything counted to
  be labelled later. Colly's export: 309 products and 3,491 pieces of kit,
  228 day prices. Any stock list can now have a Day price column, which
  fills the price list where a product has no price.
- Checked: typecheck, all tests (5 new unit, 1 new server, 1 new
  end-to-end), and Colly's three files read through the preview with
  nothing to fix.

**Waiting on**

- Colly: bring the three files in on the live app, with the place the kit
  is kept typed once above the rows.

## 19 October 2026: combining people brought in twice

**Done**

- Combining people, in [Decision 0055](adr/0055-combining-people-brought-in-twice.md)
  (Colly's "combine users created to the same one"): on a person's page,
  "Combine with…", and on Jobs › Tidy up, "The same person, brought in
  twice". The one person keeps every booking, offer, timesheet, day off,
  leave, document and history entry, and every address, so the next
  bring-in and their Google sign-in find them. Old private links and feeds
  open the one person. Two offers for one call become one.
- Checked: typecheck, all tests (11 new unit, 6 new server, 1 new
  end-to-end), and the page on a phone.

**Waiting on**

- Colly: combine the doubles on the live app (Jobs › Tidy up lists them);
  the Railway start command, backup variables and Sentry key, as before.

## 18 October 2026, late: charts on Home

**Done**

- Charts on Home, in [Decision 0054](adr/0054-charts-on-home.md) (Colly's
  "more visuals and graphs to the dashboard"): jobs by week, crew booked
  and still needed each day for a fortnight, the season month by month,
  and money by month (money ability only) for the company; crew and kit
  for a department; kit booked out each day for the warehouse; your own
  days by week for Me. Coloured by the shared grammar: ink settled, grey
  not yet, amber only for crew still needed. Each column is a button that
  says itself in words.
- Checked: typecheck, all tests (7 new unit, 1 new end-to-end), and the
  page on a phone and a laptop in both themes.

**Waiting on**

- Colly: the Railway start command, the backup variables and the Sentry
  key, as before.

## 18 October 2026, night: tidying what came in

**Done**

- Jobs › Tidy up, in [Decision 0053](adr/0053-tidying-what-came-in.md)
  (Colly's "tidy-ups for the imported data"): the jobs brought in as
  several made one (EP was 22 jobs), people named from their address
  given names, venues and clients found in job names, and names given a
  capital. Each group is a suggestion the office ticks; only sure ones
  come ticked. Joining moves phases, crew, kit, vans, quotes and the
  calendar's days, naming each day for its title.
- The next bring-in reads "EP - Smirnoff LX" as EP's Smirnoff LX day.
- Staff on several jobs a day are no longer clashes; calls say "25 of 40,
  both days"; "No client or venue yet" only on jobs in the next fortnight;
  "Show 3 times"; a bring-in's history keeps its start date and what it
  left out.
- Checked: typecheck, all server and shared tests (13 new), and the page
  on a local copy of the live data on a phone and a laptop, no console
  errors. Nothing in the live data was changed.

**Waiting on**

- The office: going through Tidy up on the live app.
- Colly: the Railway start command, the backup variables and the Sentry
  key, as before.
## 18 October 2026, night: Google is the only way in for staff

**Done**

- A member of staff's own page (their link) now asks for their Google
  sign-in before it opens, in [Decision 0052](adr/0052-google-only-for-staff.md)
  (Colly's "log in with Google is the only option for them"). It opens for
  them, or the office or a director once roles are on; anyone else gets one
  Sign in with Google button that comes back to the page. Freelancers'
  links and calendar feeds are unchanged; the demo keeps its passcode.
- Staff stay signed in for 400 days after they last used the app, renewed
  each day (was 60), so in practice until they sign out (Colly's "persist
  their login for as long as possible"). 400 days is the most a browser
  keeps.
- Checked: typecheck, 290 shared and 514 server tests, including new ones
  for a staff page signed out, signed in, signed in as someone else, and
  turned away by Google.

**Waiting on**

- Staff: their email on the Crew tab must be the Google address they sign
  in with, as roles already need.

## 18 October 2026, late: Freelancer in the list of roles

**Done**

- Warehouse is out of the staff role list and Freelancer is in, on Colly's
  ask, in [Decision 0051](adr/0051-freelancer-in-place-of-warehouse.md): a
  freelancer signed in can look and report a fault, reads only their own
  rate and link, and asks for no leave; their offers, timesheets and days
  off still go through their private link. Anyone on the Crew tab as a
  freelancer signs in as one. Whoever had the warehouse role is now a head
  of department, so keeps the stock and kit. The demo's Warehouse persona
  stays, held to a head's role.
- Checked: typecheck, 802 unit tests, the two role browser tests.

## 18 October 2026, night: long lists drawn in a window

**Done**

- Jobs' list and Crew's calls draw only the rows near the screen, the rest
  standing in at their heights, in [Decision 0050](adr/0050-long-lists-drawn-in-a-window.md)
  (Colly's "faster long lists"). With 900 extra jobs on a slowed phone the
  Jobs tab went from 254–587 ms to 80–242 ms and Crew from 730–959 ms to
  132–192 ms. Back still finds the row a job was opened from. Filled calls
  are built only once unfolded. Find in page now reaches only the rows
  near the screen; the list's own search covers the rest.
- Checked: typecheck, the full browser suite (113 tests; the long-list test
  three times more), scrolling end to end on a phone and in the laptop's
  column with no blank rows.

**Waiting on**

- Colly: the Railway start command, the backup variables and the Sentry key,
  as before.

## 18 October 2026, evening: the audit's P1 fixes

**Done**

- All nine P1 findings of the [audit of 18 October](audit-2026-10-18.md),
  findings 4 to 12, in [Decision 0049](adr/0049-holding-up-at-real-size.md)
  (PR #88, live on Railway 14:28): the app's files and the copy go
  compressed (1.3 MB of app to 0.33 MB); database time limits, a busy
  answer after 3 s instead of a stalled phone, and a read pool of its own;
  freelancers' calendars read in a worker from near today and capped; an
  edit made against an old copy turned down in words, the typed text kept
  to copy; only the office and directors change a role-holder's email,
  never from a link, and no two people share one; a new screen opens at
  its top and Back finds its place; a role sees only the buttons it can
  use; Crew › Calls shows the short calls, filled ones folded; views kept
  between changes and the saved copy written a table at a time (an own
  edit 130 ms to 45 ms, the Crew tab 3.8 s to 2.4 s on a slowed phone).
  Node pinned to 22.
- Checked: typecheck, 801 unit tests, 112 browser tests, CI with real
  Postgres; live, health answers and the app's files come back as Brotli.

**Waiting on**

- Colly: clear the start command in the Railway dashboard (finding 25),
  plus the backup variables and the Sentry key as before.
- Next: windowed long lists (the Jobs tab tap), and checking a person
  brought back from the archive against everyone's emails.

## 18 October 2026, later: messages to crew are off until the office says

**Done**

- A company-wide switch under Admin › Messages to crew
  ([Decision 0048](adr/0048-messages-to-crew-off-until-said.md)), off by
  default: while it's off, Offer, Send, Tell and Ask open nothing. The
  offer is still made and the change still reaches the person's private
  link; in the Send panel's place a card says messages are off, who would
  have been sent what, and where to turn them on. Finding 3 of the
  [audit of 16 October](audit-2026-10-16.md), now that the two real
  calendars are in.
- Checked: typecheck, 774 unit tests, and the crew booking browser test,
  which now starts quiet, turns messages on through Admin, then sends.

**Waiting on**

- Colly: the backup variables and the Sentry key; and, once the imported
  lists are tidy, turning messages to crew on under Admin.

## 18 October 2026: a full audit, from reliability to the screens

**Done**

- A full audit of the app with all six new features in
  ([Audit, 18 October 2026](audit-2026-10-18.md)): sync and data at real
  size, security and privacy, every screen as each role on a phone and a
  desk, and speed and running it. Two P0s in the sync (a pull that can
  skip a change, a phone with a backlog stuck for ever), backups and
  alerts still off, and an order to fix the rest.
- Checked: everything was local; nothing live was read or changed.
- The two sync P0s fixed ([Decision 0001](adr/0001-sync-engine.md),
  amended): a pull that finds nothing new keeps the device where it was,
  and every device reads its copy again once, keeping what it has
  waiting; a phone sends 50 changes at a time, a resend is answered from
  one look, a slow push is answered in part inside 20 seconds, and a
  round whose push fails still pulls.

**Waiting on**

- Colly: the backup variables and the Sentry key, and clearing the
  dashboard start command on both Railway services.

## 17 October 2026: vans and drivers

**Done**

- Stock › Vehicles: the company's vans, Lutons, trucks, cars and trailers,
  each with its registration, seats, payload and notes, and its checks:
  NCT or CVRT, motor tax, insurance, service due and, for a truck, the
  tachograph. Each has its own page, where it's taken off the road (in for
  repair, until a day or until it's back) and retired
  ([Decision 0047](adr/0047-vans-and-drivers.md)).
- A Vehicles card on each job's page books a van on the whole job or one
  phase, for given days, with a driver from the crew; errands are booked
  the same way. A road check run out on the booking's days is refused by
  name, before anything is sent and again on the server; so is a driver
  with no licence, or one run out. Another job on the same van that day,
  or a day off the road, asks first and is booked anyway. A licence not
  recorded, a check not recorded and a service overdue warn.
- Each booking says what's wrong with it from today on, worst first, and
  nothing is taken off later: a check that lapses after booking shows on
  it.
- The planner has Vans rows: one per vehicle, the jobs it's on and who
  drives, off the road, and a van on two jobs as a clash in To sort out.
  A job's day names its vans and drivers.
- Call sheets, in the app and on a freelancer's link, list the vehicles on
  that phase and who's driving.
- Checks running out are listed on the Vehicles page, beside the
  certificates and documents on Crew › People, and counted on Home for
  the company and the warehouse. The app asks nobody for anything.
- The made-up data has Big Van (motor tax running out, service overdue,
  booked on two jobs on one day) and The Luton (in for a new clutch, its
  driver's licence not recorded), and an errand to collect stage decks.
- Checked: typecheck, unit tests (shared and server), the web build, the
  hub build and the browser tests.

**Waiting on**

- The office: the real vehicles and their check dates, and drivers'
  licences on their cards.
- A decision on licence categories (C1 for a heavy Luton, C for a truck),
  which aren't checked yet.

## 17 October 2026: a department on every call, and what each role reads

**Done**

- Every crew call has a department from the crew profiles' list, or none.
  Asking for crew starts it on the one its role suggests (from calls for
  the same role, then people with the role as a skill, then the role's
  words), with a line saying so; it changes on the call's edit form.
  Calls brought in from the calendar take the one most of their people
  are in, or none
  ([Decision 0046](adr/0046-departments-on-calls-and-what-each-role-reads.md)).
- Crew › Calls narrows to a department, a head of department starting on
  their own. Narrowed to "No department", it gives many calls one at once,
  nothing ticked to start. Home for a department counts the crew its calls
  still need. Call sheets and the show pack carry the call's department.
- Crew rates, timesheet amounts and freelancers' private links go only to
  the roles that need them: all to the office and directors; a head of
  department their own department's links, and rates if a director
  allows it in Admin; the warehouse and staff crew none but their own.
  Records still go to everyone with those fields left out, and every
  screen says what's hidden for the role. Setting or agreeing a rate, and
  deciding a timesheet, are refused for a role without rates, with who
  can. The history leaves the figures out for them; Download everything
  stays with the office and directors.
- The demo's personas are sent what the person they stand for would be
  sent, and You says what each role reads.
- Checked: typecheck, unit tests (shared and server, with each role's
  feed checked for rates and links it shouldn't hold), the web build, the
  hub build and the browser tests.

**Waiting on**

- Colly: whether heads of department should see crew rates (Admin, off
  to start).
- The office trial: whether the warehouse and staff crew still need every
  phone number and certificate, the last of the reading left open.

## 17 October 2026: the Crewbox show pack

**Done**

- Show pack, on each phase's call sheet and on the job's page: one .zip
  for the Crewbox, made on the device from what it holds, so it works with
  no signal, and sent nowhere. In it: the crew who said yes (what they go
  by, role, department, call time, days), the running order as Crewbox
  acts read from the phase's notes and the run of show as typed, the kit
  with the Session Hire numbers scanned out, the venue and its access
  notes, who to ring on the day and the office, a crew list to print, and
  a manifest with the format's version
  ([Decision 0045](adr/0045-the-crewbox-show-pack.md)).
- The join QR: typing the box's address (and the event PIN) when making
  it puts a QR code of the box's join page on the crew list. Neither is
  kept in the app.
- Crew numbers are in it only for the office, heads and directors, as the
  contact on the day's call sheet has them; anyone else's pack has the
  contact's number only. No rates or prices in any pack.
- The patch and lighting sheets are empty, with their columns: the app
  doesn't plan either yet. Every file's layout is written down in
  [crewbox-show-pack.md](crewbox-show-pack.md) for the Crewbox side.
- Checked: typecheck, unit tests (shared and server), the web build, the
  hub build and the browser tests.

**Waiting on**

- The Crewbox side: a running-order import that reads
  `running-order.csv`, and a check of the patch and lighting columns
  against Crewbox's own export layout, which couldn't be read from here.

## 17 October 2026: kit lists from the notes

**Done**

- Jobs brought in from the calendars keep their job sheets in the notes;
  the kit lists in them (`4 x d&b Y10P`, `2x d20 amp`, `Shure ULXD x 2`)
  can now become kit lines. A job's Kit card says what its notes list and
  opens Kit from the notes: each line as written, the product it matched
  (by name, by its model or code, or a close match), how many, and in
  words what it will do. Any line can take another product, another
  number, Not kit, or New product… (for roles that can change stock).
  Nothing goes on until it's added.
- A line from a phase's notes goes on that phase; from the job's notes,
  on the whole job. What the job already has counts, so nothing is
  doubled, even when the same notes are read twice or by two phones with
  no signal. The notes stay as written.
- Names chosen are remembered: "d20 amp" chosen as the D20 once matches
  it on every job after, and a name said to be not kit stays not kit.
- Kit in the notes (from the Jobs list, the bring-in and the Menu) lists
  the jobs whose notes hold kit not on them yet, coming up first: those
  where everything matched go on together, asked first; the rest each
  open their own lines. Matching runs on the phone and works with no
  signal; a season goes in batches of 50 jobs a change
  ([Decision 0043](adr/0043-kit-lists-from-the-notes.md)).
- The made-up data has three jobs with kit in their notes: one to check,
  one with a phase's notes, and one ready to add.
- Checked: typecheck, unit tests (shared and server), the web build, the
  hub build and the browser tests.

**Waiting on**

- Adam or the office: a look at a few real job sheets on the made-up
  data's pattern once the stock list is in, to see how many lines match
  by name and which names need choosing once.

## 17 October 2026: freelancers' own calendars, read only

**Done**

- A freelancer can share when they're busy from their private link, by
  pasting their calendar's private address (Google's secret iCal address,
  Outlook's or iCloud's published link, or a webcal:// one). The page says
  first that only busy times are kept, never what, where or who with, and
  that nothing is added to their calendar. One tap stops it.
- The office can add the address a freelancer sent on their page, in a
  card "Their own calendar", read it again now, or stop reading it.
- The server reads each calendar at once, then every three hours: busy
  times only, four months ahead, repeating events worked out, our own
  Session Hire bookings left out.
- Busy days show in the planner as "Busy (own calendar)", on the person's
  page, and as a warning when offering work; the offer can still go.
- The address is kept on the server as a secret: not on devices, not in
  the history, not in Download everything, and blanked in error reports.
  The server reads only public https addresses, checked again after each
  redirect, with time and size limits
  ([Decision 0044](adr/0044-freelancers-own-calendars-read-only.md)).
- Checked: typecheck, unit tests (shared and server), the web build, the
  hub build and the browser tests.

**Waiting on**

- Nothing to set up: no keys or accounts are needed. Colly: whether four
  months ahead and every three hours are right for how far out work is
  offered.

## 17 October 2026: quotes and a money view

**Done**

- A price list: a day price on each product and each crew role, and a
  client's usual discount, at Jobs › Money › Price list.
- Quotes on a job, at the job's Quote card: built from its kit and crew at
  those prices, every line open to change (what, how many, days charged,
  price, VAT at 23%, 13.5% or 0%), the kit's days set at once, and the
  client's discount. Once it's marked sent it stays as it went, and a
  change is a new version. It prints as an A4 page to save as a PDF; the
  app sends nothing. The office records the client's answer, the invoice
  (day and number) and the payment.
- Money, a page along Jobs' row for the director and the office: by month,
  quoted, confirmed and invoiced; who owes, by client; freelancers owed,
  marked paid from approved timesheets; and each job's margin. Home's
  whole-company view has a short Money card.
- Files for the accountant, for a VAT period or a year: invoices by VAT
  rate, VAT by period and rate, and freelancer costs. The new tables are in
  Download everything.
- Only the office and directors are sent money: the server leaves it out
  of every other role's copy ([Decision 0042](adr/0042-quotes-prices-and-a-money-view.md)).
- Checked: typecheck, unit tests (shared and server), the web build, the
  hub build and the browser tests.

**Waiting on**

- Colly: the company's VAT number, address and quote terms, if the PDF
  should carry them (the office details have no field for them yet; the
  quote's notes do for now).
- Colly: whether invoice numbers should be made in the app one day, or
  stay the accounts package's.

## 16 October 2026: Crew's own pages

**Done**

- Crew's row now names four pages, now each person has a page of their
  own: Calls (answers to check and crew still needed), People (the list and
  certificates running out), Leave and Timesheets. Calls and Leave count
  what the Crew tab's badge counts, so the badge says where to look; a
  person's page reads Crew › People › their name
  ([Decision 0041](adr/0041-where-things-live.md)).
- Checked: the whole browser test suite and typecheck.

**Waiting on**

- Nothing.

## 16 October 2026: everything moved to where it lives

**Done**

- Colly chose "Move it all". Jobs, Stock and Crew each name their pages in
  a row under the header: List · Week · Month · Clients · Venues;
  Catalogue · Places · Labels · Counting · Testing · Repairs (tests overdue
  and repairs open counted); Calls · People · Leave · Timesheets
  ([Decision 0041](adr/0041-where-things-live.md)).
- Every address starts with its area (`#jobs/plan`, `#jobs/venues`,
  `#admin`…). Old links and bookmarks land on the new pages.
- The crew and stock lists are brought in under Crew and Stock; Admin
  keeps a "Bring lists in" card linking to all three, and is otherwise
  settings. Clients and venues have a list page each; the Menu names them.
- Checked: the whole browser test suite, server tests and typecheck.

**Waiting on**

- Nothing. Crew's split came in a second step, once each person had a page.

## 16 October 2026: a page for each person

**Done**

- Colly asked for a page per crew member. Everything about a person was
  already kept, but it only opened as a long fold inside the People list.
  Each person now has a page of their own under Crew
  ([Decision 0040](adr/0040-a-page-for-each-person.md)): their picture,
  name and who they are, Call, WhatsApp and Email, their details, level
  and role; what's coming up (bookings and offers, each opening its job,
  and days off); certificates and documents; every job they've worked;
  and their private link. The People list is one line each that opens
  it, and a name on a call card or a person's lane in the planner opens
  it too. Archive is one tap from the page and the list says so, with
  the way back.

**Waiting on**

- Nothing new. Photos wait on the backup bucket, as the icons work says.

## 16 October 2026: icons, and pictures of kit and crew

**Done**

- Colly found the app very text heavy. Every card heading now starts with
  an icon, the Menu's places have one each, kit has a square picture
  (a placeholder with the icon for what it is: speaker, spotlight, cable,
  case…) in the stock list, on a job's kit lines and at the top of its
  page, and crew have a round one with their initials in People, on crew
  calls and on Home ([Decision 0038](adr/0038-icons-and-pictures.md)).
- The icons live in the shared design system now (version 0.4.0): one open
  set, Lucide, named by meaning, with the rules for icons and pictures, so
  every app draws the same ones.

**Waiting on**

- Colly: merge the design system's pull request for the icons. Photos in
  place of the placeholders wait on somewhere to keep files (the backup
  bucket).

## 16 October 2026: a way up from every page, and where things live

**Done**

- Colly asked for breadcrumbs or a back button. Every page under Jobs,
  Stock, Crew and the Menu now has its way up in the top bar, so it stays
  in view down a long page: one link to the page above on a phone ("‹ All
  jobs"), and the whole way down as breadcrumbs on a desk (Jobs › Liffey
  Brands Shoot › Pick list)
  ([Decision 0039](adr/0039-the-way-up-and-breadcrumbs.md)).
- Looked over where everything lives and wrote up a tidier structure
  ([where things live](information-architecture.md)): addresses that start
  with their area, each list brought in where it lives, list pages for
  clients and venues, Stock's long screen split into its parts, and Admin
  as settings only.

**Waiting on**

- Nothing: Colly chose to move it all (next entry up).

## 16 October 2026, later: a season comes in within the app's wait

**Done**

- Colly took the first bring-in back (141 jobs, in the history) and
  brought Adam's calendar in from 19 December 2025: 767 jobs over 1,714
  days, 678 crew bookings and offers, 73 people, 37 venues. The server
  took 1 minute 47 seconds to save it, one row a round trip to the
  database, and the app had stopped waiting at 60 seconds and said it
  couldn't reach the server, though everything landed.
- The bring-in now gathers the jobs, phases, calls, offers and event-days
  and writes them a few hundred per statement, and the take-back removes
  its rows the same way, so a season takes seconds. The app waits up to ten
  minutes for a look, a bring-in or a take-back, says "Saving them all in
  one go" while it does, and a slow answer says the server may still be
  working rather than that there is no signal.

**Waiting on**

- Colly: bring Olan's calendar in from the same first day; then the backup
  bucket and the Sentry key.

## 16 October 2026: the bring-in learns from the real calendars

**Done**

- Colly said go on the audit's fix order. A job now has a kind: gig, dry
  hire, errand or meeting ([Decision 0037](adr/0037-job-kinds-and-days-gone-as-history.md)),
  guessed from the title on the import screen and corrected there before
  saving; only a gig gets a crew call, and the invited are noted on the
  rest. Days gone come in as the record of who worked: a Yes is a booking,
  anything else is noted, so no call is still looking for crew for a gig
  that happened, and a booking brought in after its day has no timesheet
  to chase. "Build 4/9 & Client Walk Through" is a Build with a note, a
  day naming two phases books its crew once, people's names are typed on
  the import screen where Google had none, and a shared mailbox is never
  crew.
- The import screen says what has been brought in so far and can take it
  all back in one go, so the calendars can come in again from the first
  day with the new rules. It refuses once anyone has acted on those jobs
  in the app.

**Waiting on**

- Colly: take the first bring-in back on the import screen and bring both
  calendars in again from the start of the season, checking the kinds and
  typing the names; then the backup bucket and the Sentry key.

## 16 October 2026: the real calendars are in, and audited

**Done**

- Sign-in is live, the company's Google account is connected, and Colly
  brought in two organisers' calendars: 141 jobs, 149 phases, 66 crew
  calls, 179 offers, 36 people and 12 venues, from 1 October 2026 on. The
  app holds real data only; nothing has been written back to Google and
  crew invites are off.
- [The audit of the real data](audit-2026-10-16.md), read-only: what the
  import made of the calendars, and what the office would see. The import
  ran clean, but a calendar is not a job list: dry hires, collections and
  meetings came in as gigs with crew calls; Google's unanswered invites
  became 54 offers waiting and 41 timesheets to chase; most freelancers
  are named from their email handle; the second organiser's tidy titles
  split four jobs into thirteen. Nineteen findings, with the order to fix
  them.

**Waiting on**

- Colly: the backup bucket and the Sentry key (still off, now with real
  people in), and the go-ahead for the import fixes before the next
  bring-in.

## 16 October 2026: Google sign-in live, and calendar writing held off

**Done**

- Colly added the Google key. Sign-in is live (`"auth":"google"`), Colly
  signed in, connected Google Calendar and brought in 141 real jobs from two
  calendars. The app had written nothing to Google: it held no jobs of its
  own before the import.
- Colly asked that the app write nothing to Google Calendar and contact
  nobody for now. Writing is now off unless `CALENDAR_WRITES` is `on` on the
  server ([Decision 0008](adr/0008-calendar-sync.md), last section);
  bringing jobs in still works. Nothing else in the app sends anything to
  anyone: crew invites were its only way to email.

**Waiting on**

- Colly: say when the app may write to the calendar.

## 13 October 2026: the Google steps brought up to date

**Done**

- Colly has a Google Workspace account for Session Hire now. The steps for
  switching on sign-in and Google Calendar ([sign-in-setup.md](sign-in-setup.md))
  were checked against the app as it is: what was the Account tab is now
  Admin and You in the Menu, the demo copy keeps its passcode and no Google
  key, `STAFF_DOMAINS` is there for a Workspace not on sessionhire.com, and
  two new steps say when to start fresh and how to switch roles on.

**Waiting on**

- Colly: the Google key and the two Railway variables (steps 1 to 3), then
  the office trial and the phone field test.

## 12 October 2026: a desk layout, a sidebar, and dark by default

**Done**

- Colly asked for better use of a desk's width, the bottom bar as a
  sidebar there, a dark theme by default with a toggle top right, and the
  header to be the company with "seeing it as Director" under it
  ([Decision 0036](adr/0036-desk-layout-sidebar-and-dark-by-default.md)).
- From 900px across, Home, Jobs, Stock, Crew and Menu are a sidebar down
  the left; a phone keeps the bar along the bottom. From 1200px a screen's
  cards stand two across, and the Menu's groups too.
- The app opens dark. The sun or moon at the right of every header
  switches to light, and You has the same with "match this device's
  setting"; the choice stays on that device.
- The header is the Session Hire mark and name. On the demo, "Seeing it as
  Director" sits under it, the name a link back to choosing someone else,
  in place of the black bar.
- Home is the page's title, with today's date at the top right of the
  header.
- Checked: typecheck, unit tests, the full end-to-end suite with a new
  test for the sidebar and the theme, and the demo in a browser on a
  phone, a 1024px tablet and a 1440px desk, dark and light.

## 11 October 2026: roles, and what each can change

**Done**

- Colly asked for roles and permissions next. Each persona with an
  account is now a role: **director**, **office and production**, **head
  of department**, **warehouse** and **staff crew**. Freelancers keep
  their link. A role decides what a member of staff can *change*; everyone
  signed in still reads everything
  ([Decision 0034](adr/0034-roles-and-what-each-can-change.md)).
- The server checks every change and every settings request against the
  sender's role, and turns one down with who can and who to ask. The app
  works the role out the same way from its own copy, so it holds offline,
  turns a change down before keeping it, and doesn't offer what the role
  can't do (New job, Ask for crew, Add person, Add product, the settings
  cards).
- A role is set by a director on the person's card on the Crew tab, found
  by the email they sign in with. Admin shows **Your role**. Roles start
  off: **Switch roles on** in Admin makes you the first director, and
  there's always one after that. Who approves time off is now a
  director's to give.
- The demo's **See it as…** personas are the roles: the server holds the
  browser to the one chosen.
- Checked: typecheck, the unit tests (new ones for roles on the server
  and the shared rules), the end-to-end tests for crew, jobs, Home,
  leave, stock and refusals, and the demo in a browser as the warehouse
  and as a director.

**Waiting on Colly**

- Once Google sign-in is on: switch roles on from Admin, then give the
  office, heads and warehouse their roles on the Crew tab. Everyone needs
  the email they sign in with on their own person.

**Next**

- Narrow what each role can read (rates, phone numbers and private links
  for staff crew).

## 11 October 2026: Home, and finding your way around

**Done**

- Colly asked for a look at the app through the eyes of each kind of
  person who uses it, and said that on a phone every screen looked the
  same and nothing gave an overview. [Who uses it, and how](personas.md)
  sets out six personas (director, office, head of department,
  warehouse, staff crew, freelancer), a job's path through them, and
  what fell short for each, rated
  ([Decision 0033](adr/0033-home-and-finding-your-way-around.md)).
- **Home**, first in the bar: today, the counts that need someone, and
  the week ahead, shown for the company, a department, the warehouse or
  me. It starts on the person's own department when their profile has
  one, and the phone remembers the choice. A count that's nothing isn't
  shown.
- **Five places, each with a picture and a word:** Home, Jobs, Stock,
  Crew and Admin. History moved under Admin, which is Account renamed.
- **Each area's screen has its name as a large title**, and every long
  screen has **On this screen**: its parts by name under the bar, with
  their counts, a tap away, marking the one in view.
- **A freelancer's page** opens with what's waiting on them and what's
  next.
- **The demo copy opens on "See it as…"**: pick a director, the office,
  a head of department, the warehouse, staff crew or a freelancer, and the
  app opens where that person starts, with a bar on every screen to choose
  someone else.
- Checked: typecheck, the unit tests and the end-to-end suite, with a new
  test for Home, History under Admin and the strip.

**Next**

- A department on each crew call, so a department's Home narrows crew
  still needed too.
- ~~Decide whether the app needs roles and permissions~~: built, above.

## 10 October 2026: screens checked against the shared behaviour rules

**Done**

- Every screen was read against the design system's behaviour rules
  (`behavioural.md` and principles 1 to 15), and what fell short was
  fixed. Most of it is about never losing typed work, asking before
  things that can't be taken back, and saying what a press did where it
  was pressed.
  - **Jobs.** A scan that wasn't recorded stays until it's dismissed.
    Taps on the pick list say what they recorded. Asking for crew and
    adding a phase say so where the form is. The calendar import keeps
    its picks when you go back, and says which step it's on.
  - **Stock.**
    - Fixed, Not faulty and Found ask first, since the kit can go out
      again.
    - A test and a retirement start with nothing chosen.
    - A new number asks before the old one is gone for good.
    - Counts and moves say what they did.
  - **Crew.**
    - A refused form on a freelancer's page keeps what they typed.
    - Decline is folded away from Accept.
    - Release, Say no, Withdraw and cancelling approved leave ask first.
    - A timesheet check isn't wiped when a new version arrives.
  - **Everywhere.**
    - Account and History show what's waiting to sync.
    - Waiting to sync is drawn quietly rather than in amber.
    - A closed fold keeps what was typed.
    - Signing out sends waiting changes first.
    - Buttons say what they do.
  - **A new job starts as an enquiry** (Colly's call), so nothing goes on
    the jobs calendar or holds kit until someone confirms it.
- What the system didn't cover went back to it as learnings
  ([design-system PR #6](https://github.com/legofsalmon/design-system/pull/6)).
- Checked: typecheck, the unit tests and the end-to-end suite.

**Next**

- An Undo notice, so reversible actions can stop asking first.

## 10 October 2026: a page for each venue and client, with their documents

**Done**

- Colly asked for each venue, and then each client, to have its own page
  with somewhere to keep documents
  ([Decision 0032](adr/0032-venue-and-client-pages-and-their-documents.md)).
  A venue in the Jobs tab's list now opens its page: the address with the
  map, the notes, its documents and the jobs there. A client opens its
  page the same way: its contacts to ring or email, the notes, its
  documents and its jobs. A job's venue and client link to their pages.
- Each document is a file, a link to where it's shared (Dropbox, Google
  Drive, a website), or both, with a kind: tech spec, floor plan,
  rigging, power, access and load-in, health and safety for a venue;
  contract, purchase order, brief, brand guidelines, insurance they ask
  for for a client.
- Links work now, with no signal too. Files are kept and opened exactly as
  people's documents are, so they wait on the same storage bucket.
- Checked: the typecheck, the shared and server tests (with four new ones
  for these documents), and two new browser tests on a phone: one adds a
  link and a file on a venue, opens the file and removes a document; the
  other adds a link on a client and changes a contact.

**Next**

- Set the storage bucket (the BACKUP_S3_ settings) to turn on files, for
  people's documents and those on venues and clients alike.
- Perhaps: crew opening a venue's documents from their call sheet.

## 10 October 2026: the planner's days open their job

**Done**

- In the Jobs tab's Week and Month views, a job's days now open that job,
  and so does anywhere in its name cell on the left, not just the words
  ([planner decision](adr/0010-planner.md)). Crew asked for on the Crew
  tab, with no job behind them, still go to the Crew tab from their name.
- Checked with the planner's end-to-end tests, which now open a job from
  a day and from the edge of its name cell.

## 9 October 2026: colours from the shared design system

**Done**

- The app's colours, and the freelancer's pages', now come from the
  shared design system that Colly's other apps take theirs from
  ([design system](design-system.md)): the page, cards, text, lines, and the
  green and amber. Session Hire keeps its own red for the one thing to do
  next, the current tab, links and focus, and its burnt-orange bad tone.
  Layout, type, spacing, corners and components are as they were.
- Checked in both themes: the unit tests (including a new check that the
  vendored token files are unedited), the end-to-end suite with its
  contrast checks, and every text colour against the page and a card.

**Next**

- Bring the Figma file's colours over to match.

## 9 October 2026: a demo copy, locked with a passcode

**Done**

- For showing the app as a proposal before the Google key is in, a
  `DEMO_PASSCODE` setting now locks a copy of the app behind one shared
  passcode ([PR #61](https://github.com/legofsalmon/sess-sys/pull/61);
  [sign-in setup](sign-in-setup.md)). Freelancers' private links still
  open without it, and once the Google key is set Google sign-in takes
  over.
- A separate demo copy runs on Railway as the `demo` service, in the EU,
  with its own small database on a Railway volume, so nothing touches the
  live app's data. It deploys from `main` like the live app and sleeps
  when nobody is using it. It is filled with made-up data. Its address
  and passcode are in the project thread, not here.

**Next**

- Start fresh, then made-up data again, on the demo copy before each
  showing if it has been played with.

## 8 October 2026: stocktakes and rolling counts merged and live

**Done**

- Colly chose "Merge it" for stocktakes and rolling counts
  ([PR #57](https://github.com/legofsalmon/sess-sys/pull/57),
  [Decision 0030](adr/0030-stocktakes-and-rolling-counts.md); see
  4 October). It was brought up to date with getting kit ready and back
  (7 October) first, and the full suite passed with both: the
  typecheck, the shared tests (194), the server tests (427) and the
  browser suite (84).
- Merged into `main` at 19:35 UTC once GitHub's checks passed, and live
  by 19:47: Railway deployed it on its own.

**Next**

- Phase 2's app work is done. What's left is the labelling rollout,
  which is work in the warehouse rather than in the app, and RFID later.
- The stock list, then the baseline stocktake: count every place once,
  from the Counts card on the Stock tab.
- The keys: the Google key, the backups bucket with `BACKUP_KEY`, and
  the Sentry key.

## 7 October 2026: getting kit ready and back

**Done**

- **Getting kit ready and checking it back in**
  ([Decision 0031](adr/0031-getting-kit-ready-and-back.md)), the next
  item in the plan ("working hours and buffer time on availability").
  Each job now holds its kit a day before, to get it ready, and a day
  after, to check it back in, so a job the day before or after can't
  have the same speakers. The Kit card says the days held, with a
  Change link for any job to say from 0 to 14 of each: none before when
  it has its own Prep phase, or none either side when kit goes straight
  from one job to the next. A shortage on one of those days says so:
  "Short 2 on Tue 3 Sep, getting it ready".
- **Kit still out after its job isn't free.** Once a job's days are
  over, kit scanned out with it and not back is taken off what's owned
  until it's scanned in, and its line says "2 still out after their
  jobs". Kit already reported missing or not fit to go out isn't counted
  twice.
- **Hours, not yet.** Phases are whole days, and the calendar events
  carry no times, so the days held are whole days too. Hours can come
  with times on phases if the office wants them.
- Jobs already in the app hold a day either side from now on, so a few
  more shortages may show between jobs a day apart. In the made-up data,
  two speakers still out after the gala now show short on the next two
  jobs, as they should.
- Six crew tests had started failing on their own once their October
  dates passed; they now run on a fixed day.
- Checked: the typecheck; the shared tests (180); the server tests (408,
  two new); the web build; the full browser suite (78), with the kit
  spec now changing a job's days from the Kit card.

- Merged into `main` at 10:27 UTC once GitHub's checks passed, and live
  by 10:36: Railway deployed it on its own.

**Next**

- Stocktakes and rolling counts
  ([PR #57](https://github.com/legofsalmon/sess-sys/pull/57)) took
  Decision 0030 first, so this is 0031. With both in, the rest of
  Phase 2 is the labelling rollout, which is work in the warehouse
  rather than in the app, and RFID later.

## 4 October 2026: stocktakes, rolling counts and four loose ends

**Done**

- Colly, 4 October: "Merge 56 and go with 1 and 2". #56 is merged and
  live (see 3 October). Then the two parts below, each built, then read
  by a reviewer trying to break it and corrected.
- **Stocktakes and rolling counts**
  ([Decision 0030](adr/0030-stocktakes-and-rolling-counts.md)).
  - A place or a case is counted on a phone, with no signal needed.
    Labels are scanned. Counted kit is typed without the record beside
    it, so the number on the screen doesn't become the count.
  - **Finish** says what's different, in words, with each fix one tap
    away:
    - not found: report it missing;
    - in the wrong place: move it here;
    - not expected: bring it back, mark it found, or put the label on
      its item;
    - counted kit short or over: set the count.
  - Kit out with a job, already missing or in repair is never called
    newly missing. Counted kit out on jobs never lowers what's owned.
  - Each place and case shows when it was last counted and by whom, and
    each item's log says what a count found.
  - The Stock tab's Counts card lists this week's places: those never
    counted first, then those counted longest ago, so every place is
    counted within a quarter. It shows how far the round has got. The
    first round, once the stock list is in, is the baseline stocktake.
- **Four loose ends**:
  - **Hidden characters.** Text pasted from Word or a PDF can carry
    invisible control characters. They gave a server error on staff
    forms, and also on the freelancer's link, the crew list import and
    documents. Text is now cleaned of them everywhere, keeping tabs and
    line breaks. A character the database still can't hold is turned
    down in plain words, never a crash, and is never reported as one.
  - **"Mark as there"** works now on a phone that hadn't yet heard the
    freelancer say they were late.
  - **Archived approvers.** Someone archived is told so when they try
    to approve leave, on the server and on the Leave screen.
  - **A history browser test that failed now and then.** It was a race
    in the test itself, and two other tests had the same pattern; all
    three are fixed. In the app, a sync asked for while one was failing
    now runs, with one retry at a time, never more.
- Found and fixed in review:
  - a count could move an item out of its case;
  - a case found only by what's in it was called missing;
  - an older count's page could undo newer changes;
  - a long maker's QR code could leave a count that could never be
    finished;
  - two tabs on one phone overwrote each other's scans;
  - a phone with its clock set ahead could leave a place counted for
    good;
  - a half-done count stayed on the phone after signing out;
  - the history named the wrong counter;
  - the character safety net would have hidden a real server bug;
  - sync retries piled up on a poor signal.
- The download test in the history spec failed once the shared test
  server had more than 1,000 rows. The test expected "(123 rows)", but
  the app writes "(1,234 rows)". The test now reads the number as the
  app writes it, and the size in MB too.
- Checked with both parts together:
  - the typecheck;
  - the shared tests (194);
  - the server tests (412 on PGlite, and the real-Postgres file, 13);
  - the web build;
  - the full browser suite (84);
  - the history, counts and sign-in specs ten times over (120).

**Next**

- The stock list next week. Then the baseline stocktake: count every
  place once, from the Counts card on the Stock tab.
- The keys:
  - the Google key;
  - the backups bucket, with `BACKUP_KEY`, for documents' files too;
  - the Sentry key.
- Then the real crew list, after Start fresh, and an approver opening
  2026 for leave.

## 3 October 2026: the small items

**Done**

- The small items Colly asked for ("you can start on those small
  items"), each built, then read by a reviewer trying to break it and
  corrected.
- **Running late from the office**
  ([Decision 0028](adr/0028-certificates-a-call-needs-and-running-late.md),
  amended). Someone who rings in to say they're late can be noted from
  the call's line, with the same choices as their link, and marked as
  there. It shows everywhere the link's does, and the history says who
  noted it.
- **Old running-late notes cleared.** Thirty days after its day, a
  running late goes, with every copy of it and the words in the
  history, since no law asks for it; the server does it on its daily
  look.
- **The call-changed message** says when a call starts or stops
  needing a certificate, and call sheets show what each call needs.
- **Documents** ([Decision 0029](adr/0029-documents.md)). A person's
  insurance, certificate cards and other documents, each with a day it
  runs out, on their card; a freelancer sends a renewed one from their
  link and the office checks it, which sets that certificate's date, so
  there is only ever one. Documents running out join certificates in
  one list, with a message ready. Files go in the backups' bucket,
  encrypted with `BACKUP_KEY`; until the bucket is set up the details
  and dates work and the file waits. Erasing a person deletes theirs at
  once.
- Every request now has five minutes to arrive, so nobody can hold a
  connection open for ever by sending a post a byte at a time.
- Found and fixed in review: a running late turned down for a day far
  off, or no real day, would have kept its words for good; "Mark as
  there" had a different name for screen readers than on the button; a
  document's download failed when its name was cut in half an emoji;
  the link's upload read 10 MB from anyone before checking the link;
  and a long one-word title pushed a phone's page sideways.
- Checked with both together: the typecheck; the shared tests (180);
  the server tests (394 on PGlite, and the real-Postgres file, 12, with
  two servers clearing at once); the web build; the full browser suite
  (78), and the documents and certificates specs three more times.
- Merged into `main` on 4 October at 07:24 UTC (Colly: "Merge 56") and
  live by 07:34 once main's checks passed. The live database has the
  documents module at version 1 with its `documents` and
  `document_files_to_delete` tables, and nothing went wrong at start-up.
  The server says documents' files are off until the backups' bucket is
  set, as expected: their details and dates work meanwhile.

**Next**

- See 4 October.
- The stock list next week. On the live server, a list of 1,500 rows is
  expected to take about 8 to 10 minutes with the page left open.
- The keys: the Google key, the backups bucket (now for documents'
  files too, with `BACKUP_KEY`), and the Sentry key. Then the real crew
  list, after Start fresh, and an approver opening 2026 for leave.

## 3 October 2026: leave years the office opens

**Done**

- **Leave years the office opens** (Colly, 3 October: "the office have
  to manually open the years for leave. So staff can't apply for leave
  very far in advance"; ADR 0024 amended). An approver opens each year
  for leave from the Leave screen, this year or next only, and an open
  year stays open. Staff can only ask for leave in an open year, and are
  told plainly when the next one isn't open yet; allowances can be set
  for this year or next. On a server already in use, the update opens
  this year and any earlier year that already holds leave. Since no
  leave can now be put in a year far ahead, a slip can't keep an erased
  person's name for decades.
- Colly confirmed that erasure keeps declined and cancelled leave for
  three years along with approved leave, and that a kept name lasts as
  long as the records it's kept for. Both were already so; ADR 0027
  says it.
- Found and fixed in review: the update would have opened a year far
  ahead if an allowance had been typed for one; a year that wasn't a
  whole number was turned down with "2,000" in its words; the "not
  done" list wrote a year as "2,026"; and an erasure test could fail by
  chance when a random id happened to hold one of the words it looked
  for, about one run in twenty.
- Checked: the typecheck; the shared tests (169); the server tests (371
  on PGlite, twice, and the real-Postgres file, 11); the web build; the
  full browser suite (74), and the history spec five more times.

- Merged into `main` at 10:45 UTC (Colly: "Finish off that PR") and
  live by 10:54 once main's checks passed. The live database has the
  leave module at version 2 with its `leave_years` table, and nothing
  went wrong. No year is open there yet: the live database is still
  empty, and the update opens years only on a server already in use, so
  made-up data and a restore start clean. When the real staff are in,
  an approver opens 2026 on the Leave screen with one tap.

**Next**

- The small items, being built: the office recording running late for
  someone who rang in, old running-late notes cleared after their day,
  the call-changed message naming a change to the certificates a call
  needs, and documents uploaded with expiry reminders.
- The stock list next week. On the live server, a list of 1,500 rows is
  expected to take about 8 to 10 minutes with the page left open.
- The keys, as before: the Google key, the backups bucket (and a
  `BACKUP_KEY`), and the Sentry key. Then the real crew list, after
  Start fresh, and opening 2027 for leave when the office is ready.

## 2 October 2026: the stock list, item logs, erasure, certificates and running late

**Done**

- Everything that could be built without waiting on the keys, in four
  streams built side by side, each read by a reviewer trying to break it
  and corrected, then brought together and checked as one.
- **Bringing in the stock list**
  ([Decision 0026](adr/0026-bringing-in-the-stock-list-and-item-logs.md)).
  Colly's list arrives next week and nobody here has seen it, so the
  reader doesn't depend on one layout. Columns are found by their names,
  and a column the reader doesn't know is asked about, never guessed at.
  Rows become products and numbered items or counted stock. A Session
  Hire number on the list is kept when it's free; any other tag is kept
  as the item's old number, and scanning it still finds the item. New
  numbers are never ones used before. Places and cases the list names
  are only made when the office ticks to make them. Every row is checked
  first, fixed in place or skipped, and nothing is saved until the
  office says so. Bringing the same file in twice changes nothing the
  second time. A long list goes in a part at a time, each part saved,
  so it never holds up the phones; choosing the file again carries on
  where it stopped. A made-up sample is in `docs/samples`, and the
  decision says how to shape the sheet.
- **A log on each item's page** (the same decision): out to a job and
  back, faults and repairs, missing and found, PAT tests, moves and
  changes, newest first, with who did it. What the phone knows shows
  with no signal, and the rest fills in from the server when there is
  signal. GPS trackers would add to the same log later. AirTags can't,
  because other apps can't read where they are.
- **Erasing a person on request**
  ([Decision 0027](adr/0027-erasing-a-person-on-request.md)). This is
  GDPR's right to erasure. It's done from an archived person's card, and
  refused while they have work still to come. Their details go from
  everywhere they're held: the card, every earlier copy in the change
  feed, the history's stored commands, the export, every device, and a
  staff member's sign-in. Someone with paid work in the last six years
  keeps their name and timesheets, because Revenue needs the records.
  Backups can't be edited and age out within a year; putting one back
  never brings an erased person back.
- **Certificates a job needs**
  ([Decision 0028](adr/0028-certificates-a-call-needs-and-running-late.md)).
  Safe Pass, working at height and IPAF join first aid, manual handling
  and the driving licence, and the crew list reads them. A crew call can
  say which it needs. An offer to someone without one, or whose card
  runs out before the job ends, is turned down, saying why; not known is
  allowed with a warning. A list on the Crew tab shows cards that have
  run out or run out in the next 30 days, each with a message ready
  asking for the new card.
- **Running late** (the same decision). On the day, a freelancer's link
  lets them say how late they'll be, with a note, and then that they're
  there. The office sees it at once on the Crew tab, on the call and on
  the planner; the contact on the day sees it on their call sheet.
- **The History tab** is grouped by day, and within a day by person,
  with a run of changes folded to one line that opens on a tap. While
  sign-in is off it groups by device and says why once, at the top.
  **The old sync test** is gone from the app, with its commands and its
  four empty tables. Its tests now run on real commands, and a phone on
  an older version is told plainly that something it held isn't done
  any more.
- The reviewers found and fixed, among others: a long stock list going
  in at once, holding every phone's sync for minutes and timing out; a
  sheet split by semicolons read as one column; a totals row becoming a
  product; a month-first date read the wrong way round; old tags not
  working for packing a case; erasing an old record switching off a live
  staff account with the same email; erasure damaging other people's
  stored history; an erased person staying a guest on future calendar
  events; an older version of the app unable to clear a certificate; and
  a card that ran out after a job was over still counted against it.
- Checked with all four together: the typecheck; the shared tests (161);
  the server tests (356 on PGlite, and the real-Postgres file, 9); the
  web build; the Blueprint build; the full browser suite (72), with the
  new specs run three more times; and screenshots of each new screen at
  phone and laptop widths, light and dark.
- Merged into `main` at 18:46 UTC once GitHub's checks passed, and live
  by 18:55: Railway waited for main's checks, then deployed it on its
  own. The live database has the core schema at version 5, with the old
  sync test's four empty tables gone; stock at 8, with an item's old
  number, its PAT due date and the new index; crew at 9, with what a
  call needs and the running-late table; and erasure's own module at 1.
  The new import route answers, the start-up log says where the list of
  erasures is kept while backups are off, and nothing went wrong. The
  Blueprint rebuilt itself from `main`.

- **Records kept for their recommended time, then let go** (Colly, 2
  October: "Keep all records for the recommended timeframes"; ADR 0027
  amended). Erasing someone now keeps their staff leave records (leave
  asked for, days in lieu and allowances) for three years, as the
  Organisation of Working Time Act asks, with their notes and the
  approver's reasons cleared. Pay records keep their six years for
  Revenue, as before. The name stays only while a kept record needs it.
  The server goes through what erasures kept once a day, after Irish
  midnight, and lets each record and name go on its day, so nobody has
  to remember; the "Erase the name now" button is gone. Erasing waits
  while someone's leave waits for a decision, so nothing is left that
  can never be decided. The decision has a table of how long each kind
  of record is kept, and why.
- Found and fixed in review: a staff member's older leave would have
  stayed until their newest leave's day rather than its own, and a
  restore could bring back a request still waiting for a decision that
  could no longer be made.
- Checked: the typecheck; the shared tests (168); the server tests (366
  on PGlite, and the real-Postgres file, 11, with two servers running
  the daily look at once); the web build; the full browser suite (73).

**Next**

- See 3 October.

## 2 October 2026: audit round three

**Done**

- The audit's P2 list, findings 16 to 27, in four streams built side by
  side, each read by a reviewer trying to break it and corrected, then
  brought together by hand. Under each finding the audit says how it was
  fixed, and anything left.
- **Screens that fit the device** (findings 16, 24, 25 and 26). The Crew
  tab groups the open calls by job and day, each call one line until
  it's tapped, with offers and forms behind buttons. People are found by
  name, department or skill, with or without fadas, in the offer picker
  and in the people list, which folds to its first ten. Stock and a
  job's page fold their long lists. On a laptop, from 960 px wide, Jobs
  and Stock show the list beside what's open. One status pill, one
  "Waiting to sync", one clock for the Irish day that turns at midnight
  (the clocks going back on 25 October included), one empty line, and
  the text styles throughout; and icons for adding the app to a phone's
  home screen.
- **Mistakes that can be taken back, and scanning finished** (17, 18 and
  19). Testing a batch holds each read for five seconds with Undo before
  it counts. Putting kit away works by camera, the camera stays open
  from one item to the next, a link opened inside WhatsApp or Gmail says
  to open it in Safari or Chrome, codes are only read inside the frame,
  and a camera that can zoom gets a slider. A product can be marked
  "added by mistake", which frees its name. Setting label numbers aside
  asks first, and a run with none of its labels used can be cancelled;
  its numbers are never given out again. A fault's details can be
  changed, and a place that doesn't exist is asked about before it's
  made.
- **The server hardened, and devices true to it** (20, 23 and 27). Files
  with their hash in their names are kept for a year; every answer
  carries the security headers, with HSTS over https; the CORS plugin is
  gone, since nothing on another site calls the app. A database
  connection dropping in the middle of a change no longer stops the
  server. A calendar sync that fails tries again after one, five and
  twenty-five minutes. Downloading everything writes nothing until the
  app records it. With `BACKUP_KEY` set, backups are encrypted. A device
  with changes waiting shows what the server will do with them, and
  every device lists things in the same order. New tests for the sync
  client, each view on its own, a deploy while the app is open, and
  every command and server action having its words in the history.
- **The freelancer's page and accessibility** (21 and 22). The office
  can set a reply-by day, suggested from the job's dates and never after
  them. A day the person is booked on another job is shown as such and
  never ticked for them. The calendar address has Copy and Subscribe.
  Staff are never shown or sent a rate. Past work and declined or
  withdrawn offers are listed apart, with dates. Nothing typed into the
  page's address ever appears on the page. Field borders show in
  daylight; focus and the tab's title follow every move; one main area;
  back links big enough to tap; the current tab and the grey pill
  readable; the "not done" count read out; a label on every field.
- The reviewers found and fixed, among others: a cancelled label run's
  numbers being given out again, so two labels could carry one number;
  a database connection dropping mid-change stopping the server; an
  offer made with no signal showing nothing on its call line; Enter in
  the picker's search sending the offer; a reply-by after the job being
  accepted; and staff being named a rate in messages.
- Checking the four together found one more. Moving the focus to a new
  screen's heading happens a frame after the move, and could take it
  from someone already typing in that screen's search, so their Enter
  went nowhere. A field someone is typing in now keeps the focus, and a
  test holds that frame back to prove it.
- Checked with all four streams together: the typecheck; the shared
  tests (110); the server tests (313 on PGlite, and the real-Postgres
  file); the web build; the full browser suite (63), with new specs for
  the layout, scanning, accessibility and a deploy while the app is
  open; and screenshots of every area at phone and laptop widths, light
  and dark.
- Merged into `main` at 10:07 UTC once GitHub's checks passed, and live
  by 10:14: Railway waited for main's checks, then deployed it on its
  own. The live database has the stock schema at version 7: a label run
  can be marked cancelled, a product as added by mistake, and a
  product's name need only be unique among those not marked. Every
  answer from the live server carries the security headers, hashed
  files are kept for a year, and another site's preflight gets a 404
  with no CORS header. The Blueprint rebuilt itself from `main`.

**Next**

- Finding 1 still waits on Colly's keys: the Google key for sign-in, the
  backups bucket (and now a `BACKUP_KEY` to encrypt them, made once with
  `openssl rand -hex 32`), and the Sentry key.
- Invoicing is parked for now (Colly, 1 October); its plan stays in the
  roadmap.
- The audit's P3 list is what's left of it.

## 1 October 2026: crew profiles and bringing in the list

**Done**

- The real crew list is a spreadsheet of 124 staff, freelancers and
  applicants, and the app's person now holds all of it
  ([Decision 0025](adr/0025-crew-profiles-and-bringing-in-the-list.md)):
  a department (free text, the known ones offered as you type), a level
  from 0 to 5 shown as "Level 3" (Colly's call: one number in place of
  preferred and onboarded, higher more preferred, 0 an applicant nobody
  has vetted), the name they go by (used in the greeting on their link
  and in every message the office is prompted with), first aid, manual
  handling and driving licence as held, not held or unknown with an
  expiry date, and the company a freelancer trades through with its VAT
  and CRO numbers. Each is optional on the command, so an older version
  of the app keeps what the server has.
- The person's card shows it all, with a warning when a certificate has
  run out, a Level select that moves them without opening the form
  ("Moved Dara Quinn to Level 3" in the history), and "Worked": the jobs
  they were booked on, built on each device from their bookings, newest
  first, with a count. Past events from the spreadsheet aren't brought
  in (Colly, 1 October): the list grows from here.
- The Crew tab's list says the department and level on each person and
  narrows to one department; the Offer to… picker sorts by department
  then level, highest first, and keeps applicants out until "Show
  applicants" is ticked.
- **Bring in a list**, from a card on the Account tab: choose the
  spreadsheet saved as a .csv, see every row as the app read it with the
  counts at the top, fix a phone, email or name in place (checked again
  by the same rules as you type) or skip the row, then bring them all in
  at once. Phones in every shape the file has go into international
  form; what can't be read is marked, never guessed. Rows match people
  already here by email, then phone, so the file can go in again after
  it's updated without doubling anyone; a matched person keeps the
  office's level, day rate and kind, gains the file's skills and notes
  once, and nothing in the app is erased by a blank cell, down to a
  certificate's expiry date and a VAT number. One bad row refuses the
  whole import, naming it, and nothing goes in.
- Two reviewers read the build (a data lens and an app lens) and the
  import was tightened before the real file goes near it: a row for
  someone archived is marked and never revives them; a row whose email
  is one person's and whose phone is another's, or a second row for one
  person, is marked rather than guessed at; a phone fixed in place is
  matched again on the device, and the server refuses a row whose match
  isn't what the preview showed rather than overwriting someone unseen;
  the fields on a row with a problem stay put as the problem clears
  instead of vanishing mid-word; a second import of the same file sends
  nothing for anyone it would leave as they are ("4 were already up to
  date"), so the history doesn't gain 124 lines each time; "Bring in"
  asks first, as the calendar import does; and the reader marks a UK
  number typed locally, a day rate it can't read and a name over 200
  characters, numbers rows by their line in the spreadsheet, and says
  when a file's letters didn't survive the save.
- The made-up people have departments and levels, a certificate in date
  and one run out, Dara trading through a VAT-registered company, and
  an applicant at Level 0.
- Checked: typecheck; 80 shared tests (14 new: the CSV reader on quotes,
  line breaks, Windows line endings, the byte-order mark and blank
  lines; the phone normaliser on every shape and the ones it must mark;
  a row read end to end; a row with problems fixed in place; matching
  with what the office must decide marked; the counts; Worked from a
  person's own first day); the server suite on PGlite (9 new: the
  preview's matching by email then phone with an archived person marked,
  bringing in with the union of skills, notes added once and cut to fit,
  the level and rate kept, a certificate's expiry and the VAT and CRO
  numbers kept, the same file again adding nobody and sending nothing, a
  bad row refusing the lot with nothing applied, a match the preview
  didn't show refused, the history and export lines, the level's own
  command and its plain refusals); the web build; the full browser suite
  with a new test (from the Account tab, a small made-up file with a
  company email, an unreadable phone and an applicant, the phone fixed in
  place a key at a time with the field staying put, the question before
  bringing them in, the Crew tab showing department and level, the
  applicant hidden from the picker until asked for, and the same file
  again adding nobody).
- Merged into `main` at 20:51 UTC once GitHub's checks passed, and live
  by 20:58: Railway waited for main's checks, then deployed it on its
  own. The live database has the crew schema at version 7 with the
  seven new columns on people, and the health check answers on the new
  build.

**Next**

- The afternoon of checking the real file in the preview: the phones the
  reader marks, the email with the typo, the four people with no way to
  reach them, and what the three blank departments should be. It goes
  in after Start fresh, and only once sign-in is on: until then the app
  is open to anyone with its address, and the file is personal data for
  124 people.
- Later items written into the ADR: Safe Pass, working at height and
  IPAF; an expired required certificate blocking an assignment; a text
  search in the picker that matches jobs worked; the stock list through
  the same step; removing an applicant who isn't taken on.

## 1 October 2026: the Blueprint's hero

**Done**

- The system map at the top of the Blueprint (the flight-case board,
  merged this morning) is replaced by a full-width hero above the
  sidebar and the content, as Colly asked: the business first, the
  systems second. One job goes through eight numbered chapters (enquire
  and quote, book and plan, crew it, prep the kit, deliver and run the
  show, return and repair, pay and invoice, and underneath it all, the
  cloud). Each chapter says who and where, its state in words, what the
  app does there, and names the parts of the app that do the work as a
  second layer, each with its build mark (built, in progress, planned,
  waiting on a key).
- A tag travels the baseline as one job, lighting each chapter as it
  arrives with a word on what just happened. Hover, tap or Enter pins a
  chapter and the footnote says what is left. Reduced motion gets a
  still frame. Laptop, tablet and phone each have their own layout, in
  light and dark, with nothing under 12px.
- Chosen from three concepts (a strip, an arc, and chapters) by three
  judges reading against Colly's critique, with the runners-up's best
  ideas grafted in; then read by a reviewer whose four must-fixes (a
  cramped top, ragged card bottoms, a half-empty title spread on
  tablets, and freelancer invoices over-claimed) and most suggestions
  went in.
- Checked at 1440, 1280, 1150, 1100, 1024, 768 and 390, light and dark,
  motion and reduced motion: no console errors, no horizontal scroll,
  the hero under 760px on a laptop.

**Next**

- The hero's facts (lines of code, tests, decisions) are typed into the
  page; the build script could fill them from the repo so they never
  drift.


## 1 October 2026: staff leave and time in lieu

**Done**

- Colly answered the three invoice questions: freelancers write their
  own invoices and email them to the office; some of them are
  VAT-registered; and an invoice can cover one job or several over a
  period, either way. So the app will tell each freelancer what to
  invoice and track what arrives, rather than make the invoice; the
  roadmap and the architecture say so now.
- Colly answered the open question from ADR 0009: calendar invites go
  out to crew when they're offered a job, and accepting the invite in
  Google Calendar is one acceptable way of agreeing to it. That is what
  was built, so the decision record now says so.
- The stray `@sh/web` service on Railway is gone: Colly committed the
  staged deletion on 1 October. Only `@sh/server` is left.
- The first part of the app that is for the staff rather than the jobs:
  annual leave and days in lieu, applied for and approved in the app.
  [Decision 0024](adr/0024-staff-leave.md) has the reasons, and Colly's
  calls: the calendar year, lieu in days, a flag for who approves until
  roles exist, and no sick or unpaid leave yet.
- A request is a span of whole days, counted in the weekdays that aren't
  Irish public holidays, which a new rule book works out for any year
  (checked against the published 2026 and 2027 dates). The form says the
  count before anything is sent; the server counts again.
- The **Leave** screen under Crew: my year as facts (allowance, carried
  over, taken, booked, waiting, left; and lieu earned, to be approved,
  taken, booked, waiting, left), last year and next year, Apply, Log a
  day in lieu, and my requests with Cancel. For anyone with "Can approve
  time off" on their person: the queue, oldest first, with what to weigh
  up (jobs they hold those days, other staff off or asking for the same
  days), Approve and Decline in place, and every staff member's
  allowance to set. The Crew tab's badge counts the waiting requests for
  an approver.
- Approved leave is days off under the request's own id: the planner
  shows it, offers warn, the clash is flagged if they're booked, and the
  person's own calendar feed carries it as an all-day event. Declining
  or cancelling takes it off again, and neither the office by hand nor
  the person from their private link can remove those days off. The
  planner marks public holidays as a faint band.
- Who "me" is: the signed-in account's email matched to a person on the
  Crew tab, and the server checks a request is the person's own and a
  decision is by an approver. While sign-in is off the screen asks "Who
  are you?" once and the device says who is deciding, so it works today
  and becomes honest by itself when the Google key goes in.
- The made-up data has allowances for the three staff, Aoife approving,
  Cian's week and day in lieu waiting, and Orla's week last month taken.
- Checked: typecheck; 66 shared tests (10 new: the holidays by rule, the
  count across a bank holiday, the balances with and without an
  allowance, overlaps, the device's view with its own changes and the
  planner's clash); the server suite on PGlite (8 new, each rule in turn
  with signed-in staff, the planner, offers, the feed and the private
  link after approval, nothing approved for someone archived, and the
  device saying who it is with sign-in off); the web build; the full
  browser suite with a new test (pick who you are, apply for three
  days, the approver's badge counts it at once, the approver approves,
  a blanked allowance is turned down in place, the planner shows the
  days off, an offer warns).
- Merged into `main` at 14:14 UTC once GitHub's checks passed, and live
  by 14:21: Railway waited for main's checks, then deployed it on its
  own. The three leave tables are in the live database at version 1,
  and the health check answers on the new build.

**Next**

- Later items written into the ADR: half days, working patterns, sick
  and unpaid leave, carrying days over by rule at the year end, lieu in
  hours, roles instead of the flag, and telling the person their request
  was decided through the Send panel.
- Colly: the Google key, the backups bucket and the Sentry key are still
  the first three items on the list; with the key in, leave checks who
  is asking by itself.

## 1 October 2026: audit round two

**Done**

- The P1 loops from [the audit](audit-2026-09-30.md), findings 7 to 15,
  decided in [ADR 0023](adr/0023-audit-round-two-the-loops.md). Five
  streams, each built in its own worktree, read by a separate reviewer,
  corrected, and merged by hand.
- People can be edited and archived (never deleted), and freelancers fix
  their own phone and email on their link. A crew call can be changed
  after it's made; a phase that moves asks whether its crew move too;
  nobody is ever un-booked silently. Booked means confirmed everywhere.
- The office is prompted to tell people after Confirm, Withdraw, a
  cancelled job, a changed call, a moved phase and an approved
  timesheet; the Crew tab counts answers to check, declines and
  pull-outs wait there until Noted; office details sit on every
  freelancer page; a booked freelancer can say "can't make it".
- The device rebuilds and saves only when something changed (at 31× the
  made-up data the rebuild went from 44 ms to 18 ms and the idle tick
  from 137 ms to 3 ms); storage fails safely, two tabs never fight, and
  a start-up that fails shows a card, never a white page.
- Every refusal is shown where it happened, the top bar counts what
  wasn't done with one list, every browser alert and confirm is gone,
  and prices read as typed ("€1,250").
- Round one went live on 1 October at 08:54 UTC (merged as 1b189c4; the
  live server answers 404 for a missing asset, which proves the build).
- Checked: typecheck; 56 shared tests; the server suite on PGlite and on
  real Postgres; the web build; the full browser suite (42 tests, two new
  ones for refusals). The reviewers' must-fixes went
  in before each merge: an empty contact change, a misleading notes
  placeholder, a reformatted import, screens not told when a round ended
  or the day turned, the link's inputs blocking "€300", the not-done
  list covering the top bar on a phone, spaces in a price, and forms
  wiping what was typed.

**Next**

- Round three alongside invoices (P2): grouped and collapsed screens, a
  person picker with search, batch-test undo, camera in the put-away
  flows, "added by mistake", server hardening, accessibility, the laptop
  layout, the home-screen icon.
- Left for later and written down: the right to erasure, "running late"
  on the day, a per-item log on the stock item page, GPS trackers.
- Colly: the Google key, the backups bucket and the Sentry key are still
  the first three items on the list.

## 1 October 2026: audit round one

**Done**

- The P0 fixes from [the audit](audit-2026-09-30.md), findings 2 to 6.
  Each finding there now says how it was fixed.
- One bad change can't strand a phone any more. A server error nobody
  expected drops that one change with a plain reason, logs and reports
  it, and lets the rest of the push through; a 500 never carries
  Postgres's words; a date that isn't real is turned away on the device
  in plain words; a change the device's own view can't show is turned
  away before it's saved, or set aside as a problem when the app opens
  on an old copy.
- A big backlog goes up in slices of 500, with a 30 s push timeout.
- A deploy no longer breaks the open app: a bar offers "A new version
  is ready. Reload", a missing file answers 404 rather than the page,
  a page whose file has gone starts itself again, and a change for a
  table this build doesn't know is kept for the build that will.
- On the freelancer's page, Enter in the rate field sends the rate
  (never accepts), and the message after an answer lands in the card,
  as an alert when it's a refusal.
- Checked: typecheck; the shared tests (22, with new ones for slices,
  the stale stop, bad dates, the view guard, the un-brick on open,
  unknown tables and the prototype guard); the server tests on PGlite
  and on real Postgres (new: a fault inside a handler, a year-0
  timestamp, a 500's answer, a 400's answer, the calendar sync getting
  the fault, Enter on the link page, the message in the card, a missing
  asset); the web build; the whole Playwright suite with a new
  freelancer-on-a-phone test. Each fix was reviewed by a separate
  reader before it was merged, and their two must-fixes (the year-0
  timestamp, and old Safari passing over a hidden button) went in.

**Next**

- Round two: the P1 loops (edit person, `call.update`, prompted
  messages, the Crew tab count, "Can't make it", one not-done
  indicator, the idle sync cost, storage, "booked", the money parser).
- Colly: the Google key and the backups bucket are still the first two
  items on the list.

## 30 September 2026: audit

**Done**

- A full audit of the app before freelancer invoices: reliability,
  security, every screen and the freelancer pages, the flows for each
  kind of person, bugs, and how it holds up as the data grows.
  [The audit](audit-2026-09-30.md) has every finding with its evidence,
  in priority order, and the order to fix them.
- The foundations checked out: sign-in, the command log and change feed,
  retries, backups, the export, escaping, the Google flows. Nothing lets
  an outsider in or leaks one person's details to another.
- What it found, in short: things that can be created but not corrected
  (a person's number, a crew call's time, a phase's crew when it moves);
  answers and changes nobody is told about; four ways a phone can be
  left stuck or blank (one bad change, a big backlog, a deploy, a full
  disk); two traps on the freelancer's page (Enter accepts the job at the
  offered rate; the message lands off-screen); and a data model rebuilt
  and re-saved in full every 30 seconds, which will slow down as the
  years' jobs accumulate. Timesheets, merged earlier, went live by
  themselves.
- Checked by hand: the bad-date 500, the missing-file answer after a
  deploy, the Enter-accepts trap, the off-screen message, and the timings
  (2.7 ms on the made-up data, 38 ms at 31×, 6 s at 51×).

**Next**

- Round one of the fixes (the P0 list), then round two, then invoices
  alongside round three.
- Colly: the Google key and the backups bucket are the first two items
  on the list.

## 30 September 2026: timesheets

**Done**

- The second part of Phase 3: freelancers send a timesheet for each
  booking, and the office checks and approves it.
  [Decision 0022](adr/0022-timesheets.md) has the reasons.
- Freelancers bill a day rate, so a timesheet is the **days worked** at
  the booking's agreed rate, plus **extras** such as parking, tolls or
  mileage, and a note. There's one for each confirmed booking, from its
  first day. Staff are paid through payroll, so they have none.
- A freelancer's private page lists their **Timesheets**: to send, sent,
  and approved lately. Each opens with their booked days ticked and rows
  for extras, sent with no app, and they can change it until the office
  approves it.
- The Crew tab has **Timesheets**: to approve, not in yet, and approved
  lately. **Check** opens one to change the days, rate or extras, with a
  note and a preview of what the freelancer will see changed, then
  **Approve** in one step. **Ask** sends someone a link straight to
  theirs. **Fill in** puts one in for someone who won't. An approved one
  is reopened to change it.
- Once approved, the freelancer sees the total, each line, and anything
  the office changed, in words: "Mileage: €20, not €25.50".
- The made-up data has the Autumn Gala's crew, which is over: Dara's
  timesheet waiting to be approved, Tadhg's approved without his
  dinner, and Laoise's not in yet.
- Checked: 5 new tests of totals, changes and which bookings have one,
  and of the office's list with changes waiting to sync. Also 4 new
  server tests: sent from a link and shown on the freelancer's page;
  only for their own confirmed booking, from its first day, on their
  booked days; approved with changes, settled, and reopened; and put in
  by the office. A new browser test runs from the office's check and
  approval to a freelancer's phone and back.
- Call sheets, merged earlier today, went live by themselves once main's
  checks passed.

**Next**

- Colly, to try it: put in the made-up data, then **Crew**, and
  **Check** under Timesheets.
- Is anything paid by the half day, or with overtime? For now the office
  changes the rate or adds an extra line.
- Next in Phase 3: ready-made freelancer invoices from the approved
  timesheets, with their payment status on the freelancer's page.

## 30 September 2026: call sheets

**Done**

- The first part of Phase 3 since crew booking: each phase of a job has a
  call sheet, worked out from what the app already holds.
  [Decision 0021](adr/0021-call-sheets.md) has the reasons.
- A phase on a job's page has **Call sheet**, with who crew ring on the
  day. The sheet has the phase's days, where (with the map and the
  venue's notes on access and parking), the running order from the
  phase's notes, and who's on for each crew call, by call time.
- The office picks the **contact on the day** for each phase, from
  anyone in the app. Their name and number go on everyone's sheet.
- The office's sheet shows everyone asked, with their numbers and
  whether they're booked, still to confirm or only offered, places still
  to find, the kit, and the client's contacts. It works with no signal,
  **prints** on one A4 page, and **copies for a crew's WhatsApp group**
  with no number but the contact's.
- **Send** beside each person who has said yes gives them a link to
  their own sheet by WhatsApp, text or email, and it's on their private
  page too, with no app. Theirs shows their call first, who to ring,
  where, the running order, and who else is on by name only. The contact
  on the day sees the crew's numbers and the kit on theirs.
- The made-up data has contacts on the day, running orders and a crew
  chief booked for the festival. Its phone numbers are from the range
  kept for TV and radio drama, which never ring anyone.
- Checked: 5 new tests of what each reader sees, 4 new server tests (the
  sheet on a private link for someone booked, the contact on the day
  with the crew's numbers and the kit, no sheet for a call only offered,
  someone else's or cancelled, and the contact kept to people in the
  app and in the history), and a new browser test (the office's sheet,
  the contact changed, copied for a group, printed, sent, and opened on
  the freelancer's phone). All 38 browser tests and all 244 server tests
  pass, on real Postgres too.

**Next**

- Colly, to try it: put in the made-up data, open Harbour Lights
  Festival, and **Call sheet** under Show.
- Next in Phase 3: timesheets from the bookings, then ready-made
  freelancer invoices.

## 30 September 2026: PAT tests and thorough examinations

**Done**

- The seventh part of Phase 2: electrical tests (PAT) and thorough
  examinations of lifting gear are recorded on each item, the app works
  out when each is next due, and kit that failed or is overdue can't go
  out. [Decision 0020](adr/0020-inspections.md) has the reasons.
- A numbered product's **Change details** has **PAT every, in months**
  and **Thorough examination every, in months** (blank for never). Its
  page says "Testing: PAT every 12 months", how many of its items can't
  go out, and flags each one.
- An item's page has an **Inspections** card: where it stands on each
  ("PAT due 30 Sept 2027", due soon, overdue, failed, or not recorded
  yet), **Record a test** (passed or failed, the day, who did it, a
  note), and every one recorded. A failed or overdue item says so at the
  top.
- **Test a batch**, from the Stock tab: pick PAT or thorough examination
  and who's testing, then scan or type each item that passes. Each scan
  says "SH-000123 d&b Y10P: passed, next due 30 Sept 2027.", and **It
  failed** records a fail for the one just scanned. Works with no
  signal.
- The Stock tab's new **Inspections due** card lists what can't go out,
  what's due in the next 30 days, and how many aren't recorded yet.
- Failed or overdue kit isn't counted as owned, so a job's kit says
  "2 owned and fit to go out (1 damaged, missing or due a test)"; the
  pick list leaves it out of where to find kit, and warns when it's
  scanned out: "PAT failed on 30 Sept 2026. Test it before it goes."
- Every record is kept for good, is in the History tab and the export
  (new table `inspections`), and is turned down only for an item never
  saved or retired.
- Checked: 4 new server tests (the next due day, month ends included;
  records kept, sent twice, and turned down; the history; due, soon,
  overdue, failed and not recorded, what can't go out, a job short, and
  a retest with no signal) and a new browser test at phone size (the
  interval set, a test on paper recorded and overdue, the Stock tab's
  list, a batch tested with one fail and one with no signal, the failed
  item's page, the job short, and the scan out warned). All 37 browser
  tests and all 240 server tests pass, with the made-up data work merged in.
- Merged into `main` at 14:30 UTC once GitHub's checks passed, and live
  by 14:40: Railway deployed it on its own.

## 30 September 2026: made-up data to try the app with, and starting fresh

**Done**

- The real stock list, crew lists and calendars won't be in until next
  week, so the app can now be tried in full with made-up data, and cleared
  before the real data goes in.
  [Decision 0019](adr/0019-made-up-data-and-starting-fresh.md) has the
  reasons.
- On the Account tab, **Put in made-up data** fills an empty app with a
  few weeks of made-up jobs, crew and stock: speakers short between two
  jobs, a quote that would leave the moving heads short, an LED wall
  hired in, crew booked, offered, countered and declined, a freelancer
  on two jobs at once, labelled items and amps in racks, a roll of label
  numbers, pick lists for the jobs going out, and a job that's over with
  two speakers not back and one on the repair list. Every name is
  invented and nobody can be
  emailed or texted. The jobs are always in the coming weeks.
- While it's in, every screen says **made-up data** beside its name, on
  every phone.
- **Start fresh**, on the same card, deletes everything but the staff
  accounts, once "delete everything" is typed: made-up data and anything
  tried on top of it, the history too, and label numbers start again
  from SH-000001. It makes a backup first where backups are on, and waits
  for Google Calendar to be disconnected. One entry is left in the
  history, saying who did it.
- Every phone empties its copy by itself, and drops what it had waiting
  rather than sending it again, so nothing made up comes back, even from
  a phone that was out of signal.
- Checked: 10 new server tests (the made-up data through the server's own
  rules, with what each tab shows; only into an empty app; the typed
  words; everything deleted but the staff accounts, with one history
  entry; phones emptied and a phone's waiting changes dropped; a backup
  first, and nothing deleted if it fails; neither while Google Calendar
  is connected), one on real Postgres with twenty phones sending while
  the office starts fresh, and a new browser test (made-up data in,
  marked on every tab, then deleted with the words typed while another
  phone empties by itself). All 36 browser tests and all 236 server
  tests pass, on real Postgres too.
- Merged into `main` at 14:16 UTC once GitHub's checks passed, and live
  by 14:22: Railway deployed it on its own. The live app is empty, so
  made-up data can go straight in.

**Next**

- Colly, to try it: on the Account tab, tap **Put in made-up data**, then
  look round Jobs, Crew and Stock.
- When the real data is ready next week: Account tab, open **Start
  fresh**, type "delete everything" and tap **Delete everything**.

## 30 September 2026: faults, missing kit and repairs

**Done**

- The sixth part of Phase 2: kit that comes back damaged, or doesn't come
  back, is reported, repaired or written off, and it's taken off what's
  free for jobs until then.
  [Decision 0018](adr/0018-faults-missing-kit-and-repairs.md) has the
  reasons.
- **Coming back** on a job's pick list: after an item is scanned back,
  **Report damage to SH-…** takes what's wrong and whether it can still
  go out. Each item still out has **Missing** beside **Back**, and
  counted kit has **Missing** in its count and **Report damage to
  counted …**. The page says "18 back, 1 still out, 4 missing".
- Kit reported missing isn't out with the job any more, nor back. A
  missing item that's scanned anywhere is marked found at once, and the
  answer says so.
- An item's page, and a counted product's page, have **Report damage**
  and **Report missing** at any time, and list their faults. The item's
  page says its fault at the top.
- The Stock tab's new **Faults and repairs** card is the repair list:
  every open fault, each with **Repair notes** and how it ends (**Fixed**,
  **Not faulty**, **Found**, or **Write off**). Writing off retires an
  item (scrapped, or lost) or takes counted kit off the count, biggest
  count first. Nothing is deleted.
- Kit missing, or damaged and not fit to use, isn't counted as owned, so
  a job's kit says "Short 1: 2 owned and fit to go out (1 damaged or
  missing)". The pick list leaves it out of where to find kit, and warns
  if it's scanned out anyway. A missing case takes what's in it along.
- Every report works with no signal, is kept whatever the plan says, and
  is in the History tab and the export (new table `faults`).
- Checked: 6 new server tests (reports kept once each whatever the
  plan, turned down only for what was never saved or an item already
  retired, updated and closed once in a way that fits, writing off an
  item and counted kit, kit that can't go out taken off availability and
  the pick list, and kit missing from a job neither out nor back until
  found) and a new browser test at phone size (damage, missing items and
  counted kit reported with no signal, a missing speaker scanned and
  found, the job short, the Stock tab's repair list, a repair note and
  Fixed, and missing cables written off the count). All 35 browser tests
  and all 225 server tests pass.
- Merged into `main` at 13:50 UTC once GitHub's checks passed, and live
  by 13:56: Railway deployed it on its own.

## 30 September 2026: pick lists, and scanning kit out and back in

**Done**

- The fifth part of Phase 2: each job has a pick list, and kit is scanned
  out to the job and back in on a phone, with no signal too.
  [Decision 0017](adr/0017-pick-lists-and-scanning-out-and-in.md) has the
  reasons.
- A job's **Kit** card has **Pick list**, with how much is out. The pick
  list has a row for each product on the kit: how many the job needs from
  Session Hire's own (subhired ones left out), how many are out, and
  where to find the rest, place by place with the item numbers there and
  what's counted.
- **Going out**, each label scanned with the camera, or typed by a
  scanner, is recorded as out with the job, and the answer comes at once:
  "SH-000123 d&b Y10P: 3 of 8 out". Counted kit, like cables, is counted
  out on its row. Scanning a case takes everything in it.
- A scan is never refused. When it doesn't match the plan, it says so and
  keeps it: not on the kit, more than the job needs, still out with
  another job, or retired. **Not going** on an item takes it off again.
- **Coming back**, the same page records each scan as back in, and says
  what's still out. An item that went out with another job comes back
  from that one, and says so.
- An item's page says which job it's out with and since when. The Stock
  tab lists jobs going out in the next two weeks or on now, with how much
  is out, and jobs over with kit still out.
- Every phone works out what's out from the scans in the order they
  happened, not the order they synced, so they all agree once they
  catch up. Every scan is in the History tab and the export.
- Checked: 6 new server tests (scans kept whatever the plan says and
  once each, turned down only for a job or item never saved, the history
  in words, a pick list with a case and counted kit out and back, scans
  put in the order they happened across two phones, and the Stock tab's
  lists) and a new browser test on a phone with a stand-in camera (kit
  found, scanned and counted out, a scan read once, a mic not on the kit
  warned about and taken off, the item's page and the Stock tab, then
  everything back with no signal and synced after). All 34 browser tests
  and all 219 server tests pass.
- Merged into `main` at 13:19 UTC once GitHub's checks passed, and live
  by 13:24: Railway deployed it on its own.

**Next**

- Colly, to try it: add kit to a job, open **Pick list** from its Kit
  card, and scan a labelled item with **Scan**.
- Next in Phase 2: missing and damaged items on return, with faults and
  repairs, and the Stock tab's list becoming the place scans that didn't
  match get sorted out.
## 30 September 2026: deploys unstuck

**Done**

- Kit on jobs and printing labels were merged at 07:48 UTC but didn't go
  live on their own. GitHub ran none of its checks from 06:10 to about
  12:00 UTC: each run stopped within seconds without starting, the usual
  sign that the account's GitHub Actions minutes or spending limit had run
  out (this repo is private, so its runs count against them). They've run
  again since. Railway waits for those checks before deploying, so it
  skipped the deploy. The checks were run here on the merged code instead,
  all passing (all 218 unit and sync tests, on PGlite and a real Postgres,
  and all 31 browser tests), and it was deployed from Railway by hand at
  11:32 UTC; the entries for kit and labels say when it was live.
- Why Railway skipped merges (the question from 29 September): the app
  server only deployed when something under `server/` changed, so merges
  of only the docs, the web app or the shared code were skipped. It now
  also deploys on changes to `web/`, `shared/` and the files at the top of
  the repo that the build uses. That's set on the Railway service and in
  `railway.json`, so it's kept with the code. It worked on the next merge:
  scanning with the camera, which changed only the web app and the docs,
  went live by itself at 12:38 once its checks had passed, while a merge
  of only the docs is still skipped, as it should be.
- The checks run once for each change rather than twice: on pull requests
  and on `main`, not also on every push to a branch with a pull request
  open. That halves the minutes they use.
- The second service in the Railway project, `@sh/web`, was made by
  Railway from the repo's layout. It runs a development copy of the web
  app with no address, so nobody uses it, and it doesn't touch the
  database. It can be deleted.

**Next**

- If GitHub stops running the checks again, Railway will skip each merge
  until they do; **Deploy Latest Commit** on `@sh/server` (or asking
  Claude, who now has access to Railway) puts it live meanwhile.
- Colly, if you agree: delete `@sh/web` in Railway, so it stops using the
  project's resources.

## 30 September 2026: scanning with the camera

**Done**

- The fourth part of Phase 2: phones read labels with their camera, in
  the app. [Decision 0016](adr/0016-camera-scanning.md) has the reasons.
- In **Stock**, **Scan** beside the search turns the camera on: point it
  at a label and its item opens. A maker's serial in a barcode finds its
  item too, on Android.
- A label that isn't on anything yet asks which product it's on, with the
  camera still on and made small so the form fits under it. The product
  and place stay, so labelling a shelf is a scan and a tap each.
- The camera stays on until **Stop camera**, reading one label after
  another. A label held still is read once. Each read flashes the frame,
  shows the number, beeps (**Sound** turns that off) and buzzes on
  Android. **Light** turns on the torch where the phone allows it.
- It works with no signal: the reading happens on the phone, and the
  pictures never leave it and aren't kept. The camera turns off when the
  app is out of sight, and says what to do if it's blocked or missing.
- Checked: 2 new browser tests on a phone with a stand-in camera that
  shows the app a label's QR code (an item opened, a maker's serial, two
  labels put on items one after another with the camera on, a label held
  still read once, the camera turned off on leaving; a blocked camera and
  Try again), and the real camera path once with Chromium's test camera.
  All 33 browser tests and all 213 server tests pass.
- Merged into `main` at 12:32 UTC, once GitHub's checks passed (they're
  running again), and live by 12:38: Railway deployed it on its own. The
  first run on GitHub found two browser tests getting in each other's way
  on a shared test server, so the tests now run one at a time.

**Next**

- Colly, to try it: on a phone, open **Stock**, tap **Scan** and allow the
  camera, then point it at a label printed from **Print labels**. It's
  worth trying on an iPhone and an Android phone in the phone field test.
- Next in Phase 2: pick lists for each job, then scanning out and in with
  the same camera (done: see the entry above).

## 30 September 2026: printing labels

**Done**

- The third part of Phase 2: labels, so the warehouse can start sticking
  numbers on gear. [Decision 0015](adr/0015-printing-labels.md) has the
  reasons. There was still no word on a stock list to bring in, so this
  came next, as planned.
- **Stock**, **Print labels** sets numbers aside before their labels are
  printed: say how many (up to 10,000 at a time) and what they're for,
  such as a roll from a label maker. The next free number skips them, so
  no item in the office gets a number that's waiting on a printed label.
  Numbers set aside with no signal come once it's back.
- Each run can be **printed here**, from the browser: on a label printer,
  one to a page at 50 × 25 mm or 25 × 25 mm, or on A4 sheets of 65
  labels in an office printer, up to 500 at a time from any number in the
  run. Or **Download the spreadsheet** for a label maker, a row a label,
  which a label printer's own software can print from too.
- A label has a QR code, the number in large type and "Session Hire". The
  QR code holds just the number, so it never goes out of date and it's the
  smallest code there is, readable with up to 30% scuffed off.
- **Claim on scan:** scan or type a label that isn't on anything yet in
  the Stock search, and it asks which product it's on and where that's
  kept, then adds the item with that number, one of those counted there if
  some are. The product and place stay for the next label, so each one
  after the first is a scan and Enter.
- An item's page has **Print label**, with the product's name on it, for
  a new item or a replacement. Each run shows how many of its labels are
  on items so far.
- The History tab describes numbers set aside ("Set aside SH-000101 to
  SH-000600 for printing labels (Label World roll)"), and backups and
  **Download everything** include the new table.
- Checked: 5 new tests of what's printed (every QR code read back by a
  decoder, from the first number to the last), 5 new server tests (the
  next free number skipping runs, claiming labels, the last six-digit
  number, two devices setting numbers aside with no signal, and the
  history), all 213 server tests, and 2 new browser tests on a phone (set
  aside, printed in each layout with the printed page sizes checked,
  downloaded, claimed by scanning, an item's own label; set aside with no
  signal), with all 31 browser tests passing.
- Merged into `main` at 07:48 UTC, together with kit on jobs, and live by
  11:33 once Railway was asked to deploy it (it hadn't picked the merge up
  on its own): the live app has the Labels screen, claim on scan and
  **Print label**, and the live server adds the new table before it
  starts.

**Next**

- Decided by Colly on 30 September: the QR code holds just the number,
  not a web address, so rolls can be ordered as built.
- Colly, to try it: in **Stock**, **Print labels**, set aside a few
  numbers, print them on A4 or download the spreadsheet, then type one in
  the Stock search and put it on a made-up product.
- Next in Phase 2: scanning with the phone's camera in the app, then pick
  lists and scanning out and in.

## 30 September 2026: kit on jobs, with shortages

**Done**

- The second part of Phase 2: each job says what kit it needs, and the
  app says whether there's enough.
  [Decision 0014](adr/0014-kit-on-jobs.md) has the reasons. There was no
  word yet on a stock list to bring in, so this came next, as planned.
- A job's page has a **Kit** card: products from the stock list and how
  many, for the whole job or one phase, grouped by department. A line
  for the whole job covers every day from its first phase to its last,
  the days between included. Adding a product already on the job for the
  same days adds to that line.
- Each line says whether there's enough on its days once the other
  confirmed jobs have theirs: "Short 2 on Wed 4 Sep: 10 owned, 8 on
  Electric Picnic", in red. Enquiries and quotes are pencilled in: they're
  checked as if they went ahead ("Would be short 2 on Fri 6 Sep if it goes
  ahead"), and a confirmed job whose spare kit they'd use says "Enough,
  unless Longitude goes ahead", in amber. Cancelled and lost jobs hold
  nothing. Only days from today on are checked.
- Being short never stops a line being saved: the count may be
  unfinished, or someone is about to subhire. A short line has
  **Subhire the 2 short**, which fills in how many and asks who from,
  suggesting suppliers already used. Subhired ones don't come out of
  Session Hire's own stock.
- The jobs list flags **Kit short**, the Stock tab lists every line short
  from today on, and a product's page lists the jobs it's on, with
  whether there's enough for each. A product on a job's kit can't be
  taken out of the stock list, and a phase with kit on it can't be
  removed.
- It's worked out on each device from what it already has, so it works
  with no signal: kit added offline counts at once and goes through once
  the signal is back.
- The History tab describes kit changes ("Added 8 × d&b Y10P to the kit
  for Nissan, whole job"), and backups and **Download everything**
  include the new table.
- Until the warehouse has counted everything, lines will show short that
  aren't; a product with nothing counted yet says so.
- Checked: 7 new server tests (the rules; the history lines; and what a
  device shows: a shortage in the gap between a job's phases, sorted by
  subhire, a quote pencilled in, cancelled jobs, days gone by, jobs with
  no dates, and kit added with no signal), all 208 server tests, and 2
  new browser tests on a phone (short, subhired, a quote pencilled in,
  the Stock tab and a product's page; kit added with no signal), with all
  29 browser tests passing.
- Merged into `main` at 07:48 UTC, together with printing labels, and live
  by 11:33: the live app has the Kit card, **Subhire the 2 short** and
  **Kit short**, and the live database has the new table.

**Next**

- Colly, to try it: in **Stock**, count a few of a made-up product; in
  **Jobs**, put more of it on two made-up jobs on the same day than are
  counted, see both say they're short, then subhire the rest on one.
- Still open: is there a stock list or spreadsheet to bring in? If so,
  bringing it in comes next. If not, label printing, then pick lists and
  scanning out and in.

## 30 September 2026: the warehouse catalogue

**Done**

- Phase 2 has started, with what the rest of the warehouse builds on:
  what Session Hire owns, how many of each, and where it's kept.
  [Decision 0013](adr/0013-warehouse-catalogue.md) has the reasons.
- The **Stock** tab is now the catalogue: products by department, and a
  search that finds a product, an item's number or a serial. A scanner
  that types a label's number and Enter opens the item.
- A product is **numbered** (each one gets its own label, `SH-` and six
  digits) or **counted** (cables, clamps, adaptors). A numbered product
  can be counted until it's labelled: 6 × d&b Y10P counted at Bay A3 are
  6 not labelled yet, and adding an item there takes one off the count,
  so the total is right from the first day and labelling can take weeks.
- An item gets the next free number, or the one on a label already stuck
  on, typed as `SH-000123`, `sh 123` or `123`. A number is used only
  once: a new label for a worn one keeps the old number with the item,
  and search still finds it by the old one. Retiring an item (sold,
  scrapped, lost or stolen) keeps it and its number, and it can be
  brought back.
- Places are added by typing a new name wherever one is asked for.
  Cases (road cases, racks, bags, cable bundles) hold items and counted
  stock, up to five deep; moving a case moves what's in it, and nothing
  can go inside itself. Each product, item, case and place has its own
  page, with its own address to share.
- The server keeps the rules whichever device a change comes from, and
  it all works with no signal: an item added offline says "Number when
  synced" until it gets one.
- The History tab describes every stock change ("Put a new label on d&b
  Y10P: SH-000202, replacing SH-000201"), and backups and **Download
  everything** include the five new tables.
- The Phase 0 sync test moved to the bottom of the Stock tab, behind
  **Open the sync test**.
- Checked: 13 new server tests (numbers given, typed and never reused;
  counts and moves; cases and their limits; the product and place rules;
  labelling with no signal on a device; the history lines; a backup of
  600 items in cases put back), all 201 server tests, and 2 new browser
  tests on a phone (count, label, find by number, fill a case, the place,
  a new label, retire and bring back; labelling with no signal), with all
  27 browser tests passing.
- Merged into `main` at 05:57 UTC and live by 06:04: the live app has the
  new Stock pages, and the live server adds the five new tables before it
  starts, so the live database has them too.

**Next**

- Colly, to try it: in **Stock**, add a made-up product, count a few at
  a made-up place, then add items one after another on its page, leaving
  the number empty for the next free one.
- Waiting on Colly: is there a stock list or spreadsheet to bring in? If
  so, bringing it in comes next. If not, equipment lines on jobs, with
  shortages flagged.

## 30 September 2026: everyone's own bookings in their own calendar

**Done**

- Everyone has a calendar feed of the jobs they're booked on, for Google,
  Apple or Outlook Calendar, at an address of its own that can only show
  bookings. It used to be the private link with `/calendar.ics` on the
  end, so anyone who could see a shared calendar's settings could answer
  offers as that person; now it's safe in a calendar they share.
  [Decision 0012](adr/0012-personal-calendar-feeds.md) has the reasons.
  This is the last part of Phase 1, so everything on the Phase 1 list is
  now built.
- The address is worked out from the private link, so nothing new is
  stored, backed up or downloaded, and **New link** retires the feed with
  the link. The events no longer carry the link to the person's page;
  they say the details and changes are on it.
- Where people find it: freelancers on their page, under Your bookings
  (subscribe on an iPhone, Mac or in Outlook, or add the address in
  Google Calendar); the office with **Copy calendar address** beside Copy
  link in the Crew tab, to send on; and staff who also work jobs, with
  the same email address in Crew, on the Account tab. Each says that
  anyone getting our Google Calendar invites doesn't need it as well.
- The server keeps every feed in memory and builds them again only after
  something changes, or every 6 hours, so calendar apps looking every
  hour don't keep the database awake. A feed that hasn't changed answers
  "nothing new" without being sent again. The old address still works
  for anyone already subscribed.
- The server's log now writes each request as its method and path only,
  with private link and feed codes masked and no query string. Before,
  it wrote whole addresses, private links and Google sign-in codes
  included.
- Checked: 8 new server tests (the read-only address and what's in it;
  answered from memory without touching the database, and rebuilt after
  an answer on a link, a change from the office and a withdrawn job;
  "nothing new" still true after someone else's booking; New link
  retiring both addresses; the 6-hour rebuild; the log), all 188 server
  tests, and 2 new browser tests (on a phone: the office copies a
  freelancer's calendar address and their page gives the same one; a
  signed-in staff member finds theirs on the Account tab), with all 25
  browser tests passing.
- Merged into `main` at 04:52 UTC and live by 04:58: the live app has the
  new buttons, and the live server answers a feed address that doesn't
  exist with "Not found", marked private and not for search engines,
  without asking the database.

**Next**

- Colly, to try it: in the Crew tab, open a made-up person with a
  booking, tap **Copy calendar address**, and add it to your phone's
  calendar or to Google Calendar (From URL). Once sign-in is on, your own
  shows on the Account tab if you're in Crew with your sessionhire.com
  address.
- Phase 1 is built. What's left is the office using it for real, which
  needs the Google key ([the steps](sign-in-setup.md)): jobs onto the test
  calendar, bringing in the organisers' calendars, then Session Hire Gigs.
- Colly, still open: should crew invites go out when crew are offered (as
  built) or only once they're booked?
- Colly, still waiting: the Sentry key ([the steps](monitoring.md)), the
  Railway bucket for backups ([the steps](backups.md)), the Google key
  ([the steps](sign-in-setup.md)) and the phone field test
  ([the steps](field-test.md)).

## 30 September 2026: bringing in the jobs already on Google Calendar

**Done**

- The jobs already on the organisers' Google calendars can now be brought
  into the app, so nobody types them again. **Bring them in**, on the Jobs
  tab (and on the Account tab once a calendar is connected), lists the
  calendars the connected account can see; pick one and a first day (by
  default three months back) and tap **Look at the calendar**.
  [Decision 0011](adr/0011-calendar-import.md) has the reasons.
- Nothing is saved until the office has looked. The app reads the
  calendar's all-day events from that day to two years ahead and shows
  each job it found: its phases and days, its venue (new, or already in
  the app), its crew (booked, not answered, said no, not in the app yet),
  and whether it's confirmed or pencilled in. Any job can be unticked or
  renamed, and giving two the same name brings them in as one. People on
  the invites who aren't in the app yet are listed, ticked when the
  address looks like a person's own and unticked for suppliers and
  clients. What was left out (meetings, repeating events, out of office)
  is listed with why.
- Titles are read the way they're typed today: "Tik Tok - Ploughing - Load
  In 2/3" is the job "Tik Tok - Ploughing" and its Load in, "Show Day 2/
  Load Out" is a day of both, and "Dublin Horse Show" stays whole. A title
  with no phase comes in as a Show, and says so. A job whose titles all say
  TBC, hold or pencil, or end in a question mark, comes in pencilled in.
- **Bring in** reads the calendar again and saves the ticked jobs in one
  go: the jobs and their phases, new venues and people, and a crew call
  per phase, with a guest who said Yes booked, one who hasn't answered
  offered, and a No kept as declined. The job sheet in an event's
  description goes into the notes. The History tab says who brought in
  what, and Download everything lists each event-day and the job it went
  into.
- Looking again, or at the other organiser's calendar, shows only what's
  new, adds new days to jobs brought in before, and lists events deleted
  or moved in Google since, to change the job to match. Days a job typed
  into the app already has are left out.
- Nothing is written to Google and nobody is emailed. The organiser's
  calendar keeps these jobs' events, so the app doesn't add them to the
  jobs calendar as well, and the job page says where their days are.
  Everything else works as for any other job: the planner, crew, private
  links and the history.
- Checked: 22 new server tests against the pretend Google (titles, job
  sheets and names; grouping into jobs and phases, venues, people and
  crew; looking saves nothing; bringing in, and the history and download;
  looking again; a calendar shared with the account; what goes wrong; a
  job gone from the calendar before it was brought in), the real-Postgres
  test now brings jobs in too, all 180 server tests, and 2 new browser
  tests (on a phone: look, untick, rename and bring in; on a laptop: a
  calendar that can't be read), with all 23 browser tests passing.
- Merged into `main` at 04:06 UTC and live by 04:13: the live app has the
  import screen, and the live server answers its address saying it needs
  the Google key first, as it should until the key is added.

**Next**

- Colly: once the Google key is in and a calendar connected, bring in the
  jobs on your test calendar, then the organisers' calendars
  ([the steps](sign-in-setup.md), step 6), and say what it got wrong.
- Next in Phase 1: personal calendar feeds, the last part of Phase 1.
- Colly, still open: should crew invites go out when crew are offered (as
  built) or only once they're booked?
- Colly, still waiting: the Sentry key ([the steps](monitoring.md)), the
  Railway bucket for backups ([the steps](backups.md)), the Google key
  ([the steps](sign-in-setup.md)) and the phone field test
  ([the steps](field-test.md)).

## 30 September 2026: the week and month planner

**Done**

- The Jobs tab has **List · Week · Month** at the top. Week and Month lay
  out every job with anything on, a row each, and each day says which
  phase it is, as the calendar titles it ("Build 1/2"), and how many of its
  crew are booked ("2 of 3 crew, 1 asked"). Confirmed jobs are solid, and
  enquiries and quotes dashed, as pencilled in. A day is green once its
  crew are all booked and amber while some are still to find. Crew asked
  for on the Crew tab, outside a job, get a row of their own.
  [Decision 0010](adr/0010-planner.md) has the reasons.
- **People** shows the same days by person: where each is booked, where
  they've been offered work and haven't answered, and the days they can't
  work. Everyone else can be shown too, to see who is free.
- Clashes are listed above the planner, in words, with the job to open.
  Someone booked on a day they're marked unavailable, or booked twice, is a
  **clash**. An offer still waiting on an answer for a day they're booked
  or unavailable is a **check**: it would be a clash if they said yes. The
  server already stops most clashes, so these are the ones a day off marked
  after the booking, or an offer sent anyway, can still make.
- A phase moved to other days without its crew shows their old days in
  amber, "No phase this day", so it's seen before the day comes.
- A week reads in words and, on a phone, scrolls sideways from today with
  the names kept in view. A month shows each day as a short code ("Bu" for
  Build, "WS" for Web Summit) and a colour, with the words on hover and for
  screen readers, and a tap on a date opens its week. It's the one screen
  that uses a laptop's full width. The address keeps the week or month and
  the view, so a reload or a shared link lands in the same place.
- It's worked out on each device from what it already holds, so it works
  with no signal and shows a change as soon as it syncs. Nothing changed on
  the server. For now it only shows: changes are made on the job's page or
  the Crew tab, a tap away.
- Checked: 6 new server tests (phase-days and crew counts; pencilled-in and
  cancelled jobs; crew outside Jobs; a phase moved without its crew;
  booked, offered and unavailable by person; clashes and checks, and their
  order; weeks and months across a new year and a leap year), all 157
  server tests, and 2 new browser tests of a week on a phone and a month
  on a laptop, with all 21 browser tests passing.
- Merged into `main` at 02:55 UTC and live by 03:00: the live app's Jobs
  tab has List, Week and Month.

**Next**

- Colly: once there are real jobs in, open the week and month and say what
  the office would change, such as dragging a phase to other days.
- Next in Phase 1: bringing the jobs already on Google Calendar into the
  app as drafts.
- Colly, still open: should crew invites go out when crew are offered (as
  built) or only once they're booked?
- Colly, still waiting: the Sentry key ([the steps](monitoring.md)), the
  Railway bucket for backups ([the steps](backups.md)), the Google key
  ([the steps](sign-in-setup.md)) and the phone field test
  ([the steps](field-test.md)).

## 30 September 2026: crew invites on the calendar, and their answers

**Done**

- Crew can now be invited to the days they're offered on Google Calendar,
  as ops do by hand today, and their Yes or No there counts as their answer
  to the offer, as if they'd answered on their private link. It sits behind
  a switch on the **Account** tab that starts off, since each invite is an
  email to a freelancer. [Decision 0009](adr/0009-crew-invites.md) has the
  reasons.
- With it on, everyone offered a place on a confirmed job, or booked on it,
  who has an email address in the app, is a guest on the job's events on
  their days, from today on. Invites come from the account connected on
  the Account tab. Crew can't see each other's addresses, or invite anyone.
- An answer in Google works as it does on the link: a Yes to any day is a
  yes to the offer, for all its days bar any they said No to; a No to every
  day declines; Maybe waits. The first to say yes gets the place, and the
  rest of the shortlist come off the events, with a cancellation from
  Google. Each answer is in the History tab as the freelancer's own, "on
  Google Calendar", and in Download everything.
- Once the office has confirmed someone, Google can't undo it: a No to a
  booked day shows on the job page and under **Answers to check** on the
  Crew tab, for the office to phone them.
- Google emails guests only when it matters: being invited or taken off,
  and a new title, date or place. The crew list and notes change quietly.
  Guests added by hand in Google, such as a client, stay on, and an answer
  given while the app is changing an event is never lost.
- Answers arrive within a couple of minutes: the server asks Google every
  two minutes which of the app's events have changed, and touches the
  database only when an answer has, so it still sleeps when nobody is
  working. The nightly check takes in anything missed.
- The job page shows, under each person offered, how they stand on Google
  Calendar ("Said yes on Google Calendar.", "Invited on Google Calendar; no
  answer yet."), and says when someone has no email address, so gets no
  invite.
- Turning it on first says what goes out ("6 invites to 3 people") and who
  has no email address. Turning it off stops everything at once; people
  already invited keep their invites. Disconnecting the calendar turns it
  off and tells invited crew their days are cancelled.
- Checked: 15 new server tests against the pretend Google (who is invited
  and who isn't; a Yes, a partial Yes, a Maybe, a No to every day, a No
  from someone booked; looking for answers without waking the database,
  and by itself every couple of minutes; guests added by hand kept, and
  emails only when they matter; an answer given while the app is writing;
  an email address changed; switched off; the nightly check; disconnecting;
  two servers taking each answer once), the real-Postgres test now takes an
  answer in too, all 151 server tests, and a new browser test for the switch
  and the job page.
- Merged into `main` at 02:08 UTC and live by 02:13: the live server
  answers the new crew invites address, and says it needs the Google key
  first, as it should until the key is added.

**Next**

- Colly: once the Google key is in and the test calendar connected, try
  crew invites on it with the office's own addresses as the crew, to see
  the emails as a freelancer would ([the steps](sign-in-setup.md), step 5).
  It stays off on Session Hire Gigs until you choose.
- Colly, still open: should invites go out when crew are offered (as
  built, like today) or only once they're booked?
- Next in Phase 1: the week and month planner.
- Colly, still waiting: the Sentry key ([the steps](monitoring.md)), the
  Railway bucket for backups ([the steps](backups.md)), the Google key
  ([the steps](sign-in-setup.md)) and the phone field test
  ([the steps](field-test.md)).

## 30 September 2026: confirmed jobs onto Google Calendar

**Done**

- The app now puts every day of every confirmed job, from today on, on a
  Google calendar, in the shape crew know: one all-day event per phase per
  day, titled "Nissan - Build 1/2", with the venue and its address as the
  location. The description has the client, the phase and which day of it,
  the venue's access notes, the job and phase notes, the crew booked for
  that day by role with call times and places still to fill, and a link to
  the job in the app. Crew show by name only: rates, phone numbers and
  emails never go on the calendar. [Decision 0008](adr/0008-calendar-sync.md)
  has the reasons.
- The **Account** tab connects it: **Connect Google Calendar** goes to
  Google to pick the account that writes the jobs, then back to pick which
  of its calendars they go on. The card then shows the calendar, how many
  days are on it, and anything wrong in words, with **Check now**,
  **Change calendar** and **Disconnect**.
- The calendar follows the jobs: renaming a job, moving or adding a phase,
  changing a venue, booking crew or a freelancer answering from their link
  reaches the calendar within seconds, touching only the events that
  changed. Cancelling a job takes its days off; confirming it again puts
  them back. Days that have gone are never changed.
- The app leads: an event changed or deleted in Google is put back each
  night, a few minutes after the backup while the database is awake
  anyway, or straight away with **Check now**. Nothing else wakes the
  database.
- Each job's page says, for each phase, whether its days are on the
  calendar (with a link to open it), on their way, or couldn't be written
  and why. Enquiries say they go on once confirmed.
- Nothing doubles: each event's id is worked out from the job, so a write
  whose answer was lost, or two servers during a deploy, update the same
  event. The app only ever touches its own events, found by a hidden mark.
- Google being busy only delays things (tried again after a minute, then
  longer); the Account tab says so only if it goes on. If Google stops
  accepting the app's access, or the Calendar API is switched off, the
  Account tab says exactly that and what to do, and nothing else in the
  app is affected.
- The key Google gives the app is kept encrypted with the app's Google
  secret, never reaches a phone or laptop, and is left out of Download
  everything. Disconnecting hands it back to Google. Connecting, choosing a
  calendar and disconnecting show in the History tab.
- Checked: 19 new server tests against a pretend Google that answers as
  the real one does (connecting, and what Google is asked for; the
  events' contents; renames, moves, cancelling and confirming again; a lost
  answer; the nightly check putting back edits and deletions and clearing
  strays while leaving people's own events alone; Google busy; a day turned
  down; access taken away; the API off; a calendar unshared; changing
  calendar; disconnecting; the key never in the export or on devices), one
  more on a real Postgres like the live one, all 137 server tests, and 2
  new browser tests for the Account card and the job page.
- Merged into `main` at 00:36 UTC and live by 00:42: the live server
  answers the new calendar addresses, and says it needs the Google key
  first, as it should until the key is added.

**Next**

- Colly: when adding the Google key, also switch on the Google Calendar
  API and add the second redirect address, then connect your test
  calendar from the Account tab ([the steps](sign-in-setup.md), updated).
- Next in Phase 1: crew invites on the events and their answers read back
  (behind a switch that starts off), then the week and month planner.
- Colly, still waiting: the Sentry key ([the steps](monitoring.md)), the
  Railway bucket for backups ([the steps](backups.md)), the Google key
  ([the steps](sign-in-setup.md)) and the phone field test
  ([the steps](field-test.md)).

## 29 September 2026: Phase 1 starts with jobs, their phases, clients and venues

**Done**

- A new **Jobs** tab, now the one the app opens on. Each job has a client,
  a main venue, a status (enquiry, quoted, confirmed, cancelled or lost),
  notes, and its phases: Prep, Build, Show, Load out or any name typed,
  each one or more whole days, and each with its own venue if it needs
  one, such as Prep at the warehouse. [Decision 0007](adr/0007-jobs.md)
  has the reasons.
- Each phase shows how its days will read on the calendar, in today's
  format ("Nissan launch - Build 1/2"), which is what the calendar sync
  will write.
- A new job is one form: name, client, venue, status and phases. A client
  or venue not yet in the app is added as it's typed. Clients keep their
  contacts; venues keep an address, with a map link, and notes for access,
  load-in, power and parking.
- The list shows jobs coming up, past, and not going ahead, with a search
  across jobs, clients and venues, and how much of each job's crew is
  booked.
- Crew are now asked for from the job, for one of its phases or across
  several. The job's, phase's and venue's names go onto the crew call and
  stay current: rename any of them and freelancers' pages, offer messages
  and calendar feeds say the new name. The Crew tab still takes crew for
  something not in Jobs.
- Cancelling a job, or marking it lost, cancels its crew calls too, after
  the app asks and says how many people it affects. A phase with crew on
  it can't be removed until they're cancelled. Nothing is ever deleted, so
  the history and the download keep every job.
- Two people changing different things about the same job both keep their
  change, with or without signal. A job added with no signal waits on the
  phone and goes through when the signal is back.
- The History tab describes job changes in words ("Added the job Nissan
  launch for Nissan Ireland, confirmed"; "Changed Show on Nissan launch:
  dates to Sat 10 Oct"), and Download everything includes the clients,
  venues, jobs and phases.
- The live database gets its new tables by itself when the new version
  starts. Existing crew calls are kept as they are, not tied to any job.
- Checked: 16 new server tests (a job with its phases, client and venue;
  calendar titles; dates that don't make sense turned down; two phones
  editing one job offline; a rename reaching the freelancer's page;
  removing a phase that has crew; cancelling a job cancelling its crew;
  crew for a phase of a different job turned down; an older copy of the
  app still able to ask for crew; the history wording), all 116 server
  tests on both PGlite and a real Postgres like the live one, and 2 new
  browser tests: a job with its phases and crew, renamed for the crew too,
  and a job added with no signal.
- Also fixed: things added in a burst on one device, such as a new job's
  phases, now always keep the order they were added in.
- Merged into `main` at 23:33 UTC and live by 23:38: the live app has the
  Jobs tab, and the live database took its new tables when the new version
  started.

**Next**

- Nothing to set up for this: it's on.
- The phone field test now opens on Jobs; its steps say to tap **Stock**
  first.
- Next in Phase 1: the calendar sync, tried on Colly's test calendar, then
  a week and month planner showing who is on what, with clashes flagged.
- Colly, still waiting: the Sentry key ([the steps](monitoring.md)), the
  Railway bucket for backups ([the steps](backups.md)), the Google sign-in
  key ([the steps](sign-in-setup.md)) and the phone field test
  ([the steps](field-test.md)).

## 29 September 2026: a history of every change, and download everything

**Done**

- A new **History** tab shows every change anyone makes, newest first:
  what was done, in words ("Booked 4 × d&b Y10P for Electric Picnic, Fri 2
  Oct to Sun 4 Oct"), who did it, on what kind of device (such as "Safari
  on iPhone", with the device code its Account tab shows) and when. It can
  be narrowed to one person. [Decision 0006](adr/0006-audit-trail-and-export.md)
  has the reasons.
- A change made with no signal says so, and how long it waited on the phone
  before it reached the server. The wait is measured on the phone's own
  clock and the time placed on the server's, so a phone set to the wrong
  time still shows the right one.
- Requests the server turned down, such as a booking for kit that was
  already out, are in the history with the reason. Freelancers' own
  answers on their private links (accept, decline, a counter-offer, days
  off) show as theirs.
- **Download everything**, on the Account tab, gives one ZIP file: a
  spreadsheet for each kind of record, all of it as JSON for moving to
  another system, the history in words, and a README saying what each file
  holds. The spreadsheets open cleanly in Excel: names like Seán and Irish
  times come through, and text Excel would run as a formula (a risk with
  notes freelancers type) shows as the text it is. Tables added later are
  in it automatically.
- Left out of the file on purpose: freelancers' private link codes and
  staff sign-in sessions, so whoever holds it can't act as anyone. Each
  download shows in the history, with who took it and on what device.
- The History tab needs signal: the history is kept on the server rather
  than on every phone.
- Checked: 14 new server tests (who, what, which device and what was
  turned down; a change made offline on a phone whose clock was wrong;
  freelancers' answers; paging and narrowing to one person or one record;
  every file in the download, with no link codes or sessions anywhere in
  it; spreadsheets that open safely; each download recorded), one of them
  on a real Postgres database like the live one, and 3 new browser tests:
  a booking made with no signal and sent two hours later showing as made
  offline; the History tab saying it needs signal; and Download everything
  giving the file and showing in the history. Each safeguard was also
  broken on purpose, and its test failed.
- Also fixed: two older browser tests could pick up each other's speakers
  when they ran at the same time; each now uses names of its own.
- Merged into `main` at 22:41 UTC and live by 22:46: the live server
  answers the new history address.
- Also upgraded the part of the server that sends the app's pages to
  phones and laptops, which had a security warning. The real risk was
  low, since it only sends the app's own public files.

**Next**

- Nothing to set up for this: it is on.
- Colly, still waiting: the Sentry key ([the steps](monitoring.md)), the
  Railway bucket for backups ([the steps](backups.md)), the Google sign-in
  key ([the steps](sign-in-setup.md)) and the phone field test
  ([the steps](field-test.md)), which is what's left of Phase 0.
- Phase 1, projects and the calendar: clients, venues and projects first,
  which need no Google access, then the calendar sync, tried on Colly's
  test calendar.

## 29 September 2026: error alerts and uptime checks built

**Done**

- With a Sentry key set, the app server reports its own faults to Sentry,
  which emails whoever looks after the app: a request that failed on the
  server, a crash, a start-up that went wrong, and a backup that failed or
  couldn't start. [Decision 0005](adr/0005-error-alerts.md) has the
  reasons, and Colly chose Sentry for its EU data and one account covering
  all of it.
- The app on each phone and laptop reports its own errors too. A report
  made with no signal waits on the device and goes when the signal is
  back, or the next time the app opens. Phones only download Sentry's code
  while reporting is on.
- Reports are built to leave out anyone's details: no sign-in, request
  contents, cookies or IP addresses. The server names a failed request by
  its route as the code writes it, never the address used, and email
  addresses and anything shaped like a private link in an error's text are
  replaced.
- A new uptime address, `/api/up`, answers without asking the database, so
  Sentry's check every minute doesn't keep Neon's database awake and use up
  its free hours.
- Each scheduled backup checks in with Sentry, which emails when a night's
  backup fails or hasn't started by 03:00 UTC.
- Two fixes to backups on the way: pressing **Back up now** shortly before
  a scheduled run no longer makes a second backup straight after it; and
  after the `new-generation` command, phones start afresh on their next
  sync rather than after the server next restarts.
- Checked: 9 new server tests against a stand-in Sentry that keeps what
  it's sent (among them a failed request carrying a private link, an email
  address, a cookie and a form, none of which reached the report; 400s and
  404s not reported; the backup's check-ins, and a failed backup's report;
  nothing sent while reporting is off), 2 new backup tests, and 3 new
  browser tests: a phone's report with nothing personal in it and a browser
  extension's error left out; a report made with no signal sent when the
  signal came back; and one still waiting when the app was closed, sent
  when it next opened. Each browser test was also run against a
  deliberately broken app, and failed.
- Merged into `main` at 21:40 UTC and live by 21:47. The live health check
  says `"errors":"off"` until the Sentry key is added, and `/api/up`
  answers.

**Next**

- Colly: make a free Sentry account and give its key to the app server,
  about ten minutes: [the steps](monitoring.md). Until then the health
  check says `"errors":"off"`.
- Colly, still waiting: the Railway bucket for backups
  ([the steps](backups.md)), the Google sign-in key
  ([the steps](sign-in-setup.md)) and the phone field test
  ([the steps](field-test.md)).
- The last Phase 0 item: the audit trail and export-everything.

## 29 September 2026: design system in Figma

**Done**

- A Figma design system built from the app as it is today:
  [Session Hire Design System](https://www.figma.com/design/GO1I1Zv2iEfT07uMOk89ZN).
  Colour tokens in light and dark carrying the same names as the CSS,
  spacing, radius and type styles, and 11 components (brand mark, button,
  status pill, connection badge, input, alert, card, list row, tab bar, top
  bar). The Crew area is rebuilt from them as a worked example.
  [Design system](design-system.md) has the details.
- Checked: every component screenshotted; the example screen flips to dark
  by switching one setting; contrast measured for every text colour pair.

- Contrast fixes, chosen by Colly: text on red uses the darker #c8202e
  (5.7:1 with white), light-mode warn text is #8a5800, and buttons and
  fields are at least 44px tall. Done in the app, the freelancer page and
  Figma. Checked: typecheck, all server tests, all 8 browser tests.

- Spacing and radius tokens, added on 30 September: `app.css` names them as
  Figma does (`--space-2` to `--space-40`, `--radius-control`,
  `--radius-tab`, `--radius-card`, `--radius-full`), and `app.css` and
  `crew.css` use them wherever a value is on the scale. Nothing on screen
  moved. Checked: typecheck, the web build, all 31 browser tests, and 12
  screens screenshotted before and after in light and dark, two also at
  laptop width: all 28 identical to the pixel.

- Jobs, the planner and Stock use them too, also on 30 September:
  `jobs.css` and `stock.css` swap every value on the scale for its token.
  Four 10px corners stay in px, as they're on boxes, not tabs. Nothing on
  screen moved. Checked: typecheck, all server tests, the web build, all 37
  browser tests, and 14 screens screenshotted before and after in light and
  dark, four also at laptop width: every box and space the same in all 36,
  and 34 identical to the pixel. The other two differ by 3 pixels of text
  smoothing, as two pictures with the same CSS do.

## 29 September 2026: nightly backups built

**Done**

- Every night at 02:00 UTC the app server copies the whole database into
  one file and puts it in storage outside the database. It then restores
  that file into a scratch database and checks every table before counting
  it as a backup, so a backup that can't be restored is caught the night
  it's made, not the day it's needed.
  [Decision 0004](adr/0004-backups.md) has the reasons.
- The file is plain text inside, a line per row with a checksum per table,
  so it can be read without the app.
- Backups are kept for 35 days, then the first of each month for a year. A
  failed backup is tried again each hour, up to three times.
- Putting the data back means pointing the server at a new, empty database
  with `RESTORE_FROM` set, and deploying: [the steps](backups.md). Phones
  and laptops notice on their next sync, reload their copy, and send again
  everything they changed in the last two weeks, so work done after the
  backup isn't lost.
- The **Account** tab has a **Backups** card: when the last backup was
  made, what went wrong if the last try failed, and **Back up now**. The
  health check says whether backups are fresh, ready for the uptime alert.
- Checked: 21 new server tests (every table coming back exactly, accents,
  emoji and times to the microsecond included; damaged and cut-short files
  refused with nothing changed; an older backup restoring into newer code;
  the schedule, retries and what's kept; phones catching up after a
  restore; the storage's signed requests), one of them restoring into a
  fresh real Postgres database, and 3 new browser tests for the card. A
  trial on a local server restored a backup into an empty database on
  start-up, and left a database with data in it alone.
- Merged into `main` at 20:25 UTC and live by 20:32. The live health check
  says `"backups":"off"` until the bucket is added.

**Next**

- Colly: make a Railway bucket and give it to the app server, a few
  minutes: [the steps](backups.md). Until then the Account tab says
  backups are off.
- Colly, still waiting: the Google sign-in key
  ([the steps](sign-in-setup.md)) and the phone field test
  ([the steps](field-test.md)).
- Error tracking and uptime alerts.

## 29 September 2026: staff sign-in built

**Done**

- Staff sign in with their Google account. Staff means a sessionhire.com
  Workspace account, or an address listed by hand, such as a tester's.
  Everything the app reads or changes now needs sign-in, except the health
  check and freelancers' private links.
  [Decision 0003](adr/0003-staff-sign-in.md) has the reasons.
- A signed-in phone stays signed in for 60 days after it was last used, and
  keeps working with no signal. It only shows the sign-in page when the
  server says so, and anything changed offline waits until someone signs in
  rather than being lost.
- Every change now records who made it, in the audit trail and the export.
- New **Account** tab: who is signed in, and **Sign out**, which also clears
  the device's copy of the data (with a warning if changes haven't synced).
- Safety catch: once anyone has signed in, the server won't start without
  the Google key, so a lost setting can't quietly open the app to everyone.
- Checked: 26 new server tests (signing in; turning away personal accounts,
  other companies and unverified addresses; forged returns from Google; sign
  out, expiry and switched-off accounts; live updates only for signed-in
  devices) and 3 new browser tests (the sign-in page keeping waiting
  changes, a refused account, signing out clearing the device). All earlier
  tests still pass.
- Merged into `main` at 19:36 UTC. It reaches the live app with the next
  deploy; until the Google key is added the health check will say
  `"auth":"off"` and the app stays open as before.

**Next**

- Colly: make the Google sign-in key, add it in Railway, then **Deploy
  Latest Commit**, about ten minutes: [the steps](sign-in-setup.md). Until
  then the app stays open to anyone with the address, so keep to made-up
  data.
- Phone field test: [the steps](field-test.md).
- Backups with a tested restore, then error tracking and uptime alerts.

## 29 September 2026: app live on Railway

**Done**

- The app runs at shserver-production.up.railway.app, deployed from `main`,
  with its data in a Neon Postgres database created through Vercel's
  storage menu. A Railway incident ("slow or stuck deployments") held the
  first deploy up for a few minutes.
- The health check (`/api/health`) now says where the data lives:
  `postgres`, `file` or `memory`. Before this, there was no way to tell from
  outside which database a deploy was using.
- On a host the server now refuses to start without a database, so a missing
  `DATABASE_URL` fails the deploy with a reason in its logs instead of
  running on a throwaway in-memory store that loses everything on restart.
- Checked: new server tests for each setting and for the health check.

- The database is in Frankfurt (confirmed by Colly), as planned for GDPR
  and latency.
- Confirmed live at 19:19 UTC: the health check reads `"db":"postgres"`.
  Railway didn't start a deploy by itself for the merges after the first
  one, so Colly deployed the latest commit by hand (Railway's command
  palette, **Deploy Latest Commit**).

**Next**

- Phone field test on the live app: [the steps](field-test.md) (Colly).
- Find out why Railway skips merges: the reason it shows on skipped
  deployments. Until then, each merge to `main` needs Deploy Latest Commit.
- Staff sign-in with Google, so real jobs and crew can go in: being built.

## 29 September 2026: crew booking started early

Built in parallel with Phase 0, so the freelancer side can be tried as soon
as the app is hosted. The decision is recorded in
[ADR 0002](adr/0002-crew-booking-links.md).

**Done**

- **Crew screen for ops** (the Crew tab in the app): people with skills,
  rates and contact details; jobs that need crew (project, phase, role,
  dates, call time, how many, day rate, venue, details); offers to one
  person or a shortlist; answers to check, with Confirm, "Agree €300" for
  counters, and Release.
- **Send an offer where the freelancer already looks:** the app writes the
  message with every detail and their link, and opens WhatsApp, text or
  email with it filled in. Nothing is sent automatically yet.
- **Freelancer's private link, no app or login:** see offers in full, accept
  all or some days, decline, ask for a different rate, mark days off,
  subscribe to bookings in Google, Apple or Outlook calendar, and download
  everything held on them. Works with JavaScript off, so it opens instantly
  from WhatsApp.
- **Rules the server enforces**, whichever way an answer arrives: nobody is
  double booked; the first to accept a shortlisted role gets it and the rest
  are told it's filled; days someone marked off need an explicit override.
- Checked: 12 new server tests (shortlists, part-days, counters, clashes,
  days off, links, calendar feed, offline ops device) and a browser test
  where the office offers a job and a phone answers from the link. All
  earlier tests still pass.

**Next for crew**

- Link crew calls to Phase 1 projects and phases, and add confirmed crew to
  the Google Calendar event as attendees; read RSVPs back as answers.
- Documents with expiry (Safe Pass, manual handling) that block an offer.
- Timesheets from confirmed days, then ready-made freelancer invoices.

**Waiting on**

- Nothing new. Real freelancer data waits until staff sign-in is in.

## 29 September 2026: hosting picked

**Decided:** the app server runs on Railway and the database on Neon
(Postgres, EU). Vercel keeps serving this blueprint at sh.letissier.ie.

**Done**

- `railway.json` added: Railway builds the app, starts the server and checks
  `/api/health` before switching traffic over. The server already serves the
  app and its live connections from one place.
- Checked: a production-style start locally serves the app and answers the
  health check.

- Neon project `session-hire` created (Postgres 17, Frankfurt, free tier).
  The server creates its tables on first start.
- `main` branch created from the working branch, so production deploys
  from `main` and new work arrives through pull requests.

**Waiting on**

- Colly: make `main` the default branch on GitHub, then create the Railway
  project from `main` with `DATABASE_URL` set as a secret, and share the URL
  for the phone field test.

## 29 September 2026: Phase 0 started

**Done**

- Codebase set up as one TypeScript repo with three parts: `shared` (the
  model, commands and the device-side sync engine), `server` (Fastify and
  Postgres) and `web` (the installable app).
- The sync engine is built and the decision is recorded in
  [ADR 0001](adr/0001-sync-engine.md): our own engine on the Crewbox pattern.
- A small test app shows it working: add stock, book it, scan it out, switch
  the signal off, book on another device, switch it back on.
- Checked: 10 server tests (including 20 devices at once on real Postgres)
  and a browser test where a phone in flight mode reloads the app, books,
  and gets the server's answer on reconnect. All pass.
- CI runs typecheck, tests, the browser test and the blueprint build on
  every push.

**Waiting on**

- Somewhere to host the server so the test app can be tried on real phones,
  in a real dead spot. Vercel hosts the blueprint but cannot hold the
  server's live connections.

**Next in Phase 0**

- Host the test app and do the field test.
- Staff sign-in with Google Workspace and freelancer email links.
- Backups with a tested restore; error tracking and uptime alerts.
