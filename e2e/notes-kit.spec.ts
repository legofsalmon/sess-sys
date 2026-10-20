import { expect, test, type Page } from '@playwright/test'

/**
 * Kit from the notes end to end (ADR 0043), at phone size: a job whose
 * notes hold a job sheet, as the calendar's descriptions do, has its kit
 * lines read and matched (by name, by model, not at all, and a van under
 * transport left out), one is said to be not kit, and what's left goes on
 * the job; reading the notes again adds nothing. Then a season's worth:
 * Kit in the notes lists the jobs to work through, adds the ones with
 * nothing to check in one go with no signal, and they go through once it's
 * back. The test server is shared with the other browser tests, so every
 * name here is this run's own.
 */

const phoneSize = { width: 390, height: 844 }
const tag = () => Math.random().toString(36).slice(2, 8)

async function ready(page: Page, hash = '#jobs') {
  await page.goto(`/${hash}`)
  await expect(page.locator('.conn')).toHaveText('Up to date')
}

/** A numbered product, with how many are counted in the warehouse. */
async function newProduct(page: Page, name: string, count: number) {
  await page.goto('/#stock')
  await page.getByRole('button', { name: 'Add product' }).click()
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add product' }) })
  await form.getByLabel('Name').fill(name)
  await form.getByLabel('Department').selectOption({ label: 'Audio' })
  await form.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  const add = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Add a count', exact: true }) })
  await add.getByLabel('Counted at').fill('Warehouse')
  await add.getByLabel('How many').fill(String(count))
  await add.getByRole('button', { name: 'Save count' }).click()
  const yes = page.getByRole('button', { name: 'Make the place' })
  if (await yes.isVisible()) await yes.click()
  await expect(page.locator('.count', { hasText: 'Warehouse' })).toContainText(String(count))
}

/** A confirmed job with one show day in 2030, and these notes, as the calendar's bring-in leaves them. */
async function jobWithNotes(page: Page, name: string, notes: string) {
  await page.goto('/#jobs')
  // New job waits behind its button at the top of the list on a phone (audit finding 22).
  await page.getByRole('button', { name: 'New job', exact: true }).click()
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add job' }) })
  await form.getByLabel('Job').fill(name)
  await form.getByLabel('Status').selectOption({ label: 'Confirmed' })
  await form.getByLabel('Phase 1', { exact: true }).fill('Show')
  await form.getByLabel('Phase 1 from').fill('2030-11-10')
  await form.getByLabel('Phase 1 to').fill('2030-11-11')
  await form.getByRole('button', { name: 'Add job' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  await page.getByRole('button', { name: 'Change details' }).click()
  await page.getByLabel('Notes', { exact: true }).fill(notes)
  await page.getByRole('button', { name: 'Save job' }).click()
  await expect(page.locator('.notes').first()).toContainText(notes.split('\n')[0]!)
}

test("a job's notes become kit lines, checked first, and reading them again adds nothing", async ({ browser }) => {
  const id = tag()
  const speaker = `d&b Y10P ${id}`
  const amp = `d&b D20 ${id}`
  const job = `Fairview Build ${id}`
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await ready(page, '#stock')
  await newProduct(page, speaker, 8)
  await newProduct(page, amp, 4)
  await jobWithNotes(page, job, `Load in from the north gate.\n\nAudio\n4 x ${speaker}\n2x D20 ${id}\n1 x Wedding arch ${id}\n\nTransport and labour\n1 x Luton van\n\n5.00pm - Crew call`)

  await page.getByRole('tab', { name: 'Kit and vans' }).click()
  const kit = page.getByRole('region', { name: 'Kit' })
  await expect(kit.locator('.notes-kit-link')).toContainText("The notes list 3 lines of kit; 2 aren't on the job yet, 1 with no product found.")
  await kit.getByRole('link', { name: 'Kit from the notes' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Kit from the notes' })).toBeVisible()
  await expect(page.locator('.crumbs')).toContainText(job)

  const row = (text: string) => page.getByRole('article', { name: text })
  await expect(row(`4 x ${speaker}`).locator('.kit-state')).toHaveText('Matches by name. Adds 4.')
  await expect(row(`4 x ${speaker}`).getByLabel('Product')).toHaveValue(/.+/)
  await expect(row(`2x D20 ${id}`).locator('.kit-state')).toHaveText("Matched by its model: check it's the right one. Adds 2.")
  await expect(row(`1 x Wedding arch ${id}`).locator('.kit-state')).toHaveText(/Choose (one|a product), or say it's not kit\./)
  await expect(row('1 x Luton van').locator('.kit-state')).toContainText('left out as not kit')
  const add = page.getByRole('region', { name: 'Add to the kit' })
  await expect(add).toContainText('Adds 2 lines to the kit. 1 line is left out until a product is chosen for it.')

  await row(`1 x Wedding arch ${id}`).getByLabel('Product').selectOption({ label: 'Not kit' })
  await expect(row(`1 x Wedding arch ${id}`).locator('.kit-state')).toHaveText('Not kit, so left out.')
  await expect(add).toContainText('Adds 2 lines to the kit.')
  await add.getByRole('button', { name: 'Add 2 lines to the kit' }).click()
  await expect(add.getByRole('status')).toContainText(`Added 2 lines to the kit for ${job}.`)
  await expect(row(`4 x ${speaker}`).locator('.kit-state')).toHaveText('Already on the job: 4 on these days.')
  await expect(page.locator('.conn')).toHaveText('Up to date', { timeout: 20_000 })

  // On the job: the two lines, and nothing more to do with its notes.
  await page.getByRole('link', { name: job }).first().click()
  await expect(kit.getByRole('article', { name: `4 × ${speaker}` })).toBeVisible()
  await expect(kit.getByRole('article', { name: `2 × ${amp}` })).toBeVisible()
  await expect(kit.locator('.notes-kit-link')).toContainText('What the notes list is on the job.')
  await kit.getByRole('link', { name: 'Kit from the notes' }).click()
  await expect(row(`2x D20 ${id}`).locator('.kit-state')).toHaveText('Already on the job: 2 on these days.')
  await expect(page.getByRole('button', { name: /^Add \d+ lines? to the kit$/ })).toHaveCount(0)

  // The arch was said to be not kit, so another job's notes naming it say so too.
  await jobWithNotes(page, `Fairview Show ${id}`, `Audio\n1 x wedding arch ${id}`)
  await expect(kit.locator('.notes-kit-link')).toHaveCount(1)
  await kit.getByRole('link', { name: 'Kit from the notes' }).click()
  await expect(row(`1 x wedding arch ${id}`).locator('.kit-state')).toHaveText('Not kit, as chosen before, so left out.')
})

test('Kit in the notes adds every job with nothing to check in one go, with no signal', async ({ browser }) => {
  const id = tag()
  const speaker = `d&b Y10P ${id}`
  const sure = `Harbour Lights ${id}`
  const guess = `Riverside ${id}`
  const context = await browser.newContext({ viewport: phoneSize })
  const page = await context.newPage()
  await ready(page, '#stock')
  await newProduct(page, speaker, 8)
  await newProduct(page, `d&b D20 ${id}`, 4)
  await jobWithNotes(page, sure, `Audio\n6 x ${speaker}`)
  await jobWithNotes(page, guess, `Audio\n1 x ${speaker}\n3 x D20 ${id}`)

  await page.goto('/#jobs')
  await page.getByRole('region', { name: 'Kit in the notes' }).getByRole('link', { name: 'Work through them' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Kit in the notes' })).toBeVisible()
  const readySection = page.getByRole('region', { name: 'Ready to add' })
  const check = page.getByRole('region', { name: 'To check' })
  const showAll = async (section: typeof readySection) => {
    const more = section.getByRole('button', { name: /^Show all/ })
    if (await more.count()) await more.click()
  }
  await showAll(readySection)
  await showAll(check)
  await expect(readySection.locator('.job-row', { hasText: sure })).toContainText('1 to add')
  await expect(check.locator('.job-row', { hasText: guess })).toContainText('2 to add, 1 to check')

  await context.setOffline(true)
  await readySection.getByRole('button', { name: /^Add \d+ lines? to \d+ jobs?$/ }).click()
  await readySection.getByRole('button', { name: 'Add them' }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Added \d+ lines? to \d+ jobs?\./ })).toBeVisible()
  await expect(page.locator('.job-row', { hasText: sure })).toHaveCount(0)
  await expect(check.locator('.job-row', { hasText: guess })).toBeVisible()
  await expect(page.locator('.conn')).toContainText('No signal')

  await context.setOffline(false)
  await page.evaluate(() => dispatchEvent(new Event('online')))
  await expect(page.locator('.conn')).toHaveText('Up to date', { timeout: 20_000 })

  // Another device has the job's kit, as the notes listed it.
  const laptop = await (await browser.newContext()).newPage()
  await ready(laptop, '#jobs')
  await laptop.getByLabel('Find').fill(sure)
  await laptop.locator('.job-row', { hasText: sure }).click()
  await laptop.getByRole('tab', { name: 'Kit and vans' }).click()
  await expect(laptop.getByRole('region', { name: 'Kit' }).getByRole('article', { name: `6 × ${speaker}` })).toBeVisible()
})
