import { useEffect, useState } from 'react'

/**
 * Whether this browser keeps the app's copy of the data for good (audit
 * finding 16). Unasked, a browser may clear a site's storage to make room,
 * and Safari clears one unused for a week unless it's on the Home Screen,
 * taking changes still waiting to sync with it. So the app asks, once
 * someone is signed in, and You says which it is.
 *
 * `undefined` while not known, and in a browser that doesn't say.
 */

let kept: boolean | undefined
let asked = false
const listeners = new Set<(kept: boolean | undefined) => void>()

function tell(next: boolean | undefined) {
  kept = next
  for (const fn of listeners) fn(next)
}

/** Ask the browser to keep the copy (once a session unless `again`), and say what it answered. */
export async function askToKeep(again = false): Promise<boolean | undefined> {
  if (asked && !again) return kept
  asked = true
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
  if (!storage?.persisted || !storage.persist) return undefined
  try {
    // Asked only when it isn't kept already: some browsers ask the person, and once is enough.
    tell((await storage.persisted()) || (await storage.persist()))
  } catch {
    // A browser that won't say: leave it unknown.
  }
  return kept
}

export function useKept(): boolean | undefined {
  const [state, setState] = useState(kept)
  useEffect(() => {
    listeners.add(setState)
    setState(kept)
    // Read, not asked, for a screen opened before sign-in did.
    void navigator.storage
      ?.persisted?.()
      .then((k) => kept === undefined && tell(k))
      .catch(() => {})
    return () => void listeners.delete(setState)
  }, [])
  return state
}
