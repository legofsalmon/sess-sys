import { expect, test, type Page } from '@playwright/test'

/**
 * The Phase 0 "done when", in a real browser: two devices, one physically
 * offline (the browser's network switched off, page reloaded from the
 * installed app), both booking the last four speakers. The test server is
 * shared with the other browser tests, so the speakers and jobs here have
 * names of their own and each check looks at their own rows.
 */

async function ready(page: Page) {
  await page.goto('/#stock/sync-test')
  await expect(page.getByRole('status')).toHaveText('Up to date')
}

test('two devices, one offline, four speakers', async ({ browser }) => {
  const id = Math.random().toString(36).slice(2, 8)
  const kit = `d&b Y10P ${id}`
  const [fuel, nissan] = [`Fuel ${id}`, `Nissan ${id}`]
  const stock = (page: Page) => page.locator('.stock li', { hasText: kit })
  const booking = (page: Page, project: string) => page.locator('.row', { hasText: project })
  const book = async (page: Page, project: string) => {
    await page.locator('#book-project').fill(project)
    await page.locator('#book-product').selectOption({ label: kit })
    await page.locator('#book-qty').fill('4')
    await page.getByRole('button', { name: 'Book' }).click()
  }

  const office = await (await browser.newContext()).newPage()
  await ready(office)
  await office.locator('#product-name').fill(kit)
  await office.locator('#product-qty').fill('4')
  await office.getByRole('button', { name: 'Add' }).click()
  await expect(stock(office)).toContainText('4 of 4 free')

  const phoneContext = await browser.newContext()
  const phone = await phoneContext.newPage()
  await ready(phone)
  await expect(stock(phone)).toContainText('4 of 4 free')
  // Let the service worker take control so the app loads with no network.
  await phone.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15_000 }).catch(() => phone.reload())
  await phone.waitForFunction(() => navigator.serviceWorker?.controller != null)

  // Flight mode, then reload: the app and its data come from the device.
  await phoneContext.setOffline(true)
  await phone.reload()
  await expect(stock(phone)).toContainText('4 of 4 free')
  await book(phone, fuel)
  await expect(booking(phone, fuel)).toContainText('Waiting to sync')

  // Meanwhile the office books the same four, online.
  await book(office, nissan)
  await expect(booking(office, nissan)).toContainText('Confirmed')

  // Signal back: the phone's request is turned down with a reason, counted
  // in the top bar and read from its list, and both devices show the same
  // confirmed booking.
  await phoneContext.setOffline(false)
  await phone.evaluate(() => dispatchEvent(new Event('online')))
  const count = phone.getByRole('button', { name: /not done$/ })
  await expect(count).toHaveText('1 not done', { timeout: 20_000 })
  await count.click()
  const turnedDown = phone.getByRole('region', { name: 'Not done' }).locator('.row', { hasText: `Only 0 × ${kit} free` })
  await expect(turnedDown).toContainText(`Book 4 × ${kit} for ${fuel}`)
  await turnedDown.getByRole('button', { name: 'Dismiss' }).click()
  await expect(count).toHaveCount(0)
  await expect(booking(phone, nissan)).toContainText('Confirmed')
  await expect(phone.getByText(fuel)).toHaveCount(0)
  await expect(phone.getByRole('status')).toHaveText('Up to date')
})
