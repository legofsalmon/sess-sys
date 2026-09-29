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
  clientId: z.string().min(1).max(64),
  mutations: z.array(mutationSchema).max(500),
})
export type PushRequest = z.infer<typeof pushRequest>

export type MutationResult =
  | { id: string; status: 'applied'; seq: number; duplicate?: boolean }
  | { id: string; status: 'rejected'; reason: Rejection; duplicate?: boolean }

export interface PushResponse {
  results: MutationResult[]
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
  /** The server's latest change number. Lower than a device's cursor means the server has lost changes. */
  head?: number
}

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
  trigger: 'nightly' | 'catch-up' | 'retry' | 'manual'
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
