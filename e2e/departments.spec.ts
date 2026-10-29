import { expect, test, type Page } from '@playwright/test'

/**
 * A department on every crew call, and what each role reads (ADR 0046):
 * a call asked for starts on the department its role suggests; Crew › Calls
 * narrows to one, and gives the calls with none a department many at a
 * time; Home for a department counts the crew its calls still need; and a
 * head of department, seen on the demo, is told plainly what's hidden for
 * their role rather than shown a wrong figure or a dead button. Uses the
 * made-up data (ADR 0019), so it starts fresh before and after: the other
 * tests share this server.
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

test('a call starts on the department its role suggests, and Calls narrows to one and gives many a department at once', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#crew/calls')
  await expect(page.getByRole('status')).toHaveText('Up to date')

  // Asked for with no department picked: the role's words say LX, and it says where that came from.
  await page.getByRole('button', { name: 'Ask for crew' }).click()
  const ask = page.locator('form').filter({ has: page.getByRole('button', { name: 'Ask for crew' }) })
  await ask.getByLabel('Project').fill('Dept Test Gig')
  await ask.getByLabel('Role').fill('LX op')
  await ask.getByLabel('From').fill('2030-09-01')
  await ask.getByLabel('To', { exact: true }).fill('2030-09-01')
  await expect(ask.getByLabel('Department')).toHaveValue('LX')
  await expect(ask.getByText("From the role. Change it if the call is another department's.")).toBeVisible()
  await ask.getByRole('button', { name: 'Ask for crew' }).click()

  // Narrowed to LX, the new call is there; narrowed to Audio, it isn't.
  const filter = page.getByLabel('Calls for department')
  await filter.selectOption('LX')
  const needed = page.locator('section', { has: page.getByRole('heading', { name: 'Crew needed' }) })
  await expect(needed.getByText('Dept Test Gig')).toBeVisible()
  await filter.selectOption('Audio')
  await expect(needed.getByText('Dept Test Gig')).toHaveCount(0)

  // The load out's hands came with none. Nothing is ticked to start, and nothing is given until a department is picked.
  await filter.selectOption({ label: 'No department' })
  await needed.getByRole('button', { name: /a department…$/ }).click()
  const give = page.getByRole('form', { name: 'Give calls a department' })
  await expect(give.getByRole('button', { name: 'Tick the calls to give it' })).toBeDisabled()
  await give.getByRole('checkbox').first().check()
  await expect(give.getByRole('button', { name: 'Pick a department' })).toBeDisabled()
  await give.getByLabel('Department').selectOption('Production')
  await give.getByRole('button', { name: /^Give 1 call Production$/ }).click()
  // The list moves to Production, where the call now is, and says what was done.
  await expect(page.getByText('Gave 1 call Production.')).toBeVisible()
  await expect(filter).toHaveValue('Production')
  await expect(needed.getByText(/Stagehand/).first()).toBeVisible()
  await expect(filter.locator('option', { hasText: 'No department' })).toHaveCount(0)
})

test('Home for a department counts the crew its calls still need', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await page.goto('/#crew/calls')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  // A call for Video, in the fortnight ahead, that nobody has been offered yet.
  await page.getByRole('button', { name: 'Ask for crew' }).click()
  const ask = page.locator('form').filter({ has: page.getByRole('button', { name: 'Ask for crew' }) })
  const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
  await ask.getByLabel('Project').fill('Camera Day')
  await ask.getByLabel('Role').fill('Camera op')
  await ask.getByLabel('From').fill(soon)
  await ask.getByLabel('To', { exact: true }).fill(soon)
  await ask.getByRole('button', { name: 'Ask for crew' }).click()
  await expect(page.getByRole('status')).toHaveText('Up to date')

  await page.goto('/#home')
  await page.getByRole('group', { name: 'Show for' }).getByRole('button', { name: 'Department' }).click()
  await page.getByLabel('Department').selectOption('Video')
  await expect(page.getByRole('heading', { name: 'Needs attention in Video' })).toBeVisible()
  await expect(page.locator('.standing').getByRole('link', { name: /call(s)? still need(s)? crew/ })).toBeVisible()

  // The count opens the list it counted (audit, 20 October 2026, finding 4): Crew needed, in view, narrowed to Video.
  await page.locator('.standing').getByRole('link', { name: /call(s)? still need(s)? crew/ }).click()
  const needed = page.getByRole('heading', { name: 'Crew needed' })
  await expect(needed).toBeFocused()
  await expect(needed).toBeInViewport()
  await expect(page.getByLabel('Calls for department')).toHaveValue('Video')
  await expect(page.getByText(/Camera op/).first()).toBeVisible()
  // Opened from the tab bar, it's every department again.
  await page.goto('/#home')
  await page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: /^Crew/ }).click()
  await expect(page.getByLabel('Calls for department')).toHaveValue('')
})

/**
 * The demo copy, seen as Audio's head of department. This server has no
 * passcode, so the test answers for it as a demo copy would: it says who's
 * asking, and sends what a head of department reads, as the server's own
 * tests prove it does (server/test/roles.test.ts).
 */
async function asHeadOfAudio(page: Page) {
  await page.route('**/api/me', (route) => route.fulfill({ json: { auth: 'passcode', role: 'head' } }))
  await page.route('**/api/auth/preview', (route) => route.fulfill({ json: { role: 'head' } }))
  await page.route('**/api/sync/pull**', async (route) => {
    // A pull still on its way when the test ends finds the page closed: nothing to answer.
    const res = await route.fetch().catch(() => null)
    if (!res) return
    const body = await res.json()
    type Change = { entity: string; op: string; data: Record<string, unknown> }
    for (const c of body.changes as Change[]) {
      if (c.op !== 'put') continue
      const d = c.data
      if (c.entity === 'person') {
        Object.assign(d, { dayRateCents: null, rateHidden: true })
        if (String(d.department ?? '').toLowerCase() !== 'audio') Object.assign(d, { linkToken: '', linkHidden: true })
      }
      if (c.entity === 'crewCall') Object.assign(d, { dayRateCents: null, rateHidden: true })
      if (c.entity === 'offer') Object.assign(d, { dayRateCents: null, counterRateCents: null, rateHidden: true })
      if (c.entity === 'timesheet') {
        const zero = (extras: { cents: number }[]) => extras.map((e) => ({ ...e, cents: 0 }))
        const sent = d.sent as { extras: { cents: number }[] }
        Object.assign(d, { dayRateCents: null, extras: zero(d.extras as { cents: number }[]), sent: { ...sent, dayRateCents: null, extras: zero(sent.extras) }, amountsHidden: true })
      }
    }
    await route.fulfill({ response: res, json: { ...body, reading: { rates: false, links: 'department', department: 'Audio' } } })
  })
}

test('a head of department is told what is hidden for their role, and never shown a wrong figure', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await asHeadOfAudio(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'See it as…' })).toBeVisible()
  await expect(page.getByText(/hidden for your role/)).toBeVisible()
  await page.getByRole('button', { name: /^Head of department/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
  // Home offers only what they can act on (audit, 20 October 2026, finding 3): timesheets they can't decide aren't a count for them.
  await expect(page.locator('.standing h2')).toBeVisible()
  await expect(page.locator('.standing').getByRole('link', { name: /timesheets? to approve/ })).toHaveCount(0)

  // Crew needed starts on their own department, and no rate is shown as one.
  await page.goto('/#crew/calls')
  await expect(page.getByLabel('Calls for department')).toHaveValue('Audio')
  await expect(page.locator('main')).not.toContainText('NaN')
  await expect(page.locator('main')).not.toContainText('€')

  // Someone in Audio: their link is there to send. Someone in LX: said plainly, with nothing that would break their link.
  await page.goto('/#crew/people')
  await page.getByRole('region', { name: 'People' }).getByRole('link', { name: /^Dara Quinn/ }).click()
  await page.getByRole('tab', { name: /^Details/ }).click()
  await expect(page.getByText('Hidden for your role')).toBeVisible()
  await page.getByRole('tab', { name: /^Their link/ }).click()
  await expect(page.getByRole('link', { name: 'Open their page' })).toBeVisible()
  await page.goto('/#crew/people')
  await page.getByRole('region', { name: 'People' }).getByRole('link', { name: /^Fionn Gallagher/ }).click()
  await page.getByRole('tab', { name: /^Their link/ }).click()
  await expect(page.getByText("Your role doesn't see Fionn Gallagher's link.", { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open their page' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New link' })).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText('€')

  // Timesheets: what came in, with the amounts said to be hidden, and the deciding left to the office.
  await page.goto('/#crew/timesheets')
  await expect(page.getByText("Your role doesn't see crew rates, so the amounts are hidden")).toBeVisible()
  await expect(page.getByRole('group', { name: 'To approve' })).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText('NaN')
  await expect(page.locator('main')).not.toContainText('€')

  // You says what this role reads.
  await page.goto('/#me')
  await expect(page.getByText("You don't see crew rates or timesheet amounts, other than your own, and the private links of people in your department.")).toBeVisible()
})
