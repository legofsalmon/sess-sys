import { expect, test } from '@playwright/test'

/**
 * Home and finding your way around (ADR 0033): the bare address opens Home,
 * shown for the company with counts that each open where they're sorted
 * out; it can be shown for a department, the warehouse or me, and the phone
 * remembers which; five places in the bar, History under Admin; and a long
 * screen names its parts at the top, each a tap away. Uses the made-up data
 * (ADR 0019), so it starts fresh before and after: the other tests share
 * this server.
 */

const phoneSize = { width: 390, height: 844 }
const fresh = { data: { confirm: 'delete everything' } }

test.beforeAll(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
})

test.afterAll(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})

test('Home is where the app opens, and says how things stand for whoever is looking', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
  await expect(page).toHaveTitle('Home · Session Hire')

  const bar = page.getByRole('navigation', { name: 'Areas' })
  await expect(bar.getByRole('link')).toHaveText(['Home', 'Jobs', 'Stock', /^Crew/, 'Menu'])
  await expect(bar.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')

  // The company: today's job, and counts that aren't nothing.
  const show = page.getByRole('group', { name: 'Show for' })
  await expect(show.getByRole('button', { name: 'Company' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name: 'Today (1)' })).toBeVisible()
  const attention = page.locator('.standing')
  await expect(attention.getByRole('link', { name: /answers to check/ })).toBeVisible()
  await expect(attention.getByRole('link', { name: /kit lines short/ })).toBeVisible()

  // A count opens the screen that sorts it out.
  await attention.getByRole('link', { name: /answers to check/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Crew' })).toBeVisible()
  await expect(bar.getByRole('link', { name: /^Crew/ })).toHaveAttribute('aria-current', 'page')

  // The warehouse: what's going out, opening its pick list. Remembered on this phone.
  await bar.getByRole('link', { name: 'Home' }).click()
  await show.getByRole('button', { name: 'Warehouse' }).click()
  await expect(show.getByRole('button', { name: 'Warehouse' })).toBeFocused()
  const going = page.locator('section', { has: page.getByRole('heading', { name: /^Going out/ }) })
  await expect(going.getByRole('link', { name: /Harbour Lights Festival/ })).toHaveAttribute('href', /#jobs\/.+\/pick$/)
  await page.reload()
  await expect(show.getByRole('button', { name: 'Warehouse' })).toHaveAttribute('aria-pressed', 'true')

  // A department: narrowed to its people and its kit.
  await show.getByRole('button', { name: 'Department' }).click()
  await page.getByLabel('Department').selectOption('Audio')
  await expect(page.getByRole('heading', { name: 'Needs attention in Audio' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Working this week/ })).toBeVisible()
})

test('the Menu names every place, and Admin, History and You keep its tab with the way back', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#home')
  const bar = page.getByRole('navigation', { name: 'Areas' })
  await bar.getByRole('link', { name: 'Menu' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Menu' })).toBeVisible()
  const places = page.getByRole('navigation', { name: 'Every place' })
  for (const group of ['Jobs', 'Stock', 'Crew', 'Company', 'You']) await expect(places.getByRole('group', { name: group })).toBeVisible()
  await expect(places.getByRole('link', { name: /^Planner/ })).toHaveAttribute('href', '#plan')

  for (const [link, title] of [
    [/^History/, 'History'],
    [/^Admin/, 'Admin'],
    [/^You/, 'You'],
  ] as const) {
    await places.getByRole('link', { name: link }).click()
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await expect(bar.getByRole('link', { name: 'Menu' })).toHaveAttribute('aria-current', 'page')
    await page.getByRole('link', { name: '‹ Menu' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Menu' })).toBeVisible()
  }
})

test('a long screen names its parts at the top, and a tap goes to one', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#stock')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  const parts = page.getByRole('navigation', { name: 'On this screen' })
  await expect(parts.getByRole('button', { name: 'Pick lists' })).toBeVisible()
  await parts.getByRole('button', { name: 'Places' }).click()
  const places = page.getByRole('heading', { name: 'Places', exact: true })
  await expect(places).toBeFocused()
  await expect(places).toBeInViewport()
  await expect(parts.getByRole('button', { name: 'Places' })).toHaveAttribute('aria-current', 'location')
  // A heading's count is the part's count.
  await page.goto('/#crew')
  await expect(parts.getByRole('button', { name: /^Answers to check/ }).locator('.count')).toHaveText(/^\d+$/)
})
