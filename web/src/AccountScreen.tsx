import { useState } from 'react'
import { Confirm } from './act.tsx'
import { signOut, useAuth } from './auth.ts'
import { BackupsCard } from './BackupsCard.tsx'
import { CalendarCard } from './CalendarCard.tsx'
import { ImportPeopleScreen } from './crew/ImportPeople.tsx'
import { DataCard } from './DataCard.tsx'
import { ExportCard } from './ExportCard.tsx'
import { FeedCard } from './FeedCard.tsx'
import { ImportPeopleCard } from './ImportPeopleCard.tsx'
import { ImportStockCard } from './ImportStockCard.tsx'
import { MadeUp, useHash } from './jobs/common.tsx'
import { OfficeCard } from './OfficeCard.tsx'
import { useNotDone } from './problems.tsx'
import { forgetCountDraft } from './stock/Counts.tsx'
import { ImportStockScreen } from './stock/ImportStock.tsx'
import { client, storage } from './sync.ts'
import { useView } from './view.ts'

/** Who this device is signed in as, signing out, their own bookings' calendar feed, Google Calendar, the company's backups and data, made-up data and starting fresh, bringing in the crew list, and the device's own sync state. */

export function AccountScreen() {
  const auth = useAuth()
  const view = useView()
  const hash = useHash()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  // Signing out with changes still waiting asks first, in the card.
  const [asking, setAsking] = useState(false)
  const waiting = view.pendingCount
  const notDone = useNotDone(view)
  // Bringing in the crew list (ADR 0025) has a screen of its own under Account.
  if (hash === '#account/import-people') return <ImportPeopleScreen view={view} />
  // And the stock list (ADR 0026).
  if (hash === '#account/import-stock') return <ImportStockScreen view={view} />

  const out = async () => {
    setAsking(false)
    setBusy(true)
    setProblem('')
    try {
      await signOut()
    } catch {
      setBusy(false)
      return setProblem("Couldn't reach the server to sign out. Try again when you have signal.")
    }
    // A shared or handed-back phone shouldn't keep the company's data.
    forgetCountDraft()
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
            <small>
              Account
              <MadeUp view={view} />
            </small>
          </span>
        </div>
        <div className="state">{notDone.count}</div>
        {notDone.list}
      </header>

      {auth.status === 'signed-in' && (
        <section className="card">
          <h2>Signed in</h2>
          <p className="who">
            <b>{auth.user.name}</b>
            <span>{auth.user.email}</span>
          </p>
          {asking ? (
            <Confirm
              question={`${waiting === 1 ? "1 change hasn't" : `${waiting} changes haven't`} synced yet. Signing out deletes ${waiting === 1 ? 'it' : 'them'} from this device.`}
              yes="Sign out anyway"
              no="Stay signed in"
              onYes={() => void out()}
              onNo={() => setAsking(false)}
            />
          ) : (
            <button type="button" onClick={() => (waiting > 0 ? setAsking(true) : void out())} disabled={busy}>
              Sign out
            </button>
          )}
          {problem && (
            <p className="alert" role="alert">
              {problem}
            </p>
          )}
          <p className="hint">Signing out also clears this device's copy of the data. It comes back when you sign in again.</p>
        </section>
      )}

      {auth.status === 'signed-in' && <FeedCard view={view} email={auth.user.email} />}

      {auth.status === 'open' && auth.passcode && (
        <section className="card">
          <h2>Demo copy</h2>
          <p>
            This copy is locked with a shared passcode instead of Google sign-in, so anyone who has the passcode can use it. Keep to made-up jobs
            and people here.
          </p>
        </section>
      )}

      {auth.status === 'open' && !auth.passcode && (
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
          <OfficeCard office={view.office} />
          <CalendarCard view={view} available={auth.status === 'signed-in'} />
          <BackupsCard />
          <ExportCard />
          <DataCard view={view} />
          <ImportPeopleCard />
          <ImportStockCard />
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
