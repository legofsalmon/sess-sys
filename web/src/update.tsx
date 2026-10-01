import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

/**
 * A deploy while the app is open. The new version is fetched in the
 * background and then waits: the page that's open keeps the files it was
 * built with until someone taps Reload, so a screen opened later (the
 * camera's QR reader, say) still loads. A laptop tab left open asks once
 * an hour whether there's anything new. Should a file still be missing,
 * the page starts again on the new version rather than sitting broken.
 */

const RELOADED = 'sh.reloadedAt'
const listeners = new Set<(ready: boolean) => void>()
let ready = false
let reload: (() => Promise<void>) | undefined

export function watchForUpdates() {
  const update = registerSW({
    onNeedRefresh() {
      ready = true
      for (const fn of listeners) fn(true)
    },
    onRegisteredSW(_url, registration) {
      // Browsers look for a new version on a page load, which a tab left open never does.
      if (registration) setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000)
    },
  })
  reload = () => update(true)

  addEventListener('vite:preloadError', (event) => {
    // A file this page was built with has gone, most likely because a new version
    // replaced it before the bar was answered. Not twice in a minute, so a build
    // that really is missing a file doesn't reload for ever.
    let last = 0
    try {
      last = Number(sessionStorage.getItem(RELOADED)) || 0
    } catch {
      // Storage blocked: reload anyway.
    }
    if (Date.now() - last < 60_000) return
    event.preventDefault()
    try {
      sessionStorage.setItem(RELOADED, String(Date.now()))
    } catch {
      // Same.
    }
    location.reload()
  })
}

function useUpdateReady() {
  const [state, setState] = useState(ready)
  useEffect(() => {
    listeners.add(setState)
    setState(ready)
    return () => void listeners.delete(setState)
  }, [])
  return state
}

/** One line at the top until they reload; the page below moves down so it hides nothing. */
export function UpdateBar() {
  if (!useUpdateReady()) return null
  return (
    <div className="update" role="status">
      <span>A new version is ready.</span>
      <button type="button" className="primary" onClick={() => void reload?.()}>
        Reload
      </button>
    </div>
  )
}
