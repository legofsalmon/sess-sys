import { expect, test, type Page } from '@playwright/test'

/**
 * Moving about the screens (audit findings 8, 9 and 10): a new screen
 * opens at its top, and Back finds the place it was left at; a button the
 * role can't use isn't drawn, for staff crew and the warehouse on a job
 * and on Crew; and Crew's calls show only those short of people, with the
 * filled ones folded under them. Uses the made-up data (ADR 0019), so it
 * starts fresh before and after: the other tests share this server.
 */

const phoneSize = { width: 390, height: 844 }
const fresh = { data: { confirm: 'delete everything' } }

test.beforeAll(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
})

test.afterAll(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY))
/** Two frames: the Shell settles the page a frame after the new screen is drawn. */
const drawn = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))

test('a new screen opens at its top, and Back finds the place the last one was left at', async ({ browser }) => {
  // Proves: moving on from a page scrolled down starts the next at its top, by a tab or a link; the browser's Back and Forward put each screen back where it was.
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#crew/calls')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await expect(page.getByRole('link', { name: 'Open job' }).first()).toBeVisible()
  const far = await page.evaluate(() => Math.min(700, document.documentElement.scrollHeight - innerHeight))
  expect(far).toBeGreaterThan(200)
  await page.evaluate((y) => scrollTo(0, y), far)
  await drawn(page)
  expect(await scrollY(page)).toBe(far)

  // A tab: Home opens at its top, with its title in view.
  await page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Home' }).click()
  await expect(page).toHaveTitle('Home · Session Hire')
  await drawn(page)
  expect(await scrollY(page)).toBe(0)

  // Back: the calls, where they were left.
  await page.goBack()
  await expect(page).toHaveTitle('Calls · Session Hire')
  await expect.poll(() => scrollY(page)).toBe(far)

  // A link from far down the page: the job opens at its top, with its title in view, and Back comes back to the link.
  const link = page.getByRole('link', { name: 'Open job' }).last()
  await link.scrollIntoViewIfNeeded()
  const at = await scrollY(page)
  expect(at).toBeGreaterThan(0)
  await link.click()
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport()
  await drawn(page)
  expect(await scrollY(page)).toBe(0)
  await page.goBack()
  await expect.poll(() => scrollY(page)).toBe(at)
  // And Forward to the job, at the top where it was left.
  await page.goForward()
  await expect.poll(() => scrollY(page)).toBe(0)
})

test('a long list draws only the rows near the screen, and Back finds a place deep in it', async ({ browser, request }) => {
  // Proves (audit finding 11, ADR 0051): Jobs builds only the rows near the screen, each saying where it is in the whole list for a
  // screen reader, and builds the next ones as the page is scrolled; Back from a job opened deep in the list puts its row back where
  // it was. Some names wrap onto a second line, so the guessed height is wrong for those until they have been drawn.
  const mutations = Array.from({ length: 160 }, (_, i) => {
    const day = new Date(Date.UTC(2031, 0, 1 + i)).toISOString().slice(0, 10)
    const name = i % 5 === 0 ? `Long list job ${i} with a name long enough to wrap onto a second line on a phone` : `Long list job ${i}`
    return [
      { id: `long-${i}-a`, name: 'project.create', args: { id: `long-${i}`, name, clientId: null, venueId: null, status: 'confirmed', notes: '' } },
      { id: `long-${i}-b`, name: 'phase.add', args: { id: `long-${i}-show`, projectId: `long-${i}`, name: 'Show', start: day, end: day, venueId: null, notes: '' } },
    ]
  }).flat()
  const res = await request.post('/api/sync/push', { data: { clientId: 'long-list', mutations: mutations.map((m) => ({ ...m, createdAt: new Date().toISOString() })) } })
  expect((await res.json()).results.every((r: { status: string }) => r.status === 'applied')).toBe(true)

  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#jobs')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  const list = page.getByRole('region', { name: 'Jobs' }).getByRole('list')
  // Coming up starts at the next fortnight (audit finding 22); these are in 2031, under Show all, which Back keeps.
  await page.getByRole('button', { name: /^Show all [\d,]+ coming up$/ }).click()
  await expect(list.getByRole('link').first()).toBeVisible()
  await expect(list.getByRole('link', { name: /Long list job 159\b/ })).toHaveCount(0)
  // The week headings are rows of the list too, but not counted among the jobs.
  const jobs = list.locator('li[aria-posinset]')
  const total = Number(await jobs.first().getAttribute('aria-setsize'))
  expect(total).toBeGreaterThanOrEqual(160)
  expect(await list.locator('li').count()).toBeLessThan(60)
  await expect(jobs.first()).toHaveAttribute('aria-posinset', '1')
  await expect(list.locator('li.week-head').first()).toBeVisible()

  // Scrolled by hand to a row far down, which is opened from where it is on the screen.
  const row = list.getByRole('link', { name: /Long list job 140\b/ })
  for (let i = 0; i < 100; i++) {
    // Not built until the page comes near it.
    const at = (await row.count()) ? await row.evaluate((a) => a.getBoundingClientRect().top) : Infinity
    if (at < 500) break
    await page.mouse.wheel(0, Math.min(600, at - 400))
    await drawn(page)
  }
  await page.waitForTimeout(300)
  const top = await row.evaluate((a) => Math.round(a.getBoundingClientRect().top))
  expect(top).toBeGreaterThan(100)
  expect(top).toBeLessThan(700)
  await row.click()
  await expect(page.getByRole('heading', { level: 1, name: /Long list job 140\b/ })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveTitle('Jobs · Session Hire')
  await expect.poll(() => row.evaluate((a) => Math.round(a.getBoundingClientRect().top))).toBe(top)
})

/** The demo copy, seen as one of its personas: this server has no passcode, so the test answers for it as a demo copy would. */
async function as(page: Page, role: 'crew' | 'head', button: RegExp) {
  await page.route('**/api/me', (route) => route.fulfill({ json: { auth: 'passcode', role } }))
  await page.route('**/api/auth/preview', (route) => route.fulfill({ json: { role } }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'See it as…' })).toBeVisible()
  await page.getByRole('button', { name: button }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
}

async function openJob(page: Page, name: string) {
  await page.goto('/#jobs')
  await page.getByRole('link', { name: new RegExp(name) }).first().click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

test('staff crew are offered nothing on a job or on Crew they could only be refused', async ({ browser }) => {
  // Proves: staff crew, who can change only their leave and report faults, see a job's phases, kit and crew with no Change, Add kit, Add phase or Ask for crew, and Crew's answers and calls with nothing to settle or offer.
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await as(page, 'crew', /^Staff crew/)
  await openJob(page, 'Harbour Lights Festival')
  const main = page.getByRole('main')
  await expect(main.getByRole('region', { name: 'Phases' })).toBeVisible()
  // Each part of the job in turn (ADR 0059), and no Quote for a role that doesn't see money.
  await expect(main.getByRole('tab')).toHaveText(['Phases 3', /^Crew/, 'Kit and vans', 'Show pack'])
  for (const part of ['Phases', 'Crew', 'Kit and vans', 'Show pack']) {
    await main.getByRole('tab', { name: new RegExp(`^${part}`) }).click()
    for (const name of ['Change', 'Change details', 'Add phase', 'Add kit', 'Ask for crew', 'Offer…', 'Running late…', 'Book a vehicle'])
      await expect(main.getByRole('button', { name, exact: true }), `${name} on ${part}`).toHaveCount(0)
  }
  await main.getByRole('tab', { name: /^Crew/ }).click()
  // A call opened still says who's on it, without Withdraw, Send, Change or Cancel.
  await main.getByRole('button', { name: /× Rigger/ }).first().click()
  await expect(main.getByRole('link', { name: 'Pádraig Kenny' })).toBeVisible()
  for (const name of ['Withdraw', 'Send', 'Cancel crew call']) await expect(main.getByRole('button', { name, exact: true })).toHaveCount(0)

  await page.goto('/#crew/calls')
  await expect(page.getByRole('heading', { name: /^Answers to check/ })).toBeVisible()
  for (const name of [/^Noted/, /^Confirm$/, /^Release$/, /^Offer…$/, /^Checked:/, /^Not right:/, /^Ask for crew$/]) await expect(main.getByRole('button', { name })).toHaveCount(0)
  // Reporting a fault is still theirs.
  await page.goto('/#stock')
  await page.getByRole('link', { name: /Shure SM58|d&b/ }).first().click()
  await expect(main.getByRole('button', { name: 'Change details' })).toHaveCount(0)
})

test('the warehouse can add kit to a job, but not change the job itself', async ({ browser }) => {
  // Proves: the warehouse, held to a head of department's role since ADR 0051, are offered Add kit and the kit lines' Change, and nothing of the job's own.
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await as(page, 'head', /^Warehouse/)
  await openJob(page, 'Harbour Lights Festival')
  const main = page.getByRole('main')
  await main.getByRole('tab', { name: 'Kit and vans' }).click()
  await expect(main.getByRole('button', { name: 'Add kit' })).toBeVisible()
  const kit = main.getByRole('region', { name: 'Kit' })
  await expect(kit.getByRole('button', { name: 'Change', exact: true }).first()).toBeVisible()
  await main.getByRole('tab', { name: /^Phases/ }).click()
  const phases = main.getByRole('region', { name: 'Phases' })
  for (const name of ['Change', 'Add phase']) await expect(phases.getByRole('button', { name, exact: true })).toHaveCount(0)
  await expect(main.getByRole('button', { name: 'Change details', exact: true })).toHaveCount(0)
})

test('Crew needed lists only the calls short of people, with the filled ones folded under them', async ({ browser }) => {
  // Proves: at rest every call shown is short; "Show N filled calls" says how many are folded and opens them; a department with none short says so plainly.
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#crew/calls')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  const needed = page.locator('section.card', { has: page.getByRole('heading', { name: 'Crew needed' }) })
  const fold = needed.locator('details.filled-calls')
  const summary = fold.locator('summary')
  await expect(summary).toHaveText(/^Show \d+ filled calls?$/)
  const n = Number((await summary.textContent())!.match(/\d+/)![0])
  // At rest: the calls short of people, and a filled one only with something on it to act on today; the folded ones are all filled.
  const inView = needed.locator(':scope > .call-groups > .call-group article.call')
  const onlyShortOrToActOn = async (shortOnes: boolean) => {
    for (const call of await inView.all()) {
      const filled = /^Filled/.test((await call.locator(':scope > .pill').textContent()) ?? '')
      if (!filled && shortOnes) continue
      expect(filled, `${await call.getAttribute('aria-label')} is filled`).toBe(true)
      expect(await call.locator('.late-line, .warn-line, .late-open').count(), `${await call.getAttribute('aria-label')} has something to act on`).toBeGreaterThan(0)
    }
  }
  expect(await inView.count()).toBeGreaterThan(0)
  await onlyShortOrToActOn(true)
  // Folded, the filled calls aren't built at all; opened, they are, in a window like the rest (ADR 0051).
  await expect(fold.locator('article.call')).toHaveCount(0)
  await summary.click()
  await expect(fold.locator('article.call').first()).toBeVisible()
  expect(await fold.locator('article.call').count()).toBeLessThanOrEqual(n)
  for (const t of await fold.locator('.pill').allTextContents()) expect(t).toMatch(/^Filled/)

  // A department whose calls are all filled says there are none short, and still has them a tap away.
  const filter = page.getByLabel('Calls for department')
  const options = await filter.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
  let found = false
  for (const value of options) {
    await filter.selectOption(value)
    if (await needed.getByText(/are short of people: every one still to come is filled\.$/).count()) {
      found = true
      await onlyShortOrToActOn(false)
      await expect(summary).toBeVisible()
      break
    }
  }
  expect(found, 'a department with every call filled').toBe(true)
})
