import type { ClientConfig, SyncClient, Transport } from '@sh/shared'
import { versionRead } from './version.ts'

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
    const loaded = await import('./errorsSdk.ts')
    loaded.start(settings, await versionRead)
    sdk = loaded
  } catch {
    // Its code isn't on this device yet (a new version arriving, say): next time.
  }
}

let sdk: typeof import('./errorsSdk.ts') | undefined

/** Report something the app noticed itself, rather than an error thrown. Does nothing while reporting is off. */
function report(err: Error) {
  sdk?.report(err)
}

/** Sending this device's changes has kept failing while it says it has a signal (audit findings 2 and 19). */
class PushFailing extends Error {
  override name = 'PushFailing'
}

/** Something has waited on this device to be sent for over a day. */
class OutboxStale extends Error {
  override name = 'OutboxStale'
}

/** Failures in a row, with a signal, before it's reported: with the retries backing off, about a quarter of a minute. */
export const PUSH_FAILURES = 4
const DAY = 86_400_000

/**
 * What the sync's own errors don't say, since a device that can't send keeps
 * trying without complaint (ADR 0005, audit finding 19): pushes failing again
 * and again while there's a signal, and a change waiting over a day. Each is
 * reported once, until it clears. The transport's push is wrapped here, so
 * nothing about how the sync runs changes.
 */
export function watchSync(
  client: SyncClient,
  transport: Transport,
  { isSignedOut = () => false, writing = () => true }: { isSignedOut?: (err: unknown) => boolean; writing?: () => boolean } = {}
) {
  let failures = 0
  const push = transport.push.bind(transport)
  transport.push = async (req) => {
    try {
      const res = await push(req)
      failures = 0
      return res
    } catch (err) {
      // No signal is what retries are for; signed out has its own screen.
      if (navigator.onLine && !isSignedOut(err) && ++failures === PUSH_FAILURES) {
        report(new PushFailing(`Sending ${req.mutations.length === 1 ? 'a change' : `${req.mutations.length} changes`} has failed ${PUSH_FAILURES} times in a row: ${err instanceof Error ? err.message : String(err)}`))
      }
      throw err
    }
  }
  const told = new Set<string>()
  const look = () => {
    if (!writing()) return
    const oldest = client.waiting[0]
    if (!oldest || told.has(oldest.id) || Date.now() - Date.parse(oldest.createdAt) < DAY) return
    told.add(oldest.id)
    const hours = Math.floor((Date.now() - Date.parse(oldest.createdAt)) / 3_600_000)
    report(new OutboxStale(`A change (${oldest.name}) has waited ${hours} hours on this device to be sent, with ${client.pendingCount} waiting in all`))
  }
  // First a minute in, once reporting has had time to start; then every ten.
  setTimeout(look, 60_000)
  setInterval(look, 10 * 60_000)
}
