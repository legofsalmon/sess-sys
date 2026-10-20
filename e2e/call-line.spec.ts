import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * A big call at rest, and what Crew's pages say to whom (audit of 18
 * October, finding 20 and the small things): a 40-person call over two days
 * with 25 holding says "25 of 40, both days", names the first eight across
 * the card and counts the rest, which opening the line lists; People and
 * Timesheets are titled by themselves; and staff crew, who can't act on the
 * answers or the timesheets, aren't shown their counts.
 */

const phoneSize = { width: 390, height: 844 }

async function push(request: APIRequestContext, id: string, mutations: [string, Record<string, unknown>][]) {
  const res = await request.post('/api/sync/push', {
    data: { clientId: `call-line-${id}`, mutations: mutations.map(([name, args], i) => ({ id: `call-line-${id}-${i}`, name, args, createdAt: new Date().toISOString() })) },
  })
  const { results } = (await res.json()) as { results: { status: string; reason?: { message: string } }[] }
  expect(results.map((r) => r.reason?.message ?? r.status)).toEqual(mutations.map(() => 'applied'))
}

test('a big call says how many it holds in words, and names the first eight across the card', async ({ browser, request }) => {
  const id = Date.now().toString(36)
  const k = (key: string) => `${key}-${id}`
  const people = Array.from({ length: 25 }, (_, i) => ({ id: k(`p${i}`), name: `Stagehand${String.fromCharCode(65 + i)} Volume${id}` }))
  await push(request, id, [
    ...people.map((p): [string, Record<string, unknown>] => ['person.upsert', { ...p, kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: null, notes: '' }]),
    ['call.create', { id: k('call'), project: `Volume Fest ${id}`, phase: '', venue: '', role: 'Stagehand', start: '2031-06-14', end: '2031-06-15', callTime: null, needed: 40, dayRateCents: null, details: '', replyBy: null }],
    ...people.map((p, i): [string, Record<string, unknown>] => ['offer.send', { id: k(`o${i}`), callId: k('call'), personId: p.id, override: false }]),
    ...people.map((_, i): [string, Record<string, unknown>] => ['offer.respond', { id: k(`o${i}`), answer: 'accept', days: null, note: '' }]),
    // Twenty booked and five still to confirm: answers for the office to check.
    ...people.slice(0, 20).map((_, i): [string, Record<string, unknown>] => ['offer.confirm', { id: k(`o${i}`) }]),
  ])

  const office = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await office.goto('/#crew')
  await expect(office.getByRole('status')).toHaveText('Up to date')
  const call = office.locator('.call-group', { hasText: `Volume Fest ${id}` }).getByRole('article', { name: '40 × Stagehand' })
  await expect(call.locator('.pill').first()).toHaveText('25 of 40, both days')
  const who = call.locator('.who-line > span:last-child')
  await expect(who).toHaveText(new RegExp(`^StagehandA Volume${id}, .*StagehandH Volume${id} and 17 more$`))
  await expect(who).not.toContainText('StagehandI')
  // Across the card, not a column of one word a line beside the pill.
  const [line, card] = await Promise.all([call.locator('.who-line').boundingBox(), call.boundingBox()])
  expect(line!.width).toBeGreaterThan(card!.width * 0.9)
  // "and 17 more" opens the call, which lists everyone on it.
  await call.getByRole('button', { name: 'and 17 more' }).click()
  await expect(call.getByRole('button', { name: '40 × Stagehand' })).toHaveAttribute('aria-expanded', 'true')
  await expect(call.locator('.offers li')).toHaveCount(25)
  expect(await office.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phoneSize.width)

  // People and Timesheets are each titled by itself; Calls is Crew's own.
  await expect(office.getByRole('heading', { level: 1, name: 'Crew' })).toBeVisible()
  const row = office.getByRole('navigation', { name: 'Crew pages' })
  await row.getByRole('link', { name: /^People/ }).click()
  await expect(office.getByRole('heading', { level: 1, name: 'People' })).toBeVisible()
  await expect(office).toHaveTitle('People · Session Hire')
  await row.getByRole('link', { name: /^Timesheets/ }).click()
  await expect(office.getByRole('heading', { level: 1, name: 'Timesheets' })).toBeVisible()
  await expect(office).toHaveTitle('Timesheets · Session Hire')
  // The office has answers to check: the tab and Calls count them.
  const badge = office.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: /^Crew/ }).locator('.badge')
  await expect(badge).toBeVisible()
  await expect(row.getByRole('link', { name: /^Calls/ }).locator('.views-count')).toBeVisible()
})

test("staff crew aren't shown counts of what only the office can act on", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  // The demo copy, as a passcode server would answer for it (as departments.spec.ts does).
  await page.route('**/api/me', (route) => route.fulfill({ json: { auth: 'passcode', role: 'crew' } }))
  await page.route('**/api/auth/preview', (route) => route.fulfill({ json: { role: 'crew' } }))
  await page.goto('/')
  await page.getByRole('button', { name: /^Staff crew/ }).click()
  // Choosing a persona waits for the server and a fresh read before it opens Home (audit finding 23).
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
  await page.goto('/#crew/people')
  await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: /^Crew/ }).locator('.badge')).toHaveCount(0)
  const row = page.getByRole('navigation', { name: 'Crew pages' })
  await expect(row.getByRole('link', { name: /^Calls/ }).locator('.views-count')).toHaveCount(0)
  await expect(row.getByRole('link', { name: /^Timesheets/ }).locator('.views-count')).toHaveCount(0)
})
