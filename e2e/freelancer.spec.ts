import { expect, test } from '@playwright/test'

/**
 * A freelancer answering an offer from their link on a phone, with no app
 * and no script: the office's refusal lands in the offer's card, where
 * they can see it; and Enter in the rate field sends the rate, never
 * accepting the job at the offered rate. Uses the made-up data (ADR 0019),
 * so it starts fresh before and after: the other tests share this server.
 */

const phoneSize = { width: 390, height: 844 }
const fresh = { data: { confirm: 'delete everything' } }

test('a refusal shows in the offer’s card, and Enter in the rate field sends the rate', async ({ browser, request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)

  // Dara's link, as the office would send it.
  const { changes } = (await (await request.get('/api/sync/pull?after=0')).json()) as { changes: { entity: string; data: { name: string; linkToken: string } }[] }
  const dara = changes.find((c) => c.entity === 'person' && c.data.name === 'Dara Quinn')!
  const phone = await (await browser.newContext({ viewport: phoneSize, javaScriptEnabled: false })).newPage()
  await phone.goto(`/f/${dara.data.linkToken}`)
  const card = phone.getByRole('article').filter({ hasText: 'Brightwater Tech Summit' })
  await expect(card.locator('.tag')).toHaveText('Waiting on you')

  // Accepts as offered, but Dara is at Harbour Lights on the first day: the refusal comes back in the card, on screen, as an alert.
  await card.getByRole('button', { name: 'Accept these days' }).click()
  const alert = card.getByRole('alert')
  await expect(alert).toHaveText(/^Already booked on Harbour Lights Festival/)
  const box = (await alert.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(phoneSize.width)
  expect(box.y + box.height).toBeLessThanOrEqual(phoneSize.height)
  await expect(card.locator('.tag')).toHaveText('Waiting on you')

  // Drops the clashing day and asks for a different rate, with Enter in the rate field: the rate goes to the office, nothing is accepted.
  await card.getByRole('checkbox').first().uncheck()
  await card.getByText('Ask for a different rate or add a note').click()
  const rate = card.getByLabel("Day rate you'd do it for")
  await rate.fill('350')
  await rate.press('Enter')
  await expect(card.getByRole('status')).toHaveText('Thanks, your rate has gone to the office.')
  await expect(card.locator('.tag')).toHaveText('Rate sent to the office')
  await expect(card.getByText('€350 a day asked (offered €320)')).toBeVisible()

  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})
