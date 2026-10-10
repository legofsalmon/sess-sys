# ADR 0032: A page for each venue and client, with their documents

- **Status:** Accepted, 10 October 2026. Asked for by Colly: "Can the
  venues all have their own page with the ability to store docs on
  each?", then "Same with the clients".
- **Decides:** where a venue and a client live in the app, what a
  document kept on one is, where its file is kept and who can open it,
  and why a link is as good as a file.

## Context

Clients and venues have been records since jobs were built
([ADR 0007](0007-jobs.md)): a client with its contacts and notes, a
venue with its address and notes. They were listed under the Jobs tab,
and a row opened a small form in place to change them. There was nowhere
to keep the papers that come with them. A venue sends its tech spec,
floor plans, rigging points and load limits, power, access and load-in,
and its health and safety pack. A client sends a contract, purchase
orders, a brief, brand guidelines, and the insurance cover they ask for.
Those arrive by email and live in someone's inbox, and the next job at
the same venue or for the same client starts the hunt again.

People's documents ([ADR 0029](0029-documents.md)) already keep files
safely: in the backups' bucket under `documents/`, encrypted with
`BACKUP_KEY`, checked by their first bytes, read only through the
server, and deleted through a list so none is ever left behind. The live
server has no bucket yet, so files there wait on it being set up.

Venues and clients usually share these papers as a link (a Dropbox or
Google Drive folder, a page on their website) that they keep current
themselves.

## Decision

### A page each

Each venue opens on a page of its own, `#venues/<id>`, and each client on
one, `#clients/<id>`, both under the Jobs tab. The venue and client lists
on the Jobs tab are now lists of links, each saying how many jobs and
documents it has; a job's venue and client link to their pages too.

A venue's page has its name as the heading, the address with the Map
link, and the notes; a client's has its name, each contact by role with
their number and email to tap, and the notes. **Change details** opens
the form the list used to open in place. Then, on both:

- **Documents:** each on a line with its title, its kind, and its file's
  type and size or where its link goes; **Open** for the file (a
  download, as for a person's) and for the link (in a new tab),
  **Change**, and **Remove**, which asks first, in place. **Add document**
  opens the form: what it is (from that page's own kinds), a title
  (filled in from the kind), a link, and a file.
- **Jobs:** "Jobs here" on a venue (the job's own venue, or a phase's),
  "Their jobs" on a client: coming up first, soonest first, then the
  rest, newest first, each opening the job.

They're pages of their own on a laptop too, not beside the jobs list:
the list down the left is jobs, and these aren't.

### A document kept on a venue or client

One record per paper: what it's on (a venue or a client, and which),
what kind, a title, a link, a file, and when it was added. The code
calls these attachments, to keep them apart from people's documents,
which run out and are personal data; these are neither.

- **Kinds:** a venue's are tech spec, floor plan, rigging, power, access
  and load-in, health and safety, and something else; a client's are
  contract, purchase order, brief, brand guidelines, insurance they ask
  for, and something else. A kind must fit what it's on. The shared
  schema's lists are the only gate, so a new kind needs no migration.
- **Title:** up to 100 characters, filled in from the kind and changed
  if wanted ("Ballroom floor plan", "Purchase order 4471").
- **A link, a file, or both;** never neither. A link is only ever a web
  address (`https://` or `http://`, with a host): `javascript:` and
  anything else are refused in words before anything is sent, so the
  link a page opens can never run code in the app.
- **No expiry and no reminders.** These papers change when the venue or
  client says so; nothing about them runs out the way insurance does.

It's one table, `attachments`, in the documents module's second
migration, so it shares that module's list of files to delete. It has a
column for the venue and one for the client, each referring to its
table, and the database checks exactly one is set, so every document is
on something real. Devices hold the details, synced like any record
(`attachment`); never the files, and never where a file is kept.

### Links work with no signal; files need it

A link is part of the details, so adding one, or changing a document's
details, is a command through the outbox like any other
(`attachment.save`, `attachment.remove`): it works on a phone at a site
walk with no signal and syncs later. A file goes straight to the server
(`POST /api/attachments/:id/file`, the file as the body, the details in
the address), as a server action recorded in the history the same way
(`attachment.file`), and needs signal, saying so.

On the live server today, with no bucket, the pages say files wait on
the storage being set up and to keep a link meanwhile, and the form
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
(`GET /api/attachments/:id/file`) as a download with `nosniff`, no
caching and a sandboxing policy. Its name is the venue or client and the
title ("The Heritage - Ballroom floor plan.pdf"). The daily count of
files no one knows counts these as known, and starting fresh deletes
them with everyone else's.

### History, backups and the export

**History:** "Saved The Heritage's tech spec, as a link"; "Added Nissan
Ireland's purchase order 4471, with its file (PDF, 240 KB)"; "Put a new
file on …"; "Removed The Heritage's tech spec". Backups and the export
carry the details, as every module's tables, not the files, for the
reasons ADR 0029 gives; the export's README says so. Venues and clients
are businesses and places, not people, so erasing someone on request
([ADR 0027](0027-erasing-a-person-on-request.md)) touches none of this.

### Made-up data

Northbank Conference Centre has a tech spec, an auditorium floor plan
and its loading bay booking, Riverside Park its power spec, and
Brightwater Conferences a contract and a purchase order, each as a link
to `example.com`, so nothing made up reaches a real site.

## Consequences

- What a venue or client sends is kept once, on them, and found again
  for the next job.
- Links work on the live server now; files arrive with the bucket.
- Who can open which, when roles arrive, is one check in
  `server/src/documents/routes.ts`, as for people's documents.
- Another kind of record that wants documents (a supplier, a vehicle)
  is a third column and a third list of kinds.
- Left for later: crew seeing a venue's documents from their call sheet
  or their private link, which needs deciding which documents crew may
  open; and a venue's contacts, which today go in its notes.
