/**
 * An area's pages, side by side in one row under its header (ADR 0041's
 * tidy-up of where things live): Jobs' List, Week, Month, Clients and
 * Venues, and Money for the roles that see it (ADR 0042); Stock's Catalogue, Places, Labels, Counting, Testing, Repairs and Vehicles;
 * Crew's Calls, People, Leave and Timesheets
 * (crew/CrewViews.tsx, as its counts are the Crew tab's). Moving along the row is lateral, so
 * these pages have no way up: the row is how to get between them, and the
 * current one is marked. On a phone a row longer than the screen scrolls
 * sideways, keeping the current one in view.
 */

import type { View } from '@sh/shared'
import { useEffect, useRef } from 'react'

export interface AreaPage {
  key: string
  href: string
  label: string
  /** Things waiting there, said after its name: repairs open, tests due. */
  count?: number
}

export function Views({ label, pages, current }: { label: string; pages: readonly AreaPage[]; current: string }) {
  const row = useRef<HTMLElement>(null)
  // The current page in view, where the row is wider than the phone.
  useEffect(() => {
    row.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [current])
  return (
    <nav className="views" aria-label={label} ref={row}>
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
        { key: 'vehicles', href: '#stock/vehicles', label: 'Vehicles', count: vehicles },
      ]}
    />
  )
}
