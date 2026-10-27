import { z } from 'zod'
import { countCommandSchemas } from './counts.ts'
import { crewCommandSchemas } from './crew.ts'
import { documentCommandSchemas } from './documents.ts'
import { erasureCommandSchemas } from './erasure.ts'
import { faultCommandSchemas } from './faults.ts'
import { inspectionCommandSchemas } from './inspections.ts'
import { jobCommandSchemas } from './jobs.ts'
import { kitCommandSchemas } from './kit.ts'
import { notesKitCommandSchemas } from './kit-notes.ts'
import { labelCommandSchemas } from './labels.ts'
import { lateCommandSchemas } from './late.ts'
import { leaveCommandSchemas } from './leave.ts'
import { mergeCommandSchemas } from './merge-people.ts'
import { moveCommandSchemas } from './moves.ts'
import { officeCommandSchemas } from './office.ts'
import { stockCommandSchemas } from './stock.ts'
import { timesheetCommandSchemas } from './timesheets.ts'
import { attachmentCommandSchemas } from './attachments.ts'
import { quoteCommandSchemas } from './quotes.ts'
import { ownCalendarCommandSchemas } from './own-calendar.ts'
import { vehicleCommandSchemas } from './vehicles.ts'
import { stepCommandSchemas } from './steps.ts'
import { rackCommandSchemas } from './racks.ts'
import { purchaseCommandSchemas } from './purchases.ts'

/**
 * Commands are what a device asks for, not rows it has already changed. The
 * server alone decides whether each one succeeds. Offline, the device shows
 * the command as pending; when it syncs, the server confirms or turns it
 * down with a reason a person can act on.
 */

const id = z.string().min(1).max(64)

export const commandSchemas = {
  ...crewCommandSchemas,
  ...mergeCommandSchemas,
  ...jobCommandSchemas,
  ...stockCommandSchemas,
  ...kitCommandSchemas,
  ...notesKitCommandSchemas,
  ...labelCommandSchemas,
  ...moveCommandSchemas,
  ...faultCommandSchemas,
  ...inspectionCommandSchemas,
  ...timesheetCommandSchemas,
  ...officeCommandSchemas,
  ...leaveCommandSchemas,
  ...lateCommandSchemas,
  ...erasureCommandSchemas,
  ...documentCommandSchemas,
  ...countCommandSchemas,
  ...attachmentCommandSchemas,
  ...quoteCommandSchemas,
  ...ownCalendarCommandSchemas,
  ...vehicleCommandSchemas,
  ...stepCommandSchemas,
  ...rackCommandSchemas,
  ...purchaseCommandSchemas,
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
  /**
   * How far the device's copy had read the change feed when the person made
   * it: what they were looking at. An edit to a record someone else has
   * changed since is turned down rather than saved over theirs (audit, 18
   * October 2026). Absent from older versions of the app, whose edits apply
   * in the order they arrive, as before.
   */
  seen?: number
}

export const mutationSchema = z.object({
  id,
  // Any name: one this version doesn't know, from a phone on an older one, is turned down on its own rather than with the whole push (server/src/commands.ts).
  name: z.string().min(1).max(64),
  args: z.unknown(),
  createdAt: z.string().max(40),
  // Anything but a change number counts as not said, so the change applies as from an older version rather than failing the push.
  seen: z.number().int().nonnegative().optional().catch(undefined),
})

/** Why the server turned a command down, in words for the person who sent it. */
export interface Rejection {
  code: 'invalid' | 'not-found' | 'short' | 'conflict' | 'clash' | 'filled' | 'forbidden'
  message: string
  /** For `short`: how many more would be needed. */
  short?: number
}
