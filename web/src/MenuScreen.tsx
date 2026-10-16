import type { Ability } from '@sh/shared'
import { Top } from './jobs/common.tsx'
import { useAccess } from './role.ts'
import { useView } from './view.ts'
import { Icon, type IconName } from './Icon.tsx'

/**
 * The Menu (#menu, ADR 0035): every place in the app by name, grouped as
 * the work is, so the bar keeps only the places used all day and the rest
 * is one tap behind it. Everyone reads everything (ADR 0034), so a place
 * is left out only when it is for changing things the person's role can't:
 * `needs` names the kinds of change, checked as the screens check theirs.
 */

export interface Place {
  key: string
  /** Its picture, from the shared set, beside its name. */
  icon: IconName
  href: string
  label: string
  /** What's there, in a line. */
  about: string
  /** Shown only to a role that can make one of these kinds of change. */
  needs?: readonly Ability[]
}

export interface PlaceGroup {
  key: string
  label: string
  places: Place[]
}

export const MENU: PlaceGroup[] = [
  {
    key: 'jobs',
    label: 'Jobs',
    places: [
      {
        key: 'jobs',
        icon: 'calendar',
        href: '#jobs',
        label: 'Jobs',
        about: 'Every job, its phases, kit and crew',
      },
      {
        key: 'plan',
        icon: 'planner',
        href: '#plan',
        label: 'Planner',
        about: 'The weeks and months ahead at a glance',
      },
      {
        key: 'import',
        icon: 'download',
        href: '#import',
        label: 'Bring in from Google Calendar',
        about: 'Jobs already in the calendar',
        needs: ['jobs'],
      },
    ],
  },
  {
    key: 'stock',
    label: 'Stock',
    places: [
      {
        key: 'stock',
        icon: 'warehouse',
        href: '#stock',
        label: 'Stock',
        about: 'The catalogue, places and what needs repair',
      },
      {
        key: 'labels',
        icon: 'label',
        href: '#stock/labels',
        label: 'Labels',
        about: 'Print labels for kit',
      },
      {
        key: 'count',
        icon: 'count',
        href: '#stock/count',
        label: 'Counting',
        about: 'Stocktakes and rolling counts',
      },
      {
        key: 'testing',
        icon: 'inspection',
        href: '#stock/testing',
        label: 'PAT tests',
        about: 'Test a batch of kit',
      },
    ],
  },
  {
    key: 'crew',
    label: 'Crew',
    places: [
      {
        key: 'crew',
        icon: 'people',
        href: '#crew',
        label: 'Crew',
        about: 'People, calls and answers to check',
      },
      {
        key: 'leave',
        icon: 'leave',
        href: '#crew/leave',
        label: 'Leave',
        about: 'Time off for staff',
      },
    ],
  },
  {
    key: 'company',
    label: 'Company',
    places: [
      {
        key: 'admin',
        icon: 'settings',
        href: '#account',
        label: 'Admin',
        about: 'The office, calendar, backups, data and bringing lists in',
        needs: ['settings', 'company'],
      },
      {
        key: 'history',
        icon: 'history',
        href: '#history',
        label: 'History',
        about: 'Every change, who made it and when',
      },
    ],
  },
  {
    key: 'you',
    label: 'You',
    places: [
      {
        key: 'me',
        icon: 'person',
        href: '#me',
        label: 'You',
        about: 'Signing out, your own calendar feed and this device',
      },
    ],
  },
]

export function MenuScreen() {
  const view = useView()
  const { can } = useAccess()
  const show = (place: Place) => !place.needs || place.needs.some(can)
  return (
    <div className="app menu">
      <Top view={view} title="Menu" root />
      <nav className="places" aria-label="Every place">
        {MENU.map((group) => {
          const places = group.places.filter(show)
          if (places.length === 0) return null
          return (
            <div key={group.key} className="card" role="group" aria-labelledby={`menu-${group.key}`}>
              <h2 id={`menu-${group.key}`}>{group.label}</h2>
              <ul className="job-list">
                {places.map((p) => (
                  <li key={p.key}>
                    <a className="job-row" href={p.href}>
                      <span className="place-icon" aria-hidden="true">
                        <Icon name={p.icon} />
                      </span>
                      <div>
                        <b>{p.label}</b>
                        <p>{p.about}</p>
                      </div>
                      <div className="side" aria-hidden="true">
                        <Icon name="next" />
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </nav>
    </div>
  )
}
