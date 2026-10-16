import { Icon } from './Icon.tsx'
import { setTheme, useTheme } from './theme.ts'

// A sun, for going light, and a moon, for going dark: the picture is where the press takes you, and the words say so.

/** Top right on every screen (ADR 0036): one press between dark and light, kept on this device. */
export function ThemeButton() {
  const { shown } = useTheme()
  const to = shown === 'dark' ? 'light' : 'dark'
  const words = `Switch to ${to}`
  return (
    <button type="button" className="theme-button" onClick={() => setTheme(to)} aria-label={words} title={words}>
      <Icon name={to} />
    </button>
  )
}
