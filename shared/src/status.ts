/**
 * The status of everything the app relies on (ADR 0093), as Admin › Status
 * shows it: the server, its database, sign-in and error reports; the
 * backups and the storage they and documents' files go in; and the
 * services outside it (Google Calendar, Current RMS, the AA's fuel survey,
 * the map search). Each says how it stands in words, and what to do when
 * it needs someone.
 */

/** Working; working but wants a look; not working; not set up (or switched off on purpose). */
export type StatusState = 'ok' | 'warn' | 'bad' | 'off'

/** Which part of the page a check sits in. */
export type StatusGroup = 'app' | 'safe' | 'outside'

export interface StatusCheck {
  /** Stays the same, for tests and links: "database", "backups"… */
  id: string
  group: StatusGroup
  /** What it is, in the office's words: "Database", "Nightly backups". */
  name: string
  state: StatusState
  /** How it stands, in a sentence. */
  says: string
  /** What to do about it, when something is wrong or off. */
  todo?: string
  /** When it last worked or ran, where that's known. */
  at?: string | null
  /** How long the look took, in milliseconds, for a check that asked something outside the server. */
  ms?: number
}

/** GET /api/status: every check, looked at together. */
export interface SystemStatus {
  /** When these were looked at. Kept for a minute, so a page opened twice doesn't ask everything twice. */
  checkedAt: string
  /** The version this server runs (changelog.ts), and the commit, on Railway. */
  version: string
  commit: string | null
  /** When this server started. */
  upSince: string
  checks: StatusCheck[]
}

export const STATUS_GROUPS: Record<StatusGroup, string> = {
  app: 'The app',
  safe: 'Keeping the data safe',
  outside: 'Services outside the app',
}

/** -1, 0 or 1 as version a is older than, the same as, or newer than b ("1.48.1"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  return 0
}

/** The top version in the changelog's own source, as GitHub has it on main; undefined when it doesn't read that way. */
export function versionInChangelog(source: string): string | undefined {
  return /version:\s*'(\d+\.\d+\.\d+)'/.exec(source)?.[1]
}
