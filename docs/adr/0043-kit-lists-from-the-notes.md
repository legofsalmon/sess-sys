# ADR 0043: Kit lists from the notes of jobs brought in

- **Status:** accepted
- **Date:** 17 October 2026
- **Follows:** [ADR 0011](0011-calendar-import.md), which promised "Kit
  lists become kit lines when the warehouse arrives", and
  [ADR 0014](0014-kit-on-jobs.md), which left turning them into lines
  until the stock list had the products to match them against.

## Context

Jobs brought in from the organisers' Google Calendars keep each event's
description in the phase's notes, or the job's when every phase had the
same one ([ADR 0011](0011-calendar-import.md),
[ADR 0037](0037-job-kinds-and-days-gone-as-history.md)). When it's filled
in, that description is the job sheet: a kit list in sections (`Audio`,
`Video`, `Lighting`, `Transport and labour`) written as `4 x d&b Y10P`,
`1 x d20 amp` or `2x Shure ULXD`, which parts a partner supplies, a run of
show (`5.00pm - Crew Call`) and access notes
([current process](../research/current-process.md)). The research said
then that reading them would be partial, so the import should mark them
for review rather than trust them.

The catalogue now exists ([ADR 0013](0013-warehouse-catalogue.md)), with
the stock list brought in ([ADR 0026](0026-bringing-in-the-stock-list-and-item-logs.md)),
and Adam's calendar brought in 767 jobs. Typing each job's kit in again
from its notes is the double keying the app is meant to end; trusting a
reader blindly would put the wrong speakers on a show.

## Decision

1. **Which lines are kit.** A line with a number and a name: `4 x`,
   `4x`, `4 ×`, `x4`, `Shure ULXD x 2`, `4 no.`, `4 off`, `4 pcs`, with
   a bullet or not. The `x` has to stand on its own, so `4 XLR 10 m` isn't
   four "LR 10 m", and a name ending in a number before it (`Stage deck 2
   x 1`) isn't read as one. A plain `12 Robe Spiider` counts only under a
   kit heading, since `12 Oct - build` and `1 Grand Canal Square` look the
   same anywhere else. Times, prices and sentences aren't kit. What's in
   brackets at the end (`(2 spare)`) becomes the line's note. A heading
   (`Audio`, `Sound`, `LX`, `Vision`, `Staging`, `Rigging`, `Power`) gives
   the lines under it a department; `Transport and labour` (and `Crew`,
   `Vans`) marks them as probably not kit; `Run of show`, `Access` and the
   like end a section.
2. **Which product each is**, in order, on the device:
   - **as chosen before**: a name someone has already matched, or said
     isn't kit, is matched the same way on every job after (below);
   - **by name**: the product's name, capitals, accents, punctuation,
     spacing and `×` aside (`stage deck 2x1m` is *Stage deck 2 × 1 m*);
   - **by its model or code**: the name less its maker, as the stock list's
     make and model make it (`Y10P` is *d&b Y10P*, `Spiider` is *Robe
     Spiider*), or a code in the product's name that the line has (`d20
     amp` is *d&b D20*), when only one product fits, or one in the
     heading's department;
   - **a close match**, by the letters the names share, with a word in
     common and the heading's department counted for it, when one product
     is clearly closest;
   - otherwise **nothing**, with the closest few offered first.

   The stock list has no other names for a product: its old tags are an
   item's, not a product's. So the names the office chooses are the
   catalogue's other names: kept in a small table, `kit_names`, by an id
   made from the name itself so every device agrees, against a product or
   as not kit. Choosing "d&b D20" for "d20 amp" once matches it on every
   job after, and a guess taken as it is, by adding it, is remembered too.
3. **Checked before anything goes on.** A job's Kit card says what its
   notes list and opens **Kit from the notes** (`#jobs/<id>/notes-kit`):
   each line as written, under its phase's notes or the job's, with the
   product it matched, how many, and in words what it will do ("Matches by
   name. Adds 4.", "Matched by its model: check it's the right one.",
   "Already on the job: 4 on these days.", "Not kit, as chosen before").
   Any line can have another product, another number, **Not kit**, or
   **New product…**, which is offered only to a role that can change stock
   ([ADR 0034](0034-roles-and-what-each-can-change.md)) and makes a
   product by the stock list's own rules (a name no other product has, a
   department, numbered or counted). Lines with no product yet are left
   out and said to be. Nothing is added until **Add 5 lines to the kit**.
4. **Where they go.** A line from a phase's notes is kit for that phase;
   from the job's notes, kit for the whole job.
5. **Nothing twice.** A line counts what the job already has on its days:
   for a phase, its own lines and the whole job's; for the whole job, its
   own and the most on any one phase. Only what's missing is added, onto
   the line already there. And the change says how many the job should
   then have, not how many to add, so the same notes read twice, or by two
   phones with no signal, add nothing more. The notes themselves stay as
   written.
6. **A season at a time.** **Kit in the notes** (`#jobs/notes-kit`, from
   the Jobs list, the bring-in and the Menu) lists the jobs whose notes
   hold kit not on them yet, coming up first: **Ready to add**, where
   every line matched by name or as chosen before (or is on the job), with
   **Add 140 lines to 23 jobs**, asked first in place; and **To check**,
   each opening its job's lines. A job leaves the list once its notes have
   been turned into kit, until they change: the job's notes as they were
   are kept by a fingerprint in `kit_notes_read`. Cancelled and lost jobs
   aren't listed.
7. **One change, batched.** `kit.fromNotes` carries up to 50 jobs and
   1,000 lines, the names chosen and each job's fingerprint, and needs the
   kit ability like the other kit changes. The server keeps kit's rules
   (the job, the phase of that job and the product must exist and not be
   a mistake) for every line at once, and writes them a few hundred to a
   statement, as the calendar's bring-in learned to (ADR 0011, 16
   October): a call at a time of 50 jobs is a dozen queries, not a dozen
   per line. Any line refused refuses the change, so it's never half in.
   Kit from the notes works with no signal like any other kit change.

## Considered

- **Reading the notes on the server, at the bring-in.** It would add kit
  nobody checked, and the stock list was empty when most jobs came in.
  Reading on the device means it works offline, follows the stock list as
  it fills, and nothing is added without a person.
- **One `kit.add` a line.** The commands exist and would do, a job at a
  time; but a season is thousands of lines, each its own round trip under
  the lock, which is what made the 767-job bring-in time out. And
  `kit.add` adds: a second reading would double the kit.
- **Other names on the product itself.** A field on `models` would show
  on the product's page, but a name like "d20 amp" is how one organiser
  writes it, not part of the product, and "not kit" has no product to sit
  on. A table of names keeps both, and leaves the product as the stock
  list says it.
- **Marking the lines in the notes as read.** The notes are what Google
  had; changing them would make them differ from the calendar's events,
  which the bring-in compares against.

## Consequences

- The office can turn a season's job sheets into kit in an afternoon:
  the jobs whose lines all match go in at once, and each job to check is a
  page of lines with the likely product already chosen.
- A matched line is only as good as the stock list: until the products
  are in, most lines say "Nothing like it in the stock list", and **New
  product…** adds them as they come.
- Kit added to jobs gone by is the record of what went; it holds no kit
  from today on, so it shows no shortages.
- Kit read from an imported job's notes counts as working on it, so the
  bring-in can't be taken back as a whole after it, as with kit typed in.
- A product taken out of the stock list leaves the names chosen for it
  unremembered; nothing refers to it from them.
- Not yet: reading which parts a partner supplies into subhire lines
  ("Video by Lumen"), and reading the run of show into the call sheet.
