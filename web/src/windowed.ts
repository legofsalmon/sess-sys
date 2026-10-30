import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/**
 * A long list drawn only where it can be seen (audit finding 11, ADR 0050):
 * the rows on the screen and a screen's worth either side, with the rest
 * standing in as space above and below them at the height each was last
 * drawn at, or a guess for one never drawn. So opening Jobs with 900 jobs
 * builds a few dozen rows, not 900, and scrolling builds the next ones as
 * they come near.
 *
 * Heights are kept for the tab's life by list and row, so a list drawn
 * again (Back from a job) is the same height as when it was left, and
 * places.ts finds its row at the same distance down. A row that changes
 * height above the screen moves the page by as much, so the rows being
 * read stay where they are; the browser's own anchoring is off on the list
 * (`overflow-anchor: none` in app.css), or the two would move it twice.
 *
 * The list scrolls with the page on a phone, or in a column of its own
 * beside an open job on a laptop: whichever holds it is the one listened to.
 */

/** Each list's rows' heights, by its name and the row's key, for the tab's life. */
const heights = new Map<string, Map<string, number>>()

/** What a windowed list draws: its first and last-but-one rows, and the space standing in above and below them. */
export interface Windowed<T> {
  /** The rows to draw, from `start`. */
  rows: readonly T[]
  /** The index of the first row drawn, for its place in the list. */
  start: number
  /** Padding on the list for the rows not drawn. */
  style: { paddingTop: number; paddingBottom: number }
  /** For the list itself. */
  list: (el: HTMLElement | null) => void
  /** For each row drawn, so its height is known. */
  row: (key: string) => (el: HTMLElement | null) => void
}

/** The page, or the nearest column that scrolls on its own. */
export function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p
  return null
}

/**
 * Draws `items` in a window. `name` keeps its heights apart from other
 * lists'; `guess` is about one row's height, for a row not yet drawn.
 */
export function useWindowed<T>(name: string, items: readonly T[], keyOf: (item: T) => string, guess: number): Windowed<T> {
  let known = heights.get(name)
  if (!known) heights.set(name, (known = new Map()))
  const sizes = known
  const listEl = useRef<HTMLElement | null>(null)
  const gap = useRef(0)
  // Before the list is in the page: enough rows for two screens, so the first frame isn't empty and the page is long enough to scroll to a place.
  const [range, setRange] = useState(() => ({ start: 0, end: Math.min(items.length, Math.ceil((2 * innerHeight) / guess)) }))
  const latest = useRef({ items, keyOf, guess })
  latest.current = { items, keyOf, guess }

  const heightOf = useCallback((key: string) => sizes.get(key) ?? latest.current.guess, [sizes])

  /** Works out which rows are near the screen, and draws those. */
  const place = useCallback(() => {
    const el = listEl.current
    if (!el) return
    const { items, keyOf } = latest.current
    const box = el.getBoundingClientRect()
    const scroller = scrollerOf(el)
    const view = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight }
    const screen = view.bottom - view.top
    // From a screen above what can be seen to a screen below it, measured from the top of the list.
    const from = view.top - box.top - screen
    const to = view.bottom - box.top + screen
    let y = 0
    let start = items.length
    let end = items.length
    for (let i = 0; i < items.length; i++) {
      const bottom = y + heightOf(keyOf(items[i]!)) + gap.current
      if (start === items.length && bottom > from) start = i
      if (y > to) {
        end = i
        break
      }
      y = bottom
    }
    if (start > end) start = end
    setRange((r) => (r.start === start && r.end === end ? r : { start, end }))
  }, [heightOf])

  // Rows that change height: kept, and the page moved by as much as any above the screen changed, so what is being read stays put.
  const observer = useRef<ResizeObserver | null>(null)
  const keys = useRef(new WeakMap<Element, string>())
  if (!observer.current && typeof ResizeObserver !== 'undefined')
    observer.current = new ResizeObserver((entries) => {
      const el = listEl.current
      if (!el) return
      const scroller = scrollerOf(el)
      const top = scroller ? scroller.getBoundingClientRect().top : 0
      let moved = 0
      for (const entry of entries) {
        const key = keys.current.get(entry.target)
        if (key === undefined || !entry.target.isConnected) continue
        // Exact, not rounded: the padding stands in for rows the browser lays out at fractions of a pixel, and a rounded height would move the rows below by the difference each time the window moved.
        const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height
        const was = sizes.get(key)
        if (h === 0 || (was !== undefined && Math.abs(was - h) < 0.01)) continue
        sizes.set(key, h)
        // Only a row wholly above the top of what can be seen; one that is on the screen grows downwards, as anything would.
        if (entry.target.getBoundingClientRect().bottom <= top) moved += h - (was ?? latest.current.guess)
      }
      if (moved) {
        if (scroller) scroller.scrollTop += moved
        else scrollBy(0, moved)
      }
      place()
    })

  const list = useCallback(
    (el: HTMLElement | null) => {
      listEl.current = el
      if (el) gap.current = parseFloat(getComputedStyle(el).rowGap) || 0
    },
    []
  )

  const rowRefs = useRef(new Map<string, (el: HTMLElement | null) => void>())
  const row = useCallback((key: string) => {
    let ref = rowRefs.current.get(key)
    if (!ref) {
      let seen: HTMLElement | null = null
      ref = (el) => {
        if (seen) observer.current?.unobserve(seen)
        seen = el
        if (el) {
          keys.current.set(el, key)
          observer.current?.observe(el)
        }
      }
      rowRefs.current.set(key, ref)
    }
    return ref
  }, [])

  // Listens to whatever scrolls the list, and to the window's size; and works the window out again whenever the rows change.
  useLayoutEffect(() => {
    const el = listEl.current
    if (!el) return
    const scroller = scrollerOf(el) ?? window
    let frame = 0
    const soon = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }
    scroller.addEventListener('scroll', soon, { passive: true })
    addEventListener('resize', soon)
    return () => {
      cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', soon)
      removeEventListener('resize', soon)
    }
  }, [place])
  useLayoutEffect(place, [place, items])
  useLayoutEffect(() => () => observer.current?.disconnect(), [])

  const start = Math.min(range.start, items.length)
  const end = Math.min(Math.max(range.end, start), items.length)
  let above = 0
  for (let i = 0; i < start; i++) above += heightOf(keyOf(items[i]!)) + gap.current
  let below = 0
  for (let i = end; i < items.length; i++) below += heightOf(keyOf(items[i]!)) + gap.current
  return { rows: items.slice(start, end), start, style: { paddingTop: above, paddingBottom: below }, list, row }
}
