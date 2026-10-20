# ADR 0066: First and last names

- **Status:** accepted
- **Date:** 20 October 2026
- **Asked for by:** Colly, 20 October 2026 ("Can we set a first name and
  last name fields whenever name is asked for to help separate the data.")

## Context

A person had one name. The calendar bring-ins made 91 people from Google's
guest names and addresses, and the crew list could already read First Name
and Last Name columns, but joined them into one name and lost the join.
Sorting by surname, a payroll or accounts export, and a greeting all need
the two apart, and a split guessed later from one string gets Irish names
wrong ("Seán Ó Briain" is not first name "Seán Ó").

## Decision

- **People ask for a first and a last name** wherever a person's name is
  typed: the person form (adding and changing someone), Jobs › Tidy up's
  "People named from their address", and the people on a calendar
  bring-in. A first name is needed; a last name can be left empty for
  someone known by one name or a handle.
- **The whole name stays**, always the two joined with a space, so every
  list, call sheet, message, search and the history read as before, and
  devices and versions of the app from before keep working. Stored as
  `people.first_name` and `people.last_name` beside `name`, and sent on the
  person as `firstName` and `lastName`.
- **The people already here are split on deploy** by the crew migration,
  word for word as `splitName` (shared/src/crew.ts) splits a name: the last
  word is the last name, together with any words before it that start one
  (Ó, Ní, Nic, Mac, Mc, Ua, Uí, Mhic, O, de, van, von, der, den, da, di, du,
  le, la, del, della, St). One word is a first name alone. The particles are
  matched as written, lower case, capitalised or in capitals, rather than
  through the database's `lower()`, so the split doesn't depend on its
  locale. The form opens with the split filled in to correct.
- **A change that sends only a whole name** (an older version, the
  calendar and crew-list bring-ins) keeps the two a person has when the
  name is unchanged, and is split otherwise. A first and last name that
  don't make the name sent with them are from an older copy, and the name
  wins.
- **A crew list with First Name and Last Name columns** keeps them as the
  file has them, while the office doesn't retype the row's name.
- **A greeting** uses the name they go by, then the first name, so "Mary
  Ann Smith" is "Hi Mary Ann".
- Erasing someone ([ADR 0027](0027-erasing-a-person-on-request.md)) clears
  both with the name, or keeps both while the name is kept. Combining
  people ([ADR 0055](0055-combining-people-brought-in-twice.md)) keeps the
  two that go with the name kept. Download everything has both columns.

Venues, clients and companies keep one name: they are names of things, not
people. A client's contacts are still one name; that can follow if wanted.

## Consequences

- Names split wrongly on deploy (a double-barrelled first name, a handle)
  are fixed one at a time on the person's page, under Change details.
- The columns sit at the end of the people table, as Postgres adds them.
