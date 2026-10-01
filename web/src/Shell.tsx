import { useEffect, useState } from 'react'
import { AccountScreen } from './AccountScreen.tsx'
import { useAuth } from './auth.ts'
import { CrewBadge } from './crew/CrewBadge.tsx'
import { CrewScreen } from './crew/CrewScreen.tsx'
import { HistoryScreen } from './HistoryScreen.tsx'
import { JobsScreen } from './jobs/JobsScreen.tsx'
import { SignIn } from './SignIn.tsx'
import { StockScreen } from './stock/StockScreen.tsx'
import { StorageBanner } from './StorageBanner.tsx'
import { UpdateBar } from './update.tsx'

/**
 * Switches between the app's areas. The address keeps the area, and within
 * it the record open (#jobs/<id>, #stock/item/<id>), the planner's days
 * (#plan/week/<day>) or bringing jobs in (#import), so a reload or a shared
 * link lands in the same place.
 */
const AREAS = [
  { hash: '#jobs', label: 'Jobs', Screen: JobsScreen },
  { hash: '#stock', label: 'Stock', Screen: StockScreen },
  { hash: '#crew', label: 'Crew', Screen: CrewScreen },
  { hash: '#history', label: 'History', Screen: HistoryScreen },
  { hash: '#account', label: 'Account', Screen: AccountScreen },
] as const

export function Shell() {
  const auth = useAuth()
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  // Only once the server has said so: offline, the device carries on. A new version is offered here too.
  if (auth.status === 'signed-out')
    return (
      <>
        <UpdateBar />
        <SignIn />
      </>
    )
  const within = (root: string) => hash === root || hash.startsWith(`${root}/`)
  // The planner (ADR 0010) and bringing jobs in from Google Calendar (ADR 0011) are part of Jobs, so they keep its tab.
  const area = within('#plan') || within('#import') ? AREAS[0] : (AREAS.find((a) => within(a.hash)) ?? AREAS[0])
  return (
    <>
      <UpdateBar />
      <StorageBanner />
      <area.Screen />
      <nav className="tabs" aria-label="Areas">
        {AREAS.map((a) => (
          <a key={a.hash} href={a.hash} aria-current={a === area ? 'page' : undefined}>
            {a.label}
            {a.hash === '#crew' && <CrewBadge />}
          </a>
        ))}
      </nav>
    </>
  )
}
