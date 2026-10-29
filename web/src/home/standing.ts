import { answersToCheck, canApproveLeave, departmentOf, kindOf, runningOut, sameDepartment, type Ability, type Department, type JobView, type PersonView, type View } from '@sh/shared'
import { calendarAnswersToSortOut } from '../crew/CrewScreen.tsx'

/**
 * How things stand, for Home (ADR 0033): every count Home can show, each
 * with where it's sorted out, worked out from this device's own copy so it
 * is right with no signal too. Home picks which to show by who it's shown
 * for; this says what each one is.
 */

/** Who Home is shown for: the personas in docs/personas.md. */
export type HomeFor = 'company' | 'department' | 'warehouse' | 'me'

export interface Tile {
  key: string
  count: number
  /** What the count is of, after the number: "answers to check". */
  label: string
  href: string
  /** The part of that screen it counted, by its heading, landed on when it's tapped (audit, 20 October 2026, finding 4). */
  part?: string
  /** Something stopping work, drawn as bad; otherwise neutral. */
  bad?: boolean
}

/**
 * A crew department's kit, by the stock list's departments, so a head of
 * department sees their own kit as well as their own people. Departments
 * with no kit of their own (production, transport, stage managers) have
 * none.
 */
const KIT_OF: Record<string, Department> = {
  audio: 'audio',
  backline: 'audio',
  lx: 'lighting',
  lighting: 'lighting',
  laser: 'lighting',
  video: 'video',
  'led tech': 'video',
  led: 'video',
  rigger: 'rigging',
  rigging: 'rigging',
  staging: 'staging',
  power: 'power',
}
export const kitOf = (department: string): Department | undefined => KIT_OF[department.trim().toLowerCase()]

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

/** The departments people are in, each once, by name: the ones a head of department can pick. */
export function departmentsIn(people: readonly PersonView[]): string[] {
  const out: string[] = []
  for (const p of people) if (!p.archived && p.department && !out.some((d) => d.toLowerCase() === p.department!.toLowerCase())) out.push(p.department)
  return out.sort((a, b) => a.localeCompare(b))
}

/** Narrows to one department: people by their profile, kit by the matching stock department. Everything, with no department. */
export function narrower(department: string | undefined) {
  const wanted = department?.trim().toLowerCase()
  const kit = department ? kitOf(department) : undefined
  return {
    person: (p: Pick<PersonView, 'department'> | undefined) => !wanted || p?.department?.trim().toLowerCase() === wanted,
    kit: (d: Department | undefined) => !wanted || (!!kit && d === kit),
  }
}

/** The jobs on a day, by a phase on it: going ahead or quoted, never an enquiry (audit finding 22), the cancelled or the lost. */
export function jobsOn(view: View, day: string): JobView[] {
  return view.jobs.jobs.filter((j) => j.status !== 'cancelled' && j.status !== 'lost' && j.status !== 'enquiry' && j.phases.some((p) => p.start <= day && p.end >= day))
}

/**
 * Jobs from tomorrow to a week on, by when they start: the week ahead. Held
 * to Today's rule and the Jobs by week chart's (audit, 20 October 2026,
 * finding 32): going ahead or quoted, never an enquiry; gigs and hires are
 * the work, and the errands and meetings are said apart, behind one line.
 */
export function weekAhead(view: View, today: string): { work: JobView[]; errands: JobView[] } {
  const end = addDays(today, 7)
  const all = view.jobs.jobs
    .filter((j) => j.status !== 'cancelled' && j.status !== 'lost' && j.status !== 'enquiry' && j.span && j.span.end > today && j.span.start <= end && !j.phases.some((p) => p.start <= today && p.end >= today))
    .sort((a, b) => a.span!.start.localeCompare(b.span!.start) || a.name.localeCompare(b.name))
  const work = (j: JobView) => kindOf(j) === 'gig' || kindOf(j) === 'hire'
  return { work: all.filter(work), errands: all.filter((j) => !work(j)) }
}

/**
 * What each count needs before it's offered: a tile opens a page to act
 * on, so it's only for someone who can (ADR 0034 point 7; audit, 20
 * October 2026, finding 3). Leave is for whoever approves it, whatever
 * their role.
 */
const NEEDS: Record<string, Ability | 'approve-leave'> = {
  late: 'crew',
  answers: 'crew',
  'crew-needed': 'crew',
  timesheets: 'crew',
  certificates: 'crew',
  leave: 'approve-leave',
  'to-pick': 'stock',
  'still-out': 'stock',
  'kit-short': 'kit',
  faults: 'stock',
  'cant-go': 'stock',
  'tests-soon': 'stock',
  vehicles: 'stock',
  counts: 'stock',
}

/** Every count Home knows that this person can act on, narrowed to a department when one is given, keyed for picking. */
export function tiles(view: View, today: string, me: PersonView | undefined, can: (a: Ability) => boolean, department?: string): Record<string, Tile> {
  const by = narrower(department)
  const answers =
    answersToCheck(view.crew, today).filter((a) => by.person(a.offer.person)).length +
    (department ? 0 : calendarAnswersToSortOut(view, today).length) +
    view.documents.toCheck.filter((d) => by.person(d.person)).length
  const late = view.late.toCheck.filter((n) => by.person(n.person)).length
  const fortnight = addDays(today, 14)
  // A call's own department (ADR 0046), so a head of department sees the calls their department fills.
  const crewNeeded = view.crew.calls.filter(
    (c) => c.status === 'open' && c.end >= today && c.start <= fortnight && c.openDays.some((d) => d >= today) && (!department || sameDepartment(departmentOf(c), department)),
  ).length
  // Only the ones this person can decide: a timesheet whose amounts they aren't sent is the office's (ADR 0062).
  const timesheets = view.timesheets.toApprove.filter((r) => by.person(r.person) && !r.amountsHidden).length
  const leave = view.leave.queue.filter((q) => by.person(q.person)).length
  const certificates = runningOut(view.crew.people, view.documents.all, today).filter((r) => by.person(r.person)).length
  const short = view.kit.short.filter((l) => by.kit(l.model?.department))
  const tomorrow = addDays(today, 1)
  const toPick = view.moves.soon.filter((p) => p.job.span && p.job.span.start <= tomorrow && p.out < p.need).length
  const stillOut = view.moves.stillOut.length
  const faults = view.faults.open.filter((f) => by.kit(f.model?.department))
  const tests = view.inspections.attention.filter((d) => by.kit(d.asset.model?.department))
  const cantGo = tests.filter((d) => d.state !== 'soon').length
  const counts = view.counts.week.due.length
  // A vehicle's checks run out or running out (ADR 0047); run out on one it needs on the road, it can't be booked.
  const vehicleChecks = view.vehicles.reminders
  const vehicleRanOut = vehicleChecks.some((r) => r.ranOut && r.kind !== 'service')
  const approver = canApproveLeave(me)

  const all: Tile[] = [
    { key: 'late', count: late, label: late === 1 ? 'person running late, not yet noted' : 'people running late, not yet noted', href: '#crew', part: 'Answers to check' },
    { key: 'answers', count: answers, label: answers === 1 ? 'answer to check' : 'answers to check', href: '#crew', part: 'Answers to check' },
    { key: 'crew-needed', count: crewNeeded, label: crewNeeded === 1 ? 'call still needs crew' : 'calls still need crew', href: '#crew', part: 'Crew needed' },
    { key: 'timesheets', count: timesheets, label: timesheets === 1 ? 'timesheet to approve' : 'timesheets to approve', href: '#crew/timesheets', part: 'To approve' },
    { key: 'leave', count: leave, label: leave === 1 ? 'leave request waiting on you' : 'leave requests waiting on you', href: '#crew/leave', part: 'To approve' },
    { key: 'certificates', count: certificates, label: certificates === 1 ? 'certificate or document running out' : 'certificates and documents running out', href: '#crew/people' },
    { key: 'to-pick', count: toPick, label: toPick === 1 ? 'job to pick for today or tomorrow' : 'jobs to pick for today or tomorrow', href: '#stock', part: 'Pick lists' },
    { key: 'still-out', count: stillOut, label: stillOut === 1 ? 'job with kit still out after it' : 'jobs with kit still out after them', href: '#stock', bad: true, part: 'Still out after the job' },
    { key: 'kit-short', count: short.length, label: short.length === 1 ? 'kit line short' : 'kit lines short', href: '#stock', bad: short.some((l) => l.hold === 'held'), part: 'Kit short' },
    { key: 'faults', count: faults.length, label: faults.length === 1 ? 'fault open' : 'faults open', href: '#stock/repairs', bad: faults.some((f) => f.stops) },
    { key: 'cant-go', count: cantGo, label: cantGo === 1 ? "item can't go out until tested" : "items can't go out until tested", href: '#stock/testing', bad: true, part: 'Inspections due' },
    { key: 'tests-soon', count: tests.length - cantGo, label: 'inspections due in 30 days', href: '#stock/testing', part: 'Inspections due' },
    { key: 'vehicles', count: vehicleChecks.length, label: vehicleChecks.length === 1 ? 'vehicle check running out' : 'vehicle checks running out', href: '#stock/vehicles', bad: vehicleRanOut, part: 'Vehicle checks running out' },
    { key: 'counts', count: counts, label: counts === 1 ? 'place to count this week' : 'places to count this week', href: '#stock/count' },
  ]
  // Timesheets only while the company uses them (ADR 0090).
  const offered = (t: Tile) => (t.key !== 'timesheets' || view.office.useTimesheets) && (NEEDS[t.key] === 'approve-leave' ? approver : can(NEEDS[t.key] as Ability))
  return Object.fromEntries(all.filter(offered).map((t) => [t.key, t]))
}

/** Which counts each view of Home shows, in order: the first is what that person reaches for first. */
export const TILES_FOR: Record<HomeFor, readonly string[]> = {
  company: ['late', 'answers', 'crew-needed', 'kit-short', 'still-out', 'to-pick', 'faults', 'cant-go', 'timesheets', 'leave', 'certificates', 'vehicles', 'counts'],
  // Only what can be narrowed to a department: crew calls by their own department (ADR 0046); kit still out is the job's, not a department's.
  department: ['late', 'answers', 'crew-needed', 'leave', 'timesheets', 'certificates', 'kit-short', 'faults', 'cant-go', 'tests-soon'],
  warehouse: ['to-pick', 'still-out', 'kit-short', 'faults', 'cant-go', 'counts', 'tests-soon', 'vehicles'],
  me: ['leave'],
}
