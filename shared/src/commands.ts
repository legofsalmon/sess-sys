import { z } from 'zod'
import { crewCommandSchemas } from './crew.ts'
import { faultCommandSchemas } from './faults.ts'
import { inspectionCommandSchemas } from './inspections.ts'
import { jobCommandSchemas } from './jobs.ts'
import { kitCommandSchemas } from './kit.ts'
import { labelCommandSchemas } from './labels.ts'
import { lateCommandSchemas } from './late.ts'
import { leaveCommandSchemas } from './leave.ts'
import { moveCommandSchemas } from './moves.ts'
import { officeCommandSchemas } from './office.ts'
import { stockCommandSchemas } from './stock.ts'
import { timesheetCommandSchemas } from './timesheets.ts'

/**
 * Commands are what a device asks for, not rows it has already changed. The
 * server alone decides whether each one succeeds. Offline, the device shows
 * the command as pending; when it syncs, the server confirms or turns it
 * down with a reason a person can act on.
 */

const id = z.string().min(1).max(64)

export const commandSchemas = {
  ...crewCommandSchemas,
  ...jobCommandSchemas,
  ...stockCommandSchemas,
  ...kitCommandSchemas,
  ...labelCommandSchemas,
  ...moveCommandSchemas,
  ...faultCommandSchemas,
  ...inspectionCommandSchemas,
  ...timesheetCommandSchemas,
  ...officeCommandSchemas,
  ...leaveCommandSchemas,
  ...lateCommandSchemas,
} as const

export type CommandName = keyof typeof commandSchemas
/** A command's arguments once checked, as its handler gets them. */
export type CommandArgs<N extends CommandName> = z.infer<(typeof commandSchemas)[N]>
/** What a device may send: the same, with fields added since then left out if it likes. */
export type CommandInput<N extends CommandName> = z.input<(typeof commandSchemas)[N]>

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
  // Any name: one this version doesn't know, from a phone on an older one, is turned down on its own rather than with the whole push (server/src/commands.ts).
  name: z.string().min(1).max(64),
  args: z.unknown(),
  createdAt: z.string().max(40),
})

/** Why the server turned a command down, in words for the person who sent it. */
export interface Rejection {
  code: 'invalid' | 'not-found' | 'short' | 'conflict' | 'clash' | 'filled' | 'forbidden'
  message: string
  /** For `short`: how many more would be needed. */
  short?: number
}
