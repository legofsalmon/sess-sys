import type { Ability } from '@sh/shared'
import { Top } from './jobs/common.tsx'
import { useAccess } from './role.ts'
import { useView } from './view.ts'
import { Icon, type IconName } from './Icon.tsx'

/**
 * The Menu (#menu, ADR 0035): every place in the app by name, grouped as
 * the work is, so the bar keeps only the places used all day and the rest
 * is one tap behind it. Everyone reads everything (ADR 0034) but money
 * (ADR 0042), so a place is left out only when it is for changing things
 * the person's role can't, or for money: `needs` names the kinds of change,
 * checked as the screens check theirs.
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
        href: '#jobs/plan',
        label: 'Planner',
        about: 'The weeks and months ahead at a glance',
      },
      {
        key: 'clients',
        icon: 'company',
        href: '#jobs/clients',
        label: 'Clients',
        about: 'Who the jobs are for, their contacts and documents',
      },
      {
        key: 'venues',
        icon: 'venue',
        href: '#jobs/venues',
        label: 'Venues',
        about: 'Where the jobs are, their specs and documents',
      },
      {
        key: 'money',
        icon: 'document',
        href: '#jobs/money',
        label: 'Money',
        about: "Quotes, what's owed, and files for the accountant",
        needs: ['money'],
      },
      {
        key: 'notes-kit',
        icon: 'kit',
        href: '#jobs/notes-kit',
        label: 'Kit in the notes',
        about: "Kit lists in jobs' notes, turned into kit lines",
        needs: ['kit'],
      },
      {
        key: 'import',
        icon: 'download',
        href: '#jobs/import',
        label: 'Bring in from Google Calendar',
        about: 'Jobs already in the calendar',
        needs: ['jobs'],
      },
      {
        key: 'tidy',
        icon: 'edit',
        href: '#jobs/tidy',
        label: 'Tidy up what came in',
        about: 'Jobs brought in as several, names, venues and clients',
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
        icon: 'kit',
        href: '#stock',
        label: 'Stock',
        about: 'The catalogue, and kit going out and coming back',
      },
      {
        key: 'places',
        icon: 'warehouse',
        href: '#stock/places',
        label: 'Places',
        about: 'Where kit is kept',
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
        label: 'Testing',
        about: 'Tests due, and testing a batch of kit',
      },
      {
        key: 'repairs',
        icon: 'repair',
        href: '#stock/repairs',
        label: 'Repairs',
        about: 'Faults and missing kit to sort out',
      },
      {
        key: 'racks',
        icon: 'case',
        href: '#stock/racks',
        label: 'Racks',
        about: 'Kit built into rack cases, and what goes where',
      },
      {
        key: 'vehicles',
        icon: 'van',
        href: '#stock/vehicles',
        label: 'Vehicles',
        about: 'The vans, their checks, and the jobs they are on',
      },
      {
        key: 'buy',
        icon: 'kit',
        href: '#stock/buy',
        label: 'Purchase list',
        about: 'Kit the crew ask to be bought, and their votes',
      },
      {
        key: 'import-stock',
        icon: 'download',
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
        icon: 'message',
        href: '#crew',
        label: 'Calls',
        about: 'Crew needed, and answers to check',
      },
      {
        key: 'people',
        icon: 'people',
        href: '#crew/people',
        label: 'People',
        about: 'Everyone on the crew list, and certificates running out',
      },
      {
        key: 'leave',
        icon: 'leave',
        href: '#crew/leave',
        label: 'Leave',
        about: 'Time off for staff',
      },
      {
        key: 'timesheets',
        icon: 'timesheet',
        href: '#crew/timesheets',
        label: 'Timesheets',
        about: 'To approve, and not in yet',
      },
      {
        key: 'import-crew',
        icon: 'download',
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
        icon: 'settings',
        href: '#admin',
        label: 'Admin',
        about: "The office, Google Calendar, backups, data and what's changed",
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
      {
        key: 'notifications',
        icon: 'notifications',
        href: '#notifications',
        label: 'Notifications',
        about: "What others changed on the jobs you're on or made, and on your own things",
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
