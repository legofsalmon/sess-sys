import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A deploy while the app is open (audit findings 4 and 27), in a real
 * browser: the built app is swapped under a running session, the service
 * worker finds the new version and the bar at the top says so, and Reload
 * brings in the new build without losing a change made with no signal. The
 * build is put back afterwards, as the other specs share it.
 */

const dist = join(process.cwd(), 'web', 'dist')
const files = { page: join(dist, 'index.html'), sw: join(dist, 'sw.js') }
const before = { page: readFileSync(files.page, 'utf8'), sw: readFileSync(files.sw, 'utf8') }

const putBack = () => {
  writeFileSync(files.page, before.page)
  writeFileSync(files.sw, before.sw)
}
test.afterEach(putBack)

test('a new version waits for Reload, which brings it in with an unsynced change intact', async ({ browser }) => {
  // Proves: a deploy never takes the open page over by itself, and Reload brings the new build with nothing lost.
  const context = await browser.newContext()
  const tab = await context.newPage()
  await tab.goto('/#stock/sync-test')
  await expect(tab.getByRole('status')).toHaveText('Up to date')
  // The service worker is in control, as it is on any phone that has opened the app before.
  await tab.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15_000 }).catch(() => tab.reload())
  await tab.waitForFunction(() => navigator.serviceWorker?.controller != null)

  // A change made with no signal: the server can't be reached, so it waits in the outbox.
  const id = Math.random().toString(36).slice(2, 8)
  const kit = `Deploy test ${id}`
  await context.route('**/api/sync/push', (route) => route.abort('internetdisconnected'))
  await tab.locator('#product-name').fill(kit)
  await tab.locator('#product-qty').fill('2')
  await tab.getByRole('button', { name: 'Add' }).click()
  await expect(tab.getByRole('status')).toHaveText(/1 waiting/)

  // The deploy: a new page, and a service worker whose list of files says so.
  const next = {
    page: before.page.replace('</head>', '<meta name="build" content="two"></head>'),
    sw: before.sw.replace(/(\{url:"index\.html",revision:")[^"]*(")/, '$1deploy-two$2'),
  }
  expect(next.page).not.toBe(before.page)
  expect(next.sw).not.toBe(before.sw)
  writeFileSync(files.page, next.page)
  writeFileSync(files.sw, next.sw)
  await tab.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()))
  await expect(tab.getByText('A new version is ready.')).toBeVisible({ timeout: 20_000 })
  // Still the old page, with the change still waiting: nothing happens until someone taps.
  expect(await tab.evaluate(() => document.querySelector('meta[name="build"]')?.getAttribute('content') ?? null)).toBeNull()
  await expect(tab.getByRole('status')).toHaveText(/1 waiting/)

  // Signal back, and Reload: the new build, with the change made before it now synced.
  await context.unroute('**/api/sync/push')
  await tab.getByRole('button', { name: 'Reload' }).click()
  await tab.waitForFunction(() => document.querySelector('meta[name="build"]')?.getAttribute('content') === 'two', null, { timeout: 20_000 })
  await expect(tab.getByRole('status')).toHaveText('Up to date', { timeout: 20_000 })
  await expect(tab.locator('.stock li', { hasText: kit })).toContainText('2 of 2 free')
  await context.close()
})
