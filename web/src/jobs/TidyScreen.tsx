import {
  clientWords,
  samePeople,
  joinedPhaseName,
  jobsNaming,
  namedFromAddress,
  nameKey,
  newId,
  plural,
  sameJobs,
  spanLabel,
  tailOf,
  venueGuesses,
  withCapital,
  type JobView,
  type PersonView,
  type SameJob,
  type TidyJob,
  type View,
} from '@sh/shared'
import { useMemo, useState, type FormEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { SamePeople } from '../crew/Combine.tsx'
import { Empty } from '../Empty.tsx'
import { ShowAll } from '../Fold.tsx'
import { Heading } from '../Icon.tsx'
import { useAccess } from '../role.ts'
import { client } from '../sync.ts'
import { JOBS, type Step } from '../Up.tsx'
import { Top } from './common.tsx'

/**
 * Tidy up what came in (ADR 0050): what a bring-in from Google Calendar
 * couldn't tell, found in the jobs and people already in the app (audit of
 * 16 October 2026, findings 5, 7, 8 and 15), for the office to put right a
 * group at a time. Nothing changes until someone chooses: each section
 * suggests, and its button sends the ordinary changes (a job made part of
 * another, a name, a venue, a client), each in the history.
 */

export const TIDY: Step = { href: '#jobs/tidy', label: 'Tidy up' }

const tidyJob = (j: JobView): TidyJob => ({ ...j, phaseVenues: j.phases.map((p) => p.venueId) })
const whenOf = (j: TidyJob) => (j.span ? spanLabel(j.span) : 'No dates yet')

/** Everything the page would suggest, worked out once per change of the data. */
export function useTidy(view: View) {
  return useMemo(() => {
    const jobs = view.jobs.jobs.map(tidyJob)
    return {
      same: sameJobs(jobs),
      // The same person brought in twice (ADR 0055), before naming anyone: combining may give them their name.
      twice: samePeople(view.crew.people),
      people: view.crew.people.filter(namedFromAddress),
      venues: venueGuesses(jobs, view.jobs.venues),
      words: clientWords(jobs, { clients: view.jobs.clients, venues: view.jobs.venues }).slice(0, 12),
      small: view.jobs.jobs.filter((j) => withCapital(j.name) !== j.name),
    }
  }, [view.jobs, view.crew.people])
}

/** How much there is to tidy, for the line on Jobs and Crew. */
export function tidyCount(t: ReturnType<typeof useTidy>) {
  return t.same.length + t.twice.length + t.people.length + t.venues.length + t.small.length
}

/** On Jobs, once a calendar has been brought in and there's something to tidy. */
export function TidyNudge({ view }: { view: View }) {
  const t = useTidy(view)
  const mayJobs = useAccess().can('jobs')
  if (!mayJobs || !view.jobs.jobs.some((j) => j.sourceCalendar)) return null
  const parts = [
    t.same.length && plural(t.same.length, 'job', 'jobs') + ' brought in as several',
    t.twice.length && plural(t.twice.length, 'person', 'people') + ' brought in twice',
    t.people.length && plural(t.people.length, 'person', 'people') + ' named from their address',
    t.venues.length && plural(t.venues.length, 'venue', 'venues') + ' to put on jobs',
  ].filter(Boolean)
  if (!parts.length) return null
  return (
    <section className="card notes-kit-nudge" aria-label="Tidy up what came in">
      <Heading icon="calendar">Tidy up what came in</Heading>
      <p>
        From the calendars: {parts.join(', ')}. <a href="#jobs/tidy">Tidy them up</a>
      </p>
    </section>
  )
}

export function TidyScreen({ view }: { view: View }) {
  const t = useTidy(view)
  const access = useAccess()
  const nothing = tidyCount(t) === 0 && t.words.length === 0
  return (
    <div className="app crew jobs import tidy">
      <Top view={view} up={{ steps: [JOBS], here: TIDY.label }} />
      <section className="card intro">
        <header className="title">
          <h1>Tidy up what came in</h1>
        </header>
        <p className="hint">
          What the calendars couldn't say, found in the jobs and people already in the app. Nothing changes until you choose, and each change is in the history like any
          other.
        </p>
        {nothing && (
          <Empty>Nothing to tidy: no job or person looks brought in twice, everyone has a name, and no venue or client is waiting to be put on a job.</Empty>
        )}
      </section>
      {access.can('jobs') && t.same.length > 0 && <SameJobs view={view} groups={t.same} />}
      {/* Always there for crew, so what it combined stays said once the last pair has gone. */}
      {access.can('crew') && <SamePeople view={view} groups={t.twice} />}
      {access.can('crew') && t.people.length > 0 && <Names people={t.people} />}
      {access.can('jobs') && t.venues.length > 0 && <Venues guesses={t.venues} />}
      {access.can('jobs') && <Clients view={view} words={t.words} />}
      {access.can('jobs') && t.small.length > 0 && <Capitals jobs={t.small} />}
    </div>
  )
}

/** Jobs a calendar had as several: one group at a time, each made one job with a press and a question. */
function SameJobs({ view, groups }: { view: View; groups: readonly SameJob[] }) {
  return (
    <section className="card" aria-label="The same job, brought in as several">
      <Heading icon="calendar">The same job, brought in as several</Heading>
      <p className="hint">
        A calendar with a day for each department or stage ("EP - LX", "EP - Audio") came in as a job for each. Tick the ones that are one job, name it, and make it
        one: their days, crew, kit and notes go onto it, each day named for what its title said.
      </p>
      <ShowAll items={groups} limit={6} what="groups">
        {(shown) => (
          <ul className="found">
            {shown.map((g) => (
              <SameJobGroup key={g.key} view={view} group={g} />
            ))}
          </ul>
        )}
      </ShowAll>
    </section>
  )
}

function SameJobGroup({ view, group }: { view: View; group: SameJob }) {
  const [name, setName] = useState(group.name)
  // Sure groups start ticked: the one action is still a press and a question away.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(group.sure ? group.jobs.map((j) => j.id) : []))
  const [asking, setAsking] = useState(false)
  const [done, setDone] = useState('')
  const { run, error, refuse } = useAct()
  const chosen = group.jobs.filter((j) => ticked.has(j.id))
  const quoted = (j: TidyJob) => view.money.quotesOf(j.id).length > 0
  // The job kept: the one with a quote, or the one already called that, or the first.
  const into = chosen.find(quoted) ?? chosen.find((j) => nameKey(j.name) === nameKey(name)) ?? chosen[0]
  const days = chosen.flatMap((j) => {
    const phases = view.jobs.jobs.find((x) => x.id === j.id)?.phases ?? []
    return phases.map((p) => joinedPhaseName(p.name, tailOf(j.name, name), j.kind))
  })
  const shownDays = [...new Set(days)]

  const ask = () => {
    if (chosen.length < 2) return refuse('Tick at least two jobs to make them one.')
    if (!name.trim()) return refuse('Give the job a name.')
    setAsking(true)
  }
  const merge = () => {
    setAsking(false)
    if (!into) return
    const from = chosen.filter((j) => j.id !== into.id).map((j) => j.id)
    void run(() => client.mutate('project.merge', { id: into.id, from, name: name.trim() })).then((ok) => ok && setDone(`Made ${plural(chosen.length, 'job')} one: ${name.trim()}.`))
  }

  if (done)
    return (
      <li>
        <p className="added" role="status">
          {done} <a href={`#jobs/${encodeURIComponent(into?.id ?? '')}`}>Open it</a>
        </p>
      </li>
    )
  return (
    <li className="is-on">
      <label className="kind">
        One job called
        <input className="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} aria-label={`Name for ${group.name} as one job`} />
      </label>
      <ul className="found people">
        {group.jobs.map((j) => (
          <li key={j.id} className={ticked.has(j.id) ? 'is-on' : 'is-off'}>
            <label className="tick">
              <input
                type="checkbox"
                checked={ticked.has(j.id)}
                onChange={() => {
                  const next = new Set(ticked)
                  if (!next.delete(j.id)) next.add(j.id)
                  setTicked(next)
                }}
              />
              <span>
                <b>{j.name}</b>
                <small>{whenOf(j)}</small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {chosen.length >= 2 && <p>Its days: {shownDays.slice(0, 12).join(', ') + (shownDays.length > 12 ? ` and ${shownDays.length - 12} more` : '')}</p>}
      <Refusal error={error} />
      {asking ? (
        <Confirm question={`Make ${plural(chosen.length, 'job')} one job, ${name.trim()}?`} yes="Make it one job" no="Not now" onYes={merge} onNo={() => setAsking(false)}>
          <p>
            Their days, crew, kit, vans and notes go onto {into?.name}, which is renamed {name.trim()}; the other {plural(chosen.length - 1, 'job')} {chosen.length === 2 ? 'is' : 'are'}{' '}
            removed. Anyone booked stays booked. It can't be split again in one go: each day can be moved to a new job by hand.
          </p>
        </Confirm>
      ) : (
        <div className="actions">
          <button type="button" className="primary" onClick={ask} disabled={chosen.length < 2}>
            Make {plural(chosen.length, 'job')} one
          </button>
        </div>
      )}
    </li>
  )
}

/** People named from their address: a name to type for each, saved one at a time. */
function Names({ people }: { people: readonly PersonView[] }) {
  return (
    <section className="card" aria-label="People named from their address">
      <Heading icon="person">People named from their address</Heading>
      <p className="hint">
        Google had no name for these guests, so they're named from their email. That name is what call sheets, the planner and their own page show. Type the name
        they go by.
      </p>
      <ShowAll items={people} limit={10} what="people">
        {(shown) => (
          <ul className="found people">
            {shown.map((p) => (
              <NameRow key={p.id} person={p} />
            ))}
          </ul>
        )}
      </ShowAll>
    </section>
  )
}

function NameRow({ person }: { person: PersonView }) {
  const [name, setName] = useState('')
  const { run, error, refuse } = useAct()
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return refuse('Type their name first.')
    const { id, kind, email, phone, skills, notes } = person
    void run(() => client.mutate('person.upsert', { id, name: name.trim(), kind, email, phone, skills, notes }))
  }
  return (
    <li>
      <form className="tick" onSubmit={save} aria-label={`Name for ${person.email}`}>
        <span>
          <input className="name" value={name} placeholder={person.name} onChange={(e) => setName(e.target.value)} maxLength={200} aria-label={`Name for ${person.email}`} />
          <small>
            {person.email} · {person.kind === 'staff' ? 'staff' : 'freelancer'}
          </small>
          <Refusal error={error} />
        </span>
        <button type="submit">Save</button>
      </form>
    </li>
  )
}

/** Venues found in job names, to tick and put on the jobs. */
function Venues({ guesses }: { guesses: ReturnType<typeof venueGuesses> }) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [done, setDone] = useState('')
  const { run, error } = useAct()
  const chosen = guesses.filter((g) => ticked.has(g.job.id))
  const give = () => {
    const n = chosen.length
    void run(async () => {
      for (const g of chosen) await client.mutate('project.update', { id: g.job.id, venueId: g.venue.id })
    }).then((ok) => {
      if (!ok) return
      setTicked(new Set())
      setDone(`Gave ${plural(n, 'job')} their venue. Each can be changed on its job.`)
    })
  }
  return (
    <section className="card" aria-label="Venues in job names">
      <Heading icon="venue">Venues in job names</Heading>
      <p className="hint">Jobs with no venue whose name has one the app knows in it ("Real events button factory"), or whose others of the same name were at one.</p>
      {done && (
        <p className="added" role="status">
          {done}
        </p>
      )}
      <ShowAll items={guesses} limit={10} what="jobs">
        {(shown) => (
          <ul className="found people">
            {shown.map((g) => (
              <li key={g.job.id} className={ticked.has(g.job.id) ? 'is-on' : 'is-off'}>
                <label className="tick">
                  <input
                    type="checkbox"
                    checked={ticked.has(g.job.id)}
                    onChange={() => {
                      const next = new Set(ticked)
                      if (!next.delete(g.job.id)) next.add(g.job.id)
                      setTicked(next)
                    }}
                  />
                  <span>
                    <b>{g.job.name}</b>
                    <small>
                      {g.venue.name} · {g.why === 'name' ? 'in its name' : 'where the others of that name were'} · {whenOf(g.job)}
                    </small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </ShowAll>
      <Refusal error={error} />
      <div className="actions">
        <button type="button" onClick={() => setTicked(new Set(guesses.map((g) => g.job.id)))} disabled={ticked.size === guesses.length}>
          Tick all {guesses.length}
        </button>
        <button type="button" className="primary" onClick={give} disabled={chosen.length === 0}>
          Give {plural(chosen.length, 'job')} {chosen.length === 1 ? 'its' : 'their'} venue
        </button>
      </div>
    </section>
  )
}

/** A client for every job whose name has a word in it: the word, the client, the jobs to tick. */
function Clients({ view, words }: { view: View; words: readonly { word: string; jobs: number }[] }) {
  const [word, setWord] = useState('')
  const [who, setWho] = useState('')
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set())
  const [done, setDone] = useState('')
  const { run, error, refuse } = useAct()
  const jobs = useMemo(() => jobsNaming(view.jobs.jobs.map(tidyJob), word), [view.jobs.jobs, word])
  const chosen = jobs.filter((j) => !unticked.has(j.id))
  const pick = (w: string) => {
    setWord(w)
    setWho(view.jobs.clients.find((c) => nameKey(c.name) === nameKey(w))?.name ?? w)
    setUnticked(new Set())
    setDone('')
  }
  const give = (e: FormEvent) => {
    e.preventDefault()
    const name = who.trim()
    if (!name) return refuse("Type the client's name.")
    if (chosen.length === 0) return refuse('No job is ticked.')
    const known = view.jobs.clients.find((c) => nameKey(c.name) === nameKey(name))
    const n = chosen.length
    void run(async () => {
      const id = known?.id ?? newId()
      if (!known) await client.mutate('client.upsert', { id, name, contacts: [], notes: '' })
      for (const j of chosen) await client.mutate('project.update', { id: j.id, clientId: id })
    }).then((ok) => {
      if (!ok) return
      setDone(`Gave ${plural(n, 'job')} the client ${name}.`)
      setWord('')
      setWho('')
    })
  }
  return (
    <section className="card" aria-label="Clients from job names">
      <Heading icon="company">Clients from job names</Heading>
      <p className="hint">
        The calendars put the client in the title ("Joanna verve KPMG"). Pick a word, or type one, and the client it stands for: every job without a client whose name has
        the word is listed to tick.
      </p>
      {words.length > 0 && (
        <div className="filters" role="group" aria-label="Words in many job names">
          {words.map((w) => (
            <button key={w.word} type="button" aria-pressed={nameKey(word) === nameKey(w.word)} onClick={() => pick(w.word)}>
              {w.word} ({w.jobs})
            </button>
          ))}
        </div>
      )}
      {done && (
        <p className="added" role="status">
          {done}
        </p>
      )}
      <form className="grid-form" onSubmit={give} aria-label="Give jobs a client">
        <label>
          Word in the name
          <input value={word} onChange={(e) => (setWord(e.target.value), setUnticked(new Set()))} placeholder="verve" />
        </label>
        <label>
          Client
          <input value={who} onChange={(e) => setWho(e.target.value)} list="tidy-clients" placeholder="Verve" maxLength={200} />
          <datalist id="tidy-clients">
            {view.jobs.clients.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </label>
        {word.trim() && (
          <div className="wide">
            {jobs.length === 0 ? (
              <p className="hint">No job without a client has "{word.trim()}" in its name.</p>
            ) : (
              <ShowAll items={jobs} limit={10} what="jobs">
                {(shown) => (
                  <ul className="found people">
                    {shown.map((j) => (
                      <li key={j.id} className={unticked.has(j.id) ? 'is-off' : 'is-on'}>
                        <label className="tick">
                          <input
                            type="checkbox"
                            checked={!unticked.has(j.id)}
                            onChange={() => {
                              const next = new Set(unticked)
                              if (!next.delete(j.id)) next.add(j.id)
                              setUnticked(next)
                            }}
                          />
                          <span>
                            <b>{j.name}</b>
                            <small>{whenOf(j)}</small>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </ShowAll>
            )}
          </div>
        )}
        <Refusal error={error} className="wide" />
        <div className="actions wide">
          <button type="submit" className="primary" disabled={!word.trim() || chosen.length === 0}>
            Give {plural(chosen.length, 'job')} the client {who.trim() || '…'}
          </button>
        </div>
      </form>
    </section>
  )
}

/** Names typed with a small first letter: a capital for each, in one go. */
function Capitals({ jobs }: { jobs: readonly JobView[] }) {
  const [asking, setAsking] = useState(false)
  const { run, error } = useAct()
  const fix = () => {
    setAsking(false)
    void run(async () => {
      for (const j of jobs) await client.mutate('project.update', { id: j.id, name: withCapital(j.name) })
    })
  }
  return (
    <section className="card" aria-label="Names starting with a small letter">
      <Heading icon="edit">Names starting with a small letter</Heading>
      <p className="hint">Typed quickly into a calendar ("cms uplighter shop hire"). Only the first letter changes; the rest stays as typed.</p>
      <ShowAll items={jobs} limit={5} what="jobs">
        {(shown) => (
          <ul className="found">
            {shown.map((j) => (
              <li key={j.id}>
                <p>
                  {j.name} → <b>{withCapital(j.name)}</b>
                </p>
              </li>
            ))}
          </ul>
        )}
      </ShowAll>
      <Refusal error={error} />
      {asking ? (
        <Confirm question={`Start ${plural(jobs.length, 'job')}' names with a capital?`} yes="Give them capitals" no="Not now" onYes={fix} onNo={() => setAsking(false)}>
          <p>Each is a change to its job, in the history, and can be renamed again on its job.</p>
        </Confirm>
      ) : (
        <div className="actions">
          <button type="button" className="primary" onClick={() => setAsking(true)}>
            Start {plural(jobs.length, 'name')} with a capital
          </button>
        </div>
      )}
    </section>
  )
}
