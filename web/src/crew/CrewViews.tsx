import { answersToCheck, canApproveLeave } from '@sh/shared'
import type { View } from '@sh/shared'
import { useToday } from '../view.ts'
import { Views } from '../Views.tsx'
import { calendarAnswersToSortOut } from './CrewScreen.tsx'
import { useMe } from './Leave.tsx'

/**
 * Crew's row (ADR 0041): the calls and the answers to check, the people,
 * staff leave and timesheets. Calls and Leave count what the Crew tab's
 * badge counts between them, so the badge says which page to open;
 * Timesheets counts those to approve.
 */
export function CrewViews({ view, current }: { view: View; current: string }) {
  const today = useToday()
  const { me } = useMe(view)
  const calls = answersToCheck(view.crew, today).length + calendarAnswersToSortOut(view, today).length + view.late.toCheck.length + view.documents.toCheck.length
  const leave = canApproveLeave(me) ? view.leave.queue.length : 0
  return (
    <Views
      label="Crew pages"
      current={current}
      pages={[
        { key: 'calls', href: '#crew', label: 'Calls', count: calls },
        { key: 'people', href: '#crew/people', label: 'People' },
        { key: 'leave', href: '#crew/leave', label: 'Leave', count: leave },
        { key: 'timesheets', href: '#crew/timesheets', label: 'Timesheets', count: view.timesheets.toApprove.length },
      ]}
    />
  )
}
