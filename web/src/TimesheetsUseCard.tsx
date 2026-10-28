import type { OfficeView } from '@sh/shared'
import { Refusal, useAct } from './act.tsx'
import { Pending } from './StatusPill.tsx'
import { client } from './sync.ts'

/**
 * Timesheets (ADR 0089), for the office. A company that pays crew from its
 * own records has no use for them on day one, so they start off: no
 * Timesheets page, count or notification, and no freelancer is asked to
 * send one from their link. Turning them on brings back every timesheet
 * already kept, as it was; turning them off deletes nothing.
 */
export function TimesheetsUseCard({ office }: { office: OfficeView }) {
  const { run, error } = useAct()
  const on = office.useTimesheets
  return (
    <section className="card" aria-label="Timesheets">
      <h2>
        Timesheets <Pending pending={office.timesheetsPending} />
      </h2>
      <p>
        Crew send the days they worked and their extras from their own link, and the office checks and approves them under Crew › Timesheets. Turning
        this off hides them everywhere, here and on the crew's links, and keeps every timesheet already sent.
      </p>
      <label className="signal">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(e) => void run(() => client.mutate('timesheets.use', { on: e.target.checked }))}
        />
        <span>
          <b>Use timesheets</b>
          <small>
            {on ? 'Crew send theirs from their link once a booking’s days are done.' : 'Off: no Timesheets page, and nobody is asked for one.'}
          </small>
        </span>
      </label>
      <Refusal error={error} />
    </section>
  )
}
