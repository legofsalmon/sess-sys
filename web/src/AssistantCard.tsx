import type { AssistantStatus, OfficeView } from '@sh/shared'
import { Refusal, useAct } from './act.tsx'
import { getJson, useAsked } from './jobs/rms.ts'
import { Pending } from './StatusPill.tsx'
import { client } from './sync.ts'

/**
 * Claude inside the app (ADR 0096), for the office. On, the office and
 * directors can paste an enquiry into New quote for Claude to read into a
 * job and its lines, and ask Claude to change an open quote. It only
 * suggests: nothing is saved until someone takes it, and nobody outside is
 * contacted. Off to start, since what's asked is sent to Anthropic.
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
        Claude reads an enquiry pasted into New quote into the job and its lines, and changes an open quote when asked in words. It only suggests: you check
        each line and take it, and it contacts nobody. What's pasted or asked is sent to Anthropic to answer: Anthropic doesn't learn from it and deletes it within 30 days, and the app keeps only what each ask cost.
      </p>
      <label className="signal">
        <input type="checkbox" role="switch" checked={on} onChange={(e) => void run(() => client.mutate('assistant.use', { on: e.target.checked }))} />
        <span>
          <b>Offer Claude on the quote screens</b>
          <small>{on ? 'For the office and directors, on New quote and on each draft quote.' : 'Off: Claude isn’t offered anywhere.'}</small>
        </span>
      </label>
      {s && !s.configured && <p className="hint">It isn’t set up on the server yet: it needs ANTHROPIC_API_KEY in Railway.</p>}
      {s?.configured && (
        <p className="hint">
          This month: {dollars(s.spentCents)} of {dollars(s.limitCents)}, asked {s.uses === 1 ? 'once' : `${s.uses} times`}. It stops for the month at the limit.
        </p>
      )}
      <Refusal error={error} />
    </section>
  )
}
