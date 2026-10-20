import {
  answersToCheck,
  daysLabel,
  departmentOf,
  euro,
  firstName,
  offerOnCalendar,
  sameDepartment,
  venueLabel,
  type AnswerKind,
  type CallView,
  type JobView,
  type OfferView,
  type PersonView,
  type TellEvent,
  type View,
  emailBackRefusal,
  emailTakenBy,
} from '@sh/shared'
import { VehicleReminders } from '../stock/Vehicles.tsx'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useWindowed } from '../windowed.ts'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Empty } from '../Empty.tsx'
import { Fold, ShowAll } from '../Fold.tsx'
import { Top, useHash } from '../jobs/common.tsx'
import { useAccess } from '../role.ts'
import { rateText } from '../format.ts'
import { callDepartments, DepartmentField } from './Department.tsx'
import { client } from '../sync.ts'
import { useToday, useView } from '../view.ts'
import { CertificateReminders, certificateWarnings } from './Certificates.tsx'
import { DocumentToCheck } from './Documents.tsx'
import { ArchivedPerson } from './Erase.tsx'
import { lateNotesOn, LateRow, lateToNote } from './Late.tsx'
import { LeaveScreen } from './Leave.tsx'
import { PersonScreen } from './PersonScreen.tsx'
import { TimesheetScreen, TimesheetsCard } from './Timesheets.tsx'
import { CrewViews } from './CrewViews.tsx'
import { ImportPeopleScreen } from './ImportPeople.tsx'
import { Heading } from '../Icon.tsx'
import { CallCard, NewCall, OfferForm } from './Calls.tsx'
import { NamedFromAddress, NewPerson, PersonRow, dept, found, wordsOf } from './People.tsx'
import { type Share, SharePanelFor, promptFor, tellTo } from './Messages.tsx'

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
 *
 * The screen is here; a call's card and forms are in Calls.tsx, a person's
 * line and form in People.tsx, and the messages for crew in Messages.tsx.
 */

// The job's page and the call sheet (jobs/) take these from here, as they always have.
export { CallCard } from './Calls.tsx'
export { linkFor, peopleOn, promptFor, SharePanel, SharePanelFor, type Share } from './Messages.tsx'

/** The filter's choice for people with no department. */
const NO_DEPARTMENT = '-'

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
      {/* Calls is Crew's own screen; People and Timesheets are titled by themselves, as every other page is (audit of 18 October). */}
      <Top view={view} title="Crew" root={page === 'calls'} />
      <CrewViews view={view} current={page} />
      {page !== 'calls' && <h1 className="area-title">{page === 'people' ? 'People' : 'Timesheets'}</h1>}

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
