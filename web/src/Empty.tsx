import type { ReactNode } from 'react'

/** A screen's own line that already says there's nothing, in its own words: "No lines yet.", "Nothing to tidy", "Nobody owes anything". */
const SAYS_SO = /^(no|nothing|nobody|none)\b/i

/**
 * An empty list says the same thing everywhere (audit finding 24), then the screen's own line: what to do about it. Said once:
 * where the screen's line already says there's nothing, it's said in those words alone.
 */
export function Empty({ children }: { children?: ReactNode }) {
  if (typeof children === 'string' && SAYS_SO.test(children.trim())) return <p className="empty">{children}</p>
  return (
    <p className="empty">
      Nothing here yet.
      {children && <> {children}</>}
    </p>
  )
}
