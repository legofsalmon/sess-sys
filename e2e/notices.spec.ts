import { expect, test } from '@playwright/test'

/**
 * Notifications (ADR 0058), in a real browser: a job made on this device and
 * changed from another pops up at the edge as the change arrives, the bell
 * counts it, and the list it opens marks it new and reads it. Sign-in is off
 * here, so the device stands in for the person.
 */

const unique = () => Math.random().toString(36).slice(2, 8)

test('pops up a change someone else made to a job you made, counts it on the bell, and lists it', async ({ page, request }) => {
  // Proves: another device's change to this device's job is news here within a sync, the pop-up's Open goes to the job, and opening the list reads it.
  const name = `Notice Gig ${unique()}`
  await page.goto('/#jobs')
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add job' }) })
  await form.getByLabel('Job').fill(name)
  await form.getByLabel('Phase 1', { exact: true }).fill('Show')
  await form.getByLabel('Phase 1 from').fill('2026-11-20')
  await form.getByLabel('Phase 1 to').fill('2026-11-20')
  await form.getByRole('button', { name: 'Add job' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  await expect(page.locator('.conn')).toHaveText('Up to date')
  const id = new URL(page.url()).hash.replace('#jobs/', '')

  // Nothing of this device's own is news to it.
  const bell = page.getByRole('link', { name: /^Notifications/ }).first()
  await expect(bell).toHaveAccessibleName('Notifications')

  // The office, on another device, moves it on.
  await page.goto('/#home')
  const createdAt = new Date().toISOString()
  const res = await request.post('/api/sync/push', {
    data: {
      clientId: `e2enotices${unique()}`,
      mutations: [{ id: `n${unique()}`, name: 'project.update', args: { id, status: 'confirmed' }, createdAt }],
      sentAt: createdAt,
    },
  })
  expect((await res.json()).results[0].status).toBe('applied')

  const toast = page.locator('.toaster .toast').filter({ hasText: name })
  await expect(toast).toBeVisible()
  await expect(toast).toContainText('A job you made')
  await expect(bell).toHaveAccessibleName('Notifications, 1 new')
  await expect(page.locator('.toaster .toasts[aria-live="polite"]')).toHaveCount(1)

  // Its one action goes to the job.
  await toast.getByRole('link', { name: 'Open' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()

  // The list marks it new, in words, and opening it reads it.
  await bell.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible()
  const row = page.locator('.notice').filter({ hasText: name })
  await expect(row).toContainText('New')
  await expect(row.getByRole('link')).toHaveAttribute('href', `#jobs/${id}`)
  await expect(bell).toHaveAccessibleName('Notifications')

  // Pop-ups can be turned off on this device; the list stays.
  const popUps = page.getByRole('switch', { name: /Pop up as they come in/ })
  await expect(popUps).toBeChecked()
  await popUps.click()
  await expect(popUps).not.toBeChecked()
  await popUps.click()
  await expect(popUps).toBeChecked()
})
