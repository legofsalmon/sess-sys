import { expect, test, type Page } from '@playwright/test'

/**
 * The content security policies (audit finding 24), in a real browser: the
 * app shell, a venue's map, the labels and a freelancer's page and call
 * sheet all work under them, and the browser turns nothing down while they
 * do. Uses the made-up data (ADR 0019), so it starts fresh before and after.
 */

const fresh = { data: { confirm: 'delete everything' } }
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN89+7dfwAI5AOhdzRnxQAAAABJRU5ErkJggg==', 'base64')

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
})

test.afterEach(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})

/** Everything the browser turned down under the page's policy, as "directive: what". */
async function watch(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = ((window as unknown as { refused: string[] }).refused = [])
    document.addEventListener('securitypolicyviolation', (e) => seen.push(`${e.effectiveDirective}: ${e.blockedURI || 'inline'}`))
  })
  return () => page.evaluate(() => (window as unknown as { refused: string[] }).refused)
}

test('the app works under its policy, the theme script, the map and the labels included', async ({ page }) => {
  const refused = await watch(page)
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE, headers: { 'access-control-allow-origin': '*' } }))
  // A device that chose light: the inline script sets it before anything is drawn.
  await page.addInitScript(() => localStorage.setItem('sh.theme', 'light'))
  await page.goto('/#jobs')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('.job-row').first()).toBeVisible()

  await page.goto('/#jobs/venues')
  await expect(page.locator('.map .map-pin').first()).toBeVisible()
  await expect(page.locator('.map img.leaflet-tile-loaded').first()).toBeVisible()

  await page.goto('/#stock/labels')
  await expect(page.getByRole('heading', { name: /labels/i }).first()).toBeVisible()
  expect(await refused()).toEqual([])
})

test("a freelancer's page and call sheet work under theirs, the Copy button's script included", async ({ browser, request }) => {
  type Row = { entity: string; id: string; data: { name?: string; linkToken?: string; personId?: string; callId?: string; status?: string } }
  const { changes } = (await (await request.get('/api/sync/pull?after=0')).json()) as { changes: Row[] }
  // Dara is booked on Harbour Lights in the made-up data, so has a call sheet.
  const dara = changes.find((c) => c.entity === 'person' && c.data.name === 'Dara Quinn')!
  const booked = changes.find((c) => c.entity === 'offer' && c.data.personId === dara.id && (c.data.status === 'confirmed' || c.data.status === 'accepted'))!
  const page = await (await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })).newPage()
  const refused = await watch(page)
  const response = await page.goto(`/f/${dara.data.linkToken}`)
  expect(response?.headers()['content-security-policy']).toContain("default-src 'none'")
  // Shown only once its script has run.
  await page.getByRole('button', { name: 'Copy address' }).click()
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()

  const sheet = await page.goto(`/f/${dara.data.linkToken}/sheet/${booked.data.callId}`)
  expect(sheet?.status()).toBe(200)
  expect(sheet?.headers()['content-security-policy']).toContain("default-src 'none'")
  await expect(page.locator('h1').first()).toBeVisible()
  expect(await refused()).toEqual([])
})
