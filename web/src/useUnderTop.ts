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

/**
 * The bar's bottom, kept on the page as --top-bar for its scroll padding (app.css): the browser's own way of stopping a row focused by
 * Tab clear of the bar at the top and the tabs at the foot, rather than half under either (audit, 20 October 2026, finding 78).
 */
export function useTopBar<T extends HTMLElement = HTMLElement>() {
  const bar = useRef<T>(null)
  useLayoutEffect(() => {
    const top = bar.current
    if (!top || typeof ResizeObserver === 'undefined') return
    const root = document.documentElement
    const set = () => root.style.setProperty('--top-bar', `${(parseFloat(getComputedStyle(top).top) || 0) + top.offsetHeight}px`)
    const watch = new ResizeObserver(set)
    watch.observe(top)
    set()
    return () => watch.disconnect()
  }, [])
  return bar
}
