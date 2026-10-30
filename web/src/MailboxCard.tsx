import type { MailboxStatus, MoneyView } from '@sh/shared'
import { useState } from 'react'
import { Refusal, useAct } from './act.tsx'
import { when } from './format.ts'
import { getJson, postJson, useAsked } from './jobs/rms.ts'
import { serverUrl } from './server.ts'
import { Pending } from './StatusPill.tsx'
import { client } from './sync.ts'

/**
 * The operations mailbox under Admin › Connections (ADR 0098, 0101):
 * operations@sessionhire.com, signed in once with Google. Claude reads it
 * when Claude is on, and quotes go to clients from it once the office
 * turns that on here. Connecting asks Google for both, reading and
 * sending; a connection made before sending was asked for reads only
 * until it's made again. Off to start, as every way the app reaches anyone
 * outside it is (ADR 0048).
 */

type Note = { ok: boolean; text: string }
const OUTCOMES: Record<string, Note> = {
  connected: { ok: true, text: 'Connected to the operations mailbox.' },
  cancelled: { ok: false, text: 'Connecting the mailbox was cancelled.' },
  failed: { ok: false, text: "Connecting the mailbox didn't work. Please try again." },
  missing: { ok: false, text: "The mailbox wasn't connected, because reading its mail was left unticked on Google's page. Connect again and allow it." },
  off: { ok: false, text: 'Connecting the mailbox needs the Google key on the server first.' },
}

/** How the last try at connecting went: in the address the server sent the browser back to, read once and tidied away. */
const outcome = (() => {
  const params = new URLSearchParams(location.search)
  const got = params.get('mailbox')
  if (!got) return undefined
  params.delete('mailbox')
  const query = params.toString()
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`)
  return OUTCOMES[got] ?? OUTCOMES.failed
})()

export function MailboxCard({ money }: { money: MoneyView }) {
  const [again, setAgain] = useState(0)
  const loaded = useAsked(true, 'mailbox', () => getJson<MailboxStatus>('/api/assistant/mailbox'), again)
  const [note, setNote] = useState<Note | undefined>(outcome)
  const { run, error } = useAct()
  const m = loaded.state === 'ready' ? loaded.data : undefined
  const on = !!money.quoting.emailQuotes
  const disconnect = async () => {
    const l = await postJson<MailboxStatus>('/api/assistant/mailbox/disconnect', {})
    setNote(l.state === 'gone' ? { ok: false, text: l.error } : l.state === 'ready' ? { ok: true, text: 'Disconnected. Its key is handed back; what Claude read stays.' } : undefined)
    setAgain((n) => n + 1)
  }
  const connect = serverUrl('/api/assistant/mailbox/connect')
  return (
    <section className="card" aria-label="The operations mailbox">
      <h2>The operations mailbox</h2>
      <p>
        operations@sessionhire.com, connected once by signing in as it. Claude reads the mail copied to it when Claude is on (under Company), and quotes go to
        clients from it when that's on below. The app asks Google only to read the mailbox and send from it: it never replies to or files anything there.
      </p>
      {!m ? (
        loaded.state === 'loading' ? <p className="hint">Checking…</p> : <p className="hint">The server can't be reached, so how the mailbox stands isn't known.</p>
      ) : !m.available ? (
        <p className="hint">Connecting it needs the Google key on the server, as sign-in does.</p>
      ) : m.state === 'off' ? (
        <>
          <p className="hint">Not connected. Sign in as operations@sessionhire.com (a private window keeps your own account out of the way) and allow reading and sending.</p>
          <a className="button" href={connect}>
            Connect operations@
          </a>
        </>
      ) : (
        <>
          <p className="hint">
            {m.state === 'reconnect' ? (m.problem ?? 'It needs connecting again.') : `Connected as ${m.account ?? 'the mailbox'}${m.canSend ? ', to read and send' : ', to read only'}`}
            {m.lookedAt && m.state === 'on' ? `; last read ${when(m.lookedAt)}` : ''}. {m.threads === 1 ? '1 thread' : `${m.threads} threads`} read as enquiries or about jobs.
          </p>
          {m.state === 'on' && !m.canSend && <p className="warn-line">It was connected to read only, so quotes can't be sent from it yet. Connect it again and allow sending.</p>}
          <div className="actions">
            {(m.state === 'reconnect' || !m.canSend) && (
              <a className="button" href={connect}>
                Connect again
              </a>
            )}
            <button type="button" className="link" onClick={() => void disconnect()}>
              Disconnect
            </button>
          </div>
        </>
      )}
      {note && (
        <p className={note.ok ? 'hint' : 'alert'} role={note.ok ? 'status' : 'alert'}>
          {note.text}
        </p>
      )}
      <label className="signal">
        <input type="checkbox" role="switch" checked={on} onChange={(e) => void run(() => client.mutate('quoting.email', { on: e.target.checked }))} />
        <span>
          <b>
            Send quotes by email from operations@ <Pending pending={money.quoting.pending} />
          </b>
          <small>
            {on
              ? 'On: a quote has Send to the client, which emails it with the quote as a PDF and marks it sent. Replies come to whoever sent it and to the mailbox.'
              : 'Off: quotes are printed as PDFs and sent by hand, and marked sent here.'}
          </small>
        </span>
      </label>
      <Refusal error={error} />
    </section>
  )
}
