import { expect, test, type Page } from '@playwright/test'

/**
 * The Phase 0 "done when", in a real browser: two devices, one physically
 * offline (the browser's network switched off, page reloaded from the
 * installed app), both booking the last four speakers.
 */

async function ready(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('status')).toHaveText('Up to date')
}

test('two devices, one offline, four speakers', async ({ browser }) => {
  const office = await (await browser.newContext()).newPage()
  await ready(office)
  await office.locator('#product-name').fill('d&b Y10P')
  await office.locator('#product-qty').fill('4')
  await office.getByRole('button', { name: 'Add' }).click()
  await expect(office.getByText('4 of 4 free')).toBeVisible()

  const phoneContext = await browser.newContext()
  const phone = await phoneContext.newPage()
  await ready(phone)
  await expect(phone.getByText('4 of 4 free')).toBeVisible()
  // Let the service worker take control so the app loads with no network.
  await phone.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15_000 }).catch(() => phone.reload())
  await phone.waitForFunction(() => navigator.serviceWorker?.controller != null)

  // Flight mode, then reload: the app and its data come from the device.
  await phoneContext.setOffline(true)
  await phone.reload()
  await expect(phone.getByText('4 of 4 free')).toBeVisible()
  await phone.locator('#book-project').fill('Fuel')
  await phone.locator('#book-qty').fill('4')
  await phone.getByRole('button', { name: 'Book' }).click()
  await expect(phone.getByText('Waiting to sync')).toBeVisible()

  // Meanwhile the office books the same four, online.
  await office.locator('#book-project').fill('Nissan')
  await office.locator('#book-qty').fill('4')
  await office.getByRole('button', { name: 'Book' }).click()
  await expect(office.getByText('Confirmed')).toBeVisible()

  // Signal back: the phone's request is turned down with a reason, and
  // both devices show the same confirmed booking.
  await phoneContext.setOffline(false)
  await phone.evaluate(() => dispatchEvent(new Event('online')))
  await expect(phone.getByText('Not booked')).toBeVisible({ timeout: 20_000 })
  await expect(phone.getByText(/Only 0 × d&b Y10P free/)).toBeVisible()
  await expect(phone.getByText('Nissan')).toBeVisible()
  await expect(phone.getByText('Fuel')).toHaveCount(0)
  await expect(phone.getByRole('status')).toHaveText('Up to date')
})
