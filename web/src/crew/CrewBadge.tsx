import { canApproveLeave } from '@sh/shared'
import { useAccess } from '../role.ts'
import { useToday, useView } from '../view.ts'
import { crewToCheck } from './CrewViews.tsx'
import { useMe } from './Leave.tsx'

/**
 * On the Crew tab: how many answers wait for the office (a yes to confirm,
 * a counter, a decline or a pull-out not yet noted), from this device's own
 * copy, so it's right with no signal too (audit finding 9); an answer on
 * Google Calendar the app couldn't act on, to sort out; anyone running
 * late not yet noted (ADR 0028); a document sent from a link, to check
 * (ADR 0029); and, for someone who can approve time
 * off, the leave waiting on them (ADR 0024). Certificates running out
 * aren't counted: they're known weeks ahead, and a badge always lit stops
 * being read. The office's part only for a role that can act on it
 * (audit of 18 October): staff crew and the warehouse see their own leave
 * to approve, if any, and nothing else.
 * Nothing while there's nothing waiting. Not a status, so the top bar's
 * stays the one.
 */
export function CrewBadge() {
  const view = useView()
  const today = useToday()
  const { me } = useMe(view)
  const mayCrew = useAccess().can('crew')
  const n = (mayCrew ? crewToCheck(view, today) : 0) + (canApproveLeave(me) ? view.leave.queue.length : 0)
  if (n === 0) return null
  return (
    <span className="badge">
      <span aria-hidden="true">{n}</span>
      <span className="sr-only">{n === 1 ? ', 1 to check' : `, ${n} to check`}</span>
    </span>
  )
}
