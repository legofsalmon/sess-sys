/**
 * The way up from a page to the one above it, in the top bar so it stays in
 * view however far down the page is scrolled (the design system's Up,
 * navigation.md). It always goes to the same parent from the same page,
 * however the person got there; the browser's own Back is history.
 *
 * On a phone it is one link to the parent, "‹ All jobs". On a desk (900px
 * and up, where the places are a sidebar) there is room to say the whole
 * way down as breadcrumbs, "Jobs › Vicar Street › Pick list", each a link
 * but the page itself. An area's own screen has neither: it is the top.
 */

export interface Step {
  href: string
  /** Its name in the breadcrumbs: "Jobs". */
  label: string
  /** Its name as the one way up on a phone, where that reads better: "All jobs". */
  up?: string
}

/** The areas' own screens, where most trails start. */
export const JOBS: Step = { href: '#jobs', label: 'Jobs', up: 'All jobs' }
export const STOCK: Step = { href: '#stock', label: 'Stock', up: 'All stock' }
export const CREW: Step = { href: '#crew', label: 'Crew' }
export const MENU: Step = { href: '#menu', label: 'Menu' }
export const ADMIN: Step = { href: '#admin', label: 'Admin' }

/** Pages along an area's row (Views.tsx) that have pages of their own beneath them. */
export const CLIENTS: Step = { href: '#jobs/clients', label: 'Clients', up: 'All clients' }
export const VENUES: Step = { href: '#jobs/venues', label: 'Venues', up: 'All venues' }
export const MONEY: Step = { href: '#jobs/money', label: 'Money' }
export const PLACES: Step = { href: '#stock/places', label: 'Places', up: 'All places' }
export const LABELS: Step = { href: '#stock/labels', label: 'Labels' }
export const PEOPLE: Step = { href: '#crew/people', label: 'People', up: 'All people' }
export const TIMESHEETS: Step = { href: '#crew/timesheets', label: 'Timesheets' }

export interface Trail {
  /** From the area down to the parent: [Jobs, Vicar Street]. */
  steps: readonly Step[]
  /** The page itself, the breadcrumbs' last word; left out where its title says it at once. */
  here?: string
}

export function Up({ steps, here }: Trail) {
  const parent = steps.at(-1)
  if (!parent) return null
  return (
    <div className="up">
      <a className="up-link" href={parent.href}>
        ‹ {parent.up ?? parent.label}
      </a>
      <nav className="crumbs" aria-label="Breadcrumb">
        <ol>
          {steps.map((s) => (
            <li key={s.href}>
              <a href={s.href}>{s.label}</a>
            </li>
          ))}
          {here && (
            <li>
              <span aria-current="page">{here}</span>
            </li>
          )}
        </ol>
      </nav>
    </div>
  )
}
