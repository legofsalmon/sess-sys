import { useEffect, useState } from 'react'
import { App } from './App.tsx'
import { CrewScreen } from './crew/CrewScreen.tsx'

/** Switches between the app's areas. The address keeps the area, so a reload or a shared link lands in the same place. */
const AREAS = [
  { hash: '#stock', label: 'Stock', Screen: App },
  { hash: '#crew', label: 'Crew', Screen: CrewScreen },
] as const

export function Shell() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  const area = AREAS.find((a) => a.hash === hash) ?? AREAS[0]
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
