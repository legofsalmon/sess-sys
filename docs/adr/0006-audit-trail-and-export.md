# ADR 0006: The history of every change, and an export of everything

- **Status:** Accepted, 29 September 2026. Built and on; nothing to set up.
- **Decides:** what the app records about each change, how people read it,
  and what "export everything" gives the company.
- **Amended:** 2 October 2026 by the [audit](../audit-2026-09-30.md), finding
  20: fetching the export writes nothing. The app records the download in
  the history with a post as it asks for the file, so an address opened on
  its own (a link checked by a browser, say) never puts a download in the
  history; a script's download is recorded only if it posts too.
- **Amended:** 2 October 2026, from the audit's P3 list: the History tab
  is grouped, so a busy morning reads as a few lines. Entries go under
  the Irish day the server took them on ("Today", "Yesterday",
  "Thursday 1 October"), so a day never comes round twice, even when a
  change made offline at night arrives in the morning; it still says
  when it was made. Within a day, one person's changes one after
  another, with nobody else's between and no gap of more than an hour,
  are one line ("Colly Hewson, 14 changes, 09:12 to 09:40") that opens
  on a tap. A single change stays a line of its own, and one the server
  turned down stays in view under its line. While there are no names
  (sign-in off, when every change was "Someone"), a run is a device's
  ("Device c0ffee"), and the top of the tab says once why ("Names show
  once sign-in is on") instead of "Someone" on every line. The days and
  runs are worked out afresh from every page loaded, so "Show older"
  joins up a day or a run that a page cut in two. The export's
  `history.csv` is as it was, a line per change.
- **Amended:** 2 October 2026 by [ADR 0027](0027-erasing-a-person-on-request.md):
  erasing a person on request strips their details from the commands the
  history keeps (and from any about them that arrive later), and refusals
  that named them name "Erased person". The history still says what was
  done and when, of "Erased person" rather than by name.

## Context

The architecture promises that everything carries an audit trail ("who
changed what, when, from which device, and whether it was made offline"),
and that the company can take a full copy of its data any time, so it is
never locked in, which is a common complaint about Rentman and the others.

Much of the audit trail was there from the start
([ADR 0001](0001-sync-engine.md)). Every change anyone asks for is kept, with
who asked ([ADR 0003](0003-staff-sign-in.md)), the time on their device, the
time it reached the server, and the server's answer, including a refusal and
its reason; a separate feed keeps every change that followed. But:

- "which device" was only a random code;
- "made offline" could only be guessed from the device's time against the
  server's, and a phone's clock can be minutes or days out;
- nobody could read any of it without a database tool;
- the export was a single JSON file for programmers, from a list of tables
  written by hand, and it included the secrets in freelancers' private
  links.

## Decision

- **The history is the record the server already keeps of every change
  asked for.** One entry per thing a person did, in the order the server
  took them, with no second log to keep in step. It also holds what the
  server turned down, and why, and each download of everything.
- **Which device.** Each change records the kind of device it came from,
  such as "Safari on iPhone", worked out from what the browser says about
  itself. Only that short description is kept, not the full browser string,
  which says more than the history needs. The app's own device code, shown on
  the Account tab, is kept as before.
- **Whether it was made offline.** Each time a device sends its waiting
  changes it now says when they left, by its own clock. How long a change
  waited on the device is then the gap between two readings of the same
  clock, which is right even on a phone whose clock is wrong, and the time
  the change was made is placed on the server's clock: when it arrived, less
  the wait. A change that waited a minute or more is marked as made offline,
  with how much later it arrived. Changes sent by versions of the app from
  before this, which don't say when they left, have no offline mark.
- **Freelancers' own answers** (from their private link) are recorded as
  theirs, "on their private link", with their device too.
- **A History tab for staff.** Newest first, 50 at a time, with a choice of
  person. Each entry says in words what was done ("Booked 4 × d&b Y10P for
  Electric Picnic, Fri 2 Oct to Sun 4 Oct"), who did it, from which device,
  when, whether it was made offline, and if the server turned it down, why.
  The words are written by the server, from the entry and the names things
  have today, so the app and the export say the same. The history stays on
  the server rather than being copied to every phone, so reading it needs
  signal.
- **Download everything.** One button on the Account tab gives one ZIP file:
  - `README.txt`: when it was made and by whom, what each file holds, how
    many rows, and what was left out;
  - `history.csv`: the history in words, as the History tab shows it;
  - `tables/*.csv`: one spreadsheet per table, which opens straight in Excel
    with names like Seán intact, times in Irish time and money in cents;
  - `everything.json`: every table exactly, times in UTC to the microsecond,
    for moving the data to another system.

  Every table is included without anyone listing it, found the way backups
  find them ([ADR 0004](0004-backups.md)), so warehouse and finance tables
  will be in the export from their first day. Everything is read at one
  moment, so the files agree with each other.
- **Left out of the export on purpose:** the secrets in freelancers' private
  links, old and current, and sign-in sessions. Whoever held the file could
  otherwise act as that person. Also the server's own bookkeeping (schema
  versions, which copy of the data this is). Freelancers can already
  download their own data from their link.
- **The file holds everyone's details, so each download is recorded in the
  history**: who took a copy, when, and on what device. Any signed-in member
  of staff can download it for now; when roles arrive, it becomes owners
  only.
- **Spreadsheet safety.** A cell that begins with `=`, `+`, `-` or `@`
  could run as a formula when opened in Excel, and some of the text comes
  from freelancers' own notes, so such a cell gets a `'` in front in the CSV
  files. Phone numbers and plain numbers are left alone. `everything.json`
  keeps every value exactly.
- `/api/export` stays for scripts, as JSON with the same tables and the
  same secrets left out, and is recorded in the history the same way.

## Consequences

- The history grows with every change, perhaps 100,000 entries a year at full
  use. That is small for Postgres, and the History tab reads 50 at a time.
- The export is built in memory, a few megabytes today. If it reaches tens
  of megabytes it should be streamed instead, as the backups note too.
- A device's description is a best guess: an iPad can say it is a Mac, and a
  browser that hides what it is shows as an unknown device.
- The history uses today's names: renaming a product renames it in old
  entries too. What each entry did (the quantity, the dates, the answer)
  is as it was.
- The history keeps people's details as they were typed. Deleting a person
  on request will also have to blank them in the history and the change
  feed; that is part of the GDPR work due before real crew data goes in.
- The export is for reading and for moving elsewhere. To put the system
  back as it was, use a backup ([ADR 0004](0004-backups.md)), which keeps
  the link secrets this file leaves out, so freelancers' links keep working.
