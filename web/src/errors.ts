import type { ClientConfig } from '@sh/shared'

/**
 * Reports of the app's own errors, from every phone and laptop (ADR 0005).
 * Off unless the server says where to send them. The setting is kept on
 * the device, so an app opened with no signal still reports, and a report
 * made offline waits on the device until it's back online. Sentry's code
 * is only downloaded when reporting is on.
 */

const base = import.meta.env.VITE_API_BASE ?? ''
const KEY = 'sh.errorReporting'

type Settings = ClientConfig['errors']

function remembered(): Settings {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Settings
  } catch {
    return null
  }
}

export async function startErrorReporting() {
  let settings = remembered()
  try {
    const res = await fetch(`${base}/api/config`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
    if (res.ok) {
      settings = ((await res.json()) as ClientConfig).errors
      try {
        localStorage.setItem(KEY, JSON.stringify(settings))
      } catch {
        // Storage full or blocked: it's only a convenience for starting offline.
      }
    }
  } catch {
    // No signal: go with what the server said last time.
  }
  if (!settings) return
  try {
    const { start } = await import('./errorsSdk.ts')
    start(settings)
  } catch {
    // Its code isn't on this device yet (a new version arriving, say): next time.
  }
}
