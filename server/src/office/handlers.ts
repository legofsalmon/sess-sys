import { ASSISTANT_SETTING_ID, MESSAGES_SETTING_ID, OFFICE_SETTING_ID, READING_SETTING_ID, TIMESHEETS_SETTING_ID, type CommandArgs } from '@sh/shared'
import { emit, type Ctx } from '../kernel.ts'
import { getSetting } from './store.ts'

/**
 * The office's details (audit finding 10): set from the Account tab, shown
 * on every freelancer page. One office, so the command replaces them whole.
 */

type OfficeCommand = 'office.update' | 'reading.heads' | 'messages.prompt' | 'timesheets.use' | 'assistant.use'
type Handler<N extends OfficeCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

export const officeHandlers: { [N in OfficeCommand]: Handler<N> } = {
  async 'office.update'(ctx, a) {
    await ctx.tx.query(
      `INSERT INTO settings (id, name, phone, email) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, email = EXCLUDED.email, updated_at = now()`,
      [OFFICE_SETTING_ID, a.name, a.phone, a.email]
    )
    // Left as they were by a change that doesn't say them, as one from an app older than them doesn't.
    if (a.vatNumber !== undefined) await ctx.tx.query(`UPDATE settings SET vat_number = $2 WHERE id = $1`, [OFFICE_SETTING_ID, a.vatNumber || null])
    if (a.address !== undefined) await ctx.tx.query(`UPDATE settings SET address = $2 WHERE id = $1`, [OFFICE_SETTING_ID, a.address || null])
    await emit(ctx, 'setting', OFFICE_SETTING_ID, await getSetting(ctx.tx, OFFICE_SETTING_ID))
  },

  /**
   * Whether heads of department see crew rates (ADR 0046). Their devices
   * hear of it at their next sync, and read their copy again with the rates
   * in or out.
   */
  async 'reading.heads'(ctx, a) {
    await ctx.tx.query(
      `INSERT INTO settings (id, heads_see_rates) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET heads_see_rates = EXCLUDED.heads_see_rates, updated_at = now()`,
      [READING_SETTING_ID, a.rates]
    )
    await emit(ctx, 'setting', READING_SETTING_ID, await getSetting(ctx.tx, READING_SETTING_ID))
  },

  /** Whether Offer, Send, Tell and Ask open a message to a real person (ADR 0048). Every device hears at its next sync. */
  async 'messages.prompt'(ctx, a) {
    await ctx.tx.query(
      `INSERT INTO settings (id, prompt_messages) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET prompt_messages = EXCLUDED.prompt_messages, updated_at = now()`,
      [MESSAGES_SETTING_ID, a.on]
    )
    await emit(ctx, 'setting', MESSAGES_SETTING_ID, await getSetting(ctx.tx, MESSAGES_SETTING_ID))
  },

  /** Whether the company uses timesheets (ADR 0090). Only shows or hides them: every timesheet kept stays as it was. */
  async 'timesheets.use'(ctx, a) {
    await ctx.tx.query(
      `INSERT INTO settings (id, use_timesheets) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET use_timesheets = EXCLUDED.use_timesheets, updated_at = now()`,
      [TIMESHEETS_SETTING_ID, a.on]
    )
    await emit(ctx, 'setting', TIMESHEETS_SETTING_ID, await getSetting(ctx.tx, TIMESHEETS_SETTING_ID))
  },

  /** Whether Claude is offered inside the app (ADR 0096). Only shows or hides it: nothing Claude suggested and someone took changes. */
  async 'assistant.use'(ctx, a) {
    await ctx.tx.query(
      `INSERT INTO settings (id, use_assistant) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET use_assistant = EXCLUDED.use_assistant, updated_at = now()`,
      [ASSISTANT_SETTING_ID, a.on]
    )
    await emit(ctx, 'setting', ASSISTANT_SETTING_ID, await getSetting(ctx.tx, ASSISTANT_SETTING_ID))
  },
}
