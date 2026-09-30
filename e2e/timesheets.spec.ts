import { expect, test } from '@playwright/test'

/**
 * Timesheets (ADR 0022): the office checks one sent with extras, changes
 * the mileage and approves it; asks a freelancer who hasn't sent theirs,
 * who sends it from their link on a phone with no app; and the first sees
 * what was approved, and what changed. Uses the made-up data (ADR 0019),
 * so it starts fresh before and after: the other tests share this server.
 * To refresh the blueprint screenshots, run this file on its own with SHOTS=1.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const phoneSize = { width: 390, height: 844 }
const fresh = { data: { confirm: 'delete everything' } }

test('the office approves timesheets, and a freelancer sends theirs from their link', async ({ browser, request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)

  const office = await (await browser.newContext({ viewport: phoneSize, permissions: ['clipboard-read', 'clipboard-write'] })).newPage()
  await office.goto('/#crew')
  const card = office.getByRole('region', { name: 'Timesheets' })
  const toApprove = card.getByRole('group', { name: 'To approve' })
  await expect(toApprove).toContainText('Dara Quinn')
  await expect(toApprove).toContainText('€683.50')
  await expect(card.getByRole('group', { name: 'Not in yet' })).toContainText('Laoise Keane')
  await expect(card.getByRole('group', { name: 'Approved lately' })).toContainText('Tadhg Brady')
  await expect(card.getByRole('group', { name: 'Approved lately' })).toContainText('€412')

  // Dara's: the mileage brought down, with a note saying why, and what Dara will see changed.
  await toApprove.getByRole('link', { name: 'Check' }).click()
  await expect(office.getByRole('heading', { name: 'Dara Quinn' })).toBeVisible()
  await expect(office.getByText('“Receipts in the post.”')).toBeVisible()
  await expect(office.getByText('2 days at €320, and €43.50 of extras: €683.50')).toBeVisible()
  await office.getByLabel('€', { exact: true }).nth(1).fill('20')
  await office.getByLabel('Note for Dara').fill('Mileage at the civil service rate.')
  await expect(office.getByText('Mileage: €20, not €25.50')).toBeVisible()
  await office.screenshot(shot('timesheet-office'))
  await office.getByRole('button', { name: 'Approve €678' }).click()
  await expect(office.getByRole('region', { name: 'Approved' }).getByRole('heading', { name: 'Approved: €678' })).toBeVisible()
  await expect(office.getByRole('status')).toHaveText('Up to date')

  // Laoise hasn't sent hers: asked for it, with a link straight to it.
  await office.getByRole('link', { name: '‹ Crew' }).click()
  await card.getByRole('button', { name: 'Ask Laoise Keane for their timesheet' }).click()
  const ask = office.getByRole('region', { name: 'Send timesheet request to Laoise Keane' })
  const message = await ask.locator('textarea').inputValue()
  expect(message).toMatch(/^Hi Laoise, could you send your timesheet for Autumn Gala \(Show\)\?/)
  const link = /(http\S+\/f\/\S+\/timesheet\/\S+)$/.exec(message)![1]!

  // Laoise's phone, with no app and no script: her days are ticked, she adds her parking and sends it.
  const phone = await (await browser.newContext({ viewport: phoneSize, javaScriptEnabled: false })).newPage()
  await phone.goto(link)
  await expect(phone.getByRole('heading', { name: /Autumn Gala/ })).toBeVisible()
  await expect(phone.getByText('€200 a day, as agreed.')).toBeVisible()
  await phone.getByLabel('What').first().fill('Parking')
  await phone.getByLabel('€', { exact: true }).first().fill('12')
  await phone.screenshot(shot('timesheet-crew'))
  await phone.getByRole('button', { name: 'Send to the office' }).click()
  await expect(phone.getByText("Thanks, it's gone to the office.")).toBeVisible()
  await expect(phone.getByText('€412 in all')).toBeVisible()

  // The office sees it arrive.
  await expect(card.getByRole('group', { name: 'To approve' })).toContainText('Laoise Keane')

  // And Dara sees on their link what was approved, and what changed.
  await office.getByRole('button', { name: /^Dara Quinn/ }).click()
  await office.getByRole('button', { name: 'Copy link' }).click()
  const daraLink = await office.evaluate(() => navigator.clipboard.readText())
  const dara = await (await browser.newContext({ viewport: phoneSize, javaScriptEnabled: false })).newPage()
  await dara.goto(daraLink)
  await dara.getByRole('link', { name: /Approved: €678/ }).click()
  await expect(dara.getByRole('heading', { name: 'Approved: €678' })).toBeVisible()
  await expect(dara.getByText('Mileage: €20, not €25.50')).toBeVisible()
  await expect(dara.getByText('Mileage at the civil service rate.')).toBeVisible()

  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})
