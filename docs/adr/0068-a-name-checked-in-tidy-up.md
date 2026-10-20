# ADR 0068: A name checked in Tidy up

- **Status:** accepted
- **Date:** 20 October 2026
- **Asked for by:** Colly, 20 October 2026 ("After I save one entry, when I
  click save on another they don't seem to commit/stay visible, not like
  the first.")

## Context

Jobs › Tidy up lists "People named from their address": anyone whose name
is still exactly what their email address spells ([Decision
0053](0053-tidying-what-came-in.md)). Saving a name took them off the list because the
name no longer matched. But plenty of addresses already spell the person's
name: aoife.byrne@… was brought in as "Aoife Byrne". Typing Aoife and Byrne
and pressing Save saved it, and they stayed on the list with what was
typed, as if nothing had happened. A handle like craicaudio@ left at once,
so the first save looked right and the next did not.

## Decision

- **The office's say-so is kept.** A person carries `nameChecked` (column
  `people.name_checked`, default false), set when Tidy up's Save sends
  `nameChecked: true` with `person.upsert`. Once set, nothing unsets it: an
  edit that leaves it out, or sends false, keeps it. Sent on the person only
  once true, so everyone else is sent as before.
- **Checked people aren't "named from their address"**, on Tidy up, its
  nudge on Jobs and the line on Crew, whatever their name is.
- **Combining** keeps the flag when the name kept is the one that was
  checked. Erasing someone leaves it: it says nothing about them.

## Consequences

- Saving a name in Tidy up always takes that person off the list, so the
  list counts down to nothing.
- Someone named in the person form rather than Tidy up still counts as
  named from their address if the name is what the address spells; Tidy up
  is where those are confirmed.
