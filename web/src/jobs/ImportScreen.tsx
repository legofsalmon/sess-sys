import {
  addMonths,
  dayLabel,
  importFromDefault,
  isDay,
  jobsAfterNaming,
  KIND_LABELS,
  leftOutLabel,
  PROJECT_KINDS,
  spanLabel,
  type ImportBrought,
  type ImportCalendar,
  type ImportChanged,
  type ImportChoices,
  type ImportJob,
  type ImportPreview,
  type ImportResult,
  type ProjectKind,
  type View,
} from '@sh/shared'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Confirm } from '../act.tsx'
import { AS_LONG_AS_IT_TAKES, ask, post } from '../server.ts'
import { syncSoon } from '../sync.ts'
import { StatusPill } from '../StatusPill.tsx'
import { useToday } from '../view.ts'
import { Top } from './common.tsx'
import { JOBS } from '../Up.tsx'

/**
 * Bringing in the jobs already on a Google calendar (ADR 0011): choose one
 * the connected account can see and a first day, look at what would come
 * in, untick or rename jobs and choose who to add to the crew list, then
 * bring it all in at once. The server reads the calendar, so this needs
 * signal; nothing is written to Google and nobody is emailed.
 */

type Step =
  | { at: 'choose'; problem?: string }
  | { at: 'looking' }
  | { at: 'look'; preview: ImportPreview; problem?: string }
  | { at: 'bringing'; preview: ImportPreview }
  | { at: 'done'; preview: ImportPreview; result: ImportResult }

/** What was unticked, renamed, re-kinded and chosen on a calendar's list, kept while someone goes back to look at another and returns. */
type Picks = { names: Record<string, string>; kinds: Record<string, ProjectKind>; skip: ReadonlySet<string>; people: ReadonlySet<string>; personNames: Record<string, string> }

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IE')} ${n === 1 ? one : many}`

/** "Sat 12 Dec", with the year when it isn't this one. */
function span(s: { start: string; end: string }, year: string) {
  const label = spanLabel(s)
  return s.end.slice(0, 4) === year ? label : `${label} ${s.end.slice(0, 4)}`
}

export function ImportScreen({ view }: { view: View }) {
  const link = view.calendar.link
  const connected = link !== undefined && (link.state === 'on' || link.state === 'choosing')
  const today = useToday()
  const [calendarId, setCalendarId] = useState('')
  const [from, setFrom] = useState(() => importFromDefault(today))
  const [step, setStep] = useState<Step>({ at: 'choose' })
  const picks = useRef(new Map<string, Picks>())
  const heading = useRef<HTMLHeadingElement>(null)
  const offline = view.connection === 'offline'

  // A new step is announced by moving to its heading.
  useEffect(() => heading.current?.focus(), [step.at])

  const look = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!calendarId || !isDay(from)) return
    setStep({ at: 'looking' })
    try {
      const preview = await post<ImportPreview>('/api/calendar/import/look', { calendarId, from }, AS_LONG_AS_IT_TAKES)
      setStep({ at: 'look', preview })
    } catch (err) {
      setStep({ at: 'choose', problem: (err as Error).message })
    }
  }

  const bring = async (preview: ImportPreview, choices: ImportChoices) => {
    setStep({ at: 'bringing', preview })
    try {
      const result = await post<ImportResult>('/api/calendar/import/bring', choices, AS_LONG_AS_IT_TAKES)
      setStep({ at: 'done', preview, result })
    } catch (err) {
      setStep({ at: 'look', preview, problem: (err as Error).message })
    } finally {
      syncSoon()
    }
  }

  return (
    <div className="app crew jobs import">
      <Top view={view} up={{ steps: [JOBS], here: 'Bring in from Google Calendar' }} />
      <header className="title">
        <h1 ref={heading} tabIndex={-1}>
          {step.at === 'done' ? 'Brought in' : 'Bring in from Google Calendar'}
        </h1>
      </header>
      {connected && step.at !== 'done' && (
        <p className="hint step">
          {step.at === 'choose' || step.at === 'looking' ? 'Step 1 of 2: choose a calendar and a day' : 'Step 2 of 2: check what comes in'}
        </p>
      )}

      {!connected ? (
        <section className="card">
          {link?.state === 'reconnect' ? (
            <p>
              Google Calendar needs connecting again on the <a href="#admin">Admin</a> first.
            </p>
          ) : (
            <p>
              Jobs are read from the Google calendars of the account connected on the <a href="#admin">Admin</a>. Connect one there first.
            </p>
          )}
        </section>
      ) : step.at === 'choose' || step.at === 'looking' ? (
        <>
          <Choose
            account={link.account ?? 'The connected account'}
            calendarId={calendarId}
            setCalendarId={setCalendarId}
            from={from}
            setFrom={setFrom}
            looking={step.at === 'looking'}
            offline={offline}
            problem={step.at === 'choose' ? step.problem : undefined}
            onLook={look}
          />
          <Brought offline={offline} />
        </>
      ) : step.at === 'done' ? (
        <Done preview={step.preview} result={step.result} onAgain={() => setStep({ at: 'choose' })} />
      ) : (
        <Look
          preview={step.preview}
          bringing={step.at === 'bringing'}
          offline={offline}
          problem={step.at === 'look' ? step.problem : undefined}
          kept={picks.current.get(`${step.preview.calendar.id}|${step.preview.from}`)}
          onKeep={(kept) => picks.current.set(`${step.preview.calendar.id}|${step.preview.from}`, kept)}
          onBack={() => setStep({ at: 'choose' })}
          onBring={bring}
        />
      )}
    </div>
  )
}

type Loaded = { state: 'loading' } | { state: 'failed'; text: string } | { state: 'ready'; calendars: ImportCalendar[] }

function Choose(p: {
  account: string
  calendarId: string
  setCalendarId: (id: string) => void
  from: string
  setFrom: (day: string) => void
  looking: boolean
  offline: boolean
  problem: string | undefined
  onLook: (e: FormEvent) => void
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const load = () => {
    setLoaded({ state: 'loading' })
    ask<ImportCalendar[]>('/api/calendar/import/calendars').then(
      (calendars) => {
        setLoaded({ state: 'ready', calendars })
        if (!p.calendarId && calendars[0]) p.setCalendarId(calendars[0].id)
      },
      (err: Error) => setLoaded({ state: 'failed', text: err.message })
    )
  }
  useEffect(load, [])

  return (
    <form className="card" onSubmit={p.onLook} aria-label="Calendar to bring in from">
      <p>
        Each all-day event becomes a day of a job, with its place as the venue and its guests as crew. You see everything that would come in,
        and can change it, before anything is saved. Nothing is written to Google, and nobody is emailed.
      </p>
      {loaded.state === 'loading' && <p className="hint">Getting the calendars {p.account} can see…</p>}
      {loaded.state === 'failed' && (
        <>
          <p className="alert">{loaded.text}</p>
          <button type="button" onClick={load}>
            Try again
          </button>
        </>
      )}
      {loaded.state === 'ready' && (
        <fieldset className="choices">
          <legend>Calendar</legend>
          {loaded.calendars.map((c) => (
            <label key={c.id} className="signal">
              <input type="radio" name="calendar" value={c.id} checked={p.calendarId === c.id} onChange={() => p.setCalendarId(c.id)} />
              <span>
                <b>{c.name}</b>
                <small>{c.primary ? `${p.account}'s own calendar` : `Shared with ${p.account}`}</small>
              </span>
            </label>
          ))}
          <p className="hint">Someone else's calendar is here once they share it with {p.account} and it's added under Other calendars in Google.</p>
        </fieldset>
      )}
      <label className="field">
        First day
        <input type="date" value={p.from} onChange={(e) => p.setFrom(e.target.value)} required />
        <small>Everything from this day to two years ahead. Days gone come in too, as the record of who worked: a Yes on the invite is a booking, and the rest is noted.</small>
      </label>
      {p.problem && (
        <p className="alert" role="alert">
          {p.problem}
        </p>
      )}
      {p.offline && <p className="hint">This needs signal: the app reads the calendar from Google.</p>}
      <button type="submit" className="primary" disabled={p.looking || p.offline || !p.calendarId || !isDay(p.from)}>
        {p.looking ? 'Reading the calendar…' : 'Look at the calendar'}
      </button>
    </form>
  )
}

function Look(p: {
  preview: ImportPreview
  bringing: boolean
  offline: boolean
  problem: string | undefined
  kept: Picks | undefined
  onKeep: (picks: Picks) => void
  onBack: () => void
  onBring: (preview: ImportPreview, choices: ImportChoices) => void
}) {
  const { preview } = p
  const year = useToday().slice(0, 4)
  // Back on a calendar and day already looked at, what was unticked, renamed and chosen is as it was left.
  const [names, setNames] = useState<Record<string, string>>(() => ({ ...Object.fromEntries(preview.jobs.map((j) => [j.key, j.name])), ...p.kept?.names }))
  const [kinds, setKinds] = useState<Record<string, ProjectKind>>(() => ({ ...Object.fromEntries(preview.jobs.map((j) => [j.key, j.kind])), ...p.kept?.kinds }))
  const [skip, setSkip] = useState<ReadonlySet<string>>(() => p.kept?.skip ?? new Set())
  const [people, setPeople] = useState<ReadonlySet<string>>(() => p.kept?.people ?? new Set(preview.people.filter((x) => x.suggested).map((x) => x.email)))
  const [personNames, setPersonNames] = useState<Record<string, string>>(() => ({ ...Object.fromEntries(preview.people.map((x) => [x.email, x.name])), ...p.kept?.personNames }))
  const { onKeep } = p
  useEffect(() => {
    onKeep({ names, kinds, skip, people, personNames })
  }, [names, kinds, skip, people, personNames, onKeep])
  // The question before anything is saved, in the bar the button is in.
  const [asking, setAsking] = useState(false)
  const toggle = <T,>(set: ReadonlySet<T>, item: T) => {
    const next = new Set(set)
    if (next.has(item)) next.delete(item)
    else next.add(item)
    return next
  }

  const ticked = preview.jobs.filter((j) => !skip.has(j.key))
  const newJobs = ticked.filter((j) => !j.adds)
  const adding = [...people].filter((e) => preview.people.some((x) => x.email === e))
  const count = jobsAfterNaming(newJobs.map((j) => ({ name: j.name, newName: (names[j.key] ?? j.name).trim() || j.name })))
  const more = ticked.length - newJobs.length
  const what = [count && plural(count, 'job', 'jobs'), more && `more days for ${plural(more, 'job', 'jobs')}`].filter(Boolean).join(' and ')
  const blank = newJobs.find((j) => !(names[j.key] ?? '').trim())
  const unnamed = adding.find((e) => !(personNames[e] ?? '').trim())

  const choices: ImportChoices = {
    calendarId: preview.calendar.id,
    from: preview.from,
    jobs: preview.jobs.map((j) => ({ key: j.key, name: (names[j.key] ?? j.name).trim() || j.name, kind: kinds[j.key] ?? j.kind, include: !skip.has(j.key) })),
    people: preview.people.map((x) => ({ email: x.email, name: (personNames[x.email] ?? x.name).trim() || x.name, include: people.has(x.email) })),
  }
  const told = `Bring in ${what}${adding.length ? `, adding ${plural(adding.length, 'person', 'people')} to the crew list` : ''}?`

  return (
    <>
      <section className="card" aria-label="What was found">
        <p>
          <b>{preview.calendar.name}</b> from {span({ start: preview.from, end: preview.from }, year)}:{' '}
          {preview.jobs.length === 0
            ? `nothing new to bring in from ${plural(preview.events, 'event', 'events')}.`
            : `${plural(preview.jobs.length, 'job', 'jobs')} found in ${plural(preview.events, 'event', 'events')}.`}
        </p>
        <button type="button" className="link" onClick={p.onBack} disabled={p.bringing}>
          Choose another calendar or day
        </button>
      </section>

      {preview.changed.length > 0 && <Changed changed={preview.changed} year={year} />}

      {preview.jobs.length > 0 && (
        <section className="card" aria-label="Jobs found">
          <h2>Jobs</h2>
          <p className="hint">
            Untick any that aren't jobs. Rename one to match another, and they come in as one job. A dry hire, an errand or a meeting comes in with no
            crew call: whoever was on the invite is noted on it.
          </p>
          <ul className="found">
            {preview.jobs.map((j) => (
              <Found
                key={j.key}
                job={j}
                year={year}
                on={!skip.has(j.key)}
                name={names[j.key] ?? j.name}
                kind={kinds[j.key] ?? j.kind}
                onTick={() => setSkip(toggle(skip, j.key))}
                onName={(name) => setNames({ ...names, [j.key]: name })}
                onKind={(kind) => setKinds({ ...kinds, [j.key]: kind })}
              />
            ))}
          </ul>
        </section>
      )}

      {preview.people.length > 0 && (
        <section className="card" aria-label="People not in the app">
          <h2>On the invites, not in the app</h2>
          <p className="hint">
            Ticked ones are added to the crew list, and to the crew of their jobs, under the name shown: change it where Google only had
            their address. Those ticked already have a person's own address (or a sessionhire.com one) and are on a gig; the rest are mostly
            suppliers and clients.
          </p>
          <ul className="found people">
            {preview.people.map((x) => (
              <li key={x.email} className={people.has(x.email) ? 'is-on' : 'is-off'}>
                <div className="tick">
                  <input type="checkbox" checked={people.has(x.email)} onChange={() => setPeople(toggle(people, x.email))} aria-label={`Add ${x.name}`} />
                  <span>
                    <input
                      className="name"
                      value={personNames[x.email] ?? x.name}
                      onChange={(e) => setPersonNames({ ...personNames, [x.email]: e.target.value })}
                      aria-label={`Name for ${x.email}`}
                      maxLength={200}
                      disabled={!people.has(x.email)}
                    />
                    <small>
                      {x.email} · {x.kind === 'staff' ? 'staff' : 'freelancer'} · on {plural(x.jobs, 'job', 'jobs')}
                    </small>
                    {x.needsName && people.has(x.email) && <small className="guess">Named from their address: give them their name.</small>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {preview.leftOut.length > 0 && (
        <section className="card" aria-label="Left out">
          <details>
            <summary>What was left out, and why</summary>
            <ul className="left-out">
              {preview.leftOut.map((l) => (
                <li key={l.reason}>
                  {leftOutLabel(l)}
                  {l.examples.length > 0 && <small>{l.examples.map((t) => `“${t}”`).join(', ')}</small>}
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {preview.jobs.length > 0 && (
        <div className="bring">
          {p.problem && (
            <p className="alert" role="alert">
              {p.problem}
            </p>
          )}
          {blank && <p className="alert">Give {blank.name} a name, or untick it.</p>}
          {!blank && unnamed && <p className="alert">Give {unnamed} a name, or untick them.</p>}
          {p.offline && <p className="hint">This needs signal.</p>}
          {p.bringing && (
            <p className="hint" role="status">
              Saving them all in one go. A whole season takes a little while: keep this page open.
            </p>
          )}
          {asking ? (
            <Confirm
              question={`${told} They can be changed or cancelled afterwards like any other job. Nothing is written to Google, and nobody is emailed.`}
              yes="Bring them in"
              no="Not yet"
              onYes={() => {
                setAsking(false)
                p.onBring(preview, choices)
              }}
              onNo={() => setAsking(false)}
            />
          ) : (
            <button
              type="button"
              className="primary"
              disabled={p.bringing || p.offline || ticked.length === 0 || blank !== undefined || unnamed !== undefined}
              onClick={() => setAsking(true)}
            >
              {p.bringing ? 'Bringing in…' : ticked.length === 0 ? 'Nothing ticked' : `Bring in ${what}`}
            </button>
          )}
        </div>
      )}
    </>
  )
}

/** One job found, to tick, rename and say what kind it is. */
function Found(p: {
  job: ImportJob
  year: string
  on: boolean
  name: string
  kind: ProjectKind
  onTick: () => void
  onName: (name: string) => void
  onKind: (kind: ProjectKind) => void
}) {
  const { job: j } = p
  const gig = p.kind === 'gig'
  const crew = [
    j.crew.booked && `${j.crew.booked} booked`,
    j.crew.waiting && `${j.crew.waiting} not answered`,
    j.crew.declined && `${j.crew.declined} said no`,
    j.crew.noted && `${j.crew.noted} on days gone, noted`,
  ].filter(Boolean)
  const guessed = j.phases.filter((ph) => ph.guessed)
  const guessedName = guessed[0]?.name ?? 'Show'
  return (
    <li className={p.on ? 'is-on' : 'is-off'}>
      <div className="head">
        <input type="checkbox" checked={p.on} onChange={p.onTick} aria-label={`Bring in ${j.name}`} />
        {j.adds ? (
          <b>{j.adds.name}</b>
        ) : (
          <input className="name" value={p.name} onChange={(e) => p.onName(e.target.value)} aria-label={`Name for ${j.name}`} maxLength={200} disabled={!p.on} />
        )}
        <StatusPill tone={j.status === 'confirmed' ? 'confirmed' : 'pending'}>{j.status === 'confirmed' ? 'Confirmed' : 'Pencilled in'}</StatusPill>
      </div>
      <p>
        {span(j, p.year)}
        {j.venue && (
          <>
            {' · '}
            {j.venue.name}
            {j.venue.isNew && <span className="muted"> (new venue)</span>}
          </>
        )}
      </p>
      {j.adds ? (
        <p>More days for the job brought in before{j.kind !== 'gig' ? `, a ${KIND_LABELS[j.kind].toLowerCase()}` : ''}.</p>
      ) : (
        <label className="kind">
          Kind
          <select value={p.kind} onChange={(e) => p.onKind(e.target.value as ProjectKind)} disabled={!p.on} aria-label={`Kind of ${j.name}`}>
            {PROJECT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="phases">
        {j.phases.map((ph, i) => (
          <span key={`${ph.name} ${ph.start}`}>
            {i > 0 && ', '}
            {ph.guessed && !j.adds ? guessedPhase(p.kind) : ph.name} {ph.start === ph.end ? dayLabel(ph.start) : spanLabel(ph)}
            {ph.note && ` (${ph.note})`}
            {ph.venue && ` at ${ph.venue}`}
            {ph.extends && ' (adding to it)'}
          </span>
        ))}
      </p>
      {guessed.length > 0 && (
        <p className="guess">
          No phase in the title, so {guessedName === 'Show' && gig ? 'it comes in as a Show' : `its days come in as ${guessedPhase(p.kind)}`}. Change
          it on the job afterwards if not.
        </p>
      )}
      <p>
        {gig ? 'Crew: ' : 'On the invites: '}
        {crew.length ? crew.join(', ') : gig ? 'nobody on the invites' : 'nobody'}
        {j.crew.notInApp > 0 && <span className="muted"> ({j.crew.notInApp} not in the app yet)</span>}
        {!gig && crew.length > 0 && <span className="muted"> (noted on the job, not booked)</span>}
        {j.phases.some((ph) => ph.sheet) && ' · job sheet in the notes'}
      </p>
    </li>
  )
}

/** The phase a day of a job is, when its title has no phase word: a Show for a gig, and the kind's own day otherwise. The server says the same. */
const guessedPhase = (kind: ProjectKind) => ({ gig: 'Show', hire: 'Hire', errand: 'Errand', meeting: 'Meeting' })[kind]

type BroughtState =
  | { state: 'loading' }
  | { state: 'failed'; text: string }
  | { state: 'ready'; brought: ImportBrought; problem?: string }
  | { state: 'taking'; brought: ImportBrought }
  | { state: 'taken'; text: string }

/**
 * What the bring-ins so far put in the app, and a way to take it all back
 * so it can come in again with corrections (ADR 0037): one go, recorded in
 * the history, refused once anyone has acted on those jobs in the app.
 */
function Brought({ offline }: { offline: boolean }) {
  const [s, setS] = useState<BroughtState>({ state: 'loading' })
  const [asking, setAsking] = useState(false)
  const load = () => {
    setS({ state: 'loading' })
    ask<ImportBrought>('/api/calendar/import/brought').then(
      (brought) => setS({ state: 'ready', brought }),
      (err: Error) => setS({ state: 'failed', text: err.message })
    )
  }
  useEffect(load, [])
  if (s.state === 'loading' || s.state === 'failed') return null
  if (s.state === 'taken')
    return (
      <section className="card" aria-label="Taken back">
        <p role="status">{s.text}</p>
      </section>
    )
  if (s.state === 'ready' && s.brought.jobs === 0) return null
  const b = s.state === 'ready' || s.state === 'taking' ? s.brought : undefined
  const take = async () => {
    if (!b) return
    setAsking(false)
    setS({ state: 'taking', brought: b })
    try {
      const done = await post<Omit<ImportBrought, 'blocked'>>('/api/calendar/import/take-back', {}, AS_LONG_AS_IT_TAKES)
      setS({ state: 'taken', text: `Taken back: ${plural(done.jobs, 'job', 'jobs')}, ${plural(done.days, 'day', 'days')} and ${plural(done.crew, 'crew booking or offer', 'crew bookings and offers')}${done.people ? `, and ${plural(done.people, 'person', 'people')} added from the invites` : ''}. Look at the calendar again to bring it in afresh.` })
    } catch (err) {
      // The card stays, saying what went wrong, so it can be tried again.
      setS({ state: 'ready', brought: b, problem: (err as Error).message })
    } finally {
      syncSoon()
    }
  }
  return (
    <section className="card" aria-label="Brought in so far">
      <h2>Brought in so far</h2>
      {b && (
        <p>
          {plural(b.jobs, 'job', 'jobs')} over {plural(b.days, 'day', 'days')}, with {plural(b.crew, 'crew booking or offer', 'crew bookings and offers')}, from{' '}
          {b.calendars.join(' and ')}
          {b.people > 0 && `, and ${plural(b.people, 'person', 'people')} added from the invites`}.
        </p>
      )}
      {b?.blocked ? (
        <p className="hint">{b.blocked}</p>
      ) : (
        <p className="hint">
          If the first bring-in got things wrong (what kind of job, who was crew, people's names), take it all back and bring the calendars in again
          from the first day. Nothing is written to Google, and nobody is emailed.
        </p>
      )}
      {s.state === 'ready' && s.problem && (
        <p className="alert" role="alert">
          {s.problem}
        </p>
      )}
      {b && !b.blocked && (
        asking ? (
          <Confirm
            question={`Take back ${plural(b.jobs, 'job', 'jobs')}, their crew bookings and offers${b.people ? ` and ${plural(b.people, 'person', 'people')} added from the invites` : ''}? Anything changed on those jobs in the app goes with them. The history keeps a record.`}
            yes="Take it all back"
            no="Keep it"
            onYes={take}
            onNo={() => setAsking(false)}
          />
        ) : (
          <button type="button" disabled={s.state === 'taking' || offline} onClick={() => setAsking(true)}>
            {s.state === 'taking' ? 'Taking back…' : 'Take it all back'}
          </button>
        )
      )}
    </section>
  )
}

/** Events brought in before that have since been deleted or moved in Google: the office changes the job to match. */
function Changed({ changed, year }: { changed: ImportChanged[]; year: string }) {
  return (
    <section className="card attention" aria-label="Changed in Google">
      <h2>Changed in Google since</h2>
      <p className="hint">These were brought in before and have changed on the calendar since. Change the job to match, if they should.</p>
      <ul className="found">
        {changed.map((c) => (
          <li key={`${c.jobId} ${c.title} ${c.was[0]}`}>
            <a href={`#jobs/${encodeURIComponent(c.jobId)}`}>{c.job}</a>
            <p>
              “{c.title}”, {span({ start: c.was[0]!, end: c.was.at(-1)! }, year)}:{' '}
              {c.now.length === 0 ? 'no longer on the calendar' : `now ${span({ start: c.now[0]!, end: c.now.at(-1)! }, year)}`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Done({ preview, result, onAgain }: { preview: ImportPreview; result: ImportResult; onAgain: () => void }) {
  const brought = [result.jobs && plural(result.jobs, 'job', 'jobs'), result.added && `more days for ${plural(result.added, 'job', 'jobs')}`].filter(Boolean)
  const also = [
    result.crew && plural(result.crew, 'crew booking or offer', 'crew bookings and offers'),
    result.people && plural(result.people, 'new person', 'new people'),
    result.venues && plural(result.venues, 'new venue', 'new venues'),
  ].filter(Boolean)
  const today = useToday()
  const first = preview.jobs.map((j) => j.start).sort()[0] ?? today
  return (
    <section className="card" aria-label="Brought in">
      {brought.length ? (
        <p role="status">
          Brought in {brought.join(' and ')} from <b>{preview.calendar.name}</b>: {plural(result.days, 'day', 'days')}
          {also.length ? `, ${also.join(', ')}` : ''}.
        </p>
      ) : (
        <p role="status">Nothing was brought in: the calendar changed since it was read.</p>
      )}
      {result.missing.length > 0 && (
        <p className="alert">
          Not on the calendar any more, so not brought in: {result.missing.join(', ')}. Look again to see it as it is now.
        </p>
      )}
      <div className="actions">
        <a className="button primary" href={`#jobs/plan/month/${addMonths(first, 0)}`}>
          See them in the planner
        </a>
        <a className="button" href="#jobs">
          All jobs
        </a>
        <button type="button" onClick={onAgain}>
          Look at another calendar
        </button>
      </div>
    </section>
  )
}
