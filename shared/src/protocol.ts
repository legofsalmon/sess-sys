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
}

export interface Poke {
  type: 'poke'
  cursor: number
}
