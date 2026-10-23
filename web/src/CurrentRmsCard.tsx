import { plural, type RmsStatus } from '@sh/shared'
import { useEffect, useState } from 'react'
import { markSignedOut } from './auth.ts'
import { when } from './format.ts'
import { useLate } from './useLate.ts'

/**
 * Current RMS, on Admin (ADR 0078): whether the server can reach it, and
 * bringing its opportunities in, read only. The first read takes a while
 * (Current RMS answers a request a second), so it runs on the server with
 * how far it's got and a way to stop; leaving the page leaves it running.
 * What came in is under Jobs › Money › Past quotes, and downloads as two
 * spreadsheets.
 */

const base = import.meta.env.VITE_API_BASE ?? ''

type Loaded = { state: 'loading' } | { state: 'offline' } | { state: 'ready'; status: RmsStatus }

const STAGE_WORDS = { opportunities: 'Reading the opportunities', lines: 'Reading the lines of each' } as const

export function CurrentRmsCard() {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [busy, setBusy] = useState<'check' | 'read' | 'stop' | undefined>()
  const late = useLate(busy !== undefined)
  const [note, setNote] = useState<{ ok: boolean; text: string } | undefined>()

  const refresh = async () => {
    try {
      const res = await fetch(`${base}/api/rms`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
      if (res.status === 401) return markSignedOut()
      if (!res.ok) throw new Error(`Server answered ${res.status}`)
      setLoaded({ state: 'ready', status: (await res.json()) as RmsStatus })
    } catch {
      setLoaded((l) => (l.state === 'ready' ? l : { state: 'offline' }))
    }
  }
  useEffect(() => void refresh(), [])

  // While a read runs, how far it's got, every few seconds.
  const running = loaded.state === 'ready' && loaded.status.running !== null
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => void refresh(), 3_000)
    return () => clearInterval(t)
  }, [running])

  const post = async (what: 'check' | 'read' | 'stop') => {
    setBusy(what)
    setNote(undefined)
    try {
      const res = await fetch(`${base}/api/rms/${what}`, { method: 'POST', signal: AbortSignal.timeout(30_000) })
      if (res.status === 401) return markSignedOut()
      const body = (await res.json().catch(() => ({}))) as { error?: string; opportunities?: number }
      if (!res.ok) setNote({ ok: false, text: body.error ?? `The server answered ${res.status}.` })
      else if (what === 'check') setNote({ ok: true, text: `Connected. Current RMS holds ${plural(body.opportunities ?? 0, 'opportunity', 'opportunities')}.` })
      await refresh()
    } catch {
      setNote({ ok: false, text: "Couldn't reach the server. Try again when you have signal." })
    } finally {
      setBusy(undefined)
    }
  }

  if (loaded.state === 'loading') return null
  if (loaded.state === 'offline') {
    return (
      <section className="card">
        <h2>Current RMS</h2>
        <p className="hint">Can't check Current RMS without signal.</p>
      </section>
    )
  }

  const { status } = loaded
  if (!status.configured) {
    return (
      <section className="card">
        <h2>Current RMS</h2>
        <p>Not connected. The app can read the quote history from Current RMS once its API key is set on the server.</p>
      </section>
    )
  }

  const last = status.last
  const progress = status.running
  return (
    <section className="card" aria-labelledby="rms-title">
      <h2 id="rms-title">Current RMS</h2>
      <p>
        Connected to {status.subdomain}.current-rms.com, to read only: the app never changes anything there. {plural(status.opportunities, 'opportunity', 'opportunities')} and{' '}
        {plural(status.lines, 'line')} read so far.
      </p>
      {progress ? (
        <div role="status">
          <p>
            {STAGE_WORDS[progress.stage]}: {progress.done.toLocaleString('en-IE')}
            {progress.total ? ` of ${progress.total.toLocaleString('en-IE')}` : ''}.
          </p>
          <progress max={progress.total || 1} value={progress.done} aria-label={STAGE_WORDS[progress.stage]} />
          <p className="hint">Current RMS answers about a request a second, so the first read can take half an hour. You can leave this page; it carries on.</p>
          <button type="button" className="secondary" onClick={() => post('stop')} disabled={busy !== undefined}>
            Stop reading
          </button>
        </div>
      ) : (
        <>
          {last?.error && (
            <p className="alert" role="alert">
              The last read stopped{last.finishedAt ? ` ${when(last.finishedAt)}` : ''}: {last.error}
            </p>
          )}
          {last && !last.error && last.finishedAt && (
            <p className="hint">
              Last read {when(last.finishedAt)}
              {last.stopped ? ', stopped part way' : ''}: {plural(last.opportunities, 'opportunity', 'opportunities')}, lines read again for those that changed (
              {plural(last.lines, 'line')}).
            </p>
          )}
          <div className="row">
            <button type="button" onClick={() => post('read')} disabled={busy !== undefined} aria-busy={busy === 'read'}>
              {status.opportunities ? 'Read Current RMS again' : 'Bring in from Current RMS'}
            </button>
            <button type="button" className="secondary" onClick={() => post('check')} disabled={busy !== undefined} aria-busy={busy === 'check'}>
              {late && busy === 'check' ? 'Checking…' : 'Check the connection'}
            </button>
          </div>
        </>
      )}
      {note && (
        <p className={note.ok ? 'hint' : 'alert'} role={note.ok ? 'status' : 'alert'}>
          {note.text}
        </p>
      )}
      {status.opportunities > 0 && (
        <p className="hint">
          See them under <a href="#jobs/money/current-rms">Jobs › Money › Past quotes</a>, or download <a href={`${base}/api/rms/download/opportunities.csv`}>the opportunities</a> and{' '}
          <a href={`${base}/api/rms/download/lines.csv`}>their lines</a> as spreadsheets.
        </p>
      )}
    </section>
  )
}
