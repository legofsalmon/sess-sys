import { z } from 'zod'
import { cleanText } from './plain.ts'

/**
 * The office's own details (audit finding 10): the name, phone and email
 * shown on every freelancer page, so someone booked has a way back to the
 * office without the app. They are one setting record, with the id
 * "office"; other settings can join it later under ids of their own.
 */

const id = z.string().min(1).max(64)
const phone = z.string().regex(/^\+?[0-9 ()-]{6,40}$/, 'Phone numbers need digits only, ideally starting with +353.')

export const OFFICE_SETTING_ID = 'office'
/** What heads of department read (ADR 0046): the second setting, with only `headsSeeRates` to it. */
export const READING_SETTING_ID = 'reading'

export const setting = z.object({
  id,
  /** What the block is headed, such as "Session Hire office". */
  name: z.string().max(200),
  phone: phone.nullable(),
  email: z.string().email().max(200).nullable(),
  /** On the "reading" setting (ADR 0046): a director lets heads of department see crew rates. Off unless said. */
  headsSeeRates: z.boolean().optional(),
})
export type Setting = z.infer<typeof setting>

/** The office's details as the pages and the Account tab use them. */
export type OfficeDetails = Pick<Setting, 'name' | 'phone' | 'email'>

export interface SettingEntities {
  setting: Setting
}
export const SETTING_ENTITY_NAMES = ['setting'] as const

export const officeCommandSchemas = {
  /** Set the office's details, all of them at once: there is only one office. */
  'office.update': z.object({
    name: z.string().transform(cleanText).pipe(z.string().trim().max(200, "The office's name can be up to 200 characters.")),
    phone: phone.nullable(),
    email: z.string().trim().email('That email address doesn’t look right.').max(200, 'The email address can be up to 200 characters.').nullable(),
  }),
  /** Whether heads of department see crew rates and timesheet amounts (ADR 0046). A director's to decide. */
  'reading.heads': z.object({ rates: z.boolean() }),
} as const

/** The details when there is a way back in them: a phone or an email. A name alone is nothing to show. */
export function officeContact(o: OfficeDetails | null | undefined): OfficeDetails | null {
  if (!o) return null
  const phone = o.phone?.trim() || null
  const email = o.email?.trim() || null
  if (!phone && !email) return null
  return { name: o.name.trim() || 'The office', phone, email }
}

/** "Session Hire office · 01 234 5678 · office@sessionhire.com". */
export function officeLine(o: OfficeDetails | null | undefined): string {
  const c = officeContact(o)
  return c ? [c.name, c.phone, c.email].filter(Boolean).join(' · ') : ''
}

/** A tel: link wants only the digits and a leading +; the "(0)" written after a country code is not dialled. */
export const telHref = (phone: string) => `tel:${phone.replace(/\(0\)/g, '').replace(/[^\d+]/g, '')}`
