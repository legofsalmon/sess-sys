# ADR 0063: Skills as picks

- **Status:** accepted
- **Date:** 20 October 2026
- **Asked for by:** Colly, 20 October 2026 ("Could the staff skills input be
  an autocomplete free type field, that can populate with multiple
  selections.")

## Context

A person's skills were one text box, split on commas when the form was
sent. Nothing showed what the rest of the crew list was already called, so
the same skill drifted into several spellings ("Audio", "audio", "Sound")
across a hundred freelancers, and the call's department guess and the
Find a person search, which both read skills, matched less of it. The
crew list bring-in ([ADR 0025](0025-crew-profiles-and-bringing-in-the-list.md))
already reads skills as tags.

## Decision

- The Skills field on the person form (Add person, and Change details for
  staff and freelancers alike) holds the chosen skills as chips, each with
  its own Remove button, and a text box after them.
- Typing offers the skills already on the crew list (`skillsInUse`,
  `shared/src/skills.ts`): each once whatever its case, the most used
  first, in the spelling most people have. Those starting with what's
  typed come first, then those with a word starting with it; ones already
  chosen are left out. With nothing typed, the most used are offered.
- Something not on the list is still taken as typed, and the last option
  says so in words: **Add "Pyro" as a new skill**. A typed skill that
  matches one on the list in another case takes the list's spelling.
- Enter or a comma adds what's typed (Up and Down then Enter choose an
  offer), a pasted list with commas becomes chips at once, Backspace on an
  empty box takes the last chip off, Escape closes the offers. With the
  box empty, Enter sends the form as in any other field.
- What's still typed when the form is sent goes with it. It is not added
  on leaving the box, because turning it into a chip there moves the Add
  person button under a press that has already started, and the press is
  lost.
- Thirty skills, sixty letters each, as before; at thirty the box says to
  remove one to add another.
- The offers follow the combobox pattern: the box is a `combobox` named
  Skills, the offers a `listbox` named "In use" and the chips a list named
  "Chosen", so only the box answers to the field's name. The offers sit
  under the box on the overlay surface.

## Consequences

- No change to storage or the wire: skills are still a list of strings on
  `person.upsert`.
- Skills already spelt two ways stay so until someone edits them; the
  offers show the more common spelling, so the list converges as people are
  edited.
- The design system has no multi-pick field yet; this one is sess-sys's
  own, listed as a learning for the system.
