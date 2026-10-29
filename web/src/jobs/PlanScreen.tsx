import {
  addDays,
  addMonths,
  dayLabel,
  initials,
  isDay,
  mondayOf,
  monthLabel,
  monthOf,
  phaseCode,
  plan,
  spanLabel,
  STATUS_LABELS,
  weekOf,
  type JobCell,
  type JobLane,
  type PersonCell,
  type VanCell,
  type VanLane,
  type Plan,
  type PlanProblem,
  type VanProblem,
  type View,
} from '@sh/shared'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { personHref } from '../crew/PersonScreen.tsx'
import { useMoreEdges } from '../more.tsx'
import { useAccess } from '../role.ts'
import { StatusPill, WAITING_TO_SYNC } from '../StatusPill.tsx'
import { useUnderTop } from '../useUnderTop.ts'
import { useToday } from '../view.ts'
import { Top } from './common.tsx'
import { Views } from '../Views.tsx'
import { vehicleHref } from '../stock/Vehicles.tsx'

/**
 * The planner (ADR 0010): a week or a month of jobs, of people, or of the
 * company's vehicles (ADR 0047), with the crew still to find and the
 * clashes to sort out: a person or a van on two jobs at once. It only shows: changes are
 * made on the job's page or the Crew tab, a tap away.
 */

type Scale = 'week' | 'month'
type Rows = 'jobs' | 'people' | 'vans'
interface Place {
  scale: Scale
  day: string
  rows: Rows
}

/** What the address says is on screen: #jobs/plan/week/2026-10-05, or #jobs/plan/month/2026-10-01/people, or …/vans. */
function placeOf(hash: string, now: string): Place {
  const [, , scale, day, rows] = hash.split('/')
  return { scale: scale === 'month' ? 'month' : 'week', day: day && isDay(day) ? day : now, rows: rows === 'people' || rows === 'vans' ? rows : 'jobs' }
}

function hashOf(p: Place): string {
  return `#jobs/plan/${p.scale}/${p.scale === 'week' ? mondayOf(p.day) : addMonths(p.day, 0)}${p.rows === 'jobs' ? '' : `/${p.rows}`}`
}

const daysOf = (scale: Scale, day: string) => (scale === 'week' ? weekOf(day) : monthOf(day))

/**
 * Jobs' row (Views.tsx): List, Week and Month, the same jobs three ways,
 * then the clients and the venues they're for. From the planner, the other
 * scale opens on the same days.
 */
export function JobViews({ place, current }: { place?: Place; current?: 'clients' | 'venues' | 'money' }) {
  const now = useToday()
  // Money is the office's and directors' (ADR 0042): a role that isn't sent it has no page for it.
  const money = useAccess().can('money')
  const days = place && daysOf(place.scale, place.day)
  const day = days && !days.includes(now) ? days[0]! : now
  const rows = place?.rows ?? 'jobs'
  return (
    <Views
      label="Jobs pages"
      current={current ?? place?.scale ?? 'list'}
      pages={[
        { key: 'list', href: '#jobs', label: 'List' },
        { key: 'week', href: hashOf({ scale: 'week', day, rows }), label: 'Week' },
        { key: 'month', href: hashOf({ scale: 'month', day, rows }), label: 'Month' },
        { key: 'clients', href: '#jobs/clients', label: 'Clients' },
        { key: 'venues', href: '#jobs/venues', label: 'Venues' },
        ...(money ? [{ key: 'money', href: '#jobs/money', label: 'Money' }] : []),
      ]}
    />
  )
}

export function PlanScreen({ view, hash }: { view: View; hash: string }) {
  const now = useToday()
  const place = placeOf(hash, now)
  const { scale, day, rows } = place
  const days = useMemo(() => daysOf(scale, day), [scale, day])
  const p = useMemo(() => plan(view, days, now), [view, days, now])
  const [everyone, setEveryone] = useState(false)
  const at = (changes: Partial<Place>) => hashOf({ ...place, ...changes })
  // Jobs or people is a toggle, not a move, so it keeps focus (audit finding 22). Safari, and Firefox on a Mac, don't focus a button they press, so it takes focus itself: the Shell sees a toggle in focus and leaves it there.
  const toggle = (to: Rows) => (e: MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.focus()
    location.hash = at({ rows: to })
  }
  const step = (n: number) => (scale === 'week' ? addDays(mondayOf(day), 7 * n) : addMonths(day, n))
  const title = scale === 'week' ? `${spanLabel({ start: days[0]!, end: days.at(-1)! })} ${days.at(-1)!.slice(0, 4)}` : monthLabel(day)
  const busy = p.people.filter((l) => Object.keys(l.days).length > 0)
  const people = everyone ? p.people : busy
  const lanes = rows === 'jobs' ? p.jobs.length : rows === 'people' ? people.length : p.vans.length
  const rowWord = rows === 'jobs' ? 'job' : rows === 'people' ? 'person' : 'vehicle'

  // On a phone the days start at today, so the day that matters most is in view: when the days change, and once there is something to show.
  const scroller = useRef<HTMLDivElement>(null)
  // The days stay along the top of a long month: the timeline scrolls inside a frame that ends at the foot of the screen, under the bar.
  const card = useUnderTop<HTMLElement>(true)
  const shown = lanes > 0
  useEffect(() => {
    const el = scroller.current
    const names = el?.querySelector<HTMLElement>('thead th')
    const first = el?.querySelector<HTMLElement>('thead .today')
    if (el && names && first) el.scrollLeft = Math.max(0, first.offsetLeft - names.offsetWidth)
  }, [hash, shown])
  // A week is wider than a phone: the edge with more days past it fades, as Money's tables do (audit, 20 October 2026, finding 77).
  useMoreEdges(scroller, shown)

  return (
    <div className="app crew jobs plan">
      {/* The days shown are the page's name (ADR 0082), what's on them the line under it; moving and what the rows are sit together under that. */}
      <Top view={view} views={<JobViews place={place} />} heading={title} sub={<p>{summary(p, scale)}</p>} />

      <div className="plan-bar">
        <div className="steps">
          <a className="button" href={at({ day: step(-1) })} aria-label={`Previous ${scale}`}>
            ‹ Previous
          </a>
          <a className="button" href={at({ day: now })} aria-current={days.includes(now) ? 'date' : undefined}>
            This {scale}
          </a>
          <a className="button" href={at({ day: step(1) })} aria-label={`Next ${scale}`}>
            Next ›
          </a>
        </div>
        <div className="filters" role="group" aria-label="Rows">
          <button type="button" aria-pressed={rows === 'jobs'} onClick={toggle('jobs')}>
            Jobs
          </button>
          <button type="button" aria-pressed={rows === 'people'} onClick={toggle('people')}>
            People
          </button>
          {/* Only once there are vehicles to plan (ADR 0047). */}
          {(p.vans.length > 0 || rows === 'vans') && (
            <button type="button" aria-pressed={rows === 'vans'} onClick={toggle('vans')}>
              Vans
            </button>
          )}
        </div>
      </div>

      <SortOut problems={p.problems} vanProblems={p.vanProblems} />

      <section className="card timeline-card" ref={card}>
        {lanes === 0 && (
          <p className="empty">
            {rows === 'jobs'
              ? `Nothing on this ${scale}.`
              : rows === 'vans'
                ? 'No vehicles yet: add them on Stock › Vehicles.'
                : p.people.length
                  ? `No one is booked, offered work, unavailable or busy this ${scale}.`
                  : 'No people yet: add them on the Crew tab.'}
          </p>
        )}
        {lanes > 0 && (
          <div className="scroller more-edges" ref={scroller} tabIndex={0} role="region" aria-label={`${title}, by ${rowWord}`}>
            <table className={`timeline ${scale}`} style={{ '--days': days.length } as CSSProperties}>
              <colgroup>
                <col className="names" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">{rows === 'jobs' ? 'Job' : rows === 'people' ? 'Person' : 'Vehicle'}</th>
                  {days.map((d) => (
                    <th scope="col" key={d} className={dayClass(d, now, p.holidays)} aria-current={d === now ? 'date' : undefined} title={p.holidays[d]}>
                      {scale === 'week' ? (
                        <>
                          {dayLabel(d)}
                          {d === now && <small className="today-word">Today</small>}
                          {/* A public holiday (ADR 0024) is named on its day, so nobody counts it as a working day. */}
                          {p.holidays[d] && <small className="holiday-name">{p.holidays[d]}</small>}
                        </>
                      ) : (
                        <a href={at({ scale: 'week', day: d })} aria-label={`${dayLabel(d)}${p.holidays[d] ? `, ${p.holidays[d]}` : ''}: open its week`}>
                          <small>{dayLabel(d).slice(0, 2)}</small>
                          {Number(d.slice(8))}
                        </a>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows === 'jobs'
                  ? p.jobs.map((lane) => {
                      const joined = joins(days, (d) => lane.days[d] && jobRun(lane.days[d]))
                      return (
                        <tr key={lane.key}>
                          <JobName lane={lane} />
                          {days.map((d) => (
                            <td key={d} className={dayClass(d, now, p.holidays)}>
                              {lane.days[d] && <JobDay lane={lane} cell={lane.days[d]} scale={scale} join={joined[d]} />}
                            </td>
                          ))}
                        </tr>
                      )
                    })
                  : rows === 'vans'
                    ? p.vans.map((lane) => {
                        const joined = scale === 'month' ? joins(days, (d) => codeRun(lane.days[d], (w) => w.held)) : {}
                        return (
                        <tr key={lane.vehicle.id}>
                          <th scope="row">
                            <a href={vehicleHref(lane.vehicle.id)}>
                              <b>{lane.vehicle.name}</b>
                            </a>
                            {lane.vehicle.registration && <small>{lane.vehicle.registration}</small>}
                          </th>
                          {days.map((d) => (
                            <VanDay key={d} lane={lane} cell={lane.days[d]} scale={scale} className={dayClass(d, now, p.holidays)} join={joined[d]} />
                          ))}
                        </tr>
                        )
                      })
                    : people.map((lane) => {
                      const joined = scale === 'month' ? joins(days, (d) => codeRun(lane.days[d], (w) => w.booked)) : {}
                      return (
                      <tr key={lane.person.id}>
                        <th scope="row">
                          <a href={personHref(lane.person.id)}>
                            <b>{lane.person.name}</b>
                          </a>
                          {lane.person.kind === 'staff' && <small>Staff</small>}
                        </th>
                        {days.map((d) => (
                          <PersonDay key={d} cell={lane.days[d]} scale={scale} className={dayClass(d, now, p.holidays)} join={joined[d]} />
                        ))}
                      </tr>
                      )
                    })}
              </tbody>
            </table>
          </div>
        )}
        {rows === 'people' && busy.length < p.people.length && (
          <label className="everyone">
            <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} />
            Show everyone ({p.people.length - busy.length} with nothing on this {scale})
          </label>
        )}
        <Legend rows={rows} />
      </section>
    </div>
  )
}

function summary(p: Plan, scale: Scale): string {
  const parts = [p.jobs.length ? `${p.jobs.length} job${p.jobs.length === 1 ? '' : 's'} this ${scale}` : `Nothing on this ${scale}`]
  const crew = p.jobs.some((l) => Object.values(l.days).some((x) => x.needed > 0))
  if (crew) parts.push(p.short ? `crew still needed on ${p.short} day${p.short === 1 ? '' : 's'}` : 'crew found for every day')
  const all = [...p.problems, ...p.vanProblems]
  const clashes = all.filter((x) => x.severity === 'clash').length
  const checks = all.length - clashes
  if (clashes) parts.push(`${clashes} clash${clashes === 1 ? '' : 'es'}`)
  if (checks) parts.push(`${checks} to check`)
  return parts.join(' · ')
}

function dayClass(d: string, now: string, holidays: Record<string, string>): string | undefined {
  const weekend = [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())
  return [weekend && 'weekend', d in holidays && 'holiday', d === now && 'today'].filter(Boolean).join(' ') || undefined
}

/** How a day's block meets the days either side: a phase over several days reads as one bar, as on a wall planner. */
type Join = 'l' | 'r' | 'lr' | undefined

/**
 * Days next to each other with the same run join up. A day with nothing on, or something to sort out, says undefined, so a clash or a
 * check always stands on its own.
 */
function joins(days: readonly string[], run: (d: string) => string | undefined): Record<string, Join> {
  const runs = days.map(run)
  const out: Record<string, Join> = {}
  days.forEach((d, i) => {
    const l = !!runs[i] && runs[i] === runs[i - 1]
    const r = !!runs[i] && runs[i] === runs[i + 1]
    out[d] = l && r ? 'lr' : l ? 'l' : r ? 'r' : undefined
  })
  return out
}

/** A job's days join while they're the same phase, looking the same: a build over three days, not the build into the show. */
function jobRun(cell: JobCell): string | undefined {
  const phases = cell.phases.map((x) => x.name).join(' + ')
  if (!phases) return undefined
  return [phases, tone(cell), cell.stray].join('|')
}

/** A person's or a vehicle's day in a month joins the next while it's the same job, held the same way, with nothing to sort out. */
function codeRun<W extends { job: string }>(cell: { work: W[]; severity: unknown } | undefined, held: (w: W) => boolean): string | undefined {
  if (!cell || cell.severity || cell.work.length !== 1) return undefined
  const w = cell.work[0]!
  return `${w.job}|${held(w)}`
}

const tone = (cell: JobCell) => (cell.needed === 0 ? '' : cell.booked < cell.needed ? 'short' : 'full')
const joinClass = (join: Join) => (join ? `join-${join}` : undefined)

function JobName({ lane }: { lane: JobLane }) {
  return (
    <th scope="row">
      <a href={lane.jobId ? `#jobs/${lane.jobId}` : '#crew'}>{lane.name}</a>
      {lane.pending ? <small>{WAITING_TO_SYNC}</small> : lane.tentative && lane.status && <small>{STATUS_LABELS[lane.status]}</small>}
      {!lane.jobId && <small>On the Crew tab</small>}
    </th>
  )
}

/** A job's day: its phase, as the calendar titles it, and its crew. Amber when crew are still to find. */
function JobDay({ lane, cell, scale, join }: { lane: JobLane; cell: JobCell; scale: Scale; join: Join }) {
  const phases = cell.phases.map((x) => x.label).join(', ')
  // Crew for a job rather than one of its phases can be on a day with no phase; that's only worth a look when their phase moved.
  const label = phases || (cell.stray ? 'No phase this day' : '')
  const crew = cell.needed > 0 ? `${cell.booked} of ${cell.needed} crew${cell.asked ? `, ${cell.asked} asked` : ''}` : ''
  const moved = phases && cell.stray ? 'Crew here from a phase that moved' : ''
  const vans = cell.vans?.length ? `Vehicles: ${cell.vans.join(', ')}` : ''
  const words = [label, crew, moved, ...(cell.late ?? []), vans].filter(Boolean).join(', ')
  const className = ['blk', lane.tentative ? 'dashed' : 'solid', tone(cell), cell.stray && 'stray', lane.pending && 'pending', joinClass(join)].filter(Boolean).join(' ')
  // The day opens its job, as the name does; a call from the Crew tab has no job to open.
  const Block = lane.jobId ? 'a' : 'div'
  const href = lane.jobId ? `#jobs/${lane.jobId}` : undefined
  if (scale === 'month')
    return (
      <Block className={className} href={href} title={`${lane.name}: ${words}`}>
        {/* A run says its code once, on its first day. */}
        <span aria-hidden="true">{join === 'l' || join === 'lr' ? '' : cell.phases[0] ? phaseCode(cell.phases[0].name) : cell.stray ? '?' : '•'}</span>
        <span className="sr-only">{words}</span>
      </Block>
    )
  return (
    <Block className={className} href={href}>
      {label ? <b>{label}</b> : null}
      {crew && (label ? <small>{crew}</small> : <b>{crew}</b>)}
      {moved && <small>{moved}</small>}
      {/* Said on their link today (ADR 0028), so whoever plans the day sees it where they look. */}
      {cell.late?.map((l) => (
        <small key={l} className="late">
          {l}
        </small>
      ))}
      {/* The vans going (ADR 0047), with who drives. */}
      {vans && <small className="vans">{vans}</small>}
    </Block>
  )
}

/** A person's day: where they're booked, offered or unavailable, and a clash or a check to sort out. */
function PersonDay({ cell, scale, className, join }: { cell: PersonCell | undefined; scale: Scale; className: string | undefined; join?: Join }) {
  const cls = [className, cell?.severity].filter(Boolean).join(' ') || undefined
  if (!cell) return <td className={cls} />
  const tag = cell.severity === 'clash' ? 'Clash' : cell.severity === 'check' ? 'Check' : ''
  if (scale === 'month') {
    const first = cell.work.find((w) => w.booked) ?? cell.work[0]
    const words = [
      tag && `${tag}: ${cell.problem}`,
      ...cell.work.map((w) => `${w.confirmed ? 'Booked on' : w.booked ? 'To confirm on' : 'Offered'} ${w.job}${w.phase ? `, ${w.phase}` : ''}${w.late ? `, ${w.late}` : ''}`),
      cell.away !== null && `Unavailable${cell.away ? ` (${cell.away})` : ''}`,
      cell.busy !== null && `Busy in their own calendar (${cell.busy})`,
    ]
      .filter(Boolean)
      .join('. ')
    return (
      <td className={cls}>
        {/* Busy in their own calendar and nothing else: hatched and empty, the words for a screen reader and on hover (ADR 0044). */}
        <div className={['code', first ? (first.booked ? 'booked' : 'offered') : cell.away !== null ? 'away' : 'busy', joinClass(join)].filter(Boolean).join(' ')} title={words}>
          <span aria-hidden="true">{join === 'l' || join === 'lr' ? '' : first ? initials(first.job) : cell.away !== null ? 'Off' : ''}</span>
          <span className="sr-only">{words}</span>
        </div>
      </td>
    )
  }
  return (
    <td className={cls} title={cell.problem ?? undefined}>
      {tag && <span className="tag">{tag}</span>}
      {cell.work.map((w) => (
        <div key={w.callId} className={`item ${w.booked ? 'booked' : 'offered'}`}>
          {w.jobId ? <a href={`#jobs/${w.jobId}`}>{w.job}</a> : <b>{w.job}</b>}
          <small>{[!w.booked && 'Offered', w.phase, w.role].filter(Boolean).join(' · ')}</small>
          {w.late && <small className="late">{w.late}</small>}
        </div>
      ))}
      {cell.away !== null && (
        <div className="item away">
          <b>Unavailable</b>
          {cell.away && <small>{cell.away}</small>}
        </div>
      )}
      {/* Read from their own calendar (ADR 0044): shown, never a clash, since it may be something they can move. */}
      {cell.busy !== null && (
        <div className="item busy">
          <b>Busy (own calendar)</b>
          <small>{cell.busy}</small>
        </div>
      )}
    </td>
  )
}

/** A vehicle's day: the jobs it's on, with who drives, and off the road; a clash or a check as for a person. */
function VanDay({ lane, cell, scale, className, join }: { lane: VanLane; cell: VanCell | undefined; scale: Scale; className: string | undefined; join?: Join }) {
  const cls = [className, cell?.severity].filter(Boolean).join(' ') || undefined
  if (!cell) return <td className={cls} />
  const tag = cell.severity === 'clash' ? 'Clash' : cell.severity === 'check' ? 'Check' : ''
  const offRoad = cell.offRoad !== null ? `Off the road${cell.offRoad ? ` (${cell.offRoad})` : ''}` : ''
  if (scale === 'month') {
    const first = cell.work.find((w) => w.held) ?? cell.work[0]
    const words = [
      tag && `${tag}: ${cell.problem}`,
      ...cell.work.map((w) => `${w.held ? 'On' : 'Pencilled in for'} ${w.job}${w.phase ? `, ${w.phase}` : ''}${w.driver ? `, ${w.driver} driving` : ', no driver yet'}`),
      offRoad,
    ]
      .filter(Boolean)
      .join('. ')
    return (
      <td className={cls}>
        <div className={['code', first ? (first.held ? 'booked' : 'offered') : 'away', joinClass(join)].filter(Boolean).join(' ')} title={`${lane.vehicle.name}: ${words}`}>
          <span aria-hidden="true">{join === 'l' || join === 'lr' ? '' : first ? initials(first.job) : 'Off'}</span>
          <span className="sr-only">{words}</span>
        </div>
      </td>
    )
  }
  return (
    <td className={cls} title={cell.problem ?? undefined}>
      {tag && <span className="tag">{tag}</span>}
      {cell.work.map((w) => (
        <div key={w.bookingId} className={`item ${w.held ? 'booked' : 'offered'}`}>
          <a href={`#jobs/${w.jobId}`}>{w.job}</a>
          <small>{[!w.held && 'Pencilled in', w.phase, w.driver ? `${w.driver} driving` : 'No driver yet'].filter(Boolean).join(' · ')}</small>
        </div>
      ))}
      {offRoad && (
        <div className="item away">
          <b>Off the road</b>
          {cell.offRoad && <small>{cell.offRoad}</small>}
        </div>
      )}
    </td>
  )
}

function Legend({ rows }: { rows: Rows }) {
  const keys: [string, string][] =
    rows === 'vans'
      ? [
          ['item booked', 'On a confirmed job'],
          ['item offered', 'Pencilled in: an enquiry or quote'],
          ['item away', 'Off the road'],
          ['swatch clash', 'Clash: on two jobs, or booked while off the road or with a check run out'],
          ['swatch check', 'Check: would clash if the pencilled job goes ahead'],
          ['swatch holiday', 'Public holiday'],
        ]
      : rows === 'jobs'
      ? [
          ['blk solid', 'Confirmed'],
          ['blk dashed', 'Enquiry or quote'],
          ['blk solid short', 'Crew still to find'],
          ['blk solid stray', 'Crew on a day their phase moved off'],
          ['swatch holiday', 'Public holiday'],
        ]
      : [
          ['item booked', 'Booked, or to confirm'],
          ['item offered', 'Offered, no answer yet'],
          ['item away', 'Unavailable, or on leave'],
          ['item busy', 'Busy in their own calendar: they may still say yes'],
          ['swatch clash', 'Clash: booked twice, or while unavailable'],
          ['swatch check', 'Check: would clash if they said yes'],
          ['swatch holiday', 'Public holiday'],
        ]
  return (
    <ul className="legend" aria-label="Key">
      {keys.map(([cls, label]) => (
        <li key={label}>
          <i className={cls} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  )
}

/**
 * Clashes first, then checks, for people and then vans, each with the job
 * to open. Days gone are left out (ADR 0069). The planner shows it for the
 * days on screen, the notifications for the next four weeks.
 */
export function SortOut({ problems, vanProblems, hint }: { problems: readonly PlanProblem[]; vanProblems: readonly VanProblem[]; hint?: string }) {
  if (problems.length + vanProblems.length === 0) return null
  const clashes = [...problems, ...vanProblems].filter((x) => x.severity === 'clash').length
  return (
    <section className={`card ${clashes ? 'attention' : 'checks'}`}>
      <h2>To sort out</h2>
      {hint && <p className="hint">{hint}</p>}
      {problems.map((x) => (
        <div className="row problem" key={`${x.person.id} ${x.day}`}>
          <div>
            <b>{x.person.name}</b> <StatusPill tone={x.severity === 'clash' ? 'bad' : 'pending'}>{x.severity === 'clash' ? 'Clash' : 'Check'}</StatusPill>
            <p>
              {dayLabel(x.day)}: {x.text}
            </p>
          </div>
          <a className="button" href={x.jobId ? `#jobs/${x.jobId}` : '#crew'}>
            {x.jobId ? 'Open job' : 'Open Crew'}
          </a>
        </div>
      ))}
      {/* A van on two jobs, or booked while off the road or with a check run out (ADR 0047). */}
      {vanProblems.map((x) => (
        <div className="row problem" key={`van ${x.vehicle.id} ${x.day}`}>
          <div>
            <b>{x.vehicle.name}</b> <StatusPill tone={x.severity === 'clash' ? 'bad' : 'pending'}>{x.severity === 'clash' ? 'Clash' : 'Check'}</StatusPill>
            <p>
              {dayLabel(x.day)}: {x.text}
            </p>
          </div>
          <a className="button" href={x.jobId ? `#jobs/${x.jobId}` : vehicleHref(x.vehicle.id)}>
            {x.jobId ? 'Open job' : 'Open vehicle'}
          </a>
        </div>
      ))}
    </section>
  )
}
