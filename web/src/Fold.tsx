import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Two ways to keep a screen short on a phone (audit finding 16): a form
 * stays behind its button until it's wanted, and a long list shows its
 * first few with the rest a tap away.
 */

/**
 * The form behind a button: "Add person" opens it in place, with the cursor
 * in its first field, and Close puts it away. Put away, not thrown away:
 * once opened the form stays, hidden, so whatever was typed is still there
 * when it opens again.
 */
export function Fold({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  // Opened at least once: from then on the form is kept, open or not.
  const [kept, setKept] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const closed = useRef(false)
  useEffect(() => {
    if (open) box.current?.querySelector<HTMLElement>('input, select, textarea')?.focus()
    // Close goes as the form does, so on a keyboard the focus goes back to the button rather than being lost.
    else if (closed.current) opener.current?.focus()
  }, [open])
  return (
    <>
      {!open && (
        <button
          type="button"
          className={className}
          onClick={() => {
            setKept(true)
            setOpen(true)
          }}
          ref={opener}
        >
          {label}
        </button>
      )}
      {kept && (
        <div className="fold" ref={box} hidden={!open}>
          {children}
          <button
            type="button"
            className="link"
            onClick={() => {
              closed.current = true
              setOpen(false)
            }}
          >
            Close
          </button>
        </div>
      )}
    </>
  )
}

/**
 * The first few of a list, and "Show all 42 products" for the rest; `what`
 * names them. Anything `keep` picks out, such as kit that's short, stays in
 * view wherever it is in the list, so nothing to act on is a tap away.
 */
export function ShowAll<T>({
  items,
  limit = 5,
  what,
  keep,
  children,
}: {
  items: readonly T[]
  limit?: number
  what: string
  keep?: (item: T) => boolean
  children: (shown: readonly T[]) => ReactNode
}) {
  const [all, setAll] = useState(false)
  const shown = all || items.length <= limit ? items : items.filter((x, i) => i < limit || keep?.(x))
  return (
    <>
      {children(shown)}
      {shown.length < items.length && (
        <button type="button" className="link show-all" onClick={() => setAll(true)}>
          Show all {items.length} {what}
        </button>
      )}
    </>
  )
}
