import type { AssistantStatus, MailboxStatus, OfficeView } from '@sh/shared'
import { useState } from 'react'
import { Refusal, useAct } from './act.tsx'
import { when } from './format.ts'
import { getJson, postJson, useAsked } from './jobs/rms.ts'
import { Pending } from './StatusPill.tsx'
import { client } from './sync.ts'

/**
 * Claude inside the app (ADR 0096, 0098), for the office. On, Claude reads
 * the mail cc'd to operations@ and drafts a quote for each new enquiry,
 * keeping it up to date with the thread until someone changes it; the
 * office and directors can also paste an enquiry into New quote. It
 * contacts nobody, and can only read the mailbox. Off to start, since what
 * it reads is sent to Anthropic.
 */
export function AssistantCard({ office }: { office: OfficeView }) {
  const { run, error } = useAct()
  const on = office.useAssistant
  const status = useAsked(true, `assistant-${on}`, () => getJson<AssistantStatus>('/api/assistant'))
  const s = status.state === 'ready' ? status.data : undefined
  const dollars = (c: number) => `$${(c / 100).toFixed(2)}`
  return (
    <section className="card" aria-label="Claude">
      <h2>
        Claude <Pending pending={office.assistantPending} />
      </h2>
      <p>
        Claude reads the mail cc’d to the operations mailbox. For each new enquiry it adds the job and drafts its quote, and keeps the draft up to date with the
        thread until someone changes it; after that, what the mail asks for is offered on the quote to take or leave. Leave operations@ off a mail to keep it
        private. It can only read the mailbox, and contacts nobody. What it reads is sent to Anthropic: Anthropic doesn’t learn from it and deletes it within 30
        days.
      </p>
      <label className="signal">
        <input type="checkbox" role="switch" checked={on} onChange={(e) => void run(() => client.mutate('assistant.use', { on: e.target.checked }))} />
        <span>
          <b>Turn Claude on</b>
          <small>{on ? 'Reading the operations mailbox once it’s connected, and offered on New quote to read a pasted enquiry.' : 'Off: Claude reads nothing and isn’t offered anywhere.'}</small>
        </span>
      </label>
      {s && !s.configured && <p className="hint">It isn’t set up on the server yet: it needs ANTHROPIC_API_KEY in Railway.</p>}
      {s?.configured && (
        <p className="hint">
          This month: {dollars(s.spentCents)} of {dollars(s.limitCents)}, asked {s.uses === 1 ? 'once' : `${s.uses} times`}. It stops for the month at the limit.
        </p>
      )}
      <MailboxPart />
      <Refusal error={error} />
    </section>
  )
}

/** Connecting operations@: signed in as it with Google once, read only. */
function MailboxPart() {
  const [again, setAgain] = useState(0)
  const loaded = useAsked(true, 'mailbox', () => getJson<MailboxStatus>('/api/assistant/mailbox'), again)
  const [error, setError] = useState('')
  const m = loaded.state === 'ready' ? loaded.data : undefined
  if (!m) return null
  const disconnect = async () => {
    const l = await postJson<MailboxStatus>('/api/assistant/mailbox/disconnect', {})
    if (l.state === 'gone') setError(l.error)
    setAgain((n) => n + 1)
  }
  return (
    <div className="mailbox" role="group" aria-label="The operations mailbox">
      <h3>The operations mailbox</h3>
      {!m.available ? (
        <p className="hint">Connecting it needs the Google key on the server, as sign-in does.</p>
      ) : m.state === 'off' ? (
        <>
          <p className="hint">Not connected. Sign in as operations@sessionhire.com to let the app read its mail. It asks Google to read only.</p>
          <a className="button" href="/api/assistant/mailbox/connect">
            Connect operations@
          </a>
        </>
      ) : (
        <>
          <p className="hint">
            {m.state === 'reconnect' ? (m.problem ?? 'It needs connecting again.') : `Reading ${m.account ?? 'the mailbox'}`}
            {m.lookedAt && m.state === 'on' ? `, last looked at ${when(m.lookedAt)}` : ''}. {m.threads === 1 ? '1 thread' : `${m.threads} threads`} read as enquiries or about jobs.
          </p>
          <div className="actions">
            {m.state === 'reconnect' && (
              <a className="button" href="/api/assistant/mailbox/connect">
                Connect again
              </a>
            )}
            <button type="button" className="link" onClick={() => void disconnect()}>
              Disconnect
            </button>
          </div>
        </>
      )}
      {error && <p className="alert" role="alert">{error}</p>}
    </div>
  )
}
