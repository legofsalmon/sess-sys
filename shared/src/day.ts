import { z } from 'zod'

/**
 * A calendar day written as 2026-10-05, in Europe/Dublin: bookings, phases
 * and crew calls are whole days. Every module's dates share this one
 * schema, and it checks for a real date, not just the shape of one: a day
 * like 2026-02-31 would otherwise get as far as the database, be turned
 * away in Postgres's words, and leave the device's own view unable to show
 * it. It lives on its own so the modules can share it without a cycle.
 */

/** A real date written as 2026-10-05. */
export function isDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

const NOT_A_DATE = "That isn't a real date."

export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, NOT_A_DATE).refine(isDay, NOT_A_DATE)
