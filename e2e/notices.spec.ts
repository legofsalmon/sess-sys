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

test("one maker's change to many of your jobs at once is one line on the list and one on the bell", async ({ page, request }) => {
  // Proves (audit, 20 October 2026, finding 68): three jobs made here and moved on together from another device are one
  // notification counting the jobs, opening to show each change, and the bell counts it once.
  await page.goto('/#jobs')
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add job' }) })
  const ids: string[] = []
  for (let i = 0; i < 3; i++) {
    const name = `Bulk Gig ${unique()}`
    await page.goto('/#jobs')
    await form.getByLabel('Job').fill(name)
    await form.getByLabel('Phase 1', { exact: true }).fill('Show')
    await form.getByLabel('Phase 1 from').fill('2026-11-21')
    await form.getByLabel('Phase 1 to').fill('2026-11-21')
    await form.getByRole('button', { name: 'Add job' }).click()
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
    ids.push(new URL(page.url()).hash.replace('#jobs/', ''))
  }
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await page.goto('/#notifications')
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible()
  await page.goto('/#home')

  const createdAt = new Date().toISOString()
  const res = await request.post('/api/sync/push', {
    data: {
      clientId: `e2ebulk${unique()}`,
      mutations: ids.map((id) => ({ id: `b${unique()}`, name: 'project.update', args: { id, status: 'lost' }, createdAt })),
      sentAt: createdAt,
    },
  })
  expect((await res.json()).results.map((r: { status: string }) => r.status)).toEqual(['applied', 'applied', 'applied'])

  const bell = page.getByRole('link', { name: /^Notifications/ }).first()
  await expect(bell).toHaveAccessibleName('Notifications, 1 new')
  await bell.click()
  const line = page.locator('.notice').filter({ hasText: '3 changes to 3 jobs of yours at once' })
  await expect(line).toContainText('New')
  await line.getByText('Show all 3').click()
  await expect(line.locator('.notice-fold li')).toHaveCount(3)
  await expect(line.locator('.notice-fold li a').first()).toHaveAttribute('href', /^#jobs\//)
})

test('looks for notifications once as the app opens, not on each move, and again only for a change that could be news', async ({ page, request }) => {
  // Proves: the copy read, the list is looked for once; moving between screens doesn't look again; a change pulled in that no notification can be about (a place in the warehouse) costs no look, and one that can (a job) does (audit, 20 October 2026, finding 14).
  const looks: string[] = []
  page.on('request', (r) => new URL(r.url()).pathname === '/api/notices' && looks.push(r.url()))
  await page.goto('/#home')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await expect.poll(() => looks.length).toBe(1)
  for (const hash of ['#jobs', '#crew', '#stock', '#home']) {
    await page.goto(`/${hash}`)
    await expect(page.locator('.conn')).toHaveText('Up to date')
  }
  const push = async (name: string, args: object) => {
    const pulled = page.waitForResponse((r) => r.url().includes('/api/sync/pull') && r.request().method() !== 'OPTIONS')
    const createdAt = new Date().toISOString()
    const res = await request.post('/api/sync/push', {
      data: { clientId: `e2elooks${unique()}`, mutations: [{ id: `l${unique()}`, name, args, createdAt }], sentAt: createdAt },
    })
    expect((await res.json()).results[0].status).toBe('applied')
    await pulled
  }
  await push('place.upsert', { id: `shelf-${unique()}`, name: `Shelf ${unique()}`, notes: '' })
  await page.waitForTimeout(500)
  expect(looks).toHaveLength(1)
  await push('project.create', { id: `j${unique()}`, name: `Looks Gig ${unique()}`, clientId: null, venueId: null, status: 'enquiry', notes: '' })
  await expect.poll(() => looks.length).toBe(2)
})
