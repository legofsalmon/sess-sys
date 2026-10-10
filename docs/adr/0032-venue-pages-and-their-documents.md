# ADR 0032: A page for each venue, with its documents

- **Status:** Accepted, 10 October 2026. Asked for by Colly: "Can the
  venues all have their own page with the ability to store docs on each?"
- **Decides:** where a venue lives in the app, what a venue's document
  is, where its file is kept and who can open it, and why a link is as
  good as a file.

## Context

Venues have been records with a name, an address and notes since jobs
were built ([ADR 0007](0007-jobs.md)). They were listed under the Jobs
tab, and a venue's row opened a small form in place to change those
three things. There was nowhere to keep what a venue sends ahead of a
job: its tech spec, floor plans, rigging points and load limits, power,
access and load-in, its health and safety pack. Those arrive by email
and live in someone's inbox, and the next job at the same venue starts
the hunt again.

People's documents ([ADR 0029](0029-documents.md)) already keep files
safely: in the backups' bucket under `documents/`, encrypted with
`BACKUP_KEY`, checked by their first bytes, read only through the
server, and deleted through a list so none is ever left behind. The live
server has no bucket yet, so files there wait on it being set up.

Venues usually share these papers as a link (a Dropbox or Google Drive
folder, a page on their website) that they keep current themselves.

## Decision

### A venue's page

Each venue opens on a page of its own, `#venues/<id>`, under the Jobs
tab. The venue list on the Jobs tab is now a list of links, each saying
how many jobs and documents it has; a job's venue links to its page too.
The page has, top to bottom:

- **The venue:** its name as the page's heading, the address with the
  Map link, and the notes. **Change details** opens the same form the
  list used to open in place.
- **Documents:** each on a line with its title, its kind, and its file's
  type and size or where its link goes; **Open** for the file (a
  download, as for a person's) and for the link (in a new tab),
  **Change**, and **Remove**, which asks first, in place. **Add document**
  opens the form: what it is, a title (filled in from the kind), a link,
  and a file.
- **Jobs here:** every job at the venue, its own or one of its phases',
  coming up first and then the past ones, newest first, each opening the
  job.

It's a page of its own on a laptop too, not beside the jobs list: the
list down the left is jobs, and a venue isn't one.

### A venue's document

One record per paper: which venue, what kind, a title, a link, a file,
and when it was added.

- **Kinds:** tech spec, floor plan, rigging, power, access and load-in,
  health and safety, and something else. The shared schema's list is
  the only gate, so a new kind needs no migration.
- **Title:** up to 100 characters, filled in from the kind and changed
  if wanted ("Ballroom floor plan").
- **A link, a file, or both;** never neither. A link is only ever a web
  address (`https://` or `http://`, with a host): `javascript:` and
  anything else are refused in words before anything is sent, so the
  link a page opens can never run code in the app.
- **No expiry and no reminders.** A venue's papers change when the venue
  says so; nothing about them runs out the way insurance does.

It's a table of its own, `venue_documents`, in the documents module's
second migration, so it shares that module's list of files to delete.
Devices hold the details, synced like any record (`venueDocument`);
never the files, and never where a file is kept.

### Links work with no signal; files need it

A link is part of the details, so adding one, or changing a document's
details, is a command through the outbox like any other
(`venueDocument.save`, `venueDocument.remove`): it works on a phone at a
site walk with no signal and syncs later. A file goes straight to the
server (`POST /api/venue-documents/:id/file`, the file as the body, the
details in the address), as a server action recorded in the history the
same way (`venueDocument.file`), and needs signal, saying so.

On the live server today, with no bucket, a venue's page says files wait
on the storage being set up and to keep a link meanwhile, and the form
offers only the link. Once the bucket is set, files work with no change
to the app.

### Files are kept and read as people's documents are

Everything ADR 0029 decides about files holds here, by the same code:
checked by their first bytes (PDF, JPEG, PNG, WebP, HEIC; a web page or
an SVG refused in words), up to 10 MB, kept under `documents/` with a
fresh random name, encrypted with `BACKUP_KEY` when it's set, put on the
list of files to delete before it's written and taken off it in the
change that puts it on a document, back on the list when it's replaced
or removed, and read only through the server under sign-in
(`GET /api/venue-documents/:id/file`) as a download with `nosniff`, no
caching and a sandboxing policy. Its name is the venue and the title
("The Heritage - Ballroom floor plan.pdf"). The daily count of files no
one knows counts a venue's as known, and starting fresh deletes them
with everyone else's.

### History, backups and the export

**History:** "Saved The Heritage's tech spec, as a link"; "Added The
Heritage's Ballroom floor plan, with its file (PDF, 240 KB)"; "Put a new
file on …"; "Removed The Heritage's tech spec". Backups and the export
carry the details, as every module's tables, not the files, for the
reasons ADR 0029 gives. A venue is a place, not a person, so erasing
someone on request ([ADR 0027](0027-erasing-a-person-on-request.md))
touches none of this.

### Made-up data

Northbank Conference Centre has a tech spec, an auditorium floor plan
and its loading bay booking, and Riverside Park its power spec, each as
a link to `example.com`, so nothing made up reaches a real site.

## Consequences

- What a venue sends is kept once, on the venue, and found again for the
  next job there.
- Links work on the live server now; files arrive with the bucket.
- Who can open which venue documents, when roles arrive, is one check in
  `server/src/documents/routes.ts`, as for people's.
- Left for later: crew seeing a venue's documents from their call sheet
  or their private link, which needs deciding which documents crew may
  open; and a venue's contacts, which today go in its notes.
