import type { Ability } from '@sh/shared'
import { Top } from './jobs/common.tsx'
import { useAccess } from './role.ts'
import { useView } from './view.ts'

/**
 * The Menu (#menu, ADR 0035): every place in the app by name, grouped as
 * the work is, so the bar keeps only the places used all day and the rest
 * is one tap behind it. Everyone reads everything (ADR 0034), so a place
 * is left out only when it is for changing things the person's role can't:
 * `needs` names the kinds of change, checked as the screens check theirs.
 */

export interface Place {
  key: string
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
        href: '#jobs',
        label: 'Jobs',
        about: 'Every job, its phases, kit and crew',
      },
      {
        key: 'plan',
        href: '#jobs/plan',
        label: 'Planner',
        about: 'The weeks and months ahead at a glance',
      },
      {
        key: 'clients',
        href: '#jobs/clients',
        label: 'Clients',
        about: 'Who the jobs are for, their contacts and documents',
      },
      {
        key: 'venues',
        href: '#jobs/venues',
        label: 'Venues',
        about: 'Where the jobs are, their specs and documents',
      },
      {
        key: 'import',
        href: '#jobs/import',
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
        href: '#stock',
        label: 'Stock',
        about: 'The catalogue, and kit going out and coming back',
      },
      {
        key: 'places',
        href: '#stock/places',
        label: 'Places',
        about: 'Where kit is kept',
      },
      {
        key: 'labels',
        href: '#stock/labels',
        label: 'Labels',
        about: 'Print labels for kit',
      },
      {
        key: 'count',
        href: '#stock/count',
        label: 'Counting',
        about: 'Stocktakes and rolling counts',
      },
      {
        key: 'testing',
        href: '#stock/testing',
        label: 'Testing',
        about: 'Tests due, and testing a batch of kit',
      },
      {
        key: 'repairs',
        href: '#stock/repairs',
        label: 'Repairs',
        about: 'Faults and missing kit to sort out',
      },
      {
        key: 'import-stock',
        href: '#stock/import',
        label: 'Bring in the stock list',
        about: 'From a spreadsheet',
        needs: ['settings'],
      },
    ],
  },
  {
    key: 'crew',
    label: 'Crew',
    places: [
      {
        key: 'crew',
        href: '#crew',
        label: 'Crew',
        about: 'People, calls and answers to check',
      },
      {
        key: 'leave',
        href: '#crew/leave',
        label: 'Leave',
        about: 'Time off for staff',
      },
      {
        key: 'import-crew',
        href: '#crew/import',
        label: 'Bring in the crew list',
        about: 'From a spreadsheet',
        needs: ['settings'],
      },
    ],
  },
  {
    key: 'company',
    label: 'Company',
    places: [
      {
        key: 'admin',
        href: '#admin',
        label: 'Admin',
        about: 'The office, Google Calendar, backups and data',
        needs: ['settings', 'company'],
      },
      {
        key: 'history',
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
                      <div>
                        <b>{p.label}</b>
                        <p>{p.about}</p>
                      </div>
                      <div className="side" aria-hidden="true">
                        ›
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
