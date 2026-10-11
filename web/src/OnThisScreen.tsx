import { useEffect, useRef, useState } from 'react'

/**
 * Under the title, the parts of the screen by name, each a tap away
 * (ADR 0033): so a long screen says what's on it before anyone scrolls,
 * and, as it stays at the top while the screen scrolls, which part is in
 * view. Found in the page, as the Shell finds the heading, rather than
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
const PARTS = '.app > section.card > h2, .app > .columns > .column > section.card > h2'
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

/** The bottom of the bar that stays at the top, which a part scrolled to has to clear. */
function barBottom(from: Element): number {
  return from.closest('.top')?.getBoundingClientRect().bottom ?? 0
}

export function OnThisScreen() {
  const nav = useRef<HTMLElement>(null)
  const [parts, setParts] = useState<Part[]>([])
  const [current, setCurrent] = useState(-1)

  // The parts, again whenever the screen changes: a card can come and go as the data does.
  useEffect(() => {
    const app = nav.current?.closest('.app')
    if (!app) return
    let frame = 0
    const look = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setParts((was) => (same(was, partsIn(app)) ? was : partsIn(app))))
    }
    look()
    const watch = new MutationObserver(look)
    watch.observe(app, { childList: true, subtree: true, characterData: true })
    return () => {
      watch.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])

  // Which part is in view: the last whose top has reached the bar.
  useEffect(() => {
    if (parts.length < FEWEST) return
    let frame = 0
    const look = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const line = (nav.current ? barBottom(nav.current) : 0) + 24
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
    scrollTo({ top: card.getBoundingClientRect().top + scrollY - barBottom(nav.current ?? card) - 8 })
    // Focus goes with the eye, so a screen reader and a keyboard carry on from the part, not from the strip.
    p.heading.tabIndex = -1
    p.heading.focus({ preventScroll: true })
  }

  const shown = parts.length >= FEWEST
  return (
    <nav ref={nav} className="on-screen" aria-label="On this screen" hidden={!shown}>
      {shown && (
        <ul>
          {parts.map((p, i) => (
            <li key={`${i} ${p.label}`}>
              <button type="button" onClick={() => go(p)} aria-current={i === current ? 'location' : undefined} title={`Go to ${p.label}`}>
                {p.label}
                {p.count && <span className="count">{p.count}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}
