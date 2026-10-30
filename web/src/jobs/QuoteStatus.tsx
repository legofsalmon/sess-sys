import { QUOTE_STATUS_LABELS, type JobView, type QuoteStatus, type QuoteView } from '@sh/shared'
import { Refusal, useAct } from '../act.tsx'
import { StatusPill, type PillTone } from '../StatusPill.tsx'
import { client } from '../sync.ts'

/**
 * A quote's status as a pill (ADR 0042), and the job's own step its client's
 * answer calls for (ADR 0081): parts other screens show too.
 */

const TONE: Record<QuoteStatus, PillTone> = { draft: 'pending', sent: 'pending', accepted: 'confirmed', declined: 'cancelled' }

export function QuotePill({ q }: { q: QuoteView }) {
  return (
    <StatusPill tone={q.paidOn ? 'confirmed' : TONE[q.status]} pending={q.pending}>
      {q.paidOn ? 'Paid' : q.invoicedOn ? 'Invoiced' : QUOTE_STATUS_LABELS[q.status]}
    </StatusPill>
  )
}

/**
 * The client has answered, and the job doesn't say so yet (ADR 0081): confirm it, or mark it lost, with one press.
 * Offered, not done by itself: confirming puts the job on the calendar and holds its kit, and losing it cancels its
 * crew calls, which the office should see happen.
 */
export function InStep({ job, want, compact }: { job: JobView; want: 'confirmed' | 'lost'; compact?: boolean }) {
  const { run, error } = useAct()
  const go = () => void run(() => client.mutate('project.update', { id: job.id, status: want }))
  return (
    <div className="in-step">
      {!compact && (
        <p>
          {want === 'confirmed'
            ? `The client accepted, and the job is still ${job.status === 'enquiry' ? 'an enquiry' : 'quoted'}. Confirming it puts it on the jobs calendar and holds its kit.`
            : `The client turned it down, and the job is still ${job.status === 'enquiry' ? 'an enquiry' : 'quoted'}. Marking it lost cancels any crew calls on it.`}
        </p>
      )}
      <button type="button" className={want === 'confirmed' ? 'primary' : undefined} onClick={go} disabled={job.pending}>
        {want === 'confirmed' ? 'Confirm the job' : 'Mark the job lost'}
      </button>
      <Refusal error={error} />
    </div>
  )
}
