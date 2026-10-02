# ADR 0026: Bringing in the stock list, and a log on each item's page

- **Status:** Accepted, 2 October 2026. Built after round three, beside
  the crew list's import ([ADR 0025](0025-crew-profiles-and-bringing-in-the-list.md)).
- **Decides:** how Colly's stock list comes into the catalogue whatever
  its layout, what each row becomes, how a second import of the same file
  changes nothing; and what an item's page shows of its past, with and
  without signal, leaving room for trackers later.

## Context

The catalogue is built ([ADR 0013](0013-warehouse-catalogue.md)), with
labels ([ADR 0015](0015-printing-labels.md)), scanning out and in
([ADR 0017](0017-pick-lists-and-scanning-out-and-in.md)), faults
([ADR 0018](0018-faults-missing-kit-and-repairs.md)) and inspections
([ADR 0020](0020-inspections.md)). It is empty: typing thousands of items
in by hand isn't going to happen. Colly's stock list arrives next week
and nobody here has seen it. It may have a title row over the headers,
columns named any of a dozen ways, several serials in one cell, dates
written the Irish way or the American way, prices with euro signs, and
locations nobody has typed into the app. So the reader can't depend on
one layout, and anything it isn't sure of has to be shown and decided by
a person, never guessed, as the crew list's import does.

Colly also asked: "is there an individual page for each item? So we can
have a log of items checked in and out, marked for repair, repaired, lost
etc. and for items when they have AirTags/GPS to have their location
there also". Each item has a page. What it lacks is its past. The
warehouse often has no signal, and a phone holds only part of that past:
the scans, faults and tests it syncs, but not who did them, nor when an
item was added, moved, relabelled or changed. Those are only in the
server's history.

## Decision

### Bringing in the stock list

**A CSV file, as the crew list.** The office saves the sheet as "CSV
UTF-8" and chooses it on "Bring in the stock list"
(`#account/import-stock`), whose card sits beside the crew list's on the
Account tab and which the Stock tab offers while the catalogue is empty.
It is read by the same reader, `shared/src/csv.ts`, and a file whose
letters didn't survive the save is turned back with the same words.
Excel splits the fields by semicolons where a comma is the decimal mark,
so a file is read split by semicolons when that finds more of the
headers, or more columns when it knows none. It needs signal, like the
crew list: the server reads it against everything already in the
catalogue.

**Columns are found by their headers.** The header row is the first of
the first ten rows with the most headers the app knows, so a title row
over the headers is passed over. Headers are compared with capitals,
brackets ("Value (€)"), and stray marks (`#`, `:`, `.`) ignored. Each
field has its names; the first column found for a field is read:

| Field | Headers it's read from |
| --- | --- |
| Product | product, product name, item, item name, description, name, equipment |
| Make | make, manufacturer, brand |
| Model | model, model no, model number |
| Department | department, dept |
| Category | category, type, group, sub category, subcategory |
| How many | quantity, qty, count, how many, units |
| Maker's serial | serial, serial number, serial no, s/n, sn, serials, serial numbers |
| Asset number | asset number, asset, asset no, asset tag, tag, tag number, sh number, barcode, label, asset numbers, tags |
| Where it's kept | location, place, shelf, bay, store, storage, where |
| Case | case, flight case, container, road case, in case |
| Value of one | value, replacement value, cost, price, unit price, replacement cost, unit value |
| PAT due | pat due, pat due date, next test, next test due, next pat, next pat due, inspection due |
| Notes | notes, note, comments, comment, remarks |

A column headed "No." is asked about: it's a line's number or an asset
number as often as a count, and a line's number read as a count would
count 37 cables on line 37.

**Which column is which.** When a header isn't one of those, or there's
no column for the product, a step before the preview lists every column
with its first values and a choice of field, the known ones already
chosen; a column nobody claims stays "Not read" and is listed as such in
the preview, never guessed at. The preview can go back to this step.

**What a row says.**

- The product's name is the model with the make in front ("d&b" and
  "Y10P" make "d&b Y10P"); with no model, the product column, with the
  make in front where it isn't already. A product column beside a model
  is kept as the new product's notes. No name is a problem, and so is a
  row of totals ("Total", "Grand total", "Subtotal"), which is skipped,
  never made a product.
- A cell holding a spreadsheet's error ("#N/A", "#REF!") is a problem,
  never read as a name or a number.
- The department is read from the department column, or from the
  category where that names one: Audio (or Sound), Lighting (Lights,
  LX), Video (Vision), Staging (Stage), Rigging, Power (Electrical,
  Distro), Other. A department the app doesn't know is a problem, fixed
  in place; none said is Other. The category is free text, as on the
  form.
- How many is a whole number ("12", "x12", "1,200").
- Numbers: the asset number and serial cells may each hold several,
  split by commas, semicolons or line breaks, one for each item, in the
  same order. "-", "n/a", "none" and "tbc" are no number. A range
  ("SH-000001 to SH-000010") isn't read: it's a problem, so the office
  writes them out.
- The value of one is read with the money parser (`shared/src/money.ts`),
  so "€1,250", "1 250,00" and "1250" all mean the same.
- The PAT due day is read as a day, the Irish way: "30/09/2027",
  "30.9.27", "30 Sept 2027" and "2027-09-30" all work, with any time
  Excel adds, and a two-digit year is this century. Anything that could
  be read two ways is a problem, never a guess: a month over 12
  ("09/30/2027", month first), a spreadsheet's date number ("46660"), a
  month and year with no day, or a day that doesn't exist. And once any
  row, skipped or not, writes its date month first, a date in another
  that reads either way ("03/04/2027") is a problem too, since the sheet
  may write them all that way and a PAT read a month or more late lets
  kit out untested. Written the Irish way throughout, the same date is 3
  April.

**What a row becomes.**

- **A product**, matched to one already in the catalogue by name with
  capitals and spacing ignored, or a new one. A new product is numbered
  when any of its rows has numbers or a PAT due day, when it holds other
  kit, or when it's worth €150 or more, the line ADR 0013 draws;
  otherwise it's counted. The preview says which, and it can be changed
  on its page afterwards. A product already here keeps its department,
  category and value: the list only fills what's blank (a value, how
  often it needs a PAT), makes a counted product numbered when the list
  has numbers for it, and marks one that the list names as a case as
  holding other kit; its notes are added to once. Two rows giving one
  product different values, or a new one different departments, is a
  problem.
- **Numbered items**, for a row with serials or asset numbers. Several
  in a cell are several items. A quantity that isn't the number of
  numbers is a problem; so are a different count of serials and asset
  numbers. For each item:
  - an asset number in Session Hire's own form ("SH-000123", "sh 123")
    is kept as its number if no item has had it; the same number already
    on an item means that item (below); one an item had before is a
    problem, as a number is never used twice;
  - any other tag ("A-0042", "1042", a maker's barcode) is kept on the
    item as its **old number**, a new field, and the item gets the next
    Session Hire number. Scanning or typing the old number finds the
    item, as its maker's serial already does;
  - the maker's serial goes in the serial, which scanning already reads.
  Items without a usable number get the next free numbers from the one
  sequence labels use, when they're brought in: after every number on an
  item or set aside for printing, a cancelled run's included, so none is
  ever given out twice and none lands on a printed label not stuck on
  yet ([ADR 0015](0015-printing-labels.md), audit finding 19).
- **Counted stock**, for a row with a quantity and no numbers: that many
  at that place or in that case. The list says what is there, so the
  count is set to it, never added to. Two rows counting one product in
  one place is a problem.
- **A case** has a number of its own, so a counted row for a product
  that holds other kit makes items of it up to that many altogether. A
  list counting fewer than are here retires none, and the row says so.
- New items where some of their product are counted and the list
  doesn't count that product there take one off the count each, as
  labelling does (ADR 0013), and the preview says so.
- A PAT due day goes on each item as when the list says its next PAT is
  due, used until a test is recorded here. Items of a product that
  needed no PAT are now tested every 12 months, the form's suggestion,
  and the preview says so. Counted stock has no item to hold the day,
  so it's not read there, and the row says so.
- Notes go on each new item, or on the product for counted stock, added
  once.

**Places and cases are matched by name.** A place by its name, capitals
and spacing aside. A case by its number in Session Hire's form, by its
old number, or by the name of a product that holds other kit and has one
item, here or in the list. "There are 3 × Rack 4U" is a problem, solved
with the case's number. A product here that holds no kit, named as a
case, is a problem in the preview, since the list doesn't make it hold
kit unless its own rows say so. An item the list numbers and another row
names as a case by that number makes its product one that holds other
kit, so a row counting more of it makes them too. A row naming both a
place and a case puts its kit in the case; the case's own place comes
from its own row. A place or case the list names that isn't here is
listed at the top of the preview, and is only made if the office ticks
**Make the places and cases this list names**, since a new place is a
question, never a silent create (round three). Until then, the rows
naming them have a problem. A case made from its name is a product of
that name holding other kit, with one item, kept where the first row
naming it says. Rows saying nothing of where can go to one place, typed
once above the rows ("Kit the list doesn't place is at"); otherwise
counted stock with nowhere to be is a problem, and numbered items come
in not placed yet.

**A second import of the same file changes nothing.** Numbered rows
match the items already here by Session Hire number, then old number,
then serial, so an item brought in once is found again however it was
numbered; one item on two rows, however each names it, is a problem.
A matched item is moved, and its serial, old number and PAT due day
set, only where the list says something different; its notes are added
to once. Counted rows set what's already set. Places, cases
and products match by name. So the second time, every row says "Already
as the list says" and no command is sent. A test proves it.

**The preview, row by row, as the crew list's.** The server reads the
file and answers with every row: what the app made of it, what bringing
it in will do in words ("New product, numbered", "3 new items, numbered
when brought in", "Counts 20 at Bay A3 (18 there now)", "SH-000123:
moves to Bay A3"), and each problem beside the field it's about. The
counts are on top: new products, new items, counted stock, rows updating
something, skipped, rows with problems. A row with a problem has its
fields to fix, decided once from the preview so they stay put while
typing, and Skip; a problem the tick solves (a place not here yet) is
said under the row instead of opening its field. As the office fixes, skips or ticks, the device checks
every row again by the same shared rules (`shared/src/stock-import.ts`)
against what it holds. Nothing is saved until **Bring in 212 rows**,
disabled while any row not skipped has a problem, which asks first in
the same bar. A list found all as it says reads "Nothing to bring in:
it's all here", and nothing is sent.

**Bringing in** (`POST /api/stock/import`) checks every row again under
the lock, and refuses, naming the row, if one now has a problem or would
do anything other than what the preview said ("Choose the file again to
see it"). Then each row goes in as the commands a device would send, in
order: places, products and what changes on products already here,
numbered items that keep their own numbers (so the next free numbers
come after them), cases (each after the case it goes in), the rest of
the items, moves and changes to items already here, then counts. Each is
checked by its own schema and applied by its own handler, so sync, the
history and the export follow with no special case. The history gets one
line per command and, once it's all in, one for the import: "Brought in
the stock list (212 rows)"; none for a list that changed nothing.

**A long list goes in a call at a time.** Every command is a dozen or so
round trips to the database, and the server and the database are in
different places (Railway, and Neon in Frankfurt), milliseconds apart. A
made-up list of 1,500 rows with 3,000 numbered items is 4,836 commands
and about 65,000 queries: 14 seconds against a Postgres on the same
machine, and with 3 milliseconds added to each query, as a database
across a network has, four minutes, all under the lock every phone's
sync takes, against an app that gives up on an answer after a minute. So
a call makes changes for 20 seconds at most, in one transaction, then
answers with how many are left and what each row now does; the app sends
the rows again with those, showing how far it's got, until nothing's
left. That list went in in 13 calls. Each call takes the lock afresh and
checks every row against what the last one said, so phones' changes go
in between calls, and a change someone makes in between that alters what
a row does is refused, naming the row, as for the preview. Each call is
all or nothing; what earlier calls brought in stays, and the same file
chosen again carries on where it stopped, since what's in reads as
already as the list says. Not one transaction for the lot with a longer
wait: that holds every phone's changes for minutes, and a dropped
connection would leave the office not knowing whether any of it went in.

**On each item, two new fields** (stock migration 8): the old number,
unique, never one in Session Hire's form; and the PAT due day the list
gave. Both are on `asset.add` and `asset.update` as optional fields, so
an older app's commands still do what they did. Old numbers are found by
the Stock search, the camera, a pick list, a batch of tests, and putting
an item in a case or at a place: an exact old number first, since the
short way of typing a Session Hire number ("123") could be an old tag
too while every Session Hire label carries "SH-", then a Session Hire
number, then a serial. An item's page shows its old number, which Change
details can change. Wherever the PAT due day shows (the item's
Inspections card, the Stock tab's inspections due, a warning as it's
scanned out) it says "as the stock list says", since no test here set
it; the register of tests holds only tests recorded here.

### A log on each item's page

**What's on it.** Everything that happened to the item, newest first,
each with when and, where known, who: added or numbered, a new label,
put at a place or in a case, out to a job and back (naming the job, and
the case when the case was scanned), faults reported, their repair notes,
and how they ended (fixed, not faulty, found, written off), PAT tests and
thorough examinations with their result and who tested, retired and
brought back, added by mistake, and edits (which fields, as the history
says them).

**What each side knows.**

| | On the phone, no signal | Only on the server |
| --- | --- | --- |
| Scans out and back, its own and its case's | yes, with when | who scanned |
| Faults: reported, closed, the job | yes, with when | who; each change to the repair notes |
| Tests: result, day, tester | yes | who recorded it |
| Its own changes waiting to sync | yes | |
| Added, numbered, relabelled, moved, edited, retired | where it is now, not when | all of it, with who and when |

**The design: one log, two sources, one set of words.** Each entry is a
typed event (`shared/src/item-log.ts`): out, back, added, moved, a new
label, a fault, repair notes, closed, a test, retired, brought back,
edited. A shared function says each in words about the item ("Out to
Nissan launch", "Moved to Bay A3", "Passed its PAT, tested by Sparky
Testing"), so the page reads the same with and without signal.

- The phone builds its part from what it holds: its movements, faults
  and tests (the ones it's still sending marked waiting), and its own
  changes to the item still in the outbox.
- With signal, the page asks `GET /api/stock/items/:id/log`, which reads
  the history's records about the item: every change that touched it,
  and the scans (its own and its case's, as the phone has it), fault
  reports, fault changes and tests aimed at it, as the same typed
  events, with who and on what device.
- The two are joined by what each entry is about (the scan, the fault,
  the test, or the change itself), so the phone's entry gains its who
  and nothing appears twice. The server's entries the phone can't make
  fill in the rest.
- Without signal, the card says plainly: "With no signal, this shows the
  scans, faults and tests on this phone. Who did each, and when it was
  added, moved or relabelled, come with signal."
- A long log shows its first eight and "Show all 40 entries", the
  `ShowAll` fold in `web/src/Fold.tsx`; older than the server's first page
  is a tap on "Show older", with signal.

Why this and not the others:

- **The History tab's words, as they are,** name the item in every line
  ("Scanned SH-000123 (d&b Y10P) out to Nissan launch") and can't be
  made on a phone without the server, so the page would read one way
  offline and another online.
- **The server alone** would leave a warehouse with no signal with no
  log, when the phone already holds most of what matters there: where
  the item has been and what's wrong with it.
- **Syncing the history to every phone** would carry every change ever
  made, and everyone's names, to every device, against the scopes the
  architecture sets.

**Counted stock** has no item page, and no log for now. A product's page
could get one later for its counted kit from the same parts (counts set
and moved, counted out and back, faults on counted kit), as a log per
product rather than per place. It waits until the office asks, since
counted kit is cables and clamps, whose past nobody has asked about.

**Trackers, later.** Not built. AirTags have no public way to read where
they are: Apple shows them only in Find My, to one Apple ID, so the app
can't put their location anywhere. Trackers that offer one (GPS or
LoRaWAN trackers with a web API, for cases and vans) would fit the log
like this: the server asks the tracker's service every so often, or is
told by it; each reading is kept as a sighting (tracker, item, where,
how sure, when), not as a command, since nobody did anything; the item's
page shows the last one at the top ("Seen at the Point, 2 Oct 14:05");
and the log takes a new kind of event, "Seen at…", only when the place
changes, so a tracker reporting every five minutes doesn't bury the
scans. The log's events are a union with room for that kind, and its
entries already carry a source (this phone, or the server), so a
tracker's readings can be told apart.

## Consequences

- The stock list goes in after Start fresh, in an afternoon of reading
  the preview. It can be brought in again once it's corrected: what
  matches changes only where the list says otherwise, and nothing is
  ever retired or uncounted because the list leaves it out.
- An old label keeps working while Session Hire's labels go on, so the
  warehouse needn't relabel everything before using the app.
- A PAT due day from the list puts kit that's overdue on the Inspections
  due card and keeps it from going out, as a recorded test would. If the
  list's days are stale, the first round of testing puts them right.
- Several kinds of row are refused rather than guessed: a range of
  numbers, a date that reads two ways, a case named by a product with
  several items. The office fixes those in place or in the sheet.
- The item log reads the history by the item's id and by the ids in
  each command; at tens of thousands of commands that's quick, and an
  index on the commands' item can come if it slows.
- Reading an item reads the labels it had before, which read every label
  there is until migration 8 indexed labels by their item: at 3,000
  items, reading them all took over a second, and each command reading
  its item grew with the list. With the index it's milliseconds.
- A list brought in a call at a time can stop part way, on a refusal or
  a lost connection. It's never half a call, and choosing the file again
  finishes it.
- Not yet: Excel files read directly (save as CSV); a thorough
  examination's due day from the list (recorded on the item, ADR 0020,
  as its register needs who examined it); a log for counted stock;
  trackers.

## For the office: shaping the stock list

Save the sheet as **CSV UTF-8** (in Excel: File, Save a copy, CSV UTF-8)
and choose it on the Account tab under **Bring in the stock list**.
Nothing is saved until you've seen every row. Commas or semicolons
between the columns are both fine. A made-up example is in
[samples/stock-list.csv](../samples/stock-list.csv).

- **One row per line of kit**: a product, and either how many there are
  or their numbers. The first row holds the column names; a title above
  it is fine.
- **Columns the app reads**, in any order and named as you like within
  reason: Product (or Item, Description), Make, Model, Department,
  Category, Quantity (or Qty), Serial, Asset number (or Tag, Barcode),
  Location (or Place, Shelf, Bay), Case, Value, PAT due, Notes. Any other
  column, you'll be asked about; one you don't claim isn't read.
- **Numbered kit**: put each serial or asset number in, several in a cell
  separated by commas, in the same order in both columns. Old asset
  numbers are kept, and still scan; each item also gets a Session Hire
  number. Write ranges out: "SH-000001 to SH-000004" isn't read.
- **Counted kit**: a quantity and no numbers. The count you give is what
  the app will have there, not an addition.
- **Where**: a location, a case, or both (the kit's in the case). New
  places and cases are listed for you to agree to before they're made.
- **Dates** day first: 30/09/2027. If one date in the list is written
  month first, any other that could be read either way is asked about
  too, so check the column. **Money** as you'd write it: €1,250.
- **Totals** at the bottom: skip that row, or leave it out of the file.
- **A long list** goes in a part at a time, and says how far it's got:
  keep the page open until it says "Brought in". If the signal drops
  part way, what went in stays; choose the file again and bring in the
  rest.
