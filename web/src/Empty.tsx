import type { ReactNode } from 'react'

/** An empty list says the same thing everywhere (audit finding 24), then the screen's own line: what to do about it. */
export function Empty({ children }: { children?: ReactNode }) {
  return (
    <p className="empty">
      Nothing here yet.
      {children && <> {children}</>}
    </p>
  )
}
