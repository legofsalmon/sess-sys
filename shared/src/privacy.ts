/**
 * Error reports leave the company's own systems (ADR 0005), so anything in
 * their text that could identify a person or open a door is taken out
 * first: email addresses, long random strings such as a freelancer's
 * private link or a sign-in secret, and whatever follows the site in a
 * calendar's address. A freelancer's own calendar address (ADR 0044)
 * carries its secret in its path or its query, and not every calendar's
 * secret is long enough to be caught as one. Other web addresses keep
 * their path, so a report still says which screen and which script.
 */

const ADDRESS = /\b((?:https?|webcals?):\/\/[^\s/?#"'<>]+)([/?#][^\s"'<>]*)/gi
/** What makes an address a calendar's: webcal, or .ics, iCal, CalDAV, a calendar or a published one in its path. */
const CALENDAR = /^webcal|\.ics\b|ical|caldav|calendar|published/i
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
// No lookbehind: older iPhones can't parse it.
const SECRET = /(^|[^\w-])[\w-]{24,}(?![\w-])/g

export function redact(text: string): string {
  return text.replace(ADDRESS, (whole: string, site: string, rest: string) => (CALENDAR.test(whole.slice(0, 7)) || CALENDAR.test(rest) ? `${site}/[address]` : whole)).replace(EMAIL, '[email]').replace(SECRET, '$1[secret]')
}
