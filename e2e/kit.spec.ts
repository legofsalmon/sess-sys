import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * Kit on jobs end to end (ADR 0014), at phone size: speakers and cables
 * counted in the warehouse, put on a festival for the whole job (the days
 * between its build and show included) and for its show; a launch in the
 * gap is short and says who has the rest, and subhiring the shortfall sorts
 * it. A quote on the festival's show day would be short if it went ahead,
 * and the festival says so. The Stock tab lists what's short and the
 * product page lists its jobs. Kit added with no signal counts at once and
 * goes through once the signal is back. The test server is shared with the
 * other browser tests, so every name here is this run's own. To refresh the
 * blueprint screenshots, run this file on its own with SHOTS=1: the names
 * are then plain.
 */

const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
const phoneSize = { width: 390, height: 844 }
const tag = () => Math.random().toString(36).slice(2, 8)
const named = (name: string, id: string) => (process.env.SHOTS ? name : `${name} ${id}`)

async function ready(page: Page, hash = '#jobs') {
  await page.goto(`/${hash}`)
  await expect(page.locator('.conn')).toHaveText('Up to date')
}

/** A product, with how many are counted in the warehouse. */
async function newProduct(page: Page, name: string, how: 'numbered' | 'counted', count: number, department = 'Audio') {
  await page.goto('/#stock')
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add product' }) })
  await form.getByLabel('Name').fill(name)
  await form.getByLabel('Department').selectOption({ label: department })
  if (how === 'counted') await form.getByRole('radio', { name: /^Counted/ }).check()
  await form.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  const add = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Add a count', exact: true }) })
  await add.getByLabel('Counted at').fill('Warehouse')
  await add.getByLabel('How many').fill(String(count))
  await add.getByRole('button', { name: 'Save count' }).click()
  await expect(page.locator('.count', { hasText: 'Warehouse' })).toContainText(String(count))
}

/** A job and its phases, as [name, first day, last day]; it opens on its own page. */
async function newJob(page: Page, name: string, status: 'Confirmed' | 'Quoted' | 'Enquiry', phases: [string, string, string][]) {
  await page.goto('/#jobs')
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add job' }) })
  await form.getByLabel('Job').fill(name)
  await form.getByLabel('Status').selectOption({ label: status })
  for (const [i, [phase, from, to]] of phases.entries()) {
    if (i > 0) await form.getByRole('button', { name: 'Add a phase' }).click()
    await form.getByLabel(`Phase ${i + 1}`, { exact: true }).fill(phase)
    await form.getByLabel(`Phase ${i + 1} from`).fill(from)
    await form.getByLabel(`Phase ${i + 1} to`).fill(to)
  }
  await form.getByRole('button', { name: 'Add job' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

async function addKit(page: Page, product: string, qty: number, days = 'Whole job') {
  const form = page.getByRole('form', { name: 'Add kit' })
  await form.getByLabel('Product').fill(product)
  await form.getByLabel('How many').fill(String(qty))
  await form.getByLabel('For which days').selectOption({ label: days })
  await form.getByRole('button', { name: 'Add to kit' }).click()
}

const state = (line: Locator) => line.locator('.kit-state')

/** A card near the top of the screen, under the header, for a screenshot. */
const toCard = (card: Locator) => card.evaluate((el) => scrollTo(0, el.getBoundingClientRect().top + scrollY - 64))

test('short where two jobs share the days, sorted by subhire, with a quote pencilled in', async ({ browser }) => {
  const id = tag()
  const speaker = named('d&b Y10P', id)
  const cable = named('XLR 10 m', id)
  const festival = named('Electric Picnic', id)
  const launch = named('Fuel launch', id)
  const quote = named('Longitude', id)
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await ready(page, '#stock')
  await newProduct(page, speaker, 'numbered', 10)
  await newProduct(page, cable, 'counted', 40)

  // The festival keeps its PA from the build to the show, the days between included; the cables are for the show.
  await newJob(page, festival, 'Confirmed', [
    ['Build', '2030-09-02', '2030-09-03'],
    ['Show', '2030-09-06', '2030-09-07'],
  ])
  const kit = page.getByRole('region', { name: 'Kit' })
  await expect(kit.locator('.empty')).toHaveText('No kit yet. Add what the job needs from the stock list below, for the whole job or one phase.')
  await addKit(page, speaker, 8)
  const pa = kit.getByRole('article', { name: `8 × ${speaker}` })
  await expect(pa.locator('header p')).toHaveText('Whole job · Mon 2 Sep to Sat 7 Sep')
  await expect(state(pa)).toHaveText('Enough, with 2 to spare.')
  // The same product for the same days adds to the line already there.
  await addKit(page, cable, 20, 'Show, Fri 6 Sep to Sat 7 Sep')
  await expect(kit.getByRole('article', { name: `20 × ${cable}` })).toBeVisible()
  await addKit(page, cable, 10, 'Show, Fri 6 Sep to Sat 7 Sep')
  await expect(page.getByRole('form', { name: 'Add kit' }).locator('.added')).toHaveText(`Now 30 × ${cable} for Show.`)
  await expect(state(kit.getByRole('article', { name: `30 × ${cable}` }))).toHaveText('Enough, with 10 to spare.')

  // A launch in the gap wants four: two of them are short, and it says who has the rest.
  await newJob(page, launch, 'Confirmed', [['Show', '2030-09-04', '2030-09-04']])
  await addKit(page, speaker, 4)
  const monitors = kit.getByRole('article', { name: `4 × ${speaker}` })
  await expect(state(monitors)).toHaveText(`Short 2 on Wed 4 Sep: 10 owned, 8 on ${festival}.`)
  await expect(state(monitors)).toHaveClass(/bad/)
  await expect(page.locator('.facts')).toContainText('1 product, 1 short')
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await toCard(kit)
  await page.screenshot(shot('kit-short'))

  // Both are flagged on the jobs list.
  await page.getByRole('link', { name: '‹ All jobs' }).click()
  await expect(page.locator('.job-row', { hasText: festival }).locator('.flag')).toHaveText('Kit short')
  await expect(page.locator('.job-row', { hasText: launch }).locator('.flag')).toHaveText('Kit short')

  // Two subhired for the launch sorts both.
  await page.locator('.job-row', { hasText: launch }).click()
  await monitors.getByRole('button', { name: 'Subhire the 2 short' }).click()
  const change = monitors.getByRole('form', { name: `Change ${speaker}` })
  await expect(change.getByLabel('Subhired')).toHaveValue('2')
  await expect(change.getByLabel('From')).toBeFocused()
  await change.getByLabel('From').fill('PRG')
  await change.getByRole('button', { name: 'Save' }).click()
  await expect(state(monitors)).toHaveText('2 subhired from PRG. Enough, with none to spare.')
  await expect(page.locator('.facts')).toContainText('1 product')
  await expect(page.locator('.facts')).not.toContainText('short')

  // A quote on the festival's show day would be short if it went ahead, and the festival says so.
  await newJob(page, quote, 'Quoted', [['Show', '2030-09-06', '2030-09-06']])
  await addKit(page, speaker, 4)
  const pencilled = kit.getByRole('article', { name: `4 × ${speaker}` })
  await expect(state(pencilled)).toHaveText(`Would be short 2 on Fri 6 Sep if it goes ahead: 10 owned, 8 on ${festival}.`)
  await expect(state(pencilled)).toHaveClass(/warn/)
  await page.getByRole('link', { name: '‹ All jobs' }).click()
  await expect(page.locator('.job-row', { hasText: festival }).locator('.flag')).toHaveCount(0)
  await expect(page.locator('.job-row', { hasText: quote }).locator('.flag')).toHaveText('Kit short')
  await page.locator('.job-row', { hasText: festival }).click()
  await expect(state(pa)).toHaveText(`Enough, unless ${quote} goes ahead: then short 2 on Fri 6 Sep.`)
  await expect(page.locator('.conn')).toHaveText('Up to date')
  await toCard(kit)
  await page.screenshot(shot('kit-job'))

  // The Stock tab lists what's short, and the speakers' page lists their jobs.
  await page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Stock' }).click()
  const short = page.getByRole('region', { name: 'Kit short' })
  const row = short.locator('.job-row', { hasText: quote })
  await expect(row).toContainText(`${speaker}: short 2`)
  await expect(row).toContainText(`${quote} · Fri 6 Sep`)
  await expect(row.locator('.pill')).toHaveText('Quoted')
  await expect(short.locator('.job-row', { hasText: launch })).toHaveCount(0)
  await toCard(short)
  await page.screenshot(shot('kit-stock'))
  await page.getByLabel('Find').fill(speaker)
  await page.getByLabel('Find').press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: speaker })).toBeVisible()
  const onJobs = page.getByRole('region', { name: 'On jobs' })
  await expect(onJobs.locator('.hint')).toHaveText('10 owned. Confirmed jobs hold them; enquiries and quotes are pencilled in.')
  await expect(onJobs.locator('.job-row b')).toHaveText([festival, launch, quote])
  const jobRow = (name: string) => onJobs.locator('.job-row').filter({ has: page.getByText(name, { exact: true }) })
  await expect(jobRow(launch).locator('.kit-note')).toHaveText('2 subhired from PRG. Enough, with none to spare.')
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot(shot('kit-product'))

  // The quote's kit taken off: nothing's short any more.
  await jobRow(quote).click()
  await pencilled.getByRole('button', { name: 'Change' }).click()
  await pencilled.getByRole('button', { name: 'Take off the kit' }).click()
  // Asked first, in the form, with what will happen.
  await expect(pencilled.getByRole('group', { name: /^Take 4 × .* off the kit for .*\? It's no longer held for the job, so it's free for others\.$/ })).toBeVisible()
  await pencilled.getByRole('button', { name: 'Take it off' }).click()
  await expect(pencilled).toHaveCount(0)
  await expect(kit.locator('.empty')).toBeVisible()
  await page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Stock' }).click()
  await expect(page.locator('.kit-short .job-row', { hasText: speaker })).toHaveCount(0)
})

test('kit added with no signal counts at once, then goes through', async ({ browser }) => {
  const id = tag()
  const light = named('Clay Paky Sharpy', id)
  const job = named('Body & Soul', id)
  const context = await browser.newContext({ viewport: phoneSize })
  const page = await context.newPage()
  await ready(page, '#stock')
  await newProduct(page, light, 'numbered', 2, 'Lighting')
  await newJob(page, job, 'Confirmed', [['Show', '2030-10-10', '2030-10-10']])
  await expect(page.locator('.conn')).toHaveText('Up to date')

  await context.setOffline(true)
  await addKit(page, light, 3)
  const line = page.getByRole('region', { name: 'Kit' }).getByRole('article', { name: `3 × ${light}` })
  await expect(line.locator('.pill')).toHaveText('Waiting to sync')
  await expect(state(line)).toHaveText('Short 1 on Thu 10 Oct: 2 owned.')
  await expect(page.locator('.kit-group h3')).toHaveText(['Lighting'])
  await expect(page.locator('.conn')).toContainText('No signal')

  await context.setOffline(false)
  await page.evaluate(() => dispatchEvent(new Event('online')))
  await expect(page.locator('.conn')).toHaveText('Up to date', { timeout: 20_000 })
  await expect(line.locator('.pill')).toHaveCount(0)

  // And another device has it.
  const laptop = await (await browser.newContext()).newPage()
  await ready(laptop, '#stock')
  await laptop.getByLabel('Find').fill(light)
  await laptop.getByLabel('Find').press('Enter')
  const row = laptop.getByRole('region', { name: 'On jobs' }).locator('.job-row', { hasText: job })
  await expect(row.locator('.kit-note')).toHaveText('Short 1 on Thu 10 Oct: 2 owned.')
})
