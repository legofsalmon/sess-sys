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
/** Set as the page starts again on its own, read once as it comes back, so the bar can say why. */
const RESTARTED = 'sh.restarted'
const listeners = new Set<(ready: boolean) => void>()
let ready = false
let reload: (() => Promise<void>) | undefined
let restarted = false

export function watchForUpdates() {
  // The page started again on its own a moment ago: say so, once.
  try {
    restarted = sessionStorage.getItem(RESTARTED) !== null
    sessionStorage.removeItem(RESTARTED)
  } catch {
    // Storage blocked: nothing to say it by.
  }
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
    // With no signal the file isn't gone, only out of reach: a reload would lose the page for nothing.
    if (!navigator.onLine) return
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
      sessionStorage.setItem(RESTARTED, '1')
    } catch {
      // Storage blocked: nothing to remember the reload by, but reload anyway.
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

/**
 * One line at the top until they reload; the page below moves down so it
 * hides nothing. `unkept` is how many changes waiting to sync a reload
 * would lose, because this browser keeps nothing between reloads: said
 * before they press. And when the page started again on its own, the same
 * line says so until it's dismissed.
 */
export function UpdateBar({ unkept = 0 }: { unkept?: number }) {
  const ready = useUpdateReady()
  const [said, setSaid] = useState(restarted)
  if (!ready && said)
    return (
      <div className="update">
        <span>Started again on the new version: the old one's files had gone.</span>
        <button
          type="button"
          onClick={() => {
            restarted = false
            setSaid(false)
          }}
        >
          Dismiss
        </button>
      </div>
    )
  if (!ready) return null
  const onReload = () => {
    void reload?.()
    // The new version takes the page over and reloads it. Should it not (an older browser, say), start again anyway.
    setTimeout(() => location.reload(), 2000)
  }
  return (
    <div className="update">
      <span>
        A new version is ready.
        {unkept > 0 &&
          ` ${unkept === 1 ? "1 change hasn't" : `${unkept} changes haven't`} synced yet, and this browser keeps nothing over a reload, so loading it now loses ${unkept === 1 ? 'it' : 'them'}. It can wait until ${unkept === 1 ? "it's" : "they've"} gone.`}
      </span>
      <button type="button" className="primary" onClick={onReload}>
        Load the new version
      </button>
    </div>
  )
}
