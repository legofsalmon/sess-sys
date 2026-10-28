import { expect, test } from '@playwright/test'

/**
 * Admin › Status (ADR 0093). The test server has no sign-in, no backups and no Sentry, keeps its data in a folder, and
 * points the map search and GitHub nowhere, so it has plenty to say; a server where everything works is played by
 * answering the status call here.
 */

test('names what needs a look first, and says what to do about each', async ({ page }) => {
  await page.goto('/#admin/status')
  await expect(page.getByRole('tab', { name: 'Status' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: /things need a look/ })).toBeVisible()
  const backups = page.locator('#status-backups')
  await expect(backups.getByText('Not working')).toBeVisible()
  await expect(backups.getByText(/What to do: Set the BACKUP_S3_ settings/)).toBeVisible()
  // GitHub not answering doesn't count against the app.
  await expect(page.locator('#status-updates').getByText('Off')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Services outside the app' })).toBeVisible()
})

test('is quiet when everything works, and looks again on request', async ({ page }) => {
  let asked = 0
  await page.route('**/api/status*', (route) => {
    asked++
    return route.fulfill({
      json: {
        checkedAt: new Date().toISOString(),
        version: '1.49.0',
        commit: 'abc123def456',
        upSince: new Date().toISOString(),
        checks: [
          { id: 'database', group: 'app', name: 'Database', state: 'ok', says: 'Neon is answering, holding 40 MB.' },
          { id: 'maps', group: 'outside', name: 'Map search', state: 'ok', says: 'OpenStreetMap’s search answers.' },
        ],
      },
    })
  })
  await page.goto('/#admin/status')
  await expect(page.getByRole('heading', { name: 'Everything is working' })).toBeVisible()
  await expect(page.locator('#status-database').getByText('Working')).toBeVisible()
  await expect(page.getByText('What to do')).toHaveCount(0)
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect.poll(() => asked).toBe(2)
})
