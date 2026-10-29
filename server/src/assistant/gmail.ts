import { GoogleError } from '../calendar/google.ts'

/**
 * Reading the operations mailbox (ADR 0098): Gmail's API, read only. The
 * app asks Google for nothing more than to read the mail, so it can't
 * send, reply, delete or file anything there. Everything goes through
 * `fetch`, so tests can stand in a pretend Gmail.
 */

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'] as const
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

  private async get<T>(token: string, path: string): Promise<T> {
    let res: Response
    try {
      res = await this.fetch(`${this.api}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
    } catch {
      throw new GoogleError('busy', 0, 'unreachable', "Couldn't reach Gmail")
    }
    if (res.ok) return (await res.json()) as T
    const status = res.status
    throw new GoogleError(status === 401 ? 'expired' : status === 429 || status >= 500 ? 'busy' : status === 403 ? 'access' : status === 404 ? 'gone' : 'refused', status, '', `Gmail answered ${status}`)
  }
}

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

function textOfHtml(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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
