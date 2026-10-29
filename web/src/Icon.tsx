import { createElement } from 'react'
// From the design system's file itself rather than all of the shared code, so the bar can be drawn while the app opens (Opening.tsx).
import { iconFrame, icons, type IconName } from '../../shared/src/ds/icons.js'

export type { IconName }

/**
 * One icon from the shared design system's set (Lucide, named by meaning;
 * shared/src/ds/icons.js), drawn in the text's colour so it follows the theme
 * and whatever it sits in. Beside its word by default, so hidden from screen
 * readers; give it a label only where it stands alone.
 */
export function Icon({ name, className, label }: { name: IconName; className?: string; label?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox={iconFrame.viewBox}
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth={iconFrame['stroke-width']}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {icons[name].map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  )
}

/** A card's heading with its icon in front, so a long page of cards can be scanned by shape. */
export function Heading({ icon, children, id }: { icon: IconName; children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="with-icon">
      <Icon name={icon} />
      <span>{children}</span>
    </h2>
  )
}
