/**
 * Where a count on Home asked to land (audit, 20 October 2026, finding 4):
 * the part of the next screen that holds what it counted, by its heading,
 * and the department it counted for, so the list starts narrowed to it with
 * the way to widen. Said as the count is tapped, before the address moves,
 * and kept until the address moves on: the screen reads it as it draws, and
 * the places (places.ts) take the page to the part. Not in the address, as
 * each screen goes by its address exactly; a link opened anew lands at the
 * top, as before.
 */

export interface Arrival {
  /** The address the count opens. */
  hash: string
  /** The heading of the part to land on, without its count: "Answers to check". */
  part?: string
  /** The department Home counted for. */
  department?: string
}

let asked: Arrival | undefined

/** Said by a count as it's tapped. */
export function arrive(a: Arrival) {
  asked = a
}

/** What the count that opened this address asked for, while the address is still the one it opened. */
export function arrival(hash = location.hash): Arrival | undefined {
  return asked && asked.hash === hash ? asked : undefined
}

addEventListener('hashchange', () => {
  if (asked && asked.hash !== location.hash) asked = undefined
})

/** A heading's words without the count it ends with: "Answers to check (24)" is "Answers to check". */
export const partLabel = (text: string) => text.replace(/\s+/g, ' ').trim().replace(/\s*\(\d[\d,]*\)$/, '')

/** The part's heading on the screen, once it's drawn: a card's heading or a heading inside one. */
export function partHeading(part: string): HTMLElement | undefined {
  const want = part.toLowerCase()
  return [...document.querySelectorAll<HTMLElement>('main .app h2, main .app h3')].find((h) => h.getClientRects().length > 0 && partLabel(h.textContent ?? '').toLowerCase() === want)
}
