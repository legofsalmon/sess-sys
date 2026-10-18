# ADR 0045: The Crewbox show pack

- **Status:** accepted
- **Date:** 17 October 2026
- **Decides:** what goes in the files Session Hire makes for the Crewbox,
  in what layout, who can make them with crew numbers in, and where they
  are made. The layout itself is [crewbox-show-pack.md](../crewbox-show-pack.md).

## Context

Crewbox is the on-site box: chat, push-to-talk, running order, patch and
lighting, on the site's own Wi-Fi with no internet. The
[handoff](../research/crewbox-handoff.md) plans two steps. Step 1 is files
only, needing nothing from Crewbox but a running-order import: a patch CSV
and a lighting CSV in Crewbox's layouts if they were planned, a running
order CSV, and a printable crew list with the event PIN and the join QR
"generated from the box's `/connect` URL once the box is known". Step 2 is
a keyed push and pull, and needs four changes on the Crewbox side. The
roadmap puts step 1 last in Phase 3 and step 2 in Phase 5.

Most of a show pack is already in the app, worked out for the call sheet
([ADR 0021](0021-call-sheets.md)): the phase's days, venue and access
notes, the crew who said yes and their numbers, the contact on the day,
and the running order, which is the phase's notes. The kit and the
numbers of what's scanned out are on the job's pick list
([ADR 0017](0017-pick-lists-and-scanning-out-and-in.md)). There is no
patch or lighting rig anywhere in the app, and no import API on the
Crewbox side to write to, or its export layout to read, from here.

## Decision

1. **One .zip, made on the device, saved as a download.** Show pack is a
   card on each phase's call sheet (that phase) and on the job's page (the
   whole job: every phase, and crew asked for across them). It's made from
   the device's copy, as the call sheet is, so it works with no signal,
   and nothing is sent: the owner's standing rule holds, and step 1 needs
   nothing more. fflate, which the download of everything already uses,
   makes the zip in the browser.
2. **Eleven files, every one in every pack:** `manifest.json`,
   `event.json`, `crew.csv`, `crew-list.html`, `contacts.csv`,
   `running-order.csv`, `running-order.txt`, `kit.csv`, `patch.csv`,
   `lighting.csv` and `README.txt`. A file with nothing in it is still
   there, with its header, so a reader never wonders whether one went
   missing. The manifest names the format (`session-hire/show-pack`), its
   version (1), the app's build, the job and phases, whose numbers are in
   it, and every file with its kind and rows, so Crewbox can tell what it
   got. Every column is written down in
   [crewbox-show-pack.md](../crewbox-show-pack.md), the contract the
   Crewbox side is built to; a change to it puts the version up.
3. **The running order follows Crewbox's act.** `running-order.csv` has
   the timetable's own fields (`id, name, stage, date, start, end,
   changeover`) and the Session Hire phase id, as the handoff asks for
   re-pushes. They're read from the phase's notes, a line at a time: a
   line starting with a time is an act; a line that's only a day moves the
   lines after it to that day; notes with no day line on a phase of
   several days are the same order each day, as the call sheet reads them;
   `Stage: Main` names a stage. An end time is only what was written, and
   nothing else is made up. Lines that aren't acts stay in
   `running-order.txt`, the run of show as typed, with the crew calls by
   time; the README says how many were left out.
4. **The crew follow the call sheet's rules.** The pack is the crew
   chief's, so made by someone who can change crew and their bookings
   (the office, heads of department and directors, ADR 0034) it's the
   contact on the day's sheet: everyone who has said yes, with their
   numbers. Made by anyone else (the warehouse, staff crew), it's what the
   rest of the crew see: those confirmed, by name and role, and only the
   contact's number. Each row has what they go by, which is what they'd
   type joining the box, their role, department, call time, days and
   whether the office has confirmed them. Never anyone only offered, a
   client's contacts, an email but the office's, or a link.
5. **No money.** The pack is built from the call sheet and the kit, which
   carry no rate or price, and a test holds every file to it. A role that
   sees money and one that doesn't make the same pack.
6. **The kit is the pick list's.** Product, category, department, how
   many, how many subhired and from whom, how many are out now, and the
   Session Hire numbers of the items out. Items go out with a job, not a
   phase, so a phase's pack has the job's numbers for its products.
7. **Patch and lighting are empty templates, and say so.** The app holds
   neither, so each is a header row: plain patch columns, and
   Lightwright's names for the rig, both of which Crewbox's imports read
   (fuzzy headers; Lightwright, Eos, grandMA and Hog headers). The card,
   the README and the manifest (`template: true`) all say they're empty.
8. **The join QR, when the box is known.** The handoff defines it as the
   box's `/connect` page, which Session Hire can't know. So the card asks,
   behind a fold, for the box's address on the site's Wi-Fi and the event
   PIN, both optional. Given an address, the crew list starts with a QR
   code of `http://‹address›/connect`, the address written out and the PIN.
   An address that can't be one is said beside the field, and kept as
   typed. Neither is kept in the app: they're in the pack and nowhere
   else, until step 2 pairs a phase with a box.

## Considered

- **Leaving the join QR out** because the box's address isn't the app's
  to know. Rejected: the crew chief knows it when making the pack, and
  typing it once is cheaper than every crew member typing it on site.
- **Keeping the box's address and PIN on the phase.** Not yet. A PIN is
  the box's secret, and a stored one would sync to every device. Step 2's
  pairing (`crewboxEventId`) is where a box belongs to a phase.
- **Guessing patch rows from the audio kit, or rig rows from the lighting
  kit.** Rejected. Kit isn't a patch: twelve speakers say nothing about
  inputs, and a guessed sheet loaded on the box would be believed. Empty
  and said to be empty is honest.
- **A PDF crew list.** Rejected for now: the app prints through the
  browser, as the call sheet and quote do, and an HTML page prints, opens
  on any phone and holds the QR code as a drawing.
- **Putting the pack on the freelancer's link for the crew chief.** Not
  yet: their sheet already has the crew's numbers and the kit, and the
  box is loaded by whoever has the app.

## Consequences

- A crew chief can load the event, crew, running order and kit on the box
  from one download, in the warehouse or with no signal on site.
- The Crewbox side needs its running-order import to read
  `running-order.csv`, built to [crewbox-show-pack.md](../crewbox-show-pack.md).
  The crew list and patch and lighting templates load by hand, as today.
- The patch and lighting columns are a best reading of Crewbox's imports,
  not its export layout, which couldn't be read from here. They're checked
  against Crewbox's export before anyone relies on them, and changed with
  the format version if they differ.
- An act's id is its place in the phase's list, so editing the notes
  renumbers acts after the change. Fine for files loaded by hand; step 2's
  push wants a steadier id, which can come with it.
- A phase's pack has the job's scanned-out numbers. Telling them apart by
  phase would need scanning out by phase, which nobody has asked for.
