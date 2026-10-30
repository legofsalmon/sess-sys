import type { AssistantStatus, OfficeView } from '@sh/shared'
import { Refusal, useAct } from './act.tsx'
import { getJson, useAsked } from './jobs/rms.ts'
import { Pending } from './StatusPill.tsx'
import { client } from './sync.ts'

/**
 * Claude inside the app (ADR 0096, 0098), for the office. On, Claude reads
 * the mail cc'd to operations@ and drafts a quote for each new enquiry,
 * keeping it up to date with the thread until someone changes it; the
 * office and directors can also paste an enquiry into New quote. It
 * contacts nobody, and only reads the mailbox, which is connected under
 * Connections (MailboxCard.tsx). Off to start, since what it reads is sent
 * to Anthropic.
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
      <p className="hint">
        It reads the operations mailbox once that’s connected under <a href="#admin/connections">Connections</a>.
      </p>
      <Refusal error={error} />
    </section>
  )
}
