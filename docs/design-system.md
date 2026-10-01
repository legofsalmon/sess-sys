# Design system

The Session Hire design system lives in Figma:
[Session Hire Design System](https://www.figma.com/design/GO1I1Zv2iEfT07uMOk89ZN)
(Colly's Pro team). It was built on 29 September 2026 from the app as it
stands, so it matches what is on phones today rather than a new look.

**Code wins.** When Figma and `web/src/app.css` disagree, the CSS is right
and Figma gets updated. Every colour token carries its CSS name (for example
`color/accent` is `var(--accent)`), so Dev Mode shows the variable to use.

## What is in the file

| Page | What it holds |
| --- | --- |
| Cover | Principles, source of truth, accessibility notes still to decide |
| Foundations | Colour in light and dark, type, spacing, radius |
| Brand mark | The red SH mark and the brand lockup |
| Button | Primary, Secondary, Link, each Default, Focus and Disabled |
| Status pill | Amber (someone has to act), green (booked), grey (off), with every label in use |
| Connection badge | Online, Syncing, Offline |
| Input | Text and select fields, Default, Focus and Disabled |
| Alert | Bad (failed or refused) and Warn (a clash you can override) |
| Card | Card (Default and Attention) and List row |
| Navigation | Bottom tab bar, tab item, sticky top bar |
| Example screens | The Crew area on a 390px phone, light and dark, built only from the components |

## Tokens

- **Primitives**: the raw hex values from `app.css`, hidden from pickers.
- **Color** (Light and Dark modes): `bg`, `panel`, `ink`, `muted`, `line`,
  `accent`, `accent-ink`, `accent-fill`, `on-accent`, and `good`, `warn`,
  `bad` with a `-soft` background each. Dark follows the phone's setting, as
  the app does.
- **Spacing**: 2, 4, 6, 8, 10, 12, 14, 16, 20, 40 px.
- **Radius**: control 8, tab 10, card 12, full (pills).
- **Type**: 13 text styles (page title, brand, section heading, body, small,
  hint, button, link, tab, status, pill, footer). The app uses the phone's
  own font (`system-ui`: SF on iPhone, Roboto on Android); Inter stands in
  inside Figma.

Spacing and radius carry their CSS names the same way: `space/8` is
`var(--space-8)` and `radius/card` is `var(--radius-card)`, set on `:root` in
`app.css` next to the colours. The web app's stylesheets use them wherever a
value is on the scale, and anything off it, such as a 1px line or a 3px
nudge, stays in px. A radius is named for what it's on, so a 10px corner
that isn't on a tab, such as the box round a crew call on a job's page, stays
in px too.

## Rules the components encode

- Phone first: one column, 640px wide at most, 16px side margins.
- The connection badge is always on screen, and anything saved on the phone
  but not yet on the server says **Waiting to sync**.
- Red marks the one thing to do next and the current tab. Errors use the
  burnt-orange **bad** tone, never the brand red, so red never means "broken".
- Areas live in a tab bar at the bottom, where a thumb reaches.
- The planner ([ADR 0010](adr/0010-planner.md)) is the one screen wider
  than 640px: it uses a laptop's full width, and on a phone its days scroll
  sideways with the names kept in view. It keeps the same colour language:
  a job's day is solid when confirmed and dashed when pencilled in, green
  once its crew are booked and amber while some are still to find; a
  clash is the **bad** tone and a check is amber. The planner isn't in the
  Figma file yet; until it is, the code is the reference.
- A long list checked before anything is saved, such as bringing jobs in
  from Google Calendar ([ADR 0011](adr/0011-calendar-import.md)), keeps its
  one button in a bar stuck just above the tabs, so it's in reach however
  far down the list, and says what it will do ("Bring in 2 jobs"). Unticked
  items fade but stay, to tick again. Not in Figma yet either.
- An address a person copies into another app, such as their calendar
  feed ([ADR 0012](adr/0012-personal-calendar-feeds.md)), is shown in full
  in a read-only field that selects itself when tapped, with its buttons
  under it (Subscribe, Copy address), so it can still be copied by hand
  where a browser won't copy. Not in Figma yet.
- Stock ([ADR 0013](adr/0013-warehouse-catalogue.md)) shows an item's
  number in bold with even-width digits. On a place's page each number is
  a round chip that opens the item, dashed and amber while it waits to
  sync. A form used over and over, such as adding items while labelling
  or putting kit in a case, keeps where it's at, clears the number, puts
  the cursor back in it, and says in a green line what was just done
  ("Added SH-000102"). A choice between kinds (Numbered or Counted) is a
  bordered row per option, each with a line saying when to pick it. Not
  in Figma yet.
- Kit on a job ([ADR 0014](adr/0014-kit-on-jobs.md)) is listed by
  department under small grey headings, each line saying in words under
  it whether there's enough: the **bad** tone on a tinted panel when a
  confirmed job is short, amber when an enquiry or quote would be short
  or would use the spare, and plain green text when there's enough. A
  short line has one button, "Subhire the 2 short", which opens the
  line's form with the number filled in and the cursor in From. The jobs
  list says "Kit short" in the same red or amber. Not in Figma yet.
- A label ([ADR 0015](adr/0015-printing-labels.md)) is black on white in
  any theme, sized in millimetres: the QR code on the left (on top for a
  25 mm square) with two modules of white round it, the number in heavy
  type with even-width digits, then "Session Hire" and the product's name
  small. The print screen shows the first three at their real size on a
  grey panel, above one button that says how many it prints. A range of
  numbers wraps only between the numbers, never inside one. A label
  scanned in the search that isn't on anything yet opens a red-bordered
  form right under the search, with the cursor in its first field. Not in
  Figma yet.
- The camera ([ADR 0016](adr/0016-camera-scanning.md)) opens under the
  search from **Scan**, which stays pressed while it's on: a square
  picture with rounded corners, the outside dimmed round a white frame,
  which flashes green on each read. Under it, "Read SH-000123" (or "Point
  the camera at a label.") in bold, then Light, Sound and Stop camera as
  small buttons, Light and Sound pressed when on. With a form to fill in
  under it, the picture shrinks to 180 px so the form's button stays on
  screen. A camera that can't start shows why, in words that say what to
  do, and Try again. Not in Figma yet.
- A call sheet ([ADR 0021](adr/0021-call-sheets.md)) is a page of
  cards in the order a crew member reads it on the day: the job and its
  days with Print and Copy for a WhatsApp group, who to ring, where,
  the running order, the crew by call time, the kit, and the client. In
  the crew list each person has their number as a phone link, a pill
  (Booked in green, To confirm in amber, Offered in grey) and Send.
  Places still to find are an amber pill beside the call. On the
  freelancer's page their own call is the first card, with a green edge,
  and who to ring the next, with a red one. On paper it's black on
  white, one A4 page where it fits, only those who've said yes, and it
  says it's the office's copy. Not in Figma yet.
- A refusal is shown where the action was
  ([ADR 0023](adr/0023-audit-round-two-the-loops.md)): a line in the
  **bad** tone under the form or button, read out as an alert, in a plain
  sentence, never a browser alert; the form keeps what was typed. The top
  bar counts what the server turned down ("1 not done", bad tone, outlined
  when open) beside what's waiting, and opens the one list of them for
  every area, with Dismiss. An "are you sure?" is a question in place: the
  consequence in words in a warn line, the safe button first and focused,
  the fields held still. Not in Figma yet.
- The Leave screen ([ADR 0024](adr/0024-staff-leave.md)) is the Crew
  tab's facts layout for a person's year, three to a row (allowance,
  carried over, taken, booked, waiting, left, with "left" in bold and in
  the **bad** tone if ever below nothing), with the year stepped by the
  filter buttons; Apply is the grid form with the day count said in bold
  under it before anything is sent ("3 days"); each request is a list row
  with its status pill (Waiting amber, Approved green, Declined or
  Cancelled grey, and "Waiting to sync" amber while this device's own
  change is still on its way) and Cancel as a link; the approvers' queue
  puts what to weigh up in warn lines under the request, with Approve as
  the primary button and Decline opening a reason field in place. In the
  planner a public holiday is a faint band in the off tone, a shade
  deeper than a weekend, named under its date. Not in Figma yet.
- Made-up data ([ADR 0019](adr/0019-made-up-data-and-starting-fresh.md))
  is named beside every screen's name in the top bar, "· made-up data" in
  the bold amber warn tone, on every phone while it's in. Deleting
  everything is the one button in the **bad** tone, filled, with the
  soft bad tone for its text (4.7:1 light, 6.9:1 dark): it stays off
  until "delete everything" is typed in the field above it, and says what
  it does, not "OK". Not in Figma yet.
- A pick list ([ADR 0017](adr/0017-pick-lists-and-scanning-out-and-in.md))
  has **Going out** and **Coming back** as two buttons, the pressed one
  ink, over the total in bold ("12 of 40 out"), the scan field with
  **Scan** beside it, and the answer to the last scan in a rounded box:
  green when it matched the plan, amber when it didn't (saying why), grey
  when there was nothing to do. Each product is a row: its name, and how
  many are out in bold on the right, green once there are enough; the
  places to find the rest as a short list with the numbers there; the
  items out as number pills, each with Not going (or Back) beside it as a
  link; and, for counted kit, a How many field with Out or Back. Kit
  not on the job's list goes under "Not on the kit", with an amber note.
  Not in Figma yet.
- Faults ([ADR 0018](adr/0018-faults-missing-kit-and-repairs.md)) are
  cards in a list with a 4 px stripe down the left: burnt orange when the
  kit can't go out, amber when it's damaged but fit to use, the line
  colour once closed. Each has its state in bold ("Damaged, can't go
  out"), the job and when in muted small text, what's wrong, the repair
  notes, and the ways it can end as buttons (Fixed, Not faulty, Write
  off; Found, Write off), with Repair notes last. Closed ones sit under
  "N before". On a pick list coming back, items reported missing are
  number pills with a dashed burnt-orange border after "Missing:", and
  the report form opens under the scan answer. An item's fault is a fact
  in burnt orange at the top of its page. Not in Figma yet.
- Inspections ([ADR 0020](adr/0020-inspections.md)) use the same stripe:
  green when it's in date, amber when it's due in the next 30 days or
  not recorded yet, burnt orange when it failed or is overdue, with the
  state in bold ("PAT overdue since 2 Oct 2026") and what it means in
  muted text under it. What's recorded sits under "N recorded", each
  with the day, who did it and the note. Testing a batch is the pick
  list's scan field and answer box, with the kind as two filter buttons
  and the items tested as number pills, burnt orange for a fail. Not in
  Figma yet.

## Accessibility

Checked against WCAG AA (4.5:1 for normal text). Dark mode passes everywhere.
On 29 September 2026 Colly chose to fix the three light-mode gaps, in the
app and in Figma:

- White text sits on `accent-fill` (#c8202e), 5.7:1, instead of the brand
  red (4.0:1). That covers primary buttons in the app and the Accept button
  and "Offered" tag on the freelancer page. The brand red stays for the mark,
  the current tab and focus rings.
- Warn text is #8a5800 in light mode, 5.3:1 on its pill.
- Buttons and fields are at least 44px tall, which matters with gloves on in
  a dark venue.

Still short: the grey pill is 4.1:1 at 12px, and the current tab is white on
the brand red.
