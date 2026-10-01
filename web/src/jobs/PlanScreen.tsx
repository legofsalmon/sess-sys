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
  type Plan,
  type View,
} from '@sh/shared'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { NotDone, today, Top } from './common.tsx'

/**
 * The planner (ADR 0010): a week or a month of jobs, or of people, with the
 * crew still to find and the clashes to sort out. It only shows: changes are
 * made on the job's page or the Crew tab, a tap away.
 */

type Scale = 'week' | 'month'
type Rows = 'jobs' | 'people'
interface Place {
  scale: Scale
  day: string
  rows: Rows
}

/** What the address says is on screen: #plan/week/2026-10-05, or #plan/month/2026-10-01/people. */
function placeOf(hash: string, now: string): Place {
  const [, scale, day, rows] = hash.split('/')
  return { scale: scale === 'month' ? 'month' : 'week', day: day && isDay(day) ? day : now, rows: rows === 'people' ? 'people' : 'jobs' }
}

function hashOf(p: Place): string {
  return `#plan/${p.scale}/${p.scale === 'week' ? mondayOf(p.day) : addMonths(p.day, 0)}${p.rows === 'people' ? '/people' : ''}`
}

const daysOf = (scale: Scale, day: string) => (scale === 'week' ? weekOf(day) : monthOf(day))

/** List, Week and Month: the same jobs three ways. From the planner, the other scale opens on the same days. */
export function JobViews({ place }: { place?: Place }) {
  const now = today()
  const days = place && daysOf(place.scale, place.day)
  const day = days && !days.includes(now) ? days[0]! : now
  const rows = place?.rows ?? 'jobs'
  const current = place?.scale ?? 'list'
  return (
    <nav className="views" aria-label="Show jobs as">
      <a href="#jobs" aria-current={current === 'list' ? 'page' : undefined}>
        List
      </a>
      <a href={hashOf({ scale: 'week', day, rows })} aria-current={current === 'week' ? 'page' : undefined}>
        Week
      </a>
      <a href={hashOf({ scale: 'month', day, rows })} aria-current={current === 'month' ? 'page' : undefined}>
        Month
      </a>
    </nav>
  )
}

export function PlanScreen({ view, hash }: { view: View; hash: string }) {
  const now = today()
  const place = placeOf(hash, now)
  const { scale, day, rows } = place
  const days = useMemo(() => daysOf(scale, day), [scale, day])
  const p = useMemo(() => plan(view, days), [view, days])
  const [everyone, setEveryone] = useState(false)
  const at = (changes: Partial<Place>) => hashOf({ ...place, ...changes })
  const step = (n: number) => (scale === 'week' ? addDays(mondayOf(day), 7 * n) : addMonths(day, n))
  const title = scale === 'week' ? `${spanLabel({ start: days[0]!, end: days.at(-1)! })} ${days.at(-1)!.slice(0, 4)}` : monthLabel(day)
  const busy = p.people.filter((l) => Object.keys(l.days).length > 0)
  const people = everyone ? p.people : busy
  const lanes = rows === 'jobs' ? p.jobs.length : people.length
  const clashes = p.problems.filter((x) => x.severity === 'clash').length

  // On a phone the days start at today, so the day that matters most is in view: when the days change, and once there is something to show.
  const scroller = useRef<HTMLDivElement>(null)
  const shown = lanes > 0
  useEffect(() => {
    const el = scroller.current
    const names = el?.querySelector<HTMLElement>('thead th')
    const first = el?.querySelector<HTMLElement>('thead .today')
    if (el && names && first) el.scrollLeft = Math.max(0, first.offsetLeft - names.offsetWidth)
  }, [hash, shown])

  return (
    <div className="app crew jobs plan">
      <Top view={view} />
      <JobViews place={place} />
      <NotDone view={view} />

      <section className="card">
        <div className="plan-title">
          <h1>{title}</h1>
          <div className="filters" role="group" aria-label="Rows">
            <button type="button" aria-pressed={rows === 'jobs'} onClick={() => (location.hash = at({ rows: 'jobs' }))}>
              Jobs
            </button>
            <button type="button" aria-pressed={rows === 'people'} onClick={() => (location.hash = at({ rows: 'people' }))}>
              People
            </button>
          </div>
        </div>
        <div className="actions">
          <a className="button" href={at({ day: step(-1) })} aria-label={`Previous ${scale}`}>
            ‹ Previous
          </a>
          <a className="button" href={at({ day: now })}>
            This {scale}
          </a>
          <a className="button" href={at({ day: step(1) })} aria-label={`Next ${scale}`}>
            Next ›
          </a>
        </div>
        <p className="hint">{summary(p, scale)}</p>
      </section>

      {p.problems.length > 0 && (
        <section className={`card ${clashes ? 'attention' : 'checks'}`}>
          <h2>To sort out</h2>
          {p.problems.map((x) => (
            <div className="row problem" key={`${x.person.id} ${x.day}`}>
              <div>
                <b>{x.person.name}</b> <span className={`pill ${x.severity}`}>{x.severity === 'clash' ? 'Clash' : 'Check'}</span>
                <p>
                  {dayLabel(x.day)}: {x.text}
                </p>
              </div>
              <a className="button" href={x.jobId ? `#jobs/${x.jobId}` : '#crew'}>
                {x.jobId ? 'Open job' : 'Open Crew'}
              </a>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        {lanes === 0 && (
          <p className="empty">
            {rows === 'jobs'
              ? `Nothing on this ${scale}.`
              : p.people.length
                ? `No one is booked, offered work or unavailable this ${scale}.`
                : 'No people yet: add them on the Crew tab.'}
          </p>
        )}
        {lanes > 0 && (
          <div className="scroller" ref={scroller} tabIndex={0} role="region" aria-label={`${title}, by ${rows === 'jobs' ? 'job' : 'person'}`}>
            <table className={`timeline ${scale}`} style={{ '--days': days.length } as CSSProperties}>
              <colgroup>
                <col className="names" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">{rows === 'jobs' ? 'Job' : 'Person'}</th>
                  {days.map((d) => (
                    <th scope="col" key={d} className={dayClass(d, now)} aria-current={d === now ? 'date' : undefined}>
                      {scale === 'week' ? (
                        dayLabel(d)
                      ) : (
                        <a href={at({ scale: 'week', day: d })} aria-label={`${dayLabel(d)}: open its week`}>
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
                  ? p.jobs.map((lane) => (
                      <tr key={lane.key}>
                        <JobName lane={lane} />
                        {days.map((d) => (
                          <td key={d} className={dayClass(d, now)}>
                            {lane.days[d] && <JobDay lane={lane} cell={lane.days[d]} scale={scale} />}
                          </td>
                        ))}
                      </tr>
                    ))
                  : people.map((lane) => (
                      <tr key={lane.person.id}>
                        <th scope="row">
                          <b>{lane.person.name}</b>
                          {lane.person.kind === 'staff' && <small>Staff</small>}
                        </th>
                        {days.map((d) => (
                          <PersonDay key={d} cell={lane.days[d]} scale={scale} className={dayClass(d, now)} />
                        ))}
                      </tr>
                    ))}
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
  const clashes = p.problems.filter((x) => x.severity === 'clash').length
  const checks = p.problems.length - clashes
  if (clashes) parts.push(`${clashes} clash${clashes === 1 ? '' : 'es'}`)
  if (checks) parts.push(`${checks} to check`)
  return parts.join(' · ')
}

function dayClass(d: string, now: string): string | undefined {
  const weekend = [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())
  return [weekend && 'weekend', d === now && 'today'].filter(Boolean).join(' ') || undefined
}

function JobName({ lane }: { lane: JobLane }) {
  return (
    <th scope="row">
      <a href={lane.jobId ? `#jobs/${lane.jobId}` : '#crew'}>{lane.name}</a>
      {lane.pending ? <small>Waiting to sync</small> : lane.tentative && lane.status && <small>{STATUS_LABELS[lane.status]}</small>}
      {!lane.jobId && <small>On the Crew tab</small>}
    </th>
  )
}

/** A job's day: its phase, as the calendar titles it, and its crew. Amber when crew are still to find. */
function JobDay({ lane, cell, scale }: { lane: JobLane; cell: JobCell; scale: Scale }) {
  const phases = cell.phases.map((x) => x.label).join(', ')
  // Crew for a job rather than one of its phases can be on a day with no phase; that's only worth a look when their phase moved.
  const label = phases || (cell.stray ? 'No phase this day' : '')
  const crew = cell.needed > 0 ? `${cell.booked} of ${cell.needed} crew${cell.asked ? `, ${cell.asked} asked` : ''}` : ''
  const moved = phases && cell.stray ? 'Crew here from a phase that moved' : ''
  const words = [label, crew, moved].filter(Boolean).join(', ')
  const tone = cell.needed === 0 ? '' : cell.booked < cell.needed ? 'short' : 'full'
  const className = ['blk', lane.tentative ? 'dashed' : 'solid', tone, cell.stray && 'stray', lane.pending && 'pending'].filter(Boolean).join(' ')
  if (scale === 'month')
    return (
      <div className={className} title={`${lane.name}: ${words}`}>
        <span aria-hidden="true">{cell.phases[0] ? phaseCode(cell.phases[0].name) : cell.stray ? '?' : '•'}</span>
        <span className="sr-only">{words}</span>
      </div>
    )
  return (
    <div className={className}>
      {label ? <b>{label}</b> : null}
      {crew && (label ? <small>{crew}</small> : <b>{crew}</b>)}
      {moved && <small>{moved}</small>}
    </div>
  )
}

/** A person's day: where they're booked, offered or unavailable, and a clash or a check to sort out. */
function PersonDay({ cell, scale, className }: { cell: PersonCell | undefined; scale: Scale; className: string | undefined }) {
  const cls = [className, cell?.severity].filter(Boolean).join(' ') || undefined
  if (!cell) return <td className={cls} />
  const tag = cell.severity === 'clash' ? 'Clash' : cell.severity === 'check' ? 'Check' : ''
  if (scale === 'month') {
    const first = cell.work.find((w) => w.booked) ?? cell.work[0]
    const words = [
      tag && `${tag}: ${cell.problem}`,
      ...cell.work.map((w) => `${w.confirmed ? 'Booked on' : w.booked ? 'To confirm on' : 'Offered'} ${w.job}${w.phase ? `, ${w.phase}` : ''}`),
      cell.away !== null && `Unavailable${cell.away ? ` (${cell.away})` : ''}`,
    ]
      .filter(Boolean)
      .join('. ')
    return (
      <td className={cls}>
        <div className={`code ${first ? (first.booked ? 'booked' : 'offered') : 'away'}`} title={words}>
          <span aria-hidden="true">{first ? initials(first.job) : 'Off'}</span>
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
        </div>
      ))}
      {cell.away !== null && (
        <div className="item away">
          <b>Unavailable</b>
          {cell.away && <small>{cell.away}</small>}
        </div>
      )}
    </td>
  )
}

function Legend({ rows }: { rows: Rows }) {
  const keys: [string, string][] =
    rows === 'jobs'
      ? [
          ['blk solid', 'Confirmed'],
          ['blk dashed', 'Enquiry or quote'],
          ['blk solid full', 'All crew found'],
          ['blk solid short', 'Crew still to find'],
          ['blk solid stray', 'Crew on a day their phase moved off'],
        ]
      : [
          ['item booked', 'Booked, or to confirm'],
          ['item offered', 'Offered, no answer yet'],
          ['item away', 'Unavailable'],
          ['swatch clash', 'Clash: booked twice, or while unavailable'],
          ['swatch check', 'Check: would clash if they said yes'],
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
