import { waitLabel, type HistoryEntry, type HistoryPage } from '@sh/shared'
import { useEffect, useRef, useState } from 'react'
import { markSignedOut } from './auth.ts'
import { when } from './format.ts'

/**
 * The history (ADR 0006): who did what, when, on which device, whether it
 * was made offline, and what the server turned down. Newest first, 50 at a
 * time, for everyone or one person. It stays on the server rather than on
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
  const [who, setWho] = useState('')
  const [people, setPeople] = useState<Person[]>([])
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [older, setOlder] = useState<'idle' | 'loading' | 'failed'>('idle')
  // Answers to an earlier choice of person arrive late sometimes; only the latest request's answer counts.
  const latest = useRef(0)

  const refresh = async () => {
    const request = ++latest.current
    setLoaded({ state: 'loading' })
    setOlder('idle')
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

  const staff = people.filter((p) => p.key.startsWith('user:'))
  const onLinks = people.filter((p) => p.key.startsWith('link:'))

  return (
    <div className="app history">
      <header className="top">
        <div className="brand">
          <span className="mark">SH</span>
          <span>
            <b>Session Hire</b>
            <small>History</small>
          </span>
        </div>
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
          <p className="hint">Nothing yet. Every change anyone makes shows up here, with who made it and when.</p>
        )}
        {loaded.state === 'ready' && loaded.entries.length > 0 && (
          <ol className="entries">
            {loaded.entries.map((e) => (
              <Entry key={e.id} entry={e} />
            ))}
          </ol>
        )}
        {loaded.state === 'ready' && loaded.next && (
          <button type="button" onClick={showOlder} disabled={older === 'loading'}>
            {older === 'loading' ? 'Getting more…' : 'Show older'}
          </button>
        )}
        {older === 'failed' && (
          <p className="alert" role="alert">
            Couldn't reach the server. Try again when you have signal.
          </p>
        )}
        {loaded.state === 'ready' && !loaded.next && loaded.entries.length > 0 && <p className="hint">That's the start of the history.</p>}
      </section>
    </div>
  )
}

function Entry({ entry: e }: { entry: HistoryEntry }) {
  const device = [e.device, e.deviceCode && `device ${e.deviceCode}`].filter(Boolean).join(', ')
  return (
    <li className="entry">
      <p className="what">{e.what}</p>
      <p className="meta">
        {e.who.name}
        {e.who.kind === 'link' ? ', on their private link' : e.who.kind === 'calendar' ? ', on Google Calendar' : ''}
        {device ? ` · ${device}` : ''} · {when(e.madeAt)}
      </p>
      {e.madeOffline && e.waitedSeconds !== undefined && (
        <p className="meta">Made offline; it reached the server {waitLabel(e.waitedSeconds)} later.</p>
      )}
      {e.outcome === 'turned-down' && <p className="alert">Turned down: {e.reason}</p>}
    </li>
  )
}
