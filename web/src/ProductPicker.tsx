import { DEPARTMENT_LABELS, findProducts, kitKey, type Found, type Model } from '@sh/shared'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

/** Offers shown at once; past these a line says how many more, to type more and narrow. */
const SHOWN = 8

type Product = Pick<Model, 'id' | 'name' | 'department' | 'category' | 'aliases'>

/** A row under the products that isn't one: "Not kit", "New product…". */
export interface PickerAction {
  key: string
  label: string
}

/**
 * Choosing one product from the stock list by typing (ADR 0070), in place of
 * a long dropdown: the design system's combobox, picking one record. What's
 * typed can be anywhere in the name, in another name the product goes by, or
 * its category or department (findProducts), and each offer says which other
 * name found it. With nothing typed it offers the ones given first (Kit from
 * the notes' "most like it"). While something is typed the first offer is
 * highlighted, the one Enter takes; Up and Down move it, Escape closes the
 * list and then puts back the chosen name. Rows that aren't products (Not
 * kit, New product…) are always last. Leaving the field puts the chosen name
 * back, unless what's typed is a product's name exactly, which is then taken:
 * what's typed is a search, not a value.
 */
export function ProductPicker({
  label,
  products,
  value,
  shownAs,
  first = [],
  firstLabel = 'Most like it',
  actions = [],
  onPick,
  onAction,
  disabled,
  placeholder = 'Type to find a product',
  hint,
  className,
}: {
  label: string
  products: readonly Product[]
  /** The chosen product's id, or '' for none. */
  value: string
  /** What the field says when no product is chosen but an action is, such as "Not kit". */
  shownAs?: string
  first?: readonly Product[]
  firstLabel?: string
  actions?: readonly PickerAction[]
  onPick: (id: string) => void
  onAction?: (key: string) => void
  disabled?: boolean
  placeholder?: string
  hint?: string
  className?: string
}) {
  const chosen = products.find((p) => p.id === value)
  const said = chosen?.name ?? shownAs ?? ''
  // What's typed while searching; null when the field shows what's chosen.
  const [text, setText] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [moved, setMoved] = useState<number | null>(null)
  const [heard, setHeard] = useState('')
  const list = useRef<HTMLUListElement>(null)
  const id = useId()

  const typed = text !== null && kitKey(text) !== ''
  const found: Found<Product>[] = typed ? findProducts(products, text) : first.map((p) => ({ product: p }))
  const offers = found.slice(0, SHOWN)
  const more = found.length - offers.length
  const rows: ({ kind: 'product'; f: Found<Product> } | { kind: 'action'; a: PickerAction })[] = [
    ...offers.map((f) => ({ kind: 'product' as const, f })),
    ...actions.map((a) => ({ kind: 'action' as const, a })),
  ]
  const shown = open && !disabled && (rows.length > 0 || typed)
  const active = shown ? (moved ?? (typed && offers.length ? 0 : -1)) : -1

  useEffect(() => {
    if (active >= 0) list.current?.querySelector(`[id="${id}-${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, id])

  const done = () => {
    setText(null)
    setOpen(false)
    setMoved(null)
  }
  const take = (i: number) => {
    const row = rows[i]
    if (!row) return
    done()
    if (row.kind === 'product') {
      onPick(row.f.product.id)
      setHeard(`Chose ${row.f.product.name}.`)
    } else {
      onAction?.(row.a.key)
      setHeard(`Chose ${row.a.label.replace(/…$/, '')}.`)
    }
  }
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!shown) return setOpen(true)
      const last = rows.length - 1
      if (last < 0) return
      setMoved(e.key === 'ArrowDown' ? (active >= last ? 0 : active + 1) : active <= 0 ? last : active - 1)
      return
    }
    if (e.key === 'Enter' && shown && active >= 0) {
      e.preventDefault()
      return take(active)
    }
    if (e.key === 'Escape' && (shown || text !== null)) {
      e.preventDefault()
      e.stopPropagation()
      // The first Escape closes the list and keeps what's typed; the next puts the chosen name back.
      if (shown) {
        setOpen(false)
        setMoved(null)
      } else setText(null)
    }
  }

  return (
    <div className={`picker-field${className ? ` ${className}` : ''}`}>
      <span id={`${id}-label`}>{label}</span>
      <div className="skills-anchor">
        <input
          role="combobox"
          aria-labelledby={`${id}-label`}
          aria-describedby={hint ? `${id}-hint` : undefined}
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={`${id}-list`}
          aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
          value={text ?? said}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            setMoved(null)
            setOpen(true)
          }}
          onKeyDown={key}
          onFocus={(e) => {
            // The chosen name is selected, so typing starts a new search and an arrow key or a click keeps it.
            e.target.select()
            setOpen(true)
          }}
          onClick={() => setOpen(true)}
          onBlur={() => {
            const exact = text !== null && products.find((p) => kitKey(p.name) === kitKey(text))
            if (exact && exact.id !== value) {
              onPick(exact.id)
              setHeard(`Chose ${exact.name}.`)
            }
            done()
          }}
        />
        <ul ref={list} className="skill-options picker-options" id={`${id}-list`} role="listbox" aria-label={typed ? 'Found' : firstLabel} hidden={!shown}>
          {!typed && offers.length > 0 && (
            <li className="note" role="presentation">
              {firstLabel}
            </li>
          )}
          {typed && offers.length === 0 && (
            <li className="note" role="presentation">
              Nothing in the stock list has “{text.trim()}” in it
            </li>
          )}
          {rows.map((r, i) => {
            const note =
              i === offers.length && more > 0 ? (
                <li key="more" className="note" role="presentation">
                  {more.toLocaleString('en-IE')} more: type more to narrow it down
                </li>
              ) : null
            const meta =
              r.kind === 'product'
                ? [r.f.via && `Also called ${r.f.via}`, DEPARTMENT_LABELS[r.f.product.department], r.f.product.category].filter(Boolean).join(' · ')
                : ''
            return [
              note,
              <li
                key={r.kind === 'product' ? r.f.product.id : `action-${r.a.key}`}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === active}
                className={r.kind === 'action' ? 'new' : undefined}
                // Chosen on the press, before the field loses focus and puts the chosen name back.
                onMouseDown={(e) => {
                  e.preventDefault()
                  take(i)
                }}
              >
                <span>{r.kind === 'product' ? r.f.product.name : r.a.label}</span>
                {meta && <small>{meta}</small>}
              </li>,
            ]
          })}
          {more > 0 && actions.length === 0 && (
            <li className="note" role="presentation">
              {more.toLocaleString('en-IE')} more: type more to narrow it down
            </li>
          )}
        </ul>
      </div>
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      <span className="sr-only" aria-live="polite">
        {heard}
      </span>
    </div>
  )
}
