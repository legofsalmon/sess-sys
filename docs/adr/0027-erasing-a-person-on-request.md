# ADR 0027: Erasing a person's details on request

- **Status:** Accepted, 2 October 2026. Built before the real crew list
  goes in. Every choice below is a default: each is Colly's to change.
- **Decides:** how someone's details are erased when they ask (GDPR's
  right to erasure, Article 17), what is kept and why, where a person's
  details live and what erasing does to each place, and how a restore
  from a backup can never bring them back.

## Context

The real crew list (124 staff, freelancers and applicants) goes in
soon, and every office device holds every freelancer's phone, rate,
notes and private link. The audit
([P3](../audit-2026-09-30.md#p3-polish-or-later)) found that deletion on
request, one of the GDPR intentions in the
[architecture](../architecture.md#security-and-gdpr), wasn't built.
Archiving ([ADR 0023](0023-audit-round-two-the-loops.md)) takes a
leaver out of the way but keeps everything.

Three things make erasure harder here than deleting a row:

- **The change feed keeps every version of a record**
  ([ADR 0001](0001-sync-engine.md)). A new device's first sync pulls
  them all, so an old phone number would come back from a superseded
  row even after the person's own row was cleared.
- **The history keeps every command's arguments**
  ([ADR 0006](0006-audit-trail-and-export.md)): `person.upsert` holds
  the phone, email and notes as they were typed; a refusal's reason
  names the person.
- **Devices keep their own copy**, and what they sent lately, to send
  again after a restore ([ADR 0004](0004-backups.md)). And the backups
  themselves can't be edited.

The business must also keep some records: Revenue expects a business
to keep its records for six years, and erasure gives way to a legal
obligation (Article 17(3)(b)).

## Decision

### Where and when

- **From the person's card in Archived on the Crew tab, for someone
  already archived.** Archive first, then erase: two deliberate steps,
  so nobody is erased by a slip. "Erase details…" sits beside "Bring
  back".
- **Refused, in plain words, while anything about them is unsettled:**
  an offer or a booking on a job that hasn't ended ("Aoife Byrne is
  booked on Electric Picnic, which hasn't ended. Erase their details
  once it has, or release them first."); being the contact on the day
  for a phase that hasn't ended; a timesheet waiting for approval
  (approve it first, so their pay is on record under their name); and
  their Google account being the one that writes jobs to Google
  Calendar (connect another account first). The device checks the
  same before it sends, and both name the first of several by its first
  day, so they say the same words.
- **A question in place before it happens** (the app's `<Confirm>`,
  never the browser's): what will go, what is kept and why, that copies
  live on in the backups until they age out, and that it can't be
  undone.

### What goes

The person's phone, email, notes, skills, department, level (back to
the default, Level 1, which says nothing about them), the name they go
by, every certificate (the whole record, so kinds added later are
covered with no change here), the company they trade through with its
VAT and CRO numbers, their day rate, "can approve time off", their days
off, their staff leave (requests, days in lieu and allowances), their
private link (it then says the link doesn't work any more), their
calendar feed (it stops answering) and their staff account, if they sign
in. Their name becomes **"Erased person"**. They stay archived and can't
be brought back: once erased, nothing more is put on record about them
(below).

### What is kept, and why

- **Their name and their timesheets, for six years, when they have
  paid work on record.** An approved timesheet in the last six years
  means the business needs to show what it paid and to whom, so the
  name stays, the approved timesheets stay with their figures, and
  everything else still goes. The six years are whole years after the
  year of the latest approval, as Revenue counts from the end of the
  tax year: an approval in June 2026 keeps the name until 1 January
  2033. Their card says why the name is kept and the day it can go;
  from that day "Erase the name now" takes it, after asking in place,
  since that can't be undone either.
- **Bookings, offers and timesheets, as records of work**, pointing at
  the erased person: the job, the days and the rates. What the person
  wrote themselves goes: the note on each answer and on each timesheet.
  The office's own note on an approved timesheet stays with its
  figures.
- **Pointers to them from other people's records**, which now read
  "Erased person": the contact on the day of a phase that has ended,
  who decided someone else's leave, the staff account that made a
  change.
- **The register of electrical tests and thorough examinations** keeps
  "tested by" as it was typed: it is the register the law asks for,
  and it is text, not a link to the person.

### Everywhere a person lives

Found by searching every table, every module's schema, the change feed,
the history, the export, the backups, the device's copy and the browser
storage the app uses. Two files hold the lists, so anything new that
holds a person's details goes in one of them:

- `server/src/erasure/places.ts`: the tables, as `GONE` (deleted) and
  `STRIPPED` (kept, with what the person wrote cleared), and the
  person's own columns. A field added to a person fails to compile until
  that list and `erasedPerson` say what happens to it.
- `shared/src/erasure.ts`: `PERSON_COMMANDS`, every command that carries
  a person's details or puts something about them on record, with what
  of its arguments is kept and whether it is refused once they're
  erased; and `erasedPerson`, the person as erasing leaves them. The
  server and every device use the same list. A test fails for any
  command with a `personId` that isn't in it.

| Where | What erasing does |
| --- | --- |
| `people`, their row | Every field above cleared; the name "Erased person" or kept; a new random link secret, so the old link and feed address match nothing, and devices are sent none; archived. |
| `unavailability`, their days off | Deleted, approved leave's days with them. |
| `leave_requests`, `lieu_entries`, `leave_allowances` | Theirs deleted. Requests they decided for others keep them as the one who decided. |
| `offers`, their offers and bookings | Kept; their own note on each answer cleared. |
| `timesheets`, for their bookings | Kept with the figures; their own note cleared. |
| `phases.contact_id` | Kept; reads "Erased person". Refused while the phase hasn't ended. |
| `calendar_guests`, their address on Google Calendar invites | Past days' rows deleted. While invites are on, a day still to come keeps theirs until the calendar's next run (seconds later, or once it is reconnected) takes them off that day's event, as for any withdrawn offer, and that run removes the row: deleted first, the app would take them for a guest added by hand in Google and leave them on. The app only writes days from today on, so past events in Google keep their guest list as Google has it; Colly removes them there by hand if asked. |
| `calendar_link` | Refused while their account is the connected one. Its earlier copies in the change feed, and the history's "Connected Google Calendar as…", lose their address, and "connected by" names "Erased person". |
| `users` and `sessions`, if they sign in | Their accounts are the ones that sign in with an address on their record, now or before, so one made before they changed it is found too. Every session ended at once. The account's name becomes "Erased person", even while their name is kept with their timesheets, which is all Revenue needs; its email, picture and Google id go; it is switched off, so signing in again starts a new account, not this one. The history then calls them "Erased person" too. An address another person in the app still has (a second record for the same person, or a shared one) is left to them, account and all: erase that record too, and the last erasure takes it. |
| `changes`, the change feed | Every earlier copy of their person record becomes the erased one; earlier copies of their days off and leave become deletions; earlier copies of their offers and timesheets lose their notes. A new device's first sync finds nothing older. |
| `mutations`, the history | Each stored command about them keeps only what isn't about them (`PERSON_COMMANDS` in `shared/src/erasure.ts`): `person.upsert` keeps its id, kind and the name as it now is; `person.contact` says which details changed, never what to; days off keep no dates or note; answers and timesheets lose their notes; leave keeps no dates, notes or reasons. A decision on their leave that arrives after the erasure is still known to be about them, by the request that made it, so it is refused and kept without its reason. Every refusal's reason that named them names "Erased person" instead, as a whole name, so "Mary Kelly-Byrne" and "Seán Ó'Brien Smith" are left alone when "Mary Kelly" or "Brien Smith" is erased. Every email address and phone number on their record, now or before, goes from anything stored, as a whole address or number, so "jordan@gmail.com" and a rate of 1000000 are left alone when "dan@gmail.com" or "000000" goes; one another person in the app still has stays, as above. The device their link was used from is cleared. |
| The history's words | Read from the records as they are now, so they say "Erased person". The erasure itself says "Erased a person's details on request", with no name. |
| The export | Reads the tables, so it holds only what is left. The new `erasures` table says who was erased when, by id. |
| Every device | The erasure reaches each device first in the feed, before the records it changes. The device then sets aside anything waiting to send about them as a problem with the reason ("their details were erased on request"), and strips the same details from its problems and from what it remembers having sent, as the server does. The records themselves arrive erased. Its saved copy is one record, written whole, so the next save holds nothing older. |
| Backups | Can't be edited: see below. |

**Not in reach of the app**, and said in the confirm or here: messages
the office already sent by WhatsApp, text or email; Google Calendar's
past events; the office's own spreadsheet of the crew list (bring it
in again with them still on it and they are added afresh as someone
new); free text typed about them on other records, such as a job's
notes or a call's details, which the app can't tell from any other
words (the office edits those by hand); and a device that can no longer
sync, such as an erased member of staff's own phone, which keeps what
it had until it is wiped or someone signs in on it. Error reports and
the server's log never held their details (ADR 0005, ADR 0012).

### Erased means nothing more is recorded about them

Once erased, a command that would put something about them on record
again is refused ("This person's details were erased on request, so
nothing more can be recorded for them."): editing them, their contact
details, level or link, bringing them back, days off, offers and
answers, timesheets sent for them, and leave. Anything already waiting
on a device is refused the same way when it arrives, and is stored with
only what the rules above keep. What puts nothing new about them on
record still works: noting a decline, withdrawing or confirming an old
offer, reopening and approving a timesheet, and "Erase the name now".

### Backups, and a restore that never brings them back

- **Backups can't be edited.** They are kept every night for 35 days,
  then the first of each month for a year
  ([backups.md](../backups.md)), so erased details live on in backups
  until they age out: at most a year and a month. The confirm and this
  ADR say so plainly.
- **The list of erasures** is a table of its own, `erasures`: the
  person's id, when, and the day their name can go if it was kept. No
  name or other detail. It is backed up and exported like any table.
- **It is also kept beside the backups**, as `erasures/list.json` in the
  backup storage, written after each erasure (and when the server
  starts), and only ever added to: a list written from an older copy
  never drops a later entry. The restored database is new and empty, so
  this file is the only thing that knows what came after the backup.
- **With backups off, the list lives only in the database**, in its
  `erasures` table. The server says so in its log at every start, the
  Account tab's Backups card says so, and the confirm says where the
  list is kept. There is no backup to restore, but a wind-back with
  Neon's own history to before an erasure would bring that person back:
  `new-generation` then says to archive and erase them again by hand.
- **A restore applies it again.** After loading a backup, `RESTORE_FROM`
  and the `backup restore` command take the list from the storage, add
  the restored copy's own, and erase everyone on it again with the same
  decision about the name, before anyone can use the restored copy.
  The history records it ("Erased a person's details again, after the
  data was put back from a backup"). Someone the backup never had goes
  on the restored copy's list all the same. `backup new-generation`,
  which follows a wind-back with Neon's own history, does the same, and
  so does the server each time it starts, for anyone this copy has back.
- **Devices sending again after a restore can't undo it**: their edits
  are refused, as above, and stored stripped.

### Built as a module of its own

`server/src/erasure/` with its own version table
(`erasure_schema_version`), registered with the others and backed up
with them, so its tables never collide with the crew migrations. The
command `person.erase` carries only the person's id, and runs again to
take a kept name once its six years are up.

## Consequences

- Colly can say yes to an erasure request the same day, in two taps,
  once nothing about the person is unsettled. What is kept is said on
  their card, so the answer to the person can say it too.
- An erased person can't be restored by "Bring back". Someone who comes
  back to work is added again as someone new.
- Copies stay in the backups for up to a year and a month. That is the
  usual answer for backups that can't be edited, as long as a restore
  never brings the person back, which the list makes sure of.
- Staff leave records go with the rest, as asked. Irish working-time
  rules ask an employer to keep records of leave for three years, so
  Colly may want staff leave kept like timesheets: a change to
  `places.ts` and the confirm's words.
- The six years count from the end of the calendar year of the latest
  approval, which is later than the work itself, so they err on the
  safe side. If the accountant counts from the end of a company year
  that isn't the calendar year, it's one line in `shared/src/erasure.ts`.
- Two people with exactly the same name: a refusal's reason that named
  one, once erased, says "Erased person" for both. Reasons are words,
  with no id to tell them apart. The same goes for an account's name in
  earlier copies of the calendar connection's "connected by".
- Erasing someone rewrites their copies in the feed and searches the
  history's text, under the lock every change takes. On a year's data
  (300,000 changes, 150,000 history entries) that took about two and a
  half seconds on Postgres, while other changes waited.
- When sign-in, roles and scopes are switched on, personal details can
  move to tighter tables; the list of places moves with them.
