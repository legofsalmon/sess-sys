import { expect, test, type Page } from '@playwright/test'

/**
 * Venues on the map (ADR 0057), end to end on a phone: the Venues list has
 * every venue with a pin on one map and says which aren't yet; Find the
 * rest looks them up, one by one, for the office to check before they're
 * put on the map; a venue's page has its own map with directions, and its
 * pin is moved by pasting a link or coordinates, or taken off. The map's
 * pictures and the map search are stood in for here, so no test reaches
 * OpenStreetMap (but for the map's pictures in screenshots). Uses the made-up data (ADR 0019): four of its five
 * venues are on the map, Clonmore House isn't.
 * To refresh the blueprint screenshots, run this file on its own with SHOTS=1.
 */

const phoneSize = { width: 390, height: 844 }
const fresh = { data: { confirm: 'delete everything' } }
const shot = (name: string) => (process.env.SHOTS ? { path: `docs/hub/img/${name}.png` } : undefined)
// A grey square for every picture of the map.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN89+7dfwAI5AOhdzRnxQAAAABJRU5ErkJggg==', 'base64')

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
  expect((await request.post('/api/data/made-up')).ok()).toBe(true)
})

test.afterEach(async ({ request }) => {
  expect((await request.post('/api/data/start-fresh', fresh)).ok()).toBe(true)
})

/** The office on a phone, with the map's pictures and its search stood in for. */
async function office(browser: import('@playwright/test').Browser, places: (url: URL) => { status: number; body: unknown }, serviceWorkers: 'allow' | 'block' = 'allow') {
  const page = await (await browser.newContext({ viewport: phoneSize, serviceWorkers })).newPage()
  // The blueprint's screenshots show the real map.
  if (!process.env.SHOTS) await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE, headers: { 'access-control-allow-origin': '*' } }))
  await page.route('**/api/places?**', (r) => {
    const { status, body } = places(new URL(r.request().url()))
    return r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return page
}

const pins = (page: Page) => page.locator('.map .map-pin')

test('the Venues list has a map of them all, and finds the rest for the office to check', async ({ browser }) => {
  // Proves: placed venues are pins on one map; the one not placed says so in the list and the line under the map; Find the rest looks it up, ticks what was found, and puts it on the map in one press.
  const page = await office(browser, (url) =>
    url.searchParams.get('name') === 'Clonmore House' ? { status: 200, body: { found: [{ lat: 52.92, lng: -6.43, label: 'Clonmore, County Wicklow' }], searched: 'Clonmore House, Clonmore, Co. Wicklow' } } : { status: 200, body: { found: [] } }
  )
  await page.goto('/#jobs/venues')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  const map = page.getByRole('region', { name: 'Map', exact: true })
  await expect(map.getByRole('region', { name: 'Map of 4 venues' })).toBeVisible()
  await expect(pins(page)).toHaveCount(4)
  await expect(map).toContainText('4 of 5 venues on the map. One isn’t yet')
  await expect(page.getByRole('link', { name: /^Clonmore House/ })).toContainText('not on the map yet')
  if (process.env.SHOTS) await page.waitForLoadState('networkidle')
  await page.screenshot(shot('venues-map'))

  // A pin's label opens its page.
  await page.locator('.map-pin[title="The Granary Hall"]').click()
  await expect(page.locator('.leaflet-popup-content a')).toHaveAttribute('href', /^#jobs\/venues\//)

  await map.getByRole('button', { name: 'Find the rest' }).click()
  const found = map.getByRole('group', { name: "Found: untick any that's wrong" })
  await expect(found.getByRole('checkbox', { name: /Clonmore House/ })).toBeChecked()
  await expect(found).toContainText('Clonmore, County Wicklow')
  await map.getByRole('button', { name: 'Put 1 venue on the map' }).click()
  await expect(map).toContainText('All 5 venues are on the map.')
  await expect(pins(page)).toHaveCount(5)
  await expect(page.getByRole('link', { name: /^Clonmore House/ })).not.toContainText('not on the map yet')
})

test("a venue's own map gives directions, and its pin is moved by a pasted link or taken off", async ({ browser }) => {
  // Proves: the page's map shows its pin with directions to it; Move the pin takes a pasted Google Maps link and saves only on Save the pin; taking it off says it's not on the map; a search that's down says so in words, and coordinates still work.
  const page = await office(browser, () => ({ status: 502, body: { error: "The map search isn't answering. Put the pin in by hand on the map, or try again later." } }))
  await page.goto('/#jobs/venues')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await page.getByRole('link', { name: /^Northbank Conference Centre/ }).click()
  const card = page.getByRole('region', { name: 'On the map' })
  await expect(card.getByRole('region', { name: 'Map of Northbank Conference Centre' })).toBeVisible()
  await expect(card.locator('.map-pin')).toHaveCount(1)
  await expect(card.getByRole('link', { name: 'Directions' })).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=53.3478,-6.237')
  await card.scrollIntoViewIfNeeded()
  if (process.env.SHOTS) await page.waitForLoadState('networkidle')
  await page.screenshot(shot('venue-map'))

  await card.getByRole('button', { name: 'Move the pin' }).click()
  const moving = page.getByRole('region', { name: 'Move the pin' })
  await moving.getByLabel('Or paste a map link or coordinates').fill('somewhere near the quay')
  await moving.getByRole('button', { name: 'Use it' }).click()
  await expect(moving.getByRole('alert')).toHaveText(/^That isn't a map link or coordinates/)
  await moving.getByLabel('Or paste a map link or coordinates').fill('https://www.google.com/maps/place/3Arena/@53.34755,-6.22845,17z')
  await moving.getByRole('button', { name: 'Use it' }).click()
  await expect(moving).toContainText('Now at 53.34755, -6.22845.')
  await moving.getByRole('button', { name: 'Save the pin' }).click()
  await expect(card.getByRole('link', { name: 'Directions' })).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=53.34755,-6.22845')

  await card.getByRole('button', { name: 'Move the pin' }).click()
  await page.getByRole('region', { name: 'Move the pin' }).getByRole('button', { name: 'Take it off the map' }).click()
  await expect(card).toContainText('Not on the map yet.')

  // Looked up again with the search down: the reason in words, and a pin typed in still goes on.
  await card.getByRole('button', { name: 'Put it on the map' }).click()
  const placing = page.getByRole('region', { name: 'Put it on the map' })
  await expect(placing.getByText("The map search isn't answering. Put the pin in by hand on the map, or try again later.")).toBeVisible()
  await placing.getByLabel('Or paste a map link or coordinates').fill('53.3478, -6.237')
  await placing.getByRole('button', { name: 'Use it' }).click()
  await placing.getByRole('button', { name: 'Save the pin' }).click()
  await expect(card.getByRole('link', { name: 'Directions' })).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=53.3478,-6.237')
  await expect(page.getByRole('status')).toHaveText('Up to date')
})

test('a map first opened with no signal says it comes with signal, and comes when it does', async ({ browser }) => {
  // Proves: the map's code isn't in every phone's download (audit, 20 October 2026, finding 65), so a phone that never opened a map and has no signal is told so where the map would be, the rest of the page still works, and the map arrives on its own once the signal is back.
  // The browser's no-signal switch doesn't reach what the app's service worker fetches, and whether the worker has taken
  // the page yet is a race: with it left out, the map's code is fetched by the page, as it is on a phone whose worker
  // has no copy, and fails as it does there.
  const page = await office(browser, () => ({ status: 200, body: { found: [] } }), 'block')
  await page.goto('/#jobs')
  await expect(page.getByRole('status')).toHaveText('Up to date')
  await page.context().setOffline(true)
  await page.goto('/#jobs/venues')
  const map = page.getByRole('region', { name: 'Map of 4 venues' })
  await expect(map).toContainText("The map comes with signal: it hasn't been opened on this phone before.")
  await expect(page.getByRole('link', { name: /^Clonmore House/ })).toBeVisible()
  await page.context().setOffline(false)
  await expect(pins(page)).toHaveCount(4)
  await expect(page.locator('.map-missing')).toHaveCount(0)
})
