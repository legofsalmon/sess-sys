import type { Reading } from './reading.ts'
import { z } from 'zod'
import type { Role } from './roles.ts'
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

/**
 * How many changes one push may carry. Phones from before 18 October 2026
 * still send this many at a time, so the server keeps taking them.
 */
export const PUSH_LIMIT = 500

/**
 * How many changes a device sends at a time. Each takes the server a dozen
 * or more trips to the database, so 500 at the distance from the server to
 * the database outlasted the phone's wait, every time, and a phone with a
 * backlog never got through it (audit, 18 October 2026). Fifty go up in a
 * few seconds even then.
 */
export const PUSH_SLICE = 50

/**
 * How the feed is read. A device that last read an older one reads its copy
 * again from the start, once, keeping what it has waiting. 2: a pull that
 * found nothing new moved a device past any change that landed while it was
 * being answered, which it then never got (audit, 18 October 2026).
 */
export const FEED = 2

export const pushRequest = z.object({
  // "link:…" marks a freelancer's own answers in the history, so no device may call itself that.
  clientId: z.string().min(1).max(64).refine((id) => !id.startsWith('link:'), { message: 'That device id is reserved.' }),
  mutations: z.array(mutationSchema).max(PUSH_LIMIT),
  /**
   * When this push left the device, by the device's own clock. Against each
   * mutation's `createdAt`, on the same clock, it says how long the change
   * waited on the device (ADR 0006). Absent from older versions of the app.
   */
  sentAt: z.string().datetime({ offset: true }).optional(),
  /**
   * The copy of the data the device last pulled from. If the app has
   * started fresh since (ADR 0019), what the device sends belongs to what
   * was cleared, so none of it is applied. Absent from older versions of
   * the app, and from a device that hasn't pulled yet.
   */
  generation: z.string().max(100).optional(),
  /**
   * The device takes an answer to the first part of the push and sends the
   * rest again next round, so the server may stop short of a slow push's end
   * rather than leave the phone waiting past its time. Absent from older
   * versions of the app, which go on to their next slice whatever the answer
   * says, so they're answered in full, in order.
   */
  partial: z.boolean().optional(),
})
export type PushRequest = z.infer<typeof pushRequest>

export type MutationResult =
  | { id: string; status: 'applied'; seq: number; duplicate?: boolean }
  | { id: string; status: 'rejected'; reason: Rejection; duplicate?: boolean }

export interface PushResponse {
  /** In the order sent; when the push asked for `partial`, perhaps only the first of them, the rest left for the next push. */
  results: MutationResult[]
  /** Nothing applied: the app started fresh after the device's copy (see `generation`). Its next pull starts it afresh too. */
  stale?: boolean
  /**
   * The server is in the middle of a long change (bringing a calendar in, say) and couldn't take these in time: the
   * ones not in `results` go again shortly, without the device showing a problem.
   */
  busy?: boolean
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
  /**
   * Where the device is up to: the last change on this page, or, when there's
   * nothing new, the cursor it asked from. Never the head: a change that
   * lands while the pull is answered would fall between the two.
   */
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
   * (ADR 0019). A device starting its copy afresh then drops what it was
   * going to send again, which would bring back what was cleared.
   */
  cleared?: boolean
  /** The server holds made-up data to try the app with (ADR 0019), which every screen says, so nobody mistakes it for real work. */
  madeUp?: boolean
  /** The server's latest change number. Lower than a device's cursor means the server has lost changes. */
  head?: number
  /** How the server reads the feed (`FEED`); absent from servers older than 2. */
  feed?: number
  /**
   * False when this device's role can't see money (ADR 0042), so the
   * changes leave out prices and quotes. A device that's given money later
   * reads its copy again from the start, for what it was never sent.
   */
  money?: boolean
  /**
   * What this device's role reads of crew rates and private links (ADR
   * 0046), when anything is left out; absent when it reads everything. A
   * device told something different from last time reads its copy again
   * from the start, so every record it holds is as it would be sent now.
   */
  reading?: Reading
}

/** GET /api/data: whether the app holds made-up data, and when it last started fresh (ADR 0019). */
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
export type MeResponse =
  | { auth: 'off' }
  /** A demo copy: `role` is the persona chosen on its "See it as…" (ADR 0034), if one has been. */
  | { auth: 'passcode'; role?: Role }
  /** `role` is what they can change; `rolesOn` false while nobody is a director, when everyone can (ADR 0034). */
  | { auth: 'google'; user: StaffUser; role: Role; rolesOn: boolean }

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
  /** Each file is encrypted under the server's BACKUP_KEY, so it can't be read without it. Missing from older servers, which means no. */
  encrypted?: boolean
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
  /** What was done, in words, such as "Moved 4 × d&b Y10P from Bay A3 to Van 1". */
  what: string
  /** The command's name, such as `stock.move`. */
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
