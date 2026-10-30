import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMoreEdges } from './more.tsx'

/**
 * The parts of the screen by name, each a tap away (ADR 0033): so a long
 * screen says what's on it before anyone scrolls, and, as it stays under
 * the bar while the screen scrolls, which part is in view. It sits on the
 * parts themselves, straight above the first, under the screen's title and
 * anything that chooses what the parts show (Home's Company or Me), so it
 * reads as this page's contents rather than as part of the bar; once
 * scrolled to the bar it stays there. Found in the page, as the Shell finds the heading, rather than
 * listed by each screen: every card with a heading of its own is a part,
 * so a new card joins without anyone remembering to add it. A heading's
 * "(5)" becomes the part's count. Nothing on a screen of one or two parts,
 * where there's nothing to find.
 */

interface Part {
  label: string
  count: string | undefined
  heading: HTMLElement
}

/** Cards straight in the screen, or in either column beside each other on a laptop. */
const PARTS = '.app > section.card > h2, .app > .columns > .column > section.card > h2, .app > .split > * > section.card > h2'
const FEWEST = 3

function partsIn(app: Element): Part[] {
  return [...app.querySelectorAll<HTMLElement>(PARTS)]
    .filter((h) => h.closest('.app') === app && h.getClientRects().length > 0)
    .map((heading) => {
      const text = heading.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      const [, label, count] = /^(.*?)\s*\((\d[\d,]*)\)$/.exec(text) ?? [, text, undefined]
      return { label: label ?? text, count, heading }
    })
    .filter((p) => p.label)
}

const same = (a: readonly Part[], b: readonly Part[]) =>
  a.length === b.length && a.every((p, i) => p.heading === b[i]!.heading && p.label === b[i]!.label && p.count === b[i]!.count)

/** Where the strip stops under the bar: the bar's own bottom, wherever the bar is held (lower while a new version is waiting). */
function underBar(app: Element): number {
  const bar = app.querySelector<HTMLElement>(':scope > .top')
  return bar ? (parseFloat(getComputedStyle(bar).top) || 0) + bar.offsetHeight : 0
}

/** What stays at the top, the bar and the strip under it, which a part scrolled to has to clear. */
function heldBottom(nav: HTMLElement | null): number {
  const app = nav?.closest('.app')
  return app ? underBar(app) + (nav!.hidden ? 0 : nav!.offsetHeight) : 0
}

/**
 * The screen's own child that holds the first part, or the page's main thing
 * before it (a card with no heading of its own, standing under the page's
 * title): the strip goes straight before it, so it's never under a long list.
 */
function before(app: Element, first: Part | undefined): Element | null {
  let at: Element | null = first?.heading.parentElement ?? null
  while (at && at.parentElement !== app) at = at.parentElement
  for (const child of app.children) {
    if (child === at) break
    if (child.matches('section.card.plain') || child.querySelector(':scope > section.card.plain')) return child
  }
  return at
}

export function OnThisScreen() {
  // Where Top is: only so the strip can find its screen. The strip itself is put among the screen's own children, by the parts.
  const anchor = useRef<HTMLSpanElement>(null)
  const [strip] = useState(() => {
    const nav = document.createElement('nav')
    nav.className = 'on-screen'
    nav.setAttribute('aria-label', 'On this screen')
    nav.hidden = true
    return nav
  })
  const nav = useRef<HTMLElement>(strip)
  const [parts, setParts] = useState<Part[]>([])
  const [current, setCurrent] = useState(-1)

  // The parts, again whenever the screen changes: a card can come and go as the data does, and the strip moves to stay on the first.
  useEffect(() => {
    const app = anchor.current?.closest('.app')
    if (!app) return
    let frame = 0
    const look = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const found = partsIn(app)
        const next = before(app, found[0])
        if (next && strip.nextElementSibling !== next) app.insertBefore(strip, next)
        setParts((was) => (same(was, found) ? was : found))
      })
    }
    anchor.current!.after(strip)
    look()
    const watch = new MutationObserver(look)
    watch.observe(app, { childList: true, subtree: true, characterData: true })
    // It stops under the bar, whose height changes with what it holds (the list of what wasn't done, the way up).
    const bar = app.querySelector(':scope > .top')
    const hold = () => (strip.style.top = `${underBar(app)}px`)
    hold()
    const sized = new ResizeObserver(hold)
    if (bar) sized.observe(bar)
    return () => {
      watch.disconnect()
      sized.disconnect()
      cancelAnimationFrame(frame)
      strip.remove()
    }
  }, [strip])

  // Which part is in view: the last whose top has reached the bar.
  useEffect(() => {
    if (parts.length < FEWEST) return
    let frame = 0
    const look = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const line = heldBottom(nav.current) + 24
        let at = -1
        parts.forEach((p, i) => {
          const card = p.heading.parentElement ?? p.heading
          if (card.getBoundingClientRect().top <= line) at = i
        })
        // At the very bottom the last part may be too short to reach the bar: it's the one in view.
        if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) at = parts.length - 1
        setCurrent(at)
      })
    }
    look()
    addEventListener('scroll', look, { passive: true })
    addEventListener('resize', look)
    return () => {
      removeEventListener('scroll', look)
      removeEventListener('resize', look)
      cancelAnimationFrame(frame)
    }
  }, [parts])

  // The part in view kept in sight in the strip, which scrolls sideways on a phone.
  useEffect(() => {
    const strip = nav.current?.querySelector<HTMLElement>('ul')
    const chip = strip?.querySelector<HTMLElement>('[aria-current]')
    if (!strip || !chip) return
    const room = strip.getBoundingClientRect()
    const at = chip.getBoundingClientRect()
    if (at.left < room.left) strip.scrollLeft -= room.left - at.left + 16
    else if (at.right > room.right) strip.scrollLeft += at.right - room.right + 16
  }, [current])

  const go = (p: Part) => {
    const card = p.heading.parentElement ?? p.heading
    scrollTo({ top: card.getBoundingClientRect().top + scrollY - heldBottom(nav.current) - 8 })
    // Focus goes with the eye, so a screen reader and a keyboard carry on from the part, not from the strip.
    p.heading.tabIndex = -1
    p.heading.focus({ preventScroll: true })
  }

  const shown = parts.length >= FEWEST
  // On a phone the strip is wider than the screen: the edge with more past it fades (audit, 20 October 2026, finding 13).
  const row = useRef<HTMLUListElement>(null)
  useMoreEdges(row, parts)
  useLayoutEffect(() => {
    strip.hidden = !shown
  }, [strip, shown])
  return (
    <span ref={anchor} hidden>
      {shown &&
        createPortal(
        <ul className="more-edges" ref={row}>
          {parts.map((p, i) => (
            <li key={`${i} ${p.label}`}>
              <button type="button" onClick={() => go(p)} aria-current={i === current ? 'location' : undefined} title={`Go to ${p.label}`}>
                {p.label}
                {p.count && <span className="count">{p.count}</span>}
              </button>
            </li>
          ))}
        </ul>,
          strip,
        )}
    </span>
  )
}
