# ADR 0027: Erasing a person's details on request

- **Status:** Accepted, 2 October 2026. Built before the real crew list
  goes in. Every choice below is a default: each is Colly's to change.
  Amended the same day with Colly's answer on staff leave, which erasure
  had deleted at once: "Keep all records for the recommended
  timeframes." Staff leave is now kept for the three years the Working
  Time Act asks, and the name with it, and what is kept goes by itself
  on the day its time is up (below). Amended 3 October 2026: Colly
  confirmed that declined and cancelled leave is kept for the three
  years, as approved leave is, and that a name kept for records lasts
  exactly as long as they do. Leave years are now opened by the office,
  so no new leave record is for a year after next (below).
- **Amended:** 3 October 2026 by [ADR 0029](0029-documents.md): a
  person's documents go at once when they're erased, their files deleted
  from the storage straight after, and tried again each day until gone.
- **Amended:** 4 October 2026 by
  [ADR 0030](0030-stocktakes-and-rolling-counts.md): who counted a place
  or a case is a pointer to them, kept with the count, as the contact on
  the day is.
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

The business must also keep some records, and erasure gives way to a
legal obligation (Article 17(3)(b)): Revenue expects a business to keep
its records for six years (Taxes Consolidation Act 1997, section 886),
and the Organisation of Working Time Act 1997 (section 25), with the
Organisation of Working Time (Records) (Prescribed Form and Exemptions)
Regulations 2001, asks an employer to keep records of annual leave and
public holidays, and of working time, for three years.

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
  (approve it first, so their pay is on record under their name); leave
  or a day in lieu waiting for a decision (decide it on the Leave screen
  first: their leave is kept and nothing more can be decided for them,
  so it would sit in the approvers' queue for good); and their Google
  account being the one that writes jobs to Google Calendar (connect
  another account first). The device checks the same before it sends,
  and both name the first of several by its first day, so they say the
  same words.
- **A question in place before it happens** (the app's `<Confirm>`,
  never the browser's): what will go, what is kept and why, that copies
  live on in the backups until they age out, and that it can't be
  undone.

### What goes

The person's phone, email, notes, skills, department, level (back to
the default, Level 1, which says nothing about them), the name they go
by, every certificate (the whole record, so kinds added later, as Safe
Pass, working at height and IPAF were, go with no change here), the
company they trade through with its VAT and CRO numbers, their day rate,
"can approve time off", their days off (approved leave's among them: the
request is the record of the leave), the notes and reasons on their
staff leave, and any of their staff leave whose three years are up, what
they said on their link about running late
([ADR 0028](0028-certificates-a-call-needs-and-running-late.md)), their
private link (it then says the link doesn't work any more), their
calendar feed (it stops answering) and their staff account, if they sign
in. Their name becomes **"Erased person"**, unless a record kept below
needs it. They stay archived and can't be brought back: once erased,
nothing more is put on record about them (below).

### What is kept, and why

- **Their name and their timesheets, for six years, when they have
  paid work on record.** An approved timesheet in the last six years
  means the business needs to show what it paid and to whom, so the
  name stays, the approved timesheets stay with their figures, and
  everything else still goes. The six years are whole years after the
  year of the latest approval, as Revenue counts from the end of the
  tax year: an approval in June 2026 keeps the name until 1 January
  2033.
- **Their staff leave, for three years, and their name with it.**
  Colly's decision, 2 October 2026: "Keep all records for the
  recommended timeframes." Their leave requests, days in lieu and
  allowances stay for three whole years after the end of the year each
  belongs to (a request by the year of its last day, a day in lieu by
  the year of the day worked, an allowance by its year), counted like
  the timesheets' six, which is on the safe side of "three years from
  when it was made": leave in 2026 is kept until 1 January 2030. Each
  keeps what makes it a record (whose, what, the dates and days, its
  status, who decided it and when, and an allowance's year, days and
  days carried over) and loses what anyone wrote in it: the person's
  note, the approver's reason and the allowance's note. Leave whose
  three years are already up goes at once, and so does a request or a
  day in lieu still waiting for a decision, which records no leave
  (erasing is refused while one waits, but a restore can bring one back
  from before it was decided). A record has to say whose it is, so the
  name stays as long as any of it does.
- **The day the name can go** is the later of the two: the day their
  pay records can go and the day the last of their leave records can.
  The server and every device work it out with the same rule
  (`nameKept` in `shared/src/erasure.ts`), from the same records. Their
  card says why the name is kept (their pay records for Revenue, their
  leave records under the Working Time Act, or both) and the day the
  app erases it.
- **Each goes on its day, by itself.** The server looks at start and
  then once each day in Ireland (`server/src/erasure/due.ts`): a leave
  record whose three years are up is deleted, and a name whose day has
  come is erased, with any leave records left. Nobody has to remember:
  keeping a record past its timeframe has no legal reason, and GDPR's
  storage limitation applies. The name goes the same way rather than
  waiting for the office to press a button, as it did before this
  amendment: the person has already asked for it to go, and only the
  records kept it; a button pressed years later is one somebody has to
  remember. Each run is a
  change of its own in the history, as the server's, with no name
  ("Deleted an erased person's leave records whose three years were
  up", "Erased the name kept with a person's records, as the law no
  longer asks for it"); devices are told at once, and the list beside
  the backups is kept up to date. Each person is looked at again under
  the lock every change takes, so a run twice in a day, or on two copies
  of the server at the same moment, does it once.
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

### How long records are kept

The years are whole years after the end of the year a record belongs
to: one constant each in `shared/src/erasure.ts` (`PAID_WORK_YEARS`,
`LEAVE_RECORD_YEARS`).

| Record | How long | Why | Kept | Goes |
| --- | --- | --- | --- | --- |
| Approved timesheets | Under their name for six years after the year of the latest approval; then under "Erased person", as records of work | Revenue: Taxes Consolidation Act 1997, section 886 | The days, rate, extras, the approval, and the office's note | The person's own note |
| Leave requests, decided or cancelled | Three years after the year of the request's last day | Organisation of Working Time Act 1997, section 25, and the Organisation of Working Time (Records) (Prescribed Form and Exemptions) Regulations 2001 | Type, dates, days, status, when it was asked for, who decided it and when | The person's note and the approver's reason |
| Days in lieu, decided or cancelled | Three years after the year of the day worked | The same | The day, how many days, status, who decided it and when | The person's note and the approver's reason |
| Leave allowances | Three years after their year | The same | The year, the days and the days carried over | The note |
| A request or a day in lieu still waiting for a decision | Not kept | It records no leave, and nothing more can be decided for them | Nothing | All of it, at once |
| Their name | Until the later of the above can go | A record has to say whose it is | The name, on their person (never on their staff account) | Everything else on their person, at once |
| Bookings and offers | No end set, like the jobs they belong to | Records of the business's work | The job, the days, the rates and the answer | The person's note on each answer |
| Contact details, notes, skills, certificates, company details, day rate, days off (approved leave's too), running late | Not kept | No law asks for them | Nothing | All of it, at once |
| Running late, anyone's, erased or not ([ADR 0028](0028-certificates-a-call-needs-and-running-late.md)) | 30 days after its day; at once when they're erased | No law asks for it, and it holds their own words; a month covers their timesheet for the day | In the history: who, how late, the job and the day | The record, every copy in the change feed, and the note in the history |
| Documents and their files ([ADR 0029](0029-documents.md)) | Not kept | No law asks for them | Nothing | The details at once; the files from the storage straight after, through the list of files to delete, tried again after each change and each day until they've gone |
| Counts of places and cases, who counted ([ADR 0030](0030-stocktakes-and-rolling-counts.md)) | No end set, like the warehouse records they are | A count is the business's record of what was on the shelf, not the person's, and no law asks for the counter's name | The count, and who counted as a pointer to them, reading "Erased person" (or their name while it's kept for their records) | Nothing; a count arriving after the erasure that names them is kept with nobody named |

Each kept for years goes on the day its time is up, always a 1 January:
at once when the person is erased, if that day has passed, and otherwise
when the server looks that day. Running late goes on the server's same
daily look.

A leave record for a year typed far ahead would have kept the name for
three years after that year. Since 3 October 2026 no new one can be
([ADR 0024](0024-staff-leave.md), amended): leave is asked for only in a
year the office has opened, and no year after next is ever open; an
allowance is set only for this year or next; and a day in lieu is for a
day already worked. Nothing in erasing looks at whether a year is open:
what is kept, anything typed further ahead before then included, stays
and goes on its day either way.

### Everywhere a person lives

Found by searching every table, every module's schema, the change feed,
the history, the export, the backups, the device's copy and the browser
storage the app uses. Two files hold the lists, so anything new that
holds a person's details goes in one of them:

- `server/src/erasure/places.ts`: the tables, as `GONE` (deleted),
  `STRIPPED` (kept, with what the person wrote cleared) and `LEAVE`
  (kept like `STRIPPED` for three years, then deleted like `GONE` by the
  daily run in `due.ts`), and the person's own columns. A field added
  to a person fails to compile until that list and `erasedPerson` say
  what happens to it.
- `shared/src/erasure.ts`: `PERSON_COMMANDS`, every command that carries
  a person's details or puts something about them on record, with what
  of its arguments is kept and whether it is refused once they're
  erased; and `erasedPerson`, the person as erasing leaves them. The
  server and every device use the same list. A test fails for any
  command with a `personId` that isn't in it.

| Where | What erasing does |
| --- | --- |
| `people`, their row | Every field above cleared; the name "Erased person" or kept; a new random link secret, so the old link and feed address match nothing, and devices are sent none; archived. |
| `unavailability`, their days off | Deleted, approved leave's days with them: the request is the record of the leave. |
| `documents`, their documents ([ADR 0029](0029-documents.md)) | Deleted, every earlier copy in the change feed made a deletion; each file put on `document_files_to_delete` in the same change, and deleted from the storage straight after. One the storage won't delete stays on that list with why, and is tried again after the next change and each day until it goes. The history's commands and actions about them keep only which document and what kind. |
| `running_late`, what they said on their link about running late ([ADR 0028](0028-certificates-a-call-needs-and-running-late.md)) | Deleted, before anything else, as its rows point at their offers and calls. The office's queue, the call's line, the planner and the contact on the day's call sheet lose the note with it. |
| `leave_requests`, `lieu_entries`, `leave_allowances` | Theirs kept for three years after the year each belongs to, without the note, the approver's reason or the allowance's note; deleted by the server on the day those years are up, or when the name goes, and at once if still waiting for a decision. Refused while any of it waits for a decision. Requests they decided for others keep them as the one who decided. |
| `offers`, their offers and bookings | Kept; their own note on each answer cleared. |
| `timesheets`, for their bookings | Kept with the figures; their own note cleared. |
| `phases.contact_id` | Kept; reads "Erased person". Refused while the phase hasn't ended. |
| `counts.counted_by`, who counted a place or a case ([ADR 0030](0030-stocktakes-and-rolling-counts.md)) | Kept; reads "Erased person", or the name while it's kept. Listed with the other pointers from records that aren't theirs in `POINTERS`; a test checks every column with a foreign key to `people` is in one of erasure's lists. A count sent afterwards that names them is kept with nobody named. |
| `calendar_guests`, their address on Google Calendar invites | Past days' rows deleted. While invites are on, a day still to come keeps theirs until the calendar's next run (seconds later, or once it is reconnected) takes them off that day's event, as for any withdrawn offer, and that run removes the row: deleted first, the app would take them for a guest added by hand in Google and leave them on. The app only writes days from today on, so past events in Google keep their guest list as Google has it; Colly removes them there by hand if asked. |
| `calendar_link` | Refused while their account is the connected one. Its earlier copies in the change feed, and the history's "Connected Google Calendar as…", lose their address, and "connected by" names "Erased person". |
| `users` and `sessions`, if they sign in | Their accounts are the ones that sign in with an address on their record, now or before, so one made before they changed it is found too. Every session ended at once. The account's name becomes "Erased person", even while their name is kept with their timesheets or leave, which only need it on their person; its email, picture and Google id go; it is switched off, so signing in again starts a new account, not this one. The history then calls them "Erased person" too. An address another person in the app still has (a second record for the same person, or a shared one) is left to them, account and all: erase that record too, and the last erasure takes it. |
| `changes`, the change feed | Every earlier copy of their person record becomes the erased one; earlier copies of their days off, running late and leave that goes become deletions; earlier copies of their offers and timesheets lose their notes, and of their leave that is kept, its notes and reasons. A new device's first sync finds nothing older. |
| `mutations`, the history | Each stored command about them keeps only what isn't about them (`PERSON_COMMANDS` in `shared/src/erasure.ts`): `person.upsert` keeps its id, kind and the name as it now is; `person.contact` says which details changed, never what to; days off keep no dates or note; answers, timesheets and running late lose their notes, running late keeping its booking and day; saying they're there, and the office noting it, carry only the record's id, so once it has gone they are refused as not found and keep nothing about them; leave keeps no dates, notes, reasons or figures, as before Colly's decision: a request or a day in lieu that is kept has its own dates and days, which the history's words read from it, and an allowance holds only its latest figures, so the history needs none. A decision on their leave that arrives after the erasure is still known to be about them, by the request (or, once it has gone, by the command that made it), so it is refused and kept without its reason. Every refusal's reason that named them names "Erased person" instead, as a whole name, so "Mary Kelly-Byrne" and "Seán Ó'Brien Smith" are left alone when "Mary Kelly" or "Brien Smith" is erased. Every email address and phone number on their record, now or before, goes from anything stored, as a whole address or number, so "jordan@gmail.com" and a rate of 1000000 are left alone when "dan@gmail.com" or "000000" goes; one another person in the app still has stays, as above. The device their link was used from is cleared. |
| The history's words | Read from the records as they are now, so they say "Erased person", or the name while it is kept, and the dates of leave that is kept. The erasure itself says "Erased a person's details on request", with no name. |
| The export | Reads the tables, so it holds only what is left. The new `erasures` table says who was erased when, by id. |
| Every device | The erasure reaches each device first in the feed, before the records it changes. The device then sets aside anything waiting to send about them as a problem with the reason ("their details were erased on request"), and strips the same details from its problems and from what it remembers having sent, as the server does. The records themselves arrive erased. An erasure still to send shows them erased at once, their running late gone from every screen with it and their leave as the server will leave it. Its saved copy is one record, written whole, so the next save holds nothing older. |
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
offer, reopening and approving a timesheet, and the erasure sent again
(from a device after a restore, say), which on or after the name's day
takes it, as the server does by itself that day.

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
  Their leave comes back from the backup with its words and is decided
  again by the same three years, counted to the day of the restore:
  what is kept loses its words again, and what is past its three years,
  still waits for a decision, or was kept for a name that has since
  gone, goes. Anything whose day has come since the backup was made
  goes when the server starts on the restored copy, as on any day. The
  history records it ("Erased a person's details again, after the data
  was put back from a backup"). Someone the backup never had goes
  on the restored copy's list all the same. `backup new-generation`,
  which follows a wind-back with Neon's own history, does the same, and
  so does the server each time it starts, for anyone this copy has back.
- **Devices sending again after a restore can't undo it**: their edits
  are refused, as above, and stored stripped.

### Built as a module of its own

`server/src/erasure/` with its own version table
(`erasure_schema_version`), registered with the others and backed up
with them, so its tables never collide with the crew migrations. The
command `person.erase` carries only the person's id. What it keeps is
taken on its day by `server/src/erasure/due.ts`, which the server starts
with the rest (`server/src/index.ts`) as a server change of its own,
`person.erase-due` in the history.

### Made-up data

Rónán Moran, a freelancer who has left and asked for his details to go,
is archived with nothing unsettled, so erasing someone can be tried on
the made-up data ([ADR 0019](0019-made-up-data-and-starting-fresh.md)).
Starting fresh empties the `erasures` table with the rest; the list kept
beside the backups stays, as it only ever grows, and names nobody the
fresh copy has.

## Consequences

- Colly can say yes to an erasure request the same day, in two taps,
  once nothing about the person is unsettled. What is kept is said on
  their card, so the answer to the person can say it too.
- An erased person can't be restored by "Bring back". Someone who comes
  back to work is added again as someone new.
- Copies stay in the backups for up to a year and a month. That is the
  usual answer for backups that can't be edited, as long as a restore
  never brings the person back, which the list makes sure of.
- Staff leave is kept for three years, as Colly decided on 2 October
  2026, and so a member of staff with leave in the last three years
  keeps their name on their person for that long, even with no pay on
  record. The confirm moves staff leave from what goes to what is kept,
  saying until when and why, only for someone with leave records that
  stay.
- Leave still waiting for a decision now stops an erasure, one step more
  for the office: once erased, nothing more can be decided for them, and
  a request kept as waiting would sit in the approvers' queue for good.
  For someone archived the decision is a decline, since approving is
  refused for anyone who has left; to approve it, bring them back first.
- What erasing keeps goes by itself on its day, the name included, so
  nobody has to remember, and "Erase the name now" is gone from the
  card, which says the day instead. The server looks once each day in
  Ireland, within the hour after midnight (it checks each hour, but goes
  to the database only on a new day, so it never keeps the database
  awake); a server that was down that day does it when it next starts.
  A name decided once stands: the daily run takes it on the day decided,
  and never moves that day.
- The six years, and the three, count from the end of the calendar year
  a record belongs to, which is later than the record itself, so they
  err on the safe side. If the accountant counts from the end of a
  company year that isn't the calendar year, it's one line in
  `shared/src/erasure.ts`.
- An erasure made before Colly's decision deleted that person's leave.
  A restore of a backup from before it would now keep that leave,
  without its words, if its three years aren't up and the name was kept
  for Revenue; if the name went, the leave goes with it. Both changes
  came the same day, before the real crew list went in, so only an
  erasure tried on made-up data could be one of these.
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
