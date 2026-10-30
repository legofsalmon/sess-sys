import { describe, expect, it } from 'vitest'
import {
  activeFilters,
  byName,
  jobFilters,
  jobSorts,
  listed,
  NO_DEPARTMENT_KEY,
  optionCounts,
  peopleFilters,
  peopleSorts,
  placeFilters,
  PLACE_SORTS,
  PRODUCT_SORTS,
  productFilters,
  type ListFilter,
  type ListSort,
  type PlaceForList,
  type ProductForList,
} from '../src/lists.ts'
import type { JobView } from '../src/sync/jobs-view.ts'
import type { PersonView } from '../src/sync/crew-view.ts'

/**
 * Filter and sort for the long lists (ADR 0099): every list narrows and
 * orders the same way, ties keep the list's own order, a choice the list
 * no longer offers narrows nothing, and the counts beside a choice are what
 * pressing it would show.
 */

type N = { n: number; name: string }
const items: N[] = [
  { n: 3, name: 'c' },
  { n: 1, name: 'a' },
  { n: 2, name: 'b' },
  { n: 4, name: 'a' },
]
const odd: ListFilter<N> = {
  key: 'odd',
  label: 'Odd',
  any: 'Any',
  options: [
    { key: 'yes', label: 'Odd', test: (x) => x.n % 2 === 1 },
    { key: 'no', label: 'Even', test: (x) => x.n % 2 === 0 },
  ],
}
const big: ListFilter<N> = { key: 'big', label: 'Big', any: 'Any', options: [{ key: 'yes', label: 'Over 2', test: (x) => x.n > 2 }] }
const sorts: ListSort<N>[] = [
  { key: 'n', label: 'By number', compare: (a, b) => a.n - b.n },
  { key: 'name', label: 'By name', compare: (a, b) => byName(a.name, b.name) },
]

describe('listing', () => {
  it('sorts by the first order when none is chosen, or one not offered', () => {
    expect(listed(items, [], sorts, { sort: '', filters: {} }).map((x) => x.n)).toEqual([1, 2, 3, 4])
    expect(listed(items, [], sorts, { sort: 'gone', filters: {} }).map((x) => x.n)).toEqual([1, 2, 3, 4])
  })

  it('keeps the list’s own order for ties', () => {
    expect(listed(items, [], sorts, { sort: 'name', filters: {} }).map((x) => x.n)).toEqual([1, 4, 2, 3])
  })

  it('narrows by every filter chosen, and not by one it no longer offers', () => {
    expect(listed(items, [odd, big], sorts, { sort: 'n', filters: { odd: 'yes', big: 'yes' } }).map((x) => x.n)).toEqual([3])
    expect(listed(items, [odd], sorts, { sort: 'n', filters: { odd: 'maybe' } })).toHaveLength(4)
    expect(activeFilters([odd, big], { odd: 'maybe', big: 'yes' }).map((a) => a.filter.key)).toEqual(['big'])
  })

  it('counts each choice with the other filters as they are', () => {
    const { any, counts } = optionCounts(items, [odd, big], { odd: 'no', big: 'yes' }, odd)
    expect(any).toBe(2)
    expect(counts.get('yes')).toBe(1)
    expect(counts.get('no')).toBe(1)
  })

  it('reads names as a person does: case, fadas and numbers', () => {
    expect(['Seán', 'sean b', 'Item 10', 'Item 9'].sort(byName)).toEqual(['Item 9', 'Item 10', 'Seán', 'sean b'])
  })
})

const job = (id: string, start: string | undefined, more: Partial<JobView> = {}) =>
  ({ id, name: id, status: 'confirmed', kind: 'gig', calls: [], phases: [], span: start ? { start, end: start } : undefined, client: undefined, ...more }) as unknown as JobView

describe('jobs', () => {
  const jobs = [job('later', '2026-11-20'), job('undated', undefined), job('soon', '2026-11-01')]

  it('by date runs soonest first coming up, with no dates first, and newest first in the past', () => {
    expect(listed(jobs, [], jobSorts(false), { sort: 'date', filters: {} }).map((j) => j.id)).toEqual(['undated', 'soon', 'later'])
    expect(listed(jobs, [], jobSorts(true), { sort: 'date', filters: {} }).map((j) => j.id)).toEqual(['later', 'soon', 'undated'])
  })

  it('offers only the statuses of the tab, and filters kit short by what it is told', () => {
    const going = jobFilters((j) => j.id === 'soon', false)
    expect(going[0]!.options.map((o) => o.key)).toEqual(['enquiry', 'quoted', 'confirmed'])
    expect(jobFilters(() => false, true)[0]!.options.map((o) => o.key)).toEqual(['cancelled', 'lost'])
    expect(listed(jobs, going, jobSorts(false), { sort: 'date', filters: { kit: 'short' } }).map((j) => j.id)).toEqual(['soon'])
  })

  it('a job with no calls asks for no crew', () => {
    const filters = jobFilters(() => false, false)
    expect(listed(jobs, filters, jobSorts(false), { sort: 'date', filters: { crew: 'none' } })).toHaveLength(3)
    expect(listed(jobs, filters, jobSorts(false), { sort: 'date', filters: { crew: 'short' } })).toHaveLength(0)
  })
})

const person = (name: string, more: Partial<PersonView> = {}) => ({ id: name, name, kind: 'freelancer', department: null, level: 1, ...more }) as unknown as PersonView

describe('people', () => {
  const people = [person('Áine Walsh', { department: 'Audio' }), person('Brian Byrne', { department: 'audio', kind: 'staff', level: 3 }), person('Cara Allen')]

  it('offers each department once, and none when someone has none', () => {
    const [department] = peopleFilters(people)
    expect(department!.options.map((o) => o.label)).toEqual(['Audio', 'No department'])
    expect(listed(people, peopleFilters(people), peopleSorts(() => 0), { sort: 'name', filters: { department: 'audio' } })).toHaveLength(2)
    expect(listed(people, peopleFilters(people), peopleSorts(() => 0), { sort: 'name', filters: { department: NO_DEPARTMENT_KEY } }).map((p) => p.name)).toEqual(['Cara Allen'])
  })

  it('sorts by last name, level and bookings ahead', () => {
    const s = peopleSorts((p) => (p.name === 'Cara Allen' ? 2 : 0))
    expect(listed(people, [], s, { sort: 'surname', filters: {} }).map((p) => p.name)).toEqual(['Cara Allen', 'Brian Byrne', 'Áine Walsh'])
    expect(listed(people, [], s, { sort: 'level', filters: {} })[0]!.name).toBe('Brian Byrne')
    expect(listed(people, [], s, { sort: 'booked', filters: {} })[0]!.name).toBe('Cara Allen')
  })

  it('offers only the levels in use', () => {
    expect(peopleFilters(people)[2]!.options.map((o) => o.key)).toEqual(['1', '3'])
  })
})

describe('the catalogue', () => {
  const products: ProductForList[] = [
    { name: 'SM58', category: 'Microphones', department: 'audio', total: 12 },
    { name: 'Hazer', category: '', department: 'lighting', total: 0, dryHire: true },
    { name: 'Beta 91', category: 'microphones', department: 'audio', total: 4 },
  ]

  it('offers whose only once there is dry hire, and each category once', () => {
    const filters = productFilters(products)
    expect(filters.map((f) => f.key)).toEqual(['whose', 'category', 'stock'])
    expect(filters[1]!.options.map((o) => o.label)).toEqual(['Microphones'])
    expect(productFilters(products.filter((m) => !m.dryHire)).map((f) => f.key)).toEqual(['category', 'stock'])
  })

  it('sorts by most in stock, and a product with no category last', () => {
    expect(listed(products, [], PRODUCT_SORTS, { sort: 'most', filters: {} }).map((m) => m.name)).toEqual(['SM58', 'Beta 91', 'Hazer'])
    expect(listed(products, [], PRODUCT_SORTS, { sort: 'category', filters: {} }).at(-1)!.name).toBe('Hazer')
  })
})

describe('venues and clients', () => {
  const places: PlaceForList[] = [
    { name: 'Vicar Street', jobs: 3, lastJob: '2026-10-01', comingUp: 0, docs: 1, pinned: true },
    { name: '3Arena', jobs: 5, lastJob: '2026-12-01', comingUp: 2, docs: 0, pinned: false },
    { name: 'Olympia', jobs: 0, lastJob: undefined, comingUp: 0, docs: 0, pinned: false },
  ]

  it('sorts by most recent job, with none last', () => {
    expect(listed(places, [], PLACE_SORTS, { sort: 'recent', filters: {} }).map((p) => p.name)).toEqual(['3Arena', 'Vicar Street', 'Olympia'])
  })

  it('filters venues by the map, which clients have not', () => {
    expect(placeFilters(false).map((f) => f.key)).toEqual(['jobs', 'docs'])
    expect(listed(places, placeFilters(true), PLACE_SORTS, { sort: 'name', filters: { map: 'off', jobs: 'some' } }).map((p) => p.name)).toEqual(['3Arena'])
  })
})
