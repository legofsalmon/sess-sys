import { useEffect } from 'react'

/**
 * A keyboard scanner's read on a screen made for scanning (audit, 20
 * October 2026, finding 98): the pick list, a count and testing a batch.
 * A move lands focus on the screen's heading (Shell.tsx), for a screen
 * reader, and a field focused on arrival would raise a phone's keyboard,
 * so the scan field isn't focused; instead a key typed with nothing
 * focused to take it (not a field, nor a key held with Ctrl, Alt or the
 * Command key) goes to the scan field, and the browser types it there.
 * Space and Enter stay a button's own. A field focused this way is marked
 * to keep the phone's own keyboard down, as a scanner is typing; a tap on
 * the field, or leaving it, brings the keyboard back for typing by hand.
 */
export function useScanKeys(on = true) {
  useEffect(() => {
    if (!on) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1 || e.key === ' ') return
      const at = e.target instanceof Element ? e.target : null
      if (at?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
      const field = document.querySelector<HTMLInputElement>('.scan-row input:not(:disabled)')
      if (!field) return
      field.inputMode = 'none'
      field.addEventListener('blur', () => (field.inputMode = ''), { once: true })
      field.focus()
    }
    // A tap on the field is someone typing by hand: the keyboard comes back.
    const onTap = (e: PointerEvent) => {
      const field = e.target instanceof Element ? e.target.closest<HTMLInputElement>('.scan-row input') : null
      if (field?.inputMode === 'none') field.inputMode = ''
    }
    addEventListener('keydown', onKey)
    addEventListener('pointerdown', onTap)
    return () => {
      removeEventListener('keydown', onKey)
      removeEventListener('pointerdown', onTap)
    }
  }, [on])
}
