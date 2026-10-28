import { expect, test } from '@playwright/test'

/**
 * The way up (Up.tsx): every page under an area's own screen has it in the
 * top bar, so it stays in view down a long page. On a phone it is one link
 * to the parent; on a desk the whole way down as breadcrumbs, the page
 * itself last and not a link. An area's own screen has neither. Uses the
 * made-up data (ADR 0019), so it starts fresh before and after: the other
 * tests share this server. SHOTS=1 saves pictures for the blueprint.
 */

const phoneSize = { width: 390, height: 844 }
const deskSize = { width: 1280, height: 800 }
const fresh = { data: { confirm: 'delete everything' } }
const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
})

test.afterEach(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})

test('on a phone the way up is one link in the top bar, still there at the foot of a long page', async ({ browser }) => {
  // Proves: an area's own screen has no way up; a job's pick list goes up to the job and the job to all jobs; the link is in the sticky bar, a thumb's height, and still on screen scrolled to the end; History goes up to the Menu.
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#jobs')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await expect(page.locator('.top .up')).toHaveCount(0)

  await page.locator('.job-row').first().click()
  const up = page.locator('.top').getByRole('link', { name: '‹ All jobs' })
  // The job's page is up once its way up is: only then is the heading the job's name, not Jobs.
  await expect(up).toBeVisible()
  const job = (await page.getByRole('heading', { level: 1 }).textContent())!.trim()
  expect((await up.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  // Breadcrumbs are for a desk: on a phone they aren't drawn or read out.
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0)
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight))
  await expect(up).toBeInViewport()
  await page.screenshot(shot('up-phone'))

  const id = new URL(page.url()).hash.slice('#jobs/'.length)
  await page.goto(`/#jobs/${id}/pick`)
  await page.locator('.top').getByRole('link', { name: `‹ ${job}` }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(job)
  await up.click()
  await expect(page).toHaveURL(/#jobs$/)

  await page.goto('/#history')
  await page.locator('.top').getByRole('link', { name: '‹ Menu' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Menu' })).toBeVisible()
})

test('on a desk the way up is breadcrumbs, from the area down to the page', async ({ browser }) => {
  // Proves: an item opened from its product says Stock › its product › its number, each above it a link and the item itself the current page; a job's pick list says Jobs › the job › Pick list; Admin's crew list says Menu › Admin › Bring in the crew list; no phone link is drawn.
  const page = await (await browser.newContext({ viewport: deskSize })).newPage()
  await page.goto('/#stock')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0)

  // A product with numbered items, and the first of them.
  await page.locator('a[href^="#stock/product/"]', { hasText: 'd&b Y10P' }).first().click()
  await page.getByRole('tab', { name: /^Items/ }).click()
  await page.locator('a[href^="#stock/item/"]').first().click()
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
  await expect(crumbs.getByRole('listitem')).toHaveCount(3)
  await expect(crumbs.getByRole('link')).toHaveCount(2)
  await expect(crumbs.getByRole('link').first()).toHaveText('Stock')
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText((await page.locator('h1.number').textContent())!)
  await expect(page.getByRole('link', { name: '‹ All stock' })).toHaveCount(0)

  // Beside the list, an open job says where it is too, though the list is its way back.
  await page.goto('/#jobs')
  await expect(crumbs).toHaveCount(0)
  await page.locator('.job-row').first().click()
  await expect(crumbs.getByRole('link')).toHaveText(['Jobs'])
  const job = (await crumbs.locator('[aria-current="page"]').textContent())!.trim()
  const id = new URL(page.url()).hash.slice('#jobs/'.length)
  await page.goto(`/#jobs/${id}/pick`)
  await expect(crumbs.getByRole('listitem')).toHaveText(['Jobs', job, 'Pick list'])
  await page.screenshot(shot('up-desk'))
  await crumbs.getByRole('link', { name: job }).click()
  await expect(page).toHaveURL(new RegExp(`#jobs/${id}$`))

  await page.goto('/#crew/import')
  await expect(crumbs.getByRole('listitem')).toHaveText(['Crew', 'Bring in the crew list'])

  // A client's page sits under the list of clients, a step along Jobs' row.
  await page.goto('/#jobs/clients')
  await expect(crumbs).toHaveCount(0)
  await page.locator('a[href^="#jobs/clients/"]').first().click()
  await expect(crumbs.getByRole('link')).toHaveText(['Jobs', 'Clients'])
  await crumbs.getByRole('link', { name: 'Clients' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible()
})

test('every area names its pages in a row, and the old addresses land on the new ones', async ({ browser }) => {
  // Proves: Jobs, Stock and Crew each have a row with the current page marked; Repairs counts what's open; addresses from before the tidy-up (ADR 0041) are put to their new ones, in place, so Back doesn't return to them.
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#jobs')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  const jobs = page.getByRole('navigation', { name: 'Jobs pages' })
  await expect(jobs.getByRole('link')).toHaveText(['List', 'Week', 'Month', 'Clients', 'Venues', 'Money'])
  await jobs.getByRole('link', { name: 'Venues' }).click()
  await expect(page).toHaveURL(/#jobs\/venues$/)
  await expect(jobs.getByRole('link', { name: 'Venues' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { level: 1, name: 'Venues' })).toBeVisible()

  await page.goto('/#stock')
  const stock = page.getByRole('navigation', { name: 'Stock pages' })
  await expect(stock.getByRole('link')).toHaveText(['Catalogue', 'Places', 'Labels', 'Counting', /^Testing/, /^Repairs/, 'Racks', /^Vehicles/, 'Purchase list'])
  await stock.getByRole('link', { name: /^Places/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Places' })).toBeVisible()
  await page.screenshot(shot('rows-phone'))

  await page.goto('/#crew')
  await expect(page.getByRole('navigation', { name: 'Crew pages' }).getByRole('link')).toHaveText([/^Calls/, 'People', /^Leave/, /^Timesheets/])

  for (const [old, now] of [
    ['#plan/week/2031-03-03', '#jobs/plan/week/2031-03-03'],
    ['#import', '#jobs/import'],
    ['#account', '#admin'],
    ['#account/import-people', '#crew/import'],
    ['#account/import-stock', '#stock/import'],
  ]) {
    await page.goto(`/${old}`)
    await expect(page).toHaveURL(new RegExp(`${now}$`))
  }
  // Moving within the app from an old address lands too.
  await page.evaluate(() => (location.hash = '#account'))
  await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible()
  await expect(page).toHaveURL(/#admin$/)
})
