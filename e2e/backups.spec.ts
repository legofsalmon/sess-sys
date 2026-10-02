import { expect, test } from '@playwright/test'

/**
 * The Backups card on the Account tab. The test server has no backup
 * storage, so it shows backups as off; a server with storage is played by
 * answering the backup calls here.
 */

const today = (hour: number) => {
  const d = new Date()
  d.setHours(hour, 2, 0, 0)
  return d.toISOString()
}

test('says plainly when nothing is being backed up', async ({ page }) => {
  await page.goto('/#account')
  await expect(page.getByRole('heading', { name: 'Backups are off' })).toBeVisible()
  await expect(page.getByText('Nothing is being backed up yet.')).toBeVisible()
  // And where the list of people erased on request lives meanwhile (ADR 0027).
  await expect(page.getByText("the list of people whose details were erased on request is kept only with the app's own data")).toBeVisible()
})

test('shows the last backup, and backs up on request', async ({ page }) => {
  const lastOk = { id: 'r1', startedAt: today(3), finishedAt: today(3), status: 'ok', trigger: 'nightly', key: 'backups/x', bytes: 18_000, rows: 40 }
  await page.route('**/api/backups', (route) =>
    route.fulfill({ json: { configured: true, where: 'bucket backups at t3.storageapi.dev', fresh: true, last: lastOk, lastOk } })
  )
  await page.route('**/api/backups/run', (route) =>
    route.fulfill({ json: { ...lastOk, id: 'r2', trigger: 'manual', rows: 42, bytes: 18_500 } })
  )
  await page.goto('/#account')
  await expect(page.getByRole('heading', { name: 'Backups', exact: true })).toBeVisible()
  await expect(page.getByText(/Last backup today at 03:02, 18 KB, checked by a test restore\./)).toBeVisible()

  await page.getByRole('button', { name: 'Back up now' }).click()
  await expect(page.getByText('Backed up 42 rows (18 KB) and checked by a test restore.')).toBeVisible()
})

test('flags a backup that failed', async ({ page }) => {
  const lastOk = { id: 'r1', startedAt: '2026-09-01T02:00:00Z', finishedAt: '2026-09-01T02:00:09Z', status: 'ok', trigger: 'nightly', bytes: 18_000 }
  const failed = { id: 'r2', startedAt: today(3), finishedAt: today(3), status: 'failed', trigger: 'nightly', error: 'The backup storage answered 403: Access Denied' }
  await page.route('**/api/backups', (route) => route.fulfill({ json: { configured: true, fresh: false, last: failed, lastOk } }))
  await page.goto('/#account')
  await expect(page.getByText("That's more than a day ago, so the nightly backup isn't working.")).toBeVisible()
  await expect(page.getByRole('alert')).toHaveText('The last try failed today at 03:02: The backup storage answered 403: Access Denied')
})
