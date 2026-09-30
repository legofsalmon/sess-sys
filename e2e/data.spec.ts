import { expect, test } from '@playwright/test'

/**
 * Made-up data and starting fresh (ADR 0019) from the Account tab: put it
 * in, see it everywhere marked as made up, then delete everything and watch
 * another phone empty too. The other tests share this server, so this one
 * starts fresh before it begins, and leaves the app empty.
 * To refresh the blueprint screenshots, run this file on its own with SHOTS=1.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const phoneSize = { width: 390, height: 844 }

test('puts in made-up data, then starts fresh on every phone', async ({ browser, request }) => {
  expect((await request.post('/api/data/start-fresh', { data: { confirm: 'delete everything' } })).ok()).toBe(true)

  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await office.goto('/#account')
  const card = office.locator('section.data')
  await expect(card.getByRole('heading', { name: 'Try it with made-up data' })).toBeVisible()
  await card.getByRole('button', { name: 'Put in made-up data' }).click()
  await expect(card.getByRole('status')).toHaveText('Made-up data is in. Have a look round Jobs, Crew and Stock.')
  await expect(card.getByRole('heading', { name: 'Made-up data' })).toBeVisible()
  await expect(office.locator('.brand small')).toHaveText('Account · made-up data')

  // Every screen says it's made up.
  await office.goto('/#jobs')
  await expect(office.locator('.brand small')).toHaveText('Jobs · made-up data')
  const harbour = office.locator('.job-row', { hasText: 'Harbour Lights Festival' })
  await expect(harbour.getByText('Kit short')).toBeVisible()
  await office.evaluate(() => scrollTo(0, 0))
  await office.screenshot(shot('data-jobs'))
  await office.goto('/#crew')
  await expect(office.locator('.brand small')).toHaveText('Crew · made-up data')
  await expect(office.getByRole('button', { name: 'Fionn Gallagher' })).toBeVisible()
  await office.goto('/#stock')
  await expect(office.locator('.brand small')).toHaveText('Stock · made-up data')
  await expect(office.getByText('d&b Y10P').first()).toBeVisible()

  // Another phone, open on the jobs.
  const other = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await other.goto('/#jobs')
  await expect(other.getByText('Harbour Lights Festival')).toBeVisible()

  // Deleting everything takes the words typed.
  await office.goto('/#account')
  await expect(card.getByText('Backups are off, so it can\'t be undone. Download everything first, above, to keep a copy.')).toBeVisible()
  const remove = card.getByRole('button', { name: 'Delete everything' })
  await card.getByLabel('Type “delete everything” to confirm').fill('delete')
  await expect(remove).toBeDisabled()
  await card.getByLabel('Type “delete everything” to confirm').fill('delete everything')
  await expect(remove).toBeEnabled()
  await card.scrollIntoViewIfNeeded()
  await office.screenshot(shot('data-start-fresh'))
  await remove.click()
  await expect(card.getByRole('status')).toHaveText('Started fresh. The app is empty, here and on every phone as it syncs.')
  await expect(card.getByRole('heading', { name: 'Try it with made-up data' })).toBeVisible()
  await expect(office.locator('.brand small')).toHaveText('Account')

  // The other phone empties by itself, as soon as the server tells it.
  await expect(other.getByText('Harbour Lights Festival')).toHaveCount(0)
  await expect(other.locator('.brand small')).toHaveText('Jobs')

  // The history holds only who started fresh.
  await office.goto('/#history')
  await expect(office.locator('.entry')).toHaveCount(1)
  await expect(office.locator('.entry').first()).toContainText(/^Started fresh: deleted everything \([\d,]+ rows\) except the staff accounts/)
})
