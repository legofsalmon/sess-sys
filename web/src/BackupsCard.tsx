import type { BackupRun, BackupStatus } from '@sh/shared'
import { useEffect, useState } from 'react'
import { markSignedOut } from './auth.ts'
import { size, when } from './format.ts'

/**
 * The nightly backup, as the Account tab shows it: when the last good one
 * was made, whether the last attempt worked, and "Back up now" for the
 * first run after setting up storage or before anything risky.
 */

const base = import.meta.env.VITE_API_BASE ?? ''

type Loaded = { state: 'loading' } | { state: 'offline' } | { state: 'ready'; status: BackupStatus }

export function BackupsCard() {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | undefined>()

  const refresh = async () => {
    try {
      const res = await fetch(`${base}/api/backups`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
      if (res.status === 401) return markSignedOut()
      if (!res.ok) throw new Error(`Server answered ${res.status}`)
      setLoaded({ state: 'ready', status: (await res.json()) as BackupStatus })
    } catch {
      setLoaded((l) => (l.state === 'ready' ? l : { state: 'offline' }))
    }
  }
  useEffect(() => void refresh(), [])

  const backUpNow = async () => {
    setBusy(true)
    setNote(undefined)
    try {
      const res = await fetch(`${base}/api/backups/run`, { method: 'POST', signal: AbortSignal.timeout(120_000) })
      if (res.status === 401) return markSignedOut()
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        setNote({ ok: false, text: error ?? `The server answered ${res.status}.` })
      } else {
        const run = (await res.json()) as BackupRun
        if (run.status === 'ok') setNote({ ok: true, text: `Backed up ${run.rows ?? 0} rows (${size(run.bytes)}) and checked by a test restore.` })
        else setNote({ ok: false, text: `That backup failed: ${run.error ?? 'no reason given'}` })
      }
      await refresh()
    } catch {
      setNote({ ok: false, text: "Couldn't reach the server. Try again when you have signal." })
    } finally {
      setBusy(false)
    }
  }

  if (loaded.state === 'loading') return null
  if (loaded.state === 'offline') {
    return (
      <section className="card">
        <h2>Backups</h2>
        <p className="hint">Can't check the backups without signal.</p>
      </section>
    )
  }

  const { status } = loaded
  if (!status.configured) {
    return (
      <section className="card attention">
        <h2>Backups are off</h2>
        <p>Nothing is being backed up yet. Backups start once there is somewhere to keep them, set up on the server.</p>
      </section>
    )
  }

  const failed = status.last?.status === 'failed' ? status.last : undefined
  return (
    <section className={status.fresh ? 'card' : 'card attention'}>
      <h2>Backups</h2>
      {status.lastOk?.finishedAt ? (
        <p>
          Last backup {when(status.lastOk.finishedAt)}, {size(status.lastOk.bytes)}, checked by a test restore.
        </p>
      ) : (
        <p>No backup has been made yet.</p>
      )}
      {!status.fresh && status.lastOk && <p>That's more than a day ago, so the nightly backup isn't working.</p>}
      {failed && (
        <p className="alert" role="alert">
          The last try failed{failed.finishedAt ? ` ${when(failed.finishedAt)}` : ''}: {failed.error ?? 'no reason given'}
        </p>
      )}
      <button type="button" onClick={backUpNow} disabled={busy}>
        {busy ? 'Backing up…' : 'Back up now'}
      </button>
      {note && (
        <p className={note.ok ? 'hint' : 'alert'} role={note.ok ? 'status' : 'alert'}>
          {note.text}
        </p>
      )}
      <p className="hint">
        Every night{status.next ? `; next ${when(status.next)}` : ''}. Kept for 35 days, then one a month for a year.
      </p>
    </section>
  )
}
