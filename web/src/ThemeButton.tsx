import { setTheme, useTheme } from './theme.ts'

// A sun, for going light, and a moon, for going dark: the picture is where the press takes you, and the words say so.
const SUN = 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4'
const MOON = 'M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z'

/** Top right on every screen (ADR 0036): one press between dark and light, kept on this device. */
export function ThemeButton() {
  const { shown } = useTheme()
  const to = shown === 'dark' ? 'light' : 'dark'
  const words = `Switch to ${to}`
  return (
    <button type="button" className="theme-button" onClick={() => setTheme(to)} aria-label={words} title={words}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
        <path d={to === 'light' ? SUN : MOON} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
