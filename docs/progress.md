# Build progress

Newest first. Each entry says what changed, what was checked, and what is
waiting on someone.

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

**Next**

- Colly, to try it: add kit to a job, open **Pick list** from its Kit
  card, and scan a labelled item with **Scan**.
- Next in Phase 2: missing and damaged items on return, with faults and
  repairs, and the Stock tab's list becoming the place scans that didn't
  match get sorted out.

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
