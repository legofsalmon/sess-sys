# ADR 0019: Made-up data, and starting fresh

- **Status:** Accepted, 30 September 2026.
- **Decides:** how the app can be tried with made-up data before the real
  jobs, crew and stock go in, and how it's all cleared afterwards, on the
  server and on every phone, without anything coming back.

## Context

The office won't have the stock list, crew lists or access to the real
calendars until the week of 5 October 2026. Until then, the only way to
try the app is with made-up data, and typing enough of it in by hand to
see a shortage, a clash or a pick list takes an afternoon. When the real
data goes in, the made-up data has to go, all of it, including what's in
the history.

That's harder than deleting rows. Every phone keeps its own copy of the
data and a list of changes it hasn't sent yet ([ADR 0001](0001-sync-engine.md)).
After the server is restored from a backup, a phone sends again what it
did lately, since the backup may have missed it
([ADR 0004](0004-backups.md)). After a clear-out, that would bring the
made-up data back. A phone also sends its changes before it asks for
what's new, so one that was out of signal would send its old changes
before it ever heard the app had been cleared.

Colly chose (30 September 2026) one Start fresh button that deletes
everything, rather than taking out only the made-up records: the made-up
data is mixed in with whatever was tried on top of it, and a clean start
is what's wanted before the real data goes in.

## Decision

- **Made-up data goes in from the Account tab**, into an empty app only:
  a few weeks of made-up jobs for five clients at five venues, eleven
  crew, and a small warehouse. It shows every part of the app: speakers
  short between two confirmed jobs, a quote that would leave the moving
  heads short, an LED wall hired in; crew booked, offered, countered and
  declined, a freelancer offered a second job on days they're booked (a check
  in the planner) and one on holidays; labelled items, amps in racks, kit
  still counted and a roll of label numbers set aside; pick lists for the
  jobs going out soon, and a job that's over with two speakers not back
  and one on the repair list.
- **It's all ordinary commands**, checked by the server's rules as a
  phone's would be, all at once or not at all. Its dates count from the
  day it goes in, so the jobs are always in the coming weeks. Every name
  is invented, emails are at example.com, and phone numbers (added for
  call sheets, [ADR 0021](0021-call-sheets.md)) are from the range Ofcom
  keeps for TV and radio drama, which never ring anyone, so nothing can
  reach a real person.
- **Every screen says "made-up data"** beside its name while it's in, on
  every phone, with no signal too: the server says so with every sync.
- **In the history**, each made-up change is shown as from "Made-up
  data", under the name of whoever put it in, with one entry saying who
  put it in and from which device.
- **Start fresh deletes everything but the staff accounts:** every job,
  person, product, item, scan and the history, made-up or not. It keeps
  who can sign in and their sessions, so nobody signs in again, and the
  server's own records of backups. Numbers start again from SH-000001.
  One entry is left in the history: who started fresh, from which device,
  and how many rows went.
- **It takes the words typed:** "delete everything". While the app holds
  made-up data the card is open; otherwise Start fresh is a link to open
  it, so it isn't in the way every day.
- **A backup first,** where backups are set up, and nothing is deleted if
  that backup fails. Without backups, the card says it can't be undone
  and suggests Download everything first.
- **Not while Google Calendar is connected.** The made-up jobs would go
  onto the real calendar, and deleting the jobs would leave their days on
  it. Disconnecting first takes the app's days off; then either can go
  ahead.
- **Every phone empties its copy, and drops what it had waiting.**
  Starting fresh begins a new copy of the data, as a restore does, marked
  as started fresh. A phone that hears of it empties its copy and, unlike
  after a restore, doesn't send again what it did before: that belonged
  to what was cleared. A phone that sends first, having been out of
  signal, says which copy its changes were made on; changes made on the
  copy before a fresh start are dropped unread, and the phone then finds
  out it's been cleared. Phones that are open empty within a second or
  two; the rest when next opened.

## Consequences

- The app can be tried in full on any phone before any real data exists,
  and as many times as wanted: start fresh, put the made-up data in again.
- Starting fresh can't be undone from the app. With backups on, the
  backup made first can be restored the usual way
  ([backups.md](../backups.md)).
- A phone on a version of the app from before this doesn't say which
  copy its changes were made on, so if it was offline across a fresh
  start it could send its old changes once. Phones update themselves on
  the next open, so this is only a phone left offline since before today.
- Start fresh stays on the Account tab after the real data is in, behind
  the typed words and the backup. If that feels too close to hand once
  the office uses the app every day, it can be limited to certain staff
  or taken away.
- The made-up data is code, kept to the server's rules by a test that
  puts it in and checks what each tab shows. A change to those rules that
  turns down a made-up command fails that test first.
