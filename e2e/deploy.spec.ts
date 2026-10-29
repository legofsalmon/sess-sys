import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'

/**
 * A deploy while the app is open (audit findings 4 and 27), in a real
 * browser: the built app is swapped under a running session, the service
 * worker finds the new version and the bar at the top says so, and Load the new version
 * brings in the new build without losing a change made with no signal. The
 * build is put back afterwards, as the other specs share it.
 */

const dist = join(process.cwd(), 'web', 'dist')
const files = { page: join(dist, 'index.html'), sw: join(dist, 'sw.js') }
const before = { page: readFileSync(files.page, 'utf8'), sw: readFileSync(files.sw, 'utf8') }

// The build serves pre-compressed copies (ADR 0049), so a file swapped here has its .br and .gz swapped with it.
const put = (file: string, text: string) => {
  writeFileSync(file, text)
  if (existsSync(`${file}.br`)) writeFileSync(`${file}.br`, brotliCompressSync(text))
  if (existsSync(`${file}.gz`)) writeFileSync(`${file}.gz`, gzipSync(text))
}
const putBack = () => {
  put(files.page, before.page)
  put(files.sw, before.sw)
}
test.afterEach(putBack)

test('a new version waits for Load the new version, which brings it in with an unsynced change intact', async ({ browser }) => {
  // Proves: a deploy never takes the open page over by itself, and Load the new version brings the new build with nothing lost.
  const context = await browser.newContext()
  const tab = await context.newPage()
  await tab.goto('/#stock/places')
  await expect(tab.locator('.conn')).toHaveText('Up to date')
  // The service worker is in control, as it is on any phone that has opened the app before.
  await tab.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15_000 }).catch(() => tab.reload())
  await tab.waitForFunction(() => navigator.serviceWorker?.controller != null)

  // A change made with no signal: the server can't be reached, so it waits in the outbox.
  const id = Math.random().toString(36).slice(2, 8)
  const bay = `Deploy test ${id}`
  // The signal comes back by this route letting the push through, not by taking it away: a retry caught as it was taken
  // away was left hanging, never sent nor failed (as in history.spec.ts).
  let signal = false
  await context.route('**/api/sync/push', (route) => (signal ? route.continue() : route.abort('internetdisconnected')))
  await tab.getByRole('button', { name: 'Add place' }).click()
  await tab.getByLabel('New place').fill(bay)
  await tab.getByRole('button', { name: 'Add place' }).click()
  await expect(tab.locator('.conn')).toHaveText(/1 waiting/)

  // The deploy: a new page, and a service worker whose list of files says so.
  const next = {
    page: before.page.replace('</head>', '<meta name="build" content="two"></head>'),
    sw: before.sw.replace(/(\{url:"index\.html",revision:")[^"]*(")/, '$1deploy-two$2'),
  }
  expect(next.page).not.toBe(before.page)
  expect(next.sw).not.toBe(before.sw)
  put(files.page, next.page)
  put(files.sw, next.sw)
  await tab.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()))
  await expect(tab.getByText('A new version is ready.')).toBeVisible({ timeout: 20_000 })
  // Still the old page, with the change still waiting: nothing happens until someone taps.
  expect(await tab.evaluate(() => document.querySelector('meta[name="build"]')?.getAttribute('content') ?? null)).toBeNull()
  await expect(tab.locator('.conn')).toHaveText(/1 waiting/)

  // Signal back, and Load the new version: the new build, with the change made before it now synced.
  signal = true
  await tab.getByRole('button', { name: 'Load the new version' }).click()
  await tab.waitForFunction(() => document.querySelector('meta[name="build"]')?.getAttribute('content') === 'two', null, { timeout: 20_000 })
  await expect(tab.locator('.conn')).toHaveText('Up to date', { timeout: 20_000 })
  const all = tab.getByRole('button', { name: /^Show all \d+ places$/ })
  if (await all.count()) await all.click()
  const row = tab.locator('.job-row', { hasText: bay })
  await expect(row).toContainText('Nothing here yet')
  await expect(row).not.toContainText('Waiting to sync')
  await context.close()
})

test('a tab brought back to the front looks for a new version, without waiting for the hour', async ({ browser }) => {
  // Proves: coming back to the app (a phone picked up, a tab clicked) asks for a new version (audit, P3), so a deploy shows.
  const context = await browser.newContext()
  const tab = await context.newPage()
  await tab.goto('/#stock/places')
  await expect(tab.locator('.conn')).toHaveText('Up to date')
  await tab.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15_000 }).catch(() => tab.reload())
  await tab.waitForFunction(() => navigator.serviceWorker?.controller != null)

  put(files.page, before.page.replace('</head>', '<meta name="build" content="three"></head>'))
  put(files.sw, before.sw.replace(/(\{url:"index\.html",revision:")[^"]*(")/, '$1deploy-three$2'))
  // Nothing asks the service worker to look: only the page coming to the front again.
  await tab.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(tab.getByText('A new version is ready.')).toBeVisible({ timeout: 20_000 })
  await context.close()
})

test('a deploy downloads the app and the QR code reader, and leaves the map and the rack in 3D until they are first shown', () => {
  // Proves: the service worker's list of files to fetch with each deploy has the QR code reader, which scanning with no signal needs from the first time (ADR 0016), and not the map's or the 3D drawing's code, which most phones never open; those are kept as they're first fetched (audit, 20 October 2026, finding 65).
  const listed = [...before.sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]!)
  expect(listed.some((u) => /^assets\/jsQR-/.test(u))).toBe(true)
  expect(listed.some((u) => /^assets\/Shell-.*\.js$/.test(u))).toBe(true)
  expect(listed.filter((u) => /^assets\/(leaflet|Map|Rack3D)-/.test(u))).toEqual([])
  expect(before.sw).toContain('on-first-use')
})
