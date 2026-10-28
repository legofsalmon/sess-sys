import { answersToCheck, canApproveLeave } from '@sh/shared'
import type { View } from '@sh/shared'
import { useAccess } from '../role.ts'
import { useToday } from '../view.ts'
import { Views } from '../Views.tsx'
import { calendarAnswersToSortOut } from './CrewScreen.tsx'
import { useMe } from './Leave.tsx'

/**
 * Crew's row (ADR 0041): the calls and the answers to check, the people,
 * staff leave and timesheets. Calls and Leave count what the Crew tab's
 * badge counts between them, so the badge says which page to open;
 * Timesheets counts those to approve. Calls and Timesheets count only for
 * a role that can act on them (audit of 18 October). Timesheets is left
 * off the row while the company doesn't use them (ADR 0090).
 */
export function CrewViews({ view, current }: { view: View; current: string }) {
  const today = useToday()
  const { me } = useMe(view)
  const mayCrew = useAccess().can('crew')
  const calls = mayCrew ? crewToCheck(view, today) : 0
  const leave = canApproveLeave(me) ? view.leave.queue.length : 0
  return (
    <Views
      label="Crew pages"
      current={current}
      pages={[
        { key: 'calls', href: '#crew', label: 'Calls', count: calls },
        { key: 'people', href: '#crew/people', label: 'People' },
        { key: 'leave', href: '#crew/leave', label: 'Leave', count: leave },
        ...(view.office.useTimesheets ? [{ key: 'timesheets', href: '#crew/timesheets', label: 'Timesheets', count: mayCrew ? view.timesheets.toApprove.length : 0 }] : []),
      ]}
    />
  )
}

/** What waits on the office under Calls: answers to check or sort out, anyone running late, documents sent in. */
export function crewToCheck(view: View, today: string): number {
  return answersToCheck(view.crew, today).length + calendarAnswersToSortOut(view, today).length + view.late.toCheck.length + view.documents.toCheck.length
}
