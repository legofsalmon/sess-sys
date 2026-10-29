import { expect, test } from '@playwright/test'

/**
 * Home and finding your way around (ADR 0033): the bare address opens Home,
 * shown for the company with counts that each open where they're sorted
 * out; it can be shown for a department, the warehouse or me, and the phone
 * remembers which; five places in the bar, History under Admin; and a long
 * screen names its parts at the top, each a tap away. Uses the made-up data
 * (ADR 0019), so it starts fresh before and after: the other tests share
 * this server.
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

test('Home is where the app opens, and says how things stand for whoever is looking', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
  await expect(page).toHaveTitle('Home · Session Hire')

  const bar = page.getByRole('navigation', { name: 'Areas' })
  await expect(bar.getByRole('link')).toHaveText(['Home', 'Jobs', 'Stock', /^Crew/, 'Menu'])
  await expect(bar.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')

  // The company: today's job, and counts that aren't nothing.
  const show = page.getByRole('group', { name: 'Show for' })
  await expect(show.getByRole('button', { name: 'Company' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name: 'Today (1)' })).toBeVisible()
  const attention = page.locator('.standing')
  await expect(attention.getByRole('link', { name: /answers to check/ })).toBeVisible()
  await expect(attention.getByRole('link', { name: /kit lines short/ })).toBeVisible()

  // A count opens the screen that sorts it out, at the part it counted (audit, 20 October 2026, finding 4).
  await attention.getByRole('link', { name: /answers to check/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Calls' })).toBeVisible()
  await expect(bar.getByRole('link', { name: /^Crew/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: /^Answers to check/ })).toBeFocused()
  await bar.getByRole('link', { name: 'Home' }).click()
  await attention.getByRole('link', { name: /kit lines short/ }).click()
  const short = page.getByRole('heading', { name: 'Kit short' })
  await expect(short).toBeFocused()
  await expect(short).toBeInViewport()
  // Back to Home, and Back again comes to the part as it was left.
  await page.goBack()
  await expect(attention.getByRole('link', { name: /kit lines short/ })).toBeVisible()
  await page.goForward()
  await expect(short).toBeInViewport()

  // The warehouse: what's going out, opening its pick list. Remembered on this phone.
  await bar.getByRole('link', { name: 'Home' }).click()
  await show.getByRole('button', { name: 'Warehouse' }).click()
  await expect(show.getByRole('button', { name: 'Warehouse' })).toBeFocused()
  const going = page.locator('section', { has: page.getByRole('heading', { name: /^Going out/ }) })
  await expect(going.getByRole('link', { name: /Harbour Lights Festival/ })).toHaveAttribute('href', /#jobs\/.+\/pick$/)
  await page.reload()
  await expect(show.getByRole('button', { name: 'Warehouse' })).toHaveAttribute('aria-pressed', 'true')

  // A department: narrowed to its people and its kit.
  await show.getByRole('button', { name: 'Department' }).click()
  await page.getByLabel('Department').selectOption('Audio')
  await expect(page.getByRole('heading', { name: 'Needs attention in Audio' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Working this week/ })).toBeVisible()
})

test('the Menu names every place, and Admin, History and You keep its tab with the way back', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#home')
  const bar = page.getByRole('navigation', { name: 'Areas' })
  await bar.getByRole('link', { name: 'Menu' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Menu' })).toBeVisible()
  const places = page.getByRole('navigation', { name: 'Every place' })
  for (const group of ['Jobs', 'Stock', 'Crew', 'Company', 'You']) await expect(places.getByRole('group', { name: group })).toBeVisible()
  await expect(places.getByRole('link', { name: /^Planner/ })).toHaveAttribute('href', '#jobs/plan')

  for (const [link, title] of [
    [/^History/, 'History'],
    [/^Admin/, 'Admin'],
    [/^You/, 'You'],
  ] as const) {
    await places.getByRole('link', { name: link }).click()
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await expect(bar.getByRole('link', { name: 'Menu' })).toHaveAttribute('aria-current', 'page')
    await page.getByRole('link', { name: '‹ Menu' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Menu' })).toBeVisible()
  }
})

test('a long screen names its parts on them, and a tap goes to one', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#crew')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  const parts = page.getByRole('navigation', { name: 'On this screen' })
  // Under the screen's title, out of the bar, and straight before the first part, so it reads as the page's contents.
  await expect(page.locator('header.top').getByRole('navigation', { name: 'On this screen' })).toHaveCount(0)
  expect(await parts.evaluate((nav) => nav.nextElementSibling?.querySelector('h2')?.textContent)).toMatch(/^Answers to check/)
  const title = (await page.getByRole('heading', { level: 1, name: 'Calls' }).boundingBox())!
  expect((await parts.boundingBox())!.y).toBeGreaterThanOrEqual(title.y + title.height)
  await parts.getByRole('button', { name: 'Crew needed' }).click()
  const lists = page.getByRole('heading', { name: 'Crew needed', exact: true })
  await expect(lists).toBeFocused()
  await expect(lists).toBeInViewport()
  await expect(parts.getByRole('button', { name: 'Crew needed' })).toHaveAttribute('aria-current', 'location')
  // Scrolled to, a part clears the bar and the strip, which stays straight under the bar.
  const [bar, strip, heading] = await Promise.all([page.locator('header.top'), parts, lists].map(async (l) => (await l.boundingBox())!))
  expect(Math.round(strip!.y)).toBe(Math.round(bar!.y + bar!.height))
  expect(heading!.y).toBeGreaterThanOrEqual(strip!.y + strip!.height)
  // A heading's count is the part's count.
  await expect(parts.getByRole('button', { name: /^Answers to check/ }).locator('.count')).toHaveText(/^\d+$/)
})

test('Home draws the weeks, days and months ahead as charts, each column said in words (ADR 0054)', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await page.getByRole('group', { name: 'Show for' }).getByRole('button', { name: 'Company', exact: true }).click()

  // Crew: today first, then a finger on another day says that day's crew in the line above.
  const crew = page.locator('section', { has: page.getByRole('heading', { name: 'Crew, the next fortnight' }) })
  const days = crew.getByRole('group', { name: 'Crew, the next fortnight' }).getByRole('button')
  // A week at a time on a phone, each column a finger wide, the other week behind a tap (audit, 20 October 2026, finding 58).
  await expect(days).toHaveCount(7)
  expect((await days.first().boundingBox())!.width).toBeGreaterThanOrEqual(40)
  await expect(days.first()).toHaveAttribute('aria-pressed', 'true')
  await expect(crew.locator('.chart-readout')).toHaveText(/^Today: /)
  await days.nth(3).click()
  await expect(days.nth(3)).toHaveAttribute('aria-pressed', 'true')
  await expect(crew.locator('.chart-readout')).toHaveText(/still needed/)
  await expect(crew.getByRole('listitem')).toHaveText(['booked', 'waiting to confirm', 'still needed'])

  // One stop for the keyboard; the arrows move along.
  await days.nth(3).focus()
  await page.keyboard.press('ArrowRight')
  await expect(days.nth(4)).toBeFocused()
  await expect(days.nth(4)).toHaveAttribute('aria-pressed', 'true')
  await expect(days.nth(4)).toHaveAttribute('tabindex', '0')
  await expect(days.nth(3)).toHaveAttribute('tabindex', '-1')
  // Past the week's end the arrow carries on into the second week, which the tap above it shows too.
  const weeks = crew.getByRole('group', { name: 'Which week' })
  await expect(weeks.getByRole('button', { name: 'First week' })).toHaveAttribute('aria-pressed', 'true')
  await days.nth(6).click()
  await page.keyboard.press('ArrowRight')
  await expect(weeks.getByRole('button', { name: 'Second week' })).toHaveAttribute('aria-pressed', 'true')
  await expect(days.first()).toBeFocused()
  await expect(days.first()).toHaveAttribute('aria-pressed', 'true')
  await weeks.getByRole('button', { name: 'First week' }).click()
  await expect(crew.locator('.chart-readout')).toHaveText(/^Today: /)

  await expect(page.getByRole('heading', { name: 'Jobs by week' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'The season' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Money' })).toBeVisible()

  // The warehouse: kit booked out each day.
  await page.getByRole('group', { name: 'Show for' }).getByRole('button', { name: 'Warehouse' }).click()
  const kit = page.locator('section', { has: page.getByRole('heading', { name: 'Kit booked out, the next fortnight' }) })
  await expect(kit.locator('.chart-col')).toHaveCount(7)
  await expect(kit.getByRole('button', { name: /for confirmed jobs/ }).first()).toBeVisible()
})

test("Home at a phone's size: the soon over the housekeeping, the week ahead a line a job, and Me their own day", async ({ browser }) => {
  // Proves (audit, 20 October 2026, findings 32, 33, 62, 69, 70, 80): Needs attention puts the next fortnight's work over the
  // housekeeping; the week ahead lists a line a job, no enquiry, counted as listed, with errands and meetings behind one line;
  // the links under the charts are links a thumb can reach; Working this week leaves the role and job room; and Me shows
  // their own day and the day in lieu waiting beside the leave request.
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await page.getByRole('group', { name: 'Show for' }).getByRole('button', { name: 'Company' }).click()

  const attention = page.locator('.standing')
  await expect(attention.getByRole('heading', { level: 3 })).toHaveText(['The next fortnight', 'Housekeeping'])
  await expect(attention.locator('.tiles:not(.housekeeping)').getByRole('link', { name: /kit lines? short for confirmed jobs?/ })).toBeVisible()
  await expect(attention.locator('.tiles.housekeeping').getByRole('link', { name: /answers? to check/ })).toBeVisible()

  const week = page.locator('.week-ahead')
  const listed = week.locator(':scope > .job-list > li')
  const count = await listed.count()
  if (count > 0) await expect(week.getByRole('heading', { name: `The week ahead (${count})` })).toBeVisible()
  await expect(week.locator('.job-row:not(.today-row)')).toHaveCount(0)
  await expect(week.getByText('Enquiry', { exact: true })).toHaveCount(0)
  for (const row of await listed.locator('.job-row').all()) expect((await row.boundingBox())!.height).toBeLessThan(60)
  const errands = week.locator('details.errands')
  if (await errands.count()) {
    await expect(errands.locator('summary')).toHaveText(/^(and )?\d+ (errands?|meetings?)/i)
    await errands.locator('summary').click()
    await expect(errands.locator('.job-row').first()).toBeVisible()
  }

  const crewCalls = page.getByRole('link', { name: 'Crew calls', exact: true })
  await expect(crewCalls).toHaveClass(/\blink\b/)
  expect((await crewCalls.boundingBox())!.height).toBeGreaterThanOrEqual(44)

  await page.getByRole('group', { name: 'Show for' }).getByRole('button', { name: 'Department' }).click()
  await page.getByLabel('Department').selectOption('Audio')
  const working = page.locator('.working-row').first()
  await expect(working).toBeVisible()
  expect((await working.locator(":scope > div:not(.side)").boundingBox())!.width).toBeGreaterThan(220)

  await page.getByRole('group', { name: 'Show for' }).getByRole('button', { name: 'Me', exact: true }).click()
  await page.getByLabel('Your name').selectOption({ label: 'Cian Murphy' })
  await page.getByRole('button', { name: "That's me" }).click()
  await expect(page.getByRole('heading', { name: /^Your day/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Today/ })).toHaveCount(0)
  await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Your leave' }) })).toContainText('1 request and 1 day in lieu waiting to be approved.')
})
