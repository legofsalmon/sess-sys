import type { CommandArgs, Mutation } from '../commands.ts'
import { ASSISTANT_SETTING_ID, MESSAGES_SETTING_ID, OFFICE_SETTING_ID, READING_SETTING_ID, TIMESHEETS_SETTING_ID, type Setting, type SettingEntities } from '../office.ts'

/**
 * The office's details on a device: what the server has said, with this
 * device's own waiting change laid over it, as for the crew.
 */

export interface OfficeView {
  details: Setting | undefined
  /** Changed on this device and not yet on the server. */
  pending: boolean
  /** A director lets heads of department see crew rates (ADR 0046); off unless said. */
  headsSeeRates: boolean
  /** That choice changed on this device and not yet on the server. */
  headsPending: boolean
  /** The app prompts messages to crew (ADR 0048): Offer, Send, Tell and Ask open a WhatsApp, text or email. Off unless the office said. */
  promptMessages: boolean
  /** That choice changed on this device and not yet on the server. */
  messagesPending: boolean
  /** The company uses timesheets (ADR 0090): the Timesheets page, its counts and the freelancers' own. Off unless the office said. */
  useTimesheets: boolean
  /** That choice changed on this device and not yet on the server. */
  timesheetsPending: boolean
  /** Claude is offered inside the app (ADR 0096). Off unless the office said. */
  useAssistant: boolean
  /** That choice changed on this device and not yet on the server. */
  assistantPending: boolean
}

type Tables = { [E in keyof SettingEntities]: Record<string, SettingEntities[E]> }

export function officeView(entities: Partial<Tables>, outbox: readonly (Mutation & { appliedSeq?: number })[], cursor: number): OfficeView {
  // Snapshots saved before settings existed have no table for them.
  let details = entities.setting?.[OFFICE_SETTING_ID]
  let pending = false
  let headsSeeRates = entities.setting?.[READING_SETTING_ID]?.headsSeeRates === true
  let headsPending = false
  let promptMessages = entities.setting?.[MESSAGES_SETTING_ID]?.promptMessages === true
  let messagesPending = false
  let useTimesheets = entities.setting?.[TIMESHEETS_SETTING_ID]?.useTimesheets === true
  let timesheetsPending = false
  let useAssistant = entities.setting?.[ASSISTANT_SETTING_ID]?.useAssistant === true
  let assistantPending = false
  for (const m of outbox) {
    if (m.appliedSeq !== undefined && m.appliedSeq <= cursor) continue
    if (m.name === 'reading.heads') {
      headsSeeRates = (m.args as CommandArgs<'reading.heads'>).rates
      headsPending = true
    }
    if (m.name === 'messages.prompt') {
      promptMessages = (m.args as CommandArgs<'messages.prompt'>).on
      messagesPending = true
    }
    if (m.name === 'timesheets.use') {
      useTimesheets = (m.args as CommandArgs<'timesheets.use'>).on
      timesheetsPending = true
    }
    if (m.name === 'assistant.use') {
      useAssistant = (m.args as CommandArgs<'assistant.use'>).on
      assistantPending = true
    }
    if (m.name !== 'office.update') continue
    // Laid over what's known, so a change that doesn't say the VAT number or address keeps them, as the server does.
    const args = m.args as CommandArgs<'office.update'>
    details = { ...details, id: OFFICE_SETTING_ID, ...args }
    if (args.vatNumber === null || args.vatNumber === '') delete details.vatNumber
    if (args.address === null || args.address === '') delete details.address
    pending = true
  }
  return { details, pending, headsSeeRates, headsPending, promptMessages, messagesPending, useTimesheets, timesheetsPending, useAssistant, assistantPending }
}
