import { canApproveLeave, crewByDay, crewFill, departmentOf, jobsByMonth, jobsByWeek, kitByDay, moneyByMonth, myWeeks, dayLabel, daysLabel, eachDay, firstName, leaveDaysLabel, money, moneyMonth, plural, spanLabel, STATUS_LABELS, type Department, type JobView, type PersonView, type View } from '@sh/shared'
import { useState } from 'react'
import { useMe } from '../crew/Leave.tsx'
import { Empty } from '../Empty.tsx'
import { Top } from '../jobs/common.tsx'
import { JobRow } from '../jobs/JobsScreen.tsx'
import { kitShort } from '../jobs/Kit.tsx'
import { useToday, useView } from '../view.ts'
import { addDays, departmentsIn, jobsOn, kitOf, narrower, TILES_FOR, tiles, weekAhead, type HomeFor, type Tile } from './standing.ts'
import { Heading } from '../Icon.tsx'
import { Avatar, photoOf } from '../Picture.tsx'
import { arrive } from '../arrival.ts'
import { useAccess } from '../role.ts'
import { Chart, type Series } from './Chart.tsx'
import { Copying, STILL_ARRIVING, useCopying } from './copying.ts'

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
    <Copying.Provider value={view.copying !== false}>
      <div className="app home">
        {/* Today's date top right, so Home is the page's one title (Colly, 12 October 2026). */}
        <Top view={view} title="Home" root aside={<span className="top-date">{dayLabel(today)}</span>} />
        {me && <p className="home-day">Hello, {firstName(me)}</p>}

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
    </Copying.Provider>
  )
}

/** The counts that aren't nothing, as tiles; a word when all are. */
function Tiles({ all, keys, title = 'Needs attention', clear, department }: { all: Record<string, Tile>; keys: readonly string[]; title?: string; clear: string; department?: string }) {
  const shown = keys.map((k) => all[k]!).filter((t) => t && t.count > 0)
  const copying = useCopying()
  return (
    <section className="card standing">
      <h2>{title}</h2>
      {copying ? (
        <p className="all-clear">{STILL_ARRIVING}</p>
      ) : shown.length === 0 ? (
        <p className="all-clear">{clear}</p>
      ) : (
        <ul className="tiles">
          {shown.map((t) => (
            <li key={t.key}>
              <a className={`tile${t.bad ? ' bad' : ''}`} href={t.href} onClick={() => arrive({ hash: t.href, part: t.part, department })}>
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

/** What's on today, a line a job with its crew (audit finding 22); the next one when nothing is. */
function Today({ view, today }: { view: View; today: string }) {
  const on = jobsOn(view, today)
  const next = on.length === 0 ? weekAhead(view, today).find((j) => j.status !== 'enquiry') : undefined
  const copying = useCopying()
  return (
    <section className="card">
      <Heading icon="time">Today{on.length > 0 ? ` (${on.length})` : ''}</Heading>
      {on.length === 0 && copying ? (
        <p className="empty">{STILL_ARRIVING}</p>
      ) : on.length === 0 ? (
        <p className="empty">Nothing on today.{next?.span && ` Next: ${next.name}, ${dayLabel(next.span.start)}.`}</p>
      ) : (
        <ul className="job-list">
          {on.map((j) => (
            <li key={j.id}>
              <TodayRow job={j} view={view} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** A job on today in one line: its name, then a quote not yet confirmed, its crew and kit short, as the jobs list says them. */
function TodayRow({ job, view }: { job: JobView; view: View }) {
  const crew = crewFill(job.calls)
  const short = kitShort(view.kit.byJob.get(job.id))
  return (
    <a className="job-row today-row" href={`#jobs/${job.id}`}>
      <b>{job.name}</b>
      <span className="side">
        {job.status !== 'confirmed' && <small>{STATUS_LABELS[job.status]}</small>}
        {crew.needed > 0 && (
          <small>
            Crew {crew.booked} of {crew.needed}
          </small>
        )}
        {short && <small className={`flag ${short}`}>Kit short</small>}
      </span>
    </a>
  )
}

function WeekAhead({ view, today }: { view: View; today: string }) {
  const week = weekAhead(view, today)
  const copying = useCopying()
  return (
    <section className="card">
      <Heading icon="calendar">The week ahead{week.length > 0 ? ` (${week.length})` : ''}</Heading>
      {week.length === 0 && copying ? (
        <p className="empty">{STILL_ARRIVING}</p>
      ) : week.length === 0 ? (
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
  const { can } = useAccess()
  const confirmed = view.jobs.jobs.filter((j) => j.status === 'confirmed' && j.span && j.span.end >= today).length
  const pencilled = view.jobs.jobs.filter((j) => (j.status === 'enquiry' || j.status === 'quoted') && (!j.span || j.span.end >= today)).length
  return (
    <>
      {/* What needs someone first, then what's on (audit finding 22). */}
      <Tiles all={tiles(view, today, me, can)} keys={TILES_FOR.company} clear="Nothing waiting on anyone. Everything else is as it should be." />
      <Today view={view} today={today} />
      <Chart title="Jobs by week" icon="calendar" series={JOBS} columns={jobsByWeek(view.jobs.jobs, today)} empty="No gigs or hires in the next eight weeks." />
      <CrewChart view={view} today={today} />
      <WeekAhead view={view} today={today} />
      <Chart
        title="The season"
        icon="calendar"
        series={JOBS}
        columns={jobsByMonth(view.jobs.jobs, today)}
        empty="No gigs or hires in the six months either side of this one."
        more={
          <p className="hint">
            {plural(confirmed, 'confirmed job')} from today on, and {plural(pencilled, 'enquiry or quote', 'enquiries and quotes')} not yet decided. <a href="#jobs">All jobs</a>
          </p>
        }
      />
      <MoneyCard view={view} today={today} />
    </>
  )
}

/** For the director and the office (ADR 0042): this month's quotes and who owes, a tap from Money. */
function MoneyCard({ view, today }: { view: View; today: string }) {
  const sees = useAccess().can('money')
  const m = view.money
  if (!sees || !m.any) return null
  const month = m.months.find((x) => x.key === moneyMonth(today).key)
  const owed = m.owed.reduce((s, o) => s + o.cents, 0)
  const toFreelancers = m.costsOwed.reduce((s, c) => s + c.cents, 0)
  return (
    <Chart
      title="Money"
      icon="document"
      series={MONEY}
      columns={moneyByMonth(m.months, today)}
      format={wholeEuro}
      empty="No quotes in the three months either side of this one."
      more={
        <p className="hint">
          {money(month?.confirmed ?? 0)} confirmed of {money(month?.quoted ?? 0)} quoted for {moneyMonth(today).label}, before VAT. {money(owed)} owed by{' '}
          {plural(m.owed.length, 'client')}, and {money(toFreelancers)} to freelancers. <a href="#jobs/money">Money</a>
        </p>
      }
    />
  )
}

/** Each chart's parts, bottom up: settled first, then not yet, then short (ADR 0054). */
const JOBS: Series[] = [
  { name: 'confirmed', tone: 'settled' },
  { name: 'not yet decided', tone: 'pending' },
]
const CREW: Series[] = [
  { name: 'booked', tone: 'settled' },
  { name: 'waiting to confirm', tone: 'pending' },
  { name: 'still needed', tone: 'short' },
]
const KIT: Series[] = [
  { name: 'for confirmed jobs', tone: 'settled' },
  { name: 'pencilled in', tone: 'pending' },
]
const DAYS: Series[] = [
  { name: 'confirmed', tone: 'settled' },
  { name: 'waiting to confirm', tone: 'pending' },
]
const MONEY: Series[] = [
  { name: 'confirmed', tone: 'settled' },
  { name: 'still a quote', tone: 'pending' },
]
/** A chart's money to the euro: the cents are in the money screen. */
const wholeEuro = (cents: number) => `€${Math.round(cents / 100).toLocaleString('en-IE')}`

/** Crew on each of the next fourteen days, for everyone or one department's calls. */
function CrewChart({ view, today, department }: { view: View; today: string; department?: string }) {
  return (
    <Chart
      title={department ? `${department} crew, the next fortnight` : 'Crew, the next fortnight'}
      icon="people"
      series={CREW}
      columns={crewByDay(view.crew.calls, today, 14, department)}
      empty={department ? `No ${department} calls in the next fourteen days.` : 'No crew called in the next fourteen days.'}
      more={
        <a className="chart-more" href="#crew">
          Crew calls
        </a>
      }
    />
  )
}

/** Items held for jobs on each of the next fourteen days, for all the kit or one department's. */
function KitChart({ view, today, department }: { view: View; today: string; department?: Department }) {
  return (
    <Chart
      title="Kit booked out, the next fortnight"
      icon="kit"
      series={KIT}
      columns={kitByDay(view.kit.lines, today, 14, department ? (l) => l.model?.department === department : undefined)}
      format={(n) => n.toLocaleString('en-IE')}
      empty="No kit held for jobs in the next fourteen days."
      more={
        <a className="chart-more" href="#stock">
          Stock
        </a>
      }
    />
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
  const { can } = useAccess()
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
  // Calls are counted by their own department (ADR 0046): those with none aren't in the tile, so it says how many.
  const fortnight = addDays(today, 14)
  const noDepartment = view.crew.calls.filter((c) => c.status === 'open' && c.end >= today && c.start <= fortnight && c.openDays.some((d) => d >= today) && !departmentOf(c)?.trim()).length
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
      <Tiles all={tiles(view, today, me, can, department)} keys={TILES_FOR.department} department={department} title={`Needs attention in ${department}`} clear={`Nothing waiting in ${department}.`} />
      <p className="hint">
        {noDepartment > 0 &&
          `${plural(noDepartment, 'call')} still needing crew in the next fortnight ${noDepartment === 1 ? "has no department, so it isn't" : "have no department, so they aren't"} counted here: give ${noDepartment === 1 ? 'it' : 'them'} one on Crew. `}
        Kit still out after a job is the job's, not a department's: it's on Stock.
      </p>
      <CrewChart view={view} today={today} department={department} />
      {kitOf(department) && <KitChart view={view} today={today} department={kitOf(department)} />}
      <section className="card">
        <Heading icon="people">Working this week{working.length > 0 ? ` (${working.length})` : ''}</Heading>
        {working.length === 0 ? (
          <Empty>Nobody in {department} is booked in the next seven days.</Empty>
        ) : (
          <ul className="job-list">
            {working.map(({ c, o }) => (
              <li key={o.id}>
                <a className="job-row" href={c.projectId ? `#jobs/${c.projectId}` : '#crew'}>
                  <Avatar name={o.person!.name} src={photoOf(o.person)} />
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
          <Heading icon="leave">Away this week ({away.length})</Heading>
          <ul className="job-list">
            {away.map((u) => (
              <li key={u.id}>
                <div className="job-row">
                  <Avatar name={people.get(u.personId)?.name ?? ''} src={photoOf(people.get(u.personId))} />
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
  const { can } = useAccess()
  const tomorrow = addDays(today, 1)
  const out = view.moves.soon.filter((p) => p.job.span && p.job.span.start <= addDays(today, 7))
  const word = (start: string) => (start <= today ? 'Today · ' : start === tomorrow ? 'Tomorrow · ' : '')
  return (
    <>
      <section className="card">
        <Heading icon="van">Going out{out.length > 0 ? ` (${out.length})` : ''}</Heading>
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
      <Tiles all={tiles(view, today, me, can)} keys={TILES_FOR.warehouse} clear="Nothing back late, broken or due a test." />
      <KitChart view={view} today={today} />
      {view.moves.stillOut.length > 0 && (
        <section className="card">
          <Heading icon="warehouse">Coming back ({view.moves.stillOut.length})</Heading>
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
  const { can } = useAccess()
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
  const copying = useCopying()
  return (
    <>
      <section className="card">
        <Heading icon="calendar">Your work{mine.length > 0 ? ` (${mine.length})` : ''}</Heading>
        {mine.length === 0 && copying ? (
          <p className="empty">{STILL_ARRIVING}</p>
        ) : mine.length === 0 ? (
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
      <Chart title="Your weeks" icon="calendar" series={DAYS} columns={myWeeks(view.crew.calls, me.id, today)} format={(n) => plural(n, 'day')} empty="No days booked in the next eight weeks." />
      {balance && (
        <section className="card">
          <Heading icon="leave">Your leave</Heading>
          {copying ? (
            <p className="empty">{STILL_ARRIVING}</p>
          ) : (
            <p>
              {leaveDaysLabel(balance.annual.left)} of annual leave left this year, {leaveDaysLabel(balance.lieu.left)} in lieu to take.
              {waiting.length > 0 && ` ${plural(waiting.length, 'request')} waiting to be approved.`}
            </p>
          )}
          <a className="button" href="#crew/leave">
            Open leave
          </a>
        </section>
      )}
      {approver && <Tiles all={tiles(view, today, me, can)} keys={TILES_FOR.me} title="Waiting on you" clear="No time off waiting on you." />}
      <Today view={view} today={today} />
    </>
  )
}
