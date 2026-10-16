import { Icon, type IconName } from '../Icon.tsx'

/**
 * A picture for each place in the bar (ADR 0033), from the shared design
 * system's set, drawn in the text's colour so it follows the current tab and
 * both themes. Always beside its word: the picture helps the eye find the
 * tab, the word says what it is.
 */
const ICONS: Record<string, IconName> = {
  '#home': 'home',
  '#jobs': 'calendar',
  '#stock': 'warehouse',
  '#crew': 'people',
  '#menu': 'menu',
}

export function AreaIcon({ area }: { area: string }) {
  const name = ICONS[area]
  return name ? <Icon name={name} className="area-icon" /> : null
}
