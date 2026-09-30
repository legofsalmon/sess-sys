import { START_FRESH_WORDS, type DataStatus, type View } from '@sh/shared'
import { useEffect, useState } from 'react'
import { when } from './format.ts'
import { ask, post } from './server.ts'
import { syncSoon } from './sync.ts'

/**
 * Made-up data and starting fresh (ADR 0019): trying every part of the app
 * before the real jobs, crew and stock go in, then clearing it all, on the
 * server and on every phone. Deleting everything needs the words typed, and
 * a backup is made first where backups are set up.
 */

type Loaded = { state: 'loading' } | { state: 'offline' } | { state: 'ready'; status: DataStatus }

const by = (mark: { by: string | null }) => (mark.by ? ` by ${mark.by}` : '')

export function DataCard({ view }: { view: View }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [busy, setBusy] = useState<'made-up' | 'fresh' | undefined>()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [note, setNote] = useState<{ ok: boolean; text: string } | undefined>()

  const refresh = async () => {
    try {
      setLoaded({ state: 'ready', status: await ask<DataStatus>('/api/data') })
    } catch {
      setLoaded((l) => (l.state === 'ready' ? l : { state: 'offline' }))
    }
  }
  // Again when the calendar above is connected or disconnected, or another phone puts in made-up data or starts fresh.
  useEffect(() => void refresh(), [view.calendar.link?.state, view.madeUp, view.cursor === 0])

  const act = async (which: 'made-up' | 'fresh') => {
    setBusy(which)
    setNote(undefined)
    try {
      const status =
        which === 'made-up' ? await post<DataStatus>('/api/data/made-up') : await post<DataStatus>('/api/data/start-fresh', { confirm: typed })
      setLoaded({ state: 'ready', status })
      setTyped('')
      setOpen(false)
      setNote({
        ok: true,
        text: which === 'made-up' ? 'Made-up data is in. Have a look round Jobs, Crew and Stock.' : 'Started fresh. The app is empty, here and on every phone as it syncs.',
      })
      syncSoon()
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(undefined)
    }
  }

  if (loaded.state === 'loading') return null
  if (loaded.state === 'offline') {
    return (
      <section className="card">
        <h2>Made-up data</h2>
        <p className="hint">Can't check without signal.</p>
      </section>
    )
  }

  const { status } = loaded
  const said = note && (
    <p className={note.ok ? 'hint' : 'alert'} role={note.ok ? 'status' : 'alert'}>
      {note.text}
    </p>
  )

  if (status.empty) {
    return (
      <section className="card data">
        <h2>Try it with made-up data</h2>
        <p>
          A few weeks of made-up jobs, crew and stock, to try every part of the app: speakers short between two jobs, offers to chase, items
          to label. Every name is invented, and nobody gets an email or a message.
        </p>
        {status.calendarConnected && (
          <p className="alert" role="alert">
            Disconnect Google Calendar first, above: the made-up jobs would go on it.
          </p>
        )}
        <button type="button" className="primary" onClick={() => act('made-up')} disabled={!!busy || status.calendarConnected}>
          {busy === 'made-up' ? 'Putting it in…' : 'Put in made-up data'}
        </button>
        {said}
        <p className="hint">
          {status.fresh ? `Started fresh ${when(status.fresh.at)}${by(status.fresh)}. ` : ''}
          When you're done, start fresh here to clear it before the real jobs, crew and stock go in.
        </p>
      </section>
    )
  }

  // Always open with made-up data in; otherwise one tap away, so it isn't in the way every day.
  const showing = !!status.madeUp || open
  const ready = typed.trim().toLowerCase() === START_FRESH_WORDS
  const waiting = view.pendingCount
  return (
    <section className="card data">
      <h2>{status.madeUp ? 'Made-up data' : 'Start fresh'}</h2>
      {status.madeUp && (
        <p>
          The app holds made-up data, put in {when(status.madeUp.at)}
          {by(status.madeUp)}. Start fresh to clear it before the real jobs, crew and stock go in.
        </p>
      )}
      {!showing ? (
        <button type="button" className="link" onClick={() => setOpen(true)}>
          Start fresh…
        </button>
      ) : (
        <>
          <p>
            Starting fresh deletes every job, person, product and item, and the history, on the server and on every phone. Staff accounts
            stay, so nobody has to sign in again.
          </p>
          <p className="hint">
            {status.backups
              ? 'A backup is made first, so it can be put back if need be.'
              : "Backups are off, so it can't be undone. Download everything first, above, to keep a copy."}
          </p>
          {waiting > 0 && (
            <p className="alert" role="alert">
              {waiting === 1 ? "1 change on this device hasn't" : `${waiting} changes on this device haven't`} synced yet. Starting fresh deletes{' '}
              {waiting === 1 ? 'it' : 'them'} too.
            </p>
          )}
          {status.calendarConnected ? (
            <p className="alert" role="alert">
              Disconnect Google Calendar first, above: that takes the app's days off the calendar. Then start fresh.
            </p>
          ) : (
            <>
              <label className="field">
                Type “{START_FRESH_WORDS}” to confirm
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
              </label>
              <button type="button" className="danger" onClick={() => act('fresh')} disabled={!ready || !!busy}>
                {busy === 'fresh' ? 'Deleting everything…' : 'Delete everything'}
              </button>
            </>
          )}
        </>
      )}
      {said}
    </section>
  )
}
