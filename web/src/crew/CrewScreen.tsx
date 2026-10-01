import {
  answersToCheck,
  daysLabel,
  eachDay,
  euro,
  euroText,
  HOLDING,
  newId,
  offerMessage,
  offerOnCalendar,
  OPEN,
  parseEuro,
  personConflicts,
  tellMessage,
  whatsappNumber,
  type AnswerKind,
  type CallView,
  type CommandInput,
  type CrewView,
  type OfferView,
  type Person,
  type PersonView,
  type TellContext,
  type TellEvent,
  type View,
} from '@sh/shared'
import { useEffect, useState, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Top, useHash } from '../jobs/common.tsx'
import { client } from '../sync.ts'
import { useFeedAddress } from './feed.ts'
import { LeaveCard, LeaveScreen } from './Leave.tsx'
import { TimesheetScreen, TimesheetsCard } from './Timesheets.tsx'

/**
 * Ops' crew screen: jobs that need people, the offers out for them, and
 * the people who can be offered work. Answers arrive from freelancers'
 * private links, and from Google Calendar when crew invites are on (ADR
 * 0009), and show up here live; everything also works with no signal and
 * syncs later, like the rest of the app. Timesheets for bookings that
 * have happened are checked and approved here too (ADR 0022).
 *
 * After anything the office does that a freelancer should hear about
 * (Confirm, Withdraw, Release, a cancelled call or job, a timesheet
 * approved), the message for it opens below, ready to send (audit finding
 * 9). The app sends nothing itself. Anything the device turns down is said
 * beside the button or form that asked (act.tsx), and anything the server
 * turns down is counted in the top bar with every other screen's.
 */

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' })

const STATUS: Record<OfferView['status'], [string, string]> = {
  offered: ['Offered', 'pending'],
  countered: ['Asked for more', 'pending'],
  accepted: ['Accepted', 'accepted'],
  confirmed: ['Confirmed', 'confirmed'],
  declined: ['Declined', 'cancelled'],
  filled: ['Filled', 'cancelled'],
  cancelled: ['Withdrawn', 'cancelled'],
  'pulled-out': ["Can't make it", 'cancelled'],
}

export const linkFor = (p: Pick<Person, 'linkToken'>) => (p.linkToken ? `${location.origin}/f/${p.linkToken}` : '')

function useView(): View {
  const [view, setView] = useState(() => client.view())
  useEffect(() => client.subscribe(setView), [])
  return view
}

/** One person to tell, with the call it's about and whatever else the message needs. */
export interface TellTo {
  person: Person
  context: TellContext
}

/** People to tell after something the office did, and what happened. */
export interface Tell {
  /** Its own, so a new prompt starts from its first person even when it replaces one still open. */
  id: string
  event: TellEvent
  to: TellTo[]
}

/** What's open at the bottom of a screen: an offer to send, or people to tell. One at a time. */
export type Share = { kind: 'offer'; person: PersonView; call: CallView } | { kind: 'tell'; tell: Tell }

/**
 * The prompt after something the office did (audit finding 9): a message
 * for each person, written for what happened, to send by WhatsApp, text or
 * email as the offer is, or to copy. The app sends nothing itself. Nothing
 * when there's nobody to tell. A call changed or a phase moved prompts the
 * same way: setShare(promptFor('call-changed', peopleOn(call))).
 */
export function promptFor(event: TellEvent, to: TellTo[]): Share | undefined {
  return to.length ? { kind: 'tell', tell: { id: newId(), event, to } } : undefined
}

/** Someone to tell about a call, with their own days and agreed rate when they have an offer on it. */
export function tellTo(person: Person, call: CallView, offer?: Pick<OfferView, 'id' | 'days' | 'status' | 'dayRateCents' | 'counterRateCents'>): TellTo {
  const agreed = offer ? (offer.status === 'countered' ? offer.counterRateCents : offer.dayRateCents) : call.dayRateCents
  return { person, context: { call: { ...call, dayRateCents: agreed }, days: offer?.days, offerId: offer?.id } }
}

/** Everyone offered or holding a place on a call, to tell when it changes or goes. */
export function peopleOn(call: CallView, statuses: readonly OfferView['status'][] = [...OPEN, ...HOLDING]): TellTo[] {
  return call.offers.filter((o) => o.person && statuses.includes(o.status)).map((o) => tellTo(o.person as Person, call, o))
}

/** The panel for whatever is open: the offer to send, or the people to tell one at a time. */
export function SharePanelFor({ share, onClose }: { share: Share; onClose: () => void }) {
  if (share.kind === 'offer') return <SharePanel person={share.person} call={share.call} onClose={onClose} />
  return <TellPanel key={share.tell.id} tell={share.tell} onClose={onClose} />
}

/**
 * What the call needs after a no, under "Aoife Byrne declined": "The call is 1 short",
 * or "Was down for 2 days; the call is filled" after a pull-out. "Down for", not
 * "booked": a pull-out can come before the office confirmed.
 */
function whatItNeeds(kind: AnswerKind, offer: OfferView, short: number): string {
  const needs = short > 0 ? `${short} short` : 'filled'
  if (kind === 'pulled-out') return `Was down for ${offer.days.length} day${offer.days.length === 1 ? '' : 's'}; the call is ${needs}`
  return `The call is ${needs}`
}

export function CrewScreen() {
  const view = useView()
  const hash = useHash()
  const crew = view.crew
  const [share, setShare] = useState<Share | undefined>()
  const people = new Map(crew.people.map((p) => [p.id, p]))
  // Archived people (leavers) are kept for the record but out of the way.
  const active = crew.people.filter((p) => !p.archived)
  const archived = crew.people.filter((p) => p.archived)
  const upcoming = crew.calls.filter((c) => c.end >= today && c.status === 'open')
  const onCalendar = (o: OfferView) => offerOnCalendar(o, view.calendar.days, today)
  // A yes or a counter until Confirm or Withdraw; a decline or a pull-out until Noted. The Crew tab's count is the same list.
  const toCheck = answersToCheck(crew, today).map((a) => ({ ...a, warning: onCalendar(a.offer)?.warning }))
  // Answers in Google the app couldn't act on, such as a No to a booked day: for the office to sort out.
  const toSortOut = upcoming.flatMap((c) =>
    c.offers
      .filter((o) => o.status === 'offered' || o.status === 'confirmed')
      .flatMap((o) => {
        const cal = onCalendar(o)
        return cal?.warning ? [{ c, o, text: o.status === 'confirmed' ? cal.warning : `${cal.line} ${cal.warning}` }] : []
      })
  )
  // What the device turned down, said in the card it was asked from.
  const answers = useAct()
  const roster = useAct()
  const [, timesheet] = /^#crew\/timesheet\/(.+)$/.exec(hash) ?? []
  if (timesheet) return <TimesheetScreen view={view} offerId={decodeURIComponent(timesheet)} />
  // Staff leave and time in lieu (ADR 0024) have a screen of their own under Crew.
  if (hash === '#crew/leave') return <LeaveScreen view={view} />

  /** Settle a yes or a counter, then tell them. */
  const settle = (o: OfferView, c: CallView, command: 'offer.confirm' | 'offer.cancel', event: TellEvent) => {
    void answers.run(() => client.mutate(command, { id: o.id })).then((ok) => ok && o.person && setShare(promptFor(event, [tellTo(o.person, c, o)])))
  }

  return (
    <div className="app crew">
      <Top view={view} title="Crew" />

      {(toCheck.length > 0 || toSortOut.length > 0) && (
        <section className="card">
          <h2>Answers to check</h2>
          <Refusal error={answers.error} />
          {toSortOut.map(({ c, o, text }) => (
            <div className="row" key={o.id}>
              <div>
                <b>{o.person?.name ?? 'Someone'}</b> answered on Google Calendar
                <p>
                  {c.project} · {c.role} · {o.status === 'confirmed' ? 'booked' : 'offered'} {daysLabel(o.days)}
                  <br />
                  {text}
                </p>
              </div>
              {c.projectId && (
                <div className="actions">
                  <a className="link" href={`#jobs/${c.projectId}`}>
                    Open job
                  </a>
                </div>
              )}
            </div>
          ))}
          {toCheck.map(({ call: c, offer: o, kind, short, warning }) => (
            <div className="row" key={o.id}>
              <div>
                <b>{o.person?.name ?? 'Someone'}</b>{' '}
                {kind === 'accepted'
                  ? `accepted${o.respondedVia === 'calendar' ? ' on Google Calendar' : ''}`
                  : kind === 'countered'
                    ? `asks ${euro(o.counterRateCents)} a day (offered ${euro(c.dayRateCents)})`
                    : kind === 'declined'
                      ? 'declined'
                      : "can't make it any more"}
                <p>
                  {c.project} · {c.role} · {daysLabel(o.days)}
                  {(kind === 'declined' || kind === 'pulled-out') && <><br />{whatItNeeds(kind, o, short)}</>}
                  {o.note && <><br />“{o.note}”</>}
                  {warning && <><br />{warning}</>}
                </p>
              </div>
              {kind === 'accepted' || kind === 'countered' ? (
                <div className="actions">
                  <button type="button" className="primary" onClick={() => settle(o, c, 'offer.confirm', 'confirmed')}>
                    {kind === 'countered' ? `Agree ${euro(o.counterRateCents)}` : 'Confirm'}
                  </button>
                  <button type="button" onClick={() => settle(o, c, 'offer.cancel', kind === 'countered' ? 'withdrawn' : 'released')}>
                    {kind === 'countered' ? 'Say no' : 'Release'}
                  </button>
                </div>
              ) : (
                <div className="actions">
                  <button type="button" onClick={() => void answers.run(() => client.mutate('offer.seen', { id: o.id }))} aria-label={`Noted: ${o.person?.name ?? 'someone'}`}>
                    Noted
                  </button>
                </div>
              )}
              {(kind === 'declined' || kind === 'pulled-out') && c.openDays.length > 0 && (
                <OfferForm
                  call={c}
                  crew={crew}
                  onShare={(person) => {
                    // Offering the call to someone else is acting on the answer, so it's noted without another tap.
                    void answers.run(() => client.mutate('offer.seen', { id: o.id }))
                    setShare({ kind: 'offer', person, call: c })
                  }}
                />
              )}
            </div>
          ))}
        </section>
      )}

      <TimesheetsCard view={view} />
      <LeaveCard view={view} />

      <section className="card">
        <h2>Crew needed</h2>
        {upcoming.length === 0 && <p className="empty">No crew needed yet. Ask for crew from a job in Jobs, or below.</p>}
        {upcoming.map((c) => (
          <CallCard key={c.id} call={c} crew={crew} calendar={view.calendar} onShare={(person) => setShare({ kind: 'offer', person, call: c })} onTell={setShare} />
        ))}
      </section>

      {share && <SharePanelFor share={share} onClose={() => setShare(undefined)} />}

      <section className="card">
        <h2>Crew for something not in Jobs</h2>
        <p className="hint">For a job in Jobs, ask for crew from the job, so the crew get its phases, venue and any changes.</p>
        <NewCall />
      </section>

      <section className="card">
        <h2>People</h2>
        <Refusal error={roster.error} />
        {active.length === 0 && archived.length === 0 && <p className="empty">Nobody yet. Add your crew below.</p>}
        {active.map((p) => (
          <PersonRow key={p.id} person={p} crew={crew} />
        ))}
        {archived.length > 0 && (
          <details className="archived">
            <summary>Archived ({archived.length})</summary>
            {archived.map((p) => (
              <div className="row person" key={p.id}>
                <span className="who">
                  <b>{p.name}</b>
                  <small>{[p.kind === 'staff' ? 'Staff' : null, p.skills.join(', ')].filter(Boolean).join(' · ')}</small>
                </span>
                {p.pending ? (
                  <span className="pill pending">Waiting to sync</span>
                ) : (
                  <button type="button" onClick={() => void roster.run(() => client.mutate('person.archive', { id: p.id, archived: false }))}>
                    Bring back
                  </button>
                )}
              </div>
            ))}
          </details>
        )}
        <NewPerson />
      </section>

      <p className="hint">
        Freelancers answer from their own private link: no app or login. Send it with an offer by WhatsApp, text or email.
        {people.size > 0 && ' Their bookings also appear in their own calendar if they subscribe from that page.'}
      </p>
    </div>
  )
}

/** One crew call: who's been offered it and how they answered, on their link or on Google Calendar, and offering it to someone else. */
export function CallCard({
  call,
  crew,
  calendar,
  onShare,
  onTell,
  inJob = false,
}: {
  call: CallView
  crew: CrewView
  calendar: View['calendar']
  onShare: (p: PersonView) => void
  /** Opens the message for whoever should hear about a withdrawal or a cancelled call; without it, nobody is prompted. */
  onTell?: (share: Share | undefined) => void
  inJob?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const { run, error } = useAct()
  const filled = call.openDays.length === 0
  const open = call.status === 'open'
  const invites = calendar.link?.state === 'on' && calendar.link.invites === true

  const withdraw = (o: OfferView) => {
    void run(() => client.mutate('offer.cancel', { id: o.id })).then(
      (ok) => ok && o.person && onTell?.(promptFor(HOLDING.includes(o.status) ? 'released' : 'withdrawn', [tellTo(o.person, call, o)]))
    )
  }
  const cancel = () => {
    setCancelling(false)
    void run(() => client.mutate('call.cancel', { id: call.id })).then((ok) => ok && onTell?.(promptFor('call-cancelled', peopleOn(call))))
  }

  return (
    <article className={`job ${call.pending ? 'is-pending' : ''}`}>
      <header>
        <div>
          {inJob ? (
            // On the job's own page the job needs no saying, and the phase shows only for a call across phases.
            <b>
              {call.needed} × {call.role}
              {!call.phaseId && call.phase && <span className="muted"> · {call.phase}</span>}
            </b>
          ) : (
            <b>
              {call.project}
              {call.phase && <span className="muted"> · {call.phase}</span>}
            </b>
          )}
          <p>
            {!inJob && `${call.needed} × ${call.role} · `}
            {daysLabel(call.days)}
            {call.callTime && ` · call ${call.callTime}`} · {euro(call.dayRateCents)}
            {call.venue && !inJob && <><br />{call.venue}</>}
          </p>
        </div>
        <span className={`pill ${filled ? 'confirmed' : 'pending'}`}>
          {filled ? 'Filled' : call.days.length > 1 ? `${call.days.filter((d) => call.heldByDay[d]! >= call.needed).length}/${call.days.length} days filled` : `${call.heldByDay[call.days[0]!]}/${call.needed}`}
        </span>
      </header>

      {call.offers.length > 0 && (
        <ul className="offers">
          {call.offers.map((o) => {
            const [label, tone] = STATUS[o.status]
            const partial = o.days.length < call.days.length && (o.status === 'accepted' || o.status === 'confirmed' || o.status === 'countered')
            const cal = offerOnCalendar(o, calendar.days, today)
            const live = o.status === 'offered' || o.status === 'countered' || o.status === 'accepted' || o.status === 'confirmed'
            return (
              <li key={o.id}>
                <span>
                  {o.person?.name ?? 'Unknown'}
                  {partial && <small> {daysLabel(o.days)}</small>}
                  {o.override && <small> (override)</small>}
                </span>
                <span className="actions">
                  <span className={`pill ${o.pending ? 'pending' : tone}`}>{o.pending ? 'Waiting to sync' : label}</span>
                  {o.status === 'offered' && o.person && (
                    <button type="button" className="link" onClick={() => onShare(o.person as PersonView)}>
                      Send
                    </button>
                  )}
                  {(o.status === 'offered' || o.status === 'confirmed') && (
                    <button type="button" className="link" onClick={() => withdraw(o)}>
                      Withdraw
                    </button>
                  )}
                </span>
                {cal && <small className="on-cal">{cal.line}</small>}
                {cal?.warning && <small className="warn-line">{cal.warning}</small>}
                {!cal && invites && live && o.person && !o.person.email?.trim() && <small className="on-cal">No email address, so no calendar invite.</small>}
              </li>
            )
          })}
        </ul>
      )}

      {open && !filled && <OfferForm call={call} crew={crew} onShare={onShare} />}
      {editing && <EditCall call={call} onDone={() => setEditing(false)} onSaved={(after, datesMoved) => onTell?.(promptFor('call-changed', peopleOn(after).map((t) => (datesMoved ? forCallDays(t) : t))))} />}
      <Refusal error={error} />
      {cancelling ? (
        <Confirm
          question={`Cancel the call for ${call.needed} × ${call.role} on ${call.project}? Everyone offered is told it's withdrawn.`}
          yes="Cancel it"
          onYes={cancel}
          onNo={() => setCancelling(false)}
        />
      ) : (
        <div className="actions end">
          {call.projectId && !inJob && (
            <a className="link" href={`#jobs/${call.projectId}`}>
              Open job
            </a>
          )}
          {/* A cancelled call, kept on the job's page for the record, can't be changed or cancelled again. */}
          {open && !call.pending && (
            <button type="button" className="link" onClick={() => setEditing(!editing)} aria-expanded={editing}>
              Change
            </button>
          )}
          {open && (
            <button type="button" className="link" onClick={() => setCancelling(true)}>
              Cancel crew call
            </button>
          )}
        </div>
      )}
    </article>
  )
}

/**
 * Change a crew call. Only what was changed is sent (call.update), so
 * another device's change to something else stands. The job, phase and
 * venue of a call that's part of a job come from the job, so they're
 * changed there. Before saving, the office is told what the change does
 * to the offers out: booked days move with the call, and a new rate
 * reaches only offers nobody has answered.
 */
/** The same person, told the call's days rather than their own: after a date change their own days have moved too, and the page has the detail. */
const forCallDays = (t: TellTo): TellTo => ({ ...t, context: { ...t.context, days: undefined } })

/** What the crew would notice; how many are needed and the reply-by date aren't worth a message. */
const NOTICED = ['role', 'start', 'end', 'callTime', 'dayRateCents', 'details', 'project', 'phase', 'venue'] as const

/** The call as the change leaves it, for the message to the people on it; undefined when nobody would notice. */
function afterChange(call: CallView, changes: CommandInput<'call.update'>): CallView | undefined {
  if (!NOTICED.some((k) => changes[k] !== undefined)) return undefined
  const start = changes.start ?? call.start
  const end = changes.end ?? call.end
  return {
    ...call,
    role: changes.role ?? call.role,
    start,
    end,
    days: eachDay(start, end),
    callTime: changes.callTime === undefined ? call.callTime : changes.callTime,
    dayRateCents: changes.dayRateCents === undefined ? call.dayRateCents : changes.dayRateCents,
    details: changes.details ?? call.details,
    project: changes.project ?? call.project,
    phase: changes.phase ?? call.phase,
    venue: changes.venue ?? call.venue,
  }
}

function EditCall({ call, onDone, onSaved }: { call: CallView; onDone: () => void; onSaved?: (after: CallView, datesMoved: boolean) => void }) {
  const tied = !!call.projectId
  const [f, setF] = useState({
    project: call.project,
    phase: call.phase,
    venue: call.venue,
    role: call.role,
    start: call.start,
    end: call.end,
    callTime: call.callTime ?? '',
    needed: call.needed,
    rate: call.dayRateCents === null ? '' : euroText(call.dayRateCents),
    details: call.details,
    replyBy: call.replyBy ?? '',
  })
  const { run, error, refuse } = useAct()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: k === 'needed' ? Number(e.target.value) : e.target.value })
  const booked = Math.max(0, ...call.days.map((d) => call.heldByDay[d] ?? 0))
  const agreed = call.offers.filter((o) => o.status === 'accepted' || o.status === 'countered' || o.status === 'confirmed').length
  const rate = parseEuro(f.rate)
  const rateChanged = rate.cents !== undefined && rate.cents !== call.dayRateCents
  const datesChanged = f.start !== call.start || f.end !== call.end
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!f.role.trim() || (!tied && !f.project.trim())) return
    if (rate.reason !== undefined) return refuse(rate.reason)
    const changes: CommandInput<'call.update'> = { id: call.id }
    if (f.role.trim() !== call.role) changes.role = f.role.trim()
    if (f.start !== call.start) changes.start = f.start
    const end = f.end < f.start ? f.start : f.end
    if (end !== call.end) changes.end = end
    if ((f.callTime || null) !== call.callTime) changes.callTime = f.callTime || null
    if (Math.max(1, f.needed) !== call.needed) changes.needed = Math.max(1, f.needed)
    if (rateChanged) changes.dayRateCents = rate.cents
    if (f.details.trim() !== call.details) changes.details = f.details.trim()
    if ((f.replyBy || null) !== call.replyBy) changes.replyBy = f.replyBy || null
    if (!tied) {
      if (f.project.trim() !== call.project) changes.project = f.project.trim()
      if (f.phase.trim() !== call.phase) changes.phase = f.phase.trim()
      if (f.venue.trim() !== call.venue) changes.venue = f.venue.trim()
    }
    if (Object.keys(changes).length === 1) return onDone()
    void run(() => client.mutate('call.update', changes)).then((ok) => {
      if (!ok) return
      onDone()
      const after = afterChange(call, changes)
      if (after) onSaved?.(after, changes.start !== undefined || changes.end !== undefined)
    })
  }
  return (
    <form className="grid-form" onSubmit={save} aria-label={`Change the call for ${call.role}`}>
      {!tied && (
        <>
          <label className="wide">
            Project <input value={f.project} onChange={set('project')} required />
          </label>
          <label>
            Phase <input value={f.phase} onChange={set('phase')} placeholder="Build, Show…" />
          </label>
          <label>
            Venue <input value={f.venue} onChange={set('venue')} />
          </label>
        </>
      )}
      <label>
        Role <input value={f.role} onChange={set('role')} required />
      </label>
      <label>
        How many <input type="number" min={Math.max(1, booked)} value={f.needed} onChange={set('needed')} />
      </label>
      <label>
        From <input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value, end: f.end < e.target.value ? e.target.value : f.end })} />
      </label>
      <label>
        To <input type="date" value={f.end} min={f.start} onChange={set('end')} />
      </label>
      <label>
        Call time <input type="time" value={f.callTime} onChange={set('callTime')} />
      </label>
      <label>
        Day rate € <input inputMode="decimal" value={f.rate} onChange={set('rate')} placeholder="250" />
      </label>
      <label className="wide">
        Reply by <input type="date" value={f.replyBy} onChange={set('replyBy')} />
      </label>
      <label className="wide">
        Details for crew <textarea rows={2} value={f.details} onChange={set('details')} placeholder="Travel, food, parking, dress" />
      </label>
      {datesChanged && booked > 0 && (
        <p className="hint wide">
          {booked === 1 ? '1 person is' : `${booked} people are`} booked: the days they hold move with the call. Anyone who would be left with no days stops the
          change, so release them first or keep their days.
        </p>
      )}
      {rateChanged && agreed > 0 && (
        <p className="hint wide">
          The new rate goes to offers still waiting on an answer. {agreed === 1 ? 'The 1 person who has' : `The ${agreed} people who have`} accepted, asked for
          a rate or been confirmed keep what was agreed.
        </p>
      )}
      {f.needed > call.needed && call.openDays.length === 0 && (
        <p className="hint wide">The call is filled: needing more opens it again. Anyone told it had filled gets a new offer, not the old one back.</p>
      )}
      <Refusal error={error} className="wide" />
      <div className="actions wide">
        <button type="submit" className="primary">
          Save
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** Offer a call to someone not yet offered it, with a warning when their days clash. Also beside a decline or a pull-out in "Answers to check". */
export function OfferForm({ call, crew, onShare }: { call: CallView; crew: CrewView; onShare: (p: PersonView) => void }) {
  const [personId, setPersonId] = useState('')
  const [override, setOverride] = useState(false)
  // Someone who declined, pulled out or was told it's filled can be offered it again.
  const offered = new Set(call.offers.filter((o) => !['declined', 'filled', 'cancelled', 'pulled-out'].includes(o.status)).map((o) => o.personId))
  const candidates = crew.people.filter((p) => !offered.has(p.id) && !p.archived)
  const chosen = candidates.find((p) => p.id === personId)
  const conflicts = chosen ? personConflicts(crew, chosen.id, call.days, call.id) : []
  const { run, error } = useAct()

  const send = (e: FormEvent) => {
    e.preventDefault()
    if (!chosen) return
    const p = chosen
    void run(() => client.mutate('offer.send', { id: newId(), callId: call.id, personId: p.id, override: conflicts.length > 0 && override })).then((ok) => {
      if (!ok) return
      setPersonId('')
      setOverride(false)
      onShare(p)
    })
  }

  return (
    <form className="offer-form" onSubmit={send}>
      <select value={personId} onChange={(e) => setPersonId(e.target.value)} aria-label="Offer to">
        <option value="">Offer to…</option>
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.skills.length ? ` (${p.skills.join(', ')})` : ''}
            {personConflicts(crew, p.id, call.days, call.id).length ? ' ⚠' : ''}
          </option>
        ))}
      </select>
      <button type="submit" disabled={!chosen || (conflicts.length > 0 && !override)}>
        Offer
      </button>
      {conflicts.length > 0 && (
        <label className="warn">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          <span>
            {conflicts.join('. ')}. <b>Offer anyway</b>
          </span>
        </label>
      )}
      <Refusal error={error} />
    </form>
  )
}

/** WhatsApp, a text or an email with the words filled in, or a copy of them. Nothing is sent for you. */
function SendButtons({ person, text, subject }: { person: Pick<Person, 'phone' | 'email'>; text: string; subject: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <>
      {person.phone && (
        <>
          <a className="button primary" href={`https://wa.me/${whatsappNumber(person.phone)}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
          <a className="button" href={`sms:${person.phone}?&body=${encodeURIComponent(text)}`}>
            Text
          </a>
        </>
      )}
      {person.email && (
        <a className="button" href={`mailto:${person.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`}>
          Email
        </a>
      )}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true))
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </>
  )
}

/** Their private link isn't on this device yet: it's made by the server when the person first syncs. */
function NoLinkYet({ person, onClose }: { person: Pick<Person, 'name'>; onClose: () => void }) {
  return (
    <section className="card share">
      <h2>Send to {person.name}</h2>
      <p className="empty">Their private link is made when this device next syncs. Try again once it says “Up to date”.</p>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </section>
  )
}

/** Send a person something on their private link: an offer, or with `message`, something else such as their call sheet (ADR 0021). */
export function SharePanel({
  person,
  call,
  onClose,
  message,
}: {
  person: PersonView
  call: CallView
  onClose: () => void
  message?: (link: string) => { text: string; subject: string; what: string }
}) {
  const link = linkFor(person)
  if (!link) return <NoLinkYet person={person} onClose={onClose} />
  const custom = message?.(link)
  const text = custom?.text ?? offerMessage(person, call, link)
  const subject = custom?.subject ?? `Work: ${call.project}, ${daysLabel(call.days)}`
  return (
    <section className="card share" aria-label={`Send ${custom?.what ?? 'offer'} to ${person.name}`}>
      <h2>Send to {person.name}</h2>
      <textarea readOnly value={text} rows={6} />
      <div className="actions">
        <SendButtons key={person.id} person={person} text={text} subject={subject} />
        <button type="button" className="link" onClick={onClose}>
          Done
        </button>
      </div>
    </section>
  )
}

/**
 * The people to tell after something the office did, one at a time: the
 * message written for what happened, the ways to send it, and Done or Skip
 * to move to the next. "Tell 3 people" for a cancelled job; just the one
 * after a Confirm.
 */
export function TellPanel({ tell, onClose }: { tell: Tell; onClose: () => void }) {
  const [at, setAt] = useState(0)
  const to = tell.to[at]
  if (!to) return null
  const { person, context } = to
  const n = tell.to.length
  const next = () => (at + 1 < n ? setAt(at + 1) : onClose())
  const link = linkFor(person)
  if (!link) return <NoLinkYet person={person} onClose={next} />
  const { text, subject, what } = tellMessage(tell.event, person, context, link)
  return (
    <section className="card share" aria-label={`Send ${what} to ${person.name}`}>
      <h2>{n === 1 ? `Tell ${person.name}` : `Tell ${n} people: ${person.name} (${at + 1} of ${n})`}</h2>
      <textarea readOnly value={text} rows={6} />
      <div className="actions">
        <SendButtons key={person.id} person={person} text={text} subject={subject} />
        <button type="button" className="link" onClick={next}>
          {at + 1 < n ? 'Done, next' : 'Done'}
        </button>
        {at + 1 < n && (
          <button type="button" className="link" onClick={next}>
            Skip
          </button>
        )}
      </div>
    </section>
  )
}

function PersonRow({ person, crew }: { person: PersonView; crew: CrewView }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [relinking, setRelinking] = useState(false)
  const { run, error, refuse } = useAct()
  const [away, setAway] = useState({ start: today, end: today, note: '' })
  const booked = crew.calls.flatMap((c) =>
    c.status === 'open' && c.end >= today ? c.offers.filter((o) => o.personId === person.id && (o.status === 'accepted' || o.status === 'confirmed')).map((o) => ({ c, o })) : []
  )
  // Offers still waiting on them: like a booking, settled before they can be archived. The server checks the same.
  const waiting = crew.calls.flatMap((c) =>
    c.status === 'open' && c.end >= today ? c.offers.filter((o) => o.personId === person.id && (o.status === 'offered' || o.status === 'countered')).map((o) => ({ c, o })) : []
  )
  // Booked means confirmed; someone who has said yes is still to confirm.
  const confirmed = booked.filter(({ o }) => o.status === 'confirmed').length
  const toConfirm = booked.length - confirmed
  const off = crew.unavailability.filter((u) => u.personId === person.id && u.end >= today)
  const link = linkFor(person)
  const feed = useFeedAddress(open ? person.linkToken : undefined)
  const archive = () => {
    // The same test as the server's: held days from today on, or any offer still waiting.
    const hold = booked.find(({ o }) => o.days.some((d) => d >= today)) ?? waiting[0]
    if (hold) {
      const job = hold.c.phase ? `${hold.c.project} (${hold.c.phase})` : hold.c.project
      return refuse(
        hold.o.status === 'confirmed'
          ? `${person.name} is booked on ${job}; release them first.`
          : hold.o.status === 'accepted'
            ? `${person.name} has accepted ${job}; release them first.`
            : `${person.name} has an open offer for ${job}; withdraw it first.`
      )
    }
    void run(() => client.mutate('person.archive', { id: person.id, archived: true }))
  }
  return (
    <div className="row person">
      <button type="button" className="who" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b>{person.name}</b>
        <small>
          {[
            person.kind === 'staff' ? 'Staff' : null,
            person.kind === 'staff' && person.approvesLeave ? 'approves time off' : null,
            person.skills.join(', '),
            person.dayRateCents !== null ? `${euro(person.dayRateCents)}/day` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          {confirmed > 0 && ` · ${confirmed} booking${confirmed === 1 ? '' : 's'}`}
          {toConfirm > 0 && ` · ${toConfirm} to confirm`}
          {off.length > 0 && ' · has days off'}
        </small>
      </button>
      {person.pending && <span className="pill pending">Waiting to sync</span>}
      {open && editing && (
        <div className="detail">
          <PersonForm initial={person} submitLabel="Save" onSubmit={(fields) => client.mutate('person.upsert', { id: person.id, ...fields })} onDone={() => setEditing(false)} />
        </div>
      )}
      {open && !editing && (
        <div className="detail">
          {(person.phone || person.email) && <p className="muted">{[person.phone, person.email].filter(Boolean).join(' · ')}</p>}
          {person.notes && <p className="muted">{person.notes}</p>}
          {booked.map(({ c, o }) => (
            <p key={o.id}>
              {c.project} · {daysLabel(o.days)} · {STATUS[o.status][0]}
            </p>
          ))}
          {off.map((u) => (
            <p key={u.id}>
              Off {daysLabel(eachDay(u.start, u.end))}
              {u.note && ` (${u.note})`}
              {u.source === 'self' && ' · said on their link'}
              {/* Approved leave is cancelled on the Leave screen, so the two never disagree (ADR 0024). */}
              {u.source === 'leave' ? (
                <>
                  {' · '}
                  <a className="link" href="#crew/leave">
                    approved leave
                  </a>
                </>
              ) : (
                <>
                  {' '}
                  <button type="button" className="link" onClick={() => void run(() => client.mutate('unavailability.remove', { id: u.id }))}>
                    Remove
                  </button>
                </>
              )}
            </p>
          ))}
          <form
            className="away-form"
            onSubmit={(e) => {
              e.preventDefault()
              void run(() => client.mutate('unavailability.add', { id: newId(), personId: person.id, start: away.start, end: away.end < away.start ? away.start : away.end, note: away.note }))
            }}
          >
            <input type="date" value={away.start} onChange={(e) => setAway({ ...away, start: e.target.value })} aria-label="Off from" />
            <input type="date" value={away.end} min={away.start} onChange={(e) => setAway({ ...away, end: e.target.value })} aria-label="Off until" />
            <input placeholder="Note" value={away.note} onChange={(e) => setAway({ ...away, note: e.target.value })} />
            <button type="submit">Mark days off</button>
          </form>
          <div className="actions">
            {link && (
              <>
                <a className="button" href={link} target="_blank" rel="noreferrer">
                  Open their page
                </a>
                <button type="button" onClick={() => navigator.clipboard?.writeText(link)}>
                  Copy link
                </button>
              </>
            )}
            {feed && (
              <button type="button" onClick={() => navigator.clipboard?.writeText(feed)}>
                Copy calendar address
              </button>
            )}
            {!relinking && (
              <button type="button" className="link" onClick={() => setRelinking(true)}>
                New link
              </button>
            )}
          </div>
          {relinking && (
            <Confirm
              question={`Make a new link for ${person.name}? The old one stops working, so anything sent with it no longer opens.`}
              yes="Make a new link"
              no="Keep the old one"
              onYes={() => {
                setRelinking(false)
                void run(() => client.mutate('person.newLink', { id: person.id }))
              }}
              onNo={() => setRelinking(false)}
            />
          )}
          <div className="actions">
            <button type="button" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" className="link" onClick={archive}>
              Archive
            </button>
          </div>
          <Refusal error={error} />
        </div>
      )}
    </div>
  )
}

function NewCall() {
  const blank = { project: '', phase: '', venue: '', role: '', start: today, end: today, callTime: '', needed: 1, rate: '', details: '' }
  const [f, setF] = useState(blank)
  const { run, error, refuse } = useAct()
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: k === 'needed' ? Number(e.target.value) : e.target.value })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!f.project.trim() || !f.role.trim()) return
    const rate = parseEuro(f.rate)
    if (rate.reason !== undefined) return refuse(rate.reason)
    // Ready for the next call on the same job and days; a refusal brings what was typed back, unless the next thing has been typed since.
    const cleared = { ...blank, project: f.project, venue: f.venue, start: f.start, end: f.end }
    setF(cleared)
    void run(() =>
      client.mutate('call.create', {
        id: newId(),
        project: f.project.trim(),
        phase: f.phase.trim(),
        venue: f.venue.trim(),
        role: f.role.trim(),
        start: f.start,
        end: f.end < f.start ? f.start : f.end,
        callTime: f.callTime || null,
        needed: Math.max(1, f.needed),
        dayRateCents: rate.cents,
        details: f.details.trim(),
        replyBy: null,
      })
    ).then((ok) => {
      if (!ok) setF((now) => (now === cleared ? f : now))
    })
  }
  return (
    <form className="grid-form" onSubmit={submit}>
      <label className="wide">
        Project <input value={f.project} onChange={set('project')} placeholder="e.g. Electric Picnic" required />
      </label>
      <label>
        Phase <input value={f.phase} onChange={set('phase')} placeholder="Build, Show…" />
      </label>
      <label>
        Role <input value={f.role} onChange={set('role')} placeholder="Audio tech" required />
      </label>
      <label>
        From <input type="date" value={f.start} onChange={set('start')} />
      </label>
      <label>
        To <input type="date" value={f.end} min={f.start} onChange={set('end')} />
      </label>
      <label>
        Call time <input type="time" value={f.callTime} onChange={set('callTime')} />
      </label>
      <label>
        How many <input type="number" min={1} value={f.needed} onChange={set('needed')} />
      </label>
      <label>
        Day rate € <input inputMode="decimal" value={f.rate} onChange={set('rate')} placeholder="250" />
      </label>
      <label>
        Venue <input value={f.venue} onChange={set('venue')} />
      </label>
      <label className="wide">
        Details for crew <textarea rows={2} value={f.details} onChange={set('details')} placeholder="Travel, food, parking, dress" />
      </label>
      <Refusal error={error} className="wide" />
      <button type="submit" className="primary wide">
        Ask for crew
      </button>
    </form>
  )
}

function NewPerson() {
  return <PersonForm submitLabel="Add person" onSubmit={(fields) => client.mutate('person.upsert', { id: newId(), ...fields })} />
}

type PersonFields = Omit<CommandInput<'person.upsert'>, 'id'>

/**
 * A person's details: the Add form, and the same form again to correct
 * them (audit finding 7). A refused change says why under the fields and
 * keeps what was typed.
 */
function PersonForm({ initial, submitLabel, onSubmit, onDone }: { initial?: PersonView; submitLabel: string; onSubmit: (fields: PersonFields) => Promise<unknown>; onDone?: () => void }) {
  const blank = { name: '', phone: '', email: '', skills: '', rate: '', kind: 'freelancer' as 'freelancer' | 'staff', notes: '', approvesLeave: false }
  const from = (p: PersonView) => ({
    name: p.name,
    phone: p.phone ?? '',
    email: p.email ?? '',
    skills: p.skills.join(', '),
    rate: p.dayRateCents === null ? '' : euroText(p.dayRateCents),
    kind: p.kind,
    notes: p.notes,
    approvesLeave: p.approvesLeave,
  })
  const [f, setF] = useState(initial ? from(initial) : blank)
  const { run, error, refuse } = useAct()
  const set = (k: Exclude<keyof typeof blank, 'approvesLeave'>) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return
    const rate = parseEuro(f.rate)
    if (rate.reason !== undefined) return refuse(rate.reason)
    void run(() =>
      onSubmit({
        name: f.name.trim(),
        kind: f.kind,
        phone: f.phone.trim() || null,
        email: f.email.trim() || null,
        skills: f.skills.split(',').map((s) => s.trim()).filter(Boolean),
        dayRateCents: rate.cents,
        notes: f.notes.trim(),
        // Only staff approve time off (ADR 0024).
        approvesLeave: f.kind === 'staff' && f.approvesLeave,
      })
    ).then((taken) => {
      if (!taken) return
      if (initial) onDone?.()
      else setF(blank)
    })
  }
  return (
    <form className="grid-form" onSubmit={submit} aria-label={initial ? `Edit ${initial.name}` : 'Add person'}>
      <label className="wide">
        Name <input value={f.name} onChange={set('name')} placeholder="Full name" required />
      </label>
      <label>
        Mobile <input type="tel" value={f.phone} onChange={set('phone')} placeholder="+353 87…" />
      </label>
      <label>
        Email <input type="email" value={f.email} onChange={set('email')} />
      </label>
      <label>
        Skills <input value={f.skills} onChange={set('skills')} placeholder="audio, rigger" />
      </label>
      <label>
        Usual day rate € <input inputMode="decimal" value={f.rate} onChange={set('rate')} />
      </label>
      <label>
        Type
        <select value={f.kind} onChange={set('kind')}>
          <option value="freelancer">Freelancer</option>
          <option value="staff">Staff</option>
        </select>
      </label>
      {f.kind === 'staff' && (
        <label className="wide tick">
          <input type="checkbox" checked={f.approvesLeave} onChange={(e) => setF({ ...f, approvesLeave: e.target.checked })} />
          <span>
            Can approve time off
            <small>Decides other staff's leave and days in lieu, and sets allowances, on the Leave screen.</small>
          </span>
        </label>
      )}
      <label className="wide">
        Notes <textarea rows={2} value={f.notes} onChange={set('notes')} placeholder="Notes for the office" />
      </label>
      <p className="hint wide">They can read these in their own data download.</p>
      <Refusal error={error} className="wide" />
      <button type="submit" className={initial ? 'primary' : 'wide'}>
        {submitLabel}
      </button>
      {initial && (
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      )}
    </form>
  )
}
