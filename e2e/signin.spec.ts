import { expect, test, type Page } from '@playwright/test'

/**
 * Staff sign-in in the browser. The test server runs without Google, so a
 * server with sign-in switched on is played by answering the API calls
 * here: 401 for a device that isn't signed in, or a signed-in person.
 */

/** The device's saved copy of the data, straight from IndexedDB. */
const deviceCopy = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('session-hire', 1)
        req.onsuccess = () => {
          const get = req.result.transaction('sync').objectStore('sync').get('snapshot')
          get.onsuccess = () => resolve(get.result ?? null)
        }
      })
  )

const notSignedIn = async (page: Page) => {
  await page.route('**/api/me', (route) => route.fulfill({ status: 401, json: { auth: 'google', error: 'Sign in first.' } }))
  await page.route(/\/api\/sync\/(push|pull)/, (route) => route.fulfill({ status: 401, json: { error: 'Sign in first.' } }))
}

test('a device that is signed out sees only the way in, and keeps what it has waiting', async ({ page }) => {
  await page.goto('/#stock/sync-test')
  await expect(page.getByRole('status')).toHaveText('Up to date')

  // Sign-in gets switched on while this device holds a change. The test
  // server is shared with the other browser tests, so the kit has a name of its own.
  const kit = `d&b Y10P ${Math.random().toString(36).slice(2, 8)}`
  await notSignedIn(page)
  await page.locator('#product-name').fill(kit)
  await page.locator('#product-qty').fill('4')
  await page.getByRole('button', { name: 'Add' }).click()

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByText(kit)).toHaveCount(0)
  await expect(page.getByText('1 change made on this device is waiting')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', '/api/auth/google/start?next=%23stock%2Fsync-test')

  // Once the device is let in again, the waiting change goes through.
  await page.unrouteAll()
  await page.reload()
  await expect(page.locator('.stock li', { hasText: kit })).toContainText('4 of 4 free')
  await expect(page.getByRole('status')).toHaveText('Up to date')
})

test('says why a sign-in was refused, then tidies the address', async ({ page }) => {
  await notSignedIn(page)
  await page.goto('/?signin=denied#crew')
  await expect(page.getByRole('alert')).toContainText("That Google account isn't set up for Session Hire")
  await expect(page).toHaveURL(/\/#crew$/)
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', '/api/auth/google/start?next=%23crew')
})

test('shows who is signed in, and signing out clears the device', async ({ page }) => {
  let signedIn = true
  await page.route('**/api/me', (route) =>
    signedIn
      ? route.fulfill({ json: { auth: 'google', user: { id: 'u1', email: 'aoife@sessionhire.com', name: 'Aoife Byrne' } } })
      : route.fulfill({ status: 401, json: { auth: 'google', error: 'Sign in first.' } })
  )
  await page.route(/\/api\/sync\/(push|pull)/, (route) =>
    signedIn ? route.continue() : route.fulfill({ status: 401, json: { error: 'Sign in first.' } })
  )
  await page.route('**/api/auth/signout', (route) => {
    signedIn = false
    return route.fulfill({ json: { ok: true } })
  })

  await page.goto('/#account')
  await expect(page.getByText('Aoife Byrne')).toBeVisible()
  await expect(page.getByText('aoife@sessionhire.com')).toBeVisible()
  await expect.poll(() => deviceCopy(page)).not.toBeNull()

  await page.getByRole('button', { name: 'Sign out' }).click()
  // Signing out reloads the app at its start, signed out.
  await page.waitForURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  expect(await deviceCopy(page)).toBeNull()
})
