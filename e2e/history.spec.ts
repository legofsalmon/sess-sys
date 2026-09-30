import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'

/**
 * The History tab and "Download everything" (ADR 0006), in a real browser.
 * The test server is shared with the other browser tests, so each test
 * looks for its own entries by name rather than at the whole history.
 */

const unique = () => Math.random().toString(36).slice(2, 8)

/** The end of this device's own code, as the Account tab shows it. */
async function deviceCode(page: Page) {
  await page.goto('/#account')
  const text = await page.getByText(/^Device \w{6} ·/).textContent()
  return /^Device (\w{6})/.exec(text ?? '')![1]!
}

test('shows who did what, on which device, and what was made offline', async ({ page }) => {
  // The phone's clock, so two hours can pass without waiting for them.
  await page.clock.install()
  const code = await deviceCode(page)
  const kit = `Shure SM58 ${unique()}`
  const job = `Galway Races ${unique()}`

  await page.goto('/#stock/sync-test')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await page.locator('#product-name').fill(kit)
  await page.locator('#product-qty').fill('12')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.locator('.stock li', { hasText: kit })).toContainText('12 of 12 free')
  await expect(page.getByRole('status')).toHaveText('Up to date')

  // Booked with no signal, and sent two hours later.
  await page.getByText('Simulate no signal').click()
  await page.locator('#book-project').fill(job)
  await page.locator('#book-product').selectOption({ label: kit })
  await page.locator('#book-qty').fill('6')
  await page.getByRole('button', { name: 'Book' }).click()
  const booking = page.locator('.row', { hasText: job })
  await expect(booking).toContainText('Waiting to sync')
  await page.clock.fastForward('02:00:00')
  await page.getByText('Simulate no signal').click()
  await expect(booking).toContainText('Confirmed')
  await expect(page.getByRole('status')).toHaveText('Up to date')

  await page.getByRole('link', { name: 'History' }).click()
  const booked = page.locator('.entry', { hasText: `Booked 6 × ${kit} for ${job}` })
  await expect(booked).toBeVisible()
  await expect(booked).toContainText(`Someone · Chrome on Linux, device ${code}`)
  await expect(booked).toContainText('Made offline; it reached the server 2 h later.')

  const added = page.locator('.entry', { hasText: `Set ${kit} to 12 in stock` })
  await expect(added).toBeVisible()
  await expect(added).not.toContainText('Made offline')
})

test('says the history needs signal', async ({ page }) => {
  await page.route('**/api/history**', (route) => route.abort('internetdisconnected'))
  await page.goto('/#history')
  await expect(page.getByText("The history needs signal: it's kept on the server, not on this device.")).toBeVisible()
  await page.unroute('**/api/history**')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('.entry').first()).toBeVisible()
})

test('downloads everything in one file, and the download shows in the history', async ({ page }) => {
  const code = await deviceCode(page)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download everything' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^session-hire-\d{4}-\d{2}-\d{2}\.zip$/)
  await expect(page.getByText(/^Downloaded session-hire-\d{4}-\d{2}-\d{2}\.zip \(\d+ KB\)\.$/)).toBeVisible()

  const files = unzipSync(readFileSync((await download.path())!))
  expect(Object.keys(files)).toEqual(expect.arrayContaining(['README.txt', 'history.csv', 'everything.json', 'tables/products.csv', 'tables/people.csv']))
  expect(strFromU8(files['README.txt']!)).toContain('Session Hire: everything, exported')

  await page.getByRole('link', { name: 'History' }).click()
  await expect(page.locator('.entry', { hasText: `Chrome on Linux, device ${code}` }).filter({ hasText: /^Downloaded everything \(\d+ rows\)/ })).not.toHaveCount(0)
})
