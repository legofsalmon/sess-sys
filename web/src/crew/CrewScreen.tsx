import {
  answersToCheck,
  APPLICANT_LEVEL,
  CERTIFICATE_KINDS,
  CERTIFICATE_LABELS,
  certificateState,
  companyLine,
  CREW_DEPARTMENTS,
  dayLabel,
  DEFAULT_LEVEL,
  daysLabel,
  eachDay,
  euro,
  euroText,
  HOLDING,
  levelLabel,
  levelLine,
  LEVELS,
  newId,
  offerMessage,
  offerOnCalendar,
  OPEN,
  parseEuro,
  personConflicts,
  REPLY_BY_AFTER,
  suggestedReplyBy,
  tellMessage,
  tidyDepartment,
  venueLabel,
  whatsappNumber,
  type AnswerKind,
  type CallView,
  type CertificateKind,
  type Certificates,
  type CommandInput,
  type CrewView,
  type JobView,
  type OfferView,
  type Person,
  type PersonView,
  type TellContext,
  type TellEvent,
  type View,
} from '@sh/shared'
import { blocks, CERTIFICATE_SOON_DAYS, certificateGaps, certificateName, certificateRefusal, certificateUnknowns, daysBetween, gapMarks, needsLabel, needsOf, type LateView } from '@sh/shared'
import { useId, useState, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Fold, ShowAll } from '../Fold.tsx'
import { Top, useHash } from '../jobs/common.tsx'
import { Pending, StatusPill, type PillTone } from '../StatusPill.tsx'
import { client } from '../sync.ts'
import { useToday, useView } from '../view.ts'
import { CertificateReminders, certificateWarnings, NeedsField } from './Certificates.tsx'
import { ArchivedPerson } from './Erase.tsx'
import { useFeedAddress } from './feed.ts'
import { LateLines, LateRow } from './Late.tsx'
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

const STATUS: Record<OfferView['status'], [string, PillTone]> = {
  offered: ['Offered', 'pending'],
  countered: ['Asked for more', 'pending'],
  accepted: ['Accepted', 'pending'],
  confirmed: ['Confirmed', 'confirmed'],
  declined: ['Declined', 'cancelled'],
  filled: ['Filled', 'cancelled'],
  cancelled: ['Withdrawn', 'cancelled'],
  'pulled-out': ["Can't make it", 'cancelled'],
}

export const linkFor = (p: Pick<Person, 'linkToken'>) => (p.linkToken ? `${location.origin}/f/${p.linkToken}` : '')

/** The filter's choice for people with no department. */
const NO_DEPARTMENT = '-'

/** "Fri 3 Oct 2027": a certificate's expiry wants its year. */
const dateLabel = (d: string) => `${dayLabel(d)} ${d.slice(0, 4)}`

/** A department as compared: free text, so "audio" and "Audio" are one. */
const dept = (p: Pick<PersonView, 'department'>) => (p.department ?? '').toLowerCase()

/** The picker's order (ADR 0025): by department, then the highest level first, then by name. */
function byDepartmentThenLevel(a: PersonView, b: PersonView): number {
  if (dept(a) !== dept(b)) {
    if (!a.department) return 1
    if (!b.department) return -1
    return dept(a).localeCompare(dept(b))
  }
  return b.level - a.level || a.name.localeCompare(b.name)
}

/** Lower case with the fadas off, so "padraig" finds Pádraig and "sean" finds Seán: names are often typed without them. */
const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** The words typed into a search for someone. */
const wordsOf = (typed: string) => plain(typed).split(/\s+/).filter(Boolean)

/**
 * Whether every word typed is in someone's name, the name they go by, their
 * department or a skill (audit finding 16): the picker's search and the
 * people list's find people the same way.
 */
function found(p: PersonView, words: readonly string[]): boolean {
  const text = plain([p.name, p.knownAs, p.department, ...p.skills].filter(Boolean).join(' '))
  return words.every((w) => text.includes(w))
}

/** "Dara Quinn · Audio · Level 3 (Sound No.1, Audio)", as the picker lists someone. */
function pickerLabel(p: PersonView): string {
  return `${p.name}${p.department ? ` · ${p.department}` : ''} · ${levelLabel(p.level)}${p.skills.length ? ` (${p.skills.join(', ')})` : ''}`
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

/** The calls still open, by job and then by days (audit finding 16), jobs in the order of their first day. */
function groupCalls(calls: readonly CallView[], inJobs: readonly JobView[]) {
  // A job's own venue heads its group, whichever phase comes first; one not on this device yet goes by its first call's.
  const venueOf = new Map(inJobs.map((j) => [j.id, j.venue ? venueLabel(j.venue) : '']))
  const jobs = new Map<string, { key: string; project: string; venue: string; projectId: string | null; dates: Map<string, CallView[]> }>()
  for (const c of calls) {
    // A call made on the Crew tab has no job; its project's name stands in.
    const key = c.projectId ?? `~${c.project.trim().toLowerCase()}`
    let job = jobs.get(key)
    if (!job) jobs.set(key, (job = { key, project: c.project, venue: (c.projectId && venueOf.get(c.projectId)) ?? c.venue, projectId: c.projectId, dates: new Map() }))
    // A phase somewhere other than the job's venue says where, beside its days.
    const when = [daysLabel(c.days), c.venue !== job.venue && c.venue].filter(Boolean).join(' · ')
    job.dates.set(when, [...(job.dates.get(when) ?? []), c])
  }
  return [...jobs.values()]
}

export function CrewScreen() {
  const view = useView()
  const hash = useHash()
  const today = useToday()
  const crew = view.crew
  const [share, setShare] = useState<Share | undefined>()
  const people = new Map(crew.people.map((p) => [p.id, p]))
  // Archived people (leavers) are kept for the record but out of the way.
  const active = crew.people.filter((p) => !p.archived)
  const archived = crew.people.filter((p) => p.archived)
  // The list narrowed to one department (ADR 0025): the ones in use, not a fixed list.
  const [department, setDepartment] = useState('')
  const departments: string[] = []
  for (const p of active) if (p.department && !departments.some((d) => d.toLowerCase() === dept(p))) departments.push(p.department)
  departments.sort((a, b) => a.localeCompare(b))
  // A department whose last person was edited or archived away narrows to nobody, so it's no filter at all until it's back.
  const chosen =
    department === NO_DEPARTMENT ? (active.some((p) => !p.department) ? department : '') : departments.some((d) => d.toLowerCase() === department.toLowerCase()) ? department : ''
  // Found as in the picker, and folded to the first ten (audit finding 16). Whoever is added stays in view, whatever the
  // search, filter or fold, until the tab is next opened: on a phone the form pushes the list out of sight, so it says so too.
  const [find, setFind] = useState('')
  const [added, setAdded] = useState<readonly { id: string; name: string }[]>([])
  const justAdded = (p: PersonView) => added.some((a) => a.id === p.id)
  const words = wordsOf(find)
  const shown = active.filter((p) => justAdded(p) || ((!chosen || (chosen === NO_DEPARTMENT ? !p.department : dept(p) === chosen.toLowerCase())) && found(p, words)))
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
  // Running late, said on a link (ADR 0028): first in the queue, as it's about today.
  const late = view.late.toCheck
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

      {(toCheck.length > 0 || toSortOut.length > 0 || late.length > 0) && (
        <section className="card">
          {/* Counted in full, so any past the first three are a tap away and never out of mind (audit finding 16). */}
          <h2>Answers to check ({late.length + toSortOut.length + toCheck.length})</h2>
          <Refusal error={answers.error} />
          <ShowAll
            items={[
              ...late.map((l) => <LateRow key={l.id} note={l} today={today} onNoted={() => void answers.run(() => client.mutate('late.seen', { id: l.id }))} />),
              ...toSortOut.map(({ c, o, text }) => (
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
              )),
              ...toCheck.map(({ call: c, offer: o, kind, short, warning }) => (
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
                      {c.openDays.length > 0 && (
                        <Fold label="Offer…">
                          <OfferForm
                            call={c}
                            crew={crew}
                            onShare={(person) => {
                              // Offering the call to someone else is acting on the answer, so it's noted without another tap.
                              void answers.run(() => client.mutate('offer.seen', { id: o.id }))
                              setShare({ kind: 'offer', person, call: c })
                            }}
                          />
                        </Fold>
                      )}
                    </div>
                  )}
                </div>
              )),
            ]}
            limit={3}
            what="answers"
          >
            {(rows) => rows}
          </ShowAll>
        </section>
      )}

      <TimesheetsCard view={view} />
      <LeaveCard view={view} />
      <CertificateReminders view={view} />

      <section className="card">
        <h2>Crew needed</h2>
        {upcoming.length === 0 && <Empty>Ask for crew from a job in Jobs, or below.</Empty>}
        {groupCalls(upcoming, view.jobs.jobs).map((g) => (
          <div className="call-group" key={g.key}>
            <header>
              <div>
                <b>{g.project}</b>
                {g.venue && <p>{g.venue}</p>}
              </div>
              {g.projectId && (
                <a className="link" href={`#jobs/${g.projectId}`}>
                  Open job
                </a>
              )}
            </header>
            {[...g.dates].map(([when, calls]) => (
              <div className="call-date" key={when}>
                <h3>{when}</h3>
                {calls.map((c) => (
                  <CallCard key={c.id} call={c} crew={crew} calendar={view.calendar} late={view.late} onShare={(person) => setShare({ kind: 'offer', person, call: c })} onTell={setShare} />
                ))}
              </div>
            ))}
          </div>
        ))}
      </section>

      {share && <SharePanelFor share={share} onClose={() => setShare(undefined)} />}

      <section className="card">
        <h2>Crew for something not in Jobs</h2>
        <p className="hint">For a job in Jobs, ask for crew from the job, so the crew get its phases, venue and any changes.</p>
        <Fold label="Ask for crew">
          <NewCall />
        </Fold>
      </section>

      <section className="card" aria-label="People">
        <h2>People</h2>
        <Refusal error={roster.error} />
        {active.length === 0 && archived.length === 0 && <Empty>Add your crew below.</Empty>}
        {active.length > 0 && (
          <input className="search" type="search" placeholder="Name, department or skill" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find a person" />
        )}
        {departments.length > 0 && (
          <select className="dept-filter" value={chosen} onChange={(e) => setDepartment(e.target.value)} aria-label="Department">
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            {active.some((p) => !p.department) && <option value={NO_DEPARTMENT}>No department</option>}
          </select>
        )}
        {active.length > 0 && shown.length === 0 && <p className="empty">Nobody matches.</p>}
        <ShowAll items={shown} limit={10} what="people" keep={justAdded}>
          {(rows) => rows.map((p) => <PersonRow key={p.id} person={p} crew={crew} />)}
        </ShowAll>
        {archived.length > 0 && (
          <details className="archived">
            <summary>Archived ({archived.length})</summary>
            {/* Each with "Erase details…" for when they ask (ADR 0027). */}
            {archived.map((p) => (
              <ArchivedPerson key={p.id} person={p} onBringBack={() => void roster.run(() => client.mutate('person.archive', { id: p.id, archived: false }))} />
            ))}
          </details>
        )}
        <Fold label="Add person">
          <NewPerson onAdded={(p) => setAdded((was) => [...was, p])} />
          {/* Read out as it changes, as it's there from the form's opening; not a second "status", which is the top bar's. */}
          <div aria-live="polite">{added.length > 0 && <p className="added">Added {added.at(-1)!.name}.</p>}</div>
        </Fold>
      </section>

      <p className="hint">
        Freelancers answer from their own private link: no app or login. Send it with an offer by WhatsApp, text or email.
        {people.size > 0 && ' Their bookings also appear in their own calendar if they subscribe from that page.'}
      </p>
    </div>
  )
}

/** Offered, holding or booked: the people a call's one line names. */
const ON_CALL: readonly OfferView['status'][] = [...OPEN, ...HOLDING]

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
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const { run, error } = useAct()
  const today = useToday()
  const filled = call.openDays.length === 0
  const live = call.status === 'open'
  const invites = calendar.link?.state === 'on' && calendar.link.invites === true
  // Who's on it, with their answer where it isn't yet a booking: "Dara Quinn, Niamh Kelly (offered)".
  const who = call.offers
    .filter((o) => o.person && ON_CALL.includes(o.status))
    .map((o) => `${o.person!.name}${o.status === 'confirmed' ? '' : ` (${STATUS[o.status][0].toLowerCase()})`}`)
    .join(', ')

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
        {who && <span className="who-line">{who}</span>}
      </button>
      {/* The one word at rest on where it stands: a cancelled call kept for the record says so, and a change to it or an offer on it still on its way says that. */}
      <StatusPill tone={!live ? 'cancelled' : filled ? 'confirmed' : 'pending'} pending={call.pending || call.offers.some((o) => o.pending)}>
        {!live
          ? 'Cancelled'
          : filled
            ? 'Filled'
            : call.days.length > 1
              ? `${call.days.filter((d) => call.heldByDay[d]! >= call.needed).length}/${call.days.length} days filled`
              : `${call.heldByDay[call.days[0]!]}/${call.needed}`}
      </StatusPill>
      {/* Lines that need acting on stay out at rest (audit finding 16): anyone short of a certificate it needs, and anyone running late (ADR 0028). */}
      {certificateWarnings(call, today).map((w) => (
        <p key={w} className="warn-line">
          {w}
        </p>
      ))}
      <LateLines call={call} late={late} today={today} />

      {open && (
        <>
          <p className="facts-line">
            {[daysLabel(call.days), call.callTime && `call ${call.callTime}`, euro(call.dayRateCents), needsOf(call).length && `needs ${needsLabel(needsOf(call))}`].filter(Boolean).join(' · ')}
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
                      {o.person?.name ?? 'Unknown'}
                      {partial && <small> {daysLabel(o.days)}</small>}
                      {o.override && <small> (override)</small>}
                    </span>
                    <span className="actions">
                      <StatusPill tone={tone} pending={o.pending}>
                        {label}
                      </StatusPill>
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

      {live && !filled && (
        <Fold label="Offer…" className="offer">
          <OfferForm call={call} crew={crew} onShare={onShare} />
        </Fold>
      )}

      {open && (
        <>
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
    if (rateChanged) changes.dayRateCents = rate.cents
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
      <label>
        Day rate € <input inputMode="decimal" value={f.rate} onChange={set('rate')} placeholder="250" />
      </label>
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
            {conflicts.join('. ')}. <b>Offer anyway</b>
          </span>
        </label>
      )}
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

/** WhatsApp, a text or an email with the words filled in, or a copy of them. Nothing is sent for you. */
export function SendButtons({ person, text, subject }: { person: Pick<Person, 'phone' | 'email'>; text: string; subject: string }) {
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
  const today = useToday()
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
            person.department,
            levelLine(person.level),
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
      <Pending pending={person.pending} />
      {open && editing && (
        <div className="detail">
          <PersonForm initial={person} submitLabel="Save" onSubmit={(fields) => client.mutate('person.upsert', { id: person.id, ...fields })} onDone={() => setEditing(false)} />
        </div>
      )}
      {open && !editing && (
        <div className="detail">
          {(person.phone || person.email) && <p className="muted">{[person.phone, person.email].filter(Boolean).join(' · ')}</p>}
          {person.knownAs && <p className="muted">Goes by {person.knownAs}</p>}
          {person.company && <p className="muted">{companyLine(person)}</p>}
          <CertificateLines person={person} />
          {person.notes && <p className="muted">{person.notes}</p>}
          <label className="level-pick">
            Level
            <select value={person.level} onChange={(e) => void run(() => client.mutate('person.level', { id: person.id, level: Number(e.target.value) }))} aria-label={`Level for ${person.name}`}>
              {LEVELS.map((n) => (
                <option key={n} value={n}>
                  {levelLine(n)}
                </option>
              ))}
            </select>
          </label>
          <Worked person={person} />
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
            {/* Each field's name is over it, not only inside it, so it stays once something is typed (audit finding 22). */}
            <label className="field">
              Off from <input type="date" value={away.start} onChange={(e) => setAway({ ...away, start: e.target.value })} />
            </label>
            <label className="field">
              Off until <input type="date" value={away.end} min={away.start} onChange={(e) => setAway({ ...away, end: e.target.value })} />
            </label>
            <label className="field wide">
              Note <input placeholder="e.g. on tour" value={away.note} onChange={(e) => setAway({ ...away, note: e.target.value })} />
            </label>
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

/**
 * The certificates someone holds, with any note such as an IPAF card's
 * categories, any running out in the next 30 days in the warn tone (ADR
 * 0028), and any run out in the bad tone (ADR 0025). Nothing for ones not
 * held or not known.
 */
function CertificateLines({ person }: { person: PersonView }) {
  const today = useToday()
  const states = CERTIFICATE_KINDS.map((kind) => ({ kind, c: person.certificates[kind], state: certificateState(person.certificates[kind], today) }))
  const held = states.filter((x) => x.state === 'held')
  const expired = states.filter((x) => x.state === 'expired')
  const soon = held.filter((x) => x.c?.expires && daysBetween(today, x.c.expires) <= CERTIFICATE_SOON_DAYS)
  if (!held.length && !expired.length) return null
  return (
    <>
      {held.length > 0 && (
        <p className="muted">
          Holds {held.map((x) => `${certificateName(x.kind)}${x.c?.note.trim() ? ` ${x.c.note.trim()}` : ''}${x.c?.expires ? ` (to ${dateLabel(x.c.expires)})` : ''}`).join(', ')}
        </p>
      )}
      {soon.map((x) => (
        <p key={x.kind} className="warn-line">
          {CERTIFICATE_LABELS[x.kind]} runs out on {dateLabel(x.c!.expires!)}.
        </p>
      ))}
      {expired.map((x) => (
        <p key={x.kind} className="alert">
          {CERTIFICATE_LABELS[x.kind]} ran out on {dateLabel(x.c!.expires!)}.
        </p>
      ))}
    </>
  )
}

/** The jobs someone was booked on, newest first (ADR 0025): the last few, and how many in all. */
function Worked({ person }: { person: PersonView }) {
  const { worked } = person
  if (!worked.length) return null
  return (
    <div className="worked" role="group" aria-label={`Worked: ${person.name}`}>
      <p className="muted">
        <b>Worked on {worked.length === 1 ? '1 job' : `${worked.length} jobs`}</b>
      </p>
      {worked.slice(0, 3).map((w) => (
        <p key={w.callId}>
          {w.name}
          {w.phase && <span className="muted"> · {w.phase}</span>} · {daysLabel(eachDay(w.start, w.end))}
        </p>
      ))}
    </div>
  )
}

function NewCall() {
  const today = useToday()
  // The reply-by day is suggested from the first day until the office types or clears it (audit finding 21).
  const blank = { project: '', phase: '', venue: '', role: '', start: today, end: today, callTime: '', needed: 1, rate: '', details: '', replyBy: undefined as string | undefined, needs: [] as CertificateKind[] }
  const [f, setF] = useState(blank)
  const { run, error, refuse } = useAct()
  const set = (k: Exclude<keyof typeof blank, 'needs'>) => (e: { target: { value: string } }) => setF({ ...f, [k]: k === 'needed' ? Number(e.target.value) : e.target.value })
  const replyBy = f.replyBy ?? suggestedReplyBy(f.start, f.end < f.start ? f.start : f.end, today) ?? ''
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
        replyBy: replyBy || null,
        needsCertificates: f.needs,
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

/** Adding someone; `onAdded` hears who once the device has them, so the list can keep them in view. */
function NewPerson({ onAdded }: { onAdded: (p: { id: string; name: string }) => void }) {
  return (
    <PersonForm
      submitLabel="Add person"
      onSubmit={async (fields) => {
        const id = newId()
        await client.mutate('person.upsert', { id, ...fields })
        onAdded({ id, name: fields.name })
      }}
    />
  )
}

type PersonFields = Omit<CommandInput<'person.upsert'>, 'id'>

/**
 * A person's details: the Add form, and the same form again to correct
 * them (audit finding 7). A refused change says why under the fields and
 * keeps what was typed.
 */
/** A certificate as the form holds it: yes, no or not known, an expiry day or none, and a note, such as an IPAF card's categories (ADR 0028). */
type CertField = { held: '' | 'yes' | 'no'; expires: string; note: string }
type CertFields = Record<CertificateKind, CertField>

const blankCerts = (): CertFields => Object.fromEntries(CERTIFICATE_KINDS.map((kind) => [kind, { held: '', expires: '', note: '' }])) as CertFields

function certFieldsOf(c: Certificates): CertFields {
  const out = blankCerts()
  for (const kind of CERTIFICATE_KINDS) {
    const x = c[kind]
    if (x) out[kind] = { held: x.held === null ? '' : x.held ? 'yes' : 'no', expires: x.expires ?? '', note: x.note }
  }
  return out
}

/** Every kind goes back, one not known as not known: the server keeps a newer kind that's left out, for a version of the app that doesn't know it (ADR 0028). */
function certificatesOf(fields: CertFields): Certificates {
  const out: Certificates = {}
  for (const kind of CERTIFICATE_KINDS) {
    const f = fields[kind]
    out[kind] = { held: f.held === '' ? null : f.held === 'yes', expires: f.expires || null, note: f.note.trim() }
  }
  return out
}

function PersonForm({ initial, submitLabel, onSubmit, onDone }: { initial?: PersonView; submitLabel: string; onSubmit: (fields: PersonFields) => Promise<unknown>; onDone?: () => void }) {
  const blank = {
    name: '',
    phone: '',
    email: '',
    skills: '',
    rate: '',
    kind: 'freelancer' as 'freelancer' | 'staff',
    notes: '',
    approvesLeave: false,
    department: '',
    knownAs: '',
    level: String(DEFAULT_LEVEL),
    certs: blankCerts(),
    companyName: '',
    vatNumber: '',
    croNumber: '',
  }
  const from = (p: PersonView) => ({
    name: p.name,
    phone: p.phone ?? '',
    email: p.email ?? '',
    skills: p.skills.join(', '),
    rate: p.dayRateCents === null ? '' : euroText(p.dayRateCents),
    kind: p.kind,
    notes: p.notes,
    approvesLeave: p.approvesLeave,
    department: p.department ?? '',
    knownAs: p.knownAs ?? '',
    level: String(p.level),
    certs: certFieldsOf(p.certificates),
    companyName: p.company?.name ?? '',
    vatNumber: p.company?.vatNumber ?? '',
    croNumber: p.company?.croNumber ?? '',
  })
  const [f, setF] = useState(initial ? from(initial) : blank)
  // The profile (ADR 0025) folds away on a phone, open when any of it is set; once open or shut by hand it stays so.
  const [moreOpen] = useState(() => !!initial && (!!initial.department || !!initial.knownAs || initial.level !== DEFAULT_LEVEL || !!initial.company || Object.values(initial.certificates).some((c) => c && (c.held !== null || !!c.expires || !!c.note))))
  const listId = useId()
  const { run, error, refuse } = useAct()
  const set = (k: Exclude<keyof typeof blank, 'approvesLeave' | 'certs'>) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  // Only freelancers trade through a company (ADR 0025); one a member of staff already has (from the crew list, say)
  // stays in view so it can be seen and cleared, never dropped without a word.
  const showCompany = f.kind === 'freelancer' || !!initial?.company
  const setCert = (kind: CertificateKind, field: Partial<CertField>) => setF({ ...f, certs: { ...f.certs, [kind]: { ...f.certs[kind], ...field } } })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return
    const rate = parseEuro(f.rate)
    if (rate.reason !== undefined) return refuse(rate.reason)
    const company = f.companyName.trim() || f.vatNumber.trim() || f.croNumber.trim()
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
        department: tidyDepartment(f.department),
        knownAs: f.knownAs.trim() || null,
        level: Number(f.level),
        certificates: certificatesOf(f.certs),
        company: showCompany && company ? { name: f.companyName.trim(), vatNumber: f.vatNumber.trim() || null, croNumber: f.croNumber.trim() || null } : null,
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
      <details className="wide more" open={moreOpen}>
        <summary>More: department, level, certificates{showCompany ? ', company' : ''}</summary>
        <div className="more-grid">
          <label>
            Department <input list={listId} value={f.department} onChange={set('department')} placeholder="Audio, LX…" maxLength={60} />
            <datalist id={listId}>
              {CREW_DEPARTMENTS.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
          <label>
            Known as <input value={f.knownAs} onChange={set('knownAs')} placeholder="The name they go by" maxLength={100} />
          </label>
          <label className="wide">
            Level
            <select value={f.level} onChange={set('level')}>
              {LEVELS.map((n) => (
                <option key={n} value={n}>
                  {levelLabel(n)}
                </option>
              ))}
            </select>
            <small>{Number(f.level) === APPLICANT_LEVEL ? 'An applicant, not vetted yet: out of the Offer to… picker unless asked for.' : 'Higher is more preferred. 1 is known.'}</small>
          </label>
          {CERTIFICATE_KINDS.map((kind) => (
            <div className="cert wide" key={kind}>
              <label>
                {CERTIFICATE_LABELS[kind]}
                <select value={f.certs[kind].held} onChange={(e) => setCert(kind, { held: e.target.value as CertField['held'] })}>
                  <option value="">Unknown</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label>
                Expires <input type="date" value={f.certs[kind].expires} onChange={(e) => setCert(kind, { expires: e.target.value })} aria-label={`${CERTIFICATE_LABELS[kind]} expires`} />
              </label>
              {/* Only for one held, or one with a note already: a phone's form stays short. */}
              {(f.certs[kind].held === 'yes' || !!f.certs[kind].note) && (
                <label className="cert-note">
                  Note
                  <input
                    value={f.certs[kind].note}
                    onChange={(e) => setCert(kind, { note: e.target.value })}
                    placeholder={kind === 'ipaf' ? 'Categories, e.g. 3a, 3b' : ''}
                    maxLength={200}
                    aria-label={`${CERTIFICATE_LABELS[kind]} note`}
                  />
                </label>
              )}
            </div>
          ))}
          {showCompany && (
            <>
              <label className="wide">
                Company <input value={f.companyName} onChange={set('companyName')} placeholder="If they trade through a company" maxLength={200} />
              </label>
              <label>
                VAT number <input value={f.vatNumber} onChange={set('vatNumber')} maxLength={40} />
              </label>
              <label>
                CRO number <input value={f.croNumber} onChange={set('croNumber')} maxLength={40} />
              </label>
            </>
          )}
        </div>
      </details>
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
