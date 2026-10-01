/**
 * Money as people type it (audit finding 15). A price reaches the app as
 * text, from a form in the app or on a freelancer's link: "250", "250.50",
 * "€1,250", "1 250,50" or "1.250,00". Read loosely, "1,250" came out as
 * €1.25 and was saved, and "€250" as nothing at all. This reads what the
 * person meant, in cents, or says in plain words what to put in, and every
 * price typed anywhere goes through it, so a rate means the same thing
 * wherever it's typed.
 */

/** What to put in, when what was typed isn't a price. */
export const EURO_HINT = 'Put in a price like 250 or 1,250.50.'

/** What a price typed in came to: cents; null for nothing typed; or why it couldn't be read. */
export type Euro = { cents: number | null; reason?: undefined } | { cents?: undefined; reason: string }

/** Longer than this is a slip, not a price, and would lose digits as a number. */
const MOST_DIGITS = 12

/**
 * A price in euro, as typed. A euro sign before or after, with or without
 * a space, is fine. Thousands can be split by a comma, a dot or a space
 * ("1,250", "1.250", "1 250"), and the cents by a comma or a dot ("250.5",
 * "250,50"). One separator with three digits after it splits thousands,
 * since cents are never three digits; with both a comma and a dot, the last
 * one is the decimal point ("1,250.50", "1.250,50"). Nothing typed is null,
 * for a rate still to agree; anything else that isn't a price gets the hint.
 */
export function parseEuro(text: string): Euro {
  // "€250", "250 €", "EUR 250", "250 eur".
  let t = text
    .trim()
    .replace(/^(€|eur)\s*/i, '')
    .replace(/\s*(€|eur)$/i, '')
  if (!t) return { cents: null }
  if (t.startsWith('-')) return { reason: "A price can't be less than nothing." }
  if (!/^[\d.,\s]+$/.test(t)) return { reason: EURO_HINT }
  if (/\s/.test(t)) {
    // A space inside the number splits thousands and nothing else ("1 250", "1 250 000", "1 250,50"):
    // a thumb slip in "12 50" isn't a hundred times the price.
    const grouped = /^(\d{1,3}(?: \d{3})+)([.,]\d{1,2})?$/.exec(t.replace(/\s+/g, ' '))
    if (!grouped) return { reason: EURO_HINT }
    t = grouped[1]!.replaceAll(' ', '') + (grouped[2] ?? '')
  }

  const commas = (t.match(/,/g) ?? []).length
  const dots = (t.match(/\./g) ?? []).length
  let whole = t
  let fraction = ''
  if (commas && dots) {
    // Both: whichever comes last is the decimal point, and the other splits thousands.
    const at = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'))
    const decimal = t[at]!
    const thousands = decimal === ',' ? '.' : ','
    whole = t.slice(0, at)
    fraction = t.slice(at + 1)
    if (fraction.includes(thousands) || !groupedBy(whole, thousands)) return { reason: EURO_HINT }
    whole = whole.replaceAll(thousands, '')
  } else if (commas || dots) {
    const sep = commas ? ',' : '.'
    const parts = t.split(sep)
    const last = parts[parts.length - 1]!
    if (parts.length > 2 || last.length === 3) {
      // Thousands only: "1,250", "1,250,000".
      if (!groupedBy(t, sep)) return { reason: EURO_HINT }
      whole = t.replaceAll(sep, '')
    } else {
      whole = parts[0]!
      fraction = last
    }
  }
  if (fraction.length > 2 || (!whole && !fraction)) return { reason: EURO_HINT }
  if (whole.length > MOST_DIGITS) return { reason: "That's more than a price could be." }
  return { cents: Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0') || '0') }
}

/** "1,250,000" split by `sep` into groups of three after the first, which has one to three. */
function groupedBy(digits: string, sep: string): boolean {
  const groups = digits.split(sep)
  return groups.length > 1 && /^\d{1,3}$/.test(groups[0]!) && groups.slice(1).every((g) => /^\d{3}$/.test(g))
}

/** Cents as a form shows them for changing: "250", or "250.50". */
export function euroText(cents: number): string {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)
}
