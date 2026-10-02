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
  `field-line` (the border round a field, dark enough to see against a
  card), `on-line` (text on a line-coloured surface, such as the grey
  pill), `accent`, `accent-ink`, `accent-fill`, `on-accent`, and `good`,
  `warn`, `bad` with a `-soft` background each. Dark follows the phone's
  setting, as the app does. `field-line` and `on-line` aren't in Figma
  yet; until they are, the code is the reference.
- **Spacing**: 2, 4, 6, 8, 10, 12, 14, 16, 20, 40 px.
- **Radius**: control 8, tab 10, card 12, full (pills).
- **Type**: 13 text styles: page title 1.3rem, brand 1rem, section heading
  1rem, subheading .95rem, body 1rem, small .9rem, hint .85rem, button
  .9rem, link .9rem, tab 1rem, status .82rem, pill .75rem and footer .75rem.
  The app uses the phone's own font (`system-ui`: SF on iPhone, Roboto on
  Android); Inter stands in inside Figma.

Spacing, radius and type carry their CSS names the same way: `space/8` is
`var(--space-8)`, `radius/card` is `var(--radius-card)` and the hint style is
`var(--text-hint)`, set on `:root` in `app.css` next to the colours. The web
app's stylesheets use them wherever a value is on the scale, and anything off
it, such as a 1px line or a 3px nudge, stays in px. A radius is named for
what it's on, so a 10px corner that isn't on a tab, such as the box round a
crew call on a job's page, stays in px too. A size off the type scale moves
to the style that does its job when its rule is next changed (a muted .8rem
line is the hint style); rules not changed since still carry a few of their
own.

What every area's pages share (the way back, a record's title and facts,
lists of rows, filters, the grid form, a row that opens) is styled once
under `.app`, and each area adds a class of its own (`crew`, `jobs`,
`warehouse`) for what's only its.

## Rules the components encode

- Phone first: one column, 640px wide at most, 16px side margins.
- On a laptop, from 960px wide, Jobs and Stock are two columns
  ([audit finding 25](audit-2026-09-30.md)): the list (the jobs, or the
  catalogue) takes two fifths on the left, stuck under the top bar and
  scrolling on its own, and the open job, product, item or place takes the
  rest, with no way back as the list is beside it, starting at its top
  however far down the last one the window was; with nothing open, the
  right-hand column holds the rest of the tab. The two together are 1400px
  wide at most. The open one is marked in the list by a red bar down its
  left, and the list keeps its search, filter and scroll as things are
  opened from it. Below 960px nothing changes: a record is a page of its
  own with "‹ All jobs" or "‹ All stock". The other screens stay one
  column on a laptop. Not in Figma yet.
- The connection badge is always on screen, and anything saved on the phone
  but not yet on the server says **Waiting to sync**: one amber pill, the
  same words everywhere, whatever the status under it.
- Every status is the one pill ([audit finding 24](audit-2026-09-30.md)):
  amber when someone has to act (offered, accepted, waiting, to confirm, an
  enquiry or a quote), green when it's settled (confirmed, booked, filled,
  approved), grey when it's off (declined, cancelled, retired, offered on a
  call sheet), and the **bad** tone for a clash in the planner.
- An empty list says "Nothing here yet." in the hint style, then the
  screen's own line: what to do about it, or where its things come from
  ("Nothing here yet. Add your crew below."). A record that isn't on the
  device says so in its own words. Not in Figma yet.
- Red marks the one thing to do next and the current tab. Errors use the
  burnt-orange **bad** tone, never the brand red, so red never means "broken".
- Areas live in a tab bar at the bottom, where a thumb reaches, on a laptop
  as well: the office's phone and laptop work the same way, and the top bar
  keeps to the screen's name and what's waiting.
- A screen stays short on a phone ([audit finding 16](audit-2026-09-30.md)):
  a form waits behind a button that names it ("Add person", "Ask for crew",
  "Add phase", "Add kit", "Add product", "Add place") and opens in place
  with the cursor in its first field and Close under it; a long list shows
  its first few with "Show all 9 products" as a link, keeping in view
  anything to act on, such as kit that's short or the product open beside
  the catalogue. Lists of things to act on ("Answers to check", each kind
  of timesheet) show their first three with the whole count in their
  heading ("Not in yet (7)"). The people list shows its first ten under a
  search that works as the picker's, and anyone just added stays in view
  until the tab is next opened. A form that adds to a folded list says in
  a green line what was added, with the way to it ("Added Bay A3.").
  Details that are only sometimes wanted, such as a phase's running order,
  calendar line, call sheet and contact, fold under the browser's own
  triangle, named for what's in them; a line that needs acting on stays
  out. Not in Figma yet.
- A crew call at rest is one line: the role in bold, then its phase, or on a
  job's page its days where they aren't the phase's, and under it who's on
  it, with any answer short of booked in brackets ("Dara Quinn, Niamh Kelly
  (offered)"). Its pill sits on the right ("Filled", "1/2", "0/3 days
  filled", "Cancelled" for one kept on a job's page for the record, and
  **Waiting to sync** while a change to the call or an offer on it is on
  its way), with "Offer…" under it while there are places to fill. A tap
  on the line opens its days, call time and rate, each offer with its pill
  and Send or Withdraw, and Change and Cancel crew call. On the Crew tab
  the calls are grouped by job, its name in bold with the job's venue and
  Open job, then by days under small grey capitals, with the venue beside
  the days where a phase is somewhere else. Not in Figma yet.
- The Offer to… picker has a search over it that narrows the list by name,
  the name they go by, department or skill as each word is typed, with or
  without fadas, keeping the order and "Show applicants" of
  [ADR 0025](adr/0025-crew-profiles-and-bringing-in-the-list.md); with
  nothing matching, the select says "Nobody matches". Enter in its search
  only searches: it never sends the offer. Not in Figma yet.
- The planner ([ADR 0010](adr/0010-planner.md)) is the one screen that
  uses a laptop's full width, rather than two columns, and on a phone its
  days scroll sideways with the names kept in view. It keeps the same
  colour language: a job's day is solid when confirmed and dashed when
  pencilled in, green once its crew are booked and amber while some are
  still to find; a clash is the **bad** tone and a check is amber. The
  planner isn't in the Figma file yet; until it is, the code is the
  reference.
- A long list checked before anything is saved, such as bringing jobs in
  from Google Calendar ([ADR 0011](adr/0011-calendar-import.md)), keeps its
  one button in a bar stuck just above the tabs, so it's in reach however
  far down the list, and says what it will do ("Bring in 2 jobs"). Unticked
  items fade but stay, to tick again. Not in Figma yet either.
- An address a person copies into another app, such as their calendar
  feed ([ADR 0012](adr/0012-personal-calendar-feeds.md)), is shown in full
  in a read-only field that selects itself when tapped, with its buttons
  under it (Subscribe, Copy address), so it can still be copied by hand
  where a browser won't copy. The freelancer's page does the same, with
  Copy address hidden where there's no script to copy with. Not in Figma
  yet.
- Getting about: each move within the app lands on the screen's heading
  (its h1, or its name in the top bar), which shows the same focus ring
  as a button, and the browser tab is named after the screen ("Crew ·
  Session Hire"). A screen whose heading depends on what it shows, such
  as Leave before it knows whose leave it is, still has one. A toggle that
  keeps its state in the address, such as the planner's Jobs and People,
  isn't a move and keeps focus: it takes focus as it's pressed, since
  Safari doesn't give a pressed button focus. Someone already typing in
  a field on the new screen, its search say, keeps the focus there too,
  so what they type and their Enter still land. The screen sits in one
  `<main>` landmark. A link that is the way back ("‹ All jobs") is at
  least 44px tall, like a button. The "not done" count is read out as it
  changes, and takes no room in the top bar while there's none.
- Every field has a name over it, so it's still there once something is
  typed, and a placeholder only gives an example ("e.g. on tour"). Only a
  field in a tight row (a phase beside its dates, a number beside Out), a
  search box or a scan field has its name read out without it being
  shown.
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
- A person's level ([ADR 0025](adr/0025-crew-profiles-and-bringing-in-the-list.md))
  is always written "Level 3", never a bare number, in the crew list,
  the Offer to… picker and the history ("Moved Dara Quinn to Level 3");
  Level 0 is an applicant, written "Level 0 (applicant)" in the crew
  list and the card's select, and out of the picker until "Show
  applicants" is ticked. The card lists the certificates held in muted
  text and says one that has run out in the **bad** tone, as an overdue
  test on an item is said. The form keeps the profile under a "More"
  fold, open when any of it is set.
- Bringing in the crew list ([ADR 0025](adr/0025-crew-profiles-and-bringing-in-the-list.md))
  is a card per row: the name in bold with Skip on the right, the kind,
  department, level and skills in one muted line, "Updates Dara Quinn
  (matched by email)" where it would, and for a row the app couldn't
  read, the name, email and phone as fields that stay for the rest of
  the preview, with each problem in the warn tone under the field it's
  about, clearing as it's fixed; a problem about the row as a whole
  (someone archived, a second row for one person) is a warn line under
  the facts. The counts sit in one line at the top ("3 rows read: 2 new
  people, 1 with a problem.") and the one button in the bar above the
  tabs says what it will do ("Bring in 3 people"), disabled while any
  row not skipped still has a problem; tapped, it asks in the same bar
  ("3 new people added. Each can be edited afterwards, but this can't be
  undone in one go." with Bring them in and Not yet), as the calendar
  import does. Not in Figma yet.
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
  and "Offered" tag on the freelancer page. The brand red stays for the mark
  and focus rings.
- Warn text is #8a5800 in light mode, 5.3:1 on its pill.
- Buttons and fields are at least 44px tall, which matters with gloves on in
  a dark venue.

On 1 October 2026 the two gaps left were closed, and a third found by the
audit (finding 22):

- The current tab is white on `accent-fill` too, 5.7:1, not on the brand
  red.
- The grey pill's text is `on-line` (#4d5968 in light, 5.1:1 on `line`;
  `muted` in dark, 5.0:1), as is the text of a person's away day in the
  planner. `muted` on `line` was 4.1:1.
- A field's border is `field-line` (#7f8c9a in light, 3.4:1 on a card;
  #6b7684 in dark, 3.6:1), not `line`, which at 1.4:1 let fields dissolve
  in daylight. WCAG asks 3:1 of a control's edge. The same token is on the
  freelancer's pages.
