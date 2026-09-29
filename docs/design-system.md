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
  `accent`, `accent-ink`, `on-accent`, and `good`, `warn`, `bad` with a
  `-soft` background each. Dark follows the phone's setting, as the app does.
- **Spacing**: 2, 4, 6, 8, 10, 12, 14, 16, 20, 40 px.
- **Radius**: control 8, tab 10, card 12, full (pills).
- **Type**: 13 text styles (page title, brand, section heading, body, small,
  hint, button, link, tab, status, pill, footer). The app uses the phone's
  own font (`system-ui`: SF on iPhone, Roboto on Android); Inter stands in
  inside Figma.

Spacing and radius are named in Figma (`var(--space-8)`, `var(--radius-card)`)
but are still plain px values in the CSS. Adding them to `app.css` is a small
follow-up that lets the two stay in step.

## Rules the components encode

- Phone first: one column, 640px wide at most, 16px side margins.
- The connection badge is always on screen, and anything saved on the phone
  but not yet on the server says **Waiting to sync**.
- Red marks the one thing to do next and the current tab. Errors use the
  burnt-orange **bad** tone, never the brand red, so red never means "broken".
- Areas live in a tab bar at the bottom, where a thumb reaches.

## Accessibility, still to decide

Checked against WCAG AA (4.5:1 for normal text). Dark mode passes everywhere.
In light mode:

- White on the brand red is 4.0:1 for 14px button text. Filling primary
  buttons with `accent-ink` (#c8202e) instead gives 5.7:1 and keeps the look.
- Warn pill text is 4.5:1 and the grey pill 4.1:1 at 12px. A darker warn
  (#8a5800) gives 5.3:1.
- Buttons and fields are 36 to 40px tall. 44px is the comfortable touch
  target, which matters with gloves on in a dark venue.

None of these are changed yet: they alter how the brand red reads, so they
wait on Colly's word.
