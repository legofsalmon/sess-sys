import { useEffect, useRef, useState } from 'react'
import { AccountScreen } from './AccountScreen.tsx'
import { useAuth } from './auth.ts'
import { CrewBadge } from './crew/CrewBadge.tsx'
import { CrewScreen } from './crew/CrewScreen.tsx'
import { HistoryScreen } from './HistoryScreen.tsx'
import { HomeScreen } from './home/HomeScreen.tsx'
import { AreaIcon } from './home/icons.tsx'
import { PreviewBar, PreviewSplash, usePreview } from './home/Preview.tsx'
// Holds every change to the person's role (ADR 0034).
import './role.ts'
import { JobsScreen } from './jobs/JobsScreen.tsx'
import { SignIn } from './SignIn.tsx'
import { StockScreen } from './stock/StockScreen.tsx'
import { StorageBanner, useUnkept } from './StorageBanner.tsx'
import { UpdateBar } from './update.tsx'

/**
 * Switches between the app's areas. The address keeps the area, and within
 * it the record open (#jobs/<id>, #stock/item/<id>), the planner's days
 * (#plan/week/<day>) or bringing jobs in (#import), so a reload or a shared
 * link lands in the same place. Each move lands on the screen's heading
 * and names the tab after it (audit finding 22), so a screen reader says
 * where it is and the browser's history reads as pages.
 *
 * Five places, each a picture and a word (ADR 0033): Home first, the
 * three areas the work is done in, and Admin, which holds the settings and
 * the history, both used rarely. Five is what a phone's bar holds before
 * anything has to hide behind a menu. Account kept its address when it
 * became Admin, so links and bookmarks still land.
 */
const AREAS = [
  { hash: '#home', label: 'Home', Screen: HomeScreen },
  { hash: '#jobs', label: 'Jobs', Screen: JobsScreen },
  { hash: '#stock', label: 'Stock', Screen: StockScreen },
  { hash: '#crew', label: 'Crew', Screen: CrewScreen },
  { hash: '#account', label: 'Admin', Screen: AccountScreen },
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

/** Fields a person types into, as against buttons, ticks and links. */
const TYPED_INTO = 'input:not([type=button], [type=submit], [type=reset], [type=checkbox], [type=radio], [type=file], [type=range]), textarea, select, [contenteditable]'

export function Shell() {
  const auth = useAuth()
  const unkept = useUnkept()
  const persona = usePreview()
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  const within = (root: string) => hash === root || hash.startsWith(`${root}/`)
  // The planner (ADR 0010) and bringing jobs in from Google Calendar (ADR 0011) are part of Jobs, so they keep its tab; the history is kept under Admin.
  const jobs = AREAS[1]
  const admin = AREAS[4]
  const area = within('#plan') || within('#import') || within('#venues') || within('#clients') ? jobs : within('#history') ? admin : (AREAS.find((a) => within(a.hash)) ?? AREAS[0])
  const Screen = within('#history') ? HistoryScreen : area.Screen

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
  // The demo copy opens on a choice of whose eyes to see it through (ADR 0033), and comes back to it from the bar.
  const demo = auth.status === 'open' && auth.passcode === true
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
      {demo && persona && <PreviewBar persona={persona} />}
      <main ref={main}>
        <Screen />
      </main>
      <nav className="tabs" aria-label="Areas">
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
