import { z } from 'zod'
import { day } from './model.ts'

/**
 * Commands are what a device asks for, not rows it has already changed. The
 * server alone decides whether each one succeeds. Offline, the device shows
 * the command as pending; when it syncs, the server confirms or turns it
 * down with a reason a person can act on.
 */

const id = z.string().min(1).max(64)

export const commandSchemas = {
  'product.upsert': z.object({ id, name: z.string().min(1).max(200), quantity: z.number().int().min(0) }),
  'booking.create': z.object({
    id,
    productId: id,
    project: z.string().min(1).max(200),
    qty: z.number().int().min(1),
    start: day,
    end: day,
  }).refine((b) => b.start <= b.end, { message: 'The booking ends before it starts.' }),
  'booking.cancel': z.object({ id }),
  /** Always accepted: the scan already happened. */
  'scan.record': z.object({
    id,
    productId: id,
    bookingId: id.nullable(),
    direction: z.enum(['out', 'in']),
    at: z.string(),
  }),
} as const

export type CommandName = keyof typeof commandSchemas
export type CommandArgs<N extends CommandName> = z.infer<(typeof commandSchemas)[N]>

export const COMMAND_NAMES = Object.keys(commandSchemas) as CommandName[]

/** One command as it waits in a device's outbox and travels to the server. */
export interface Mutation<N extends CommandName = CommandName> {
  /** Unique per mutation; the server uses it to apply each one exactly once. */
  id: string
  name: N
  args: CommandArgs<N>
  /** Device clock when the person did it. Kept for the audit trail. */
  createdAt: string
}

export const mutationSchema = z.object({
  id,
  name: z.enum(COMMAND_NAMES as [CommandName, ...CommandName[]]),
  args: z.unknown(),
  createdAt: z.string(),
})

/** Why the server turned a command down, in words for the person who sent it. */
export interface Rejection {
  code: 'invalid' | 'not-found' | 'short' | 'conflict'
  message: string
  /** For `short`: how many more would be needed. */
  short?: number
}
