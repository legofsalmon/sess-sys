import { deviceWords, historyDays, historyTime, runLabel, waitLabel, type HistoryEntry, type HistoryPage, type HistoryRun } from '@sh/shared'
import { useEffect, useMemo, useRef, useState } from 'react'
import { markSignedOut, useAuth } from './auth.ts'
import { Empty } from './Empty.tsx'
import { MadeUp } from './jobs/common.tsx'
import { useNotDone } from './problems.tsx'
import { useToday, useView } from './view.ts'

/**
 * The history (ADR 0006): who did what, when, on which device, whether it
 * was made offline, and what the server turned down. Newest first, 50 at a
 * time, for everyone or one person, under the Irish day the server took it
 * on, with one person's changes one after another as one line that opens
 * on a tap (shared/src/history.ts). It stays on the server rather than on
 * every phone, so it needs signal.
 */

const base = import.meta.env.VITE_API_BASE ?? ''

type Person = { key: string; name: string }
type Loaded = { state: 'loading' } | { state: 'offline' } | { state: 'ready'; entries: HistoryEntry[]; next?: string }

async function fetchPage(who: string, before?: string): Promise<HistoryPage | undefined> {
  const query = new URLSearchParams({ limit: '50', ...(who ? { who } : {}), ...(before ? { before } : {}) })
  const res = await fetch(`${base}/api/history?${query}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
  if (res.status === 401) {
    markSignedOut()
    return undefined
  }
  if (!res.ok) throw new Error(`Server answered ${res.status}`)
  return (await res.json()) as HistoryPage
}

export function HistoryScreen() {
  const view = useView()
  const today = useToday()
  const auth = useAuth()
  const notDone = useNotDone(view)
  const [who, setWho] = useState('')
  const [people, setPeople] = useState<Person[]>([])
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [older, setOlder] = useState<'idle' | 'loading' | 'failed'>('idle')
  // Runs opened, by their newest change, which stays the same as older pages join them.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  // Answers to an earlier choice of person arrive late sometimes; only the latest request's answer counts.
  const latest = useRef(0)

  const refresh = async () => {
    const request = ++latest.current
    setLoaded({ state: 'loading' })
    setOlder('idle')
    setOpen(new Set())
    try {
      const page = await fetchPage(who)
      if (!page || request !== latest.current) return
      if (page.people) setPeople(page.people)
      setLoaded({ state: 'ready', entries: page.entries, next: page.next })
    } catch {
      if (request === latest.current) setLoaded({ state: 'offline' })
    }
  }
  useEffect(() => void refresh(), [who])

  const showOlder = async () => {
    if (loaded.state !== 'ready' || !loaded.next) return
    const request = ++latest.current
    setOlder('loading')
    try {
      const page = await fetchPage(who, loaded.next)
      if (!page || request !== latest.current) return
      setLoaded({ state: 'ready', entries: [...loaded.entries, ...page.entries], next: page.next })
      setOlder('idle')
    } catch {
      if (request === latest.current) setOlder('failed')
    }
  }

  const entries = loaded.state === 'ready' ? loaded.entries : undefined
  // Every page loaded so far, grouped as one, so a day or a run "Show older" cut in two joins up again. `today` moves "Today" on at midnight.
  const days = useMemo(() => (entries ? historyDays(entries) : []), [entries, today])
  const nameless = entries?.some((e) => e.who.kind === 'unknown') ?? false
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const staff = people.filter((p) => p.key.startsWith('user:'))
  const onLinks = people.filter((p) => p.key.startsWith('link:'))

  return (
    <div className="app history">
      <header className="top">
        <div className="brand">
          <span className="mark">SH</span>
          <span>
            <b>Session Hire</b>
            <small>
              History
              <MadeUp view={view} />
            </small>
          </span>
        </div>
        <div className="state">{notDone.count}</div>
        {notDone.list}
      </header>

      <section className="card">
        <label className="field">
          Whose changes
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone's</option>
            {staff.length > 0 && (
              <optgroup label="Staff">
                {staff.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
            {onLinks.length > 0 && (
              <optgroup label="Freelancers">
                {onLinks.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        {/* Said once here rather than as "Someone" on every line (ADR 0006, amended). */}
        {nameless && (
          <p className="hint">
            {auth.status === 'signed-in'
              ? "Changes made while sign-in was off have no names, so they're grouped by the device they came from."
              : 'Names show once sign-in is on. Until then, changes are grouped by the device they came from.'}
          </p>
        )}

        {loaded.state === 'loading' && <p className="hint">Getting the history…</p>}
        {loaded.state === 'offline' && (
          <>
            <p className="hint">The history needs signal: it's kept on the server, not on this device.</p>
            <button type="button" onClick={refresh}>
              Try again
            </button>
          </>
        )}
        {loaded.state === 'ready' && loaded.entries.length === 0 && (
          <Empty>Every change anyone makes shows up here, with who made it and when.</Empty>
        )}
      </section>

      {days.map((d) => (
        <section className="card day" key={d.day} aria-labelledby={`day-${d.day}`}>
          <h2 id={`day-${d.day}`}>{d.label}</h2>
          <ol className="entries">
            {d.runs.map((r) =>
              r.entries.length === 1 ? (
                <Entry key={r.id} entry={r.entries[0]!} day={d.day} />
              ) : (
                <Run key={r.id} run={r} day={d.day} open={open.has(r.id)} onToggle={() => toggle(r.id)} />
              )
            )}
          </ol>
        </section>
      ))}

      {loaded.state === 'ready' && (loaded.next || older === 'failed' || loaded.entries.length > 0) && (
        <div className="older">
          {loaded.next && (
            <button type="button" onClick={showOlder} disabled={older === 'loading'}>
              {older === 'loading' ? 'Getting more…' : 'Show older'}
            </button>
          )}
          {older === 'failed' && (
            <p className="alert" role="alert">
              Couldn't reach the server. Try again when you have signal.
            </p>
          )}
          {!loaded.next && <p className="hint">That's the start of the history.</p>}
        </div>
      )}
    </div>
  )
}

/**
 * One person's changes one after another, as one line: who, how many and
 * when, opening on a tap to each change. What the server turned down stays
 * in view under the line while it's shut.
 */
function Run({ run: r, day, open, onToggle }: { run: HistoryRun; day: string; open: boolean; onToggle: () => void }) {
  const list = `run-${r.id}`
  const refused = r.entries.filter((e) => e.outcome === 'turned-down')
  const several = r.devices.length > 1
  // A device's run is named by its code, so under it only the kind of device, unless that's its name already ("Made-up data").
  const kind = r.entries.find((e) => e.device)?.device
  const meta = [r.byDevice ? kind !== r.who && kind : r.devices.join('; '), r.turnedDown > 0 && `${r.turnedDown} turned down`].filter(Boolean)
  return (
    <li className="entry run">
      <button type="button" className="run-line" aria-expanded={open} aria-controls={open ? list : undefined} onClick={onToggle}>
        <span className="what">
          <span className="chevron" aria-hidden="true">
            ▸
          </span>
          {runLabel(r)}
        </span>
        {meta.length > 0 && <span className="meta">{meta.join(' · ')}</span>}
      </button>
      {(open || refused.length > 0) && (
        <ol className="entries" id={open ? list : undefined}>
          {(open ? r.entries : refused).map((e) => (
            <Entry key={e.id} entry={e} day={day} inRun={{ device: several }} />
          ))}
        </ol>
      )}
    </li>
  )
}

/** One change. In a run the run's line says whose it is, and which device when there was only the one. */
function Entry({ entry: e, day, inRun }: { entry: HistoryEntry; day: string; inRun?: { device: boolean } }) {
  const how = e.who.kind === 'link' ? 'on their private link' : e.who.kind === 'calendar' ? 'on Google Calendar' : ''
  // No name for "Someone": the top of the page says why there are none.
  const who = inRun || e.who.kind === 'unknown' ? how : [e.who.name, how].filter(Boolean).join(', ')
  const device = !inRun || inRun.device ? deviceWords(e) : ''
  const meta = [who, device, historyTime(e.madeAt, day)].filter(Boolean)
  return (
    <li className={e.outcome === 'turned-down' ? 'entry turned-down' : 'entry'}>
      <p className="what">{e.what}</p>
      <p className="meta">{meta.join(' · ')}</p>
      {e.madeOffline && e.waitedSeconds !== undefined && (
        <p className="meta">Made offline; it reached the server {waitLabel(e.waitedSeconds)} later.</p>
      )}
      {e.outcome === 'turned-down' && <p className="alert">Turned down: {e.reason}</p>}
    </li>
  )
}
