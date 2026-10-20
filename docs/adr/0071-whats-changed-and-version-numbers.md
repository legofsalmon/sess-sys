# ADR 0071: What's changed, and version numbers

- **Status:** accepted
- **Date:** 20 October 2026
- **Asked for by:** Colly, 20 October 2026 ("In the admin section can you
  maintain a changelog and version numbers to document the changes made in
  updates as we go too. In simple plain english where possible, can
  reference PR numbers or anything relevant for further information if
  needed")

## Context

The app changes most days. Until now the only record was this folder, the
build progress page and the pull requests, all written for whoever builds
it. The office had no way to see, in the app, what changed or which version
they were on. The app's only version was the commit it was built from
(version.ts), which means nothing to a person.

## Decision

- **One list, in the code.** `shared/src/changelog.ts` holds every version,
  newest first: its number, the day, a few words, a sentence or two in
  plain English, and the pull requests and decisions behind it. The top
  entry's number is the app's version (`APP_VERSION`).
- **Numbers.** major.minor.patch. The middle number goes up for something
  new a person can use, the last for a fix or a change that only makes it
  work better. The first went to 1 when the live app was connected to the
  real calendar (16 October 2026); everything before is 0.x, backfilled from
  the pull requests and this folder. Changes to plans and docs alone get no
  version.
- **Where it's read.** Admin ends with a card: the version, the latest
  change, and "See every change", which opens Admin › What's changed
  (`#admin/changes`). The Menu's line for Admin says it's there. The page
  is read only and anyone who reaches it can read it: nothing in it is
  private, and the repository is public.
- **The rule.** Every pull request that changes the app adds an entry at
  the top with the next number (CLAUDE.md). A test checks the list is
  newest first, each number one step up from the last, every entry has a
  pull request, and every decision it names is in this folder.
- The build's commit (version.ts) stays for error reports and the show
  pack: it says exactly which build a phone runs, which a version number
  shared by several deploys can't.

## Consequences

- Two pull requests open at once will both claim the next number; the
  second to merge renumbers, as with these decisions.
- An entry's pull request number is known only once the pull request is
  open, so it is filled in then.
