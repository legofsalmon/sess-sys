/**
 * The link page's one form with a file (ADR 0029), read from the request
 * as `multipart/form-data`: the only way a page with no script can send a
 * file. The body is already in memory and capped by the route, and only
 * what that form sends is taken: a few short fields and one file. The
 * file's name, which comes from someone's phone, is never read.
 */

export interface Form {
  fields: Record<string, string>
  /** The file chosen, if any; empty when the field was left blank, as browsers send it. */
  file?: Buffer
}

/** A body that isn't the form it should be. */
export class NotAForm extends Error {}

/** More than the page's form ever sends: anything past this isn't from it. */
const MAX_PARTS = 12
const MAX_FIELD = 2000

const CRLF = Buffer.from('\r\n')
const HEADERS_END = Buffer.from('\r\n\r\n')

export function boundaryOf(contentType: string | undefined): string {
  const m = /^multipart\/form-data\s*;.*?\bboundary=(?:"([^"]{1,70})"|([^\s;]{1,70}))/i.exec(contentType ?? '')
  const boundary = m?.[1] ?? m?.[2]
  if (!boundary) throw new NotAForm('Not a form with a file.')
  return boundary
}

export function readForm(body: Buffer, contentType: string | undefined): Form {
  const boundary = boundaryOf(contentType)
  const delimiter = Buffer.from(`--${boundary}`)
  const between = Buffer.from(`\r\n--${boundary}`)
  let at = body.indexOf(delimiter)
  if (at < 0) throw new NotAForm('The form has no parts.')
  at += delimiter.length
  // No prototype, so a part named like one of an object's own properties is just a field.
  const form: Form = { fields: Object.create(null) as Record<string, string> }
  for (let parts = 0; ; parts++) {
    // "--" after a delimiter ends the form; anything else but a line break isn't one.
    if (body.subarray(at, at + 2).toString('latin1') === '--') return form
    if (parts >= MAX_PARTS || !body.subarray(at, at + 2).equals(CRLF)) throw new NotAForm('The form is not as the page sends it.')
    at += 2
    const headersEnd = body.indexOf(HEADERS_END, at)
    if (headersEnd < 0) throw new NotAForm('A part of the form has no end to its headers.')
    const headers = body.subarray(at, headersEnd).toString('utf8')
    const start = headersEnd + HEADERS_END.length
    const end = body.indexOf(between, start)
    if (end < 0) throw new NotAForm('A part of the form never ends.')
    const content = body.subarray(start, end)
    at = end + between.length
    const disposition = /^content-disposition:\s*form-data\s*;(.*)$/im.exec(headers)?.[1] ?? ''
    const name = /(?:^|;)\s*name="([^"]*)"/i.exec(disposition)?.[1]
    if (!name) continue
    // A part with a file name is the file, whatever it's called: the name itself is never read.
    if (/(?:^|;)\s*filename\*?=/i.test(disposition)) {
      if (name === 'file' && !form.file) form.file = Buffer.from(content)
      continue
    }
    if (!Object.hasOwn(form.fields, name)) form.fields[name] = content.toString('utf8').slice(0, MAX_FIELD)
  }
}
