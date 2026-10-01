import { SyncClient } from '@sh/shared'
import { markSignedOut } from './auth.ts'
import { openStorage } from './storage.ts'
import { claimTab, onTabMessage, onTabRole, tabRole } from './tabs.ts'
import { HttpTransport, SignedOutError } from './transport.ts'

/**
 * This device's copy of the data and the client that keeps it in step with
 * the server. Nothing here can fail to start: storage that won't open is
 * kept in memory instead (storage.ts), and a second tab of the app reads
 * only (tabs.ts), so the page is never left blank.
 */

export const transport = new HttpTransport(import.meta.env.VITE_API_BASE ?? '')
// Which tab does the writing is settled before the copy is loaded, so a second tab never saves over the first.
await claimTab()
export const storage = await openStorage()
export const client = await new SyncClient({ storage, transport }).open()

/** Try now, and keep trying while offline, backing off to once every 30 s. */
let failures = 0
let timer: ReturnType<typeof setTimeout> | undefined
export function syncSoon() {
  clearTimeout(timer)
  // Another tab is doing the syncing and saving; this one shows what it loaded.
  if (tabRole() !== 'writer') return
  client.sync().then(
    () => {
      failures = 0
    },
    (err) => {
      // Changes stay in the outbox; they go once the person signs in again.
      if (err instanceof SignedOutError) return markSignedOut()
      failures++
      timer = setTimeout(syncSoon, Math.min(30_000, 1000 * 2 ** failures))
    }
  )
}
onTabRole(() => clearTimeout(timer))
// Signed out in another tab, which wiped the copy: this one keeps nothing more and goes to sign in too.
onTabMessage('wipe', () => {
  storage.forget()
  markSignedOut()
})

// Behind this device too: the server started fresh or was restored, which a pull finds out.
try {
  transport.listen((cursor) => {
    if (cursor !== client.cursor) syncSoon()
  })
} catch {
  // A browser that won't open a WebSocket here: the 30-second tick still syncs.
}
addEventListener('online', syncSoon)
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncSoon())
setInterval(syncSoon, 30_000)
syncSoon()
