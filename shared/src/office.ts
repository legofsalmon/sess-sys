import { z } from 'zod'
import { cleanText, text } from './plain.ts'

/**
 * The office's own details (audit finding 10): the name, phone and email
 * shown on every freelancer page, so someone booked has a way back to the
 * office without the app. They are one setting record, with the id
 * "office"; other settings can join it later under ids of their own. The
 * company's VAT number and address are on it too, for the printed quote
 * (ADR 0042's open item), and nowhere on the freelancers' pages.
 */

const id = z.string().min(1).max(64)
const phone = z.string().regex(/^\+?[0-9 ()-]{6,40}$/, 'Phone numbers need digits only, ideally starting with +353.')
/** An Irish VAT number such as IE 1234567T, or another country's: letters, digits and spaces. */
const vatNumber = z.string().trim().regex(/^[A-Za-z0-9 ]{4,20}$/, 'A VAT number is letters and digits, such as IE 1234567T.')
/** The company's postal address, a line each as written. */
export const ADDRESS_LENGTH = 300

export const OFFICE_SETTING_ID = 'office'
/** What heads of department read (ADR 0046): the second setting, with only `headsSeeRates` to it. */
export const READING_SETTING_ID = 'reading'
/** Whether the app prompts messages to crew (ADR 0048): the third setting, with only `promptMessages` to it. */
export const MESSAGES_SETTING_ID = 'messages'
/** Whether the company uses timesheets (ADR 0089): the fourth setting, with only `useTimesheets` to it. */
export const TIMESHEETS_SETTING_ID = 'timesheets'

export const setting = z.object({
  id,
  /** What the block is headed, such as "Session Hire office". */
  name: z.string().max(200),
  phone: phone.nullable(),
  email: z.string().email().max(200).nullable(),
  /** On the "office" setting, once one is saved: the company's VAT number and address, printed on quotes. */
  vatNumber: z.string().max(20).nullable().optional(),
  address: z.string().max(ADDRESS_LENGTH).nullable().optional(),
  /** On the "reading" setting (ADR 0046): a director lets heads of department see crew rates. Off unless said. */
  headsSeeRates: z.boolean().optional(),
  /**
   * On the "messages" setting (ADR 0048): whether Offer, Send, Tell and Ask
   * open a WhatsApp, text or email to a real person. Off until the office
   * says, so a company whose crew came in from a calendar can tidy the
   * lists without a mis-tap messaging a freelancer about a job in October.
   */
  promptMessages: z.boolean().optional(),
  /**
   * On the "timesheets" setting (ADR 0089): whether the company uses
   * timesheets at all. Off until the office says, so a company that pays
   * crew from its own records sees no Timesheets page, tile or count, and
   * no freelancer is asked for one. What's kept stays kept.
   */
  useTimesheets: z.boolean().optional(),
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
    // Optional, so a change from an app older than them leaves them as they were.
    vatNumber: vatNumber.nullable().optional(),
    address: text(ADDRESS_LENGTH, 'The address').pipe(z.string().trim()).nullable().optional(),
  }),
  /** Whether heads of department see crew rates and timesheet amounts (ADR 0046). A director's to decide. */
  'reading.heads': z.object({ rates: z.boolean() }),
  /** Whether the app prompts messages to crew (ADR 0048). The office's to decide, under Admin. */
  'messages.prompt': z.object({ on: z.boolean() }),
  /** Whether the company uses timesheets (ADR 0089). The office's to decide, under Admin. */
  'timesheets.use': z.object({ on: z.boolean() }),
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
