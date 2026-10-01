# ADR 0025: Crew profiles, and bringing in the crew list

- **Status:** Accepted, 1 October 2026. Built after staff leave
  ([ADR 0024](0024-staff-leave.md)), from the plan in
  [research/crew-import.md](../research/crew-import.md).
- **Decides:** what a person's profile holds beyond their contact
  details, how the office keeps it, and how the real crew list, a
  spreadsheet of 124 staff, freelancers and applicants, comes into the
  app without anyone typing it twice.

## Context

The crew list lives in a spreadsheet: a first and last name, a
department, a phone and an email, whether someone is preferred and
onboarded, three certificates as yes or no, a company with a VAT and a
CRO number for the eight who charge VAT, the events each has worked,
notes, and tags. A person in the app has a name, a kind, an email, a
phone, skills, a day rate, notes, an archived flag and whether they can
approve time off ([ADR 0023](0023-audit-round-two-the-loops.md),
[ADR 0024](0024-staff-leave.md)). Five things in the file have no home.

Colly's decisions, 1 October: staff are the people on company emails;
past events are not brought in, but a "Worked" history per person is
wanted going forward, built from bookings; and preferred and onboarded
become one number, the level, higher meaning more preferred.

The phones in the file come in seven shapes (`353…` with no plus, nine
digits starting with 8 where a spreadsheet ate the leading 0, foreign
numbers with no plus, `00…`, Irish with a leading 0, `+…`, and some with
spaces, dashes or brackets), one email has a typo, and four people have
no phone and no email. Whatever brings the list in has to show each row
as the app read it and let the office fix or skip it before anything is
saved, the way the calendar import does ([ADR 0011](0011-calendar-import.md)).
And the file will be brought in again after it's updated, so a second
import must change nothing it needn't, and must never undo what the
office has typed into the app since.

## Decision

### The profile

A person gains five things, all optional on `person.upsert` so an edit
from an older version of the app keeps what the server has, as the
leave flag does; the server fills in what wasn't sent from the row it
holds, and the device's view lays an edit over the person the same way.

- **Department**: free text, up to 60 characters, or none. The form
  offers the known ones (Audio, LX, Video, Backline, Laser, Transport,
  Production, LED Tech, Rigger, Stage Manager, SFX) from a list as you
  type, so a new department never needs a change to the code. One typed
  in another case ("audio") is saved in the known spelling, and the list
  and the picker compare departments with case ignored, so "audio" and
  "Audio" are never two groups. Older rows read as none.
- **Level**: a whole number from 0 to 5, shown as "Level 3". Higher is
  more preferred. 1 means known, and is what an older row and a person
  added by hand get; 0 is an applicant nobody has vetted, written
  "Level 0 (applicant)" wherever nothing else on the screen says so. It
  has a command of its own, `person.level`, so the history can say
  "Moved Dara Quinn to Level 3" and the person's card changes it without
  opening the form; `person.upsert` carries it too. The server refuses
  anything outside 0 to 5 in plain words, and refuses to move someone
  archived, as it refuses to offer them work.
- **Known as**: the name they go by, up to 100 characters, or none. The
  greeting on their private link and every message the office is
  prompted with (the offer, confirmation, changes, timesheets, the call
  sheet) use it when it's set, and the first word of the name otherwise.
- **Certificates**: a map by kind, for now `first-aid`,
  `manual-handling` and `driving-licence`, each held (yes, no, or
  unknown), an expiry day or none, and a note up to 200 characters. A
  kind that isn't there reads as unknown, so older rows and the file's
  blanks need nothing. Stored as one JSON column. The form shows the
  three as Yes, No or Unknown with an optional expiry date; the card
  lists the ones held, with the expiry where there is one, and warns in
  the bad tone when one has expired.
- **Company**: a name up to 200 characters, a VAT number and a CRO
  number up to 40 each, or none. Three nullable text columns.
  "VAT-registered" is not stored: it is derived, a VAT number is held.
  The card says "Trades as Quinn Audio Ltd, VAT-registered". The
  invoicing work will read it; nothing more here. On the form the three
  are for freelancers, as "Can approve time off" is for staff; a member
  of staff who already has one (from the list, say) sees the fields too,
  so it can be read and cleared, never dropped without a word.

The form keeps to a phone: the new fields sit under "More", folded away
unless any of them is set.

**Worked.** The view gives each person a list of the jobs they were
booked on: an accepted or confirmed offer on a call that stands (not
cancelled, on this device or the server), from the person's own first
day on it, newest first, each with the job, the phase and the person's
own days. Built on the device from the offers, calls and jobs it already
holds, so it needs no signal and no new table, and it grows by itself
from here on. The card's detail shows the last few with a count ("Worked
on 4 jobs"). The Offer to… picker has no text search yet, so matching on
job names worked is a later item below.

**The Crew tab and the picker.** Each person in the list shows their
department and level beside their kind and skills, and the list can be
narrowed to one department with one select; when that department's last
person is edited or archived away, the select falls back to everyone
rather than showing an empty list. The Offer to… picker sorts by
department, then by level with the highest first, then by name, says the
department and level on each line, and leaves out level 0 unless "Show
applicants" is ticked. Archived people stay out of both, as before.

**History and export.** Saving a person says "Saved Dara Quinn's
details", as it did: which fields, never what they hold, since every
member of staff reads the history. Moving a level says "Moved Dara Quinn
to Level 3". The people table's line in the export's README names the
new columns.

### Bringing in the list

**A reader anyone can trust.** `shared/src/csv.ts` reads a CSV file as
the standard says (quotes, doubled quotes, commas and line breaks inside
quotes, Windows line endings, a leading byte-order mark), keeping a
blank line as an empty record so that a row's number is its line in the
spreadsheet, and turning a line break inside a field into one line feed
whichever way the file wrote it. `shared/src/crew-import.ts` turns the
rows into people for the preview, mapping columns by their header name
with case and spaces ignored, so a file with the columns in another
order reads the same. A file whose letters didn't survive the save (a
plain "CSV" from Windows isn't UTF-8, and its fadas arrive as marks) is
turned back with "Save the file as CSV UTF-8 and choose it again". For
each row:

- the name is the first and last name joined; no name, or one over 200
  characters, is a problem;
- the kind is staff when the email's domain is the office's own, from
  the office email set on the Account tab; while no office email is
  set, everyone comes in as a freelancer and the preview says so;
- the email is trimmed and lower-cased, and one that doesn't look like
  an email is a problem, kept as typed for the office to fix;
- the phone is put in international form by one normaliser, exported
  so the form can use it too: spaces, dashes, brackets and dots go; `00`
  becomes `+`; a leading `+` is kept; `0` and eight or nine digits
  becomes `+353` and the rest; nine digits starting with 8 get `+353` in
  front; `353…` gets its `+`; a bare foreign number of ten or more
  digits starting with a country code from a short list (44, 34, 385,
  55, 86, 1, 33, 49, 39, 31, 48) gets its `+`. Anything else is a
  problem, kept as typed: a UK number typed locally (`0` and ten
  digits), a `0` straight after the `+`, or a trunk `0` after the Irish
  or UK code, which no number has. The reader marks what it isn't sure
  of; it never guesses;
- no email and no phone is a problem, so the office decides whether
  someone with no way to reach them comes in;
- the level is 3 for Preferred, else 2 for Onboarded, else 0 when the
  notes say applicant, else 1;
- a certificate column's Yes is held, No is not held, and blank is
  unknown, so it isn't written at all;
- the company is there when any of its three columns is; a CRO of
  "awaiting" stays as the text it is;
- skills come from the tags column split on commas or semicolons,
  trimmed, deduplicated and capped at 30; the two-level "Audio: Monitors"
  shape is kept, since skills are free text;
- the day rate is kept as the file has it and read with the shared
  money parser; one the parser can't read is a problem, said with the
  cell's text, never dropped; Events Worked is ignored; the notes are
  kept as notes;
- a second row with the same email, or the same phone, as an earlier one
  is a problem, so the same person never comes in twice from one file;
  a skipped row is out of the running, so it blocks nobody.

The same checks and the same matching (below) are one shared function,
run on the server for the preview, on the device as the office fixes or
skips a row, and on the server again as the rows go in.

**Matching, with what the office must decide marked.** Each row is
matched to a person on the Crew tab by email first (case aside), then by
phone (digits compared after both are normalised). Archived people are
looked up too: a row for one of them is marked ("Old Timer is archived.
Skip this row, or bring them back on the Crew tab and choose the file
again") and matches nobody, so a leaver is never revived or changed from
the file, and never doubled either. Two more things are marked rather
than guessed at: a row whose email is one person's and whose phone is
another's ("This phone is Brid Walsh's"), and a second row that would
update someone an earlier row updates ("Row 2 also updates Aoife
Byrne"). A problem blocks the import until the row is fixed or skipped.

**Two steps on the server**, in `server/src/crew/import.ts`, open to
whoever the rest of the app is open to (signed-in staff once sign-in is
on):

- `POST /api/people/import/preview` with the file's text reads the rows,
  matches them, and answers with the rows, who each matched and how, and
  the counts. Nothing is saved.
- `POST /api/people/import` with the rows as the office fixed them, each
  with a skip flag and with who the preview said it updates, brings
  them in, all in one transaction. Each row is checked and matched again
  inside the lock, against everyone, so two people bringing the list in
  at once can't double anyone; a row whose match is no longer what the
  preview showed (a phone fixed on the way that now belongs to someone
  else, or a person who has since gone) is refused by name, "Choose the
  file again to see it", rather than applied unseen. Each row then goes
  through `person.upsert` exactly as a pushed command does, so sync, the
  history and the export follow with no special case. A new person gets
  a fresh id and a private link. A matched person is updated field by
  field with what the file holds: the name; the email, phone,
  department and known as where the file has one; each of the company's
  three cells where it's filled; for each certificate the file says
  anything about, only whether it's held, the expiry and the note the
  office typed staying; the skills as the union; the notes with the
  file's text added once, cut to what the notes have room for so the
  office's own notes are never shortened; the level and the kind only
  when the person is new, since the office's own setting of either beats
  the file's flags; and the day rate, the archived flag and "Can approve
  time off" as they were. A blank cell never erases what the app has.
  A matched person the file would change nothing about gets no command
  at all, so a second import of the same file sends nothing for them and
  adds no lines to the history or the sync feed. Every row is checked
  with the `person.upsert` schema; one bad row refuses the whole import,
  naming the row, and nothing is applied. The answer is how many were
  added, updated, unchanged and skipped.
- The history has one line per person changed, as `person.upsert`
  gives, and one line for the import: "Brought in the crew list: 20
  added, 3 updated", with "4 unchanged" and "1 skipped" when there are.

**The screen**, "Bring in a list", reached from a card on the Account
tab beside the Data card, at `#account/import-people`:

1. choose a `.csv` file, read in the browser and posted as text, no
   upload library; a file over 5 MB is told on the device before any of
   it is sent;
2. the preview: the counts at the top (new, updates, skipped, with
   problems), then each row as the app read it: name, kind, department,
   level, email, phone, how many skills, the day rate, the company when
   there is one, "Updates Dara Quinn (matched by email)" when matched,
   and each problem in the warn tone beside the field it's about, or
   under the row when it's about the row as a whole. A row the app
   couldn't read has its name, email and phone as fields, decided once
   from the preview and kept for the rest of it, so the fields never
   vanish mid-word; as the office types, the row is checked and matched
   again by the shared rules against the people this device holds, so
   the problem clears and the row says who it updates now; and a Skip
   tick;
3. "Bring in 24 people", counting the rows not skipped, disabled while
   any of them still has a problem; it asks first, in the same bar, since
   there's no undo for the lot; then through `act()`, so a refusal shows
   above the button;
4. done: "Added 20, updated 3, skipped 1", with "4 were already up to
   date" when any were, a link to the Crew tab, and "Bring in another
   list".

The card warns, while sign-in is off, that anyone who can reach the app
can read whatever is brought in, and says to put the real list in once
sign-in is on. The file is personal data for 124 people; the app is
open until the Google key is in.

**Made-up data.** The made-up people have departments and levels that
make sense (Aoife in Production at Level 3, approving time off; the
freelancers across Audio, LX, Video and Rigger), one holds a first-aid
certificate, one's manual handling has expired, and one trades through
a company with a VAT number, so every part of the profile shows.

## Consequences

- The real list goes in after Start fresh, once sign-in is on, in an
  afternoon of checking the preview: the phones the reader marks, the
  email with the typo, the four people with no way to reach them. The
  file can be brought in again after it's updated, since rows match by
  email then phone, and the second time changes nothing and sends
  nothing for anyone it needn't.
- Nothing written by hand in the app is undone by a blank cell in the
  file, down to a certificate's expiry and a VAT number, and the
  office's level and kind always beat the file's flags. Nobody archived
  is revived by the file.
- Five more fields to know, none required: an older version of the app
  keeps working, and a person it saves keeps their profile.
- Left for later and written here so it isn't lost: Safe Pass, working
  at height and IPAF as certificate kinds; blocking an assignment on an
  expired required certificate, the way an overdue PAT blocks an item;
  a text search in the Offer to… picker that matches job names worked;
  the stock list through the same step with a mapping of its own; and
  removing an applicant who isn't taken on, which is the right to
  erasure.
