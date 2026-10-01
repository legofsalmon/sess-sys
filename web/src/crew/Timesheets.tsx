import {
  dayLabel,
  daysLabel,
  eachDay,
  euro,
  MAX_EXTRAS,
  noTimesheetReason,
  timesheetChanges,
  timesheetMessage,
  timesheetSummary,
  timesheetTotal,
  type PersonView,
  type TimesheetExtra,
  type TimesheetRow,
  type View,
} from '@sh/shared'
import { useState, type ReactNode } from 'react'
import { NotDone, today, Top } from '../jobs/common.tsx'
import { client } from '../sync.ts'
import { act, euroToCents, promptFor, SharePanel, SharePanelFor, type Share } from './CrewScreen.tsx'

/**
 * Timesheets (ADR 0022) as the office works with them: the ones sent to
 * check, bookings over with nothing sent yet, and each timesheet at
 * #crew/timesheet/<booking>, where the office changes anything that needs
 * it and approves it in one step. Freelancers send theirs from their
 * private link; the office can put one in for someone who doesn't.
 */

const TIMESHEET_COMMANDS = /^timesheet\./
const on = (iso: string) => dayLabel(new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' }))
const job = (r: TimesheetRow) => `${r.call.project}${r.call.phase ? ` · ${r.call.phase}` : ''}`

/** For the Crew tab: what's waiting on the office. */
export function TimesheetsCard({ view }: { view: View }) {
  const { toApprove, notIn, approved } = view.timesheets
  const [remind, setRemind] = useState<TimesheetRow | undefined>()
  const lately = approved.slice(0, 5)
  if (!toApprove.length && !notIn.length && !lately.length) return null
  return (
    <section className="card timesheets" aria-label="Timesheets">
      <h2>Timesheets</h2>
      {toApprove.length > 0 && (
        <div className="ts-group" role="group" aria-label="To approve">
          <h3>To approve</h3>
          {toApprove.map((r) => (
            <Row key={r.offer.id} r={r} action={<a className="button primary" href={`#crew/timesheet/${encodeURIComponent(r.offer.id)}`}>Check</a>} />
          ))}
        </div>
      )}
      {notIn.length > 0 && (
        <div className="ts-group" role="group" aria-label="Not in yet">
          <h3>Not in yet</h3>
          {notIn.map((r) => (
            <Row
              key={r.offer.id}
              r={r}
              action={
                <>
                  {r.person && (
                    <button type="button" onClick={() => setRemind(r)} aria-label={`Ask ${r.person.name} for their timesheet`}>
                      Ask
                    </button>
                  )}
                  <a className="link" href={`#crew/timesheet/${encodeURIComponent(r.offer.id)}`}>
                    Fill in
                  </a>
                </>
              }
            />
          ))}
        </div>
      )}
      {remind?.person && <Ask r={remind} person={remind.person} onClose={() => setRemind(undefined)} />}
      {lately.length > 0 && (
        <div className="ts-group" role="group" aria-label="Approved lately">
          <h3>Approved lately</h3>
          {lately.map((r) => (
            <Row key={r.offer.id} r={r} action={<a className="link" href={`#crew/timesheet/${encodeURIComponent(r.offer.id)}`}>Open</a>} />
          ))}
        </div>
      )}
    </section>
  )
}

function Row({ r, action }: { r: TimesheetRow; action: ReactNode }) {
  return (
    <div className="row ts-row">
      <div>
        <b>{r.person?.name ?? 'Someone'}</b>
        <p>
          {job(r)} · {r.call.role} · {daysLabel(r.timesheet?.days ?? r.offer.days)}
        </p>
      </div>
      <div className="actions">
        {r.timesheet && <span className="amount">{r.timesheet.dayRateCents === null ? 'Rate to agree' : euro(r.total.total)}</span>}
        {r.timesheet?.pending && <span className="pill pending">Waiting to sync</span>}
        {action}
      </div>
    </div>
  )
}

function Ask({ r, person, onClose }: { r: TimesheetRow; person: PersonView; onClose: () => void }) {
  return (
    <SharePanel
      person={person}
      call={r.call}
      onClose={onClose}
      message={(link) => ({ ...timesheetMessage(person, r.call, `${link}/timesheet/${r.offer.id}`), what: 'timesheet request' })}
    />
  )
}

/** Opens the message to the freelancer after the office approves or reopens their timesheet (audit finding 9). */
type OnTell = (share: Share | undefined) => void

/** One booking's timesheet: check it, change it, approve it; or, approved, what was agreed. */
export function TimesheetScreen({ view, offerId }: { view: View; offerId: string }) {
  const r = view.timesheets.row(offerId)
  // Kept here, above the timesheet, which starts again once it's approved.
  const [tell, setTell] = useState<Share | undefined>()
  return (
    <div className="app crew jobs timesheet-screen">
      <Top view={view} title="Crew" />
      <a className="back" href="#crew">
        ‹ Crew
      </a>
      <NotDone view={view} names={TIMESHEET_COMMANDS} />
      {!r ? (
        <section className="card">
          <p className="empty">This booking isn't on this device. It may have been removed, or still be on its way: check again once it says “Up to date”.</p>
        </section>
      ) : (
        // Starts again from what's saved whenever that changes, such as when it syncs or is approved.
        <Timesheet key={`${r.timesheet?.status}:${r.timesheet?.sentAt}:${r.timesheet?.approvedAt}`} view={view} r={r} onTell={setTell} />
      )}
      {tell && <SharePanelFor share={tell} onClose={() => setTell(undefined)} />}
    </div>
  )
}

function Timesheet({ view, r, onTell }: { view: View; r: TimesheetRow; onTell: OnTell }) {
  const t = r.timesheet
  const first = r.person?.name.split(' ')[0] ?? 'them'
  const [asking, setAsking] = useState(false)
  // Staff, a booking not confirmed or not started, or a cancelled job: nothing to fill in.
  const why = t ? null : noTimesheetReason(r.offer, r.call, r.person, today())
  return (
    <>
      <section className="card">
        <p className="kicker">Timesheet</p>
        <h1>{r.person?.name ?? 'Someone'}</h1>
        <p>
          {job(r)} · {r.call.role}
          <br />
          Booked {daysLabel(r.offer.days)} at {euro(r.offer.dayRateCents)}
          {r.offer.dayRateCents !== null && ' a day'}
        </p>
        {!t ? (
          <p className="hint">{why ?? `Nothing sent yet. ${first} can send it from their private link, or you can fill it in for them below.`}</p>
        ) : (
          <p className="hint">
            {t.sentVia === 'link' ? `Sent by ${first} on their link` : 'Put in by the office'} on {on(t.sentAt)}
            {t.status === 'approved' && t.approvedAt && `, approved on ${on(t.approvedAt)}`}.
          </p>
        )}
        {t?.note && <p className="lines">“{t.note}”</p>}
        {!t && !why && r.person && (
          <div className="actions">
            <button type="button" onClick={() => setAsking(true)}>
              Ask {first} for it
            </button>
          </div>
        )}
      </section>
      {asking && r.person && <Ask r={r} person={r.person} onClose={() => setAsking(false)} />}
      {t?.status === 'approved' ? <Approved r={r} onTell={onTell} /> : !why && <Check view={view} r={r} onTell={onTell} />}
    </>
  )
}

function Approved({ r, onTell }: { r: TimesheetRow; onTell: OnTell }) {
  const t = r.timesheet!
  const changes = timesheetChanges(t)
  const { fees } = timesheetTotal(t)
  const reopen = () => {
    void act(() => client.mutate('timesheet.reopen', { id: t.id }))
    if (r.person) onTell(promptFor('timesheet-reopened', [{ person: r.person, context: { call: r.call, offerId: r.offer.id } }]))
  }
  return (
    <section className="card" aria-label="Approved">
      <h2>Approved: {euro(r.total.total)}</h2>
      <ul className="ts-lines">
        <li>
          <span>
            {t.days.length} day{t.days.length === 1 ? '' : 's'} at {euro(t.dayRateCents)}, {daysLabel(t.days)}
          </span>
          <span>{euro(fees)}</span>
        </li>
        {t.extras.map((e, i) => (
          <li key={i}>
            <span>{e.what}</span>
            <span>{euro(e.cents)}</span>
          </li>
        ))}
      </ul>
      {changes.length > 0 && (
        <>
          <p className="hint">Changed from what was sent:</p>
          <ul className="ts-changes">
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      )}
      {t.officeNote && <p className="lines">{t.officeNote}</p>}
      {t.pending && <span className="pill pending">Waiting to sync</span>}
      <div className="actions">
        <button type="button" onClick={reopen}>
          Reopen to change it
        </button>
      </div>
    </section>
  )
}

interface ExtraRow {
  what: string
  euro: string
}

const euroText = (c: number) => (c / 100).toFixed(c % 100 === 0 ? 0 : 2)

/** The days worked, the rate and the extras, as the office agrees them, and approving. */
function Check({ view, r, onTell }: { view: View; r: TimesheetRow; onTell: OnTell }) {
  const t = r.timesheet
  const [days, setDays] = useState(() => new Set(t?.days ?? r.offer.days))
  const [rate, setRate] = useState(() => {
    const c = t?.dayRateCents ?? r.offer.dayRateCents
    return c === null ? '' : euroText(c)
  })
  const [extras, setExtras] = useState<ExtraRow[]>(() => (t?.extras ?? []).map((e) => ({ what: e.what, euro: euroText(e.cents) })))
  const [note, setNote] = useState(t?.officeNote ?? '')

  // Any day of the job, from its first phase to its last, as the server allows; booked ones marked.
  const phases = view.jobs.jobs.find((j) => j.id === r.call.projectId)?.phases ?? []
  const start = [r.call.start, ...phases.map((p) => p.start)].sort()[0]!
  const end = [r.call.end, ...phases.map((p) => p.end)].sort().at(-1)!
  const jobDays = eachDay(start, end)
  const booked = new Set(r.offer.days)
  const [showAll, setShowAll] = useState(() => [...days].some((d) => !booked.has(d)))
  const shown = showAll ? jobDays : [...booked].sort()

  const rateCents = euroToCents(rate)
  const typed = extras.filter((e) => e.what.trim() || e.euro.trim())
  const parsed: TimesheetExtra[] = typed.map((e) => ({ what: e.what.trim(), cents: euroToCents(e.euro) ?? 0 }))
  const problem =
    days.size === 0
      ? 'Tick at least one day worked.'
      : rateCents === null || !Number.isFinite(rateCents) || rateCents < 0
        ? 'Put in the day rate.'
        : parsed.some((e) => !e.what)
          ? 'Say what each extra is for.'
          : parsed.some((e) => !Number.isFinite(e.cents) || e.cents <= 0)
            ? 'Each extra needs an amount in euro.'
            : null
  const figures = { days: [...days].sort(), dayRateCents: rateCents, extras: parsed }
  const changes = t && !problem ? timesheetChanges({ ...figures, sent: t.sent }) : []

  const toggle = (d: string) => {
    const next = new Set(days)
    if (next.has(d)) next.delete(d)
    else next.add(d)
    setDays(next)
  }
  const setExtra = (i: number, e: Partial<ExtraRow>) => setExtras(extras.map((x, j) => (j === i ? { ...x, ...e } : x)))
  const approve = () => {
    if (problem || rateCents === null) return
    const person = r.person
    void act(async () => {
      // Put in for them first, when they haven't sent it: it's then approved as it was put in.
      if (!t) await client.mutate('timesheet.send', { id: r.offer.id, days: figures.days, extras: parsed, note: '' })
      await client.mutate('timesheet.approve', { id: r.offer.id, days: figures.days, dayRateCents: rateCents, extras: parsed, officeNote: note.trim() })
    }).then(
      // Then tell them what was agreed, and what changed from what they sent.
      () => person && onTell(promptFor('timesheet-approved', [{ person, context: { call: r.call, offerId: r.offer.id, summary: timesheetSummary(figures), changes } }])),
      (err: Error) => alert(err.message)
    )
  }

  return (
    <section className="card ts-check" aria-label={t ? 'Check and approve' : 'Fill in'}>
      <h2>{t ? 'Check and approve' : 'Fill in for them'}</h2>
      <fieldset className="ts-days">
        <legend>Days worked</legend>
        {shown.map((d) => (
          <label key={d} className={booked.has(d) ? '' : 'extra-day'}>
            <input type="checkbox" checked={days.has(d)} onChange={() => toggle(d)} /> {dayLabel(d)}
            {!booked.has(d) && <small> not booked</small>}
          </label>
        ))}
      </fieldset>
      {jobDays.length > booked.size && !showAll && (
        <button type="button" className="link start" onClick={() => setShowAll(true)}>
          Add a day of the job they weren't booked for
        </button>
      )}
      <label className="field">
        Day rate €
        <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Agreed rate" />
      </label>
      <fieldset className="ts-extras">
        <legend>Extras</legend>
        {extras.length === 0 && <p className="hint">None. Parking, tolls, mileage or anything else agreed go here.</p>}
        {extras.map((e, i) => (
          <div key={i} className="ts-extra">
            <input aria-label="What" value={e.what} onChange={(x) => setExtra(i, { what: x.target.value })} placeholder="e.g. Parking" maxLength={100} />
            <input aria-label="€" inputMode="decimal" value={e.euro} onChange={(x) => setExtra(i, { euro: x.target.value })} placeholder="€" />
            <button type="button" className="link" onClick={() => setExtras(extras.filter((_, j) => j !== i))} aria-label={`Remove ${e.what || 'this extra'}`}>
              Remove
            </button>
          </div>
        ))}
        {extras.length < MAX_EXTRAS && (
          <button type="button" className="link start" onClick={() => setExtras([...extras, { what: '', euro: '' }])}>
            Add an extra
          </button>
        )}
      </fieldset>
      <label className="field">
        Note for {r.person?.name.split(' ')[0] ?? 'them'} (optional)
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why anything changed" maxLength={1000} />
      </label>
      {changes.length > 0 && (
        <div className="warn-line">
          <b>They'll see these changes from what they sent:</b>
          <ul className="ts-changes">
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="ts-total">{problem ?? timesheetSummary(figures)}</p>
      <div className="actions">
        <button type="button" className="primary" disabled={!!problem} onClick={approve}>
          {problem || rateCents === null ? 'Approve' : `Approve ${euro(timesheetTotal(figures).total)}`}
        </button>
      </div>
    </section>
  )
}
