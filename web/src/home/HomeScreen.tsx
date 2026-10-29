import { canApproveLeave, crewByDay, kindOf, crewFill, departmentOf, jobsByMonth, jobsByWeek, kitByDay, moneyByMonth, myWeeks, dayLabel, daysLabel, eachDay, firstName, leaveDaysLabel, money, moneyMonth, plural, spanLabel, STATUS_LABELS, type Department, type JobView, type PersonView, type View } from '@sh/shared'
import { useState } from 'react'
import { useMe } from '../crew/Leave.tsx'
import { linkFor } from '../crew/Messages.tsx'
import { STATUS } from '../crew/Calls.tsx'
import { StatusPill } from '../StatusPill.tsx'
import { Empty } from '../Empty.tsx'
import { Top } from '../jobs/common.tsx'
import { kitShort } from '../jobs/Kit.tsx'
import { BelowZero } from '../jobs/Money.tsx'
import { useToday, useView } from '../view.ts'
import { addDays, departmentsIn, jobsOn, kitOf, narrower, SOON, TILES_FOR, tiles, weekAhead, type HomeFor, type Tile } from './standing.ts'
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
  // Nothing chosen yet: a role without crew (staff crew, a freelancer) starts on Me, their own work (audit, 20 October 2026,
  // finding 34); a head of department on their own; everyone else on the company.
  const mayCrew = useAccess().can('crew')
  const shownFor: HomeFor = saved?.for ?? (!mayCrew ? 'me' : me?.department ? 'department' : 'company')
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

        {/* The job steps given to whoever is looking (ADR 0073): their to-do list, on top of whichever view. */}
        {me && <MySteps view={view} me={me} all={shownFor === 'me'} />}
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

/**
 * The counts that aren't nothing, as tiles; a word when all are. Grouped, what
 * stops the next fortnight's work comes first and the housekeeping after,
 * smaller (audit, 20 October 2026, finding 33).
 */
function Tiles({ all, keys, title = 'Needs attention', clear, department, grouped = true }: { all: Record<string, Tile>; keys: readonly string[]; title?: string; clear: string; department?: string; grouped?: boolean }) {
  const shown = keys.map((k) => all[k]!).filter((t) => t && t.count > 0)
  const copying = useCopying()
  const soon = grouped ? shown.filter((t) => SOON.has(t.key)) : shown
  const rest = grouped ? shown.filter((t) => !SOON.has(t.key)) : []
  const list = (tiles: Tile[], className = 'tiles') => (
    <ul className={className}>
      {tiles.map((t) => (
        <li key={t.key}>
          <a className={`tile${t.bad ? ' bad' : ''}`} href={t.href} onClick={() => arrive({ hash: t.href, part: t.part, department })}>
            <b>{t.count.toLocaleString('en-IE')}</b>
            <span>{t.label}</span>
          </a>
        </li>
      ))}
    </ul>
  )
  return (
    <section className="card standing">
      <h2>{title}</h2>
      {copying ? (
        <p className="all-clear">{STILL_ARRIVING}</p>
      ) : shown.length === 0 ? (
        <p className="all-clear">{clear}</p>
      ) : !grouped ? (
        list(shown)
      ) : (
        <>
          <p className="hint">What stops the next fortnight's work first, then the housekeeping. Each goes once it's sorted.</p>
          {soon.length > 0 && (
            <>
              <h3>The next fortnight</h3>
              {list(soon)}
            </>
          )}
          {rest.length > 0 && (
            <>
              <h3>Housekeeping</h3>
              {list(rest, 'tiles housekeeping')}
            </>
          )}
        </>
      )}
    </section>
  )
}

/** What's on today, a line a job with its crew (audit finding 22); the next one when nothing is. */
function Today({ view, today }: { view: View; today: string }) {
  const on = jobsOn(view, today)
  const ahead = on.length === 0 ? weekAhead(view, today) : undefined
  const next = ahead && [...ahead.work, ...ahead.errands].sort((a, b) => a.span!.start.localeCompare(b.span!.start))[0]
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
              <JobLine job={j} view={view} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** A job in one line: its name, then (in the week ahead) its first day, a quote not yet confirmed, its crew and kit short, as the jobs list says them. */
function JobLine({ job, view, from }: { job: JobView; view: View; from?: boolean }) {
  const crew = crewFill(job.calls)
  const short = kitShort(view.kit.byJob.get(job.id))
  return (
    <a className="job-row today-row" href={`#jobs/${job.id}`}>
      <b>{job.name}</b>
      <span className="side">
        {from && job.span && <small>{dayLabel(job.span.start)}</small>}
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

/**
 * The gigs and hires starting in the next seven days, a line a job as Today
 * has (audit, 20 October 2026, finding 32), counted in the heading as
 * listed; the errands and meetings behind one line that opens them.
 */
function WeekAhead({ view, today }: { view: View; today: string }) {
  const { work, errands } = weekAhead(view, today)
  const copying = useCopying()
  const rows = (jobs: JobView[]) => (
    <ul className="job-list">
      {jobs.map((j) => (
        <li key={j.id}>
          <JobLine job={j} view={view} from />
        </li>
      ))}
    </ul>
  )
  return (
    <section className="card week-ahead">
      <Heading icon="calendar">The week ahead{work.length > 0 ? ` (${work.length})` : ''}</Heading>
      {work.length === 0 && errands.length === 0 && copying ? (
        <p className="empty">{STILL_ARRIVING}</p>
      ) : work.length === 0 && errands.length === 0 ? (
        <Empty>Nothing starts in the next seven days.</Empty>
      ) : (
        <>
          {work.length > 0 ? rows(work) : <p className="empty">No gigs or hires start in the next seven days.</p>}
          {errands.length > 0 && (
            <details className="phase-details errands">
              <summary>{errandsLine(errands, work.length > 0)}</summary>
              {rows(errands)}
            </details>
          )}
        </>
      )}
    </section>
  )
}

/** "and 2 errands and 1 meeting": what's folded, by kind. */
function errandsLine(jobs: readonly JobView[], after: boolean): string {
  const meetings = jobs.filter((j) => kindOf(j) === 'meeting').length
  const errands = jobs.length - meetings
  const said = [errands > 0 && plural(errands, 'errand'), meetings > 0 && plural(meetings, 'meeting')].filter(Boolean).join(' and ')
  return after ? `and ${said}` : said.charAt(0).toUpperCase() + said.slice(1)
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
  const notInvoiced = owed - m.owed.reduce((s, o) => s + o.invoiced, 0)
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
        <>
          {/* What's accepted and unpaid says it's with VAT, and how much isn't invoiced yet (audit findings 29 and 71). */}
          <p className="hint">
            {money(month?.confirmed ?? 0)} confirmed of {money(month?.quoted ?? 0)} quoted for {moneyMonth(today).label}, before VAT. {money(owed)} with VAT accepted and
            unpaid from {plural(m.owed.length, 'client')}
            {notInvoiced > 0 ? `, ${money(notInvoiced)} of it not invoiced yet` : ''}; {money(toFreelancers)} owed to freelancers. <a href="#jobs/money">Money</a>
          </p>
          <BelowZero jobs={m.jobs} />
        </>
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
        <a className="link chart-more" href="#crew">
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
        <a className="link chart-more" href="#stock">
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
                <a className="job-row working-row" href={c.projectId ? `#jobs/${c.projectId}` : '#crew'}>
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
        {/* Booked and only accepted said apart, as on their own page (audit, 20 October 2026, finding 36): an accepted day can still go to someone else. */}
        <Heading icon="calendar">Your work{mine.length > 0 ? ` (${workCount(mine)})` : ''}</Heading>
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
                    <StatusPill tone={STATUS[o.status][1]} pending={o.pending}>
                      {STATUS[o.status][0]}
                    </StatusPill>
                    <small>{daysLabel(o.days.filter((d) => d >= today))}</small>
                    {c.callTime && <small>Call {c.callTime}</small>}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
        {/* Answered on their own page, so the way there is here (audit, 20 October 2026, finding 35). */}
        {asked > 0 && (
          <p className="hint">
            {plural(asked, 'offer')} waiting on your answer
            {linkFor(me) ? (
              <>
                {' · '}
                <a className="link" href={linkFor(me)} target="_blank" rel="noreferrer">
                  Open your page
                </a>
              </>
            ) : (
              ', on your own page.'
            )}
          </p>
        )}
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
              {/* A day in lieu waiting is said beside the requests, as Leave shows it (audit, 20 October 2026, finding 70). */}
              {awaiting(waiting.length, balance.lieu.waitingToApprove)}
            </p>
          )}
          <a className="button" href="#crew/leave">
            Open leave
          </a>
        </section>
      )}
      {approver && <Tiles all={tiles(view, today, me, can)} keys={TILES_FOR.me} title="Waiting on you" clear="No time off waiting on you." grouped={false} />}
      <YourDay view={view} today={today} me={me} mine={mine} />
    </>
  )
}

/**
 * Their own day, under Me (audit, 20 October 2026, finding 69): the
 * bookings whose days take in today, with the call time and venue, or their
 * leave; otherwise "Nothing on today" and the next booking. Never the
 * company's Today, whose jobs they may not be on (ADR 0033 §1: my bookings,
 * my leave).
 */
function YourDay({ view, today, me, mine }: { view: View; today: string; me: PersonView; mine: readonly { c: View['crew']['calls'][number]; o: View['crew']['calls'][number]['offers'][number] }[] }) {
  const copying = useCopying()
  const booked = mine.filter(({ o }) => o.status === 'confirmed')
  const on = booked.filter(({ o }) => o.days.includes(today))
  const away = view.crew.unavailability.find((u) => u.personId === me.id && u.start <= today && u.end >= today)
  const next = on.length === 0 ? booked.map(({ c, o }) => ({ c, day: o.days.find((d) => d > today) })).filter((n) => n.day).sort((a, b) => a.day!.localeCompare(b.day!))[0] : undefined
  return (
    <section className="card your-day">
      <Heading icon="time">Your day{on.length > 0 ? ` (${on.length})` : ''}</Heading>
      {on.length === 0 && copying ? (
        <p className="empty">{STILL_ARRIVING}</p>
      ) : on.length === 0 ? (
        <p className="empty">
          {away ? (away.source === 'leave' ? 'On leave today.' : `Away today${away.note ? `: ${away.note}` : ''}.`) : 'Nothing on today.'}
          {next && ` Next: ${next.c.project}, ${dayLabel(next.day!)}.`}
        </p>
      ) : (
        <ul className="job-list">
          {on.map(({ c, o }) => (
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
                <div className="side">{c.callTime && <small>Call {c.callTime}</small>}</div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * The job steps given to you (ADR 0073), not done yet: the ones the job is
 * at first, as they're yours to do now, then by the job's first day. Each
 * opens the job, whose steps are at the top. On Me, all of them; on the
 * other views, on top as they're yours whichever you look at, only the
 * first few to do now. Nothing at all while there are none.
 */
const STEPS_ON_TOP = 5

function MySteps({ view, me, all }: { view: View; me: PersonView; all: boolean }) {
  const steps = view.steps.mine(me.id)
  const now = steps.filter((s) => s.next)
  const shown = all ? steps : now.slice(0, STEPS_ON_TOP)
  if (shown.length === 0) return null
  const more = steps.length - shown.length
  return (
    <section className="card my-steps" aria-labelledby="my-steps-title">
      <Heading icon="done" id="my-steps-title">{all ? `Your steps (${steps.length})` : `Your steps to do now (${now.length})`}</Heading>
      <ul className="job-list">
        {shown.map(({ job, step, next }) => {
          const at = view.steps.of(job.id)?.current
          return (
            <li key={`${job.id}.${step.key}`}>
              <a className="job-row" href={`#jobs/${encodeURIComponent(job.id)}`}>
                <div>
                  <b>{step.label}</b>
                  <p>
                    {job.name}
                    {/* Where the step sits in the job's way, so the list says how far along each job is (ADR 0073). */}
                    {` · step ${step.number} of ${view.steps.of(job.id)?.steps.length ?? 8}`}
                    {step.hint && ` · ${step.hint}`}
                  </p>
                </div>
                <div className="side">
                  {next ? <small className="flag">Now</small> : at && <small>After {at.label}</small>}
                  {job.span && <small>{dayLabel(job.span.start)}</small>}
                </div>
              </a>
            </li>
          )
        })}
      </ul>
      {!all && more > 0 && <p className="hint">{plural(more, 'more step')} of yours on Me.</p>}
    </section>
  )
}

/** "3 confirmed, 2 accepted", or the one kind there is. */
function workCount(mine: readonly { o: { status: string } }[]) {
  const confirmed = mine.filter((m) => m.o.status === 'confirmed').length
  const accepted = mine.length - confirmed
  return [confirmed && `${confirmed} confirmed`, accepted && `${accepted} accepted`].filter(Boolean).join(', ')
}

/** " 1 request and 1 day in lieu waiting to be approved.", or nothing while nothing is. */
export function awaiting(requests: number, lieuDays: number): string {
  const parts = [requests > 0 && plural(requests, 'request'), lieuDays > 0 && `${leaveDaysLabel(lieuDays)} in lieu`].filter(Boolean)
  return parts.length === 0 ? '' : ` ${parts.join(' and ')} waiting to be approved.`
}
