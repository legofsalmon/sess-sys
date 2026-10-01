import type { CommandArgs, Mutation } from '../commands.ts'
import { OFFICE_SETTING_ID, type Setting, type SettingEntities } from '../office.ts'

/**
 * The office's details on a device: what the server has said, with this
 * device's own waiting change laid over it, as for the crew.
 */

export interface OfficeView {
  details: Setting | undefined
  /** Changed on this device and not yet on the server. */
  pending: boolean
}

type Tables = { [E in keyof SettingEntities]: Record<string, SettingEntities[E]> }

export function officeView(entities: Partial<Tables>, outbox: readonly (Mutation & { appliedSeq?: number })[], cursor: number): OfficeView {
  // Snapshots saved before settings existed have no table for them.
  let details = entities.setting?.[OFFICE_SETTING_ID]
  let pending = false
  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    if (m.name !== 'office.update') continue
    details = { id: OFFICE_SETTING_ID, ...(m.args as CommandArgs<'office.update'>) }
    pending = true
  }
  return { details, pending }
}
