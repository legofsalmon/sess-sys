import { useAuth } from './auth.ts'
import { BackupsCard } from './BackupsCard.tsx'
import { CalendarCard } from './CalendarCard.tsx'
import { DataCard } from './DataCard.tsx'
import { ExportCard } from './ExportCard.tsx'
import { ListsCard } from './ListsCard.tsx'
import { Top } from './jobs/common.tsx'
import { OfficeCard } from './OfficeCard.tsx'
import { useAccess } from './role.ts'
import { useView } from './view.ts'
import { MENU } from './Up.tsx'

/** The company's settings, at #admin from the Menu: how sign-in stands, the office, Google Calendar, backups and data, made-up data and starting fresh, and the way to where each list is brought in (ADR 0041). A person's own things (their role, signing out, their feed, this device) are under You (YouScreen.tsx). */

export function AccountScreen() {
  const auth = useAuth()
  const view = useView()
  const access = useAccess()

  return (
    <div className="app account">
      <Top view={view} title="Admin" up={{ steps: [MENU], here: 'Admin' }} />
      <h1>Admin</h1>

      {auth.status === 'open' && auth.passcode && (
        <section className="card">
          <h2>Demo copy</h2>
          <p>
            This copy is locked with a shared passcode instead of Google sign-in, so anyone who has the passcode can use it. Keep to made-up jobs and
            people here.
          </p>
        </section>
      )}

      {auth.status === 'open' && !auth.passcode && (
        <section className="card attention">
          <h2>Sign-in is off</h2>
          <p>
            Anyone with this app's address can use it, so keep to made-up jobs and people for now. Sign-in with Google switches on once it is set up
            on the server.
          </p>
        </section>
      )}

      {auth.status === 'unknown' && (
        <section className="card">
          <h2>Not checked yet</h2>
          <p>This device hasn't reached the server yet to find out who it's signed in as.</p>
        </section>
      )}

      {/* Settings are for the office and directors, and the data's own switches for directors (ADR 0034); a role without them doesn't see them. */}
      {(auth.status === 'signed-in' || auth.status === 'open') && (
        <>
          {access.can('settings') && (
            <>
              <OfficeCard office={view.office} />
              <CalendarCard view={view} available={auth.status === 'signed-in'} />
              <BackupsCard />
              <ExportCard />
            </>
          )}
          {access.can('company') && <DataCard view={view} />}
          {access.can('settings') && <ListsCard calendar={access.can('jobs')} />}
        </>
      )}
    </div>
  )
}
