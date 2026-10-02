import { expect, test } from '@playwright/test'

/**
 * Personal calendar feeds (ADR 0012): a read-only address for each person,
 * which the office copies from the Crew tab, freelancers find on their
 * page, and staff who also work jobs find on the Account tab.
 * To refresh the blueprint screenshots, run this file on its own with SHOTS=1.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const phoneSize = { width: 390, height: 844 }
// The address carries the test server's port, which playwright.config.ts takes from E2E_PORT.
const FEED = new RegExp(`^http://localhost:${process.env.E2E_PORT ?? '3099'}/cal/[\\w-]{24}\\.ics$`)

test('the office copies a freelancer their calendar address, the same one their page gives', async ({ browser }) => {
  const office = await (await browser.newContext({ viewport: phoneSize, permissions: ['clipboard-read', 'clipboard-write'] })).newPage()
  await office.goto('/#crew')
  await expect(office.getByRole('status')).toHaveText('Up to date')

  await office.getByRole('button', { name: 'Add person' }).click()
  const form = office.locator('form').filter({ has: office.getByRole('button', { name: 'Add person' }) })
  await form.getByLabel('Name').fill('Orla Murphy')
  await form.getByLabel('Mobile').fill('+353 86 765 4321')
  await form.getByRole('button', { name: 'Add person' }).click()
  await expect(office.getByRole('status')).toHaveText('Up to date')
  await office.getByRole('button', { name: 'Orla Murphy' }).click()

  const row = office.locator('.row.person').filter({ hasText: 'Orla Murphy' })
  await row.getByRole('button', { name: 'Copy calendar address' }).click()
  const feed = await office.evaluate(() => navigator.clipboard.readText())
  expect(feed).toMatch(FEED)
  await row.getByRole('button', { name: 'Copy link' }).click()
  const link = await office.evaluate(() => navigator.clipboard.readText())
  expect(link).toMatch(/\/f\/[\w-]{24}$/)
  expect(office.url()).toContain('#crew')

  // Her page, with no app and no JavaScript, gives the same address, in a field to copy it from (audit finding 21), and says what it's for.
  const phone = await (await browser.newContext({ viewport: phoneSize, javaScriptEnabled: false })).newPage()
  await phone.goto(link)
  const bookings = phone.locator('section').filter({ has: phone.getByRole('heading', { name: 'Your bookings' }) })
  await expect(bookings.getByLabel('Calendar address')).toHaveValue(feed)
  await expect(bookings.getByRole('link', { name: 'Subscribe' })).toHaveAttribute('href', feed.replace(/^http:/, 'webcal:'))
  await expect(bookings).toContainText("It only shows your bookings, so it's fine in a calendar you share.")
  await bookings.scrollIntoViewIfNeeded()
  await phone.screenshot(shot('feed-freelancer'))

  // A calendar app gets her (empty so far) calendar, with nothing in it that answers for her.
  const ics = await office.request.get(feed)
  expect(ics.headers()['content-type']).toContain('text/calendar')
  const body = await ics.text()
  expect(body).toContain('X-WR-CALNAME:Session Hire: Orla Murphy')
  expect(body).not.toContain(link.split('/f/')[1]!)
})

test('staff who also work jobs find their own bookings feed on the Account tab', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.route('**/api/me', (route) => route.fulfill({ json: { auth: 'google', user: { id: 'u7', email: 'ciara@sessionhire.com', name: 'Ciara Walsh' } } }))
  await page.goto('/#account')
  await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible()
  const card = page.getByRole('region', { name: 'Your bookings in your own calendar' })
  // Not in Crew yet: nothing to show.
  await expect(card).toHaveCount(0)

  await page.goto('/#crew')
  await page.getByRole('button', { name: 'Add person' }).click()
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add person' }) })
  await form.getByLabel('Name').fill('Ciara Walsh')
  await form.getByLabel('Email').fill('Ciara@SessionHire.com')
  await form.getByLabel('Type').selectOption('Staff')
  await form.getByRole('button', { name: 'Add person' }).click()
  await expect(page.getByRole('status')).toHaveText('Up to date')

  await page.goto('/#account')
  await expect(card).toBeVisible()
  const address = await card.getByLabel('Calendar address').inputValue()
  expect(address).toMatch(FEED)
  await expect(card.getByRole('link', { name: 'Subscribe' })).toHaveAttribute('href', address.replace(/^http:/, 'webcal:'))
  await expect(card.getByRole('button', { name: 'Copy address' })).toBeVisible()
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot(shot('feed-account'))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  const ics = await page.request.get(address)
  expect(ics.status()).toBe(200)
  expect(await ics.text()).toContain('X-WR-CALNAME:Session Hire: Ciara Walsh')
})
