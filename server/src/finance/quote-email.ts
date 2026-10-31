import { randomBytes } from 'node:crypto'
import { depositCents, irishToday, letterDay, money, newId, OFFICE_SETTING_ID, quoteTotals, spanLabel, validUntil, type Quote, type QuoteEmail, type QuoteEmailPrefill, type QuoteEmailSend, type StaffUser } from '@sh/shared'
import { GoogleError } from '../calendar/google.ts'
import { applyMutation, type From } from '../commands.ts'
import type { Db, Queryable } from '../db.ts'
import { QUOTE_EMAIL_ACTION } from '../history.ts'
import { emit, serverChange } from '../kernel.ts'
import type { Mailbox } from '../assistant/mailbox.ts'
import { getSetting } from '../office/store.ts'
import { getClient, getProject, getVenue } from '../projects/store.ts'
import { quotePdf, type Sheet } from './quote-pdf.ts'
import { getQuote, getQuoteEmail, getQuoteSettings, highestNumber, quotesOf } from './store.ts'

/**
 * Sending a quote to the client by email (ADR 0101), from the operations
 * mailbox the office connected (ADR 0098), with the quote as a PDF
 * attached. The office opens a compose box filled in from the quote and
 * the client's contacts, changes what it likes and presses Send; the
 * server marks the quote sent (which gives it its number), draws the PDF,
 * sends through Gmail as operations@, and keeps a record of what went,
 * which every device sees on the quote. Replies go to whoever sent it and
 * to operations@, so the thread stays in the mailbox Claude reads.
 *
 * Nothing goes until the office has turned it on under Admin, as with
 * every way the app reaches anyone outside it (ADR 0048).
 */

export interface Mailer {
  db: Db
  mailbox: Mailbox
  /** Told once a record is written, so devices come for it. */
  onChange?: () => void
  now?: () => Date
}

/** Who pressed Send, as the push route knows them, and the device code for the history. */
export interface Sender extends From {
  staff?: StaffUser | null
  clientId?: string
}

export type SendResult = { ok: true; email: QuoteEmail } | { ok: false; code: number; error: string }

/** The company's own address the quotes go out from, until the mailbox says otherwise. */
export const OPERATIONS_ADDRESS = 'operations@sessionhire.com'
const COMPANY = 'Session Hire'

/** Everything the PDF shows, read for a quote. */
export async function sheetFor(q: Queryable, quote: Quote, today: string): Promise<Sheet> {
  const project = await getProject(q, quote.projectId)
  const [client, venue, office, quoting, span] = await Promise.all([
    project?.clientId ? getClient(q, project.clientId) : undefined,
    project?.venueId ? getVenue(q, project.venueId) : undefined,
    getSetting(q, OFFICE_SETTING_ID),
    getQuoteSettings(q),
    spanOf(q, quote.projectId),
  ])
  return {
    q: quote,
    totals: quoteTotals(quote),
    job: { name: project?.name ?? 'Job', span, venue: venue ?? undefined, client: client ?? undefined },
    office,
    quoting: { terms: quoting?.terms ?? '', bank: quoting?.bank ?? '' },
    today,
  }
}

async function spanOf(q: Queryable, projectId: string): Promise<{ start: string; end: string } | undefined> {
  const { rows } = await q.query<{ a: string | null; b: string | null }>('SELECT min(start_day)::text AS a, max(end_day)::text AS b FROM phases WHERE project_id = $1', [projectId])
  const r = rows[0]
  return r?.a && r.b ? { start: r.a.slice(0, 10), end: r.b.slice(0, 10) } : undefined
}

/** The number the quote has, or the one it will get when it goes, worked out as the handler will (finance/handlers.ts, numberIt). */
export async function numberFor(q: Queryable, quote: Quote): Promise<number> {
  if (quote.number) return quote.number
  const had = (await quotesOf(q, quote.projectId)).find((v) => v.number)?.number
  if (had) return had
  const settings = await getQuoteSettings(q)
  return Math.max(settings?.nextNumber ?? 1, (await highestNumber(q)) + 1)
}

/** "Quote 1115 - Liffey Brands Launch.pdf": the file as the client saves it, in characters every system takes. */
export function fileNameFor(number: number | null, jobName: string): string {
  const safe = jobName.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\w .()&'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'quote'
  return `${number ? `Quote ${number}` : 'Draft quote'} - ${safe}.pdf`
}

/** The compose box as it opens: the client's contacts, a subject with the number, a message that says what the quote comes to. */
export async function prefillFor(m: Mailer, quote: Quote, staff: StaffUser | null | undefined): Promise<QuoteEmailPrefill> {
  const today = irishToday(m.now?.())
  const sheet = await sheetFor(m.db.reads, quote, today)
  const number = await numberFor(m.db.reads, quote)
  const settings = await getQuoteSettings(m.db.reads)
  const sender = await m.mailbox.sender().catch((err: unknown) => ({ ok: false as const, why: err instanceof GoogleError ? googleWords(err) : 'The mailbox can’t be reached just now.' }))
  const off = !settings?.emailQuotes
  const to = [...new Set((sheet.job.client?.contacts ?? []).map((c) => c.email?.trim() ?? '').filter(Boolean))].slice(0, 10)
  const contact = sheet.job.client?.contacts.find((c) => c.email?.trim())?.name ?? sheet.job.client?.contacts[0]?.name
  const first = contact?.trim().split(/\s+/)[0]
  const when = sheet.job.span ? ` on ${spanLabel(sheet.job.span)}` : ''
  const holds = `, with prices held until ${letterDay(validUntil({ sentOn: quote.sentOn, validDays: quote.validDays }, today))}`
  const deposit = quote.depositPct ? `A deposit of ${money(depositCents(sheet.totals.gross, quote.depositPct))} confirms the booking.\n\n` : ''
  const signed = [staff?.name, `${COMPANY}${sheet.office?.phone ? ` · ${sheet.office.phone}` : ''}`].filter(Boolean).join('\n')
  return {
    to,
    subject: `Quote ${number} from ${COMPANY}: ${sheet.job.name}`.slice(0, 200),
    message: `Hi ${first || 'there'},\n\nPlease find our quote for ${sheet.job.name}${when} attached: quote ${number}, ${money(sheet.totals.gross)} including VAT${holds}.\n\n${deposit}Any questions, just reply to this email.\n\nKind regards,\n${signed}`.slice(0, 4000),
    from: sender.ok ? sender.account : null,
    fileName: fileNameFor(number, sheet.job.name),
    number,
    canSend: !off && sender.ok,
    why: off ? 'Sending quotes by email is off. Turn it on under Admin › Connections › The operations mailbox.' : sender.ok ? null : sender.why,
  }
}

/** Marks the quote sent if it's a draft, draws the PDF, sends it through Gmail from operations@, and records what went. */
export async function sendQuote(m: Mailer, quoteId: string, body: QuoteEmailSend, who: Sender): Promise<SendResult> {
  const now = m.now?.() ?? new Date()
  const today = irishToday(now)
  const settings = await getQuoteSettings(m.db.reads)
  if (!settings?.emailQuotes) return { ok: false, code: 409, error: 'Sending quotes by email is off. Turn it on under Admin › Connections › The operations mailbox.' }
  let sender: Awaited<ReturnType<Mailbox['sender']>>
  try {
    sender = await m.mailbox.sender()
  } catch (err) {
    return { ok: false, code: 502, error: err instanceof GoogleError ? googleWords(err) : 'The mailbox can’t be reached just now. Try again in a minute.' }
  }
  if (!sender.ok) return { ok: false, code: 409, error: sender.why }
  let quote = await getQuote(m.db.reads, quoteId)
  if (!quote) return { ok: false, code: 404, error: 'That quote is no longer here.' }
  if (quote.lines.length === 0) return { ok: false, code: 422, error: 'This quote has no lines yet. Add what it is for first.' }

  const { clientId = 'server', staff: _staff, ...from } = who
  const device = /^[a-z0-9]{1,64}$/.test(clientId) ? clientId : 'server'
  // Sent, and so numbered, before the PDF is drawn: the client is sent the quote with its number on it. Marked sent as the
  // person's own change, so the history reads as it would had they pressed Mark as sent; an enquiry becomes quoted (ADR 0081).
  if (quote.status === 'draft') {
    const marked = await applyMutation(m.db, device, { id: newId(), name: 'quote.sent', args: { id: quote.id, on: today }, createdAt: now.toISOString() }, from)
    if (marked.status !== 'applied') return { ok: false, code: 422, error: marked.reason?.message ?? 'The quote couldn’t be marked sent.' }
    const project = await getProject(m.db.reads, quote.projectId)
    if (project?.status === 'enquiry') await applyMutation(m.db, device, { id: newId(), name: 'project.update', args: { id: project.id, status: 'quoted' }, createdAt: now.toISOString() }, from)
    quote = (await getQuote(m.db.reads, quoteId)) ?? quote
  }
  if (body.number != null && quote.number && body.number !== quote.number)
    return { ok: false, code: 409, error: `This went out as quote ${quote.number}, not ${body.number}: another quote took that number first. Check the subject and the message, then press Send again.` }

  const sheet = await sheetFor(m.db.reads, quote, today)
  const pdf = await quotePdf(sheet)
  const fileName = fileNameFor(quote.number ?? null, sheet.job.name)
  const staff = who.staff ?? undefined
  const raw = mime({
    from: { name: COMPANY, address: sender.account },
    to: body.to,
    // Replies reach whoever sent it, and operations@, so the thread stays where Claude reads it.
    replyTo: staff && staff.email.toLowerCase() !== sender.account.toLowerCase() ? [{ name: staff.name, address: staff.email }, { address: sender.account }] : [],
    subject: body.subject,
    text: body.message,
    attachment: { name: fileName, type: 'application/pdf', bytes: pdf },
    date: now,
  })
  let sent: { id: string; threadId: string }
  try {
    sent = await m.mailbox.gmail.send(sender.token, raw)
  } catch (err) {
    await m.mailbox.stopped(err, 'send')
    return { ok: false, code: 502, error: err instanceof GoogleError ? googleWords(err) : 'Gmail didn’t take it. Nothing was sent; try again in a minute.' }
  }

  const before = await m.db.reads.query<{ n: number }>('SELECT count(*)::int AS n FROM quote_emails WHERE quote_id = $1', [quote.id])
  const id = newId()
  const email = await serverChange(
    m.db,
    { name: QUOTE_EMAIL_ACTION, args: { id: quote.id, projectId: quote.projectId, to: body.to.length, again: (before.rows[0]?.n ?? 0) > 0 }, clientId: device, userId: who.userId, device: who.device },
    async (ctx) => {
      await ctx.tx.query(
        `INSERT INTO quote_emails (id, quote_id, project_id, version, number, sent_at, sent_by, from_address, to_addresses, subject, message, gmail_id, thread_id, pdf_base64)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [id, quote.id, quote.projectId, quote.version, quote.number ?? null, now, who.userId ?? null, sender.account, body.to, body.subject, body.message, sent.id, sent.threadId, pdf.toString('base64')]
      )
      const record = (await getQuoteEmail(ctx.tx, id))!
      await emit(ctx, 'quoteEmail', id, record)
      return record
    }
  )
  m.onChange?.()
  return { ok: true, email }
}

/** Gmail's trouble in the words the person sees. Nothing has gone when these are said. */
function googleWords(err: GoogleError): string {
  switch (err.problem) {
    case 'busy':
      return 'Gmail is busy or can’t be reached just now. Nothing was sent; try again in a minute.'
    case 'access':
      return 'Google won’t let the app send from the mailbox. Nothing was sent. Check the Gmail API is on, then connect operations@ again under Admin › Connections and allow sending.'
    case 'expired':
    case 'revoked':
      return 'Google no longer accepts the app’s key for the mailbox. Nothing was sent. Connect operations@ again under Admin › Connections.'
    default:
      return `Gmail turned it down (${err.message}). Nothing was sent.`
  }
}

// The email itself, as the bytes Gmail is handed.

interface Address {
  name?: string
  address: string
}

export interface Message {
  from: Address
  to: string[]
  replyTo: Address[]
  subject: string
  text: string
  attachment: { name: string; type: string; bytes: Buffer }
  date: Date
}

/** An email with a text part and one attachment, headers folded and encoded as the standards ask. */
export function mime(msg: Message): Buffer {
  const boundary = `sh-${randomBytes(12).toString('hex')}`
  const headers = [
    `From: ${addressLine(msg.from)}`,
    fold('To: ', msg.to.map((a) => addressLine({ address: a }))),
    msg.replyTo.length ? fold('Reply-To: ', msg.replyTo.map(addressLine)) : '',
    `Subject: ${encodedWord(msg.subject)}`,
    `Date: ${msg.date.toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].filter(Boolean)
  const plainName = msg.attachment.name.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\x20-\x7e]|["\\]/g, '_')
  const starName = encodeURIComponent(msg.attachment.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  const parts = [
    ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', lines(Buffer.from(msg.text.replace(/\r?\n/g, '\r\n'), 'utf8'))].join('\r\n'),
    [
      `Content-Type: ${msg.attachment.type}; name="${plainName}"`,
      `Content-Disposition: attachment; filename="${plainName}"; filename*=UTF-8''${starName}`,
      'Content-Transfer-Encoding: base64',
      '',
      lines(msg.attachment.bytes),
    ].join('\r\n'),
  ]
  return Buffer.from([...headers, '', `--${boundary}`, parts.join(`\r\n--${boundary}\r\n`), `--${boundary}--`, ''].join('\r\n'), 'utf8')
}

/** "Session Hire <operations@sessionhire.com>", the name encoded when it needs to be. */
function addressLine(a: Address): string {
  const name = a.name?.trim()
  if (!name) return a.address
  const plain = /^[\w .'-]+$/.test(name)
  return `${plain ? name : encodedWord(name)} <${a.address}>`
}

/** Text as a header takes it: as it is when it's plain ASCII, else in UTF-8 encoded words no longer than a header line allows. */
export function encodedWord(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s) && !/[=?]/.test(s)) return s
  const words: string[] = []
  let chunk = ''
  for (const c of s) {
    if (Buffer.byteLength(chunk + c, 'utf8') > 45) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`)
      chunk = ''
    }
    chunk += c
  }
  if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`)
  return words.join('\r\n ')
}

/** A header with a list in it, one entry a line after the first, so no line runs long. */
const fold = (name: string, entries: string[]) => `${name}${entries.join(',\r\n ')}`

/** Base64 in lines of 76, as a body part is written. */
const lines = (b: Buffer) => b.toString('base64').replace(/(.{76})/g, '$1\r\n')
