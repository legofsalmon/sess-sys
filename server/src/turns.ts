/**
 * The few jobs that hold the whole company in memory at once take turns
 * (audit, 20 October 2026, finding 9): a backup with its test restore, and
 * a download of everything. Side by side they took the server past the
 * 1 GB Railway gives it, which restarts it mid-backup; one after the other,
 * the second waits a few seconds. On this server only: during a deploy the
 * one it replaces keeps its own turns for the moment it has left.
 */

let last: Promise<unknown> = Promise.resolve()

/** Runs `work` once everything that took a turn before it has finished, whether that worked or not. */
export function takeTurns<T>(work: () => Promise<T>): Promise<T> {
  const run = last.then(work, work)
  last = run.catch(() => undefined)
  return run
}
