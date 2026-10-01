import { OFFICE_SETTING_ID, officeContact, type OfficeDetails, type Setting } from '@sh/shared'
import type { Queryable } from '../db.ts'

/** Reading settings back as the entity devices see, and the office's details for the freelancer pages. */

type Row = Record<string, any>

const toSetting = (r: Row): Setting => ({ id: r.id, name: r.name, phone: r.phone, email: r.email })

export async function getSetting(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT id, name, phone, email FROM settings WHERE id = $1`, [id])
  return rows[0] ? toSetting(rows[0]) : undefined
}

/** The office's details when there's a phone or an email to show; null until they're set. */
export async function officeFor(q: Queryable): Promise<OfficeDetails | null> {
  return officeContact(await getSetting(q, OFFICE_SETTING_ID))
}
