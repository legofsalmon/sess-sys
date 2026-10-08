/**
 * Sync now, and keep trying while it fails, backing off to once every 30
 * seconds (ADR 0001). Asked again while a sync is running, it's that same
 * sync, as `SyncClient.sync` has it, so it gets one answer and leaves one
 * retry, however many asked. A retry each would stack: a few "back online"
 * events while a slow round failed kept a phone on a poor signal trying
 * every few seconds for ten minutes, not every 30.
 */
export function keepSyncing(
  sync: () => Promise<void>,
  options: {
    /** Whether this device syncs at all just now: another tab of the app may be doing it. */
    may: () => boolean
    /** A failure that trying again won't fix, such as being signed out: dealt with here, and no retry. */
    stop: (err: unknown) => boolean
  }
): { soon: () => void; pause: () => void } {
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let asked: Promise<void> | undefined
  const soon = () => {
    clearTimeout(timer)
    if (!options.may()) return
    const running = sync()
    if (running === asked) return
    asked = running
    running.then(
      () => {
        failures = 0
      },
      (err: unknown) => {
        if (options.stop(err)) return
        failures++
        timer = setTimeout(soon, Math.min(30_000, 1000 * 2 ** failures))
      }
    )
  }
  return { soon, pause: () => clearTimeout(timer) }
}
