import { useEffect, useState } from 'react'
import { AccountScreen } from './AccountScreen.tsx'
import { App } from './App.tsx'
import { useAuth } from './auth.ts'
import { CrewScreen } from './crew/CrewScreen.tsx'
import { HistoryScreen } from './HistoryScreen.tsx'
import { JobsScreen } from './jobs/JobsScreen.tsx'
import { SignIn } from './SignIn.tsx'

/**
 * Switches between the app's areas. The address keeps the area, and within
 * it the record open (#jobs/<id>), so a reload or a shared link lands in the
 * same place.
 */
const AREAS = [
  { hash: '#jobs', label: 'Jobs', Screen: JobsScreen },
  { hash: '#stock', label: 'Stock', Screen: App },
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
  // Only once the server has said so: offline, the device carries on.
  if (auth.status === 'signed-out') return <SignIn />
  const area = AREAS.find((a) => hash === a.hash || hash.startsWith(`${a.hash}/`)) ?? AREAS[0]
  return (
    <>
      <area.Screen />
      <nav className="tabs" aria-label="Areas">
        {AREAS.map((a) => (
          <a key={a.hash} href={a.hash} aria-current={a === area ? 'page' : undefined}>
            {a.label}
          </a>
        ))}
      </nav>
    </>
  )
}
