import { dsTiming } from '@sh/shared'
import { useEffect, useState } from 'react'

/**
 * True once work has run past the design system's wait (one second), false
 * again when it ends. A press that answers within a second shows only that it
 * landed; past it, the button says what is working ("Checking…"). Under a
 * second, words that flash past are noise (design system rule 16).
 */
export function useLate(busy: boolean): boolean {
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!busy) return setLate(false)
    const t = setTimeout(() => setLate(true), dsTiming.wait)
    return () => clearTimeout(t)
  }, [busy])
  return busy && late
}
