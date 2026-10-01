import { OFFICE_SETTING_ID, type CommandArgs } from '@sh/shared'
import { emit, type Ctx } from '../kernel.ts'
import { getSetting } from './store.ts'

/**
 * The office's details (audit finding 10): set from the Account tab, shown
 * on every freelancer page. One office, so the command replaces them whole.
 */

type OfficeCommand = 'office.update'
type Handler<N extends OfficeCommand> = (ctx: Ctx, args: CommandArgs<N>) => Promise<void>

export const officeHandlers: { [N in OfficeCommand]: Handler<N> } = {
  async 'office.update'(ctx, a) {
    await ctx.tx.query(
      `INSERT INTO settings (id, name, phone, email) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, email = EXCLUDED.email, updated_at = now()`,
      [OFFICE_SETTING_ID, a.name, a.phone, a.email]
    )
    await emit(ctx, 'setting', OFFICE_SETTING_ID, await getSetting(ctx.tx, OFFICE_SETTING_ID))
  },
}
