import type { View } from '@sh/shared'
import { useEffect, useState } from 'react'
import { signOut, useAuth } from './auth.ts'
import { BackupsCard } from './BackupsCard.tsx'
import { CalendarCard } from './CalendarCard.tsx'
import { ExportCard } from './ExportCard.tsx'
import { FeedCard } from './FeedCard.tsx'
import { client, storage } from './sync.ts'

/** Who this device is signed in as, signing out, their own bookings' calendar feed, Google Calendar, the company's backups and data, and the device's own sync state. */

function useView(): View {
  const [view, setView] = useState(() => client.view())
  useEffect(() => client.subscribe(setView), [])
  return view
}

export function AccountScreen() {
  const auth = useAuth()
  const view = useView()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const waiting = view.pendingCount

  const out = async () => {
    if (
      waiting > 0 &&
      !confirm(`${waiting === 1 ? "1 change hasn't" : `${waiting} changes haven't`} synced yet. Signing out deletes ${waiting === 1 ? 'it' : 'them'} from this device. Sign out anyway?`)
    )
      return
    setBusy(true)
    setProblem('')
    try {
      await signOut()
    } catch {
      setBusy(false)
      return setProblem("Couldn't reach the server to sign out. Try again when you have signal.")
    }
    // A shared or handed-back phone shouldn't keep the company's data.
    await storage.wipe()
    location.replace('/')
  }

  return (
    <div className="app account">
      <header className="top">
        <div className="brand">
          <span className="mark">SH</span>
          <span>
            <b>Session Hire</b>
            <small>Account</small>
          </span>
        </div>
      </header>

      {auth.status === 'signed-in' && (
        <section className="card">
          <h2>Signed in</h2>
          <p className="who">
            <b>{auth.user.name}</b>
            <span>{auth.user.email}</span>
          </p>
          <button type="button" onClick={out} disabled={busy}>
            Sign out
          </button>
          {problem && (
            <p className="alert" role="alert">
              {problem}
            </p>
          )}
          <p className="hint">Signing out also clears this device's copy of the data. It comes back when you sign in again.</p>
        </section>
      )}

      {auth.status === 'signed-in' && <FeedCard view={view} email={auth.user.email} />}

      {auth.status === 'open' && (
        <section className="card attention">
          <h2>Sign-in is off</h2>
          <p>
            Anyone with this app's address can use it, so keep to made-up jobs and people for now. Sign-in with Google switches on once it is
            set up on the server.
          </p>
        </section>
      )}

      {auth.status === 'unknown' && (
        <section className="card">
          <h2>Not checked yet</h2>
          <p>This device hasn't reached the server yet to find out who it's signed in as.</p>
        </section>
      )}

      {(auth.status === 'signed-in' || auth.status === 'open') && (
        <>
          <CalendarCard view={view} available={auth.status === 'signed-in'} />
          <BackupsCard />
          <ExportCard />
        </>
      )}

      <section className="card">
        <h2>This device</h2>
        <p className="hint">
          Device {client.clientId.slice(-6)} · change #{view.cursor} · {waiting === 0 ? 'nothing waiting to sync' : `${waiting} waiting to sync`}
        </p>
      </section>
    </div>
  )
}
