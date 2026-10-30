import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * Filter and sort on the long lists (ADR 0099): one shared part under each
 * list's search. On Jobs a filter narrows the tab, says itself as a chip and
 * in the Filter button's count, with how many of how many; another order
 * drops the week headings; Back from a job finds the same choices; and
 * Clear filters puts the list back. Venues sort by most jobs. The test
 * server is shared with the other browser tests, so every name here is this
 * run's own, and found by a search that only this run's match.
 */

const phoneSize = { width: 390, height: 844 }
const tag = () => Math.random().toString(36).slice(2, 8)

async function push(request: APIRequestContext, from: string, mutations: (readonly [string, Record<string, unknown>])[]) {
  const res = await request.post('/api/sync/push', {
    data: { clientId: from, mutations: mutations.map(([name, args], i) => ({ id: `${from}-${i}`, name, args, createdAt: new Date().toISOString() })) },
  })
  const { results } = (await res.json()) as { results: { status: string; reason?: { message: string } }[] }
  expect(results.map((r) => r.reason?.message ?? r.status)).toEqual(mutations.map(() => 'applied'))
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

test('jobs filter by status and kind, sort by name, and keep both on Back', async ({ browser, request }) => {
  const id = tag()
  const venue = `v-${id}`
  const job = (key: string, name: string, status: string, kind: string, day: number) =>
    [
      ['project.create', { id: `j-${id}-${key}`, name: `${name} ${id}`, clientId: null, venueId: key === 'b' ? null : venue, status, kind, notes: '' }],
      ['phase.add', { id: `ph-${id}-${key}`, projectId: `j-${id}-${key}`, name: 'Show', start: inDays(day), end: inDays(day), venueId: null, notes: '' }],
    ] as const
  await push(request, `lists-${id}`, [
    ['venue.upsert', { id: venue, name: `Hall ${id}`, address: '', notes: '' }],
    ['venue.upsert', { id: `${venue}-2`, name: `Barn ${id}`, address: '', notes: '' }],
    ...job('a', 'Zebra gala', 'confirmed', 'gig', 3),
    ...job('b', 'Apple launch', 'enquiry', 'gig', 5),
    ...job('c', 'Mango hire', 'confirmed', 'hire', 7),
  ])
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#jobs')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  const list = page.getByRole('region', { name: 'Jobs' })
  const names = list.locator('.job-row b')
  await list.getByLabel('Find').fill(id)
  await expect(names).toHaveText([`Zebra gala ${id}`, `Apple launch ${id}`, `Mango hire ${id}`])
  await expect(list.locator('.week-head').first()).toBeVisible()

  // Name, A to Z: no week headings in an order that isn't by date.
  await list.getByLabel('Sort').selectOption('name')
  await expect(names).toHaveText([`Apple launch ${id}`, `Mango hire ${id}`, `Zebra gala ${id}`])
  await expect(list.locator('.week-head')).toHaveCount(0)

  // Confirmed, then Gig: each a chip, the count in the button, and how many of how many.
  await list.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(list.getByLabel('Status').locator('option', { hasText: 'Confirmed (2)' })).toHaveCount(1)
  await list.getByLabel('Status').selectOption('confirmed')
  await list.getByLabel('Kind').selectOption('gig')
  await expect(names).toHaveText([`Zebra gala ${id}`])
  await expect(list.getByRole('button', { name: 'Filter (2)' })).toBeVisible()
  await expect(list.locator('.list-count')).toHaveText('1 of 3 jobs.')

  // Back from the job finds the same order and filters.
  await names.first().click()
  await expect(page).toHaveURL(new RegExp(`#jobs/j-${id}-a`))
  await page.goBack()
  await expect(list.getByRole('button', { name: 'Filter (2)' })).toBeVisible()
  await expect(list.getByLabel('Sort')).toHaveValue('name')

  // A chip takes its own filter off; Clear filters the rest.
  await list.getByRole('button', { name: 'Take off the filter Kind: Gig' }).click()
  await list.getByLabel('Find').fill(id)
  await expect(names).toHaveText([`Mango hire ${id}`, `Zebra gala ${id}`])
  await list.getByRole('button', { name: 'Clear filters' }).click()
  await expect(names).toHaveCount(3)
  await expect(list.getByRole('button', { name: 'Filter', exact: true })).toBeVisible()
  await list.getByLabel('Sort').selectOption('date')

  // Venues: the one with jobs first by most jobs, and the one with none found by its filter.
  await page.goto('/#jobs/venues')
  const venues = page.getByRole('region', { name: 'Every venue' })
  await venues.getByLabel('Find a venue').fill(id)
  await venues.getByLabel('Sort').selectOption('jobs')
  await expect(venues.locator('.job-row b')).toHaveText([`Hall ${id}`, `Barn ${id}`])
  await venues.getByRole('button', { name: 'Filter', exact: true }).click()
  await venues.getByLabel('Jobs').selectOption('none')
  await expect(venues.locator('.job-row b')).toHaveText([`Barn ${id}`])
  await venues.getByRole('button', { name: 'Clear filters' }).click()
  await venues.getByLabel('Sort').selectOption('name')
})
