# Bringing in the crew list

*Built, 1 October 2026: see [ADR 0025](../adr/0025-crew-profiles-and-bringing-in-the-list.md).*

Colly's crew database (a spreadsheet, "V3", 124 people, 17 columns) is
the real list of staff, freelancers and applicants. This is what it
holds, how it fits the app's model of a person, what the model needs
before it can hold all of it, and how the import should work. Written
1 October 2026 from the file itself; no personal details are repeated
here, only counts.

## What the file holds

| Column | Filled | What's in it |
| --- | --- | --- |
| First name, last name | 124 | Every row. No duplicate names or emails. |
| Department | 121 | Audio 43, LX 41, Video 18, Backline 7, Laser 3, Transport 3, Production 2, one each of LED Tech, Rigger, Stage Manager, SFX; 3 blank. |
| Phone | 109 | Seven shapes: `353…` with no plus (35), nine digits starting with 8 where a spreadsheet ate the leading 0 (26), foreign numbers with no plus (19: UK, Croatia, Spain, Brazil, China), `00…` (11), Irish with a leading 0 (10), `+…` (8). |
| Email | 117 | One typo (`gmailcom`). Eight at the company's own domain. |
| Preferred | 80 | Yes 18, No 62. |
| Onboarded | 88 | Yes 32, No 56. |
| First aider, manual handling, driving licence | 49 to 51 | Yes/No where known; blank for the rest. |
| Day rate | 0 | Empty throughout. |
| Company, VAT number, CRO number | 8 | The VAT-registered freelancers, each trading through a company. One CRO number "awaiting". |
| Events worked | 86 | Five 2026 events, as a list in one cell. 33 people are known only from this column. |
| Notes | 18 | 8 are applicants ("new applicant, CV received, not yet vetted", with a link to the CV in the office's mail); 9 record a second email or phone the person has used, or a name they go by; one says where someone is based. |
| Skills / tags | 57 | 35 tags in a two-level shape, "Department: skill" (Audio: Front of House, Lighting: Show Op, Video: LED Screen Build…), with a bare department as the general tag. |

Four people have no phone and no email. Staff are the people on company
emails.

## How it fits the model today

A person in the app ([ADR 0002](../adr/0002-crew-booking-links.md),
[ADR 0023](../adr/0023-audit-round-two-the-loops.md),
[ADR 0024](../adr/0024-staff-leave.md)) has a name, a kind (staff or
freelancer), an email, a phone in international form, skills (up to 30
short tags), a day rate, notes, an archived flag and whether they can
approve time off. So, straight in:

- **Name**: first and last joined. The app keeps one name; a person's
  private link greets them by the first word.
- **Kind**: staff for the company-domain emails (Colly, 1 October:
  staff are on company emails, so that's the rule); everyone else a
  freelancer. A person whose second, "also seen with" address is the
  company's counts too, since the file holds one primary address.
- **Email**: as given, lower-cased, the one typo fixed.
- **Phone**: every shape turned into international form (`+353 87 …`),
  which the app already requires so WhatsApp links work: a leading 0
  becomes +353, nine digits starting with 8 get +353 in front, `00`
  becomes +, and foreign numbers keep their country code.
- **Skills**: the tags as they are. The two-level shape is worth keeping;
  the app's skills are free text, so "Audio: Monitors" is fine.
- **Day rate**: empty, so null, as the app allows.
- **Notes**: the notes column, with the "also seen with" lines kept
  (they're useful when someone writes from the other address).

## What the model needs before it can hold the rest

Five things in the file have no home yet. Each is small, and together
they are the person's profile the roadmap always planned
("freelancer profiles, skills, rates, documents with expiry reminders").

1. **Department** (one of the eleven above, or none). The main grouping
   for the Crew tab and the person picker, which round three gives a
   search and a filter. Skills stay the finer grain.
2. **Level**: one number per person, higher meaning more preferred,
   shown as "Level 1", "Level 2" and so on (Colly, 1 October: a
   numerical value rather than preferred and onboarded flags). Levels 0
   to 5, where the office can use the whole range. The picker sorts a
   department by level, highest first, and hides level 0 unless asked.
   From the file: preferred becomes level 3, onboarded but not preferred
   level 2, known but not onboarded level 1, and an applicant nobody has
   vetted level 0. The office moves a person up or down a level from
   their card as it gets to know them.
3. **Certificates**: first aider, manual handling, driving licence, each
   yes, no or unknown, with an optional expiry date and note. This is
   the start of the documents-with-expiry item; Safe Pass, working at
   height and IPAF join the list later, and an expired required
   certificate can block an assignment, as the architecture says.
4. **Company**: name, VAT number, CRO number. VAT-registered means a VAT
   number is held, which the invoicing work needs (freelancers who
   charge VAT put it on their own invoices; the link shows the figures
   with VAT on top for them).
5. **Known as**: the name they go by, used in messages and the greeting
   on their link.

The file's "events worked" column is not brought in: Colly decided on
1 October that past work needn't come across, but that a history of
events per person is wanted going forward. The app already holds what it
needs for that (every confirmed booking), so the person's card gets a
"Worked" list of the jobs they were booked on, newest first, built from
bookings, and the picker can search it. That is part of the profile
work, not the import.

Three other things stay in notes for now: where someone is based (two
people), the CV links (they point into the office's own mail), and the
second email or phone a person has used.

## How the import should work

- **A "Bring in a list" step on the Account tab**, like bringing in the
  old calendar: upload the file, see each row as the app read it with
  anything it couldn't read marked (a phone it can't make international,
  a missing name), fix in place or skip, then bring it in. Rows match
  existing people by email, then by phone, so the file can be brought in
  again after it's updated without doubling anyone. The same step takes
  the stock list next week, with its own mapping.
- **After Start fresh, with sign-in on.** The made-up data goes first.
  The file is personal data for 124 people, and the live app is open
  until the Google key is in, so the real list goes in only once sign-in
  is on.
- **The eight applicants** come in at level 0 with their notes, so the
  queue of CVs lives where the rest does. Removing an
  applicant who isn't taken on is the right-to-erasure item, which
  should come before the first real deletion is needed.
- **The 33 people known only from events worked** come in with a name
  and a department, nothing else, so the office can fill them in as it
  books them.
- **Day rates** stay empty until the office puts them in; the file has
  none.

## What it costs

About a day: the six model additions with their commands, history
labels and export; the import step with its preview; the person card
and the picker showing department, level, certificates and company;
tests; an ADR. Then the import itself takes an afternoon of checking.

## For Colly to confirm

- Whether applicants belong in the app or somewhere else.
