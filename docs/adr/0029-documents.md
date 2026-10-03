# ADR 0029: Documents, and reminders when they run out

- **Status:** Accepted, 3 October 2026. Built in the fifth round, after
  the certificates a call needs
  ([ADR 0028](0028-certificates-a-call-needs-and-running-late.md)).
- **Decides:** what a person's documents are, where their files are kept
  and who can read them, how a freelancer sends a new one from their
  private link and the office checks it, how a document's expiry joins
  the reminders, and what erasing, backups and the export do with them.

## Context

The roadmap's Phase 3 has "documents uploaded with expiry reminders
(later)", and the architecture promises freelancers they "enter things
once": certificates, insurance and the like "uploaded once and kept up to
date by expiry reminders, not re-asked per job".

Freelancers and staff carry papers the office has to see and keep
current: public liability insurance, a Safe Pass, IPAF and working at
height cards, manual handling and first aid certificates, a driving
licence. Certificates are already recorded on the person as held, not
held or unknown, with an expiry ([ADR 0025](0025-crew-profiles-and-bringing-in-the-list.md),
[ADR 0028](0028-certificates-a-call-needs-and-running-late.md)), and the
Crew tab lists those running out in the next 30 days. What's missing is
the evidence (a photo of the card, the insurance schedule as a PDF), and
an expiry for what isn't a certificate, such as insurance. ADR 0028 left
"a freelancer uploading a photo of their renewed card from their link,
which needs file storage" for later.

There is storage: the backups' bucket ([ADR 0004](0004-backups.md)),
private, with `BACKUP_KEY` to encrypt what goes in it. The live server
has no bucket yet. A file is personal data of a kind the crew list isn't:
a driving licence has a date of birth and an address on it.

## Decision

### A person's documents

A **document** is one record per paper: whose it is, what kind, a title,
the day it runs out if it does, and a file if there is one.

- **Kinds:** `insurance`, each certificate kind of ADR 0028 (`first-aid`,
  `manual-handling`, `driving-licence`, `safe-pass`, `working-at-height`,
  `ipaf`), and `other`. The shared schema's list is the only gate, as for
  certificates, so a new kind needs no migration.
- **Title:** up to 100 characters, filled in from the kind ("Public
  liability insurance", "IPAF card", "Safe Pass card") and changed if
  wanted; one for `other` is typed.
- **Runs out:** a day, or none.
- **File:** its type (PDF, JPEG, PNG, WebP or HEIC) and size, and when it
  was put there. Never its name: that comes from someone's phone.
- **Sent from their link, waiting to be checked:** when, and when the
  office checked it. The office's own are checked as they're added.
- **Renews:** the document a freelancer's renewal replaces.

It's a table of its own, `documents`, in a module of its own
(`server/src/documents/`, version table `documents_schema_version`), so
its migrations never collide with the crew module's. Devices hold the
details, synced like any record (`document`); never the files, and never
where a file is kept. A file opens with signal.

### One date for a certificate

Where a document is a certificate's card, the certificate on the person
stays the one record the app acts on: offers, the picker, the call's
warnings and the reminders all read it, as before. The card is the
evidence for it, so it holds no date of its own once it's in:

- adding or changing a certificate's card on the person's card sets that
  certificate to held, running out on the day typed, which the form
  starts at the day the certificate already has;
- a card a freelancer sends from their link carries the day they typed,
  only while it waits to be checked; checking it sets the certificate to
  that day (the office can correct it first), and the card's own day is
  cleared.

Everywhere a checked card is shown, its day is read from the certificate
on the person, so the two can never drift apart. Insurance and other documents
keep their own day.

### On the person's card (the office)

Under the certificates, each document on a line: the title, when it runs
out (in the warn tone within 30 days, the bad tone once run out, as the
certificates), the file's type and size, and "waiting for you to check"
for one sent from their link. **Open** downloads the file; **Change**
opens the form for its details and a new file; **Remove** asks first, in
place: the file is deleted too. **Add document** opens the form: kind,
title, runs out, and the file, with a line for a certificate's card
saying what saving it does to the certificate. With no file chosen, the details go
through the outbox like any change, and work with no signal. With a file,
it goes straight to the server and needs signal, saying so.

### From their private link (the freelancer)

A "Your documents" section lists theirs: the title, when it runs out,
"with the office to check" until it's checked, and **View the file**.
Each has "Send a new one" folded under it (the day it runs out, and the
file), and "Send something else" folds a form with the kind and title
too. The page has no script, so these are ordinary forms that post the
file. What they sent is checked by the office before it counts: a link
can say what it likes, and the record is the office's
([ADR 0028](0028-certificates-a-call-needs-and-running-late.md)).

### The office checks it

A document sent from a link waits in "Answers to check" on the Crew tab
("Pádraig Kenny sent a renewed IPAF card"), counted on the Crew badge, since
someone sent the office something that waits on it now. The row says
when it runs out and the file's type and size, with **Open**, the day it
runs out as a field to correct, **Checked**, and **Not right** (removed
after a question in place; the office asks them again itself). For a
certificate's card the row says what checking does ("Checking it sets
Pádraig's IPAF to run out on Thu 3 Nov 2027"). Checking a renewal
removes the one it renews, file and all, so the list keeps one of each.

### Reminders

A document's expiry joins the certificates in the one list on the Crew
tab, now headed "Running out (6)": run out, or running out in the next
30 days, soonest first, for everyone not archived. A certificate's card
adds no line of its own, since the certificate already has one, and a
document a renewal waiting to be checked replaces is left out. Each
document line has **Ask for the new one**, opening the same Send panel
with a message written for it ("Hi Dara, our records say your public
liability insurance runs out on 18 October. When you've renewed it,
could you send us the new one? …"). Once files are on, every such
message (certificates' too) ends with where to send it: their own page.

### Storage

- **The backups' bucket, under `documents/`, never public.** Each file is
  `documents/<id>`, the id a fresh random one the server makes, so
  nothing in the name says whose it is, and a replaced file never shares
  a name with the one before. The app's own prefix: nothing else should
  be put there.
- **Encrypted with `BACKUP_KEY`** when it's set, in the backups' own
  format (AES-256-GCM, `server/src/backup/crypto.ts`). A file stored
  encrypted needs the key to open; one stored before the key was set
  stays plain and still opens.
- **Locally and in tests, a folder**, as for backups: the backups' folder
  (`BACKUP_DIR`) when there is one, or `DOCUMENTS_DIR` for documents
  alone, which the browser tests use so their server has documents but
  no backups.
- **No bucket yet on the live server.** Details and expiry dates are
  recorded all the same, so reminders work now. Adding a file says
  plainly that files wait on the storage bucket being set up, naming the
  four Railway variables (`BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`,
  `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, as in
  [backups.md](../backups.md)); the person's card says so before anyone
  tries, and the link page says sending documents isn't switched on yet,
  to send a photo to the office another way for now.

### Reading a file

Files are read only through the server: the office with its session
(`GET /api/documents/:id/file`, under sign-in like the rest of the API),
and a freelancer through their own link (`GET /f/:token/documents/:id`),
which finds only that person's documents: another person's id is "not
found", the same as one that doesn't exist. Every file goes out with
`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, the
type the server found in it, `Cache-Control: no-store`, and a
`Content-Security-Policy` (`default-src 'none'; sandbox`) that lets it
load and run nothing should a browser show it anyway: a PDF or a photo
can carry a web page after its first bytes. Its name is the person's
name and the title ("Pádraig Kenny - IPAF card.pdf"), made safe for a
file name and cut at 120 whole characters.

### What a file may be

- **Checked by its first bytes, never its name or the type the browser
  says:** PDF (`%PDF-`), JPEG, PNG, WebP, and HEIC, which is what an
  iPhone takes photos in. The same shared check runs on the office's
  device before it sends, so a refusal is said in place.
- **Refused:** anything else, and said apart, SVG and HTML, which a
  browser can run code from ("That file is a web page or a drawing
  (SVG)…").
- **Up to 10 MB.** The upload routes take up to 10 MB and a little over
  for the form, above the 5 MB the rest of the server takes; a file over
  10 MB is refused in words. The office's device says so before sending
  anything.

### How a file is sent

The app sends the file as the request's whole body (`POST
/api/documents/:id/file`), with the details in the address, so it needs
no form encoding and no library. The link page has no script, so its
form posts `multipart/form-data`, the only way a plain form sends a file,
to `POST /f/:token/documents`. Anyone can post to an address, so the
link is looked up before the body is read: a link that doesn't exist, or
a server with nowhere to keep files, never has 10 MB read for it. The
server reads that form itself (`server/src/documents/form.ts`): the body
is already capped and in memory, and the reader takes only what the
page's own form sends (a few short fields and one file), ignoring the
file's name. `@fastify/multipart` was the other choice: a dependency to
install, audit and keep up to date, streaming the server doesn't need at
10 MB, for one form. A whole request has five minutes to arrive, on every
route (`REQUEST_TIMEOUT_MS` in `server/src/app.ts`): long enough for a
10 MB photo on a poor signal, and someone sending a post a byte at a time
can't hold a connection open for ever.

### Commands and server actions

What can be done offline is a command, through the outbox like any
other; what carries a file is a server action, done at once with signal
and recorded in the history the same way.

- `document.save`: add a document's details with no file, or change
  them. For a certificate's card, it also sets the certificate.
- `document.check`: the office checked one sent from a link, with the
  day it runs out as checked.
- `document.remove`: the details go, and the file is deleted.
- `document.file` (a server action): the office puts a file on a
  document, adding the document with it when it's new, or replacing the
  one it had.
- `document.send` (a server action, on the person's link): a freelancer
  sends a new document, or a renewal of one they have.

Adding to someone archived is refused ("bring them back first"), as for
a level; removing isn't. Once erased, nothing more is recorded for them
([ADR 0027](0027-erasing-a-person-on-request.md)).

**History:** "Saved Pádraig Kenny's IPAF card, with their IPAF running
out on Thu 3 Nov 2027"; "Added Dara Quinn's public liability insurance,
with its file (PDF, 240 KB)"; "Put a new file on …"; "Pádraig Kenny sent
a renewed IPAF card, running out Sat 3 Nov 2029 (JPEG, 1.2 MB)", as his
on his private link; "Checked Pádraig Kenny's IPAF card, in place of the
one before, and set their IPAF to run out on Sat 3 Nov 2029"; "Removed
Pádraig Kenny's IPAF card". A title reads in lower case mid-sentence
only where it's one the app gave ("public liability insurance"); one
typed keeps its capitals, as they may be a name.

### Deleting files, never silently

A file is put on a list of files to delete (`document_files_to_delete`)
before it's written to the storage, and taken off that list in the same
change that puts it on a document. Removing or replacing a document, or
erasing its person, puts the old file back on the list in the same
change. The server deletes what's on the list straight after each change,
and again once a day (it looks every hour, but goes to the database only
on a new Irish day, as the erasures' daily look does). A file it can't
delete stays on the list with why, the server's log says how many, and
it's tried again after the next change and the next day, until it goes.
An upload that never finished stays on the list an hour (so one under
way isn't touched), then goes the same way. Starting fresh puts every
document's file on the list before it deletes the rest, and keeps the
list.

Once a day the server also counts files under `documents/` that neither
a document nor the list knows, such as documents added after the backup
a restore came from, and says how many in its log. It doesn't delete
them: a server pointed at the bucket by mistake (a restore drill, say)
must never delete the live one's files.

### Erasing a person

Documents have no timeframe in law, so they go at once when their person
is erased: the details from the table and every copy in the change feed,
what the history's commands and actions held about them (their titles
and dates), and the files from the storage, straight after, through the
list above. `server/src/erasure/places.ts` has them in its list of what
goes, and [ADR 0027](0027-erasing-a-person-on-request.md)'s table has
the row.

### Backups and a restore

Backups hold the details (the `documents` table and the list of files to
delete), not the files: the bucket holds those already, and a backup is
restored into memory every night to prove it. A restore of details whose
file has gone (removed since the backup, or a bucket that was lost) shows
it when the file is opened: "This document's file isn't in the storage
any more…", saying to ask for it again.

### The export, and their own download

The export of everything ([ADR 0006](0006-audit-trail-and-export.md))
carries the details, not the files. It's built in memory as one file of a
few megabytes; everyone's insurance and licence scans would make it
hundreds, and would turn a spreadsheet of details into a folder of
everyone's driving licences, sent wherever the export goes. Its README
says the files stay in the storage beside the backups and each opens
from the person's card. A freelancer's own download from their link
(`data.json`) lists their documents' details; each file is on their page.

### Made-up data

Dara's public liability insurance runs out in 18 days and Gráinne's ran
out 6 days ago, so both join the reminders; Fionn's is good for months;
Pádraig's IPAF card, Róisín's Safe Pass card and Cian's driving licence
sit with their certificates. Where a store is set up (`DOCUMENTS_DIR` in the browser
tests, say), each gets a small made-up PDF that says it's made up, and
Róisín has sent her renewed Safe Pass card from her link, waiting in
"Answers to check".

## Consequences

- Freelancers send a renewed card from the link they already have, with
  no app, and the office checks it in the same queue as their answers.
  The certificate's expiry follows the card it checked, so nothing drifts.
- Reminders cover insurance as well as certificates, in one list, with a
  message to send.
- On the live server, documents are details only until the bucket is set
  up; then files work with no change to the app. Set `BACKUP_KEY` too,
  so the files are encrypted: a driving licence is more sensitive than
  anything else the app holds.
- Reading a file isn't recorded in the history: it changes nothing, and
  the office opens files often. When roles arrive, who can open which
  documents is one check in `server/src/documents/routes.ts`.
- Files are held in memory while they're checked, encrypted and stored:
  10 MB at a time is nothing for the server. Many at once would want
  streaming.
- Left for later: reminders sent on a schedule rather than prompted;
  more kinds as the office asks for them; a freelancer removing one of
  their own (they ask the office for now).
