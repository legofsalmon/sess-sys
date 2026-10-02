import { expect, test, type Page } from '@playwright/test'

/**
 * Inspections end to end (ADR 0020), at phone size: a speaker product is
 * set to need a PAT every 12 months, with three items. One's last PAT,
 * done on paper over a year ago, is recorded on its page: it's overdue, so
 * it can't go out, and the Stock tab lists it. Then a batch is tested by
 * scanning, one with no signal: two pass and one fails. The one that
 * failed can't go out: its product says so, and scanning it out for a job
 * warns. In the batch each pass is held for five seconds with Undo first
 * (audit finding 17; scanning.spec.ts has the Undo). The test server is
 * shared with the other browser tests, so names are this run's own and
 * numbers are read off the screen. To refresh the blueprint screenshots,
 * run this file on its own with SHOTS=1.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const phoneSize = { width: 390, height: 844 }
const tag = () => Math.random().toString(36).slice(2, 8)
const named = (name: string, id: string) => (process.env.SHOTS ? name : `${name} ${id}`)
const part = (page: Page, heading: string) => page.locator('form').filter({ has: page.getByRole('heading', { name: heading, exact: true }) })

/** A day from today, in Dublin, as YYYY-MM-DD. */
const fromToday = (days: number) => {
  const d = new Date(`${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' })}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const date = /\d{1,2} \w{3,4} \d{4}/.source

test('PAT tests recorded one at a time and in a batch; failed and overdue kit can’t go out', async ({ browser }) => {
  const id = tag()
  const speaker = named('d&b Y10P', id)
  const bay = named('Bay A3', id)
  const job = named('Nissan launch', id)
  const context = await browser.newContext({ viewport: phoneSize })
  const page = await context.newPage()
  await page.goto('/#stock')
  await expect(page.locator('.conn')).toHaveText('Up to date')

  // The product, with three items.
  await page.getByRole('button', { name: 'Add product' }).click()
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add product' }) })
  await form.getByLabel('Name').fill(speaker)
  await form.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByRole('heading', { level: 1, name: speaker })).toBeVisible()
  const add = part(page, 'Add an item')
  const speakers: string[] = []
  for (let i = 0; i < 3; i++) {
    await add.getByLabel("Where it's kept").fill(bay)
    await add.getByRole('button', { name: 'Add item' }).click()
    if (i === 0) await page.getByRole('button', { name: 'Make the place' }).click()
    if (speakers.length) await expect(add.locator('.added')).not.toHaveText(`Added ${speakers.at(-1)}.`)
    await expect(add.locator('.added')).toHaveText(/^Added SH-\d{6}\.$/)
    speakers.push((await add.locator('.added').textContent())!.slice(6, -1))
  }
  await expect(page.locator('.facts')).toContainText('TestingNone')

  // It needs a PAT every 12 months.
  await page.getByRole('button', { name: 'Change details' }).click()
  await page.getByLabel('PAT every, in months').fill('0')
  await page.getByRole('button', { name: 'Save product' }).click()
  await expect(page.locator('.alert')).toHaveText('How often is a whole number of months, from 1 to 60, or blank for never.')
  await page.getByLabel('PAT every, in months').fill('12')
  await page.getByRole('button', { name: 'Save product' }).click()
  await expect(page.locator('.facts')).toContainText('TestingPAT every 12 months')

  // The first one's last PAT was on paper, over a year ago: overdue.
  await page.getByRole('link', { name: speakers[0] }).click()
  const card = page.getByRole('region', { name: 'Inspections' })
  await expect(card.locator('.due')).toContainText('PAT not recorded yet')
  await card.getByRole('button', { name: 'Record a test' }).click()
  const record = page.getByRole('form', { name: `Record a test of ${speakers[0]}` })
  await record.getByLabel('When').fill(fromToday(-400))
  await record.getByLabel('By', { exact: true }).fill('Volt Testing Ltd')
  await record.getByLabel('Note').fill('Earth 0.08 Ω')
  await record.getByRole('button', { name: 'Record PAT' }).click()
  await expect(record).toHaveCount(0)
  await expect(card.locator('.due')).toHaveText(new RegExp(`^PAT overdue since ${date}Can't go out until it passes\\.$`))
  await expect(card.locator('.inspection')).toContainText('Electrical test (PAT): passed')
  await expect(card.locator('.inspection')).toContainText('Volt Testing Ltd · Earth 0.08 Ω')
  await expect(page.locator('.facts')).toContainText(/TestingPAT overdue since .*: it can't go out until it passes/)
  await expect(page.locator('.conn')).toHaveText('Up to date')

  // The Stock tab lists it, and the two not recorded yet.
  await page.goto('/#stock')
  const due = page.getByRole('region', { name: 'Inspections due' })
  await expect(due.locator('li', { hasText: speakers[0]! })).toContainText('PAT overdue since')
  await expect(due).toContainText(`2 × ${speaker}`)

  // A batch tested by scanning; the last with no signal.
  await due.getByRole('link', { name: 'Test a batch' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Test a batch' })).toBeVisible()
  await page.getByLabel('By', { exact: true }).fill('Volt Testing Ltd')
  const said = page.getByRole('status', { name: 'Last scan' })
  const typeIn = async (number: string) => {
    await page.getByLabel('Number or serial').fill(number)
    await page.getByLabel('Number or serial').press('Enter')
  }
  // Each pass is held with Undo for five seconds, then recorded.
  const held = page.getByRole('status', { name: 'Held' })
  await typeIn(speakers[0]!)
  await expect(held).toContainText(`Passed: ${speakers[0]}`)
  await expect(said).toHaveText(new RegExp(`^${speakers[0]} ${speaker}: passed, next due ${date}\\.$`), { timeout: 8000 })
  await expect(held).toHaveCount(0)
  // Failed once its pass is recorded: the fail goes in after it. (Failing one while it's held is in scanning.spec.ts.)
  await typeIn(speakers[1]!)
  await expect(said).toContainText(`${speakers[1]} ${speaker}: passed`, { timeout: 8000 })
  await page.getByRole('button', { name: 'It failed' }).click()
  await expect(said).toHaveText(`${speakers[1]} ${speaker}: failed. It can't go out until it passes. Report what's wrong on its page.`)
  await context.setOffline(true)
  await typeIn(speakers[2]!)
  await expect(said).toContainText(`${speakers[2]} ${speaker}: passed, next due`, { timeout: 8000 })
  await expect(page.getByRole('region', { name: 'Tested' })).toContainText('Tested here: 4')
  await expect(page.locator('.conn')).toContainText('No signal')
  await page.screenshot(shot('inspections-batch'))
  await context.setOffline(false)
  await expect(page.locator('.conn')).toHaveText('Up to date')

  // The one that failed can't go out.
  await page.goto('/#stock')
  await expect(due.locator('li', { hasText: speakers[0]! })).toHaveCount(0)
  await expect(due.locator('li', { hasText: speakers[1]! })).toContainText('PAT failed on')
  await expect(due).not.toContainText(`× ${speaker}`)
  await due.getByRole('link', { name: `${speakers[1]} ${speaker}` }).click()
  await expect(card.locator('.due')).toContainText('PAT failed on')
  await expect(card.locator('summary')).toHaveText('2 recorded')
  await card.scrollIntoViewIfNeeded()
  await page.screenshot(shot('inspections-item'))
  await page.getByRole('link', { name: `‹ ${speaker}` }).click()
  await expect(page.locator('.facts')).toContainText("1 can't go out")

  // Scanning it out for a job warns.
  await page.goto('/#jobs')
  const newJob = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add job' }) })
  await newJob.getByLabel('Job').fill(job)
  await newJob.getByLabel('Status').selectOption({ label: 'Confirmed' })
  await newJob.getByLabel('Phase 1', { exact: true }).fill('Show')
  await newJob.getByLabel('Phase 1 from').fill(fromToday(2))
  await newJob.getByLabel('Phase 1 to').fill(fromToday(3))
  await newJob.getByRole('button', { name: 'Add job' }).click()
  await expect(page.getByRole('heading', { level: 1, name: job })).toBeVisible()
  await page.getByRole('button', { name: 'Add kit' }).click()
  const kit = page.getByRole('form', { name: 'Add kit' })
  await kit.getByLabel('Product').fill(speaker)
  await kit.getByLabel('How many').fill('3')
  await kit.getByRole('button', { name: 'Add to kit' }).click()
  await expect(page.getByRole('region', { name: 'Kit' })).toContainText('2 owned and fit to go out (1 damaged, missing or due a test)')
  await page.getByRole('region', { name: 'Kit' }).getByRole('link', { name: 'Pick list' }).click()
  await typeIn(speakers[1]!)
  await expect(said).toContainText(`${speakers[1]} ${speaker}: 1 of 3 out. PAT failed on`)
  await expect(said).toContainText('Test it before it goes.')
  await context.close()
})
