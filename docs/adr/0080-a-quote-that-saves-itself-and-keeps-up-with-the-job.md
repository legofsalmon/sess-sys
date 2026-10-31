# ADR 0080: A quote that saves itself and keeps up with the job

- **Status:** accepted
- **Date:** 27 October 2026
- **Asked for by:** Colly, 23 October 2026 ("While you're waiting for that
  is the other refinements needed for the quoting flow? Consider the users
  to aim for ease of use, clarity and excellent UX")
- **Builds on:** [ADR 0042](0042-quotes-prices-and-a-money-view.md) (quotes,
  the price list and who sees money),
  [ADR 0070](0070-finding-a-product-by-typing.md) (picking one product).
- **Part of:** the quoting engine plan, part 1a (the editor). 1b, starting a
  quote and following it up, and 1c, the printed quote, come next.
- **Amended:** 30 October 2026 by [ADR 0100](0100-the-quote-form-redrawn.md): the draft is redrawn. The lines are rows under label-capital heads, the open line's numbers sit on one row with the unit in the box, the readout strip carries the warnings as chips that open the line, the terms and the sending stand beside the lines on a desk, and a line is faulted only once it's left. One line open at a time, saving itself, and the device keeping what can't save all stay.

## Context

A walk through the quote screens as the director and the office use them
found fifteen places they trip (in the plan's "Where today's quote screens
trip people up"). The ones in the draft itself:

- **A Save button to forget.** Typing changed nothing until "Save draft"
  was pressed; leaving the page lost it. Nothing said which line stopped it
  saving.
- **The total was at the bottom**, under every line, so changing a price
  meant scrolling to see what it did.
- **Every line was a row of six boxes**, on a phone too, so a quote of
  twenty lines was a hundred and twenty boxes to scroll through.
- **Every line was charged by the day.** Delivery, a site visit or a
  one-off fee had to be typed as "1 day", and the printed quote said "a
  day" beside it.
- **"Add a line" only added a blank one.** Kit and crew had to be typed by
  name and priced by hand, though the price list knows them.
- **A line with no price looked like any other** at €0.00.
- **Remove had no way back.**
- **The quote didn't know the job had changed.** Kit or crew added to the
  job after the quote was built had to be noticed and typed in again.

## Decision

1. **The draft saves itself** a little over a second after typing stops,
   and at once on leaving the page, through the device's queue as before,
   so it works with no signal. A line under the total says "Saving…",
   "Saved", "Saved on this device" (no signal yet) or "Not saved yet". A
   line that can't be saved says why inside it, and Print waits until
   it's saved.
2. **What it comes to stays in view.** Before VAT, the total and how many
   lines have no price sit at the top of the draft and stay under the top
   bar while the lines scroll by.
3. **Lines read as a list, one open at a time**, on every screen: what it
   is, how it's charged ("12 × €55.00 a day × 2 days", "€150.00 once") and
   what it comes to, as the client will read it. Pressing one opens it to
   change; Done, or opening another, shuts it. The VAT rate is a link
   ("VAT 23%") until it's changed, since almost every line is 23%.
4. **A line is charged by the day or once** (`per` on a quote line, `day`
   unless said). A line charged once keeps 1 for its days, so a device that
   hasn't updated works out the same amount. The printed table leaves its
   days blank and says "once" by its price.
5. **Add kit, Add crew, Add something else.** Kit is picked by the product
   picker (ADR 0070) and crew from the roles already priced or booked, each
   priced from the price list for the job's days. "Something else" is
   charged once. A kit line remembers which product it is (`modelId`).
6. **A line with no price is marked**: "Needs a price" in the line, in the
   list and in the count at the top.
7. **Remove can be undone** until the next line is removed.
8. **"The job has changed".** When kit or crew on the job no longer match
   the lines built from them (new on the job, gone from it, or a different
   number), the draft lists the differences with **Update the quote**,
   which takes them all in at the price list, or **Leave it as it is**,
   which hides them on this device until the job changes again. Lines
   typed on the quote are never touched.

## Considered

- **Keeping Save and warning on leaving.** The warning is easy to click
  through, and a save that happens anyway is what every other form in the
  app does (Default Effect).
- **A table of boxes on a desk and the list on a phone.** The draft sits
  beside the quote's details on a desk, half the width, so the boxes
  wrapped there too. One way on every screen is also one way to learn.
- **Charging by the half day or the hour.** Not until the export shows how
  Current RMS's rate definitions are used (part 2 of the plan).
- **Updating the quote from the job by itself.** It would change a price a
  director had already agreed, without them seeing it.

## Consequences

- Quote lines carry two optional fields, `per` and `modelId`; old lines
  read as charged by the day, as they were.
- Leaving a job's changes as they are is remembered in the browser only
  (`sh.quoteLeft.<quote>`), so another device asks again.
- The e2e quote test now opens lines, adds one charged once, removes it and
  puts it back, and waits for "Saved".
