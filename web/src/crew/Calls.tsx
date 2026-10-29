import {
  APPLICANT_LEVEL,
  daysLabel,
  departmentForRole,
  departmentOf,
  eachDay,
  euroText,
  firstName,
  HOLDING,
  levelLabel,
  newId,
  offerOnCalendar,
  OPEN,
  parseEuro,
  personConflicts,
  REPLY_BY_AFTER,
  suggestedReplyBy,
  type CallView,
  type CertificateKind,
  type CommandInput,
  type CrewView,
  type OfferView,
  type PersonView,
  type View,
  blocks,
  certificateGaps,
  certificateRefusal,
  certificateUnknowns,
  gapMarks,
  needsLabel,
  needsOf,
  type LateView,
} from '@sh/shared'
import { useState, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Fold } from '../Fold.tsx'
import { StatusPill, type PillTone } from '../StatusPill.tsx'
import { useAccess, useSeesRates } from '../role.ts'
import { rateText } from '../format.ts'
import { DepartmentField } from './Department.tsx'
import { client } from '../sync.ts'
import { useToday, useView } from '../view.ts'
import { certificateWarnings, NeedsField } from './Certificates.tsx'
import { LateLines, NoteLate } from './Late.tsx'
import { personHref } from './PersonScreen.tsx'
import { Avatars } from '../Picture.tsx'
import { type Share, type TellTo, peopleOn, promptFor, tellTo } from './Messages.tsx'
import { dept, found, wordsOf } from './People.tsx'

/**
 * Crew › Calls' parts: a call's card, changing it, offering it to someone
 * and asking for crew. The screen that lists them is CrewScreen.tsx.
 */

export const STATUS: Record<OfferView['status'], [string, PillTone]> = {
  offered: ['Offered', 'pending'],
  countered: ['Asked for more', 'pending'],
  accepted: ['Accepted', 'pending'],
  confirmed: ['Confirmed', 'confirmed'],
  declined: ['Declined', 'cancelled'],
  filled: ['Filled', 'cancelled'],
  cancelled: ['Withdrawn', 'cancelled'],
  'pulled-out': ["Can't make it", 'cancelled'],
}

/** The other jobs someone holds on any of these days, and which days: what an offer over a booking can't have. */
function heldOn(crew: CrewView, personId: string, days: readonly string[], exceptCallId: string) {
  const jobs = new Set<string>()
  const held = new Set<string>()
  for (const c of crew.calls) {
    if (c.id === exceptCallId || c.status !== 'open') continue
    for (const o of c.offers) {
      if (o.personId !== personId || !HOLDING.includes(o.status)) continue
      const hit = o.days.filter((d) => days.includes(d))
      if (!hit.length) continue
      jobs.add(c.project)
      for (const d of hit) held.add(d)
    }
  }
  return { jobs: [...jobs], days: [...held] }
}

/** The picker's order (ADR 0025): by department, then the highest level first, then by name. */
function byDepartmentThenLevel(a: PersonView, b: PersonView): number {
  if (dept(a) !== dept(b)) {
    if (!a.department) return 1
    if (!b.department) return -1
    return dept(a).localeCompare(dept(b))
  }
  return b.level - a.level || a.name.localeCompare(b.name)
}

/** "Dara Quinn · Audio · Level 3 (Sound No.1, Audio)", as the picker lists someone. */
function pickerLabel(p: PersonView): string {
  return `${p.name}${p.department ? ` · ${p.department}` : ''} · ${levelLabel(p.level)}${p.skills.length ? ` (${p.skills.join(', ')})` : ''}`
}

/** Offered, holding or booked: the people a call's one line names. */
const ON_CALL: readonly OfferView['status'][] = [...OPEN, ...HOLDING]

/** How many on a call are named on its line at rest: the rest are counted, and listed once it's opened. */
const WHO_SHOWN = 8

/**
 * One crew call. At rest it's one line (audit finding 16): the role, its
 * phase or days and who's on it, with where it stands as a pill beside it
 * and "Offer…" under that while there are places to fill, the picker behind
 * it until it's wanted. A tap on the line opens its days, call time and rate,
 * who's been offered it and how they answered, on their link or on Google
 * Calendar, and changing or cancelling the call.
 */
export function CallCard({
  call,
  crew,
  calendar,
  late,
  onShare,
  onTell,
  inJob = false,
  phaseDays = false,
}: {
  call: CallView
  crew: CrewView
  calendar: View['calendar']
  /** Who on it is running late today (ADR 0028), said at rest under its line. */
  late?: LateView
  onShare: (p: PersonView) => void
  /** Opens the message for whoever should hear about a withdrawal or a cancelled call; without it, nobody is prompted. */
  onTell?: (share: Share | undefined) => void
  inJob?: boolean
  /** Under a phase on the job's page, for the phase's own days, which its header says already. */
  phaseDays?: boolean
}) {
  const mayOffer = useAccess().can('crew')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  // The offer or booking being withdrawn, asked first on its line: it can't be taken back, and their link says so at once (rule 1).
  const [withdrawing, setWithdrawing] = useState<string | undefined>()
  const { run, error } = useAct()
  const today = useToday()
  const filled = call.openDays.length === 0
  const live = call.status === 'open'
  const invites = calendar.link?.state === 'on' && calendar.link.invites === true
  // Who's on it, with their answer where it isn't yet a booking: "Dara Quinn (booked), Niamh Kelly (offered)". The first few at rest, then
  // "and 17 more", which opening the line lists (audit of 18 October, finding 20).
  // Booked and not yet booked side by side, everyone's state is said, so "(offered)" can't read as the pair's (audit, 20 October 2026, finding 72).
  const onIt = call.offers.filter((o) => o.person && ON_CALL.includes(o.status))
  const mixed = onIt.some((o) => o.status === 'confirmed') && onIt.some((o) => o.status !== 'confirmed')
  const who = onIt
    .slice(0, WHO_SHOWN)
    .map((o) => `${o.person!.name}${o.status === 'confirmed' ? (mixed ? ' (booked)' : '') : ` (${STATUS[o.status][0].toLowerCase()})`}`)
    .join(', ')
  const more = onIt.length - WHO_SHOWN

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
    <article className={`job call${call.pending ? ' is-pending' : ''}`} aria-label={`${call.needed} × ${call.role}`}>
      <button type="button" className="call-line" aria-expanded={open} onClick={() => setOpen(!open)}>
        <b>
          {call.needed} × {call.role}
          {/* On the Crew tab the days are the heading over it. On the job's page the phase shows only for a call across phases, and the days unless they're the phase's. */}
          {(!inJob || !call.phaseId) && call.phase && <span className="muted"> · {call.phase}</span>}
          {inJob && !phaseDays && <span className="muted"> · {daysLabel(call.days)}</span>}
        </b>
      </button>
      {/* The one word at rest on where it stands: a cancelled call kept for the record says so, and a change to it or an offer on it still on its way says that. */}
      <StatusPill tone={!live ? 'cancelled' : filled ? 'confirmed' : 'pending'} pending={call.pending || call.offers.some((o) => o.pending)}>
        {!live
          ? 'Cancelled'
          : filled
            ? 'Filled'
            : heldLabel(call)}
      </StatusPill>
      {/* Under the line at the card's full width, not squeezed beside the pill into a column of one word a line (audit of 18 October, finding 20). */}
      {who && (
        <p className="who-line">
          <Avatars names={onIt.map((o) => o.person!.name)} />
          <span>
            {who}
            {more > 0 &&
              (open ? (
                ` and ${more} more`
              ) : (
                <>
                  {' '}
                  <button type="button" className="link" aria-expanded={false} onClick={() => setOpen(true)}>
                    and {more} more
                  </button>
                </>
              ))}
          </span>
        </p>
      )}
      {/* Lines that need acting on stay out at rest (audit finding 16): anyone short of a certificate it needs, and anyone running late (ADR 0028). */}
      {certificateWarnings(call, today).map((w) => (
        <p key={w} className="warn-line">
          {w}
        </p>
      ))}
      <LateLines call={call} late={late} today={today} />
      {/* Someone booked who rang to say they're late, noted where their line is (ADR 0028). */}
      <NoteLate call={call} late={late} />

      {open && (
        <>
          <p className="facts-line">
            {[
              daysLabel(call.days),
              call.callTime && `call ${call.callTime}`,
              rateText(call.dayRateCents, call.rateHidden),
              departmentOf(call) ?? 'no department',
              needsOf(call).length && `needs ${needsLabel(needsOf(call))}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {call.offers.length > 0 && (
            <ul className="offers">
              {call.offers.map((o) => {
                const [label, tone] = STATUS[o.status]
                const partial = o.days.length < call.days.length && (o.status === 'accepted' || o.status === 'confirmed' || o.status === 'countered')
                const cal = offerOnCalendar(o, calendar.days, today)
                const answering = o.status === 'offered' || o.status === 'countered' || o.status === 'accepted' || o.status === 'confirmed'
                return (
                  <li key={o.id}>
                    <span>
                      {o.person ? (
                        <a className="link" href={personHref(o.personId)}>
                          {o.person.name}
                        </a>
                      ) : (
                        'Unknown'
                      )}
                      {partial && <small> {daysLabel(o.days)}</small>}
                      {o.override && <small> (override)</small>}
                    </span>
                    <span className="actions">
                      <StatusPill tone={tone} pending={o.pending}>
                        {label}
                      </StatusPill>
                      {mayOffer && o.status === 'offered' && o.person && (
                        <button type="button" className="link" onClick={() => onShare(o.person as PersonView)}>
                          Send
                        </button>
                      )}
                      {mayOffer && (o.status === 'offered' || o.status === 'confirmed') && withdrawing !== o.id && (
                        <button type="button" className="link" onClick={() => setWithdrawing(o.id)}>
                          Withdraw
                        </button>
                      )}
                    </span>
                    {withdrawing === o.id && (
                      <Confirm
                        question={
                          o.status === 'confirmed'
                            ? `Release ${o.person?.name ?? 'them'} from this call? The days they're booked for go back to it, and their link says so at once.`
                            : `Withdraw the offer to ${o.person?.name ?? 'them'}? Their link says it's withdrawn at once.`
                        }
                        yes={o.status === 'confirmed' ? `Release ${o.person ? firstName(o.person) : 'them'}` : 'Withdraw the offer'}
                        no={o.status === 'confirmed' ? 'Keep them' : 'Keep it open'}
                        onYes={() => {
                          setWithdrawing(undefined)
                          withdraw(o)
                        }}
                        onNo={() => setWithdrawing(undefined)}
                      />
                    )}
                    {cal && <small className="on-cal">{cal.line}</small>}
                    {cal?.warning && <small className="warn-line">{cal.warning}</small>}
                    {/* Not known is allowed, and said on the offer (ADR 0028). */}
                    {answering && o.person && certificateUnknowns(o.person, needsOf(call), o.days, today).map((w) => (
                      <small key={w} className="warn-line">
                        {w}
                      </small>
                    ))}
                    {!cal && invites && answering && o.person && !o.person.email?.trim() && <small className="on-cal">No email address, so no calendar invite.</small>}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {live && !filled && mayOffer && (
        <Fold label="Offer…" className="offer">
          <OfferForm call={call} crew={crew} onShare={onShare} />
        </Fold>
      )}

      {open && (
        <>
          {editing && mayOffer && (
            <EditCall
              call={call}
              onDone={() => setEditing(false)}
              onSaved={(after, datesMoved) => onTell?.(promptFor('call-changed', peopleOn(after).map((t) => neededBefore(datesMoved ? forCallDays(t) : t, call))))}
            />
          )}
          <Refusal error={error} />
          {!mayOffer ? null : cancelling ? (
            <Confirm
              question={`Cancel the call for ${call.needed} × ${call.role} on ${call.project}? Everyone offered is told it's withdrawn.`}
              yes="Cancel it"
              onYes={cancel}
              onNo={() => setCancelling(false)}
            />
          ) : (
            <div className="actions end">
              {/* A cancelled call, kept on the job's page for the record, can't be changed or cancelled again. */}
              {live && !call.pending && (
                <button type="button" className="link" onClick={() => setEditing(!editing)} aria-expanded={editing}>
                  Change
                </button>
              )}
              {live && (
                <button type="button" className="link" onClick={() => setCancelling(true)}>
                  Cancel crew call
                </button>
              )}
            </div>
          )}
        </>
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
const NOTICED = ['role', 'start', 'end', 'callTime', 'dayRateCents', 'details', 'project', 'phase', 'venue', 'needsCertificates'] as const

/** The same person, told what the call needed before, so the message says what it needs now (ADR 0028). */
const neededBefore = (t: TellTo, call: CallView): TellTo => ({ ...t, context: { ...t.context, neededBefore: needsOf(call) } })

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
    needsCertificates: changes.needsCertificates ?? call.needsCertificates,
  }
}

function EditCall({ call, onDone, onSaved }: { call: CallView; onDone: () => void; onSaved?: (after: CallView, datesMoved: boolean) => void }) {
  const tied = !!call.projectId
  const view = useView()
  // A rate this device isn't sent stays the office's to change (ADR 0046).
  const seesRates = useSeesRates() && !call.rateHidden
  const [department, setDepartment] = useState<string | null>(departmentOf(call))
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
  // What the call needs (ADR 0028): kept apart, as it's ticks rather than text.
  const [needs, setNeeds] = useState(needsOf(call))
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
    // Dates moved earlier can leave the reply-by day after the job; it's here to fix, as when a call is made (audit finding 21).
    if (f.replyBy && f.replyBy > end) return refuse(REPLY_BY_AFTER)
    if ((f.callTime || null) !== call.callTime) changes.callTime = f.callTime || null
    if (Math.max(1, f.needed) !== call.needed) changes.needed = Math.max(1, f.needed)
    if (rateChanged && seesRates) changes.dayRateCents = rate.cents
    if (department !== departmentOf(call)) changes.department = department
    if (f.details.trim() !== call.details) changes.details = f.details.trim()
    if ((f.replyBy || null) !== call.replyBy) changes.replyBy = f.replyBy || null
    if (needs.join() !== needsOf(call).join()) changes.needsCertificates = needs
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
      {seesRates ? (
        <label>
          Day rate € <input inputMode="decimal" value={f.rate} onChange={set('rate')} placeholder="250" />
        </label>
      ) : (
        <p className="hint">The office sets the rate: your role doesn't see crew rates.</p>
      )}
      <DepartmentField view={view} value={department} onChange={setDepartment} />
      <label className="wide">
        Reply by <input type="date" value={f.replyBy} onChange={set('replyBy')} />
      </label>
      <label className="wide">
        Details for crew <textarea rows={2} value={f.details} onChange={set('details')} placeholder="Travel, food, parking, dress" />
      </label>
      <NeedsField value={needs} onChange={setNeeds} />
      {needs.some((k) => !needsOf(call).includes(k)) && agreed + call.offers.filter((o) => o.status === 'offered').length > 0 && (
        <p className="hint wide">Nobody already on it is taken off: anyone without it is warned about on the call's line.</p>
      )}
      {datesChanged && booked > 0 && (
        <p className="hint wide">
          {booked === 1 ? '1 person is' : `${booked} people are`} booked: the days they hold move with the call. Anyone who would be left with no days stops the
          change, so release them first or keep their days.
        </p>
      )}
      {rateChanged && seesRates && agreed > 0 && (
        <p className="hint wide">
          The new rate goes to offers still waiting on an answer. {agreed === 1 ? 'The 1 person who has' : `The ${agreed} people who have`} accepted, asked for
          a rate or been confirmed keep what was agreed.
        </p>
      )}
      {f.needed > call.needed && call.openDays.length === 0 && (
        <p className="hint wide">The call is filled: needing more opens it again. Anyone told it had filled gets a new offer, not the old one back.</p>
      )}
      <Refusal error={error} className="wide" />
      {/* Not "Cancel", beside "Cancel crew call": this one only closes the form (rule 10). */}
      <div className="actions wide">
        <button type="submit" className="primary">
          Save changes
        </button>
        <button type="button" onClick={onDone}>
          Keep as it was
        </button>
      </div>
    </form>
  )
}

/** Offer a call to someone not yet offered it, with a warning when their days clash. Also beside a decline or a pull-out in "Answers to check". */
export function OfferForm({ call, crew, onShare }: { call: CallView; crew: CrewView; onShare: (p: PersonView) => void }) {
  const [personId, setPersonId] = useState('')
  const [override, setOverride] = useState(false)
  const [applicants, setApplicants] = useState(false)
  const [find, setFind] = useState('')
  // Someone who declined, pulled out or was told it's filled can be offered it again.
  const offered = new Set(call.offers.filter((o) => !['declined', 'filled', 'cancelled', 'pulled-out'].includes(o.status)).map((o) => o.personId))
  // Narrowed as you type (audit finding 16), as the people list is.
  const words = wordsOf(find)
  const everyone = crew.people.filter((p) => !offered.has(p.id) && !p.archived && found(p, words))
  // Applicants nobody has vetted (Level 0) stay out of the way unless asked for (ADR 0025).
  const hidden = everyone.filter((p) => p.level === APPLICANT_LEVEL).length
  const candidates = everyone.filter((p) => applicants || p.level !== APPLICANT_LEVEL).sort(byDepartmentThenLevel)
  const chosen = candidates.find((p) => p.id === personId)
  const conflicts = chosen ? personConflicts(crew, chosen.id, call.days, call.id) : []
  // Offering anyway over a booking sends an offer they can only take the free days of: nobody holds two jobs on a day (ADR 0002),
  // so the checkbox says so, rather than reading as it does for days off (audit, 20 October 2026, finding 81).
  const bookedOn = chosen ? heldOn(crew, chosen.id, call.days, call.id) : { jobs: [], days: [] }
  const onlyFree =
    chosen && bookedOn.jobs.length > 0
      ? bookedOn.days.length >= call.days.length
        ? `${firstName(chosen)} can't take any of it unless they pull out of ${bookedOn.jobs.join(' and ')}.`
        : `${firstName(chosen)} can only take the days not on ${bookedOn.jobs.join(' or ')} unless they pull out of ${bookedOn.jobs.length === 1 ? 'it' : 'them'}.`
      : ''
  // Busy in their own calendar (ADR 0044): said, never in the way. It may be something they can move, and they may still say yes.
  const own = useView().ownCalendars
  const busy = chosen ? own.warning(chosen.id, call.days) : null
  const { run, error, refuse } = useAct()
  // What the call needs (ADR 0028): those who hold it first, then those not known, then those missing one, each in the order above.
  const today = useToday()
  const needs = needsOf(call)
  const gapsOf = (p: PersonView) => certificateGaps(p, needs, call.days, today)
  const groups = needs.length
    ? [
        { label: `Hold ${needsLabel(needs)}`, people: candidates.filter((p) => gapsOf(p).length === 0) },
        { label: 'Not known: check first', people: candidates.filter((p) => gapsOf(p).length > 0 && !gapsOf(p).some(blocks)) },
        { label: 'Missing a certificate', people: candidates.filter((p) => gapsOf(p).some(blocks)) },
      ].filter((g) => g.people.length)
    : undefined
  const option = (p: PersonView) => {
    const marks = gapMarks(gapsOf(p))
    return (
      <option key={p.id} value={p.id}>
        {pickerLabel(p)}
        {marks && ` · ${marks}`}
        {personConflicts(crew, p.id, call.days, call.id).length ? ' ⚠' : ''}
        {own.busyOn(p.id, call.days).size ? ' · busy in own calendar' : ''}
      </option>
    )
  }

  const send = (e: FormEvent) => {
    e.preventDefault()
    if (!chosen) return
    const p = chosen
    // Said here, in the server's own words, rather than after a round trip; "Offer anyway" doesn't pass it.
    const short = certificateRefusal(p, needs, call.days, today)
    if (short) return refuse(short)
    void run(() => client.mutate('offer.send', { id: newId(), callId: call.id, personId: p.id, override: conflicts.length > 0 && override })).then((ok) => {
      if (!ok) return
      setPersonId('')
      setOverride(false)
      onShare(p)
    })
  }

  return (
    <form className="offer-form" onSubmit={send}>
      <input
        type="search"
        className="find"
        value={find}
        onChange={(e) => setFind(e.target.value)}
        // Enter in a search box only searches: it mustn't send the offer to whoever is picked below, the trap of audit finding 5.
        onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
        placeholder="Name, department or skill"
        aria-label="Find someone"
      />
      <select
        value={personId}
        onChange={(e) => {
          setPersonId(e.target.value)
          // A reason given for someone else no longer applies.
          refuse('')
        }}
        aria-label="Offer to"
      >
        <option value="">{candidates.length || !words.length ? 'Offer to…' : 'Nobody matches'}</option>
        {groups
          ? groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.people.map(option)}
              </optgroup>
            ))
          : candidates.map(option)}
      </select>
      <button type="submit" disabled={!chosen || (conflicts.length > 0 && !override)}>
        Offer
      </button>
      {(hidden > 0 || applicants) && (
        <label className="applicants">
          <input type="checkbox" checked={applicants} onChange={(e) => setApplicants(e.target.checked)} />
          <span>Show applicants{hidden > 0 ? ` (${hidden})` : ''}</span>
        </label>
      )}
      {conflicts.length > 0 && (
        <label className="warn">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          <span>
            {conflicts.join('. ')}. {onlyFree && `${onlyFree} `}
            <b>Offer anyway</b>
          </span>
        </label>
      )}
      {busy && <p className="warn-line">{busy}. The offer can still go: it may be something they can move, and they can still say yes.</p>}
      {chosen &&
        certificateUnknowns(chosen, needs, call.days, today).map((w) => (
          <p key={w} className="warn-line">
            {w}
          </p>
        ))}
      <Refusal error={error} />
    </form>
  )
}

/** `onMade` hears each call's id as it's asked for, so the list can keep it in view whatever its days. */
export function NewCall({ onMade }: { onMade?: (id: string) => void } = {}) {
  const today = useToday()
  const view = useView()
  const seesRates = useSeesRates()
  // The reply-by day is suggested from the first day until the office types or clears it (audit finding 21); the department from the role until picked (ADR 0046).
  const blank = {
    project: '',
    phase: '',
    venue: '',
    role: '',
    start: today,
    end: today,
    callTime: '',
    needed: 1,
    rate: '',
    details: '',
    replyBy: undefined as string | undefined,
    needs: [] as CertificateKind[],
    department: undefined as string | null | undefined,
  }
  const [f, setF] = useState(blank)
  const { run, error, refuse } = useAct()
  const set = (k: Exclude<keyof typeof blank, 'needs' | 'department'>) => (e: { target: { value: string } }) => setF({ ...f, [k]: k === 'needed' ? Number(e.target.value) : e.target.value })
  const suggested = departmentForRole(f.role, { calls: view.crew.calls, people: view.crew.people })
  const replyBy = f.replyBy ?? suggestedReplyBy(f.start, f.end < f.start ? f.start : f.end, today) ?? ''
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!f.project.trim() || !f.role.trim()) return
    const rate = parseEuro(f.rate)
    if (rate.reason !== undefined) return refuse(rate.reason)
    // Ready for the next call on the same job and days; a refusal brings what was typed back, unless the next thing has been typed since.
    const cleared = { ...blank, project: f.project, venue: f.venue, start: f.start, end: f.end }
    setF(cleared)
    const id = newId()
    onMade?.(id)
    void run(() =>
      client.mutate('call.create', {
        id,
        project: f.project.trim(),
        phase: f.phase.trim(),
        venue: f.venue.trim(),
        role: f.role.trim(),
        start: f.start,
        end: f.end < f.start ? f.start : f.end,
        callTime: f.callTime || null,
        needed: Math.max(1, f.needed),
        dayRateCents: seesRates ? rate.cents : null,
        details: f.details.trim(),
        replyBy: replyBy || null,
        needsCertificates: f.needs,
        department: f.department === undefined ? suggested : f.department,
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
      {seesRates ? (
        <label>
          Day rate € <input inputMode="decimal" value={f.rate} onChange={set('rate')} placeholder="250" />
        </label>
      ) : (
        <p className="hint">The office sets the rate: your role doesn't see crew rates.</p>
      )}
      <label>
        Venue <input value={f.venue} onChange={set('venue')} />
      </label>
      <DepartmentField view={view} value={f.department} suggested={suggested} onChange={(department) => setF({ ...f, department })} className="wide" />
      <label className="wide">
        Reply by <input type="date" value={replyBy} onChange={set('replyBy')} />
      </label>
      <p className="hint wide">Two days before the first day, or the day before when the job is close. Clear it if there's no hurry.</p>
      <label className="wide">
        Details for crew <textarea rows={2} value={f.details} onChange={set('details')} placeholder="Travel, food, parking, dress" />
      </label>
      <NeedsField value={f.needs} onChange={(needs) => setF({ ...f, needs })} />
      <Refusal error={error} className="wide" />
      <button type="submit" className="primary wide">
        Ask for crew
      </button>
    </form>
  )
}

/**
 * How many are held against how many are needed (audit of 18 October,
 * finding 20): "25 of 40, both days", "3 of 6", or "20 to 25 of 40 a day"
 * when the days differ, rather than "0/2 days filled" for a call most of the
 * way there.
 */
export function heldLabel(call: Pick<CallView, 'days' | 'heldByDay' | 'needed'>): string {
  const held = call.days.map((d) => call.heldByDay[d] ?? 0)
  const least = Math.min(...held)
  const most = Math.max(...held)
  if (held.length <= 1) return `${least} of ${call.needed}`
  if (least !== most) return `${least} to ${most} of ${call.needed} a day`
  return `${least} of ${call.needed}, ${held.length === 2 ? 'both days' : `all ${held.length} days`}`
}
