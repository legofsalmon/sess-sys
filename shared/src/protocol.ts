import { z } from 'zod'
import { mutationSchema, type Rejection } from './commands.ts'
import type { EntityName } from './model.ts'

/**
 * The sync wire protocol, three calls:
 *
 * - push: send the outbox, in order. Each mutation comes back applied,
 *   rejected (with a reason), or a duplicate of one already applied, whose
 *   original answer is repeated.
 * - pull: fetch every change after the cursor the device already has. The
 *   cursor is the server's change sequence number, so a device that has been
 *   offline for a week gets exactly the gap.
 * - live: a WebSocket that only says "there is something new up to N". The
 *   device then pulls. Keeping data off the socket means a dropped socket
 *   never loses anything; the next pull covers it.
 */

export const pushRequest = z.object({
  // "link:…" marks a freelancer's own answers in the history, so no device may call itself that.
  clientId: z.string().min(1).max(64).refine((id) => !id.startsWith('link:'), { message: 'That device id is reserved.' }),
  mutations: z.array(mutationSchema).max(500),
  /**
   * When this push left the device, by the device's own clock. Against each
   * mutation's `createdAt`, on the same clock, it says how long the change
   * waited on the device (ADR 0006). Absent from older versions of the app.
   */
  sentAt: z.string().datetime({ offset: true }).optional(),
  /**
   * The copy of the data the device last pulled from. If the app has
   * started fresh since (ADR 0018), what the device sends belongs to what
   * was cleared, so none of it is applied. Absent from older versions of
   * the app, and from a device that hasn't pulled yet.
   */
  generation: z.string().max(100).optional(),
})
export type PushRequest = z.infer<typeof pushRequest>

export type MutationResult =
  | { id: string; status: 'applied'; seq: number; duplicate?: boolean }
  | { id: string; status: 'rejected'; reason: Rejection; duplicate?: boolean }

export interface PushResponse {
  results: MutationResult[]
  /** Nothing applied: the app started fresh after the device's copy (see `generation`). Its next pull starts it afresh too. */
  stale?: boolean
}

export interface Change {
  seq: number
  entity: EntityName
  id: string
  op: 'put' | 'delete'
  data: unknown
}

export interface PullResponse {
  changes: Change[]
  cursor: number
  more: boolean
  /**
   * Which copy of the data the server holds. It changes when the server's
   * data is restored from a backup, and a device that sees it change starts
   * its own copy afresh (ADR 0004). Absent from servers older than that.
   */
  generation?: string
  /**
   * This copy of the data began empty on purpose: someone started fresh
   * (ADR 0018). A device starting its copy afresh then drops what it was
   * going to send again, which would bring back what was cleared.
   */
  cleared?: boolean
  /** The server holds made-up data to try the app with (ADR 0018), which every screen says, so nobody mistakes it for real work. */
  madeUp?: boolean
  /** The server's latest change number. Lower than a device's cursor means the server has lost changes. */
  head?: number
}

/** GET /api/data: whether the app holds made-up data, and when it last started fresh (ADR 0018). */
export interface DataStatus {
  /** Nothing has been done in the app since it began or started fresh, so made-up data can go in. */
  empty: boolean
  /** When made-up data was put in, and by whom; null when there's none. */
  madeUp: { at: string; by: string | null } | null
  /** When the app last started fresh, and by whom; null if it never has. */
  fresh: { at: string; by: string | null } | null
  /** Google Calendar is connected, which has to be undone before starting fresh. */
  calendarConnected: boolean
  /** Backups are set up, so one is made before starting fresh. */
  backups: boolean
}

/** POST /api/data/start-fresh: typed, so it can't be done by a slip. */
export const START_FRESH_WORDS = 'delete everything'

export interface Poke {
  type: 'poke'
  cursor: number
}

/** A member of staff, signed in to the app with their Google account. */
export interface StaffUser {
  id: string
  email: string
  name: string
  picture?: string
}

/**
 * GET /api/me: whether this server has sign-in switched on, and who the
 * device is signed in as. Answers 401 when sign-in is on and the device
 * isn't signed in.
 */
export type MeResponse = { auth: 'off' } | { auth: 'google'; user: StaffUser }

/** One nightly (or "Back up now") backup, as the Account screen shows it. */
export interface BackupRun {
  id: string
  startedAt: string
  finishedAt?: string
  status: 'running' | 'ok' | 'failed'
  trigger: 'nightly' | 'catch-up' | 'retry' | 'manual' | 'fresh'
  /** The file's name in the backup storage. */
  key?: string
  bytes?: number
  rows?: number
  error?: string
}

/** GET /api/backups. */
export interface BackupStatus {
  /** False until the server has somewhere to put backups. */
  configured: boolean
  /** Where they go, without any secret: "bucket … at …". */
  where?: string
  last?: BackupRun
  /** The last run that made a file and proved it by a test restore. */
  lastOk?: BackupRun
  /** A good backup in the last 26 hours. */
  fresh: boolean
  /** When the next one is due. */
  next?: string
}

/** GET /api/config: what the app needs from the server before anyone has signed in. */
export interface ClientConfig {
  /** Where the app sends reports of its own errors (ADR 0005); null while error reporting is off. */
  errors: { dsn: string; environment: string } | null
}

/**
 * One entry in the history (ADR 0006): something a person asked for, or a
 * download of everything, with who, when, from which device, and what the
 * server said.
 */
export interface HistoryEntry {
  id: string
  /** What was done, in words, such as "Booked 4 × d&b Y10P for Electric Picnic, Fri 2 Oct to Sun 4 Oct". */
  what: string
  /** The command's name, such as `booking.create`. */
  command: string
  outcome: 'done' | 'turned-down'
  /** Why the server turned it down. */
  reason?: string
  who: {
    /** A member of staff; a freelancer on their private link, or answering in Google Calendar (ADR 0009); or nobody known. */
    kind: 'staff' | 'link' | 'calendar' | 'unknown'
    /** The person's name; "Someone" when sign-in was off. */
    name: string
    /** The filter value for this person, as in `HistoryPage.people`. */
    key?: string
  }
  /** The kind of device, such as "Safari on iPhone", when it said. */
  device?: string
  /** The end of the device's own code, as its Account tab shows it. */
  deviceCode?: string
  /** When it was done, on the server's clock. */
  madeAt: string
  /** When it reached the server. */
  arrivedAt: string
  /** How long it waited on the device before it was sent, when the device said. */
  waitedSeconds?: number
  /** Waited on the device a minute or more: made with no signal, or with the app closed before it could send. */
  madeOffline: boolean
  /** The records it changed. */
  records: { entity: string; id: string }[]
}

/** GET /api/history: newest first. */
export interface HistoryPage {
  entries: HistoryEntry[]
  /** Pass as `before` for the next, older page; absent at the start of the history. */
  next?: string
  /** Everyone the history can be narrowed to, on the first page only. */
  people?: { key: string; name: string }[]
}
