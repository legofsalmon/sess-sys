import { useAuth } from './auth.ts'
import { BackupsCard } from './BackupsCard.tsx'
import { CalendarCard } from './CalendarCard.tsx'
import { ImportPeopleScreen } from './crew/ImportPeople.tsx'
import { DataCard } from './DataCard.tsx'
import { ExportCard } from './ExportCard.tsx'
import { ImportPeopleCard } from './ImportPeopleCard.tsx'
import { ImportStockCard } from './ImportStockCard.tsx'
import { Top, useHash } from './jobs/common.tsx'
import { OfficeCard } from './OfficeCard.tsx'
import { ImportStockScreen } from './stock/ImportStock.tsx'
import { useAccess } from './role.ts'
import { useView } from './view.ts'
import { MENU } from './Up.tsx'

/** The company's settings, reached from the Menu: how sign-in stands, the office, Google Calendar, backups and data, made-up data and starting fresh, and bringing in the crew and stock lists. A person's own things (their role, signing out, their feed, this device) are under You (YouScreen.tsx). */

export function AccountScreen() {
  const auth = useAuth()
  const view = useView()
  const hash = useHash()
  const access = useAccess()
  // Bringing in the crew list (ADR 0025) has a screen of its own under Account.
  if (hash === '#account/import-people') return <ImportPeopleScreen view={view} />
  // And the stock list (ADR 0026).
  if (hash === '#account/import-stock') return <ImportStockScreen view={view} />

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
          {access.can('settings') && (
            <>
              <ImportPeopleCard />
              <ImportStockCard />
            </>
          )}
        </>
      )}
    </div>
  )
}
