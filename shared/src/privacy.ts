/**
 * Error reports leave the company's own systems (ADR 0005), so anything in
 * their text that could identify a person or open a door is taken out
 * first: email addresses, and long random strings such as a freelancer's
 * private link or a sign-in secret.
 */

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
// No lookbehind: older iPhones can't parse it.
const SECRET = /(^|[^\w-])[\w-]{24,}(?![\w-])/g

export function redact(text: string): string {
  return text.replace(EMAIL, '[email]').replace(SECRET, '$1[secret]')
}
