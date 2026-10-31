import { GoogleError } from '../calendar/google.ts'

/**
 * The operations mailbox through Gmail's API: read for Claude (ADR 0098),
 * and sending a quote to the client from it (ADR 0101). The app asks
 * Google for those two things and nothing more, so it can't reply to,
 * delete or file anything there. Everything goes through `fetch`, so
 * tests can stand in a pretend Gmail.
 */

export const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
/** What the app asks for when the mailbox is connected: reading is needed, sending is kept if it was allowed. */
export const GMAIL_SCOPES = [GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE] as const
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** One email as Claude is shown it. */
export interface Mail {
  id: string
  threadId: string
  from: string
  to: string
  cc: string
  subject: string
  /** When it was sent, as Gmail has it. */
  at: string
  text: string
  /** Sent to a list (a newsletter, a receipt): never read as an enquiry. */
  bulk: boolean
}

interface Part {
  mimeType?: string
  body?: { data?: string }
  parts?: Part[]
  headers?: { name: string; value: string }[]
}
interface Message {
  id: string
  threadId: string
  internalDate?: string
  payload?: Part
}

/** Longer than this, an email is cut: the start of an enquiry says what's wanted. */
const MAIL_LENGTH = 6_000

export class Gmail {
  constructor(
    private readonly fetch: typeof globalThis.fetch = globalThis.fetch,
    private readonly api: string = API
  ) {}

  /** The ids of mail that came after `after`, newest first, up to `most`. */
  async since(token: string, after: Date, most = 200): Promise<{ id: string; threadId: string }[]> {
    const out: { id: string; threadId: string }[] = []
    let page: string | undefined
    do {
      const q = new URLSearchParams({ q: `after:${Math.floor(after.getTime() / 1000)}`, maxResults: '100' })
      if (page) q.set('pageToken', page)
      const r = await this.get<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(token, `/messages?${q}`)
      out.push(...(r.messages ?? []))
      page = r.nextPageToken
    } while (page && out.length < most)
    return out.slice(0, most)
  }

  /** A whole thread, oldest first. */
  async thread(token: string, id: string): Promise<Mail[]> {
    const r = await this.get<{ messages?: Message[] }>(token, `/threads/${encodeURIComponent(id)}?format=full`)
    return (r.messages ?? []).map(mailOf)
  }

  /**
   * Sends a whole message, as the bytes of an email with its headers and parts (ADR 0101), from the connected account;
   * Gmail keeps it in the account's Sent. Says what Gmail called it and its thread.
   */
  async send(token: string, raw: Buffer): Promise<{ id: string; threadId: string }> {
    let res: Response
    try {
      res = await this.fetch(`${this.api}/messages/send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ raw: raw.toString('base64url') }),
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new GoogleError('busy', 0, 'unreachable', "Couldn't reach Gmail")
    }
    if (res.ok) return (await res.json()) as { id: string; threadId: string }
    throw answered(res.status)
  }

  private async get<T>(token: string, path: string): Promise<T> {
    let res: Response
    try {
      res = await this.fetch(`${this.api}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
    } catch {
      throw new GoogleError('busy', 0, 'unreachable', "Couldn't reach Gmail")
    }
    if (res.ok) return (await res.json()) as T
    throw answered(res.status)
  }
}

/** Gmail's answer as the app's own kinds of trouble: a key gone stale, too busy, not allowed, nothing there. */
const answered = (status: number) =>
  new GoogleError(status === 401 ? 'expired' : status === 429 || status >= 500 ? 'busy' : status === 403 ? 'access' : status === 404 ? 'gone' : 'refused', status, '', `Gmail answered ${status}`)

const header = (p: Part | undefined, name: string) => p?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? ''
const decode = (data: string) => Buffer.from(data, 'base64url').toString('utf8')

function mailOf(m: Message): Mail {
  const p = m.payload
  return {
    id: m.id,
    threadId: m.threadId,
    from: header(p, 'from'),
    to: header(p, 'to'),
    cc: header(p, 'cc'),
    subject: header(p, 'subject'),
    at: new Date(Number(m.internalDate ?? 0) || Date.now()).toISOString(),
    text: withoutQuoted(bodyOf(p)).slice(0, MAIL_LENGTH),
    bulk: !!header(p, 'list-unsubscribe') || /^(bulk|list|junk)$/i.test(header(p, 'precedence').trim()),
  }
}

/** The plain text of an email: its text part, or its HTML part as text. */
export function bodyOf(p: Part | undefined): string {
  const found = (type: string, at: Part | undefined): string | undefined => {
    if (!at) return undefined
    if (at.mimeType === type && at.body?.data) return decode(at.body.data)
    for (const c of at.parts ?? []) {
      const t = found(type, c)
      if (t !== undefined) return t
    }
    return undefined
  }
  const plain = found('text/plain', p)
  if (plain !== undefined) return plain.replace(/\r\n/g, '\n').trim()
  const html = found('text/html', p)
  return html === undefined ? '' : textOfHtml(html)
}

/** Tags whose contents are never text. */
const HIDDEN = new Set(['style', 'script', 'head', 'title'])
/** Tags that end a line: br where it stands, the rest where they close. */
const BREAKS = new Set(['br', 'p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }

/**
 * The text of an HTML email, read tag by tag rather than by patching the markup with patterns: what's outside a tag is
 * text, what's inside style or script is not, and a line ends where a block does. Entities are decoded once, in one
 * pass, so "&amp;lt;" stays "&lt;". The result is only ever shown as text, never as HTML.
 */
function textOfHtml(html: string): string {
  let out = ''
  let at = 0
  let hidden: string | null = null
  while (at < html.length) {
    if (hidden) {
      // Inside style or script, "<" is just a character: skip to the tag that closes it.
      const ends = new RegExp(`</${hidden}\\b[^>]*>`, 'ig')
      ends.lastIndex = at
      const end = ends.exec(html)
      if (!end) break
      hidden = null
      at = end.index + end[0].length
      continue
    }
    const open = html.indexOf('<', at)
    if (open < 0) {
      out += html.slice(at)
      break
    }
    out += html.slice(at, open)
    const close = html.indexOf('>', open + 1)
    if (close < 0) break // a tag never finished: nothing after it is text
    const tag = html.slice(open + 1, close)
    const closing = tag.startsWith('/')
    const name = /^\/?\s*([a-z][a-z0-9]*)/i.exec(tag)?.[1]?.toLowerCase() ?? ''
    if (!closing && HIDDEN.has(name)) hidden = name
    else if (name === 'br' || (closing && BREAKS.has(name))) out += '\n'
    at = close + 1
  }
  return out
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (_, e: string) => ENTITIES[e] ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

/** An email without the earlier ones quoted under it, which the thread has already: "On … wrote:" and the lines starting ">". */
export function withoutQuoted(text: string): string {
  const lines = text.split('\n')
  const cut = lines.findIndex((l, i) => /^On .+wrote:\s*$/.test(l.trim()) || (/^On .+/.test(l.trim()) && /wrote:\s*$/.test(lines[i + 1] ?? '')) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(l.trim()) || /^From: .+/.test(l) && /^(Sent|Date): /.test(lines[i + 1] ?? ''))
  return (cut >= 0 ? lines.slice(0, cut) : lines)
    .filter((l) => !l.startsWith('>'))
    .join('\n')
    .trim()
}
