import type { OfficeView } from '@sh/shared'
import { Refusal, useAct } from './act.tsx'
import { Pending } from './StatusPill.tsx'
import { client } from './sync.ts'

/**
 * What heads of department read (ADR 0046), for directors. Crew rates go
 * to the office and directors only, so a head of department's phone holds
 * nobody's pay unless a director says otherwise here. Off is the default:
 * a rate once on a phone can't be taken back, so seeing it is the choice
 * that's made, not the one that's undone.
 */
export function ReadingCard({ office }: { office: OfficeView }) {
  const { run, error } = useAct()
  const on = office.headsSeeRates
  return (
    <section className="card">
      <h2>
        What heads of department see <Pending pending={office.headsPending} />
      </h2>
      <p>
        Crew rates, timesheet amounts and freelancers' private links go only to those who need them. The office and directors see them all. Heads
        of department see the links of people in their own department, so they can send their offers. The warehouse and staff crew see only their
        own.
      </p>
      <label className="signal">
        <input type="checkbox" checked={on} onChange={(e) => void run(() => client.mutate('reading.heads', { rates: e.target.checked }))} />
        <span>
          <b>Heads of department see crew rates</b>
          <small>{on ? 'They see day rates and timesheet amounts, and can set rates and approve timesheets.' : 'Off: rates and amounts are hidden on their phones, and the office sets them.'}</small>
        </span>
      </label>
      <Refusal error={error} />
    </section>
  )
}
