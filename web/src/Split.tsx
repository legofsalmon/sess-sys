import type { ReactNode } from 'react'

/**
 * A page's main thing and what stands beside it (the design system's
 * supporting pane). On a phone the side comes first, as it holds what waits
 * on someone (answers to check, certificates running out), then the main;
 * from 1200px the main is the wide left column and the side a narrow right
 * one, each reading down on its own (app.css). An empty side leaves the main
 * the whole width.
 */
export function Split({ side, children }: { side?: ReactNode; children: ReactNode }) {
  return (
    <div className="split">
      <div className="side">{side}</div>
      <div className="main">{children}</div>
    </div>
  )
}
