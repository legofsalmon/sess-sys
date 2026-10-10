/**
 * The colours Session Hire keeps as its own rather than taking from the
 * shared design system (Colly's call, 9 October 2026): the red that marks the
 * one thing to do next, the current tab, links and focus, and the burnt-orange
 * bad tone, so that red never means "broken". Everything else is a shared role.
 * web/src/app.css declares the same values (a test holds the two together);
 * the freelancer's pages read them from here.
 */
export const ownColours = {
  light: {
    accent: '#ee3744',
    // Behind white text: the brand red is 4.0:1 with white, this is 5.7:1 (AA).
    'accent-ink': '#c8202e',
    'accent-fill': '#c8202e',
    'on-accent': '#ffffff',
    bad: '#a8480f',
    'bad-soft': '#f9e4d6',
  },
  dark: {
    accent: '#ee3744',
    'accent-ink': '#ff737d',
    'accent-fill': '#c8202e',
    'on-accent': '#ffffff',
    bad: '#f0a064',
    'bad-soft': '#3a2414',
  },
} as const
