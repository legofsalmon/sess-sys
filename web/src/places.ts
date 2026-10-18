/**
 * Where each screen was scrolled to (audit finding 8). A move to a new
 * screen starts at its top, where its title and the strip that says where
 * you are can be seen; the browser's Back and Forward come back to the
 * place the screen was left at. Kept per step in the browser's history,
 * as the browser itself keeps it for pages, under a number in the step's
 * state: a step with none is a new move. The browser's own restoring is
 * off, as it puts the place back before the screen is drawn, on a page
 * too short to hold it. Kept for the tab's life in session storage, so a
 * reload keeps its place too.
 */

const STORE = 'session-hire-places'

/** A step's place, by its number. */
let places: Record<string, number> = {}
try {
  places = JSON.parse(sessionStorage.getItem(STORE) ?? '{}') as Record<string, number>
} catch {
  // Storage that's off or full keeps the places for this page only.
}

const numberOf = (state: unknown): string | undefined => {
  const n = (state as { place?: unknown } | null)?.place
  return typeof n === 'string' ? n : undefined
}

/** Gives the browser's current step a number of its own, keeping whatever else its state holds. */
function number(): string {
  const n = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const state = history.state as object | null
  history.replaceState({ ...(state && typeof state === 'object' ? state : {}), place: n }, '')
  return n
}

let current = ''
/** What to do once the next screen is drawn: go to a place, or nothing. */
let next: number | undefined

function keep() {
  try {
    sessionStorage.setItem(STORE, JSON.stringify(places))
  } catch {
    // As above.
  }
}

/** Starts keeping places; called once, before the first screen is drawn. */
export function keepPlaces() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  const known = numberOf(history.state)
  current = known ?? number()
  // A reload comes back where it was.
  next = known ? places[known] : undefined
  let frame = 0
  addEventListener('scroll', () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      places[current] = scrollY
      keep()
    })
  })
  // Runs before the screens draw the new address, so a shorter screen pulling the page up isn't taken for the last one's place.
  addEventListener('hashchange', () => {
    cancelAnimationFrame(frame)
    const back = numberOf(history.state)
    current = back ?? number()
    next = back ? (places[back] ?? 0) : 0
  })
}

/**
 * Once the new screen is drawn: to its top for a new move, or back to its
 * place for Back and Forward. `stay` keeps the page where it is, for a
 * toggle kept in the address that changes what's shown, not the screen.
 * No smooth scrolling, so nothing moves under a person who asked for less
 * motion, nor under anyone else.
 */
export function settlePlace(stay = false) {
  const to = next
  next = undefined
  if (to === undefined) return
  if (stay) {
    places[current] = scrollY
    return
  }
  // A screen still filling in may be too short at first, and the strip of its parts under the title comes a frame after it,
  // which the browser would scroll past to keep the same rows in view: the place is held for a few frames, until a hand moves the page.
  let frames = 12
  const moved = () => (frames = 0)
  const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
  for (const e of events) addEventListener(e, moved, { once: true, passive: true })
  const hold = () => {
    if (frames-- <= 0) {
      for (const e of events) removeEventListener(e, moved)
      return
    }
    if (Math.abs(scrollY - to) > 1) scrollTo(0, to)
    requestAnimationFrame(hold)
  }
  hold()
}
