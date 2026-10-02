import { z } from 'zod'

/**
 * A calendar day written as 2026-10-05, in Europe/Dublin: bookings, phases
 * and crew calls are whole days. Every module's dates share this one
 * schema, and it checks for a real date, not just the shape of one: a day
 * like 2026-02-31 would otherwise get as far as the database, be turned
 * away in Postgres's words, and leave the device's own view unable to show
 * it. It lives on its own so the modules can share it without a cycle.
 */

/** A real date written as 2026-10-05, in a year the app could be about. */
export function isDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  // A year like 0226 is a slip, and one like 9999 would stretch every plan to it.
  const year = Number(s.slice(0, 4))
  if (year < 1900 || year > 2999) return false
  const d = new Date(`${s}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export const day = z.string().refine(isDay, "That isn't a real date.")

/** Today in Ireland, as 2026-10-05: the one place the app and the server read the day from. */
export function irishToday(now = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' })
}
