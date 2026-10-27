import { useLayoutEffect, useRef } from 'react'

/** Where the top bar ends, for what stays under it: it grows on a phone when its words wrap. */
export function useUnderTop<T extends HTMLElement = HTMLElement>(on: boolean) {
  const el = useRef<T>(null)
  useLayoutEffect(() => {
    const top = document.querySelector<HTMLElement>('.top')
    if (!el.current || !top || typeof ResizeObserver === 'undefined') return
    const card = el.current
    const set = () => card.style.setProperty('--under-top', `${(parseFloat(getComputedStyle(top).top) || 0) + top.offsetHeight}px`)
    const watch = new ResizeObserver(set)
    watch.observe(top)
    set()
    return () => watch.disconnect()
  }, [on])
  return el
}
