import { MESSAGES_SETTING_ID, OFFICE_SETTING_ID, officeContact, READING_SETTING_ID, TIMESHEETS_SETTING_ID, type OfficeDetails, type Setting } from '@sh/shared'
import type { Queryable } from '../db.ts'

/** Reading settings back as the entity devices see, and the office's details for the freelancer pages. */

type Row = Record<string, any>

const toSetting = (r: Row): Setting => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  email: r.email,
  // Only once set, so a device or a test that knows nothing of them sees the office as before.
  ...(r.id === OFFICE_SETTING_ID && r.vat_number ? { vatNumber: r.vat_number } : {}),
  ...(r.id === OFFICE_SETTING_ID && r.address ? { address: r.address } : {}),
  ...(r.id === READING_SETTING_ID ? { headsSeeRates: r.heads_see_rates === true } : {}),
  ...(r.id === MESSAGES_SETTING_ID ? { promptMessages: r.prompt_messages === true } : {}),
  ...(r.id === TIMESHEETS_SETTING_ID ? { useTimesheets: r.use_timesheets === true } : {}),
})

export async function getSetting(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT id, name, phone, email, vat_number, address, heads_see_rates, prompt_messages, use_timesheets FROM settings WHERE id = $1`, [id])
  return rows[0] ? toSetting(rows[0]) : undefined
}

/** Whether a director has let heads of department see crew rates (ADR 0046); off unless said. */
export async function headsSeeRates(q: Queryable): Promise<boolean> {
  const { rows } = await q.query<{ heads_see_rates: boolean | null }>(`SELECT heads_see_rates FROM settings WHERE id = $1`, [READING_SETTING_ID])
  return rows[0]?.heads_see_rates === true
}

/** Whether the company uses timesheets (ADR 0089); off unless the office said. */
export async function usesTimesheets(q: Queryable): Promise<boolean> {
  const { rows } = await q.query<{ use_timesheets: boolean | null }>(`SELECT use_timesheets FROM settings WHERE id = $1`, [TIMESHEETS_SETTING_ID])
  return rows[0]?.use_timesheets === true
}

/** The office's details when there's a phone or an email to show; null until they're set. */
export async function officeFor(q: Queryable): Promise<OfficeDetails | null> {
  return officeContact(await getSetting(q, OFFICE_SETTING_ID))
}
