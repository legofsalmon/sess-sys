import { useEffect, useRef, useState } from 'react'
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
 * link lands in the same place. Each move lands on the screen's heading
 * and names the tab after it (audit finding 22), so a screen reader says
 * where it is and the browser's history reads as pages.
 */
const AREAS = [
  { hash: '#jobs', label: 'Jobs', Screen: JobsScreen },
  { hash: '#stock', label: 'Stock', Screen: StockScreen },
  { hash: '#crew', label: 'Crew', Screen: CrewScreen },
  { hash: '#history', label: 'History', Screen: HistoryScreen },
  { hash: '#account', label: 'Account', Screen: AccountScreen },
] as const

/**
 * The screen's heading: its first h1 that's on screen, or else its name in
 * the top bar. Found in the page rather than asked of each screen, so every
 * screen gets the same treatment without carrying a ref.
 */
function headingIn(root: HTMLElement | null): { el: HTMLElement; name: string } | undefined {
  if (!root) return undefined
  const h1 = [...root.querySelectorAll<HTMLElement>('h1')].find((h) => h.getClientRects().length > 0)
  if (h1) return { el: h1, name: h1.textContent?.trim() ?? '' }
  const name = root.querySelector<HTMLElement>('.top .brand small')
  // The name is the first words; "· made-up data" (ADR 0019) sits beside it in a span of its own.
  if (name) return { el: name, name: name.firstChild?.textContent?.trim() ?? '' }
  return undefined
}

export function Shell() {
  const auth = useAuth()
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  const within = (root: string) => hash === root || hash.startsWith(`${root}/`)
  // The planner (ADR 0010) and bringing jobs in from Google Calendar (ADR 0011) are part of Jobs, so they keep its tab.
  const area = within('#plan') || within('#import') ? AREAS[0] : (AREAS.find((a) => within(a.hash)) ?? AREAS[0])

  const main = useRef<HTMLElement>(null)
  // The address the last move was to: the page's own load keeps focus where the browser put it, and a sign-in on the same address isn't a move.
  const movedTo = useRef<string | undefined>(undefined)
  useEffect(() => {
    // The screens listen for the same change of address and draw their part in turn, each after the last, so the heading is looked for once the browser is about to draw the frame and all of them have.
    const frame = requestAnimationFrame(() => {
      const heading = headingIn(main.current)
      document.title = `${heading?.name || area.label} · Session Hire`
      // A toggle that keeps its state in the address, such as the planner's jobs or people, changes what's shown, not the screen, so it keeps focus.
      const toggled = document.activeElement?.matches('[aria-pressed]') ?? false
      if (movedTo.current !== undefined && movedTo.current !== hash && heading && !toggled) {
        heading.el.tabIndex = -1
        heading.el.focus({ preventScroll: true })
      }
      movedTo.current = hash
    })
    return () => cancelAnimationFrame(frame)
  }, [hash, auth.status, area.label])

  // Only once the server has said so: offline, the device carries on. A new version is offered here too.
  if (auth.status === 'signed-out')
    return (
      <>
        <UpdateBar />
        <main ref={main}>
          <SignIn />
        </main>
      </>
    )
  return (
    <>
      <UpdateBar />
      <StorageBanner />
      <main ref={main}>
        <area.Screen />
      </main>
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
