import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'

/**
 * More this way: which edges of a box that scrolls sideways have more past
 * them, kept as `data-more` (left, right or both) for the fade app.css draws
 * on `.more-edges`. One cue for "there's more off this edge" wherever a row
 * or a table is wider than the phone: an area's row (Views.tsx), On this
 * screen, a page's tabs, the quote and Money tables and the planner (audit
 * P2 23; 20 October 2026, findings 13 and 77). Watched as the box scrolls
 * and as it or what's in it changes size, so a table that grows shows the
 * fade without a scroll.
 */
export function useMoreEdges(ref: RefObject<HTMLElement | null>, on: unknown = true) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const edges = () => {
      const left = el.scrollLeft > 1
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      const more = left && right ? 'both' : left ? 'left' : right ? 'right' : ''
      if (el.dataset.more !== more) el.dataset.more = more
    }
    edges()
    el.addEventListener('scroll', edges, { passive: true })
    const sized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(edges)
    if (sized) {
      sized.observe(el)
      for (const child of el.children) sized.observe(child)
    }
    return () => {
      el.removeEventListener('scroll', edges)
      sized?.disconnect()
    }
  }, [ref, on])
}

/** A table's box that scrolls sideways on a phone, with the fade at the edge that has more. */
export function Sideways({ className, children }: { className: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  useMoreEdges(box)
  return (
    <div className={`${className} more-edges`} ref={box}>
      {children}
    </div>
  )
}
