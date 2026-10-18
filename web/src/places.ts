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
 *
 * A long list's rows (marked `data-place`) are drawn only near the screen,
 * the rest standing in at the height they were last drawn at or a guess
 * (windowed.ts, ADR 0050), so the same distance down a newly drawn list may
 * be a different row. A place on such
 * a list is kept by the row in the middle of the screen as well, and Back
 * puts that row back where it was on the screen.
 */

const STORE = 'session-hire-places'

/** How far down the page, and the long list's row in the middle of the screen, with how far it was from the top of the screen. */
interface Place {
  y: number
  row?: string
  top?: number
}

/** A step's place, by its number. A plain number is a place kept before rows were. */
let places: Record<string, Place | number> = {}
try {
  places = JSON.parse(sessionStorage.getItem(STORE) ?? '{}') as Record<string, Place | number>
} catch {
  // Storage that's off or full keeps the places for this page only.
}

/** Whether moving the page moves this, rather than a column scrolled on its own (a list beside an open job on a laptop). */
function movesWithPage(el: Element): boolean {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return false
  return true
}

/** The place now: a few points down the middle of the screen are tried for a long list's row, as a gap between rows has none. */
function placeNow(): Place {
  const y = scrollY
  for (const at of [0.5, 0.4, 0.6, 0.3, 0.7]) {
    const row = document.elementFromPoint(innerWidth / 2, innerHeight * at)?.closest<HTMLElement>('[data-place]')
    if (row?.dataset.place !== undefined && movesWithPage(row)) return { y, row: row.dataset.place, top: Math.round(row.getBoundingClientRect().top) }
  }
  return { y }
}

/** Where the page goes for a place: its row back where it was on the screen, or the same distance down if the row isn't drawn. */
function yOf(place: Place | number): number {
  if (typeof place === 'number') return place
  const row = place.row === undefined ? null : document.querySelector(`[data-place="${CSS.escape(place.row)}"]`)
  return row ? Math.max(0, Math.round(scrollY + row.getBoundingClientRect().top - (place.top ?? 0))) : place.y
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
let next: Place | number | undefined

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
      places[current] = placeNow()
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
    places[current] = placeNow()
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
    // Found again each frame: rows drawn as they come near the screen take their own height, moving the one kept.
    const y = yOf(to)
    if (Math.abs(scrollY - y) > 1) scrollTo(0, y)
    requestAnimationFrame(hold)
  }
  hold()
}
