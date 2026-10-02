import { expect, test } from '@playwright/test'

/**
 * A freelancer answering an offer from their link on a phone, with no app
 * and no script: a day they hold on another job starts unticked and says
 * so; the office's refusal lands in the offer's card, where they can see
 * it; Enter in the rate field sends the rate, never accepting the job at
 * the offered rate; the calendar address is a field to copy, with
 * Subscribe; and what's over is two dated lists. Uses the made-up data
 * (ADR 0019), so it starts fresh before and after: the other tests share
 * this server.
 */

const phoneSize = { width: 390, height: 844 }
const fresh = { data: { confirm: 'delete everything' } }

test('a clash is shown before the server says it, a refusal shows in the offer’s card, and Enter in the rate field sends the rate', async ({ browser, request }) => {
  // Proves: on a phone with no script the page warns of a clash, keeps a refusal on screen in its card, never accepts on Enter, offers the calendar address to copy, and dates what's over.
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)

  // Dara's link, as the office would send it.
  const { changes } = (await (await request.get('/api/sync/pull?after=0')).json()) as { changes: { entity: string; data: { name: string; linkToken: string } }[] }
  const dara = changes.find((c) => c.entity === 'person' && c.data.name === 'Dara Quinn')!
  const phone = await (await browser.newContext({ viewport: phoneSize, javaScriptEnabled: false })).newPage()
  await phone.goto(`/f/${dara.data.linkToken}`)
  const card = phone.getByRole('article').filter({ hasText: 'Brightwater Tech Summit' })
  await expect(card.locator('.tag')).toHaveText('Waiting on you')

  // The first day is one Dara holds at Harbour Lights: it starts unticked and says so, so the clash is seen before the server has to say it.
  const clash = card.getByRole('checkbox').first()
  await expect(clash).not.toBeChecked()
  await expect(card.locator('fieldset.days label').first()).toContainText('booked on Harbour Lights Festival (Show)')
  await expect(card.getByRole('checkbox').nth(1)).toBeChecked()

  // Ticked anyway and accepted: the refusal comes back in the card, on screen, as an alert.
  await clash.check()
  await card.getByRole('button', { name: 'Accept these days' }).click()
  const alert = card.getByRole('alert')
  await expect(alert).toHaveText(/^Already booked on Harbour Lights Festival/)
  const box = await alert.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(phoneSize.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(phoneSize.height)
  await expect(card.locator('.tag')).toHaveText('Waiting on you')
  await expect(card.getByRole('checkbox').first()).not.toBeChecked()

  // Asks for a different rate for the day that's free, with Enter in the rate field: the rate goes to the office, nothing is accepted.
  // Typed with a euro sign and a comma, as the audit found it (finding 15): the browser lets it through and the page reads it as €1,250.
  await card.getByText('Ask for a different rate or add a note').click()
  const rate = card.getByLabel("Day rate you'd do it for")
  await rate.fill('€1,250')
  await rate.press('Enter')
  await expect(card.getByRole('status')).toHaveText('Thanks, your rate has gone to the office.')
  await expect(card.locator('.tag')).toHaveText('Rate sent to the office')
  await expect(card.getByText('€1250 a day asked (offered €320)')).toBeVisible()

  // The calendar address is a field to copy by hand, with Subscribe for the calendar apps that take a webcal: link. Without script there's no Copy button to press for nothing.
  const address = phone.getByLabel('Calendar address')
  await expect(address).toHaveValue(/^http:\/\/localhost:\d+\/cal\/[\w-]{24}\.ics$/)
  await expect(address).toHaveAttribute('readonly', '')
  await expect(phone.getByRole('link', { name: 'Subscribe' })).toHaveAttribute('href', /^webcal:\/\/localhost:\d+\/cal\/[\w-]{24}\.ics$/)
  await expect(phone.getByRole('button', { name: 'Copy address' })).toBeHidden()

  // What's over is two lists, each line with its days: the gala Dara worked, and Laoise's no to the load-in.
  await expect(phone.getByRole('heading', { name: 'Earlier' })).toHaveCount(0)
  const past = phone.locator('section', { has: phone.getByRole('heading', { name: 'Past work' }) })
  await expect(past.locator('li').first()).toContainText(/^Autumn Gala \(Show\) · Sound No\.1 · \w{3} \d{1,2} \w{3} to \w{3} \d{1,2} \w{3} Confirmed$/)
  const laoise = changes.find((c) => c.entity === 'person' && c.data.name === 'Laoise Keane')!
  await phone.goto(`/f/${laoise.data.linkToken}`)
  const turned = phone.locator('section', { has: phone.getByRole('heading', { name: 'Declined and withdrawn' }) })
  await expect(turned.locator('li').first()).toContainText(/^Harbour Lights Festival \(Load in\) · Stagehand · \w{3} \d{1,2} \w{3} to \w{3} \d{1,2} \w{3} You declined on \w{3} \d{1,2} \w{3}$/)

  // With script, Copy address puts the address on the clipboard and says so.
  const withScript = await browser.newContext({ viewport: phoneSize, permissions: ['clipboard-read', 'clipboard-write'] })
  const scripted = await withScript.newPage()
  await scripted.goto(`/f/${dara.data.linkToken}`)
  // Found by its place, not its words: pressed, it says "Copied".
  const copy = scripted.locator('button.copy')
  await expect(copy).toHaveText('Copy address')
  await copy.click()
  await expect(copy).toHaveText('Copied')
  expect(await scripted.evaluate(() => navigator.clipboard.readText())).toMatch(/\/cal\/[\w-]{24}\.ics$/)

  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})
