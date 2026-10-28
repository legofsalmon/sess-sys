import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * Timesheets off until the office says (ADR 0089): Crew's row, the Menu
 * and the Timesheets page say nothing of them while off, a timesheet's
 * address says they're off, and the office turns them on under Admin ›
 * Company, which brings the page back.
 */

const phoneSize = { width: 390, height: 844 }

async function use(request: APIRequestContext, on: boolean) {
  const res = await request.post('/api/sync/push', {
    data: {
      clientId: 'e2e-timesheets-switch',
      mutations: [{ id: `e2e-timesheets-${on}-${Date.now()}`, name: 'timesheets.use', args: { on }, createdAt: new Date().toISOString() }],
    },
  })
  expect(((await res.json()) as { results: { status: string }[] }).results.map((r) => r.status)).toEqual(['applied'])
}

test('timesheets are hidden while off, and the office turns them on under Admin', async ({ browser, request }) => {
  // Whatever another test left: off, as a fresh company starts.
  await use(request, false)
  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await office.goto('/#crew')
  await expect(office.getByRole('status')).toHaveText('Up to date')
  const row = office.getByRole('navigation', { name: 'Crew pages' })
  await expect(row.getByRole('link', { name: /^People/ })).toBeVisible()
  await expect(row.getByRole('link', { name: /^Timesheets/ })).toHaveCount(0)

  await office.goto('/#menu')
  await expect(office.getByRole('link', { name: /^Leave/ })).toBeVisible()
  await expect(office.getByRole('link', { name: /^Timesheets/ })).toHaveCount(0)

  // An old address still opens, and says where they're turned on.
  await office.goto('/#crew/timesheets')
  const off = office.getByRole('region', { name: 'Timesheets are off' })
  await expect(off).toContainText('Any already sent are kept.')
  await off.getByRole('link', { name: 'Admin › Company' }).click()

  const card = office.getByRole('region', { name: 'Timesheets' })
  const toggle = card.getByRole('switch', { name: /Use timesheets/ })
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()

  await office.goto('/#crew')
  await row.getByRole('link', { name: /^Timesheets/ }).click()
  await expect(office.getByRole('heading', { level: 1, name: 'Timesheets' })).toBeVisible()
  await expect(office.getByRole('region', { name: 'Timesheets are off' })).toHaveCount(0)

  // Left off, as a fresh company starts, for the tests after this one.
  await use(request, false)
})
