import { STATUS_GROUPS, type StatusCheck, type StatusGroup, type StatusState, type SystemStatus } from '@sh/shared'
import { useEffect, useState } from 'react'
import { markSignedOut } from './auth.ts'
import { when } from './format.ts'
import { StatusPill, type PillTone } from './StatusPill.tsx'
import { useLate } from './useLate.ts'

/**
 * Admin › Status (ADR 0093): everything the app relies on, each in a word and a sentence, with what to do when it
 * needs someone. Healthy is quiet: a working check has the plain settled pill; only what needs a look is amber, and
 * what isn't working the bad tone. What needs someone is named first, in the summary, so the page answers "is
 * everything all right?" in one line. The server keeps its answer for a minute; Check again asks afresh.
 */

const base = import.meta.env.VITE_API_BASE ?? ''

const TONE: Record<StatusState, PillTone> = { ok: 'confirmed', warn: 'pending', bad: 'bad', off: 'cancelled' }
const WORD: Record<StatusState, string> = { ok: 'Working', warn: 'Needs a look', bad: 'Not working', off: 'Off' }
const GROUPS: StatusGroup[] = ['app', 'safe', 'outside']

type Loaded = { state: 'loading' } | { state: 'offline' } | { state: 'ready'; status: SystemStatus }

export function StatusPanel() {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [busy, setBusy] = useState(false)
  const late = useLate(busy)
  const [failed, setFailed] = useState(false)

  const load = async (again: boolean) => {
    setBusy(true)
    setFailed(false)
    try {
      // The looks outside wait ten seconds at most each, side by side.
      const res = await fetch(`${base}/api/status${again ? '?again=1' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
      if (res.status === 401) return markSignedOut()
      if (!res.ok) throw new Error(`Server answered ${res.status}`)
      setLoaded({ state: 'ready', status: (await res.json()) as SystemStatus })
    } catch {
      setFailed(true)
      setLoaded((l) => (l.state === 'ready' ? l : { state: 'offline' }))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => void load(false), [])

  if (loaded.state === 'loading')
    return (
      <section className="card" aria-busy="true">
        <h2>Status</h2>
        <p className="hint" role="status">
          {late ? 'Checking everything the app relies on…' : ''}
        </p>
      </section>
    )
  if (loaded.state === 'offline')
    return (
      <section className="card">
        <h2>Status</h2>
        <p className="hint">Can’t check how things stand without signal. The server may also be down: if the rest of the app can’t sync either, look at shserver in Railway.</p>
        <button type="button" onClick={() => void load(true)} disabled={busy} aria-busy={busy}>
          {late ? 'Checking…' : 'Check again'}
        </button>
      </section>
    )

  const { status } = loaded
  const wrong = status.checks.filter((c) => c.state === 'bad' || c.state === 'warn')
  // The app's attention edge is its bad tone, so it's kept for something not working; a look wanted is said by the pills.
  const bad = wrong.some((c) => c.state === 'bad')
  return (
    <>
      <section className={bad ? 'card attention' : 'card'} aria-labelledby="status-summary">
        <h2 id="status-summary">{wrong.length === 0 ? 'Everything is working' : wrong.length === 1 ? '1 thing needs a look' : `${wrong.length} things need a look`}</h2>
        {wrong.length > 0 && (
          <ul className="status-wrong">
            {wrong.map((c) => (
              <li key={c.id}>
                <a href={`#admin/status`} onClick={(e) => (e.preventDefault(), document.getElementById(`status-${c.id}`)?.scrollIntoView({ block: 'start' }))}>
                  {c.name}
                </a>
                : {WORD[c.state].toLowerCase()}
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          Version {status.version}, up since {when(status.upSince)}. Checked {when(status.checkedAt)}.
        </p>
        <div className="actions">
          <button type="button" onClick={() => void load(true)} disabled={busy} aria-busy={busy}>
            {late ? 'Checking…' : 'Check again'}
          </button>
        </div>
        {failed && (
          <p className="alert" role="alert">
            Couldn’t reach the server to check again. What’s below is from {when(status.checkedAt)}.
          </p>
        )}
      </section>

      {GROUPS.map((g) => {
        const checks = status.checks.filter((c) => c.group === g)
        if (!checks.length) return null
        return (
          <section className="card" key={g} aria-labelledby={`status-group-${g}`}>
            <h2 id={`status-group-${g}`}>{STATUS_GROUPS[g]}</h2>
            <ul className="status-checks">
              {checks.map((c) => (
                <Check key={c.id} check={c} />
              ))}
            </ul>
          </section>
        )
      })}
    </>
  )
}

function Check({ check: c }: { check: StatusCheck }) {
  return (
    <li id={`status-${c.id}`} className="status-check">
      <div className="status-check-head">
        <strong>{c.name}</strong>
        <StatusPill tone={TONE[c.state]}>{WORD[c.state]}</StatusPill>
      </div>
      <p>{c.says}</p>
      {c.todo && <p className="status-todo">What to do: {c.todo}</p>}
      {c.at && <p className="hint">{c.id === 'server' ? 'Started' : 'Last worked'} {when(c.at)}</p>}
    </li>
  )
}
