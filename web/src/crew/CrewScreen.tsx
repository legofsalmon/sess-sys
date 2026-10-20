import {
  answersToCheck,
  APPLICANT_LEVEL,
  CERTIFICATE_KINDS,
  CERTIFICATE_LABELS,
  CREW_DEPARTMENTS,
  DEFAULT_LEVEL,
  daysLabel,
  departmentForRole,
  departmentOf,
  eachDay,
  euro,
  euroText,
  firstName,
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
  sameDepartment,
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
  namedFromAddress,
} from '@sh/shared'
import { blocks, certificateGaps, certificateRefusal, certificateUnknowns, gapMarks, needsLabel, needsOf, type LateView } from '@sh/shared'
import { VehicleReminders } from '../stock/Vehicles.tsx'
import { emailBackRefusal, emailInUseRefusal, emailTakenBy, holdsARole, ROLE_LABELS, sameEmail, whoSignsInRefusal } from '@sh/shared'
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useWindowed } from '../windowed.ts'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Fold, ShowAll } from '../Fold.tsx'
import { Top, useHash } from '../jobs/common.tsx'
import { Pending, StatusPill, type PillTone } from '../StatusPill.tsx'
import { useAccess, useSeesRates } from '../role.ts'
import { rateText } from '../format.ts'
import { callDepartments, DepartmentField } from './Department.tsx'
import { client } from '../sync.ts'
import { useToday, useView } from '../view.ts'
import { CertificateReminders, certificateWarnings, NeedsField } from './Certificates.tsx'
import { DocumentToCheck } from './Documents.tsx'
import { ArchivedPerson } from './Erase.tsx'
import { LateLines, lateNotesOn, LateRow, lateToNote, NoteLate } from './Late.tsx'
import { LeaveScreen } from './Leave.tsx'
import { personHref, PersonScreen } from './PersonScreen.tsx'
import { TimesheetScreen, TimesheetsCard } from './Timesheets.tsx'
import { CrewViews } from './CrewViews.tsx'
import { ImportPeopleScreen } from './ImportPeople.tsx'
import { Heading } from '../Icon.tsx'
import { useSamePeople } from './Combine.tsx'
import { Avatar, Avatars } from '../Picture.tsx'
import { SkillsField, withTyped } from './SkillsField.tsx'

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

export const linkFor = (p: Pick<Person, 'linkToken'>) => (p.linkToken ? `${location.origin}/f/${p.linkToken}` : '')

/** The filter's choice for people with no department. */
const NO_DEPARTMENT = '-'

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
type CallGroup = ReturnType<typeof groupCalls>[number]
const groupKey = (g: CallGroup) => g.key

/** A job's calls, a group to each job, drawn in a window: the first has no line above it, wherever the window starts. */
function Groups({ name, groups, children }: { name: string; groups: readonly CallGroup[]; children: (g: CallGroup) => ReactNode }) {
  const win = useWindowed(`calls:${name}`, groups, groupKey, 300)
  return (
    <div className="call-groups windowed" ref={win.list} style={win.style}>
      {win.rows.map((g, i) => (
        <div className="call-group" key={g.key} ref={win.row(g.key)} data-place={`${name}:${g.key}`} data-first={win.start + i === 0 || undefined}>
          {children(g)}
        </div>
      ))}
    </div>
  )
}

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

/**
 * Answers on Google Calendar the app couldn't act on, such as a No to a
 * booked day: for the office to sort out. Counted in "Answers to check" and
 * on the Crew badge alike, so neither says less is waiting than the other.
 */
export function calendarAnswersToSortOut(view: View, today: string) {
  return view.crew.calls
    .filter((c) => c.end >= today && c.status === 'open')
    .flatMap((c) =>
      c.offers
        .filter((o) => o.status === 'offered' || o.status === 'confirmed')
        .flatMap((o) => {
          const cal = offerOnCalendar(o, view.calendar.days, today)
          return cal?.warning ? [{ c, o, text: o.status === 'confirmed' ? cal.warning : `${cal.line} ${cal.warning}` }] : []
        })
    )
}

export function CrewScreen() {
  const view = useView()
  // A role without crew sees who's on and what's waiting, without the ways to ask or add (ADR 0034).
  const mayCrew = useAccess().can('crew')
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
  // Crew needed narrowed to a department (ADR 0046). A head of department starts on their own, everyone else on all.
  const access = useAccess()
  const myDepartment = access.role === 'head' ? (access.personId && people.get(access.personId)?.department) || view.reading.department || '' : ''
  const [narrowedTo, setNarrowedTo] = useState<string | undefined>()
  // Said after calls are given a department, which takes the list to it, so what was done stays in view (ADR 0046).
  const [gave, setGave] = useState('')
  const setCallsFor = (d: string) => {
    setGave('')
    setNarrowedTo(d)
  }
  const callDepts = callDepartments(view)
  const wanted = narrowedTo ?? myDepartment
  // A department no call is in any more is no filter at all until it's back, as for people.
  const callsFor =
    wanted === NO_DEPARTMENT ? (upcoming.some((c) => !departmentOf(c)) ? wanted : '') : callDepts.find((d) => sameDepartment(d, wanted)) ?? ''
  const shownCalls = upcoming.filter((c) => !callsFor || (callsFor === NO_DEPARTMENT ? !departmentOf(c) : sameDepartment(departmentOf(c), callsFor)))
  const onCalendar = (o: OfferView) => offerOnCalendar(o, view.calendar.days, today)
  // A yes or a counter until Confirm or Withdraw; a decline or a pull-out until Noted. The Crew tab's count is the same list.
  const toCheck = answersToCheck(crew, today).map((a) => ({ ...a, warning: onCalendar(a.offer)?.warning }))
  const toSortOut = calendarAnswersToSortOut(view, today)
  // Running late, said on a link (ADR 0028): first in the queue, as it's about today.
  const late = view.late.toCheck
  // Documents sent from a link, for the office to check (ADR 0029).
  const docs = view.documents.toCheck
  // What the device turned down, said in the card it was asked from.
  const answers = useAct()
  const roster = useAct()
  // The yes or counter being turned down, asked first in its row: it can't be taken back, and their link says so at once (rule 1).
  const [turningDown, setTurningDown] = useState<string | undefined>()
  // Whether the filled calls are unfolded (audit finding 10).
  const [filledOpen, setFilledOpen] = useState(false)
  // Who was just archived, said where the list was, with the way back (rule 10).
  const [archivedNow, setArchivedNow] = useState<{ id: string; name: string } | undefined>()
  // Back from the archive only while their email is still theirs alone, as the server checks (ADR 0049).
  const bringBack = (id: string) =>
    void roster.run(() => {
      const p = crew.people.find((x) => x.id === id)
      const other = p && emailTakenBy(crew.people, id, p.email)
      if (p && other) throw new Error(emailBackRefusal(p.name, other.name))
      return client.mutate('person.archive', { id, archived: false })
    })
  const [, timesheet] = /^#crew\/timesheet\/(.+)$/.exec(hash) ?? []
  if (timesheet) return <TimesheetScreen view={view} offerId={decodeURIComponent(timesheet)} />
  // Each person has a page of their own (#crew/person/<id>); the People list is one line each that opens it.
  const [, personId] = /^#crew\/person\/(.+)$/.exec(hash) ?? []
  if (personId) return <PersonScreen view={view} id={decodeURIComponent(personId)} onArchived={setArchivedNow} />
  // Staff leave and time in lieu (ADR 0024) have a screen of their own under Crew.
  if (hash === '#crew/leave') return <LeaveScreen view={view} />
  // Bringing in the crew list (ADR 0025), under Crew where the list lives (ADR 0041).
  if (hash === '#crew/import') return <ImportPeopleScreen view={view} />

  // Crew's row (ADR 0041): the calls and answers here, the people at #crew/people, the timesheets at #crew/timesheets.
  const page = hash === '#crew/people' ? 'people' : hash === '#crew/timesheets' ? 'timesheets' : 'calls'

  /** Settle a yes or a counter, then tell them. */
  const settle = (o: OfferView, c: CallView, command: 'offer.confirm' | 'offer.cancel', event: TellEvent) => {
    void answers.run(() => client.mutate(command, { id: o.id })).then((ok) => ok && o.person && setShare(promptFor(event, [tellTo(o.person, c, o)])))
  }

  // Only the calls short of people at rest, with the filled ones a tap away under them (audit finding 10). A filled call with
  // something to act on stays out too, as ShowAll keeps a line to act on: someone short of a certificate it needs, or running
  // late, or the day itself, when someone who rings to say they're late is noted on its line (ADR 0028).
  const short = shownCalls.filter((c) => c.openDays.length > 0)
  const atHand = (c: CallView) => c.openDays.length > 0 || certificateWarnings(c, today).length > 0 || lateNotesOn(c, view.late).length > 0 || lateToNote(c).length > 0
  const inView = shownCalls.filter(atHand)
  const filled = shownCalls.filter((c) => !atHand(c))
  // A long list (audit finding 11, ADR 0050): only the jobs' groups near the screen are drawn, and Back finds its place by them (places.ts).
  const callGroups = (calls: readonly CallView[], list: string) => (
    <Groups name={list} groups={groupCalls(calls, view.jobs.jobs)}>
      {(g) => (
        <>
          <header>
            <div>
              <b>{g.project}</b>
              {g.venue && <p>{g.venue}</p>}
            </div>
            {g.projectId && (
              <a className="link" href={`#jobs/${g.projectId}/crew`}>
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
        </>
      )}
    </Groups>
  )

  return (
    <div className="app crew">
      <Top view={view} title="Crew" root />
      <CrewViews view={view} current={page} />

      {page === 'timesheets' &&
        (view.timesheets.toApprove.length || view.timesheets.notIn.length || view.timesheets.approved.length ? (
          <TimesheetsCard view={view} />
        ) : (
          <section className="card">
            <Empty>No timesheets yet. Crew send theirs from their own link once a booking's days are done.</Empty>
          </section>
        ))}

      {page === 'calls' && (toCheck.length > 0 || toSortOut.length > 0 || late.length > 0 || docs.length > 0) && (
        <section className="card">
          {/* Counted in full, so any past the first three are a tap away and never out of mind (audit finding 16). */}
          <Heading icon="message">Answers to check ({late.length + docs.length + toSortOut.length + toCheck.length})</Heading>
          <Refusal error={answers.error} />
          <ShowAll
            items={[
              ...late.map((l) => (
                <LateRow key={l.id} note={l} today={today} onNoted={mayCrew ? () => void answers.run(() => client.mutate('late.seen', { id: l.id, offerId: l.offerId, day: l.day })) : undefined} />
              )),
              ...docs.map((d) => <DocumentToCheck key={d.id} doc={d} />),
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
                      <a className="link" href={`#jobs/${c.projectId}/crew`}>
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
                        ? o.rateHidden
                          ? 'asks for a different rate'
                          : `asks ${euro(o.counterRateCents)} a day (offered ${rateText(c.dayRateCents, c.rateHidden)})`
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
                  {/* Settling an answer is crew's (audit finding 9): a role without it sees the answer, and nothing to press. */}
                  {!mayCrew ? null : (kind === 'accepted' || kind === 'countered') && turningDown === o.id ? (
                    <Confirm
                      question={
                        kind === 'countered'
                          ? `Say no to ${o.person?.name ?? 'them'}${o.rateHidden ? '' : ` at ${euro(o.counterRateCents)}`}? The offer is withdrawn, and their link says so at once.`
                          : `Release ${o.person?.name ?? 'them'} from ${c.project}? Their place goes back to the call, and their link says so at once.`
                      }
                      yes={kind === 'countered' ? 'Withdraw the offer' : `Release ${o.person ? firstName(o.person) : 'them'}`}
                      no={kind === 'countered' ? 'Keep it open' : 'Keep them'}
                      onYes={() => {
                        setTurningDown(undefined)
                        settle(o, c, 'offer.cancel', kind === 'countered' ? 'withdrawn' : 'released')
                      }}
                      onNo={() => setTurningDown(undefined)}
                    />
                  ) : kind === 'countered' && o.rateHidden ? (
                    // Agreeing a rate is for someone who sees it (ADR 0046): said here, with Say no still to hand.
                    <div className="actions">
                      <p className="hint">The office agrees rates: your role doesn't see them.</p>
                      <button type="button" onClick={() => setTurningDown(o.id)}>
                        Say no
                      </button>
                    </div>
                  ) : kind === 'accepted' || kind === 'countered' ? (
                    <div className="actions">
                      <button type="button" className="primary" onClick={() => settle(o, c, 'offer.confirm', 'confirmed')}>
                        {kind === 'countered' ? `Agree ${euro(o.counterRateCents)}` : 'Confirm'}
                      </button>
                      <button type="button" onClick={() => setTurningDown(o.id)}>
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

      {page === 'calls' && (
        <section className="card">
          <Heading icon="calendar">Crew needed</Heading>
          {upcoming.length === 0 && <Empty>Ask for crew from a job in Jobs, or below.</Empty>}
          {/* Narrowed to a department (ADR 0046), the ones calls are in, and "No department" for the calls nobody has given one. */}
          {upcoming.length > 0 && (callDepts.length > 0 || upcoming.some((c) => !departmentOf(c))) && (
            <select className="dept-filter" value={callsFor} onChange={(e) => setCallsFor(e.target.value)} aria-label="Calls for department">
              <option value="">All departments</option>
              {callDepts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
              {upcoming.some((c) => !departmentOf(c)) && <option value={NO_DEPARTMENT}>No department</option>}
            </select>
          )}
          <div aria-live="polite">{gave && <p className="added">{gave}</p>}</div>
          {callsFor === NO_DEPARTMENT && mayCrew && shownCalls.length > 0 && (
            <GiveDepartment
              view={view}
              calls={shownCalls}
              onGiven={(said, department) => {
                setNarrowedTo(department)
                setGave(said)
              }}
            />
          )}
          {upcoming.length > 0 && shownCalls.length === 0 && <p className="empty">No calls for {callsFor === NO_DEPARTMENT ? 'no department' : callsFor} still to come.</p>}
          {shownCalls.length > 0 && short.length === 0 && (
            <p className="empty">No calls{callsFor ? ` for ${callsFor === NO_DEPARTMENT ? 'no department' : callsFor}` : ''} are short of people: every one still to come is filled.</p>
          )}
          {callGroups(inView, 'short')}
          {/* Filled calls are folded under the ones short of people (audit finding 10), as the archived are under the people: there for a look, out of the way. */}
          {filled.length > 0 && (
            <details className="filled-calls" open={filledOpen} onToggle={(e) => setFilledOpen(e.currentTarget.open)}>
              <summary>
                Show {filled.length} filled {filled.length === 1 ? 'call' : 'calls'}
              </summary>
              {/* Built only once opened: folded, they'd be built for nothing, and a window can't tell what's on a screen it isn't on. */}
              {filledOpen && callGroups(filled, 'filled')}
            </details>
          )}
        </section>
      )}

      {share && <SharePanelFor share={share} onClose={() => setShare(undefined)} />}

      {page === 'calls' && mayCrew && (
        <section className="card">
          <h2>Crew for something not in Jobs</h2>
          <p className="hint">For a job in Jobs, ask for crew from the job, so the crew get its phases, venue and any changes.</p>
          <Fold label="Ask for crew">
            <NewCall />
          </Fold>
        </section>
      )}

      {page === 'people' && <CertificateReminders view={view} />}
      {/* Vehicles' checks running out, listed beside the crew's certificates and documents (ADR 0047). */}
      {page === 'people' && <VehicleReminders view={view} />}

      {page === 'people' && (
        <section className="card" aria-label="People">
          <Heading icon="people">People</Heading>
          <NamedFromAddress view={view} />
          <Refusal error={roster.error} />
          {/* Said where their row was, as the row goes into "Archived" out of sight, with the way back (rule 10). There before it has words, so it's read out. */}
          <div aria-live="polite">
            {archivedNow && people.get(archivedNow.id)?.archived && (
              <p className="added">
                Archived {archivedNow.name}.{' '}
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    const { id } = archivedNow
                    setArchivedNow(undefined)
                    bringBack(id)
                  }}
                >
                  Bring {archivedNow.name} back
                </button>
              </p>
            )}
          </div>
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
                <ArchivedPerson key={p.id} person={p} onBringBack={() => bringBack(p.id)} />
              ))}
            </details>
          )}
          {mayCrew && (
            <Fold label="Add person">
              <NewPerson onAdded={(p) => setAdded((was) => [...was, p])} />
              {/* Read out as it changes, as it's there from the form's opening; not a second "status", which is the top bar's. */}
              <div aria-live="polite">{added.length > 0 && <p className="added">Added {added.at(-1)!.name}.</p>}</div>
            </Fold>
          )}
        </section>
      )}

      {page === 'people' && (
        <p className="hint">
          Freelancers answer from their own private link: no app or login. Send it with an offer by WhatsApp, text or email.
          {people.size > 0 && ' Their bookings also appear in their own calendar if they subscribe from that page.'}
        </p>
      )}
    </div>
  )
}

/**
 * Calls with no department given one, many at a time (ADR 0046): those
 * brought in from the calendar come with none when their people are mixed.
 * Nothing is ticked to start with, as giving every one the same department
 * is rarely right; "Tick all" is there when it is. One command for them all,
 * so the history says it once.
 */
function GiveDepartment({ view, calls, onGiven }: { view: View; calls: readonly CallView[]; onGiven: (said: string, department: string) => void }) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [department, setDepartment] = useState<string | null>(null)
  const { run, error } = useAct()
  // Only calls still shown: one given a department elsewhere leaves the list, and its tick with it.
  const chosen = calls.filter((c) => ticked.has(c.id))
  const tick = (id: string, on: boolean) => setTicked((was) => (on ? new Set([...was, id]) : new Set([...was].filter((x) => x !== id))))
  const give = (e: FormEvent) => {
    e.preventDefault()
    if (!chosen.length || !department) return
    const n = chosen.length
    void run(() => client.mutate('call.department', { ids: chosen.map((c) => c.id), department })).then((ok) => {
      if (!ok) return
      setTicked(new Set())
      // The list moves to the department given, where the calls now are.
      onGiven(`Gave ${n === 1 ? '1 call' : `${n} calls`} ${department}.`, department)
    })
  }
  return (
    <Fold label={calls.length === 1 ? 'Give it a department…' : `Give these ${calls.length} a department…`} className="give-department">
      <form className="grid-form" onSubmit={give} aria-label="Give calls a department">
        <fieldset className="wide ticks">
          <legend>Calls with no department</legend>
          {calls.map((c) => (
            <label key={c.id} className="tick">
              <input type="checkbox" checked={ticked.has(c.id)} onChange={(e) => tick(c.id, e.target.checked)} />
              <span>
                {c.needed} × {c.role} · {c.project}
                <small>{[c.phase, daysLabel(c.days)].filter(Boolean).join(' · ')}</small>
              </span>
            </label>
          ))}
          {calls.length > 1 && (
            <button type="button" className="link start" onClick={() => setTicked(new Set(chosen.length === calls.length ? [] : calls.map((c) => c.id)))}>
              {chosen.length === calls.length ? 'Untick all' : 'Tick all'}
            </button>
          )}
        </fieldset>
        <DepartmentField view={view} value={department} onChange={setDepartment} />
        <Refusal error={error} className="wide" />
        <button type="submit" className="primary wide" disabled={!chosen.length || !department}>
          {!chosen.length ? 'Tick the calls to give it' : !department ? 'Pick a department' : `Give ${chosen.length === 1 ? '1 call' : `${chosen.length} calls`} ${department}`}
        </button>
      </form>
    </Fold>
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
  // Who's on it, with their answer where it isn't yet a booking: "Dara Quinn, Niamh Kelly (offered)".
  const onIt = call.offers.filter((o) => o.person && ON_CALL.includes(o.status))
  const who = onIt
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
        {who && (
          <span className="who-line">
            <Avatars names={onIt.map((o) => o.person!.name)} />
            <span>{who}</span>
          </span>
        )}
      </button>
      {/* The one word at rest on where it stands: a cancelled call kept for the record says so, and a change to it or an offer on it still on its way says that. */}
      <StatusPill tone={!live ? 'cancelled' : filled ? 'confirmed' : 'pending'} pending={call.pending || call.offers.some((o) => o.pending)}>
        {!live
          ? 'Cancelled'
          : filled
            ? 'Filled'
            : heldLabel(call)}
      </StatusPill>
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
            {conflicts.join('. ')}. <b>Offer anyway</b>
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

/** Whether Offer, Send, Tell and Ask open a message to a real person (ADR 0048): off until the office says so under Admin. */
export const usePromptsMessages = () => useView().office.promptMessages

/**
 * In a Send panel's place while messages to crew are off (ADR 0048): what
 * would have opened, for whom, that their link carries it regardless, and
 * where it's turned on. The mode shows itself where it bites, not only on
 * Admin (rule 14).
 */
export function QuietPanel({ names, what, onLink = true, onClose }: { names: readonly string[]; what: string; onLink?: boolean; onClose: () => void }) {
  const admin = useAccess().can('settings')
  const who = names.length === 1 ? names[0] : `${names.length} people`
  return (
    <section className="card share" aria-label={`Messages to crew are off: ${what} for ${who}`}>
      <h2>Messages to crew are off</h2>
      <p className="empty">
        Nothing opened to send {who} the {what}.{onLink ? ` ${names.length === 1 ? 'Their link' : 'Their links'} already say${names.length === 1 ? 's' : ''} so.` : ''} Messages
        are turned on under {admin ? <a href="#admin">Admin</a> : 'Admin, by the office'}.
      </p>
      <button type="button" onClick={onClose}>
        Done
      </button>
    </section>
  )
}

/**
 * Their private link isn't on this device: not made yet (the server makes it
 * when the person first syncs), or not sent to this role (ADR 0046), when
 * the office sends it, and whatever was done is already on their page.
 */
function NoLinkYet({ person, onClose }: { person: Pick<Person, 'name'> & Partial<Pick<Person, 'linkHidden'>>; onClose: () => void }) {
  return (
    <section className="card share">
      <h2>Send to {person.name}</h2>
      <p className="empty">
        {person.linkHidden
          ? `Your role doesn't see ${person.name}'s private link, so the office sends this one. It's already on their page.`
          : 'Their private link is made when this device next syncs. Try again once it says “Up to date”.'}
      </p>
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
  const prompts = usePromptsMessages()
  if (!prompts) return <QuietPanel names={[person.name]} what={message?.('').what ?? 'offer'} onClose={onClose} />
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
  const prompts = usePromptsMessages()
  const to = tell.to[at]
  if (!to) return null
  if (!prompts) return <QuietPanel names={tell.to.map((t) => t.person.name)} what={tellMessage(tell.event, to.person, to.context, '').what} onClose={onClose} />
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

/**
 * One person in the People list: their name and a line of who they are
 * and what's ahead, opening their page (#crew/person/<id>), where
 * everything else about them is.
 */
function PersonRow({ person, crew }: { person: PersonView; crew: CrewView }) {
  const today = useToday()
  const held = crew.calls.flatMap((c) =>
    c.status === 'open' && c.end >= today ? c.offers.filter((o) => o.personId === person.id && (o.status === 'accepted' || o.status === 'confirmed')) : []
  )
  // Booked means confirmed; someone who has said yes is still to confirm.
  const confirmed = held.filter((o) => o.status === 'confirmed').length
  const toConfirm = held.length - confirmed
  const off = crew.unavailability.some((u) => u.personId === person.id && u.end >= today)
  return (
    <div className="row person">
      <a className="who pictured" href={personHref(person.id)}>
        <Avatar name={person.name} />
        <span>
          <b>{person.name}</b>
          <small>
            {[
              // A role set says more than "Staff"; none set is staff crew, which is what "Staff" says (ADR 0034).
              person.kind === 'staff' ? (person.role ? ROLE_LABELS[person.role] : 'Staff') : null,
              person.department,
              levelLine(person.level),
              person.kind === 'staff' && person.approvesLeave ? 'approves time off' : null,
              person.skills.join(', '),
              // A rate this device isn't sent (ADR 0046) isn't said in the list; their page says it's hidden.
              person.dayRateCents !== null && !person.rateHidden ? `${euro(person.dayRateCents)}/day` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            {confirmed > 0 && ` · ${confirmed} booking${confirmed === 1 ? '' : 's'}`}
            {toConfirm > 0 && ` · ${toConfirm} to confirm`}
            {off && ' · has days off'}
          </small>
        </span>
      </a>
      <Pending pending={person.pending} />
    </div>
  )
}

function NewCall() {
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

export function PersonForm({ initial, submitLabel, onSubmit, onDone }: { initial?: PersonView; submitLabel: string; onSubmit: (fields: PersonFields) => Promise<unknown>; onDone?: () => void }) {
  const access = useAccess()
  // Who approves time off is a permission, so it's a director's to give once roles are on (ADR 0034); the form keeps it as it was.
  const mayApprove = access.can('company')
  // The email and type of someone who holds a role are how they sign in as it, so only the office and directors change them (audit finding 12).
  const whoFixed = initial && initial.role && holdsARole(initial) && !access.can('settings') ? initial.role : null
  const people = useView().crew.people
  // A rate this device isn't sent (ADR 0046) isn't in the form, and the server keeps the one it has.
  const seesRates = useSeesRates() && !initial?.rateHidden
  const blank = {
    name: '',
    phone: '',
    email: '',
    skills: [] as string[],
    skillsTyped: '',
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
    skills: p.skills,
    skillsTyped: '',
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
  const set = (k: Exclude<keyof typeof blank, 'approvesLeave' | 'certs' | 'skills' | 'skillsTyped'>) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
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
    const email = f.email.trim() || null
    // Each email is one person's, as the server checks it (audit finding 12).
    const other = sameEmail(email, initial?.email) ? undefined : emailTakenBy(people, initial?.id ?? '', email)
    if (other) return refuse(emailInUseRefusal(other.name))
    void run(() =>
      onSubmit({
        name: f.name.trim(),
        kind: f.kind,
        phone: f.phone.trim() || null,
        email,
        skills: withTyped(f.skills, f.skillsTyped, people),
        ...(seesRates ? { dayRateCents: rate.cents } : {}),
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
        Email <input type="email" value={f.email} onChange={set('email')} readOnly={!!whoFixed} />
      </label>
      <SkillsField
        className="wide"
        value={f.skills}
        onChange={(skills) => setF((was) => ({ ...was, skills }))}
        text={f.skillsTyped}
        onText={(skillsTyped) => setF((was) => ({ ...was, skillsTyped }))}
      />
      {seesRates && (
        <label>
          Usual day rate € <input inputMode="decimal" value={f.rate} onChange={set('rate')} />
        </label>
      )}
      <label>
        Type
        <select value={f.kind} onChange={set('kind')} disabled={!!whoFixed}>
          <option value="freelancer">Freelancer</option>
          <option value="staff">Staff</option>
        </select>
      </label>
      {whoFixed && <p className="hint wide">{whoSignsInRefusal(initial!.name, whoFixed)}</p>}
      {f.kind === 'staff' && mayApprove && (
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

/** A quiet line while anyone brought in from the calendars is still named from their address (audit of 16 October, finding 7). */
function NamedFromAddress({ view }: { view: View }) {
  const mayCrew = useAccess().can('crew')
  const n = view.crew.people.filter(namedFromAddress).length
  // And anyone who looks brought in twice, under two addresses (ADR 0055).
  const twice = useSamePeople(view).length
  if (!mayCrew || (n === 0 && twice === 0)) return null
  const said = [
    twice > 0 && `${twice === 1 ? '1 person looks' : `${twice.toLocaleString('en-IE')} people look`} brought in twice`,
    n > 0 && `${n === 1 ? '1 person is' : `${n.toLocaleString('en-IE')} people are`} still named from their email address`,
  ].filter(Boolean)
  return (
    <p className="hint">
      {said.join(', and ')}. <a href="#jobs/tidy">{twice > 0 ? 'Tidy them up' : 'Give them their names'}</a>
    </p>
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
