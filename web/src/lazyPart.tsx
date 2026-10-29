import { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react'

/**
 * A part of a screen whose code comes down only the first time it's shown,
 * and is kept on the phone from then on (vite.config.ts): the map (ADR 0057)
 * and the rack in 3D (ADR 0076), which most phones never open, so they're
 * not in every phone's download on every deploy (audit, 20 October 2026,
 * finding 65). Shown first with no signal, its code can't come: a line says
 * so in its place, the rest of the screen carries on, and it's fetched again
 * once the signal is back.
 */
export function lazyPart<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  let Part = lazy(load)
  return function LazyPart({ waiting, missing, ...props }: P & { waiting: ReactNode; missing: ReactNode }) {
    const [tries, setTries] = useState(0)
    const again = () => {
      // React keeps a lazy part's failure: a new one asks again.
      Part = lazy(load)
      setTries((n) => n + 1)
    }
    return (
      <Missing key={tries} missing={missing} onBack={again}>
        <Suspense fallback={waiting}>
          <Part {...(props as unknown as P)} />
        </Suspense>
      </Missing>
    )
  }
}

/** The code didn't come: what the browser says when a file it was to import can't be fetched. */
const unfetched = (err: unknown) =>
  !navigator.onLine || (err instanceof Error && /dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to fetch/i.test(err.message))

class Missing extends Component<{ missing: ReactNode; onBack: () => void; children: ReactNode }, { failed?: unknown }> {
  state: { failed?: unknown } = {}
  static getDerivedStateFromError(failed: unknown) {
    return { failed }
  }
  private back = () => this.props.onBack()
  componentDidUpdate() {
    if (this.state.failed !== undefined) addEventListener('online', this.back, { once: true })
  }
  componentWillUnmount() {
    removeEventListener('online', this.back)
  }
  render() {
    const { failed } = this.state
    if (failed === undefined) return this.props.children
    // Anything else wrong in the part is a fault, not the signal: it goes on up as it would have.
    if (!unfetched(failed)) throw failed
    return this.props.missing
  }
}
