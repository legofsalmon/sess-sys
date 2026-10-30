import { crewFill, type JobView } from './sync/jobs-view.ts'
import type { QuoteRow } from './sync/money-view.ts'
import type { PersonView } from './sync/crew-view.ts'
import { DEPARTMENT_LABELS, type Department } from './stock.ts'
import { KIND_LABELS, PROJECT_KINDS, PROJECT_STATUSES, STATUS_LABELS, STOPPED } from './jobs.ts'
import { APPLICANT_LEVEL, LEVELS, levelLine } from './crew-departments.ts'

/**
 * Filter and sort for the long lists (ADR 0099): Jobs, Quotes, People,
 * the Catalogue, Venues and Clients put in order and narrowed the same way.
 * Each list names its ways of ordering (the first is the one it opens on)
 * and its filters, each a few plain choices; the screen draws them with
 * one shared part (web/src/ListTools.tsx). A filter left on "any" narrows
 * nothing. Counts beside a choice are what the list would show with it,
 * the list's other filters and its search as they are, so a choice with
 * nothing in it says so before it's pressed.
 */

/** One way to put a list in order. Ties keep the list's own order. */
export interface ListSort<T> {
  key: string
  label: string
  compare: (a: T, b: T) => number
}

/** One choice in a filter, and what it keeps. */
export interface ListOption<T> {
  key: string
  label: string
  test: (item: T) => boolean
}

/** A filter: its name, the words for "any", and its choices. */
export interface ListFilter<T> {
  key: string
  label: string
  /** What it says when it narrows nothing, such as "Any status". */
  any: string
  options: readonly ListOption<T>[]
}

/** What's chosen on a list: the order, and each filter's choice ('' or missing for any). */
export interface ListChoices {
  sort: string
  filters: Readonly<Record<string, string>>
}

/** Whether an item passes every filter but `except`, which is left out so its own choices can be counted. */
function passes<T>(item: T, filters: readonly ListFilter<T>[], chosen: ListChoices['filters'], except?: string): boolean {
  for (const f of filters) {
    if (f.key === except) continue
    const key = chosen[f.key]
    if (!key) continue
    const option = f.options.find((o) => o.key === key)
    if (option && !option.test(item)) return false
  }
  return true
}

/** The filters actually narrowing: a choice the list no longer offers narrows nothing. */
export function activeFilters<T>(filters: readonly ListFilter<T>[], chosen: ListChoices['filters']): { filter: ListFilter<T>; option: ListOption<T> }[] {
  return filters.flatMap((filter) => {
    const option = filter.options.find((o) => o.key === chosen[filter.key])
    return option ? [{ filter, option }] : []
  })
}

/** The sort chosen, or the list's first when the one chosen isn't offered here. */
export function sortOf<T>(sorts: readonly ListSort<T>[], key: string): ListSort<T> | undefined {
  return sorts.find((s) => s.key === key) ?? sorts[0]
}

/** The items that pass the filters, in the order chosen. The list's own order breaks ties, so nothing jumps about. */
export function listed<T>(items: readonly T[], filters: readonly ListFilter<T>[], sorts: readonly ListSort<T>[], choices: ListChoices): T[] {
  const kept = items.filter((item) => passes(item, filters, choices.filters))
  const sort = sortOf(sorts, choices.sort)
  if (!sort) return kept
  const at = new Map(items.map((item, i) => [item, i]))
  return kept.sort((a, b) => sort.compare(a, b) || at.get(a)! - at.get(b)!)
}

/** How many each choice of a filter would show, the other filters as they are; `any` is the count with this filter on any. */
export function optionCounts<T>(items: readonly T[], filters: readonly ListFilter<T>[], chosen: ListChoices['filters'], filter: ListFilter<T>): { any: number; counts: Map<string, number> } {
  const counts = new Map<string, number>(filter.options.map((o) => [o.key, 0]))
  let any = 0
  for (const item of items) {
    if (!passes(item, filters, chosen, filter.key)) continue
    any++
    for (const o of filter.options) if (o.test(item)) counts.set(o.key, counts.get(o.key)! + 1)
  }
  return { any, counts }
}

/** Names in the order a person reads them: case and fadas aside, numbers as numbers. */
export const byName = (a: string, b: string) => a.localeCompare(b, 'en-IE', { sensitivity: 'base', numeric: true })

/** Something with no value goes last whichever way the list runs. */
const lastIfNone = <V>(a: V | undefined | null, b: V | undefined | null, compare: (a: V, b: V) => number) =>
  a == null || a === '' ? (b == null || b === '' ? 0 : 1) : b == null || b === '' ? -1 : compare(a, b)

// Jobs

/** Jobs' orders. By date runs the way the chosen tab reads: soonest first coming up, the newest first in the past. */
export function jobSorts(newestFirst: boolean): ListSort<JobView>[] {
  const start = (j: JobView) => j.span?.start
  return [
    {
      key: 'date',
      label: newestFirst ? 'Newest first' : 'Soonest first',
      // No dates yet comes first coming up, so it isn't forgotten, and last in the past.
      compare: (a, b) => {
        const x = start(a)
        const y = start(b)
        if (!x || !y) return x === y ? 0 : (!x ? -1 : 1) * (newestFirst ? -1 : 1)
        return newestFirst ? y.localeCompare(x) : x.localeCompare(y)
      },
    },
    { key: 'name', label: 'Name, A to Z', compare: (a, b) => byName(a.name, b.name) },
    { key: 'client', label: 'Client, A to Z', compare: (a, b) => lastIfNone(a.client?.name, b.client?.name, byName) },
    {
      key: 'crew',
      label: 'Most crew still needed',
      compare: (a, b) => {
        const short = (j: JobView) => {
          const f = crewFill(j.calls)
          return f.needed - f.booked
        }
        return short(b) - short(a)
      },
    },
  ]
}

/** Jobs' filters. `kitShort` says whether a job has kit short, from the kit the device has. */
export function jobFilters(kitShort: (job: JobView) => boolean, stopped: boolean): ListFilter<JobView>[] {
  const crew = (j: JobView) => crewFill(j.calls)
  return [
    {
      key: 'status',
      label: 'Status',
      any: 'Any status',
      // A job not going ahead is on a tab of its own, so the other tabs don't offer its statuses, and it offers only them.
      options: PROJECT_STATUSES.filter((s) => STOPPED.includes(s) === stopped).map((s) => ({ key: s, label: STATUS_LABELS[s], test: (j: JobView) => j.status === s })),
    },
    {
      key: 'kind',
      label: 'Kind',
      any: 'Any kind',
      options: PROJECT_KINDS.map((k) => ({ key: k, label: KIND_LABELS[k], test: (j: JobView) => (j.kind ?? 'gig') === k })),
    },
    {
      key: 'crew',
      label: 'Crew',
      any: 'Any crew',
      options: [
        { key: 'short', label: 'Still needs crew', test: (j) => crew(j).needed > crew(j).booked },
        { key: 'confirm', label: 'Crew to confirm', test: (j) => crew(j).toConfirm > 0 },
        { key: 'full', label: 'Crew all booked', test: (j) => crew(j).needed > 0 && crew(j).booked >= crew(j).needed },
        { key: 'none', label: 'No crew asked for', test: (j) => crew(j).needed === 0 },
      ],
    },
    {
      key: 'kit',
      label: 'Kit',
      any: 'Any kit',
      options: [
        { key: 'short', label: 'Kit short', test: kitShort },
        { key: 'enough', label: 'No kit short', test: (j) => !kitShort(j) },
      ],
    },
  ]
}

// Quotes

export const QUOTE_SORTS: readonly ListSort<QuoteRow>[] = [
  { key: 'changed', label: 'Last changed first', compare: (a, b) => b.changed.localeCompare(a.changed) },
  { key: 'soonest', label: 'Job soonest first', compare: (a, b) => lastIfNone(a.job.span?.start, b.job.span?.start, (x, y) => x.localeCompare(y)) },
  { key: 'newest', label: 'Job newest first', compare: (a, b) => lastIfNone(a.job.span?.start, b.job.span?.start, (x, y) => y.localeCompare(x)) },
  { key: 'biggest', label: 'Biggest total first', compare: (a, b) => b.quote.totals.net - a.quote.totals.net },
  { key: 'client', label: 'Client, A to Z', compare: (a, b) => lastIfNone(a.job.client?.name, b.job.client?.name, byName) },
]

/** Quotes' filters: when the job is, as of `today`, and whether it has lines yet. */
export function quoteFilters(today: string): ListFilter<QuoteRow>[] {
  return [
    {
      key: 'when',
      label: 'Job',
      any: 'Any time',
      options: [
        { key: 'coming', label: 'Coming up', test: (r) => !!r.job.span && r.job.span.end >= today },
        { key: 'past', label: 'Past', test: (r) => !!r.job.span && r.job.span.end < today },
        { key: 'undated', label: 'No dates yet', test: (r) => !r.job.span },
      ],
    },
    {
      key: 'lines',
      label: 'Lines',
      any: 'With lines or none',
      options: [
        { key: 'some', label: 'Has lines', test: (r) => r.quote.lines.length > 0 },
        { key: 'none', label: 'No lines yet', test: (r) => r.quote.lines.length === 0 },
      ],
    },
  ]
}

// People

/** A person's surname as sorted: the second of the two, or the last word of a name from before they were asked for. */
const surname = (p: PersonView) => (p.lastName?.trim() || p.name.trim().split(/\s+/).slice(1).join(' ') || p.name).trim()

/** People's orders; `ahead` counts someone's bookings from today on, for "Most booked". */
export function peopleSorts(ahead: (p: PersonView) => number): ListSort<PersonView>[] {
  return [
    { key: 'name', label: 'First name, A to Z', compare: (a, b) => byName(a.name, b.name) },
    { key: 'surname', label: 'Last name, A to Z', compare: (a, b) => byName(surname(a), surname(b)) || byName(a.name, b.name) },
    { key: 'department', label: 'Department', compare: (a, b) => lastIfNone(a.department, b.department, byName) || byName(a.name, b.name) },
    { key: 'level', label: 'Highest level first', compare: (a, b) => b.level - a.level || byName(a.name, b.name) },
    { key: 'booked', label: 'Most booked ahead', compare: (a, b) => ahead(b) - ahead(a) || byName(a.name, b.name) },
  ]
}

/** No department, as a filter's choice; a department can't be typed with the tilde. */
export const NO_DEPARTMENT_KEY = '~none'

/** People's filters: the departments in use (and none), staff or freelancer, and level. */
export function peopleFilters(people: readonly PersonView[]): ListFilter<PersonView>[] {
  const departments = new Map<string, string>()
  for (const p of people) if (p.department && !departments.has(p.department.toLowerCase())) departments.set(p.department.toLowerCase(), p.department)
  const deptOptions: ListOption<PersonView>[] = [...departments.entries()]
    .sort((a, b) => byName(a[1], b[1]))
    .map(([key, label]) => ({ key, label, test: (p) => (p.department ?? '').toLowerCase() === key }))
  if (people.some((p) => !p.department)) deptOptions.push({ key: NO_DEPARTMENT_KEY, label: 'No department', test: (p) => !p.department })
  return [
    { key: 'department', label: 'Department', any: 'All departments', options: deptOptions },
    {
      key: 'kind',
      label: 'Type',
      any: 'Staff and freelancers',
      options: [
        { key: 'staff', label: 'Staff', test: (p) => p.kind === 'staff' },
        { key: 'freelancer', label: 'Freelancers', test: (p) => p.kind === 'freelancer' },
      ],
    },
    {
      key: 'level',
      label: 'Level',
      any: 'Any level',
      options: LEVELS.filter((l) => people.some((p) => p.level === l)).map((l) => ({ key: String(l), label: l === APPLICANT_LEVEL ? levelLine(l) : `Level ${l}`, test: (p) => p.level === l })),
    },
  ]
}

// The catalogue

/** What the catalogue's orders and filters read of a product. */
export interface ProductForList {
  name: string
  category: string
  department: Department
  total: number
  dryHire?: boolean
}

export const PRODUCT_SORTS: readonly ListSort<ProductForList>[] = [
  { key: 'name', label: 'Name, A to Z', compare: (a, b) => byName(a.name, b.name) },
  { key: 'category', label: 'Category', compare: (a, b) => lastIfNone(a.category.trim(), b.category.trim(), byName) || byName(a.name, b.name) },
  { key: 'most', label: 'Most in stock first', compare: (a, b) => b.total - a.total },
  { key: 'fewest', label: 'Fewest in stock first', compare: (a, b) => a.total - b.total },
  { key: 'department', label: 'Department', compare: (a, b) => byName(DEPARTMENT_LABELS[a.department], DEPARTMENT_LABELS[b.department]) },
]

/** The catalogue's filters: ours or dry hire (once there's any dry hire), the categories in use, and how many there are. */
export function productFilters<T extends ProductForList>(products: readonly T[]): ListFilter<T>[] {
  const categories = new Map<string, string>()
  for (const m of products) {
    const c = m.category.trim()
    if (c && !categories.has(c.toLowerCase())) categories.set(c.toLowerCase(), c)
  }
  const filters: ListFilter<T>[] = []
  if (products.some((m) => m.dryHire))
    filters.push({
      key: 'whose',
      label: 'Whose',
      any: 'Ours and dry hire',
      options: [
        { key: 'ours', label: 'Ours', test: (m) => !m.dryHire },
        { key: 'dryHire', label: 'Dry hire', test: (m) => !!m.dryHire },
      ],
    })
  if (categories.size > 0)
    filters.push({
      key: 'category',
      label: 'Category',
      any: 'Any category',
      options: [...categories.entries()].sort((a, b) => byName(a[1], b[1])).map(([key, label]) => ({ key, label, test: (m: T) => m.category.trim().toLowerCase() === key })),
    })
  filters.push({
    key: 'stock',
    label: 'In stock',
    any: 'Any number',
    options: [
      { key: 'some', label: 'Some in stock', test: (m) => m.total > 0 },
      { key: 'none', label: 'None in stock', test: (m) => m.total === 0 },
    ],
  })
  return filters
}

// Venues and clients

/** A venue or client in its list, with what the list counts of it. */
export interface PlaceForList {
  name: string
  /** Its jobs, and the first day of the latest one's, for "Most recent job". */
  jobs: number
  lastJob: string | undefined
  /** Jobs from today on. */
  comingUp: number
  docs: number
  /** Venues only: whether it's on the map. */
  pinned?: boolean
}

export const PLACE_SORTS: readonly ListSort<PlaceForList>[] = [
  { key: 'name', label: 'Name, A to Z', compare: (a, b) => byName(a.name, b.name) },
  { key: 'jobs', label: 'Most jobs first', compare: (a, b) => b.jobs - a.jobs || byName(a.name, b.name) },
  { key: 'recent', label: 'Most recent job first', compare: (a, b) => lastIfNone(a.lastJob, b.lastJob, (x, y) => y.localeCompare(x)) },
]

/** Venues' and clients' filters; `venues` adds whether it's on the map. */
export function placeFilters(venues: boolean): ListFilter<PlaceForList>[] {
  const filters: ListFilter<PlaceForList>[] = [
    {
      key: 'jobs',
      label: 'Jobs',
      any: 'With jobs or none',
      options: [
        { key: 'coming', label: 'Has jobs coming up', test: (p) => p.comingUp > 0 },
        { key: 'some', label: 'Has jobs', test: (p) => p.jobs > 0 },
        { key: 'none', label: 'No jobs', test: (p) => p.jobs === 0 },
      ],
    },
    {
      key: 'docs',
      label: 'Documents',
      any: 'With documents or none',
      options: [
        { key: 'some', label: 'Has documents', test: (p) => p.docs > 0 },
        { key: 'none', label: 'No documents', test: (p) => p.docs === 0 },
      ],
    },
  ]
  if (venues)
    filters.push({
      key: 'map',
      label: 'Map',
      any: 'On the map or not',
      options: [
        { key: 'on', label: 'On the map', test: (p) => !!p.pinned },
        { key: 'off', label: 'Not on the map yet', test: (p) => !p.pinned },
      ],
    })
  return filters
}
