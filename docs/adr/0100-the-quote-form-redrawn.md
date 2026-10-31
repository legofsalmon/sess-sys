# ADR 0100: The quote form, redrawn

- **Status:** accepted
- **Date:** 30 October 2026
- **Asked for by:** Colly, 30 October 2026: "The quote form is very messy,
  hard to read and understand, and fill out. Could you ask fable to do an
  indepth review of the quote form, and everything related to it… Aim to
  keep visual noise to a minimum to help focus on the important
  information."
- **Changes:** how the draft in [ADR 0080](0080-a-quote-that-saves-itself-and-keeps-up-with-the-job.md)
  is drawn, where travel and subsistence ([ADR 0086](0086-travel-and-subsistence-on-quotes.md))
  and the cost side ([ADR 0089](0089-availability-subhire-and-margin-on-quotes.md))
  sit, and where Ask Claude ([ADR 0096](0096-claude-inside-the-app.md))
  opens from. Nothing a quote holds, prints or saves changes.

## Context

The draft quote grew a feature at a time through ADRs 0042 and 0080 to
0096: rates and discounts, packages, travel and subsistence, hired-in kit
and margin, Current RMS's last prices, Claude. Each was right on its own,
and together they made one long column in which everything had the same
weight. The review of 30 October 2026 (written up for Colly, with the
screens) found 25 things, five of them major by the design system's
severity scale:

1. One level for everything: a group's name, a line, a worked-out line, a
   hint, a term and the send button all read the same, so nothing led the
   eye to the price or to what needed a look.
2. Travel and subsistence took a whole screen of prose on a phone, most of
   it explaining how they are worked out.
3. An open line's six short fields were a four-column grid that wrapped on
   a phone, labels and all, with the VAT link and the amount dropping to
   odd places, and the cost fields open under every line.
4. A new blank line was faulted the moment it appeared ("Line 3: say what
   it's for") at the foot of the form, far from the line, before anything
   had been typed.
5. Ask Claude sat above the lines, between the figure and the work.

The design system's rules already cover most of it: salience by removal,
two levels of containment, a disclosure that says what is inside, a field
that validates when it is left and not as it is typed (rule 18), the unit
as part of the field, a control that looks like one. The outside research
agrees (Nielsen Norman Group's form recommendations and error guidelines,
Baymard's inline-validation testing, GOV.UK's text input with prefixes and
suffixes). So this is not a new design language; it is the form brought
into the system it already belongs to.

## Decision

Every feature stays. What changes is order, weight and timing.

1. **A readout strip** at the top of the lines stays in view under the top
   bar: Before VAT first and largest, the total, the margin for the office
   and directors, and the save state at the right. Under them, only when
   something needs a look, amber chips: "2 lines with no price", "1 line
   short of kit", "1 line with no cost yet". Each chip is a button that
   opens the first such line, on the field it concerns.
2. **Lines are rows** under label-capital group heads: the name, how it is
   charged and the amount, the margin in small quiet type under the amount,
   and a pencil mark at the end that says the row opens. A row has the
   shared hover and pressed washes. One row is open at a time, drawn as an
   inset panel so its edges are clear.
3. **The open line** has What across the top, then its numbers in one row
   where there is the room (from a 700px card) and two rows of three on a
   phone: How many, Days, Price; Charged, Discount, VAT; with the amount at
   the right. Labels never wrap. The unit sits in the box (€ before the
   price, % after a discount) and is never typed; every field keeps the
   accessible name it had, with the unit in it, since what is drawn beside
   an input is not read out with it. Charged is named as the price list
   names its rules: Daily, 3 Day Week, Weekly, Once. Done is a button at
   the right; Remove is a quiet link at the left, away from it.
4. **The cost side folds** under the line as "Cost and margin, not
   printed", whose summary says what is inside ("Our own kit, costs nothing
   · makes €1,320.00"; "2 hired in from PRG, €2,000.00 · makes €…"; "€200.00
   at the booked rate · makes €160.00"). It opens on its own where the cost
   is the point: transport and other typed lines, anything hired in, a cost
   typed, or the "no cost yet" chip pressed.
5. **Travel and subsistence are rows like any line**, with the reason there
   isn't one in the row's second line ("No travel · 4 km from Dublin city
   centre, so within the 50 km travel starts after"). Opening the travel
   row shows the distance; opening the subsistence row shows the Meals
   provided switch. The paragraph explaining how they are worked out goes.
6. **The add row** holds Add kit, Add crew, Add a package, Add transport
   and Add something else (and held Ask Claude until ADR 0098 took asking
   in words away: what the mailbox asks for is now a card under the lines).
   The picker takes the row's place. The rare
   things fold behind quiet links: "Charge all kit for the same days…"
   under the add row, "Discount every line…" at the end of a group's head.
7. **Terms and sending stand beside the lines** in a card of their own from
   1200px, and under them on a phone: Discount and Agree a total side by
   side, Prices hold for and Deposit side by side, the notes, the sums,
   then Send. A hint stays only where it carries information (the client's
   usual discount, the day the quote is valid until, what the deposit comes
   to). Print a draft, Mark as sent with its date, and "Accepted already, by
   phone?" as a quiet link.
8. **A fault shows beside its cause once the field or the line is left,
   not while it is being typed** (rule 18; Baymard). A field skipped over
   is not faulted for being empty until the line is left as a whole. Until
   then the strip says "Not saved yet" quietly, as a button that opens the
   line or focuses the terms field at fault. Once shown, the fault sits by
   the field (joined to it for a screen reader) and, as the form's one
   notice, above Print; it goes on the keystroke that fixes it. What came
   back from the device's keeping (finding 27) counts as left, so its
   fault shows at once.
9. **Words step down a level.** "Enough for now. If X went ahead, 12 short
   on Wed 11 Nov." becomes "Enough, unless X goes ahead: then 12 short on
   Wed 11 Nov.", quiet, with amber kept for a real shortfall. "Not printed"
   becomes the fold's name, so it is clear what isn't printed. The removed
   line's Undo sits in its group, where the line was.

## Considered

- **A table with cells typed in place**, as spreadsheets do. It suits short
  rows; a quote line has eleven things (what, includes, numbers, VAT, kit,
  cost, last charged) and the one-open-line pattern from ADR 0080 was
  right. What was wrong was how the open line was drawn.
- **Showing a line's fault as soon as it has one**, as before. Research
  since (Baymard, January 2024) is clear that an error before the person has
  finished reads as blame and is ignored after; the strip's quiet "Not
  saved yet" says the same thing without pressure.
- **The system's `ds-` field and disclosure classes.** sess-sys keeps its
  own look by decision (CLAUDE.md), so the parts are drawn in its style
  following the system's keys and states; the unit-in-the-box rule and the
  "says what is inside" fold are the system's.
- **A sticky side card on a desk**, so the total and Send never scroll
  away. The side is taller than many windows, and the strip already keeps
  the figure in view; left as a normal column.

## Consequences

- Nothing in the data, the wire names, the printed sheet or the saving
  changes, so no bring-in or migration, and sent versions read as before.
- Every accessible name is kept, so the browser tests needed only the two
  changes the design asks for: the travel rows are opened before their
  field is filled, and Ask Claude is opened from the add row. The first
  quote test now also checks that a new line is not faulted until it is
  left, and that "Not saved yet" opens it.
- The Quotes page, the price list, packages, Admin's cards and the A4 sheet
  are untouched; the Quotes page is being given filter and sort in PR #183.
- PR #173 (Claude reading the operations mailbox, ADR 0098) replaced Ask
  Claude on the draft with a card of what the mail asks for, under the
  lines. ADR 0101 then put Send to the client in the Send section, with
  Mark as sent as a quiet link beside it.
- Six learnings go to the design system (a line-item editor as a part; a
  worked-out line's absence as a row state; issue chips that lead to the
  first row; validation timing for a list of drafts; the unit-in-the-box
  rule for an app's own fields; a fold that opens itself when it holds
  something).
