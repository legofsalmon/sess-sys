/**
 * An area's pages, side by side in one row under its header (ADR 0041's
 * tidy-up of where things live): Jobs' List, Week, Month, Clients and
 * Venues, and Money for the roles that see it (ADR 0042); Stock's Catalogue, Places, Labels, Counting, Testing, Repairs, Racks (ADR 0074), Vehicles and the Purchase list (ADR 0077);
 * Crew's Calls, People, Leave and Timesheets
 * (crew/CrewViews.tsx, as its counts are the Crew tab's). Moving along the row is lateral, so
 * these pages have no way up: the row is how to get between them, and the
 * current one is marked. The row comes first under the bar, before the
 * page's title (Top's `views`). A row longer than the screen, as on a phone,
 * stays one line and scrolls sideways: the current page is brought into
 * view, and the edge with more past it fades, so no page is hidden off the
 * edge with nothing to say so (audit P2 23).
 */

import type { View } from '@sh/shared'
import { useLayoutEffect, useRef } from 'react'
import { useMoreEdges } from './more.tsx'

export interface AreaPage {
  key: string
  href: string
  label: string
  /** Things waiting there, said after its name: repairs open, tests due. */
  count?: number
}

export function Views({ label, pages, current }: { label: string; pages: readonly AreaPage[]; current: string }) {
  const row = useRef<HTMLElement>(null)
  // The current page brought into view; the edge with more past it fades (more.tsx).
  useLayoutEffect(() => {
    const el = row.current
    const at = el?.querySelector<HTMLElement>('[aria-current]')
    if (el && at && (at.offsetLeft < el.scrollLeft || at.offsetLeft + at.offsetWidth > el.scrollLeft + el.clientWidth))
      el.scrollLeft = at.offsetLeft - (el.clientWidth - at.offsetWidth) / 2
  }, [current])
  useMoreEdges(row)
  return (
    <nav className="views more-edges" aria-label={label} ref={row}>
      {pages.map((p) => (
        <a key={p.key} href={p.href} aria-current={p.key === current ? 'page' : undefined}>
          {p.label}
          {!!p.count && <span className="views-count"> {p.count}</span>}
        </a>
      ))}
    </nav>
  )
}

/** Stock's row: what the warehouse looks at, each a page, with the tests overdue and the repairs open counted on theirs. */
export function StockViews({ view, current }: { view: View; current: string }) {
  const tests = view.inspections.attention.filter((d) => d.state !== 'soon').length
  const repairs = view.faults.open.length
  // Vehicles whose road checks have run out: they can't be booked until someone updates them (ADR 0047).
  const vehicles = new Set(view.vehicles.reminders.filter((r) => r.ranOut && r.kind !== 'service').map((r) => r.vehicle.id)).size
  return (
    <Views
      label="Stock pages"
      current={current}
      pages={[
        { key: 'catalogue', href: '#stock', label: 'Catalogue' },
        { key: 'places', href: '#stock/places', label: 'Places' },
        { key: 'labels', href: '#stock/labels', label: 'Labels' },
        { key: 'count', href: '#stock/count', label: 'Counting' },
        { key: 'testing', href: '#stock/testing', label: 'Testing', count: tests },
        { key: 'repairs', href: '#stock/repairs', label: 'Repairs', count: repairs },
        { key: 'racks', href: '#stock/racks', label: 'Racks' },
        { key: 'vehicles', href: '#stock/vehicles', label: 'Vehicles', count: vehicles },
        { key: 'buy', href: '#stock/buy', label: 'Purchase list' },
      ]}
    />
  )
}
