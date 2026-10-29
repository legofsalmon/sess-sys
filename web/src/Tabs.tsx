import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

/**
 * A page's parts as tabs (the design system's tabs), one at a time: a job's
 * (ADR 0059), Admin's, a person's and a product's (ADR 0082). One Tab stop;
 * Left and Right move and open, Home and End go to the ends. A count after a
 * part's name where it helps: a job's phases, its crew booked of those
 * needed, a person's jobs worked.
 */
export function Tabs<K extends string>({
  label,
  id,
  parts,
  labels,
  current,
  counts = {},
  onPick,
}: {
  /** What the parts are of, for a screen reader: "Parts of the job". */
  label: string
  /** Names the tabs and their panel: `${id}-tab-${part}` and `${id}-part`. */
  id: string
  parts: readonly K[]
  labels: Record<K, string>
  current: K
  counts?: Partial<Record<K, ReactNode>>
  onPick: (p: K) => void
}) {
  const row = useRef<HTMLDivElement>(null)
  // The current part in view, where the row is wider than the phone.
  useEffect(() => {
    row.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [current])
  const key = (e: KeyboardEvent<HTMLButtonElement>) => {
    const at = parts.indexOf(current)
    const to =
      e.key === 'ArrowRight' ? (at + 1) % parts.length : e.key === 'ArrowLeft' ? (at - 1 + parts.length) % parts.length : e.key === 'Home' ? 0 : e.key === 'End' ? parts.length - 1 : -1
    if (to < 0) return
    e.preventDefault()
    onPick(parts[to]!)
    row.current?.querySelector<HTMLElement>(`#${id}-tab-${parts[to]}`)?.focus()
  }
  return (
    <div className="part-tabs" role="tablist" aria-label={label} ref={row}>
      {parts.map((p) => (
        <button
          key={p}
          type="button"
          role="tab"
          id={`${id}-tab-${p}`}
          aria-selected={p === current}
          aria-controls={`${id}-part`}
          tabIndex={p === current ? 0 : -1}
          onClick={() => onPick(p)}
          onKeyDown={key}
        >
          {labels[p]}
          {counts[p] !== undefined && counts[p] !== '' && (
            <>
              {' '}
              <span className="part-count">{counts[p]}</span>
            </>
          )}
        </button>
      ))}
    </div>
  )
}

/** The panel under the tabs, holding the open part. */
export function TabPanel<K extends string>({ id, current, children }: { id: string; current: K; children: ReactNode }) {
  return (
    <div className="tab-part" role="tabpanel" id={`${id}-part`} aria-labelledby={`${id}-tab-${current}`}>
      {children}
    </div>
  )
}

/**
 * Which part is open: the one the address names, else the one picked here,
 * else the last one looked at on this device ("a fold remembers"), else the
 * first. Picking one puts it in the address without a step in the history,
 * so a reload or a shared link keeps it and Back still goes up.
 */
export function useTab<K extends string>({
  parts,
  asked,
  remember,
  address,
}: {
  parts: readonly K[]
  asked?: string
  /** The localStorage key for the last part looked at (a wire name of this app's). */
  remember: string
  address: (p: K) => string
}): [K, (p: K) => void] {
  const [picked, setPicked] = useState<K | undefined>()
  useEffect(() => setPicked(undefined), [asked])
  let last: string | null = null
  try {
    last = localStorage.getItem(remember)
  } catch {
    // Storage that's off just doesn't remember.
  }
  const known = (p: string | null | undefined): p is K => !!p && parts.includes(p as K)
  const current = picked ?? (known(asked) ? asked : known(last) ? last : parts[0]!)
  const pick = (p: K) => {
    setPicked(p)
    try {
      localStorage.setItem(remember, p)
    } catch {
      // As above.
    }
    history.replaceState(history.state, '', address(p))
  }
  return [current, pick]
}
