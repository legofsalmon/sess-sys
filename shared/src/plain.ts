import { z } from 'zod'
import { EURO_HINT } from './money.ts'

/**
 * Plain words for what the shared schemas turn down (audit finding 11).
 * Zod's own wording ("Number must be less than or equal to 100") is for
 * programmers; the app and the server show these instead, said for the
 * field as a person knows it. Fields nobody types, such as ids, keep zod's
 * wording, which only a bug could reach.
 */

/** Typed text, up to `max` characters: "The notes can be up to 2,000 characters." */
export const text = (max: number, what: string) => z.string().max(max, `${what} can be up to ${max.toLocaleString('en-IE')} characters.`)

/** Text that can't be left out: "A name is needed." */
export const needed = (max: number, what: string, which: string) => text(max, what).min(1, `${which} is needed.`)

/** A whole number from `min` to `max`, said the same way whichever way it's wrong. */
export function whole(min: number, max: number, what: string, said = `${what} is a whole number from ${min.toLocaleString('en-IE')} to ${max.toLocaleString('en-IE')}.`) {
  return z.number({ invalid_type_error: said, required_error: said }).int(said).min(min, said).max(max, said)
}

/** A year, said as years are written: "from 2000 to 2999", never "2,000". */
export const wholeYear = (min: number, max: number, what: string) => whole(min, max, what, `${what} is a whole number from ${min} to ${max}.`)

/** Money in euro cents, so sums never drift, up to `maxCents`: "A day rate can be up to €100,000." */
export function euroCents(maxCents: number, what: string) {
  return z
    .number({ invalid_type_error: EURO_HINT, required_error: EURO_HINT })
    .int(EURO_HINT)
    .min(0, "A price can't be less than nothing.")
    .max(maxCents, `${what} can be up to €${(maxCents / 100).toLocaleString('en-IE')}.`)
}
