# The Crewbox show pack

What's in the show pack Session Hire makes for the Crewbox, file by file,
so the Crewbox side can read it. It is step 1 of the
[Crewbox handoff](research/crewbox-handoff.md): files only, made on the
office's phone or laptop from what it holds, saved as a download, and sent
nowhere. Why it's built this way is
[Decision 0045](adr/0045-the-crewbox-show-pack.md).

This page is the contract. A change to a file's columns or meaning puts
up `formatVersion` in the manifest and is written here first.

## Where it's made

- **For a phase:** Show pack, on the phase's call sheet
  (`#jobs/‹job›/sheet/‹phase›`). File: `show-pack-‹job›-‹phase›.zip`.
- **For the whole job:** Show pack, on the job's page. Every phase, and
  any crew asked for across phases. File: `show-pack-‹job›.zip`.

Optionally, the box's address on the site's Wi-Fi and the event PIN, typed
when making it, for the join QR. They go in the pack only; the app keeps
neither.

## The files

Everything is UTF-8. CSV files are as Excel opens them: a byte-order mark
first, lines ending CR LF, fields with a comma, quote or line break in
double quotes, and a cell starting `=`, `+`, `-` or `@` given a `'` in front
so a spreadsheet won't run it. Days are `YYYY-MM-DD` and times `HH:MM`, 24
hour, Irish time. Every file is there in every pack, even with no rows, so
a reader never has to ask whether one is missing.

| File | What it is |
|---|---|
| `manifest.json` | What the pack is, which version of this layout, and every file in it |
| `event.json` | The event: name, days, each phase's venue, access notes and contact on the day |
| `crew.csv` | Who's on, one row per person per crew call |
| `crew-list.html` | The crew list to print, with the join QR when the box was given |
| `contacts.csv` | Who to ring on the day, and the office |
| `running-order.csv` | The running order, as acts for Crewbox's timetable |
| `running-order.txt` | The run of show as people read it: crew calls by time, then the notes as typed |
| `kit.csv` | The kit, with Session Hire's numbers of what's scanned out |
| `patch.csv` | The patch sheet: columns only, since Session Hire holds no patch yet |
| `lighting.csv` | The lighting rig: columns only, since Session Hire holds no rig yet |
| `README.txt` | The same list, for the person unzipping it |

### manifest.json

```json
{
  "format": "session-hire/show-pack",
  "formatVersion": 1,
  "made": "2026-10-17T09:00:00.000Z",
  "madeBy": { "app": "Session Hire", "version": "3f2a9c1b7d4e" },
  "scope": "phase",
  "job": { "id": "…", "name": "Harbour Lights Festival", "client": "Shannonside Festivals" },
  "phases": [{ "id": "…", "name": "Show", "start": "2026-10-22", "end": "2026-10-23" }],
  "phones": "crew who have said yes",
  "joinQr": true,
  "files": [
    { "path": "crew.csv", "kind": "crew", "rows": 3 },
    { "path": "patch.csv", "kind": "patch", "rows": 0, "template": true }
  ]
}
```

- `format` is always `session-hire/show-pack`; `formatVersion` is the
  version of this page's layout (1). A reader that gets a version it
  doesn't know should say so rather than guess.
- `madeBy.version` is the app's build (the first 12 characters of its
  commit, or `dev`).
- `scope` is `phase` or `job`. `phases` lists the phases in the pack.
- `phones` says whose numbers are in `crew.csv`: `crew who have said yes`,
  or `the contact on the day's only` (see Privacy, below).
- `files` lists every other file with its `kind`; a CSV has `rows` (data
  rows, the header not counted), and an empty template has `template: true`.

### event.json

```json
{
  "name": "Harbour Lights Festival: Show",
  "job": { "id": "…", "name": "Harbour Lights Festival", "client": "Shannonside Festivals" },
  "start": "2026-10-22",
  "end": "2026-10-23",
  "phases": [
    {
      "id": "…", "name": "Show", "start": "2026-10-22", "end": "2026-10-23",
      "venue": { "name": "Riverside Park", "address": "Limerick", "notes": "Load in from the north gate.", "map": "https://www.google.com/maps/search/…" },
      "contactOnTheDay": { "name": "Aoife Brennan", "phone": "+44 7700 900105" }
    }
  ],
  "departments": ["Audio", "Production"],
  "box": { "connect": "http://crewbox.local/connect" }
}
```

`name` is what the box's event name could be: the job and phase, or the
job for a whole-job pack. `venue` and `contactOnTheDay` are `null` when
the phase has none. A venue's `address` leaves out a first line that is
only its name again; `notes` are its access, load-in, power and parking.
`departments` are those of the crew on the pack, as typed on their
profiles, for one channel each (as step 2 would seed them). `box` is
`null` unless the box's address was given.

### crew.csv

`phase_id,phase,name,known_as,role,department,call_time,days,status,phone`

| Column | |
|---|---|
| `phase_id`, `phase` | The phase; empty and `Across phases` for crew asked for across a job's phases |
| `name` | Their full name |
| `known_as` | What they go by: their "known as", or else their first name. What they'd type joining the box |
| `role` | The crew call's role, such as `Sound No.1` |
| `department` | Their department, as typed on their profile; may be empty |
| `call_time` | `HH:MM`, or empty |
| `days` | The days they're on, `YYYY-MM-DD` separated by spaces |
| `status` | `booked` (confirmed by the office) or `to confirm` (they said yes, the office hasn't confirmed) |
| `phone` | Their number, as held (international form, `+353…`), or empty: see Privacy |

Rows go phase by phase, then by call time and role, then by name.

### contacts.csv

`phase_id,phase,what,name,phone,email`

A row per phase with a contact on the day (`what` is `Contact on the
day`), then the office's details from Admin (`Office`), when it has a phone
or email.

### running-order.csv

`id,name,stage,date,start,end,changeover,phase_id`

These are the fields of Crewbox's timetable act
(`Act {id, name, stage, date, start, end, changeover}`), with the Session
Hire phase it came from, so a later import or push can update rather than
duplicate. They are read from the phase's notes, which is where the office
types the running order:

- A line starting with a time (`18:00 First act`, `9.30 Doors`,
  `18:00–19:00 Support`) is an act, in the order written. `end` is only
  what's written; none is made up from the next act. `changeover` is
  always empty for now (minutes, when there is one).
- A line that is only a day (`Sunday`, `Sun 4 Oct`, `Day 2`,
  `2026-10-04`) puts the lines after it on that day of the phase. Until
  one does, they are on the phase's first day.
- Notes with no day line on a phase of several days are the same order
  each day, as the call sheet reads them, so the acts are repeated on
  every day of the phase.
- A line `Stage: Main` or `Main stage:` sets `stage` for the lines after
  it; otherwise it's empty.
- Any other line isn't an act. It stays in `running-order.txt`, and the
  README says how many were left out.
- `id` is `‹phase id›-‹n›`, its place in the phase's list. Moving a line
  changes it, so a reader should replace a phase's acts rather than merge
  them by id.

### running-order.txt

Plain text: for each phase, its days, venue and contact, the crew calls by
time with who's on each, then the phase's notes as typed, and the job's
notes last. For people; nothing should parse it.

### kit.csv

`department,category,product,quantity,subhired,supplier,scanned_out,numbers`

| Column | |
|---|---|
| `department` | `audio`, `lighting`, `video`, `staging`, `rigging`, `power` or `other` |
| `category`, `product` | As in the stock list |
| `quantity` | How many the job's kit lines want, those subhired included; 0 for something scanned out that isn't on the kit |
| `subhired`, `supplier` | How many come from another company, and from whom |
| `scanned_out` | How many are out with the job now: numbered items and counted kit |
| `numbers` | The Session Hire numbers (`SH-000123`) of the items out with the job now, separated by spaces |

For a phase, the kit is that phase's lines and the whole job's. Kit goes
out with a job, not a phase, so `scanned_out` and `numbers` are the job's.
For the whole job, it's every line, and anything scanned out with the job
that isn't on its kit. Rows go by department, then product.

### patch.csv and lighting.csv

Session Hire holds no patch or lighting rig yet, so both are a header row
only, for the crew chief or the LD to fill in and load on the box:

- `patch.csv`: `Channel,Source,Mic/DI,Stand,48V,Stage box,Notes`
- `lighting.csv`: `Channel,Dimmer,Universe,Address,Position,Unit#,Instrument Type,Mode,Purpose,Color,Gobo,Notes`
  (Lightwright's column names)

The handoff says these should be "in Crewbox's own export layout". That
layout couldn't be read when this was built, so the columns are plain
names Crewbox's fuzzy-header patch import and its Lightwright-header
lighting import read. Once Crewbox's export columns are checked, these
change to match them, with `formatVersion` 2.

### crew-list.html

A page to print on A4 or open on a phone: the job and phase, the venue
and its notes, the contact on the day, and the crew by name, role and call
time (with numbers, when the pack has them). When the box's address was
given, it starts with the join QR: a QR code of the box's `/connect` page
(`http://‹address›/connect`, the scheme added when not typed), the address
written out, and the event PIN when given. The PIN is never put in the QR
code or the address.

## Privacy and money

Who is on the pack, and whose numbers, follows the call sheet's rules
([Decision 0021](adr/0021-call-sheets.md)). The pack is the crew chief's:

- **made by someone who can change crew** (the office, heads of
  department, directors; [Decision 0034](adr/0034-roles-and-what-each-can-change.md)):
  the contact on the day's sheet: everyone who has said yes, booked or to
  confirm, with their numbers;
- **made by anyone else** (the warehouse, staff crew): what the rest of the
  crew see: those the office has confirmed, by name and role, and no number
  but the contact on the day's.

Never in it, whoever makes it: anyone only offered or turned down, a
client's contacts, a rate, a price, a quote, an email address but the
office's, or anyone's private link.

## What's not in it yet

- A patch and a lighting rig, which need somewhere in Session Hire to plan
  them.
- The Wi-Fi name and password, which only the box knows.
- A shared id on the Crewbox side (`crewboxEventId`): that's step 2's
  pairing, with the push.
