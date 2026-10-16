import { useEffect, useRef, useState } from 'react'
import { AccountScreen } from './AccountScreen.tsx'
import { useAuth } from './auth.ts'
import { CrewBadge } from './crew/CrewBadge.tsx'
import { CrewScreen } from './crew/CrewScreen.tsx'
import { HistoryScreen } from './HistoryScreen.tsx'
import { HomeScreen } from './home/HomeScreen.tsx'
import { AreaIcon } from './home/icons.tsx'
import { PreviewSplash, useHoldPersona, usePreview } from './home/Preview.tsx'
// Holds every change to the person's role (ADR 0034).
import './role.ts'
import { JobsScreen } from './jobs/JobsScreen.tsx'
import { MenuScreen } from './MenuScreen.tsx'
import { SignIn } from './SignIn.tsx'
import { StockScreen } from './stock/StockScreen.tsx'
import { StorageBanner, useUnkept } from './StorageBanner.tsx'
import { UpdateBar } from './update.tsx'
import { YouScreen } from './YouScreen.tsx'

/**
 * Switches between the app's areas. The address keeps the area, and within
 * it the record open (#jobs/<id>, #stock/item/<id>), the planner's days
 * (#jobs/plan/week/<day>) or bringing jobs in (#jobs/import), so a reload or a shared
 * link lands in the same place. Each move lands on the screen's heading
 * and names the tab after it (audit finding 22), so a screen reader says
 * where it is and the browser's history reads as pages.
 *
 * Five places, each a picture and a word (ADR 0033): Home first, the
 * three areas the work is done in, and the Menu (ADR 0035), which names
 * every place in the app and holds what's used now and then: Admin (the
 * company's settings, at #admin; the old #account lands there, ADR 0041),
 * History and You (a person's own settings). Those keep the Menu's tab.
 */
const AREAS = [
  { hash: '#home', label: 'Home', Screen: HomeScreen },
  { hash: '#jobs', label: 'Jobs', Screen: JobsScreen },
  { hash: '#stock', label: 'Stock', Screen: StockScreen },
  { hash: '#crew', label: 'Crew', Screen: CrewScreen },
  { hash: '#menu', label: 'Menu', Screen: MenuScreen },
] as const

/** Places reached from the Menu, which keep its tab. */
const UNDER_MENU = [
  { hash: '#admin', Screen: AccountScreen },
  { hash: '#history', Screen: HistoryScreen },
  { hash: '#me', Screen: YouScreen },
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
  const name = root.querySelector<HTMLElement>('.top .brand .where')
  // The name is the first words; "· made-up data" (ADR 0019) sits beside it in a span of its own.
  if (name) return { el: name, name: name.firstChild?.textContent?.trim() ?? '' }
  return undefined
}

/** Fields a person types into, as against buttons, ticks and links. */
const TYPED_INTO =
  'input:not([type=button], [type=submit], [type=reset], [type=checkbox], [type=radio], [type=file], [type=range]), textarea, select, [contenteditable]'

/**
 * True while the phone's keyboard is up or the page is pinched in: the
 * visible part of the page is then smaller than the page's frame. iOS keeps
 * a fixed bar on that frame, so it would float loose over the page, half
 * under the keyboard; the bar steps aside until the keyboard goes, as a
 * phone's own tab bars do. 120px is more than Safari's own bars shrink by.
 */
function useBarAway(): boolean {
  const [away, setAway] = useState(false)
  useEffect(() => {
    const seen = window.visualViewport
    if (!seen) return
    // From 900px across the places are a sidebar (ADR 0036), down the side rather than under the keyboard, so they stay.
    const wide = matchMedia('(min-width: 900px)')
    const look = () => setAway(!wide.matches && (document.documentElement.clientHeight - seen.height * seen.scale > 120 || seen.scale > 1.05))
    look()
    seen.addEventListener('resize', look)
    wide.addEventListener('change', look)
    return () => {
      seen.removeEventListener('resize', look)
      wide.removeEventListener('change', look)
    }
  }, [])
  return away
}

export function Shell() {
  const auth = useAuth()
  const unkept = useUnkept()
  const persona = usePreview()
  const barAway = useBarAway()
  // The demo copy opens on a choice of whose eyes to see it through (ADR 0033), and the header says whose they are.
  const demo = auth.status === 'open' && auth.passcode === true
  useHoldPersona(demo ? persona : undefined)
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  const within = (root: string) => hash === root || hash.startsWith(`${root}/`)
  // Every address starts with its area (ADR 0041), so its tab is the one it starts with; Admin, History and You keep the Menu's.
  const menu = AREAS[4]
  const under = UNDER_MENU.find((u) => within(u.hash))
  const area = under ? menu : (AREAS.find((a) => within(a.hash)) ?? AREAS[0])
  const Screen = under?.Screen ?? area.Screen

  const main = useRef<HTMLElement>(null)
  // The address the last move was to: the page's own load keeps focus where the browser put it, and a sign-in on the same address isn't a move.
  const movedTo = useRef<string | undefined>(undefined)
  useEffect(() => {
    // The screens listen for the same change of address and draw their part in turn, each after the last, so the heading is looked for once the browser is about to draw the frame and all of them have.
    const frame = requestAnimationFrame(() => {
      const heading = headingIn(main.current)
      document.title = `${heading?.name || area.label} · Session Hire`
      // A toggle that keeps its state in the address, such as the planner's jobs or people, changes what's shown, not the screen, so it keeps focus.
      const active = document.activeElement
      const toggled = active?.matches('[aria-pressed]') ?? false
      // Someone already typing on the new screen, in its search say, keeps their place: this runs a frame after the move, and a quick
      // hand can be in a field by then. Taking the focus away would send the rest of what they type, and their Enter, nowhere.
      const typing = !!active && !!main.current?.contains(active) && active.matches(TYPED_INTO)
      if (movedTo.current !== undefined && movedTo.current !== hash && heading && !toggled && !typing) {
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
        <UpdateBar unkept={unkept} />
        <main ref={main}>
          <SignIn />
        </main>
      </>
    )
  if (demo && (!persona || persona.key === 'freelancer' || hash === '#preview'))
    return (
      <>
        <UpdateBar unkept={unkept} />
        <main ref={main}>
          <PreviewSplash />
        </main>
      </>
    )
  return (
    <>
      <UpdateBar unkept={unkept} />
      <StorageBanner />
      <main ref={main}>
        <Screen />
      </main>
      <nav className="tabs" aria-label="Areas" hidden={barAway}>
        {AREAS.map((a) => (
          <a key={a.hash} href={a.hash} aria-current={a === area ? 'page' : undefined}>
            <AreaIcon area={a.hash} />
            <span className="tab-word">{a.label}</span>
            {a.hash === '#crew' && <CrewBadge />}
          </a>
        ))}
      </nav>
    </>
  )
}
