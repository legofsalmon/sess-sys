import { useEffect, useState } from 'react'

/**
 * Dark or light (ADR 0036). Dark unless this device has been told
 * otherwise: the design system's default, and the app is used in dark
 * venues and vans as much as in the office. Light is a press away, top
 * right on every screen, and You also offers "match this device", which
 * follows the phone's own setting. The choice is this device's own, kept
 * in localStorage under `sh.theme`; index.html reads the same key before
 * the page is drawn, so it never opens in the wrong one and flicks over.
 */
export type Theme = 'dark' | 'light' | 'auto'

const KEY = 'sh.theme'
const listeners = new Set<(t: Theme) => void>()
let current = read()

function read(): Theme {
  try {
    const kept = localStorage.getItem(KEY)
    return kept === 'light' || kept === 'auto' ? kept : 'dark'
  } catch {
    return 'dark'
  }
}

export function setTheme(theme: Theme) {
  current = theme
  document.documentElement.dataset.theme = theme
  try {
    if (theme === 'dark') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // Private browsing can refuse storage; the choice holds this visit.
  }
  for (const fn of listeners) fn(theme)
}

const phoneIsLight = () => matchMedia('(prefers-color-scheme: light)').matches

/** The choice made, and which of the two is on screen now ("auto" is whichever the phone is set to). */
export function useTheme(): { theme: Theme; shown: 'dark' | 'light' } {
  const [theme, set] = useState(current)
  const [light, setLight] = useState(phoneIsLight)
  useEffect(() => {
    listeners.add(set)
    set(current)
    const phone = matchMedia('(prefers-color-scheme: light)')
    const on = () => setLight(phone.matches)
    phone.addEventListener('change', on)
    return () => {
      listeners.delete(set)
      phone.removeEventListener('change', on)
    }
  }, [])
  return { theme, shown: theme === 'auto' ? (light ? 'light' : 'dark') : theme }
}

/**
 * On paper, light whatever the screen's theme: a screen printed as it is (Cmd-P on a job, not its Print button) would otherwise come out
 * as pale words on the white paper (audit, 20 October 2026, findings 60e and 61). Only while the print dialog is open; the choice kept is
 * untouched. app.css also sets the light colour scheme under print, for a PDF made without the dialog.
 */
export function printLight() {
  addEventListener('beforeprint', () => (document.documentElement.dataset.theme = 'light'))
  addEventListener('afterprint', () => (document.documentElement.dataset.theme = current))
}
