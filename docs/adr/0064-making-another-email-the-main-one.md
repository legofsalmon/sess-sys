# ADR 0064: Making another email the main one

- **Status:** accepted
- **Date:** 20 October 2026
- **Asked for by:** Colly, 20 October 2026 ("For staff also can you make it
  possible to change the primary email address for users that have
  multiple, or for users that have been combined.")

## Context

Combining people brought in twice
([ADR 0055](0055-combining-people-brought-in-twice.md)) keeps one address
as the person's email and the rest as the addresses they are also found by
(`people.other_emails`). Which one is kept is whichever the kept person
had, so it is often a personal Gmail where the company address should be.
The email is the one shown, mailed from the page and, once invites are on,
invited ([ADR 0009](0009-crew-invites.md)). The only way to change it was
to type a new one into Change details, which drops the old main address
from the ones they answer to.

## Decision

- On the person page, each address under **Also found by** has a
  **Make main** button. It sends `person.mainEmail {id, email}`: that
  address becomes the email, and the one it replaces joins the others
  (`withMainEmail` in shared/src/merge-people.ts, on the server and on a
  device alike).
- They answer to exactly the same addresses before and after, so their
  Google sign-in, their role and a system admin's standing (ADR 0060) are
  unchanged, and no address can come to belong to two people. Making the
  old one main again is the same button: that is the undo.
- Who can: the crew ability, as an edit; for someone who holds a role, only
  who can change settings, as with their email itself
  ([ADR 0049](0049-holding-up-at-real-size.md), audit finding 12). Not from
  a private link, and not for someone archived.
- The history says that another of their addresses was made the main one,
  never which: every member of staff reads it. Erasing keeps only the id.

## Consequences

- Only people who were combined have other addresses for now; there is
  still no way to add one by hand.
- Once crew invites are on, changing the main email does to a calendar
  day's guests what changing it in Change details does: the main email is
  the one invited.
