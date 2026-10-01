/**
 * One tab writes. Two tabs of the app each hold a copy of the data and
 * would save over each other, last writer wins, and both would send the
 * same outbox. So the first tab to open takes a lock and does the syncing
 * and saving; another opened beside it shows what it loaded but keeps and
 * sends nothing, with a bar saying so and "Use this tab", which asks the
 * first to let go and takes over. Web Locks hold the lock, which the browser
 * lets go of when a tab closes or crashes, and a BroadcastChannel carries
 * "let go". A browser without Web Locks goes by the channel alone: the
 * newest tab wins and the other goes read-only. With neither, every tab
 * writes, as before.
 */

export type TabRole = 'writer' | 'reader'

const LOCK = 'session-hire-data'
const CHANNEL = 'session-hire-tabs'
/** A lock manager that never answers would leave the page blank; past this the tab goes on as if there were none. */
const WAIT_MS = 15_000

let role: TabRole = 'writer'
const listeners = new Set<(role: TabRole) => void>()
/** Ends this tab's hold on the lock. */
let letGo: (() => void) | undefined
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : undefined
const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined

export const tabRole = () => role

export function onTabRole(fn: (role: TabRole) => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** A word to the other tabs: a take-over, or a wipe on signing out (storage.ts). */
export function tellTabs(type: 'take-over' | 'wipe') {
  channel?.postMessage({ type })
}

export function onTabMessage(type: 'take-over' | 'wipe', fn: () => void) {
  channel?.addEventListener('message', (e: MessageEvent<{ type?: string }>) => {
    if (e.data?.type === type) fn()
  })
}

function become(next: TabRole) {
  if (role === next) return
  role = next
  for (const fn of listeners) fn(next)
}

/** Another tab is taking over: from here on this one keeps and sends nothing. */
function standDown() {
  letGo?.()
  letGo = undefined
  become('reader')
}

onTabMessage('take-over', standDown)

/**
 * Take the lock and hold it until this tab lets go: true once held, false
 * when another tab has it, undefined when the lock manager won't work here.
 */
function hold(options: LockOptions): Promise<boolean | undefined> {
  return new Promise((resolve) => {
    const failed = (err: unknown) => {
      // Taken from this tab by another ("Use this tab" there): it reads only now.
      if (err instanceof DOMException && err.name === 'AbortError') {
        resolve(false)
        standDown()
      }
      // Anything else is the lock manager refusing (an opaque origin, say),
      // not another tab holding the lock: there is no lock to go by.
      else resolve(undefined)
    }
    try {
      locks!
        .request(LOCK, options, async (lock) => {
          resolve(lock !== null)
          if (lock) await new Promise<void>((done) => (letGo = done))
        })
        .catch(failed)
    } catch (err) {
      failed(err)
    }
  })
}

const giveUp = () => new Promise<undefined>((resolve) => setTimeout(resolve, WAIT_MS))

/** Which tab this is, settled before the copy of the data is loaded. */
export async function claimTab(): Promise<TabRole> {
  const held = locks ? await Promise.race([hold({ ifAvailable: true }), giveUp()]) : undefined
  if (held === undefined) {
    // No lock to go by: say so, and a tab already writing stands down.
    tellTabs('take-over')
    become('writer')
  } else become(held ? 'writer' : 'reader')
  return role
}

/** "Use this tab": the other is told to let go, and this one starts again on the latest copy. */
export async function takeOverTab() {
  tellTabs('take-over')
  // Taken whether or not the other tab answers: in the background on a phone it may be asleep.
  if (locks) await Promise.race([hold({ steal: true }), giveUp()])
  // The other tab may have saved since this one loaded, so it's loaded again rather than written over.
  location.reload()
}
