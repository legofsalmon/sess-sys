import { expect, test, type Page } from '@playwright/test'

/**
 * The sync engine's "done when" (ADR 0001), in a real browser: two devices,
 * one physically offline (the browser's network switched off, page reloaded
 * from the installed app), both moving the same four speakers out of one
 * bay. The Phase 0 sync test carried this until it went; it runs on the
 * Stock tab now. The test server is shared with the other browser tests,
 * so the speakers and places here have names of their own.
 */

async function ready(page: Page, hash: string) {
  await page.goto(`/${hash}`)
  await expect(page.locator('.conn')).toHaveText('Up to date')
}

test('two devices, one offline, the same four speakers', async ({ browser, request }) => {
  const id = Math.random().toString(36).slice(2, 8)
  const kit = `d&b Y10P ${id}`
  const [bay, van1, van2] = [`Bay A3 ${id}`, `Van 1 ${id}`, `Van 2 ${id}`]
  const model = `y10p${id}`

  // The office has counted four speakers in the bay, with two vans to move them to.
  const createdAt = new Date().toISOString()
  const setUp = [
    { name: 'model.create', args: { id: model, name: kit, department: 'audio', category: 'Speakers', tracking: 'bulk', isCase: false, valueCents: null, notes: '' } },
    { name: 'place.upsert', args: { id: `a3${id}`, name: bay, notes: '' } },
    { name: 'place.upsert', args: { id: `v1${id}`, name: van1, notes: '' } },
    { name: 'place.upsert', args: { id: `v2${id}`, name: van2, notes: '' } },
    { name: 'stock.set', args: { modelId: model, placeId: `a3${id}`, caseId: null, qty: 4 } },
  ].map((m, i) => ({ ...m, id: `setup${id}${i}`, createdAt }))
  const pushed = await request.post('/api/sync/push', { data: { clientId: `office${id}`, mutations: setUp } })
  expect((await pushed.json()).results.map((r: { status: string }) => r.status)).toEqual(['applied', 'applied', 'applied', 'applied', 'applied'])

  const counted = (page: Page, where: string) => page.getByRole('region', { name: 'Counted' }).locator('.count', { hasText: where })
  const moveTo = async (page: Page, where: string) => {
    const row = counted(page, bay)
    await row.getByRole('button', { name: 'Move some' }).click()
    await row.getByLabel('How many').fill('4')
    await row.getByLabel('To', { exact: true }).fill(where)
    await row.getByRole('button', { name: `Move ${kit}` }).click()
  }

  const office = await (await browser.newContext()).newPage()
  await ready(office, `#stock/product/${model}`)
  await expect(counted(office, bay)).toContainText('4')

  const phoneContext = await browser.newContext()
  const phone = await phoneContext.newPage()
  await ready(phone, `#stock/product/${model}`)
  await expect(counted(phone, bay)).toContainText('4')
  // Let the service worker take control so the app loads with no network.
  await phone.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15_000 }).catch(() => phone.reload())
  await phone.waitForFunction(() => navigator.serviceWorker?.controller != null)

  // Flight mode, then reload: the app and its data come from the device.
  await phoneContext.setOffline(true)
  await phone.reload()
  await expect(counted(phone, bay)).toContainText('4')
  await moveTo(phone, van1)
  await expect(counted(phone, van1)).toContainText('Waiting to sync')

  // Meanwhile the office moves the same four, online.
  await moveTo(office, van2)
  await expect(counted(office, van2)).toContainText('4')
  await expect(office.locator('.conn')).toHaveText('Up to date')

  // Signal back: the phone's move is turned down with a reason, counted
  // in the top bar and read from its list, and both devices show the
  // speakers where the office put them.
  await phoneContext.setOffline(false)
  await phone.evaluate(() => dispatchEvent(new Event('online')))
  const count = phone.getByRole('button', { name: /not done$/ })
  await expect(count).toHaveText('1 not done', { timeout: 20_000 })
  await count.click()
  const turnedDown = phone.getByRole('region', { name: 'Not done' }).locator('.row', { hasText: `Only 0 × ${kit} counted at ${bay}, not 4.` })
  await expect(turnedDown).toContainText(`Move 4 × ${kit} to ${van1}`)
  await turnedDown.getByRole('button', { name: 'Dismiss' }).click()
  await expect(count).toHaveCount(0)
  await expect(counted(phone, van2)).toContainText('4')
  await expect(counted(phone, van1)).toHaveCount(0)
  await expect(counted(phone, bay)).toHaveCount(0)
  await expect(phone.locator('.conn')).toHaveText('Up to date')
})
