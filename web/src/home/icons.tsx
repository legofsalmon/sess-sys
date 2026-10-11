/**
 * A picture for each place in the bar (ADR 0033), drawn in the text's
 * colour so it follows the current tab and both themes. Always beside its
 * word: the picture helps the eye find the tab, the word says what it is.
 */
const PATHS: Record<string, string> = {
  // A house.
  '#home': 'M4 11.5 12 4l8 7.5M6.5 9.5V20h11V9.5M10 20v-5.5h4V20',
  // A calendar page.
  '#jobs': 'M5 6.5h14V20H5zM5 10.5h14M9 4v4M15 4v4',
  // A flight case.
  '#stock': 'M4 8h16v11H4zM9 8V5.5h6V8M4 13h16M11 13v2h2v-2',
  // Two people.
  '#crew': 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M16 11a2.5 2.5 0 1 0-1-4.8M16.5 14.6c2 .4 3.4 2 3.9 4.9',
  // Three lines.
  '#menu': 'M4.5 7h15M4.5 12h15M4.5 17h15',
}

export function AreaIcon({ area }: { area: string }) {
  const d = PATHS[area]
  if (!d) return null
  return (
    <svg className="area-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
