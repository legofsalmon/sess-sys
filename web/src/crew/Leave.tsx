import {
  canApproveLeave,
  dayLabel,
  daysLeft,
  DEFAULT_ALLOWANCE_DAYS,
  HOLDS_DAYS,
  leaveDays,
  leaveDaysLabel,
  leaveLabel,
  leaveSpanLabel,
  nearYears,
  newId,
  noAllowanceReason,
  noCancelReason,
  notEnoughLeft,
  notOpenReason,
  personByEmail,
  requestsOverlap,
  type LeaveBalance,
  type LeaveQueueItem,
  type LeaveRequestView,
  type LeaveStatus,
  type LeaveType,
  type LieuEntryView,
  type PersonView,
  type View,
} from '@sh/shared'
import { useEffect, useState, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { useAuth } from '../auth.ts'
import { Empty } from '../Empty.tsx'
import { Top } from '../jobs/common.tsx'
import { Pending, StatusPill, type PillTone } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { useToday } from '../view.ts'

/**
 * Staff leave and time in lieu (ADR 0024), at #crew/leave: my year's
 * balances, applying for leave and logging a day in lieu, my requests with
 * Cancel; and for whoever can approve time off, the queue with what to weigh
 * up, and each staff member's allowance. Who "me" is comes from the signed-in
 * account's email, matched to a person on the Crew tab as the Account tab
 * does for the calendar feed; while sign-in is off the screen asks once and
 * remembers the answer on this device.
 */

const ME_KEY = 'sh.leave.me'

const readMe = () => {
  try {
    return localStorage.getItem(ME_KEY) ?? ''
  } catch {
    return ''
  }
}

// The pick lives here, not in a screen, so the Crew tab's badge learns of it the moment it's made, as the Auth does.
const listeners = new Set<(id: string) => void>()
let chosen = readMe()

function choose(id: string) {
  chosen = id
  try {
    if (id) localStorage.setItem(ME_KEY, id)
    else localStorage.removeItem(ME_KEY)
  } catch {
    // Private browsing can refuse storage; the choice still holds this session.
  }
  for (const fn of listeners) fn(id)
}

/** Who is using this device, as far as leave is concerned. */
export function useMe(view: View): { me: PersonView | undefined; signedIn: boolean; email: string | undefined; pick: (id: string) => void; clear: () => void } {
  const auth = useAuth()
  const [id, setId] = useState(chosen)
  useEffect(() => {
    listeners.add(setId)
    setId(chosen)
    return () => void listeners.delete(setId)
  }, [])
  const signedIn = auth.status === 'signed-in'
  const email = signedIn ? auth.user.email : undefined
  const me = signedIn ? personByEmail(view.crew.people, auth.user.email) : view.leave.staff.find((p) => p.id === id)
  return { me, signedIn, email, pick: choose, clear: () => choose('') }
}

const yearOf = (day: string) => Number(day.slice(0, 4))

const STATUS: Record<LeaveStatus, [string, PillTone]> = {
  waiting: ['Waiting', 'pending'],
  approved: ['Approved', 'confirmed'],
  declined: ['Declined', 'cancelled'],
  cancelled: ['Cancelled', 'cancelled'],
}

function LeavePill({ status, pending }: { status: LeaveStatus; pending: boolean }) {
  const [label, tone] = STATUS[status]
  return (
    <StatusPill tone={tone} pending={pending}>
      {label}
    </StatusPill>
  )
}

const days = (n: number) => leaveDaysLabel(n)

/** On the Crew tab: the way in, with what's waiting for an approver. */
export function LeaveCard({ view }: { view: View }) {
  const { me } = useMe(view)
  const today = useToday()
  const waiting = me && canApproveLeave(me) ? view.leave.queue.length : 0
  const balance = me?.kind === 'staff' ? view.leave.balance(me.id, yearOf(today)) : undefined
  return (
    <section className="card leave-card" aria-label="Leave">
      <h2>Leave</h2>
      <p className="hint">
        {balance ? `${me!.name}: ${days(balance.annual.left)} of annual leave left this year, ${days(balance.lieu.left)} in lieu to take.` : "Annual leave and days in lieu for staff: apply, see what's left, and approve."}
        {waiting > 0 && (
          <>
            {' '}
            <b>{waiting === 1 ? '1 request to approve.' : `${waiting} requests to approve.`}</b>
          </>
        )}
      </p>
      <a className="button" href="#crew/leave">
        Open leave
      </a>
    </section>
  )
}

export function LeaveScreen({ view }: { view: View }) {
  const { me, signedIn, email, pick, clear } = useMe(view)
  const today = useToday()
  const [year, setYear] = useState(() => yearOf(today))
  const approver = canApproveLeave(me)
  return (
    <div className="app crew jobs leave-screen">
      <Top view={view} title="Crew" />
      <a className="back" href="#crew">
        ‹ Crew
      </a>
      {/* Until it's someone's own leave, which their name heads, the screen says what it is, so the move here lands on that and names the tab (audit finding 22). */}
      {me?.kind !== 'staff' && (
        <header className="title">
          <h1>Leave</h1>
        </header>
      )}
      {!me ? (
        <WhoAreYou view={view} signedIn={signedIn} email={email} onPick={pick} />
      ) : me.kind !== 'staff' ? (
        <section className="card">
          <p className="empty">{me.name} is a freelancer on the Crew tab, and leave is for staff. Freelancers mark days off on their link.</p>
          {!signedIn && (
            <button type="button" className="link start" onClick={clear}>
              Not you? Change
            </button>
          )}
        </section>
      ) : (
        <>
          <MyLeave view={view} me={me} year={year} onYear={setYear} onNotMe={signedIn ? undefined : clear} />
          {approver && <ToApprove view={view} me={me} />}
          {approver && <Allowances view={view} me={me} year={year} />}
        </>
      )}
    </div>
  )
}

/** Sign-in off: pick a name once. Sign-in on but nobody matched: say what to do. */
function WhoAreYou({ view, signedIn, email, onPick }: { view: View; signedIn: boolean; email: string | undefined; onPick: (id: string) => void }) {
  const [id, setId] = useState('')
  const staff = view.leave.staff
  if (signedIn) {
    // Someone archived isn't matched either, and is told so, not sent to put on an email that's there already.
    const wanted = email?.trim().toLowerCase()
    const archived = !!wanted && view.crew.people.some((p) => p.archived && p.email?.trim().toLowerCase() === wanted)
    return (
      <section className="card">
        <p className="empty">
          {archived
            ? "You've been archived on the Crew tab, so you can't ask for or approve time off."
            : `Your account, ${email}, isn't matched to anyone on the Crew tab. Put that email on your own person there, as staff, and come back.`}
        </p>
      </section>
    )
  }
  return (
    <section className="card">
      <h2>Who are you?</h2>
      {staff.length === 0 ? (
        <Empty>Add staff on the Crew tab, with Type set to Staff.</Empty>
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
          <p className="hint">Until sign-in is on, this device takes your word for it, and remembers the answer.</p>
          <button type="submit" className="primary" disabled={!id}>
            That's me
          </button>
        </form>
      )}
    </section>
  )
}

function Facts({ b }: { b: LeaveBalance }) {
  return (
    <>
      <h3>Annual leave</h3>
      <dl className="facts">
        <div>
          <dt>Allowance</dt>
          <dd>
            {days(b.allowance)}
            {!b.allowanceSet && <small> (not set yet)</small>}
          </dd>
        </div>
        <div>
          <dt>Carried over</dt>
          <dd>{days(b.carriedOver)}</dd>
        </div>
        <div>
          <dt>Taken</dt>
          <dd>{days(b.annual.taken)}</dd>
        </div>
        <div>
          <dt>Booked</dt>
          <dd>{days(b.annual.booked)}</dd>
        </div>
        <div>
          <dt>Waiting</dt>
          <dd>{days(b.annual.waiting)}</dd>
        </div>
        <div>
          <dt>Left</dt>
          <dd className={b.annual.left < 0 ? 'bad' : undefined}>
            <b>{days(b.annual.left)}</b>
          </dd>
        </div>
      </dl>
      <h3>Time in lieu</h3>
      <dl className="facts">
        <div>
          <dt>Earned</dt>
          <dd>{days(b.lieu.earned)}</dd>
        </div>
        <div>
          <dt>To be approved</dt>
          <dd>{days(b.lieu.waitingToApprove)}</dd>
        </div>
        <div>
          <dt>Taken</dt>
          <dd>{days(b.lieu.taken)}</dd>
        </div>
        <div>
          <dt>Booked</dt>
          <dd>{days(b.lieu.booked)}</dd>
        </div>
        <div>
          <dt>Waiting</dt>
          <dd>{days(b.lieu.waiting)}</dd>
        </div>
        <div>
          <dt>Left</dt>
          <dd className={b.lieu.left < 0 ? 'bad' : undefined}>
            <b>{days(b.lieu.left)}</b>
          </dd>
        </div>
      </dl>
      <p className="hint">Days in lieu are taken in the year they're earned. Any left at the year end, whoever approves time off adds to next year's carried over.</p>
    </>
  )
}

function MyLeave({ view, me, year, onYear, onNotMe }: { view: View; me: PersonView; year: number; onYear: (y: number) => void; onNotMe: (() => void) | undefined }) {
  const b = view.leave.balance(me.id, year)
  const requests = view.leave.requestsFor(me.id, year)
  const entries = view.leave.entriesFor(me.id, year)
  const now = yearOf(useToday())
  return (
    <>
      <section className="card">
        <p className="kicker">My leave</p>
        <div className="title">
          <h1>{me.name}</h1>
          {onNotMe && (
            <button type="button" className="link" onClick={onNotMe}>
              Not you? Change
            </button>
          )}
        </div>
        <div className="filters" role="group" aria-label="Year">
          <button type="button" onClick={() => onYear(year - 1)} aria-label={`${year - 1}, the year before`}>
            ‹ {year - 1}
          </button>
          <button type="button" aria-pressed="true" onClick={() => onYear(now)}>
            {year}
            {year === now && ' (this year)'}
          </button>
          <button type="button" onClick={() => onYear(year + 1)} aria-label={`${year + 1}, the year after`}>
            {year + 1} ›
          </button>
        </div>
        <Facts b={b} />
      </section>

      <section className="card" aria-label="Apply for leave">
        <h2>Apply for leave</h2>
        <OpenYears view={view} me={me} />
        <Apply view={view} me={me} />
      </section>

      <section className="card" aria-label="Log a day in lieu">
        <h2>Log a day in lieu</h2>
        <LogLieu me={me} />
      </section>

      <section className="card" aria-label={`My requests, ${year}`}>
        <h2>My requests, {year}</h2>
        {requests.length === 0 && entries.length === 0 && <Empty>Ask for leave or log a day in lieu above.</Empty>}
        {requests.map((r) => (
          <RequestRow key={r.id} r={r} me={me} />
        ))}
        {entries.map((e) => (
          <EntryRow key={e.id} e={e} me={me} />
        ))}
      </section>
    </>
  )
}

/** The years leave can be asked for in, and for an approver, the next to open, asked in place first. */
function OpenYears({ view, me }: { view: View; me: PersonView }) {
  const near = nearYears(useToday())
  const [asking, setAsking] = useState(false)
  const { run, error } = useAct()
  const open = near.filter((y) => view.leave.isOpen(y))
  const shut = near.filter((y) => !view.leave.isOpen(y))
  const next = view.leave.toOpen
  const openIt = (year: number) => void run(() => client.mutate('leave.open', { year, by: me.id })).then(() => setAsking(false))
  return (
    <>
      <p className="hint">
        {open.length > 0 && `Open for leave: ${open.join(' and ')}. `}
        {shut.length > 0 && `${shut.join(' and ')} ${shut.length === 1 ? "isn't" : "aren't"} open yet: the office opens each year when it's ready.`}{' '}
        <Pending pending={view.leave.years.some((y) => y.pending)} />
      </p>
      {canApproveLeave(me) &&
        next !== undefined &&
        (asking ? (
          <Confirm question={`Open ${next} for leave? Staff can ask for leave in ${next} from then on, and it can't be closed again.`} yes={`Open ${next}`} no="Not yet" onYes={() => openIt(next)} onNo={() => setAsking(false)} />
        ) : (
          <button type="button" onClick={() => setAsking(true)}>
            Open {next} for leave
          </button>
        ))}
      <Refusal error={error} />
    </>
  )
}

function Apply({ view, me }: { view: View; me: PersonView }) {
  const today = useToday()
  const blank = { type: 'annual' as LeaveType, start: today, end: today, note: '' }
  const [f, setF] = useState(blank)
  const { run, error, refuse } = useAct()
  const end = f.end < f.start ? f.start : f.end
  const count = leaveDays(f.start, end)
  const year = Number(f.start.slice(0, 4))
  const crossesYear = year !== Number(end.slice(0, 4))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    // The same checks as the server's, said here first so nothing waits on a sync to be refused.
    if (crossesYear) return refuse("A request can't cross the year end: ask for December and January separately.")
    const shut = notOpenReason(year, view.leave.isOpen, today)
    if (shut) return refuse(shut)
    if (count === 0) return refuse("There are no working days in those dates: it's all weekend or public holidays.")
    const mine = view.leave.requestsFor(me.id, year).find((r) => HOLDS_DAYS.includes(r.status) && requestsOverlap(r, { start: f.start, end }))
    if (mine) return refuse(`That overlaps the ${leaveLabel(mine.type, mine.days).toLowerCase()} ${mine.status === 'approved' ? 'approved' : 'asked'} for ${leaveSpanLabel(mine)}.`)
    const left = daysLeft(view.leave.balance(me.id, year), f.type)
    if (count > left) return refuse(notEnoughLeft(f.type, left))
    void run(() => client.mutate('leave.request', { id: newId(), personId: me.id, type: f.type, start: f.start, end, note: f.note.trim() })).then((ok) => {
      if (ok) setF(blank)
    })
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <label className="wide">
        Type
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as LeaveType })}>
          <option value="annual">Annual leave</option>
          <option value="lieu">Days in lieu</option>
        </select>
      </label>
      <label>
        From <input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value, end: f.end < e.target.value ? e.target.value : f.end })} required />
      </label>
      <label>
        To <input type="date" value={f.end} min={f.start} onChange={(e) => setF({ ...f, end: e.target.value })} required />
      </label>
      <label className="wide">
        Note <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Anything whoever approves should know" maxLength={500} />
      </label>
      <p className="ts-total wide" aria-live="polite">
        {crossesYear ? 'Crosses the year end' : count === 0 ? 'No working days in those dates' : days(count)}
        {!crossesYear && count > 0 && <small className="muted"> of {f.type === 'annual' ? 'annual leave' : 'time in lieu'}, weekends and public holidays left out</small>}
      </p>
      <p className="hint wide">Days already gone can go in too, for the record; once approved they count as taken.</p>
      <Refusal error={error} className="wide" />
      <button type="submit" className="primary wide">
        Apply
      </button>
    </form>
  )
}

function LogLieu({ me }: { me: PersonView }) {
  const today = useToday()
  const blank = { day: today, days: 1, note: '' }
  const [f, setF] = useState(blank)
  const { run, error } = useAct()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(() => client.mutate('lieu.log', { id: newId(), personId: me.id, day: f.day, days: f.days, note: f.note.trim() })).then((ok) => {
      if (ok) setF(blank)
    })
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <label>
        Day worked <input type="date" value={f.day} max={today} onChange={(e) => setF({ ...f, day: e.target.value })} required />
      </label>
      <label>
        How many days <input type="number" min={1} max={5} value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })} />
      </label>
      <label className="wide">
        Note <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="What the day was" maxLength={500} />
      </label>
      <Refusal error={error} className="wide" />
      <button type="submit" className="wide">
        Log day in lieu
      </button>
    </form>
  )
}

function RequestRow({ r, me }: { r: LeaveRequestView; me: PersonView }) {
  const { run, error } = useAct()
  const today = useToday()
  const canCancel = !r.pending && noCancelReason(r, today) === null
  return (
    <div className="row leave-row">
      <div>
        <b>
          {leaveLabel(r.type, r.days)} · {leaveSpanLabel(r)}
        </b>
        <p>
          {days(r.days)}
          {r.note && <> · “{r.note}”</>}
          {r.status === 'declined' && r.reason && <><br />Declined: {r.reason}</>}
        </p>
        <Refusal error={error} />
      </div>
      <div className="actions">
        <LeavePill status={r.status} pending={r.pending} />
        {canCancel && (
          <button type="button" className="link" onClick={() => void run(() => client.mutate('leave.cancel', { id: r.id, by: me.id }))} aria-label={`Cancel ${leaveLabel(r.type, r.days).toLowerCase()}, ${leaveSpanLabel(r)}`}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

function EntryRow({ e, me }: { e: LieuEntryView; me: PersonView }) {
  const { run, error } = useAct()
  const canCancel = !e.pending && (e.status === 'waiting' || e.status === 'approved')
  return (
    <div className="row leave-row">
      <div>
        <b>
          {e.days === 1 ? 'A day' : `${e.days} days`} in lieu · worked {dayLabel(e.day)}
        </b>
        <p>
          {e.note && <>“{e.note}”</>}
          {e.status === 'declined' && e.reason && <>{e.note && <br />}Declined: {e.reason}</>}
        </p>
        <Refusal error={error} />
      </div>
      <div className="actions">
        <LeavePill status={e.status} pending={e.pending} />
        {canCancel && (
          <button type="button" className="link" onClick={() => void run(() => client.mutate('lieu.cancel', { id: e.id, by: me.id }))} aria-label={`Cancel the day in lieu for ${dayLabel(e.day)}`}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

/** The queue for whoever can approve time off, with what to weigh up, and the decision in place. */
function ToApprove({ view, me }: { view: View; me: PersonView }) {
  const queue = view.leave.queue
  return (
    <section className="card" aria-label="To approve">
      <h2>To approve</h2>
      {queue.length === 0 && <Empty />}
      {queue.map((item) => (
        <QueueRow key={item.kind === 'request' ? item.request.id : item.entry.id} item={item} me={me} />
      ))}
    </section>
  )
}

function QueueRow({ item, me }: { item: LeaveQueueItem; me: PersonView }) {
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const { run, error } = useAct()
  const own = item.person?.id === me.id
  const pending = item.kind === 'request' ? item.request.pending : item.entry.pending
  const name = item.person?.name ?? 'Someone'
  const what = item.kind === 'request' ? `${leaveLabel(item.request.type, item.request.days)}, ${leaveSpanLabel(item.request)} (${days(item.request.days)})` : `${item.entry.days === 1 ? 'A day' : `${item.entry.days} days`} in lieu for ${dayLabel(item.entry.day)}`
  const note = item.kind === 'request' ? item.request.note : item.entry.note
  const decide = (approved: boolean) => {
    const id = item.kind === 'request' ? item.request.id : item.entry.id
    const command = item.kind === 'request' ? 'leave.decide' : 'lieu.decide'
    void run(() => client.mutate(command, { id, approved, reason: reason.trim(), by: me.id })).then((ok) => ok && setDeclining(false))
  }
  return (
    <div className="row leave-row" aria-label={`${name}: ${what}`}>
      <div>
        <b>{name}</b>
        <p>
          {what}
          {note && <><br />“{note}”</>}
        </p>
        {item.warnings.length > 0 && (
          <ul className="leave-warnings">
            {item.warnings.map((w) => (
              <li key={w} className="warn-line">
                {w}
              </li>
            ))}
          </ul>
        )}
        <Refusal error={error} />
      </div>
      {pending ? (
        <Pending pending />
      ) : own ? (
        <p className="hint">Yours: another approver decides it.</p>
      ) : declining ? (
        <form
          className="decline-form"
          onSubmit={(e) => {
            e.preventDefault()
            decide(false)
          }}
          aria-label={`Decline ${name}'s request`}
        >
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" maxLength={500} aria-label="Reason" />
          <button type="submit" className="primary">
            Decline
          </button>
          <button type="button" onClick={() => setDeclining(false)}>
            Keep it waiting
          </button>
        </form>
      ) : (
        <div className="actions">
          <button type="button" className="primary" onClick={() => decide(true)} aria-label={`Approve ${name}'s ${item.kind === 'request' ? 'request' : 'day in lieu'}`}>
            Approve
          </button>
          <button type="button" onClick={() => setDeclining(true)} aria-label={`Decline ${name}'s ${item.kind === 'request' ? 'request' : 'day in lieu'}`}>
            Decline
          </button>
        </div>
      )}
    </div>
  )
}

const isWhole = (typed: string) => typed.trim() !== '' && Number.isInteger(Number(typed))

/** Each staff member's year, for an approver to set. */
function Allowances({ view, me, year }: { view: View; me: PersonView; year: number }) {
  // Only this year's and next year's can be set, so another year's are shown as they stand.
  const fixed = noAllowanceReason(year, useToday())
  return (
    <section className="card" aria-label={`Allowances, ${year}`}>
      <h2>Allowances, {year}</h2>
      <p className="hint">{fixed ?? `Days of annual leave for the year, and any carried over from the year before. ${days(DEFAULT_ALLOWANCE_DAYS)} until one is set.`}</p>
      {view.leave.staff.map((p) => (
        <AllowanceRow key={p.id} person={p} year={year} view={view} me={me} fixed={fixed !== null} />
      ))}
    </section>
  )
}

function AllowanceRow({ person, year, view, me, fixed }: { person: PersonView; year: number; view: View; me: PersonView; fixed: boolean }) {
  const set = view.leave.allowance(person.id, year)
  const b = view.leave.balance(person.id, year)
  const [f, setF] = useState({ days: String(b.allowance), carried: String(b.carriedOver) })
  // The row follows what's saved, such as when it syncs, unless this device is mid-edit.
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!touched) setF({ days: String(b.allowance), carried: String(b.carriedOver) })
  }, [b.allowance, b.carriedOver, touched])
  const { run, error, refuse } = useAct()
  const save = (e: FormEvent) => {
    e.preventDefault()
    // A blanked field would read as nothing and wipe the year, so it's turned down here in the schema's own words.
    if (!isWhole(f.days)) return refuse('The allowance is a whole number from 0 to 366.')
    if (!isWhole(f.carried)) return refuse('Carried over is a whole number from 0 to 366.')
    void run(() =>
      client.mutate('leave.allowance', { personId: person.id, year, days: Number(f.days), carriedOver: Number(f.carried), note: set?.note ?? '', by: me.id })
    ).then((ok) => ok && setTouched(false))
  }
  return (
    <form className="row allowance-row" onSubmit={save} aria-label={`${person.name}'s allowance`}>
      <div>
        <b>{person.name}</b>
        <p>
          {days(b.annual.taken + b.annual.booked)} approved, {days(b.annual.left)} left
          {set?.pending && ' · waiting to sync'}
        </p>
      </div>
      <div className="actions">
        <label className="field">
          Days
          <input type="number" min={0} max={366} value={f.days} disabled={fixed} onChange={(e) => (setTouched(true), setF({ ...f, days: e.target.value }))} />
        </label>
        <label className="field">
          Carried over
          <input type="number" min={0} max={366} value={f.carried} disabled={fixed} onChange={(e) => (setTouched(true), setF({ ...f, carried: e.target.value }))} />
        </label>
        {!fixed && (
          <button type="submit" disabled={!touched}>
            Save
          </button>
        )}
      </div>
      <Refusal error={error} />
    </form>
  )
}
