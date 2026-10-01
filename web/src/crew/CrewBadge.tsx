import { answersToCheck, canApproveLeave } from '@sh/shared'
import { today, useView } from '../jobs/common.tsx'
import { useMe } from './Leave.tsx'

/**
 * On the Crew tab: how many answers wait for the office (a yes to confirm,
 * a counter, a decline or a pull-out not yet noted), from this device's own
 * copy, so it's right with no signal too (audit finding 9); and, for
 * someone who can approve time off, the leave waiting on them (ADR 0024).
 * Nothing while there's nothing waiting. Not a status, so the top bar's
 * stays the one.
 */
export function CrewBadge() {
  const view = useView()
  const { me } = useMe(view)
  const n = answersToCheck(view.crew, today()).length + (canApproveLeave(me) ? view.leave.queue.length : 0)
  if (n === 0) return null
  return (
    <span className="badge">
      <span aria-hidden="true">{n}</span>
      <span className="sr-only">{n === 1 ? ', 1 to check' : `, ${n} to check`}</span>
    </span>
  )
}
