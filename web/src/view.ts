import { irishToday, type View } from '@sh/shared'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { client } from './sync.ts'

/**
 * What every screen reads: the device's view of the data, the day in
 * Ireland, and whether there's room for two columns. One of each for the
 * whole app (audit finding 24), so no screen keeps a day fixed at load, or
 * a UTC one, and is wrong after midnight.
 */

export function useView(): View {
  const today = useToday()
  const [view, setView] = useState(() => client.view())
  useEffect(() => client.subscribe(setView), [])
  // The view is kept by the day as well (shared/src/sync/client.ts), so a new day brings a fresh one even when nothing has changed.
  useEffect(() => setView(client.view()), [today])
  return view
}

/** The instant the day after `day` starts in Ireland. */
function nextIrishMidnight(day: string): number {
  const tomorrow = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  const utcMidnight = Date.parse(`${tomorrow}T00:00:00Z`)
  // In summer Ireland is an hour ahead of UTC, so its midnight comes an hour earlier.
  return irishToday(new Date(utcMidnight - 3_600_000)) === tomorrow ? utcMidnight - 3_600_000 : utcMidnight
}

// One clock for every screen showing a day: a timer for midnight, and a look whenever the app comes back from the background, where timers sleep.
let today = irishToday()
const watchers = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

function check() {
  const now = irishToday()
  if (now !== today) {
    today = now
    for (const w of watchers) w()
  }
  clearTimeout(timer)
  timer = setTimeout(check, Math.max(1000, nextIrishMidnight(today) - Date.now() + 1000))
}

function watch(onChange: () => void) {
  watchers.add(onChange)
  if (watchers.size === 1) {
    document.addEventListener('visibilitychange', check)
    check()
  }
  return () => {
    watchers.delete(onChange)
    if (watchers.size > 0) return
    document.removeEventListener('visibilitychange', check)
    clearTimeout(timer)
  }
}

/**
 * Today in Ireland, as 2026-10-05. A page left open overnight moves on at
 * midnight, and one woken from the background checks the day as it wakes,
 * so what's overdue, over or coming up is right in the morning.
 */
export function useToday(): string {
  return useSyncExternalStore(watch, () => today)
}

/** Laptop or phone: two columns are worth it from 960px (audit finding 25). */
const wide = typeof matchMedia === 'function' ? matchMedia('(min-width: 960px)') : undefined
export function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      wide?.addEventListener('change', onChange)
      return () => wide?.removeEventListener('change', onChange)
    },
    () => wide?.matches ?? false
  )
}
