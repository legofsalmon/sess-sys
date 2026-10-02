import { expect, test } from '@playwright/test'

/**
 * Refusals, where they can be seen (audit findings 11 and 15): a change
 * the server turns down is counted in the top bar on every screen and
 * listed from it, whichever area it came from, saying what was asked and
 * why not, with the list never over the bar; a change the device turns
 * down is said beside the form that asked, with what was typed kept and
 * no browser dialog;
 * a question before something that can't be undone is asked in the app,
 * with what will happen in words; and a price typed with a euro sign or
 * thousands is read as the person means it. The test server is shared
 * with the other browser tests, so every name here is this run's own.
 */

const phoneSize = { width: 390, height: 844 }
const tag = () => Math.random().toString(36).slice(2, 8)

test('a change the server turns down is counted in the top bar and listed from it, whatever the screen', async ({ browser }) => {
  const id = tag()
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#crew')
  await expect(page.getByRole('status')).toHaveText('Up to date')

  // The server turns the next changes down, as it would a double booking.
  await page.route(/\/api\/sync\/push/, async (route) => {
    const { mutations } = route.request().postDataJSON() as { mutations: { id: string }[] }
    await route.fulfill({
      json: { results: mutations.map((m) => ({ id: m.id, status: 'rejected', reason: { code: 'conflict', message: 'Pretend the server said no.' } })) },
    })
  })
  await page.getByRole('button', { name: 'Add person' }).click()
  const person = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add person' }) })
  await person.getByLabel('Name').fill(`Nora Walsh ${id}`)
  await person.getByRole('button', { name: 'Add person' }).click()
  const count = page.getByRole('button', { name: /not done$/ })
  await expect(count).toHaveText('1 not done')

  // With the list open and the page scrolled, the bar's badge is still on screen and on top: the list sits under the bar, never over it.
  await count.click()
  const list = page.getByRole('region', { name: 'Not done' })
  await expect(list.locator('.row')).toHaveCount(1)
  await page.evaluate(() => scrollTo(0, 400))
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0)
  const badge = page.getByRole('status')
  const box = (await badge.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('.conn'), [box.x + box.width / 2, box.y + box.height / 2])).toBe(true)

  // A refusal from a second area counts with the first: a product added on the Stock tab.
  await page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Stock' }).click()
  await page.getByRole('button', { name: 'Add product' }).click()
  const product = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add product' }) })
  await product.getByLabel('Name').fill(`Y10P ${id}`)
  await product.getByRole('button', { name: 'Add product' }).click()
  await expect(count).toHaveText('2 not done')
  await page.unroute(/\/api\/sync\/push/)

  // Counted on the Jobs tab too, and the list says what each asked and why not; one dismissed leaves the other, and the last takes the count with it.
  await page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Jobs' }).click()
  await expect(count).toHaveText('2 not done')
  await count.click()
  await expect(list.locator('.row')).toHaveCount(2)
  const row = list.locator('.row', { hasText: `Save Nora Walsh ${id}'s details` })
  await expect(row).toContainText('Pretend the server said no.')
  await expect(row).toContainText('Asked today at')
  await expect(list.locator('.row', { hasText: `Add the product Y10P ${id}` })).toContainText('Pretend the server said no.')
  await row.getByRole('button', { name: 'Dismiss' }).click()
  await expect(count).toHaveText('1 not done')
  await expect(list.locator('.row')).toHaveCount(1)
  await list.getByRole('button', { name: 'Dismiss' }).click()
  await expect(list).toHaveCount(0)
  await expect(count).toHaveCount(0)
})

test('a price is read as meant, nonsense is refused beside the field, and cancelling asks first in the card', async ({ browser }) => {
  const id = tag()
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#crew')
  await expect(page.getByRole('status')).toHaveText('Up to date')

  // 500 crew is more than a call can ask for: the shared schema says so in plain words, in the form, with everything typed still there to put right.
  await page.getByRole('button', { name: 'Ask for crew' }).click()
  const job = page.locator('form').filter({ has: page.getByRole('button', { name: 'Ask for crew' }) })
  await job.getByLabel('Project').fill(`Galway Arts ${id}`)
  await job.getByLabel('Role').fill('Rigger')
  await job.getByLabel('How many').fill('500')
  await job.getByRole('button', { name: 'Ask for crew' }).click()
  await expect(job.getByRole('alert')).toHaveText('How many is a whole number from 1 to 100.')
  await expect(job.getByLabel('Project')).toHaveValue(`Galway Arts ${id}`)
  await expect(job.getByLabel('Role')).toHaveValue('Rigger')
  await expect(job.getByLabel('How many')).toHaveValue('500')
  await job.getByLabel('How many').fill('1')

  // "two fifty" isn't a price: said in the form, with the fields kept, and no browser dialog.
  await job.getByLabel('Day rate €').fill('two fifty')
  await job.getByRole('button', { name: 'Ask for crew' }).click()
  await expect(job.getByRole('alert')).toHaveText('Put in a price like 250 or 1,250.50.')
  await expect(job.getByLabel('Role')).toHaveValue('Rigger')

  // "€1,250" is €1,250, not €1.25 (audit finding 15).
  await job.getByLabel('Day rate €').fill('€1,250')
  await job.getByRole('button', { name: 'Ask for crew' }).click()
  // The call is one line under its job (audit finding 16); opened, it says its rate.
  const call = page.locator('.call-group', { hasText: `Galway Arts ${id}` }).getByRole('article', { name: '1 × Rigger' })
  await call.getByRole('button', { name: '1 × Rigger' }).click()
  await expect(call).toContainText('€1250')
  await expect(job.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('status')).toHaveText('Up to date')

  // Cancelling the call asks in the card, with what will happen; Keep it leaves it be.
  await call.getByRole('button', { name: 'Cancel crew call' }).click()
  const question = call.getByRole('group', { name: `Cancel the call for 1 × Rigger on Galway Arts ${id}? Everyone offered is told it's withdrawn.` })
  await expect(question).toBeVisible()
  await question.getByRole('button', { name: 'Keep it' }).click()
  await expect(question).toHaveCount(0)
  await call.getByRole('button', { name: 'Cancel crew call' }).click()
  await call.getByRole('button', { name: 'Cancel it' }).click()
  await expect(call).toHaveCount(0)
  await expect(page.getByRole('status')).toHaveText('Up to date')
})
