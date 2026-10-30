import { activeFilters, optionCounts, sortOf, type ListChoices, type ListFilter, type ListSort } from '@sh/shared'
import { useId, useState } from 'react'
import { Icon } from './Icon.tsx'

/**
 * Filter and sort on a long list (ADR 0099), the same on every one: under
 * the list's search, a Sort select and a Filter button that opens a select
 * for each filter, each choice with how many it would show. A filter that's
 * on shows itself twice: in the button's count, and as a chip under it that
 * takes it off, with how many of how many are showing and Clear filters. So
 * a list that looks short never hides why.
 *
 * What's chosen is kept for the tab's life, so Back from a job finds the
 * same list (places.ts), and the order is kept on this device too, as a
 * person's way of reading a list rarely changes. Filters aren't kept past
 * the tab: a list opened another day starts whole, rather than missing
 * something nobody remembers narrowing it to.
 */

const kept = new Map<string, ListChoices>()
const openPanels = new Set<string>()
const sortKey = (name: string) => `sh.sort.${name}`

function savedSort(name: string): string {
  try {
    return localStorage.getItem(sortKey(name)) ?? ''
  } catch {
    return ''
  }
}

/**
 * A list's choices, kept for the tab's life under `name`. `start` sets
 * filters as the list opens, such as the department a count on Home asked
 * for, over whatever was kept.
 */
export function useListChoices(name: string, start?: Readonly<Record<string, string>>): [ListChoices, (next: ListChoices) => void] {
  const [choices, setChoices] = useState<ListChoices>(() => {
    const was = kept.get(name) ?? { sort: savedSort(name), filters: {} }
    return start ? { ...was, filters: { ...was.filters, ...start } } : was
  })
  const set = (next: ListChoices) => {
    kept.set(name, next)
    if (next.sort !== choices.sort)
      try {
        localStorage.setItem(sortKey(name), next.sort)
      } catch {
        // Kept for the tab's life all the same.
      }
    setChoices(next)
  }
  return [choices, set]
}

export function ListTools<T>({
  name,
  items,
  filters,
  sorts,
  choices,
  onChange,
  shown,
  what,
}: {
  /** The list's name, as given to useListChoices. */
  name: string
  /** The list as its search and tabs leave it, before these filters: what the counts count. */
  items: readonly T[]
  filters: readonly ListFilter<T>[]
  sorts: readonly ListSort<T>[]
  choices: ListChoices
  onChange: (next: ListChoices) => void
  /** How many the filters leave. */
  shown: number
  /** What the list is of, in the plural: "jobs". */
  what: string
}) {
  const id = useId()
  const [open, setOpen] = useState(() => openPanels.has(name))
  const offered = filters.filter((f) => f.options.length > 0)
  const active = activeFilters(offered, choices.filters)
  const sort = sortOf(sorts, choices.sort)
  const setFilter = (key: string, value: string) => onChange({ ...choices, filters: { ...choices.filters, [key]: value } })
  const toggle = () => {
    if (open) openPanels.delete(name)
    else openPanels.add(name)
    setOpen(!open)
  }
  return (
    <div className="list-tools">
      <div className="list-tools-row">
        {sorts.length > 1 && (
          <label className="list-sort">
            <Icon name="sort" />
            <span>Sort</span>
            {/* Named by its label's word alone, not the word and every order in it. */}
            <select aria-label="Sort" value={sort?.key ?? ''} onChange={(e) => onChange({ ...choices, sort: e.target.value })}>
              {sorts.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {offered.length > 0 && (
          <button type="button" className="list-filter-button" aria-expanded={open} aria-controls={`${id}-filters`} onClick={toggle}>
            <Icon name="filter" />
            Filter{active.length > 0 && ` (${active.length})`}
          </button>
        )}
      </div>
      {offered.length > 0 && (
        <div className="list-filters" id={`${id}-filters`} hidden={!open} role="group" aria-label={`Filter the ${what}`}>
          {offered.map((f) => {
            const { any, counts } = optionCounts(items, offered, choices.filters, f)
            const value = active.find((a) => a.filter.key === f.key)?.option.key ?? ''
            return (
              <label key={f.key}>
                {f.label}
                <select aria-label={f.label} value={value} onChange={(e) => setFilter(f.key, e.target.value)}>
                  <option value="">
                    {f.any} ({any.toLocaleString('en-IE')})
                  </option>
                  {f.options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label} ({(counts.get(o.key) ?? 0).toLocaleString('en-IE')})
                    </option>
                  ))}
                </select>
              </label>
            )
          })}
        </div>
      )}
      {/* Read out as it changes: the list under it is shorter or longer than it was. */}
      <div aria-live="polite">
        {active.length > 0 && (
          <div className="list-active">
            {active.map(({ filter, option }) => (
              <button key={filter.key} type="button" className="list-chip" onClick={() => setFilter(filter.key, '')} aria-label={`Take off the filter ${filter.label}: ${option.label}`}>
                {option.label}
                <Icon name="close" />
              </button>
            ))}
            <span className="list-count">
              {shown.toLocaleString('en-IE')} of {items.length.toLocaleString('en-IE')} {what}.
            </span>
            <button type="button" className="link" onClick={() => onChange({ ...choices, filters: {} })}>
              Clear filters
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
