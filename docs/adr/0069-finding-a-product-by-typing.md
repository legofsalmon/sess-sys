# ADR 0069: Finding a product by typing, and other names

- **Status:** accepted
- **Date:** 20 October 2026
- **Asked for by:** Colly, 20 October 2026 ("In the kit in the jobs notes
  section, when selecting the kit from the list … can this be changed to an
  autocomplete, with the text string being input able to parse any string
  contained in the values, and also search any specified alias/meta
  information?")

## Context

Kit from the notes ([Decision 0043](0043-kit-lists-from-the-notes.md)) offered a
product for each line in a native dropdown: "Most like it", then every
product in the stock list by department. With the Current RMS stock list in
([Decision 0056](0056-bringing-the-stock-in-from-current-rms.md)) that is
hundreds of rows to scroll on a phone, and a dropdown can't be searched.
Add kit on a job's page used a native `<datalist>`, which only finds names
starting with what's typed in some browsers and anywhere in others, and
took the product only when the whole name was typed exactly.

Crew don't call kit what the stock list does: "58s" for Shure SM58s,
"wedges", "Spider" for Robe Spiider. Nothing in the stock list held those
names, so neither the picker nor Kit from the notes' matching could find
them.

## Decision

- **Products get other names** (`aliases`, a list, up to 20 of up to 100
  letters; column `models.aliases`, jsonb, default empty). Changed on a
  product's page ("Other names it goes by", commas between) and shown
  there as "Also called". Each is kept once whatever its case, and never
  the name itself. An older app leaves them out and changes nothing.
- **One product picker** (`web/src/ProductPicker.tsx`) in place of both,
  the design system's combobox for picking one record. What's typed is
  found anywhere in the name, in an other name, or in the category or
  department; every word typed must be found, in any order, and capitals,
  spaces and dashes don't count, so "58", "sm 58", "shure 58" and "beta"
  all find a Shure SM58 called Beta 58 too (`findProducts` in
  `shared/src/find-product.ts`). The name as typed comes first, then names
  starting with it, a word starting with it, names holding it, other names,
  and last a mix of fields. An offer found by an other name says so ("Also
  called Beta 58") with its department and category under its name.
- **Eight at a time**, then "40 more: type more to narrow it down". With
  nothing typed, Kit from the notes offers "Most like it" as before; Not
  kit and New product… are always the last rows.
- **The keys are the combobox's**: the first offer is highlighted while
  something is typed and Enter takes it; Up and Down move, Escape closes
  and a second Escape puts the chosen name back. Leaving the field puts the
  chosen name back, unless what's typed is a product's name exactly, which
  is taken, so typing a whole name and pressing Add to kit still works.
- **Kit from the notes matches other names as names.** A line reading
  "Beta 58" matches the SM58 as surely as its name would. A product's name
  always wins over another product's other name.

## Consequences

- Picking from hundreds of products is a few letters on a phone, and the
  office can teach the stock list the names crew write.
- What's typed in the picker is a search, not a value: leaving without
  choosing drops it. The design system's combobox keeps what's typed
  because there it becomes a value; this departure is written up there for
  pickers of records.
- Other names are matched exactly by Kit from the notes (and by letters
  shared, like names); a typo in an other name is found only by the close
  match.
- The Stock screens' own product fields (counts, labels, adding an item)
  still use the `<datalist>`; they can take the picker when they're next
  touched.
