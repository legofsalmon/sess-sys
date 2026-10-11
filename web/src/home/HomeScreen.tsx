import { canApproveLeave, crewFill, dayLabel, daysLabel, eachDay, firstName, leaveDaysLabel, plural, spanLabel, type PersonView, type View } from '@sh/shared'
import { useState } from 'react'
import { useMe } from '../crew/Leave.tsx'
import { Empty } from '../Empty.tsx'
import { Top } from '../jobs/common.tsx'
import { JobRow } from '../jobs/JobsScreen.tsx'
import { useToday, useView } from '../view.ts'
import { addDays, departmentsIn, jobsOn, narrower, TILES_FOR, tiles, weekAhead, type HomeFor, type Tile } from './standing.ts'

/**
 * Home (ADR 0033): how things stand, for whoever is looking. One screen,
 * shown for the whole company, a department, the warehouse, or me: the
 * personas in docs/personas.md. The view starts from who this person is
 * (their department, from their profile), which they can change, and the
 * phone remembers the choice, as a warehouse phone stays on the warehouse.
 * A count that's nothing isn't shown, so the few that are stand out
 * (healthy is quiet); each opens the screen that sorts it out.
 */

const KEY = 'sh.home'
export interface Saved {
  for: HomeFor
  department?: string
}

function load(): Saved | undefined {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null
    if (s && ['company', 'department', 'warehouse', 'me'].includes(s.for)) return s
  } catch {
    // Nothing saved, or storage is blocked: start from who they are.
  }
  return undefined
}

export function saveHomeFor(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Private browsing can refuse storage; the choice lasts this visit.
  }
}

const FOR: readonly [HomeFor, string][] = [
  ['company', 'Company'],
  ['department', 'Department'],
  ['warehouse', 'Warehouse'],
  ['me', 'Me'],
]

export function HomeScreen() {
  const view = useView()
  const today = useToday()
  const { me, pick } = useMe(view)
  const departments = departmentsIn(view.crew.people)
  const [saved, setSaved] = useState(load)
  // Nothing chosen yet: a head of department starts on their own, everyone else on the company.
  const shownFor: HomeFor = saved?.for ?? (me?.department ? 'department' : 'company')
  const department = saved?.department ?? me?.department ?? departments[0]
  const choose = (next: Saved) => {
    saveHomeFor(next)
    setSaved(next)
  }

  return (
    <div className="app home">
      <Top view={view} title="Home" root />
      <p className="home-day">
        {dayLabel(today)}
        {me && ` · Hello, ${firstName(me)}`}
      </p>

      <div className="views home-for" role="group" aria-label="Show for">
        {FOR.map(([f, label]) => (
          <button
            key={f}
            type="button"
            aria-pressed={shownFor === f}
            onClick={(e) => {
              // A toggle, not a move: it keeps focus, as the Shell expects of one (audit finding 22).
              e.currentTarget.focus()
              choose({ for: f, department })
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {shownFor === 'company' && <ForCompany view={view} today={today} me={me} />}
      {shownFor === 'department' && (
        <ForDepartment view={view} today={today} me={me} departments={departments} department={department} onDepartment={(d) => choose({ for: 'department', department: d })} />
      )}
      {shownFor === 'warehouse' && <ForWarehouse view={view} today={today} me={me} />}
      {shownFor === 'me' && <ForMe view={view} today={today} me={me} onPick={pick} />}
    </div>
  )
}

/** The counts that aren't nothing, as tiles; a word when all are. */
function Tiles({ all, keys, title = 'Needs attention', clear }: { all: Record<string, Tile>; keys: readonly string[]; title?: string; clear: string }) {
  const shown = keys.map((k) => all[k]!).filter((t) => t && t.count > 0)
  return (
    <section className="card standing">
      <h2>{title}</h2>
      {shown.length === 0 ? (
        <p className="all-clear">{clear}</p>
      ) : (
        <ul className="tiles">
          {shown.map((t) => (
            <li key={t.key}>
              <a className={`tile${t.bad ? ' bad' : ''}`} href={t.href}>
                <b>{t.count.toLocaleString('en-IE')}</b>
                <span>{t.label}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** What's on today, each job with its crew; the next one when nothing is. */
function Today({ view, today }: { view: View; today: string }) {
  const on = jobsOn(view, today)
  const next = on.length === 0 ? weekAhead(view, today)[0] : undefined
  return (
    <section className="card">
      <h2>Today{on.length > 0 ? ` (${on.length})` : ''}</h2>
      {on.length === 0 ? (
        <p className="empty">Nothing on today.{next?.span && ` Next: ${next.name}, ${dayLabel(next.span.start)}.`}</p>
      ) : (
        <ul className="job-list">
          {on.map((j) => (
            <li key={j.id}>
              <JobRow job={j} kit={view.kit.byJob.get(j.id)} current={false} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function WeekAhead({ view, today }: { view: View; today: string }) {
  const week = weekAhead(view, today)
  return (
    <section className="card">
      <h2>The week ahead{week.length > 0 ? ` (${week.length})` : ''}</h2>
      {week.length === 0 ? (
        <Empty>Nothing starts in the next seven days.</Empty>
      ) : (
        <ul className="job-list">
          {week.map((j) => (
            <li key={j.id}>
              <JobRow job={j} kit={view.kit.byJob.get(j.id)} current={false} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ForCompany({ view, today, me }: { view: View; today: string; me: PersonView | undefined }) {
  const confirmed = view.jobs.jobs.filter((j) => j.status === 'confirmed' && j.span && j.span.end >= today).length
  const pencilled = view.jobs.jobs.filter((j) => (j.status === 'enquiry' || j.status === 'quoted') && (!j.span || j.span.end >= today)).length
  return (
    <>
      <Today view={view} today={today} />
      <Tiles all={tiles(view, today, me)} keys={TILES_FOR.company} clear="Nothing waiting on anyone. Everything else is as it should be." />
      <WeekAhead view={view} today={today} />
      <section className="card">
        <h2>Coming up</h2>
        <p className="hint">
          {plural(confirmed, 'confirmed job')} from today on, and {plural(pencilled, 'enquiry or quote', 'enquiries and quotes')} not yet decided. <a href="#jobs">All jobs</a>
        </p>
      </section>
    </>
  )
}

function ForDepartment({
  view,
  today,
  me,
  departments,
  department,
  onDepartment,
}: {
  view: View
  today: string
  me: PersonView | undefined
  departments: string[]
  department: string | undefined
  onDepartment: (d: string) => void
}) {
  if (!department)
    return (
      <section className="card">
        <Empty>Nobody has a department yet. Set one on each person's card on the Crew tab, and each head of department can see just theirs here.</Empty>
      </section>
    )
  const by = narrower(department)
  const week = addDays(today, 6)
  // Who in the department is working this week, and who's away: what a head of department plans around.
  const working = view.crew.calls
    .filter((c) => c.status === 'open' && c.end >= today && c.start <= week)
    .flatMap((c) => c.offers.filter((o) => o.status === 'confirmed' && o.person && !o.person.archived && by.person(o.person) && o.days.some((d) => d >= today && d <= week)).map((o) => ({ c, o })))
    .sort((a, b) => a.o.days[0]!.localeCompare(b.o.days[0]!) || a.o.person!.name.localeCompare(b.o.person!.name))
  const people = new Map(view.crew.people.map((p) => [p.id, p]))
  const away = view.crew.unavailability
    .filter((u) => u.end >= today && u.start <= week && by.person(people.get(u.personId)) && !people.get(u.personId)?.archived)
    .sort((a, b) => a.start.localeCompare(b.start))
  return (
    <>
      <label className="field home-department">
        Department
        <select value={department} onChange={(e) => onDepartment(e.target.value)}>
          {(departments.includes(department) ? departments : [department, ...departments]).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <Tiles all={tiles(view, today, me, department)} keys={TILES_FOR.department} title={`Needs attention in ${department}`} clear={`Nothing waiting in ${department}.`} />
      <p className="hint">Crew still needed and kit still out after a job are for every department, on Crew and Stock: a call doesn't say its department yet.</p>
      <section className="card">
        <h2>Working this week{working.length > 0 ? ` (${working.length})` : ''}</h2>
        {working.length === 0 ? (
          <Empty>Nobody in {department} is booked in the next seven days.</Empty>
        ) : (
          <ul className="job-list">
            {working.map(({ c, o }) => (
              <li key={o.id}>
                <a className="job-row" href={c.projectId ? `#jobs/${c.projectId}` : '#crew'}>
                  <div>
                    <b>{o.person!.name}</b>
                    <p>
                      {c.role} · {c.project}
                      {c.phase && `, ${c.phase}`}
                    </p>
                  </div>
                  <div className="side">
                    <small>{daysLabel(o.days.filter((d) => d >= today && d <= week))}</small>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      {away.length > 0 && (
        <section className="card">
          <h2>Away this week ({away.length})</h2>
          <ul className="job-list">
            {away.map((u) => (
              <li key={u.id}>
                <div className="job-row">
                  <div>
                    <b>{people.get(u.personId)?.name ?? 'Someone'}</b>
                    <p>{u.source === 'leave' ? 'Approved leave' : u.note || 'Away'}</p>
                  </div>
                  <div className="side">
                    <small>{daysLabel(eachDay(u.start, u.end))}</small>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function ForWarehouse({ view, today, me }: { view: View; today: string; me: PersonView | undefined }) {
  const tomorrow = addDays(today, 1)
  const out = view.moves.soon.filter((p) => p.job.span && p.job.span.start <= addDays(today, 7))
  const word = (start: string) => (start <= today ? 'Today · ' : start === tomorrow ? 'Tomorrow · ' : '')
  return (
    <>
      <section className="card">
        <h2>Going out{out.length > 0 ? ` (${out.length})` : ''}</h2>
        {out.length === 0 ? (
          <Empty>No confirmed job needs kit in the next seven days.</Empty>
        ) : (
          <ul className="job-list">
            {out.map((p) => (
              <li key={p.job.id}>
                <a className="job-row" href={`#jobs/${p.job.id}/pick`}>
                  <div>
                    <b>{p.job.name}</b>
                    <p>
                      {word(p.job.span!.start)}
                      {spanLabel(p.job.span!)}
                    </p>
                  </div>
                  <div className="side">
                    <small className={`flag ${p.out >= p.need ? 'ok' : ''}`}>
                      {p.out} of {p.need} out
                    </small>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Tiles all={tiles(view, today, me)} keys={TILES_FOR.warehouse} clear="Nothing back late, broken or due a test." />
      {view.moves.stillOut.length > 0 && (
        <section className="card">
          <h2>Coming back ({view.moves.stillOut.length})</h2>
          <ul className="job-list">
            {view.moves.stillOut.map((p) => (
              <li key={p.job.id}>
                <a className="job-row" href={`#jobs/${p.job.id}/pick`}>
                  <div>
                    <b>{p.job.name}</b>
                    <p>{p.job.span ? `Ended ${dayLabel(p.job.span.end)}` : 'No dates'}</p>
                  </div>
                  <div className="side">
                    <small className="flag bad">{p.stillOut} still out</small>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function ForMe({ view, today, me, onPick }: { view: View; today: string; me: PersonView | undefined; onPick: (id: string) => void }) {
  const [id, setId] = useState('')
  if (!me) {
    const staff = view.leave.staff
    return (
      <section className="card">
        <h2>Who are you?</h2>
        {staff.length === 0 ? (
          <Empty>Add staff on the Crew tab, with Type set to Staff, to see your own work here.</Empty>
        ) : (
          <form
            className="who-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (id) onPick(id)
            }}
          >
            <label className="field">
              Your name
              <select value={id} onChange={(e) => setId(e.target.value)}>
                <option value="">Pick your name…</option>
                {staff.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">Until sign-in is on, this device takes your word for it, and remembers the answer, as Leave does.</p>
            <button type="submit" className="primary" disabled={!id}>
              That's me
            </button>
          </form>
        )}
      </section>
    )
  }
  const mine = view.crew.calls
    .filter((c) => c.status === 'open' && c.end >= today)
    .flatMap((c) => c.offers.filter((o) => o.personId === me.id && (o.status === 'confirmed' || o.status === 'accepted')).map((o) => ({ c, o })))
    .sort((a, b) => (a.o.days.find((d) => d >= today) ?? '').localeCompare(b.o.days.find((d) => d >= today) ?? ''))
  const asked = view.crew.calls.filter((c) => c.status === 'open' && c.end >= today && c.offers.some((o) => o.personId === me.id && (o.status === 'offered' || o.status === 'countered'))).length
  const year = Number(today.slice(0, 4))
  const balance = me.kind === 'staff' ? view.leave.balance(me.id, year) : undefined
  const waiting = view.leave.requestsFor(me.id, year).filter((r) => r.status === 'waiting')
  const approver = canApproveLeave(me)
  return (
    <>
      <section className="card">
        <h2>Your work{mine.length > 0 ? ` (${mine.length})` : ''}</h2>
        {mine.length === 0 ? (
          <Empty>No bookings coming up.</Empty>
        ) : (
          <ul className="job-list">
            {mine.map(({ c, o }) => (
              <li key={o.id}>
                <a className="job-row" href={c.projectId ? `#jobs/${c.projectId}` : '#crew'}>
                  <div>
                    <b>{c.project}</b>
                    <p>
                      {c.role}
                      {c.phase && ` · ${c.phase}`}
                      {c.venue && ` · ${c.venue}`}
                    </p>
                  </div>
                  <div className="side">
                    <small>{daysLabel(o.days.filter((d) => d >= today))}</small>
                    {c.callTime && <small>Call {c.callTime}</small>}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
        {asked > 0 && <p className="hint">{plural(asked, 'offer')} waiting on your answer, on your own link.</p>}
      </section>
      {balance && (
        <section className="card">
          <h2>Your leave</h2>
          <p>
            {leaveDaysLabel(balance.annual.left)} of annual leave left this year, {leaveDaysLabel(balance.lieu.left)} in lieu to take.
            {waiting.length > 0 && ` ${plural(waiting.length, 'request')} waiting to be approved.`}
          </p>
          <a className="button" href="#crew/leave">
            Open leave
          </a>
        </section>
      )}
      {approver && <Tiles all={tiles(view, today, me)} keys={TILES_FOR.me} title="Waiting on you" clear="No time off waiting on you." />}
      <Today view={view} today={today} />
    </>
  )
}
