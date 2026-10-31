import { QUOTE_EMAIL_LIMITS, type QuoteEmail, type QuoteEmailPrefill, type QuoteView } from '@sh/shared'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { when } from '../format.ts'
import { post, serverUrl } from '../server.ts'
import { syncSoon } from '../sync.ts'
import { useLate } from '../useLate.ts'
import { getJson, useAsked } from './rms.ts'

/**
 * Sending a quote to the client by email (ADR 0101): a compose box filled
 * in by the server from the quote and the client's contacts, which the
 * office reads over, changes where it likes, and sends. It goes from
 * operations@ with the quote attached as a PDF; a draft is marked sent as
 * it goes, which gives it its number. Nothing here is kept on the device:
 * what went is on the quote's page once the server says so.
 */

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** "a@b.ie, c@d.ie" as typed, split into addresses. */
const addressesOf = (typed: string) => typed.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean)

export function SendQuote({ q, onSent, onCancel }: { q: QuoteView; onSent: (email: QuoteEmail) => void; onCancel: () => void }) {
  const [again, setAgain] = useState(0)
  const loaded = useAsked(true, `${q.id}-${again}`, () => getJson<QuoteEmailPrefill>(`/api/quotes/${encodeURIComponent(q.id)}/email`), again)
  return (
    <div className="compose" role="group" aria-label="Send the quote by email">
      {loaded.state === 'loading' ? (
        <p className="hint">Getting the client's details…</p>
      ) : loaded.state === 'ready' ? (
        <Compose key={again} q={q} start={loaded.data} onSent={onSent} onCancel={onCancel} onAgain={() => setAgain((n) => n + 1)} />
      ) : (
        <>
          <p className="warn-line">{loaded.state === 'gone' ? loaded.error : 'The server can’t be reached, so the email can’t be put together. Try again with signal.'}</p>
          <div className="actions">
            <button type="button" onClick={() => setAgain((n) => n + 1)}>
              Try again
            </button>
            <button type="button" className="link" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}

type Field = 'to' | 'subject'

function Compose({ q, start, onSent, onCancel, onAgain }: { q: QuoteView; start: QuoteEmailPrefill; onSent: (email: QuoteEmail) => void; onCancel: () => void; onAgain: () => void }) {
  const [to, setTo] = useState(start.to.join(', '))
  const [subject, setSubject] = useState(start.subject)
  const [message, setMessage] = useState(start.message)
  const [touched, setTouched] = useState<Set<Field>>(new Set())
  const [tried, setTried] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const late = useLate(sending)
  const ids = { to: useId(), subject: useId(), message: useId() }
  const draft = q.status === 'draft'

  const addresses = addressesOf(to)
  const wrong = addresses.find((a) => !ADDRESS.test(a))
  const faults: Partial<Record<Field, string>> = {
    to: !addresses.length ? 'Say who it goes to.' : wrong ? `“${wrong}” doesn’t look like an email address.` : addresses.length > QUOTE_EMAIL_LIMITS.to ? `Up to ${QUOTE_EMAIL_LIMITS.to} addresses, please.` : undefined,
    subject: subject.trim() ? undefined : 'A subject is needed.',
  }
  // A fault shows once its field is left, or once Send is pressed (design system rule 18): never while it's being typed.
  const shown = (f: Field) => (touched.has(f) || tried ? faults[f] : undefined)
  const touch = (f: Field) => setTouched((was) => new Set(was).add(f))
  const problem = faults.to ?? faults.subject

  // Nothing typed here outlives the box, so the browser's own Back or a reload takes it away; that's said once something has changed.
  const changed = to !== start.to.join(', ') || subject !== start.subject || message !== start.message
  useEffect(() => {
    if (!changed) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    addEventListener('beforeunload', warn)
    return () => removeEventListener('beforeunload', warn)
  }, [changed])

  const send = async (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (problem || !start.canSend) return
    setSending(true)
    setError('')
    try {
      const { email } = await post<{ email: QuoteEmail }>(`/api/quotes/${encodeURIComponent(q.id)}/email`, { to: addresses, subject: subject.trim(), message, number: start.number }, 60_000)
      syncSoon()
      onSent(email)
    } catch (err) {
      setError((err as Error).message)
      setSending(false)
    }
  }
  const fault = (f: Field, id: string) => {
    const why = shown(f)
    return why ? (
      <small className="line-problem" id={`${id}-problem`} role="alert">
        {why}
      </small>
    ) : null
  }
  const bad = (f: Field, id: string) => (shown(f) ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-problem` } : {})

  return (
    <form onSubmit={(e) => void send(e)} aria-label="Send the quote by email" noValidate>
      {!start.canSend && (
        <p className="warn-line">
          {start.why} <a href="#admin/connections">Admin › Connections</a>
        </p>
      )}
      <p className="hint compose-from">
        From {start.from ?? 'the operations mailbox'}, with <b>{start.fileName}</b> attached.{' '}
        <a href={serverUrl(`/api/quotes/${encodeURIComponent(q.id)}/pdf`)} target="_blank" rel="noopener">
          Look at the PDF
        </a>
        {draft ? `. Sending marks it sent, as quote ${start.number}, and it then stays as it is.` : '.'}
      </p>
      <label className="field" htmlFor={ids.to}>
        To
      </label>
      <input id={ids.to} value={to} onChange={(e) => setTo(e.target.value)} onBlur={() => touch('to')} inputMode="email" autoComplete="off" placeholder="name@client.ie, another@client.ie" aria-label="To" {...bad('to', ids.to)} />
      {fault('to', ids.to)}
      <label className="field" htmlFor={ids.subject}>
        Subject
      </label>
      <input id={ids.subject} value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={() => touch('subject')} maxLength={QUOTE_EMAIL_LIMITS.subject} aria-label="Subject" {...bad('subject', ids.subject)} />
      {fault('subject', ids.subject)}
      <label className="field" htmlFor={ids.message}>
        Message
      </label>
      <textarea id={ids.message} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={QUOTE_EMAIL_LIMITS.message} rows={9} aria-label="Message" />
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="primary" disabled={sending || !start.canSend}>
          {sending ? (late ? 'Sending…' : 'Send') : 'Send'}
        </button>
        <button type="button" className="link" onClick={onCancel} disabled={sending}>
          Cancel
        </button>
        {error && (
          <button type="button" className="link quiet" onClick={onAgain}>
            Start the email again
          </button>
        )}
      </div>
    </form>
  )
}

/** The emails a quote went in, newest first, each with the PDF that went. */
export function Emails({ emails }: { emails: readonly QuoteEmail[] }) {
  if (!emails.length) return null
  return (
    <ul className="plain quote-emails" aria-label="Emailed to the client">
      {emails.map((e) => (
        <li key={e.id}>
          <b>Emailed {when(e.at)}</b>
          {e.by ? ` by ${e.by}` : ''} to {e.to.join(', ')}
          <small>
            {e.subject} ·{' '}
            <a href={serverUrl(`/api/quotes/emails/${encodeURIComponent(e.id)}/pdf`)} target="_blank" rel="noopener">
              The PDF that went
            </a>
          </small>
        </li>
      ))}
    </ul>
  )
}
