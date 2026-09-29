import { SyncClient } from '@sh/shared'
import { markSignedOut } from './auth.ts'
import { IndexedDbStorage } from './storage.ts'
import { HttpTransport, SignedOutError } from './transport.ts'

export const transport = new HttpTransport(import.meta.env.VITE_API_BASE ?? '')
export const storage = new IndexedDbStorage()
export const client = await new SyncClient({ storage, transport }).open()

/** Try now, and keep trying while offline, backing off to once every 30 s. */
let failures = 0
let timer: ReturnType<typeof setTimeout> | undefined
export function syncSoon() {
  clearTimeout(timer)
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

transport.listen((cursor) => {
  if (cursor > client.view().cursor) syncSoon()
})
addEventListener('online', syncSoon)
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncSoon())
setInterval(syncSoon, 30_000)
syncSoon()
