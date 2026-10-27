import { expect, test, type Page } from '@playwright/test'

/**
 * The app's frame and the small things on every screen (the 18 October
 * audit's P2 23 and P3 polish): on a phone an area's row shows every page,
 * its counts apart from their words, and "On this screen" is drawn apart
 * from it, every part a thumb's height; on a desk a keyboard meets "Skip to
 * content" first, then the places, then the screen; offline the company's
 * name keeps its room; an empty list says so once; a printed page is white
 * round the sheet; and a demo persona is told to the server and the copy
 * read again before the app opens as them. Uses the made-up data (ADR 0019),
 * so it starts fresh before and after: the other tests share this server.
 */

const phoneSize = { width: 390, height: 844 }
const deskSize = { width: 1440, height: 900 }
const fresh = { data: { confirm: 'delete everything' } }

test.beforeAll(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
})

test.afterAll(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})

async function ready(page: Page, hash: string) {
  await page.goto(`/${hash}`)
  await expect(page.locator('.conn')).toHaveText('Up to date')
}

test('on a phone an area row is one line that scrolls, counts stand apart, and the strip is a thumb high', async ({ browser }) => {
  // Proves: Stock's nine pages, Jobs' six and Crew's four stay one line at 390px (ADR 0082): the current page is in view, the row scrolls to the last, and the edge with more past it fades, so no page is hidden with nothing to say so (audit P2 23); a count has a gap before it ("Calls 4", not "Calls4"); the "On this screen" parts are 44px tall and drawn without the row's box.
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  for (const [hash, label, current, last] of [
    ['#stock/vehicles', 'Stock pages', /^Vehicles/, 'Purchase list'],
    ['#jobs', 'Jobs pages', 'List', 'Money'],
    ['#crew', 'Crew pages', /^Calls/, /^Timesheets/],
  ] as const) {
    await ready(page, hash)
    const row = page.getByRole('navigation', { name: label })
    const tops = await row.evaluate((nav) => new Set([...nav.querySelectorAll('a')].map((a) => Math.round(a.getBoundingClientRect().top))).size)
    expect(tops, `${label} on one line`).toBe(1)
    await expect(row.getByRole('link', { name: current })).toBeInViewport({ ratio: 1 })
    const more = await row.evaluate((nav) => nav.scrollWidth > nav.clientWidth)
    if (more) expect(await row.getAttribute('data-more')).not.toBe('')
    await row.getByRole('link', { name: last }).scrollIntoViewIfNeeded()
    await expect(row.getByRole('link', { name: last })).toBeInViewport({ ratio: 1 })
  }
  // The Calls count, apart from its word.
  const calls = page.getByRole('navigation', { name: 'Crew pages' }).getByRole('link', { name: /^Calls/ })
  const gap = await calls.evaluate((a) => {
    const word = document.createRange()
    word.selectNodeContents(a.firstChild!)
    return Math.round(a.querySelector('.views-count')!.getBoundingClientRect().left - word.getBoundingClientRect().right)
  })
  expect(gap).toBeGreaterThanOrEqual(4)

  // Home has parts enough for the strip on a phone (Jobs folds New job into its one card now).
  await ready(page, '#home')
  const strip = page.getByRole('navigation', { name: 'On this screen' })
  await expect(strip.getByRole('button').first()).toBeVisible()
  for (const part of await strip.getByRole('button').all()) {
    const box = (await part.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(await part.evaluate((b) => getComputedStyle(b).borderTopWidth)).toBe('0px')
  }
})

test('on a desk a keyboard meets Skip to content, then the places, then the screen', async ({ browser }) => {
  // Proves: the first Tab lands on "Skip to content", shown once it has focus; pressing it lands on the screen's heading; the next Tab after the skip link is the first place in the sidebar, not the end of the screen.
  const page = await (await browser.newContext({ viewport: deskSize })).newPage()
  await ready(page, '#stock')
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Home' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Catalogue' })).toBeFocused()
  await expect(page).toHaveURL(/#stock$/)
})

test('offline on a phone the company keeps its name, and print is white round the sheet', async ({ browser }) => {
  // Proves: with no signal the top bar's "SESSION HIRE" isn't cut short and "No signal" is whole on screen; printing in the dark theme gives a white page.
  const context = await browser.newContext({ viewport: phoneSize })
  const page = await context.newPage()
  await ready(page, '#jobs')
  await page.route('**/api/sync/**', (route) => route.abort())
  await page.evaluate(() => dispatchEvent(new Event('online')))
  await expect(page.locator('.conn')).toHaveText(/^No signal/)
  const name = page.locator('.top .brand b')
  expect(await name.evaluate((b) => b.scrollWidth <= b.clientWidth)).toBe(true)
  await expect(page.locator('.conn')).toBeInViewport({ ratio: 1 })

  await page.emulateMedia({ media: 'print' })
  expect(await page.evaluate(() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor])).toEqual([
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
  ])
})

test('an empty list that says so in its own words says it once', async ({ browser, request }) => {
  // Proves: on a server with nothing on it, Money's empty quotes read "Nothing yet. Set prices…" alone, while a list with only what to do still starts "Nothing here yet.".
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  await ready(page, '#jobs/money')
  await expect(page.locator('.empty', { hasText: /^Nothing yet\. Set prices/ })).toHaveCount(1)
  await expect(page.locator('.empty', { hasText: /^Nothing here yet\. (No|Nothing|Nobody)\b/ })).toHaveCount(0)
  await ready(page, '#jobs/clients')
  await expect(page.locator('.empty')).toHaveText('Nothing here yet. Clients are added as you type them into a job.')
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
})

test('a demo persona is told to the server and the copy read again before the app opens as them', async ({ browser }) => {
  // Proves: choosing Staff crew waits for the server to hold the browser to the role, then reads the copy again, and only then opens Home, so a narrower persona never shows what the last one was sent.
  const page = await (await browser.newContext({ viewport: phoneSize })).newPage()
  const marks: string[] = []
  await page.exposeFunction('mark', (what: string) => void marks.push(what))
  await page.addInitScript(() => addEventListener('hashchange', () => (window as unknown as { mark: (w: string) => void }).mark(`moved ${location.hash}`)))
  await page.route('**/api/me', (route) => route.fulfill({ json: { auth: 'passcode', role: 'crew' } }))
  await page.route('**/api/auth/preview', async (route) => {
    marks.push('telling')
    await new Promise((done) => setTimeout(done, 2500))
    marks.push('told')
    await route.fulfill({ json: { role: 'crew' } })
  })
  page.on('request', (r) => r.url().includes('/api/sync/pull') && marks.push('pull'))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'See it as…' })).toBeVisible()
  await page.getByRole('button', { name: /^Staff crew/ }).click()
  // Past the design system's second, the choice says what it's doing.
  await expect(page.getByRole('button', { name: /^Staff crew/ })).toContainText("Opening it as they'd see it…")
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
  const told = marks.indexOf('told')
  const moved = marks.findIndex((m) => m.startsWith('moved'))
  expect(told).toBeGreaterThan(-1)
  expect(marks.slice(told, moved)).toContain('pull')
})
